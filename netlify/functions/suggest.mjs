// Suggest a puzzle: a signed-in player sends an idea (a Clutch category, an Egghead question, a Pecking Order set...).
// Ideas are kept for the admin to read; nobody else sees them. A few per player per day.
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const KINDS = ["clutch", "egghead", "pecking", "other"];
const PER_DAY = 5;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { id, secret, kind, text } = body || {};
  if (!okId(id) || !okSecret(secret)) return json({ error: "bad_id" }, 400);
  const players = getStore({ name: "players", consistency: "strong" });
  const me = await players.get(id, { type: "json" });
  if (!me || !(me.keys || []).includes(hash(secret))) return json({ error: "signin" }, 403);
  const k = KINDS.includes(kind) ? kind : "other";
  const t = String(text || "").replace(/\s+\n/g, "\n").trim().slice(0, 600);
  if (t.length < 3) return json({ error: "empty" }, 400);
  const day = new Date().toISOString().slice(0, 10);
  const used = me.sugg && me.sugg.day === day ? me.sugg.n : 0;
  if (used >= PER_DAY) return json({ error: "limit" }, 429);
  me.sugg = { day, n: used + 1 };
  await players.setJSON(id, me);
  const box = getStore({ name: "suggestions", consistency: "strong" });
  const key = `${Date.now()}-${id}`;
  await box.setJSON(key, { id, name: me.name || "", kind: k, text: t, at: Date.now() });
  return json({ ok: true });
};

export const config = { path: "/api/suggest" };
