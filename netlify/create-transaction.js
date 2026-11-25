"use strict";
const { calculate } = require("./_lib/finance");
const { getConfig } = require("./_lib/settings");
const { db, reply, userFrom, log } = require("./_lib/common");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// POST /api/create-transaction  (Authorization: Bearer <Supabase access token>)
// Header-token auth, so CSRF does not apply. Amounts and fees are recomputed here; the browser's are ignored.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 4000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const user = await userFrom(event);
    if (!user) return reply(401, { ok: false, error: "UNAUTHENTICATED" });
    if (!user.email_confirmed_at) return reply(403, { ok: false, error: "EMAIL_NOT_VERIFIED" });

    let b;
    try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }

    const supa = db();
    const { data: allowed } = await supa.rpc("check_rate_limit", { p_key: "tx:" + user.id, p_max: 10, p_window_seconds: 60 });
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    const recipientName = clean(b.recipientName, 120);
    const recipientContact = clean(b.recipientContact, 120);
    const notes = clean(b.notes, 500);
    if (b.confirmed !== true || !UUID.test(String(b.idempotencyKey)) || !recipientName || !recipientContact) {
      return reply(422, { ok: false, error: "INVALID_REQUEST" });
    }

    const calc = calculate({ service: b.service, method: b.method, amount: b.amount }, await getConfig());
    if (!calc.ok) return reply(422, calc);

    const { data, error } = await supa.rpc("create_transaction", {
      p_profile_id: user.id, p_idem: b.idempotencyKey, p_calc: calc,
      p_recipient_name: recipientName, p_recipient_contact: recipientContact, p_notes: notes || null,
    });
    if (error) {
      log("error", "create_transaction failed", { code: error.code, user: user.id });
      const unavailable = String(error.message).includes("CUSTOMER_UNAVAILABLE");
      return reply(unavailable ? 403 : 500, { ok: false, error: unavailable ? "ACCOUNT_UNAVAILABLE" : "SERVER_ERROR" });
    }
    const row = data[0];
    return reply(200, { ok: true, reference: row.out_reference, status: row.out_status, created: row.out_created, summary: calc });
  } catch (e) {
    log("error", "create-transaction crashed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
