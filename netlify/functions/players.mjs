// The Red Egg leaderboard: one record per player, unique usernames.
// A username belongs to the devices that hold its secret; new devices join with a link code.
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret, combine, mergeWeeks, mergeSave, penCounts } from "../lib/util.mjs";

const clean = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
const keyOf = (n) => encodeURIComponent(clean(n).toLowerCase());

export default async (req) => {
  const players = getStore({ name: "players", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await players.list();
    const list = await Promise.all(blobs.map((b) => players.get(b.key, { type: "json" }).then((p) => [b.key, p])));
    return json({
      players: list.filter(([, p]) => p && p.name).map(([id, p]) => {
        const c = combine({ weeks: p.weeks || {}, pen: p.pen || {} }, p.merged);
        return { id, name: p.name, weeks: c.weeks, pen: c.pen };
      }),
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
    // a player on several devices: keep everything any of them has sent
    const save = mergeSave(prev?.save ?? null, body.save && typeof body.save === "object" ? body.save : null);
    const weeks = mergeWeeks(prev?.weeks || {}, obj(body.weeks));
    const pen = save && save.pen ? penCounts(save.pen) : obj(body.pen);
    await players.setJSON(id, {
      name,
      keys: prev ? prev.keys : [h],
      ...(prev?.pass ? { pass: prev.pass } : {}),
      ...(prev?.google ? { google: prev.google } : {}),
      weeks,
      pen,
      save,
      merged: prev?.merged ?? null, // scores folded in from a duplicate account (admin merge)
      updated: Date.now(),
    });
    return json({ ok: true, save });
  }

  return json({ error: "method_not_allowed" }, 405);
};

export const config = { path: "/api/players" };
