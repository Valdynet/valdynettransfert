"use strict";
// Run: node --test tests/payment-handlers.test.js
// Handlers are exercised with an in-memory fake of the database and PayPal (no network, no real money).
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = (n) => require.resolve("../netlify/functions/_lib/" + n);

let st;
const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });
const inject = (name, exports) => { require.cache[lib(name)] = { id: lib(name), filename: lib(name), loaded: true, exports }; };
inject("common", { reply, log() {}, clientIp: () => "1.1.1.1", db: () => st.supa, userFrom: async () => st.user });
inject("paypal", { createOrder: (...a) => st.pp.createOrder(...a), getOrder: (...a) => st.pp.getOrder(...a), captureOrder: (...a) => st.pp.captureOrder(...a), verifyWebhook: (...a) => st.pp.verifyWebhook(...a) });
const H = (n) => require("../netlify/functions/" + n).handler;
const handlers = { capture: H("paypal-capture-order"), create: H("paypal-create-order"), hook: H("paypal-webhook"), manual: H("manual-payment"), admin: H("admin-payments") };

function fakeSupa({ tables = {}, rpc = {}, insertError = null } = {}) {
  const calls = [];
  const q = (t) => { const o = { select: () => o, eq: () => o, order: () => o, range: () => o,
    maybeSingle: async () => ({ data: tables[t] ?? null }), single: async () => ({ data: tables[t] ?? null }),
    insert: async (row) => { calls.push(["insert", t, row]); return { error: insertError }; },
    update: () => ({ eq: () => ({ eq: async () => { calls.push(["update", t]); return {}; } }) }),
    delete: () => ({ eq: () => ({ eq: async () => { calls.push(["delete", t]); return {}; } }) }) }; return o; };
  return { calls, from: q, rpc: async (n, a) => { calls.push(["rpc", n, a]); const r = rpc[n]; return typeof r === "function" ? r(a) : r || { data: true, error: null }; },
    storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { token: "tk" }, error: null }) }) } };
}
const rpcs = (name) => st.supa.calls.filter((c) => c[0] === "rpc" && c[1] === name);
const call = (h, body, headers = {}) => h({ httpMethod: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const REF = "VT-AAAAAAAAAA";
const done = (v = "50.00", cur = "USD", cid = "tx1") => ({ status: "COMPLETED", purchase_units: [{ custom_id: cid, payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { value: v, currency_code: cur } }] } }] });
const payRow = (o = {}) => ({ status: "pending", amount: 50, currency: "USD", transaction_id: "tx1", transactions: { transaction_reference: REF, customers: { profile_id: "u1" } }, ...o });
const user = { id: "u1", email_confirmed_at: "2026-01-01" };
const ok = (b) => JSON.parse(b.body);

// ---- PayPal capture ----
test("PayPal success: payment recorded only after PayPal's answer matches the database", async () => {
  st = { user, supa: fakeSupa({ tables: { payments: payRow() } }), pp: { captureOrder: async () => ({ ok: true, body: done() }) } };
  const r = await call(handlers.capture, { orderId: "ORDER12345" });
  assert.equal(r.statusCode, 200);
  assert.equal(rpcs("complete_paypal_payment")[0][2].p_amount, 50);
});
test("PayPal amount mismatch: not recorded", async () => {
  st = { user, supa: fakeSupa({ tables: { payments: payRow() } }), pp: { captureOrder: async () => ({ ok: true, body: done("1.00") }) } };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 409);
  assert.equal(rpcs("complete_paypal_payment").length, 0);
});
test("PayPal payment failed (declined): not recorded", async () => {
  st = { user, supa: fakeSupa({ tables: { payments: payRow() } }), pp: { captureOrder: async () => ({ ok: false, status: 422, body: { details: [{ issue: "INSTRUMENT_DECLINED" }] } }) } };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 502);
  assert.equal(rpcs("complete_paypal_payment").length, 0);
});
test("PayPal pending capture: accepted as pending, not completed", async () => {
  const o = done(); o.purchase_units[0].payments.captures[0].status = "PENDING";
  st = { user, supa: fakeSupa({ tables: { payments: payRow() } }), pp: { captureOrder: async () => ({ ok: true, body: o }) } };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 202);
  assert.equal(rpcs("complete_paypal_payment").length, 0);
});
test("PayPal double capture: second call does not capture again", async () => {
  let n = 0;
  st = { user, supa: fakeSupa({ tables: { payments: payRow({ status: "completed" }) } }), pp: { captureOrder: async () => { n++; return { ok: true, body: done() }; } } };
  const r = await call(handlers.capture, { orderId: "ORDER12345" });
  assert.equal(ok(r).already, true); assert.equal(n, 0);
});
test("PayPal ORDER_ALREADY_CAPTURED is re-verified through getOrder", async () => {
  st = { user, supa: fakeSupa({ tables: { payments: payRow() } }), pp: {
    captureOrder: async () => ({ ok: false, status: 422, body: { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } }), getOrder: async () => ({ ok: true, body: done() }) } };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 200);
  assert.equal(rpcs("complete_paypal_payment").length, 1);
});
test("another customer's order cannot be captured", async () => {
  let n = 0;
  st = { user, supa: fakeSupa({ tables: { payments: payRow({ transactions: { transaction_reference: REF, customers: { profile_id: "someone-else" } } }) } }), pp: { captureOrder: async () => { n++; return { ok: true, body: done() }; } } };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 404); assert.equal(n, 0);
});
test("capture without login is refused", async () => {
  st = { user: null, supa: fakeSupa(), pp: {} };
  assert.equal((await call(handlers.capture, { orderId: "ORDER12345" })).statusCode, 401);
});

// ---- PayPal create order ----
test("create order uses the amount stored in the database, ignoring the browser", async () => {
  let sent;
  st = { user, supa: fakeSupa({ tables: { transactions: { id: "tx1", transaction_reference: REF, status: "pending", payment_method: "paypal", total_amount: 55, sender_currency: "USD" } } }),
    pp: { createOrder: async (a) => { sent = a; return { ok: true, body: { id: "ORD1234567890" } }; } } };
  const r = await call(handlers.create, { reference: REF, amount: 1 });
  assert.equal(r.statusCode, 200); assert.equal(sent.amount, 55); assert.equal(sent.customId, "tx1");
});
test("create order refused for non-PayPal or someone else's transaction", async () => {
  st = { user, supa: fakeSupa({ tables: { transactions: { id: "tx1", status: "pending", payment_method: "wise", total_amount: 55, sender_currency: "USD" } } }), pp: {} };
  assert.equal((await call(handlers.create, { reference: REF })).statusCode, 409);
  st = { user, supa: fakeSupa(), pp: {} };
  assert.equal((await call(handlers.create, { reference: REF })).statusCode, 404);
});

// ---- PayPal webhook ----
const evt = (type, extra = {}) => JSON.stringify({ id: "EV-" + type, event_type: type, resource: { id: "CAP1", amount: { value: "50.00", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "ORDER12345" } }, ...extra } });
test("webhook with invalid signature is rejected before anything is stored", async () => {
  st = { supa: fakeSupa(), pp: { verifyWebhook: async () => false } };
  assert.equal((await call(handlers.hook, evt("PAYMENT.CAPTURE.COMPLETED"))).statusCode, 400);
  assert.equal(st.supa.calls.length, 0);
});
test("webhook COMPLETED / REFUNDED / DENIED update the payment", async () => {
  st = { supa: fakeSupa(), pp: { verifyWebhook: async () => true } };
  assert.equal((await call(handlers.hook, evt("PAYMENT.CAPTURE.COMPLETED"))).statusCode, 200);
  assert.equal(rpcs("complete_paypal_payment")[0][2].p_order, "ORDER12345");
  await call(handlers.hook, evt("PAYMENT.CAPTURE.REFUNDED"));
  await call(handlers.hook, evt("PAYMENT.CAPTURE.DENIED"));
  assert.deepEqual(rpcs("mark_paypal_payment").map((c) => c[2].p_status), ["refunded", "failed"]);
});
test("duplicate webhook event is acknowledged without reprocessing", async () => {
  st = { supa: fakeSupa({ insertError: { code: "23505" } }), pp: { verifyWebhook: async () => true } };
  const r = await call(handlers.hook, evt("PAYMENT.CAPTURE.COMPLETED"));
  assert.equal(ok(r).duplicate, true); assert.equal(rpcs("complete_paypal_payment").length, 0);
});
test("webhook processing error frees the event so PayPal's retry is processed", async () => {
  st = { supa: fakeSupa({ rpc: { complete_paypal_payment: { error: { message: "boom" } } } }), pp: { verifyWebhook: async () => true } };
  assert.equal((await call(handlers.hook, evt("PAYMENT.CAPTURE.COMPLETED"))).statusCode, 500);
  assert.ok(st.supa.calls.some((c) => c[0] === "delete"));
});
test("webhook amount mismatch is logged, not retried forever", async () => {
  st = { supa: fakeSupa({ rpc: { complete_paypal_payment: { error: { message: "AMOUNT_MISMATCH" } } } }), pp: { verifyWebhook: async () => true } };
  assert.equal((await call(handlers.hook, evt("PAYMENT.CAPTURE.COMPLETED"))).statusCode, 200);
});

// ---- manual payments ----
const manualTx = { id: "11111111-1111-4111-8111-111111111111", status: "pending", payment_method: "moncash", total_amount: 7700, sender_currency: "HTG" };
const sub = { action: "submit", reference: REF, providerTransactionId: "MC-998877", paymentReference: "VT ref" };
test("manual payment submission stays pending verification (never auto-paid)", async () => {
  st = { user, supa: fakeSupa({ tables: { transactions: manualTx } }) };
  const r = await call(handlers.manual, sub);
  assert.equal(ok(r).status, "pending_verification");
  assert.equal(rpcs("submit_manual_payment").length, 1); assert.equal(rpcs("admin_review_payment").length, 0);
});
test("manual payment: reference already used is refused", async () => {
  st = { user, supa: fakeSupa({ tables: { transactions: manualTx }, rpc: { submit_manual_payment: { error: { message: "REFERENCE_ALREADY_USED" } } } }) };
  const r = await call(handlers.manual, sub);
  assert.equal(r.statusCode, 409); assert.equal(ok(r).error, "REFERENCE_ALREADY_USED");
});
test("manual payment: another customer's transaction and bad input are refused", async () => {
  st = { user, supa: fakeSupa() };
  assert.equal((await call(handlers.manual, sub)).statusCode, 404);
  st = { user, supa: fakeSupa({ tables: { transactions: manualTx } }) };
  assert.equal((await call(handlers.manual, { ...sub, providerTransactionId: "x" })).statusCode, 422);
  assert.equal((await call(handlers.manual, { action: "upload_url", reference: REF, contentType: "text/html" })).statusCode, 422);
});

// ---- admin ----
test("customer without admin role cannot use the payments API", async () => {
  st = { user, supa: fakeSupa({ tables: { profiles: { role: "customer" } } }) };
  assert.equal((await call(handlers.admin, { action: "payments" })).statusCode, 403);
  st = { user: null, supa: fakeSupa() };
  assert.equal((await call(handlers.admin, { action: "payments" })).statusCode, 401);
});
test("admin approves and rejects; a rejection needs a note (enforced in the database)", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  st = { user, supa: fakeSupa({ tables: { profiles: { role: "admin" } } }) };
  assert.equal((await call(handlers.admin, { action: "review", id, approve: true })).statusCode, 200);
  assert.equal(rpcs("admin_review_payment")[0][2].p_actor, "u1");
  st = { user, supa: fakeSupa({ tables: { profiles: { role: "admin" } }, rpc: { admin_review_payment: { error: { message: "NOTE_REQUIRED" } } } }) };
  assert.equal((await call(handlers.admin, { action: "review", id, approve: false })).statusCode, 422);
});
