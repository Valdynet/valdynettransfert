"use strict";
// Run: node --test tests/payments.test.js   (pure helpers + real paypal.js with a mocked fetch; no network)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
process.env.PAYPAL_CLIENT_ID = "test-id";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
const { validateCapture, validateManual, orderIdOf, EVENT_MAP } = require("../netlify/functions/_lib/payments");
const paypal = require("../netlify/functions/_lib/paypal");

const order = (o = {}) => ({ status: "COMPLETED", purchase_units: [{ custom_id: "tx1",
  payments: { captures: [{ id: "CAP1", status: o.capStatus || "COMPLETED", amount: { value: o.value || "50.00", currency_code: o.cur || "USD" } }] } }], ...(o.top || {}) });
const exp = { amount: 50, currency: "USD", customId: "tx1" };

test("capture: matching amount, currency and owner is accepted", () => {
  const v = validateCapture(order(), exp);
  assert.equal(v.ok, true); assert.equal(v.captureId, "CAP1");
});
test("capture: wrong amount, currency, owner or status is refused", () => {
  assert.equal(validateCapture(order({ value: "49.99" }), exp).error, "AMOUNT_MISMATCH");
  assert.equal(validateCapture(order({ cur: "EUR" }), exp).error, "CURRENCY_MISMATCH");
  assert.equal(validateCapture(order(), { ...exp, customId: "other" }).error, "OWNER_MISMATCH");
  assert.equal(validateCapture(order({ capStatus: "PENDING" }), exp).error, "CAPTURE_PENDING");
  assert.equal(validateCapture(order({ capStatus: "DECLINED" }), exp).error, "CAPTURE_DECLINED");
  assert.equal(validateCapture(order({ top: { status: "APPROVED" } }), exp).error, "NOT_COMPLETED");
});
test("manual payment input validation", () => {
  const good = { providerTransactionId: "MC-12345", paymentReference: "VT ref 1", proofPath: null };
  assert.equal(validateManual(good).ok, true);
  assert.equal(validateManual({ ...good, providerTransactionId: "ab" }).error, "INVALID_TRANSACTION_ID");
  assert.equal(validateManual({ ...good, providerTransactionId: "x'; drop--" }).error, "INVALID_TRANSACTION_ID");
  assert.equal(validateManual({ ...good, paymentReference: "" }).error, "INVALID_PAYMENT_REFERENCE");
  assert.equal(validateManual({ ...good, proofPath: "../../etc/passwd" }).error, "INVALID_PROOF");
  const p = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf";
  assert.equal(validateManual({ ...good, proofPath: p }).proof, p);
});
test("webhook event mapping", () => {
  assert.equal(EVENT_MAP["PAYMENT.CAPTURE.COMPLETED"], "completed");
  assert.equal(EVENT_MAP["PAYMENT.CAPTURE.REFUNDED"], "refunded");
  assert.equal(EVENT_MAP["PAYMENT.CAPTURE.DENIED"], "failed");
  assert.equal(orderIdOf({ id: "C1", supplementary_data: { related_ids: { order_id: "O1" } } }), "O1");
});

const res = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
function mockFetch(next) {
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return url.endsWith("/v1/oauth2/token") ? res({ access_token: "tok", expires_in: 3600 }) : res(next); };
  return calls;
}
test("PayPal client: Sandbox by default, Live only when PAYPAL_MODE=live, invalid mode refused", async () => {
  delete process.env.PAYPAL_MODE;
  let calls = mockFetch({ id: "ORD1" });
  await paypal.createOrder({ amount: 50, currency: "USD", referenceId: "VT-X", customId: "tx1" }, "req-1");
  assert.ok(calls.at(-1).url.startsWith("https://api-m.sandbox.paypal.com/v2/checkout/orders"));
  assert.equal(JSON.parse(calls.at(-1).opts.body).purchase_units[0].amount.value, "50.00");
  assert.equal(calls.at(-1).opts.headers["PayPal-Request-Id"], "req-1");
  process.env.PAYPAL_MODE = "live";
  calls = mockFetch({ id: "ORD2" });
  await paypal.getOrder("ORD2");
  assert.ok(calls.at(-1).url.startsWith("https://api-m.paypal.com/"));
  process.env.PAYPAL_MODE = "prod";
  await assert.rejects(() => paypal.getOrder("X"), /PAYPAL_MODE_INVALID/);
  delete process.env.PAYPAL_MODE;
});
test("PayPal webhook signature verification", async () => {
  const headers = { "paypal-auth-algo": "a", "paypal-cert-url": "https://api.paypal.com/c", "paypal-transmission-id": "t", "paypal-transmission-sig": "s", "paypal-transmission-time": "now" };
  let calls = mockFetch({ verification_status: "SUCCESS" });
  assert.equal(await paypal.verifyWebhook(headers, JSON.stringify({ id: "E1" })), true);
  assert.equal(JSON.parse(calls.at(-1).opts.body).webhook_id, "WH-TEST");
  mockFetch({ verification_status: "FAILURE" });
  assert.equal(await paypal.verifyWebhook(headers, JSON.stringify({ id: "E1" })), false);
  assert.equal(await paypal.verifyWebhook(headers, "not json"), false);
  const keep = process.env.PAYPAL_WEBHOOK_ID; delete process.env.PAYPAL_WEBHOOK_ID;
  await assert.rejects(() => paypal.verifyWebhook(headers, "{}"), /PAYPAL_WEBHOOK_NOT_CONFIGURED/);
  process.env.PAYPAL_WEBHOOK_ID = keep;
});
test("no secret names or keys appear in any file served to the browser", () => {
  const root = path.join(__dirname, "..");
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !["node_modules", ".git", "netlify", "database", "tests"].includes(e.name)) walk(p);
    else if (/\.(html|js|css)$/.test(e.name)) files.push(p);
  });
  walk(root);
  files.forEach((f) => assert.doesNotMatch(fs.readFileSync(f, "utf8"), /PAYPAL_CLIENT_SECRET|SERVICE_ROLE|PAYPAL_WEBHOOK_ID/, f));
});
