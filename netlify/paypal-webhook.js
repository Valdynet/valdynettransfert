"use strict";
const { db, reply, log } = require("./_lib/common");
const paypal = require("./_lib/paypal");
const { EVENT_MAP, orderIdOf } = require("./_lib/payments");

// POST /api/paypal-webhook — signature verified with PayPal before anything is read or stored.
// Register this URL (https://YOUR-SITE/api/paypal-webhook) in the PayPal developer dashboard.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  if (raw.length > 200000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  let supa, eventId = null;
  try {
    if (!(await paypal.verifyWebhook(event.headers, raw))) { log("warn", "paypal webhook signature rejected"); return reply(400, { ok: false, error: "INVALID_SIGNATURE" }); }
    const ev = JSON.parse(raw);
    supa = db();
    const ins = await supa.from("webhook_events").insert({ provider: "paypal", event_id: ev.id, event_type: ev.event_type, payload: ev });
    if (ins.error) {
      if (ins.error.code === "23505") return reply(200, { ok: true, duplicate: true }); // already processed
      throw ins.error;
    }
    eventId = ev.id;

    const kind = EVENT_MAP[ev.event_type];
    const r = ev.resource || {};
    const orderId = orderIdOf(r);
    let status = "ignored";
    if (kind && orderId && kind !== "pending") {
      if (kind === "completed") {
        const { error } = await supa.rpc("complete_paypal_payment", { p_order: orderId, p_capture: r.id, p_amount: Number(r.amount && r.amount.value), p_currency: r.amount && r.amount.currency_code });
        if (error && String(error.message).includes("AMOUNT_MISMATCH")) { status = "amount_mismatch"; log("error", "webhook amount mismatch", { orderId }); }
        else if (error && String(error.message).includes("PAYMENT_NOT_FOUND")) status = "unknown_order";
        else if (error) throw error;
        else status = "processed";
      } else {
        const { error } = await supa.rpc("mark_paypal_payment", { p_order: orderId, p_status: kind, p_note: ev.event_type });
        if (error) throw error;
        status = "processed";
      }
    }
    await supa.from("webhook_events").update({ status }).eq("provider", "paypal").eq("event_id", ev.id);
    return reply(200, { ok: true });
  } catch (e) {
    log("error", "paypal webhook failed", { message: e.message });
    // Let PayPal retry: free the event id so the retry is processed instead of treated as a duplicate.
    if (supa && eventId) await supa.from("webhook_events").delete().eq("provider", "paypal").eq("event_id", eventId);
    return reply(500, { ok: false, error: "PROCESSING_FAILED" });
  }
};
