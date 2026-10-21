// The Red Egg leaderboard: one record per player, unique usernames.
// A username belongs to the devices that hold its secret; new devices join with a link code.
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const clean = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
const keyOf = (n) => encodeURIComponent(clean(n).toLowerCase());

export default async (req) => {
  const players = getStore({ name: "players", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await players.list();
    const list = await Promise.all(blobs.map((b) => players.get(b.key, { type: "json" }).then((p) => [b.key, p])));
    return json({
      players: list.filter(([, p]) => p && p.name).map(([id, p]) => ({ id, name: p.name, weeks: p.weeks || {}, pen: p.pen || {} })),
    });
  }

  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > 250000) return json({ error: "too_big" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
    const { id, secret } = body;
    if (!okId(id) || !okSecret(secret)) return json({ error: "bad_id" }, 400);
    const name = clean(body.name);
    if (!name) return json({ error: "bad_name" }, 400);

    const prev = await players.get(id, { type: "json" });
    const h = hash(secret);
    if (prev && !(prev.keys || []).includes(h)) return json({ error: "not_yours" }, 403);

    const key = keyOf(name);
    const owner = await names.get(key);
    if (owner && owner !== id) return json({ error: "taken" }, 409);
    if (prev && prev.name && keyOf(prev.name) !== key && (await names.get(keyOf(prev.name))) === id) {
      await names.delete(keyOf(prev.name)); // renaming frees the old username
    }
    if (!owner) await names.set(key, id);

    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    await players.setJSON(id, {
      name,
      keys: prev ? prev.keys : [h],
      weeks: obj(body.weeks),
      pen: obj(body.pen),
      save: body.save && typeof body.save === "object" ? body.save : prev?.save ?? null,
      updated: Date.now(),
    });
    return json({ ok: true });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/players" };
