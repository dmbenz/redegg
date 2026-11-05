// The Red Bomb daily leaderboard: each player's run of today's bomb (everyone gets the same bombs).
// The game sends the words it played; the server checks them before a score counts.
import { getStore } from "@netlify/blobs";
import { json, hash, okId, okSecret } from "../lib/util.mjs";

const ZONE_AT = [0, 50, 125, 225, 350, 500, 700, 950, 1250, 1600, 2000, 2500, 3000, 3500, 4000];
// past the Edge of the Universe (4000) a new universe every 500 points, same as the game
const zoneOf = (sc) => { const top = ZONE_AT[ZONE_AT.length - 1]; if (sc >= top) return ZONE_AT.length - 1 + Math.floor((sc - top) / 500); let z = 0; ZONE_AT.forEach((t, i) => { if (sc >= t) z = i; }); return z; };
const pointsOf = (w) => (w.length >= 9 ? 3 : w.length >= 6 ? 2 : 1);
const fuseFor = (n) => Math.max(8, 18 - n * 0.6);

// the same list of bombs the game builds for a day (keep in step with daySeq in bomb.html)
export function daySeq(day, C, salt = "") {
  let h = 2166136261; for (const ch of "bomb|" + day + salt) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } let a = h >>> 0;
  const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const out = [], used = new Set();
  for (let n = 0; n < 80; n++) {
    const x = r(), pool = n < 3 ? C.easy : n < 7 ? (x < .6 ? C.easy : C.medium) : n < 12 ? (x < .65 ? C.medium : C.hard) : (x < .4 ? C.medium : C.hard);
    let c; for (let i = 0; i < 50; i++) { c = pool[Math.floor(r() * pool.length)]; if (!used.has(c)) break; } used.add(c); out.push(c);
  }
  return out;
}
let COMBOS = null;
async function combos(req) {
  if (COMBOS) return COMBOS;
  const r = await fetch(new URL("/bomb-combos.json", req.url));
  if (!r.ok) throw new Error("combos");
  COMBOS = await r.json();
  return COMBOS;
}
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
export function check(log, bonus, dict, seq) {
  if (!Array.isArray(log) || !Array.isArray(bonus) || log.length > 600 || bonus.length > 300) return null;
  const used = new Set();
  let score = 0, bombs = 0, charge = 0, cur = null;
  for (const e of log) {
    const w = String(e && e.w || ""), c = String(e && e.c || "");
    if (!/^[a-z]{4,20}$/.test(w) || !/^[a-z]{3}$/.test(c) || !w.includes(c) || used.has(w) || !dict.has(w)) return null;
    if (seq && c !== seq[bombs]) return null; // today's bombs, in order
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
  let dict, seq; try { dict = await words(req); seq = daySeq(day, await combos(req)); } catch { return json({ error: "off" }, 503); }
  const run = check(body.log, body.bonus, dict, seq);
  if (!run) return json({ error: "bad_run" }, 400);
  const bomb = { ...(p.bomb || {}) }, cur = bomb[day];
  if (cur && cur.d) return json({ ok: true, already: true, best: cur }); // one run of today's bomb: the first one stands
  bomb[day] = { ...run, d: 1, at: Date.now() };
  Object.keys(bomb).sort().slice(0, -3).forEach((k) => delete bomb[k]); // keep the last few days
  await players.setJSON(id, { ...p, bomb });
  return json({ ok: true, best: bomb[day], run });
};

export const config = { path: "/api/bomb" };
