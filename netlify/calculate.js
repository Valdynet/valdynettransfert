"use strict";
const { calculate } = require("./_lib/finance");
const { getConfig } = require("./_lib/settings");
const { reply, log } = require("./_lib/common");

// POST /api/calculate  { service, method, amount }  (public, read-only, no data stored)
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 2000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { ok: false, error: "INVALID_JSON" });
  }
  try {
    const result = calculate({ service: body.service, method: body.method, amount: body.amount }, await getConfig());
    return reply(result.ok ? 200 : 422, result);
  } catch (e) {
    log("error", "calculate unavailable", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
