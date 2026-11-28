"use strict";
// Run: node --test tests/core-handlers.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { st, fakeSupa, call, rpcs, handler } = require("./helpers/fakes");
const body = (r) => JSON.parse(r.body);
const user = { id: "u1", email_confirmed_at: "2026-01-01" };

// ---- public tracking ----
const track = handler("track");
test("tracking: malformed and unknown references get the same generic answer", async () => {
  st.supa = fakeSupa();
  const a = await call(track, { reference: "hello" }), b = await call(track, { reference: "VT-AAAAAAAAAA" });
  assert.equal(a.statusCode, 404); assert.deepEqual(body(a), body(b));
});
test("tracking returns only safe fields", async () => {
  st.supa = fakeSupa({ tables: { transactions: { transaction_reference: "VT-AAAAAAAAAA", created_at: "d", updated_at: "d", service_type: "deposit",
    sender_amount: 50, sender_currency: "USD", status: "pending", recipient_name: "SECRET", recipient_contact: "SECRET", notes: "SECRET", customer_id: "c" } } });
  const r = body(await call(track, { reference: "vt-aaaaaaaaaa" }));
  assert.deepEqual(Object.keys(r).sort(), ["amount", "createdAt", "currency", "ok", "reference", "service", "status", "updatedAt"]);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});
test("tracking is rate limited", async () => {
  st.supa = fakeSupa({ rpc: { check_rate_limit: { data: false, error: null } } });
  assert.equal((await call(track, { reference: "VT-AAAAAAAAAA" })).statusCode, 429);
});

// ---- transaction creation: the server decides every number ----
const create = handler("create-transaction");
const valid = { service: "deposit", method: "paypal", amount: 50, recipientName: "Jean", recipientContact: "+50900000000", confirmed: true, idempotencyKey: "11111111-1111-4111-8111-111111111111" };
const created = { create_transaction: { data: [{ out_reference: "VT-AAAAAAAAAA", out_status: "pending", out_created: true }], error: null } };
test("create: login and verified e-mail are required", async () => {
  st.user = null; st.supa = fakeSupa();
  assert.equal((await call(create, valid)).statusCode, 401);
  st.user = { id: "u1", email_confirmed_at: null };
  assert.equal((await call(create, valid)).statusCode, 403);
});
test("create: fees and totals sent by the browser are ignored", async () => {
  st.user = user; st.supa = fakeSupa({ rpc: created });
  const r = await call(create, { ...valid, serviceFee: 0, totalAmount: 1, exchangeRate: 999 });
  assert.equal(r.statusCode, 200);
  const calc = rpcs("create_transaction")[0][2].p_calc;
  assert.equal(calc.serviceFee, 5); assert.equal(calc.totalAmount, 55); assert.equal(calc.exchangeRate, 140);
});
test("create: below minimum, unconfirmed or without idempotency key is refused", async () => {
  st.user = user; st.supa = fakeSupa({ rpc: created });
  assert.equal((await call(create, { ...valid, amount: 5 })).statusCode, 422);
  assert.equal((await call(create, { ...valid, confirmed: false })).statusCode, 422);
  assert.equal((await call(create, { ...valid, idempotencyKey: "x" })).statusCode, 422);
  assert.equal(rpcs("create_transaction").length, 0);
});

// ---- admin API ----
const admin = handler("admin");
test("admin API: anonymous 401, customer 403, invalid transition 409", async () => {
  st.user = null; st.supa = fakeSupa();
  assert.equal((await call(admin, { action: "overview" })).statusCode, 401);
  st.user = user; st.supa = fakeSupa({ tables: { profiles: { role: "customer" } } });
  assert.equal((await call(admin, { action: "overview" })).statusCode, 403);
  st.supa = fakeSupa({ tables: { profiles: { role: "admin" } }, rpc: { admin_change_status: { error: { message: "TRANSITION_NOT_ALLOWED" } } } });
  assert.equal((await call(admin, { action: "status_update", id: "11111111-1111-4111-8111-111111111111", status: "completed" })).statusCode, 409);
});

// ---- e-mail dispatch ----
const dispatch = handler("send-notifications");
const row = { out_id: "n1", out_email: "a@b.co", out_title: "Titre", out_message: "<script>alert(1)</script>" };
test("e-mail: nothing is sent while no provider is configured", async () => {
  delete process.env.EMAIL_PROVIDER; st.supa = fakeSupa();
  assert.equal(body(await call(dispatch, {})).skipped, "EMAIL_NOT_CONFIGURED"); assert.equal(st.supa.calls.length, 0);
});
test("e-mail: sends escaped HTML and records success or failure", async () => {
  Object.assign(process.env, { EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "k", EMAIL_FROM: "Valdynet <no-reply@example.com>" });
  let sent; global.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200 }; };
  st.supa = fakeSupa({ rpc: { claim_email_notifications: { data: [row], error: null } } });
  assert.equal(body(await call(dispatch, {})).sent, 1);
  assert.match(sent.html, /&lt;script&gt;/); assert.doesNotMatch(sent.html, /<script>/);
  assert.equal(rpcs("finish_email_notification")[0][2].p_ok, true);
  global.fetch = async () => ({ ok: false, status: 500 });
  st.supa = fakeSupa({ rpc: { claim_email_notifications: { data: [row], error: null } } });
  assert.equal(body(await call(dispatch, {})).sent, 0);
  assert.equal(rpcs("finish_email_notification")[0][2].p_ok, false);
});
