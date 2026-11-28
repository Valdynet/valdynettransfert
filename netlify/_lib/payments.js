"use strict";
// Pure helpers (no I/O except ownTransaction's injected client): unit-tested in tests/payments.test.js.

const REF = /^VT-[A-HJKMNP-Z2-9]{10}$/;
const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
const MANUAL = ["wise", "moncash", "natcash"];
const PROOF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\.(jpg|png|pdf)$/;
const EVENT_MAP = {
  "PAYMENT.CAPTURE.COMPLETED": "completed", "PAYMENT.CAPTURE.PENDING": "pending",
  "PAYMENT.CAPTURE.DENIED": "failed", "PAYMENT.CAPTURE.DECLINED": "failed",
  "PAYMENT.CAPTURE.REFUNDED": "refunded", "PAYMENT.CAPTURE.REVERSED": "refunded",
  "CHECKOUT.PAYMENT-APPROVAL.REVERSED": "cancelled",
};

// Never trusts the browser: compares PayPal's own answer with what the database expects.
function validateCapture(order, expected) {
  if (!order || order.status !== "COMPLETED") return { ok: false, error: "NOT_COMPLETED" };
  const pu = (order.purchase_units || [])[0];
  const cap = pu && pu.payments && (pu.payments.captures || [])[0];
  if (!cap) return { ok: false, error: "NO_CAPTURE" };
  if (cap.status !== "COMPLETED") return { ok: false, error: cap.status === "PENDING" ? "CAPTURE_PENDING" : "CAPTURE_" + cap.status };
  if (pu.custom_id !== expected.customId) return { ok: false, error: "OWNER_MISMATCH" };
  if (!cap.amount || cap.amount.currency_code !== expected.currency) return { ok: false, error: "CURRENCY_MISMATCH" };
  if (Math.round(Number(cap.amount.value) * 100) !== Math.round(expected.amount * 100)) return { ok: false, error: "AMOUNT_MISMATCH" };
  return { ok: true, captureId: cap.id, amount: Number(cap.amount.value), currency: cap.amount.currency_code };
}

function orderIdOf(resource) {
  const r = resource || {};
  return (r.supplementary_data && r.supplementary_data.related_ids && r.supplementary_data.related_ids.order_id) || r.id || null;
}

function validateManual(b) {
  const txid = typeof b.providerTransactionId === "string" ? b.providerTransactionId.trim() : "";
  const payref = typeof b.paymentReference === "string" ? b.paymentReference.trim() : "";
  const proof = b.proofPath == null || b.proofPath === "" ? null : b.proofPath;
  if (!/^[A-Za-z0-9._-]{4,64}$/.test(txid)) return { ok: false, error: "INVALID_TRANSACTION_ID" };
  if (!/^[\w .\/-]{3,64}$/.test(payref)) return { ok: false, error: "INVALID_PAYMENT_REFERENCE" };
  if (proof !== null && !(typeof proof === "string" && PROOF.test(proof))) return { ok: false, error: "INVALID_PROOF" };
  return { ok: true, txid, payref, proof };
}

// The customer's own transaction, or null (also null for someone else's reference).
async function ownTransaction(supa, userId, ref) {
  if (!REF.test(String(ref))) return null;
  const { data } = await supa.from("transactions")
    .select("id,transaction_reference,status,payment_method,total_amount,sender_currency,customers!inner(profile_id)")
    .eq("transaction_reference", ref).eq("customers.profile_id", userId).maybeSingle();
  return data || null;
}

module.exports = { REF, MIME_EXT, MANUAL, EVENT_MAP, validateCapture, orderIdOf, validateManual, ownTransaction };
