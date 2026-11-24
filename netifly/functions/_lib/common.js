"use strict";
const { createClient } = require("@supabase/supabase-js");

let admin;
// Service-role client: server only. Bypasses RLS, so every function must authorize explicitly.
function db() {
  if (!admin) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("NOT_CONFIGURED");
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const clientIp = (e) =>
  (e.headers["x-nf-client-connection-ip"] || (e.headers["x-forwarded-for"] || "").split(",")[0] || "unknown").trim();

// Bearer token => verified user (checked with the Supabase Auth server).
async function userFrom(event) {
  const h = event.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data.user;
}

// Structured logs; never pass secrets, tokens or full personal data.
const log = (level, msg, extra = {}) => console[level](JSON.stringify({ msg, ...extra }));

module.exports = { db, reply, clientIp, userFrom, log };
