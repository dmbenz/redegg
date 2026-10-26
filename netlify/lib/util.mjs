// Shared helpers for the Red Egg functions.
import { createHash } from "node:crypto";

export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const hash = (s) => createHash("sha256").update(String(s)).digest("hex");
export const okId = (id) => /^[a-z0-9]{6,40}$/i.test(String(id || ""));
export const okSecret = (s) => /^[a-z0-9]{24,64}$/i.test(String(s || ""));

// Fold a merged duplicate's weeks and chicks into a player's own (their own scores win on any day both played).
export const combine = (own, extra) => {
  if (!extra) return own;
  const weeks = { ...(extra.weeks || {}) };
  for (const [wk, w] of Object.entries(own.weeks || {})) {
    const x = weeks[wk] || {};
    const days = { ...(x.days || {}), ...(w.days || {}) };
    const sun = w.sun ?? x.sun ?? null, chick = w.chick ?? x.chick ?? null;
    const sum = Object.values(days).reduce((a, v) => a + (+v || 0), 0) + (+sun || 0);
    weeks[wk] = { days, sun, chick, total: chick ? (w.chick ? w.total : x.total) ?? Math.round(sum) : Math.round(sum) };
  }
  const pen = { ...(extra.pen || {}) };
  for (const [k, n] of Object.entries(own.pen || {})) pen[k] = (+pen[k] || 0) + (+n || 0);
  return { weeks, pen };
};

// Two devices, one player: combine what each knows instead of letting the last one to sync win.
// The first score saved for a day stays (so playing a day twice on two devices can't raise it).
export const mergeWeeks = (prev = {}, next = {}) => {
  const out = { ...prev };
  for (const [wk, n] of Object.entries(next || {})) {
    const p = out[wk];
    if (!p) { out[wk] = n; continue; }
    const days = { ...(n.days || {}), ...(p.days || {}) };
    // Sunday adds up round by round, so the bigger running total is the newer one
    const sun = p.sun != null && n.sun != null ? Math.max(+p.sun, +n.sun) : p.sun ?? n.sun ?? null, chick = p.chick ?? n.chick ?? null;
    const sum = Object.values(days).reduce((a, v) => a + (+v || 0), 0) + (+sun || 0);
    out[wk] = { days, sun, chick, total: chick ? ((p.chick ? p.total : n.total) ?? Math.round(sum)) : Math.round(sum) };
  }
  const keep = Object.keys(out).sort().slice(-4), res = {};
  keep.forEach((k) => (res[k] = out[k]));
  return res;
};
export const mergeSave = (p, n) => {
  if (!p) return n || null;
  if (!n) return p;
  let week = n.week || p.week;
  if (p.week && n.week) {
    if (p.week.id === n.week.id) week = { ...n.week, days: { ...(n.week.days || {}), ...(p.week.days || {}) }, sunday: { ...(n.week.sunday || {}), ...(p.week.sunday || {}) }, hatched: !!(p.week.hatched || n.week.hatched) };
    else week = p.week.id > n.week.id ? p.week : n.week;
  }
  const pen = [...(p.pen || [])];
  (n.pen || []).forEach((x) => { if (x && x.id && !pen.some((y) => y.id === x.id)) pen.push(x); });
  pen.sort((a, b) => (a.id < b.id ? -1 : 1));
  const seen = new Set((p.history || []).map((x) => x.game + "|" + x.at));
  const history = [...(p.history || []), ...(n.history || []).filter((x) => x && !seen.has(x.game + "|" + x.at))].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-500);
  const playDays = [...new Set([...(p.playDays || []), ...(n.playDays || [])])].sort().slice(-400);
  return { week, pen, history, playDays, weeks: mergeWeeks(p.weeks, n.weeks) };
};
export const penCounts = (pen) => { const c = {}; (pen || []).forEach((x) => { if (x && x.key) c[x.key] = (c[x.key] || 0) + 1; }); return c; };
