"use strict";
const { calculate } = require("./_lib/finance");

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

// POST /api/calculate  { service, method, amount }
// Phase 1 uses DEFAULT_CONFIG; Phase 4 loads financial_settings from Supabase here.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 2000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { ok: false, error: "INVALID_JSON" });
  }
  const result = calculate({ service: body.service, method: body.method, amount: body.amount });
  return reply(result.ok ? 200 : 422, result);
};
