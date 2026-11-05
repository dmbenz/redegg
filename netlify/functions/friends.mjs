// Friends: everyone has an invite code; using someone's code makes you friends with each other.
// The board a player sees: themselves, their friends, and everyone's scores without names (for "where you stand").
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret, boardDist, publicOf } from "../lib/util.mjs";

const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
const newCode = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return [...a].map((x) => ABC[x % ABC.length]).join(""); };
const MAX_FRIENDS = 300;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const players = getStore({ name: "players", consistency: "strong" });
  const codes = getStore({ name: "codes", consistency: "strong" });
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const { id, secret, action } = body || {};
  if (!okId(id) || !okSecret(secret)) return json({ error: "bad_id" }, 400);
  const me = await players.get(id, { type: "json" });
  if (!me || !(me.keys || []).includes(hash(secret))) return json({ error: "signin" }, 403);

  const myCode = async () => {
    if (me.code && (await codes.get(me.code)) === id) return me.code;
    let c = newCode();
    for (let i = 0; i < 6 && (await codes.get(c)); i++) c = newCode();
    await codes.set(c, id);
    me.code = c;
    await players.setJSON(id, me);
    return c;
  };

  if (action === "me") return json({ me: publicOf(id, me) });

  if (action === "board") {
    const { blobs } = await players.list();
    const all = (await Promise.all(blobs.map((b) => players.get(b.key, { type: "json" }).then((p) => (p ? { id: b.key, ...p } : null))))).filter((p) => p && p.name);
    const mine = new Set(me.friends || []);
    return json({
      code: await myCode(),
      me: publicOf(id, me),
      friends: all.filter((p) => p.id !== id && mine.has(p.id)).map((p) => publicOf(p.id, p)),
      dist: boardDist(all),
    });
  }

  if (action === "code") return json({ code: await myCode() });

  if (action === "add") {
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^EGG/, "");
    const other = code.length === 6 ? await codes.get(code) : null;
    if (!other) return json({ error: "no_code" }, 404);
    if (other === id) return json({ error: "self" }, 400);
    const them = await players.get(other, { type: "json" });
    if (!them || !them.name) return json({ error: "no_code" }, 404);
    const add = (p, x) => { p.friends = [...new Set([...(p.friends || []), x])].slice(-MAX_FRIENDS); };
    add(me, other); add(them, id);
    await players.setJSON(id, me); await players.setJSON(other, them);
    return json({ ok: true, friend: publicOf(other, them) });
  }

  if (action === "remove") {
    const other = String(body.friend || "");
    me.friends = (me.friends || []).filter((x) => x !== other);
    await players.setJSON(id, me);
    const them = okId(other) ? await players.get(other, { type: "json" }) : null;
    if (them) { them.friends = (them.friends || []).filter((x) => x !== id); await players.setJSON(other, them); }
    return json({ ok: true });
  }

  return json({ error: "bad_action" }, 400);
};

export const config = { path: "/api/friends" };
