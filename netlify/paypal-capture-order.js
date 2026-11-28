"use strict";
const { db, reply, userFrom, log } = require("./_lib/common");
const paypal = require("./_lib/paypal");
const { validateCapture } = require("./_lib/payments");

// POST /api/paypal-capture-order { orderId }
// The payment is only recorded after PayPal's own answer matches the amount, currency and owner stored in the database.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 1000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const user = await userFrom(event);
    if (!user) return reply(401, { ok: false, error: "UNAUTHENTICATED" });
    const supa = db();
    const { data: allowed } = await supa.rpc("check_rate_limit", { p_key: "pp:" + user.id, p_max: 20, p_window_seconds: 60 });
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }
    const orderId = typeof b.orderId === "string" && /^[A-Za-z0-9]{10,40}$/.test(b.orderId) ? b.orderId : null;
    if (!orderId) return reply(422, { ok: false, error: "INVALID_REQUEST" });

    const { data: pay } = await supa.from("payments")
      .select("status,amount,currency,transaction_id,transactions!inner(transaction_reference,customers!inner(profile_id))")
      .eq("provider", "paypal").eq("provider_order_id", orderId).maybeSingle();
    if (!pay || pay.transactions.customers.profile_id !== user.id) return reply(404, { ok: false, error: "NOT_FOUND" });
    const reference = pay.transactions.transaction_reference;
    if (pay.status === "completed") return reply(200, { ok: true, already: true, reference });

    let order;
    const cap = await paypal.captureOrder(orderId);
    if (cap.ok) order = cap.body;
    else if (JSON.stringify(cap.body.details || []).includes("ORDER_ALREADY_CAPTURED")) {
      const g = await paypal.getOrder(orderId);
      if (!g.ok) return reply(502, { ok: false, error: "PAYPAL_ERROR" });
      order = g.body;
    } else {
      log("error", "paypal capture failed", { status: cap.status, orderId });
      return reply(502, { ok: false, error: "CAPTURE_FAILED" });
    }

    const v = validateCapture(order, { amount: Number(pay.amount), currency: pay.currency, customId: pay.transaction_id });
    if (!v.ok) {
      log("error", "paypal verification failed", { orderId, reason: v.error });
      if (v.error === "CAPTURE_PENDING") return reply(202, { ok: true, pending: true, reference });
      return reply(409, { ok: false, error: "VERIFICATION_FAILED" });
    }
    const { error } = await supa.rpc("complete_paypal_payment", { p_order: orderId, p_capture: v.captureId, p_amount: v.amount, p_currency: v.currency });
    if (error) { log("error", "complete_paypal_payment failed", { orderId, code: error.code }); return reply(500, { ok: false, error: "SERVER_ERROR" }); }
    return reply(200, { ok: true, reference });
  } catch (e) {
    log("error", "paypal-capture-order crashed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
