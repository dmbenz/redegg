// Admin tools for the leaderboard: delete a player, or merge a duplicate account into the real one.
// The 4-digit PIN lives only in Netlify's environment settings (ADMIN_PIN), never in this public code.
import { getStore } from "@netlify/blobs";
import { json, combine } from "../lib/util.mjs";

const clean = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
const keyOf = (n) => encodeURIComponent(clean(n).toLowerCase());
const MAX_FAILS = 5, LOCK_MS = 60 * 60 * 1000; // 5 wrong PINs locks admin for an hour

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const players = getStore({ name: "players", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });
  const admin = getStore({ name: "admin", consistency: "strong" });
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const PIN = String((globalThis.Netlify && Netlify.env.get("ADMIN_PIN")) || process.env.ADMIN_PIN || "");
  if (!/^\d{4}$/.test(PIN)) return json({ error: "not_set_up" }, 503);
  const now = Date.now();
  const lock = (await admin.get("lock", { type: "json" })) || { fails: 0, since: now };
  if (now - lock.since > LOCK_MS) { lock.fails = 0; lock.since = now; }
  if (lock.fails >= MAX_FAILS) return json({ error: "locked" }, 429);
  if (String(body.pin || "") !== PIN) {
    lock.fails++; await admin.setJSON("lock", lock);
    return json({ error: "bad_pin" }, 403);
  }
  if (lock.fails) await admin.setJSON("lock", { fails: 0, since: now });

  if (body.action === "check") return json({ ok: true });

  if (body.action === "delete") {
    const p = await players.get(String(body.id || ""), { type: "json" });
    if (!p) return json({ error: "not_found" }, 404);
    if ((await names.get(keyOf(p.name))) === body.id) await names.delete(keyOf(p.name));
    if (p.google) await getStore({ name: "google", consistency: "strong" }).delete(p.google);
    await players.delete(body.id);
    return json({ ok: true });
  }

  if (body.action === "setpass") { // for a friend who forgot their password
    const p = await players.get(String(body.id || ""), { type: "json" });
    if (!p) return json({ error: "not_found" }, 404);
    const pw = String(body.password || "");
    if (pw.length < 4 || pw.length > 72) return json({ error: "short_password" }, 400);
    const { randomBytes, scryptSync } = await import("node:crypto");
    const salt = randomBytes(8).toString("hex");
    p.pass = { salt, hash: scryptSync(pw, salt, 32).toString("hex") };
    await players.setJSON(body.id, p);
    return json({ ok: true });
  }

  if (body.action === "merge") {
    const from = String(body.from || ""), into = String(body.into || "");
    if (!from || !into || from === into) return json({ error: "bad_ids" }, 400);
    const a = await players.get(from, { type: "json" }), b = await players.get(into, { type: "json" });
    if (!a || !b) return json({ error: "not_found" }, 404);
    const dup = combine({ weeks: a.weeks || {}, pen: a.pen || {} }, a.merged);
    b.merged = combine(dup, b.merged);
    await players.setJSON(into, b);
    if ((await names.get(keyOf(a.name))) === from) await names.delete(keyOf(a.name));
    if (a.google && !b.google) { b.google = a.google; await players.setJSON(into, b); await getStore({ name: "google", consistency: "strong" }).set(a.google, into); }
    else if (a.google) await getStore({ name: "google", consistency: "strong" }).delete(a.google);
    await players.delete(from);
    return json({ ok: true });
  }
  return json({ error: "bad_action" }, 400);
};

export const config = { path: "/api/admin" };
