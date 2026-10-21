// The Red Egg leaderboard: one record per player, unique usernames, no passwords.
import { getStore } from "@netlify/blobs";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
const keyOf = (n) => encodeURIComponent(clean(n).toLowerCase());

export default async (req) => {
  const players = getStore({ name: "players", consistency: "strong" });
  const names = getStore({ name: "names", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const login = url.searchParams.get("login");
    if (login != null) {
      const id = clean(login) && (await names.get(keyOf(login)));
      const p = id && (await players.get(id, { type: "json" }));
      if (!p) return json({ error: "not_found" }, 404);
      return json({ id, name: p.name, save: p.save || null });
    }
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
    const id = String(body.id || "");
    if (!/^[a-z0-9]{6,40}$/i.test(id)) return json({ error: "bad_id" }, 400);
    const name = clean(body.name);
    if (!name) return json({ error: "bad_name" }, 400);

    const key = keyOf(name);
    const owner = await names.get(key);
    if (owner && owner !== id) return json({ error: "taken" }, 409);

    const prev = await players.get(id, { type: "json" });
    if (prev && prev.name && keyOf(prev.name) !== key && (await names.get(keyOf(prev.name))) === id) {
      await names.delete(keyOf(prev.name)); // renaming frees the old username
    }
    if (!owner) await names.set(key, id);

    const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
    await players.setJSON(id, {
      name,
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
