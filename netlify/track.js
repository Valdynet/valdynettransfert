"use strict";
const crypto = require("crypto");
const { db, reply, clientIp, log } = require("./_lib/common");

const REF = /^VT-[A-HJKMNP-Z2-9]{10}$/;

// POST /api/track  { reference }  (public)
// Only safe fields are returned. Malformed, unknown and bad-JSON requests all get the same generic answer.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  const notFound = () => reply(404, { ok: false, error: "NOT_FOUND" });
  try {
    const supa = db();
    const ip = crypto.createHash("sha256").update(clientIp(event)).digest("hex").slice(0, 32);
    const { data: allowed, error: rlError } = await supa.rpc("check_rate_limit", { p_key: "track:" + ip, p_max: 20, p_window_seconds: 600 });
    if (rlError) throw new Error("RATE_LIMIT_UNAVAILABLE");
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    let body;
    try { body = JSON.parse((event.body || "").slice(0, 500)); } catch { return notFound(); }
    const ref = typeof body.reference === "string" ? body.reference.trim().toUpperCase() : "";
    if (!REF.test(ref)) return notFound();

    const { data } = await supa.from("transactions")
      .select("transaction_reference,created_at,updated_at,service_type,sender_amount,sender_currency,status")
      .eq("transaction_reference", ref).maybeSingle();
    if (!data) return notFound();
    return reply(200, {
      ok: true, reference: data.transaction_reference, createdAt: data.created_at, updatedAt: data.updated_at,
      service: data.service_type, amount: data.sender_amount, currency: data.sender_currency, status: data.status,
    });
  } catch (e) {
    log("error", "track unavailable", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
