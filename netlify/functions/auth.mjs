// Logging in: username + password, or Sign in with Google.
// Passwords are stored only as salted scrypt hashes. Google sign-in is checked against Google's public keys.
import { getStore } from "@netlify/blobs";
import { randomBytes, scryptSync, timingSafeEqual, createPublicKey, verify as cverify } from "node:crypto";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const clean = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
const keyOf = (n) => encodeURIComponent(clean(n).toLowerCase());
const env = (k) => String((globalThis.Netlify && Netlify.env.get(k)) || process.env[k] || "");
const rid = (n) => randomBytes(n).toString("hex").slice(0, n);
const okPass = (p) => typeof p === "string" && p.length >= 4 && p.length <= 72;
const hashPass = (p, salt = rid(16)) => ({ salt, hash: scryptSync(p, salt, 32).toString("hex") });
const checkPass = (p, rec) => {
  if (!rec || !rec.salt) return false;
  const a = Buffer.from(scryptSync(p, rec.salt, 32).toString("hex")), b = Buffer.from(rec.hash);
  return a.length === b.length && timingSafeEqual(a, b);
};
const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Google ID token (from the "Sign in with Google" button) -> the Google account's id, or null
let JWKS = null, JWKS_AT = 0;
async function googleSub(token) {
  const CID = env("GOOGLE_CLIENT_ID");
  if (!CID || typeof token !== "string") return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let head, body;
  try { head = JSON.parse(b64u(h)); body = JSON.parse(b64u(p)); } catch { return null; }
  if (Date.now() - JWKS_AT > 3600e3 || !JWKS) {
    const r = await fetch(env("GOOGLE_JWKS_URL") || "https://www.googleapis.com/oauth2/v3/certs");
    JWKS = (await r.json()).keys || []; JWKS_AT = Date.now();
  }
  const jwk = JWKS.find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== "RS256") return null;
  const ok = cverify("RSA-SHA256", Buffer.from(h + "." + p), createPublicKey({ key: jwk, format: "jwk" }), b64u(s));
  if (!ok) return null;
  const iss = env("GOOGLE_ISS") || "accounts.google.com";
  if (body.aud !== CID || (body.iss !== iss && body.iss !== "https://" + iss) || !(body.exp * 1000 > Date.now())) return null;
  return String(body.sub || "") || null;
}

export default async (req) => {
  const players = getStore({ name: "players", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });
  const google = getStore({ name: "google", consistency: "strong" });
  const fails = getStore({ name: "authfails", consistency: "strong" });
  if (req.method === "GET") return json({ google: env("GOOGLE_CLIENT_ID") || null });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  // this device becomes that player: a fresh device secret is added to the account
  const enter = async (id, p) => {
    const secret = rid(32);
    p.keys = [...(p.keys || []), hash(secret)].slice(-8);
    await players.setJSON(id, p);
    return json({ id, secret, name: p.name, save: p.save || null });
  };
  const create = async (name, extra) => {
    const key = keyOf(name);
    if (!clean(name)) return json({ error: "bad_name" }, 400);
    if (await names.get(key)) return json({ error: "taken" }, 409);
    const id = "p" + rid(15), secret = rid(32);
    await names.set(key, id);
    await players.setJSON(id, { name: clean(name), keys: [hash(secret)], weeks: {}, pen: {}, save: null, merged: null, ...extra, updated: Date.now() });
    return json({ id, secret, name: clean(name), save: null });
  };
  const mine = async () => {
    if (!okId(b.id) || !okSecret(b.secret)) return null;
    const p = await players.get(b.id, { type: "json" });
    return p && (p.keys || []).includes(hash(b.secret)) ? p : null;
  };

  switch (b.action) {
    case "signup": {
      if (!okPass(b.password)) return json({ error: "short_password" }, 400);
      return create(b.name, { pass: hashPass(b.password) });
    }
    case "login": {
      const key = keyOf(b.name), win = key + "-" + Math.floor(Date.now() / 600000);
      const n = Number((await fails.get(win)) || 0);
      if (n >= 8) return json({ error: "slow_down" }, 429);
      const id = key ? await names.get(key) : null;
      const p = id ? await players.get(id, { type: "json" }) : null;
      if (!p || !p.pass || !okPass(b.password) || !checkPass(b.password, p.pass)) {
        await fails.set(win, String(n + 1));
        return json({ error: p && !p.pass ? "no_password" : "wrong" }, 403);
      }
      return enter(id, p);
    }
    case "status": {
      const p = await mine();
      if (!p) return json({ error: "not_yours" }, 403);
      return json({ hasPass: !!p.pass, google: !!p.google });
    }
    case "setpass": { // a device that already holds the account sets or changes its password
      const p = await mine();
      if (!p) return json({ error: "not_yours" }, 403);
      if (!okPass(b.password)) return json({ error: "short_password" }, 400);
      p.pass = hashPass(b.password);
      await players.setJSON(b.id, p);
      return json({ ok: true });
    }
    case "google": { // sign in, or say this Google account isn't linked to anyone yet
      const sub = await googleSub(b.credential);
      if (!sub) return json({ error: "bad_google" }, 403);
      const id = await google.get(sub);
      const p = id ? await players.get(id, { type: "json" }) : null;
      if (p) return enter(id, p);
      if (b.name) { // brand new player picking a username
        const r = await create(b.name, { google: sub });
        if (r.status === 200) { const d = await r.clone().json(); await google.set(sub, d.id); }
        return r;
      }
      return json({ needName: true });
    }
    case "linkgoogle": { // a logged-in player adds Google as another way in
      const p = await mine();
      if (!p) return json({ error: "not_yours" }, 403);
      const sub = await googleSub(b.credential);
      if (!sub) return json({ error: "bad_google" }, 403);
      const other = await google.get(sub);
      if (other && other !== b.id) return json({ error: "google_taken" }, 409);
      p.google = sub; await players.setJSON(b.id, p); await google.set(sub, b.id);
      return json({ ok: true });
    }
  }
  return json({ error: "bad_action" }, 400);
};

export const config = { path: "/api/auth" };
