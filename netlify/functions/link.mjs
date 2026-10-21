// Link a device: POST makes a 4-digit code (10 minutes, one use); GET with the code joins this device to that player.
import { getStore } from "@netlify/blobs";
import { randomInt, randomBytes } from "node:crypto";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const LINK_MS = 10 * 60 * 1000;
const MAX_FAILS = 40; // wrong guesses allowed across everyone per 10-minute window

export default async (req) => {
  const players = getStore({ name: "players", consistency: "strong" });
  const links = getStore({ name: "links", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    const { id, secret } = body;
    if (!okId(id) || !okSecret(secret)) return json({ error: "bad_id" }, 400);
    const p = await players.get(id, { type: "json" });
    if (!p || !(p.keys || []).includes(hash(secret))) return json({ error: "not_yours" }, 403);
    let code;
    for (let i = 0; i < 20; i++) {
      const c = String(randomInt(1000, 10000));
      const cur = await links.get(c, { type: "json" });
      if (!cur || cur.exp < Date.now()) { code = c; break; }
    }
    if (!code) return json({ error: "busy" }, 503);
    const exp = Date.now() + LINK_MS;
    await links.setJSON(code, { id, exp });
    return json({ code, exp });
  }

  if (req.method === "GET") {
    const win = "fails-" + Math.floor(Date.now() / LINK_MS);
    const fails = Number((await links.get(win)) || 0);
    if (fails >= MAX_FAILS) return json({ error: "slow_down" }, 429);
    const code = String(url.searchParams.get("code") || "").replace(/\D/g, "");
    const l = code.length === 4 ? await links.get(code, { type: "json" }) : null;
    if (!l || l.exp < Date.now()) {
      await links.set(win, String(fails + 1));
      return json({ error: "not_found" }, 404);
    }
    await links.delete(code);
    const p = await players.get(l.id, { type: "json" });
    if (!p) return json({ error: "not_found" }, 404);
    const secret = randomBytes(24).toString("hex").slice(0, 32);
    p.keys = [...(p.keys || []), hash(secret)].slice(-8);
    await players.setJSON(l.id, p);
    return json({ id: l.id, secret, name: p.name, save: p.save || null });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/link" };
