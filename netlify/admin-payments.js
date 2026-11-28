"use strict";
const { db, reply, log } = require("./_lib/common");
const { requireAdmin } = require("./_lib/adminAuth");

const METHODS = ["paypal", "wise", "moncash", "natcash"];
const STATUSES = ["pending", "pending_verification", "completed", "failed", "cancelled", "refunded"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^\+?[0-9 ]{8,20}$/;
const PAGE = 25;
const RPC_ERRORS = { NOT_PENDING_VERIFICATION: 409, NOTE_REQUIRED: 422, NOT_FOUND: 404, TRANSITION_NOT_ALLOWED: 409 };

// POST /api/admin-payments { action } — admin role re-checked in the database on every call.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 6000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const supa = db();
    const a = await requireAdmin(event, supa);
    if (!a.user) return reply(a.code, { ok: false, error: a.error });
    const { data: ok } = await supa.rpc("check_rate_limit", { p_key: "admin:" + a.user.id, p_max: 120, p_window_seconds: 60 });
    if (ok !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });
    let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }

    switch (b.action) {
      case "payments": {
        const f = b.filters || {};
        let q = supa.from("payments").select("*, transactions(transaction_reference, customers(profiles(email, first_name, last_name)))").order("created_at", { ascending: false });
        if (METHODS.includes(f.method)) q = q.eq("provider", f.method);
        if (STATUSES.includes(f.status)) q = q.eq("status", f.status);
        const page = Math.max(0, Math.min(1000, parseInt(b.page, 10) || 0));
        const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        return reply(200, { ok: true, rows: data, pageSize: PAGE });
      }
      case "review": {
        if (!UUID.test(String(b.id)) || typeof b.approve !== "boolean") return reply(422, { ok: false, error: "INVALID_REQUEST" });
        const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
        const { error } = await supa.rpc("admin_review_payment", { p_payment: b.id, p_actor: a.user.id, p_approve: b.approve, p_note: note || null });
        if (error) {
          const hit = Object.keys(RPC_ERRORS).find((k) => String(error.message).includes(k));
          if (hit) return reply(RPC_ERRORS[hit], { ok: false, error: hit });
          throw error;
        }
        return reply(200, { ok: true });
      }
      case "proof_url": { // short-lived signed link; the bucket itself stays private
        if (!UUID.test(String(b.id))) return reply(422, { ok: false, error: "INVALID_REQUEST" });
        const { data: p } = await supa.from("payments").select("proof_path").eq("id", b.id).single();
        if (!p || !p.proof_path) return reply(404, { ok: false, error: "NO_PROOF" });
        const { data, error } = await supa.storage.from("payment-proofs").createSignedUrl(p.proof_path, 60);
        if (error) throw error;
        return reply(200, { ok: true, url: data.signedUrl });
      }
      case "settings_get": {
        const { data, error } = await supa.from("payment_settings").select("wise_instructions, moncash_number, natcash_number").eq("singleton", true).single();
        if (error) throw error;
        return reply(200, { ok: true, settings: data });
      }
      case "settings_update": {
        const s = b.settings || {};
        const wise = typeof s.wise_instructions === "string" ? s.wise_instructions.slice(0, 2000) : null;
        if (wise === null || !PHONE.test(String(s.moncash_number)) || !PHONE.test(String(s.natcash_number))) return reply(422, { ok: false, error: "INVALID_SETTING" });
        const { error } = await supa.rpc("admin_update_payment_settings", { p_actor: a.user.id, p_wise: wise, p_moncash: s.moncash_number.trim(), p_natcash: s.natcash_number.trim() });
        if (error) throw error;
        return reply(200, { ok: true });
      }
      default:
        return reply(400, { ok: false, error: "UNKNOWN_ACTION" });
    }
  } catch (e) {
    log("error", "admin-payments failed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
