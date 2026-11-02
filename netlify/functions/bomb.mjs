// The Red Bomb daily leaderboard: a player's best run each day.
// The game sends the words it played; the server checks them before a score counts.
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const ZONE_AT = [0, 50, 125, 225, 350, 500, 700, 950, 1250, 1600, 2000, 2500];
const zoneOf = (sc) => { let z = 0; ZONE_AT.forEach((t, i) => { if (sc >= t) z = i; }); return z; };
const pointsOf = (w) => (w.length >= 9 ? 3 : w.length >= 6 ? 2 : 1);
const fuseFor = (n) => Math.max(8, 18 - n * 0.6);

let WORDS = null;
async function words(req) {
  if (WORDS) return WORDS;
  const r = await fetch(new URL("/bomb-words.txt", req.url));
  if (!r.ok) throw new Error("words");
  WORDS = new Set((await r.text()).split("\n"));
  return WORDS;
}
// the day must be the player's today (any time zone): within a day of the server's date
const okDay = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  const t = Date.parse(d + "T12:00:00Z");
  return Math.abs(t - Date.now()) < 40 * 3600 * 1000;
};

/* replay the run: every word real, used once, holding its bomb's letters; points within what the game can give */
export function check(log, bonus, dict) {
  if (!Array.isArray(log) || !Array.isArray(bonus) || log.length > 600 || bonus.length > 300) return null;
  const used = new Set();
  let score = 0, bombs = 0, charge = 0, cur = null;
  for (const e of log) {
    const w = String(e && e.w || ""), c = String(e && e.c || "");
    if (!/^[a-z]{4,20}$/.test(w) || !/^[a-z]{3}$/.test(c) || !w.includes(c) || used.has(w) || !dict.has(w)) return null;
    if (cur !== null && c !== cur) { if (charge < 3) return null; } // a new bomb only after the last one was defused
    if (c !== cur) { cur = c; charge = 0; }
    used.add(w);
    const p = pointsOf(w), max = w.length * p * 2;
    score += Math.max(0, Math.min(+e.pts || 0, max));
    charge += p;
    if (charge >= 3) {
      const b = bonus[bombs];
      score += Math.max(0, Math.min(+b || 0, 10 + Math.round(fuseFor(bombs) * 2) * 2));
      bombs++; cur = null; charge = 0;
    }
  }
  return { score: Math.round(score), bombs, zone: zoneOf(score) };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  if (raw.length > 120000) return json({ error: "too_big" }, 413);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
  const { id, secret, day } = body;
  if (!okId(id) || !okSecret(secret)) return json({ error: "signin" }, 400);
  if (!okDay(day)) return json({ error: "bad_day" }, 400);
  const players = getStore({ name: "players", consistency: "strong" });
  const p = await players.get(id, { type: "json" });
  if (!p || !p.name) return json({ error: "signin" }, 403);
  if (!(p.keys || []).includes(hash(secret))) return json({ error: "not_yours" }, 403);
  let dict; try { dict = await words(req); } catch { return json({ error: "off" }, 503); }
  const run = check(body.log, body.bonus, dict);
  if (!run) return json({ error: "bad_run" }, 400);
  const bomb = { ...(p.bomb || {}) }, cur = bomb[day];
  if (!cur || run.score > cur.score) bomb[day] = { ...run, at: Date.now() };
  Object.keys(bomb).sort().slice(0, -3).forEach((k) => delete bomb[k]); // keep the last few days
  await players.setJSON(id, { ...p, bomb });
  return json({ ok: true, best: bomb[day], run });
};

export const config = { path: "/api/bomb" };
