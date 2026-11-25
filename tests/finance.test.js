"use strict";
// Run: node --test tests/finance.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate } = require("../netlify/functions/_lib/finance");

const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };

test("deposit 50 USD via PayPal: rate 140, fee 10%", () => {
  const r = ok(calculate({ service: "deposit", method: "paypal", amount: 50 }));
  assert.equal(r.exchangeRate, 140);
  assert.equal(r.convertedAmount, 7000);
  assert.equal(r.serviceFee, 5);
  assert.equal(r.totalAmount, 55);
  assert.equal(r.recipientAmount, 7000);
  assert.equal(r.providerFeePending, true);
});

test("withdrawal uses rate 130", () => {
  const r = ok(calculate({ service: "withdrawal", method: "wise", amount: 100 }));
  assert.equal(r.exchangeRate, 130);
  assert.equal(r.convertedAmount, 13000);
});

test("HTG payment converts back to USD", () => {
  const r = ok(calculate({ service: "deposit", method: "moncash", amount: 7000 }));
  assert.equal(r.recipientCurrency, "USD");
  assert.equal(r.convertedAmount, 50);
  assert.equal(r.serviceFee, 700);
  assert.equal(r.totalAmount, 7700);
});

test("fee threshold: 5% up to 30 USD inclusive, 10% above, on the full amount", () => {
  assert.equal(ok(calculate({ service: "deposit", method: "paypal", amount: 10 })).serviceFee, 0.5);
  assert.equal(ok(calculate({ service: "deposit", method: "paypal", amount: 30 })).serviceFee, 1.5);
  assert.equal(ok(calculate({ service: "deposit", method: "paypal", amount: 30.01 })).serviceFee, 3);
});

test("minimum is 10 USD or its HTG equivalent", () => {
  assert.equal(calculate({ service: "deposit", method: "paypal", amount: 9.99 }).error, "BELOW_MINIMUM");
  assert.equal(calculate({ service: "deposit", method: "natcash", amount: 1399 }).error, "BELOW_MINIMUM");
  assert.equal(ok(calculate({ service: "deposit", method: "natcash", amount: 1400 })).serviceFee, 70);
});

test("rejects unsupported routes and bad input", () => {
  assert.equal(calculate({ service: "wallet_transfer", method: "paypal", amount: 50 }).error, "SERVICE_UNAVAILABLE");
  assert.equal(calculate({ service: "deposit", method: "__proto__", amount: 50 }).error, "METHOD_UNAVAILABLE");
  assert.equal(calculate({ service: "__proto__", method: "paypal", amount: 50 }).error, "SERVICE_UNAVAILABLE");
  assert.equal(calculate({ service: "deposit", method: "paypal", amount: "abc" }).error, "INVALID_AMOUNT");
  assert.equal(calculate({ service: "deposit", method: "paypal", amount: -5 }).error, "INVALID_AMOUNT");
});
