"use strict";
const crypto = require("crypto");
const { db, reply, userFrom, log } = require("./_lib/common");
const paypal = require("./_lib/paypal");
const { ownTransaction } = require("./_lib/payments");

// POST /api/paypal-create-order { reference } — amount and currency come from the database, never from the browser.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 1000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const user = await userFrom(event);
    if (!user) return reply(401, { ok: false, error: "UNAUTHENTICATED" });
    if (!user.email_confirmed_at) return reply(403, { ok: false, error: "EMAIL_NOT_VERIFIED" });
    const supa = db();
    const { data: allowed } = await supa.rpc("check_rate_limit", { p_key: "pp:" + user.id, p_max: 20, p_window_seconds: 60 });
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }
    const tx = await ownTransaction(supa, user.id, b.reference);
    if (!tx) return reply(404, { ok: false, error: "NOT_FOUND" });
    if (tx.payment_method !== "paypal" || tx.status !== "pending" || tx.sender_currency !== "USD") return reply(409, { ok: false, error: "NOT_PAYABLE" });

    // Reuse a still-valid pending order instead of creating a second one.
    const { data: pend } = await supa.from("payments").select("provider_order_id")
      .eq("transaction_id", tx.id).eq("provider", "paypal").eq("status", "pending").maybeSingle();
    if (pend) {
      const o = await paypal.getOrder(pend.provider_order_id);
      if (o.ok && ["CREATED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(o.body.status)) return reply(200, { ok: true, orderId: pend.provider_order_id });
      await supa.rpc("mark_paypal_payment", { p_order: pend.provider_order_id, p_status: "cancelled", p_note: "stale order replaced" });
    }

    const o = await paypal.createOrder({ amount: Number(tx.total_amount), currency: "USD", referenceId: tx.transaction_reference, customId: tx.id }, crypto.randomUUID());
    if (!o.ok || !o.body.id) { log("error", "paypal create order failed", { status: o.status }); return reply(502, { ok: false, error: "PAYPAL_ERROR" }); }
    const { error } = await supa.rpc("record_paypal_order", { p_tx: tx.id, p_order: o.body.id });
    if (error) {
      const active = String(error.message).includes("PAYMENT_ALREADY_ACTIVE");
      return reply(active ? 409 : 500, { ok: false, error: active ? "PAYMENT_ALREADY_ACTIVE" : "SERVER_ERROR" });
    }
    return reply(200, { ok: true, orderId: o.body.id });
  } catch (e) {
    log("error", "paypal-create-order crashed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
