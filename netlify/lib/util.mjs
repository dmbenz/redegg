// Shared helpers for the Red Egg functions.
import { createHash } from "node:crypto";

export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const hash = (s) => createHash("sha256").update(String(s)).digest("hex");
export const okId = (id) => /^[a-z0-9]{6,40}$/i.test(String(id || ""));
export const okSecret = (s) => /^[a-z0-9]{24,64}$/i.test(String(s || ""));
