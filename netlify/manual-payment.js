"use strict";
const crypto = require("crypto");
const { db, reply, userFrom, log } = require("./_lib/common");
const { MIME_EXT, MANUAL, validateManual, ownTransaction } = require("./_lib/payments");

const BUCKET = "payment-proofs";
const ERRORS = { REFERENCE_ALREADY_USED: [409, "REFERENCE_ALREADY_USED"], NOT_ALLOWED: [409, "NOT_ALLOWED"], INVALID_PROOF: [422, "INVALID_PROOF"] };

// POST /api/manual-payment { action: "info" | "upload_url" | "submit", reference, ... }
// Manual payments are NEVER marked paid here: they stay "pending_verification" until an admin approves.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 3000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const user = await userFrom(event);
    if (!user) return reply(401, { ok: false, error: "UNAUTHENTICATED" });
    if (!user.email_confirmed_at) return reply(403, { ok: false, error: "EMAIL_NOT_VERIFIED" });
    const supa = db();
    const { data: allowed } = await supa.rpc("check_rate_limit", { p_key: "mp:" + user.id, p_max: 20, p_window_seconds: 60 });
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }
    const tx = await ownTransaction(supa, user.id, b.reference);
    if (!tx) return reply(404, { ok: false, error: "NOT_FOUND" });
    if (!MANUAL.includes(tx.payment_method) || tx.status !== "pending") return reply(409, { ok: false, error: "NOT_PAYABLE" });

    if (b.action === "info") {
      const { data: s } = await supa.from("payment_settings").select("*").eq("singleton", true).single();
      const instructions = tx.payment_method === "wise" ? s.wise_instructions : tx.payment_method === "moncash" ? s.moncash_number : s.natcash_number;
      return reply(200, { ok: true, method: tx.payment_method, instructions: instructions || "", amount: tx.total_amount, currency: tx.sender_currency });
    }
    if (b.action === "upload_url") {
      const ext = MIME_EXT[b.contentType];
      if (!ext) return reply(422, { ok: false, error: "UNSUPPORTED_FILE_TYPE" });
      const path = tx.id + "/" + crypto.randomUUID() + "." + ext;
      const { data, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return reply(200, { ok: true, path, token: data.token });
    }
    if (b.action === "submit") {
      const v = validateManual(b);
      if (!v.ok) return reply(422, v);
      const { error } = await supa.rpc("submit_manual_payment", { p_profile: user.id, p_ref: b.reference, p_txid: v.txid, p_payref: v.payref, p_proof: v.proof });
      if (error) {
        const hit = Object.keys(ERRORS).find((k) => String(error.message).includes(k));
        if (hit) return reply(ERRORS[hit][0], { ok: false, error: ERRORS[hit][1] });
        throw error;
      }
      return reply(200, { ok: true, status: "pending_verification" });
    }
    return reply(400, { ok: false, error: "UNKNOWN_ACTION" });
  } catch (e) {
    log("error", "manual-payment failed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
