"use strict";
// PayPal REST client. Secrets come ONLY from environment variables.
// PAYPAL_MODE=sandbox (default) | live  — the single switch to go from Sandbox to Live.
const BASES = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };

function cfg() {
  const mode = (process.env.PAYPAL_MODE || "sandbox").toLowerCase();
  if (!BASES[mode]) throw new Error("PAYPAL_MODE_INVALID");
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_NOT_CONFIGURED");
  return { base: BASES[mode], id, secret };
}

let tok = { value: null, exp: 0, base: null };
async function token() {
  const c = cfg();
  if (tok.value && tok.base === c.base && Date.now() < tok.exp - 60000) return tok.value;
  const r = await fetch(c.base + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(c.id + ":" + c.secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("PAYPAL_AUTH_FAILED");
  const j = await r.json();
  tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000, base: c.base };
  return tok.value;
}

async function call(method, path, body, requestId) {
  const r = await fetch(cfg().base + path, {
    method,
    headers: { Authorization: "Bearer " + (await token()), "Content-Type": "application/json", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

const createOrder = ({ amount, currency, referenceId, customId }, requestId) =>
  call("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: referenceId, custom_id: customId, amount: { currency_code: currency, value: amount.toFixed(2) } }],
  }, requestId);
const getOrder = (id) => call("GET", "/v2/checkout/orders/" + encodeURIComponent(id));
// Fixed request id: PayPal itself de-duplicates repeated capture calls for the same order.
const captureOrder = (id) => call("POST", "/v2/checkout/orders/" + encodeURIComponent(id) + "/capture", {}, "capture-" + id);

// Webhook signature check through PayPal's verification API (needs PAYPAL_WEBHOOK_ID).
async function verifyWebhook(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_NOT_CONFIGURED");
  let event;
  try { event = JSON.parse(rawBody); } catch { return false; }
  const h = (k) => headers[k];
  const r = await call("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId, webhook_event: event,
  });
  return r.ok && r.body.verification_status === "SUCCESS";
}

module.exports = { createOrder, getOrder, captureOrder, verifyWebhook };
