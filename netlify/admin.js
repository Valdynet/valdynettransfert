"use strict";
const { db, reply, userFrom, log } = require("./_lib/common");

const STATUSES = ["pending", "pending_verification", "payment_received", "processing", "completed", "cancelled", "rejected", "refunded"];
const METHODS = ["paypal", "wise", "moncash", "natcash"];
const SERVICES = ["deposit", "withdrawal", "wallet_transfer", "international"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 25;

const num = (v, min, max) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n >= min && n <= max ? n : null; };
const flags = (o, keys) => {
  if (!o || typeof o !== "object") return null;
  const out = {};
  for (const k of keys) { if (typeof o[k] !== "boolean") return null; out[k] = o[k]; }
  return out;
};
const fees = (o) => {
  if (!o || typeof o !== "object") return null;
  const out = {};
  for (const k of METHODS) {
    if (o[k] === null) { out[k] = null; continue; }
    const n = num(o[k], 0, 100000);
    if (n === null) return null;
    out[k] = n;
  }
  return out;
};
const SETTING_FIELDS = { deposit_rate: [1, 100000], withdrawal_rate: [1, 100000], minimum_amount: [1, 100000],
  low_fee_rate: [0, 1], high_fee_rate: [0, 1], fee_threshold: [1, 1000000] };
const RPC_ERRORS = { TRANSITION_NOT_ALLOWED: [409, "TRANSITION_NOT_ALLOWED"], NOTE_REQUIRED: [422, "NOTE_REQUIRED"], NOT_FOUND: [404, "NOT_FOUND"] };

// POST /api/admin { action, ... }  (Authorization: Bearer <token>)
// The admin role is read from the database on EVERY request; nothing from the browser is trusted.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  if ((event.body || "").length > 8000) return reply(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  try {
    const supa = db();
    const user = await userFrom(event);
    if (!user) return reply(401, { ok: false, error: "UNAUTHENTICATED" });
    const { data: prof } = await supa.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") return reply(403, { ok: false, error: "FORBIDDEN" });
    const { data: allowedRate } = await supa.rpc("check_rate_limit", { p_key: "admin:" + user.id, p_max: 120, p_window_seconds: 60 });
    if (allowedRate !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });

    let b;
    try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { ok: false, error: "INVALID_JSON" }); }

    switch (b.action) {
      case "overview": {
        const counts = await Promise.all(STATUSES.map((s) => supa.from("transactions").select("id", { count: "exact", head: true }).eq("status", s)));
        const byStatus = {};
        STATUSES.forEach((s, i) => { byStatus[s] = counts[i].count ?? 0; });
        const { count } = await supa.from("customers").select("id", { count: "exact", head: true });
        return reply(200, { ok: true, byStatus, customers: count ?? 0 });
      }
      case "transactions": {
        const f = b.filters || {};
        let q = supa.from("transactions").select("*, customers(customer_status, profiles(email, first_name, last_name))").order("created_at", { ascending: false });
        if (STATUSES.includes(f.status)) q = q.eq("status", f.status);
        if (METHODS.includes(f.method)) q = q.eq("payment_method", f.method);
        const ref = typeof f.q === "string" ? f.q.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 20) : "";
        if (ref) q = q.ilike("transaction_reference", "%" + ref + "%");
        if (DATE.test(f.from || "")) q = q.gte("created_at", f.from + "T00:00:00Z");
        if (DATE.test(f.to || "")) q = q.lte("created_at", f.to + "T23:59:59.999Z");
        const page = Math.max(0, Math.min(1000, parseInt(b.page, 10) || 0));
        const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        const { data: allowed } = await supa.rpc("allowed_transitions");
        return reply(200, { ok: true, rows: data, allowed, pageSize: PAGE });
      }
      case "status_update": {
        if (!UUID.test(String(b.id)) || !STATUSES.includes(b.status)) return reply(422, { ok: false, error: "INVALID_REQUEST" });
        const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
        const { error } = await supa.rpc("admin_change_status", { p_tx: b.id, p_actor: user.id, p_new: b.status, p_note: note || null });
        if (error) {
          const hit = Object.keys(RPC_ERRORS).find((k) => String(error.message).includes(k));
          if (hit) return reply(RPC_ERRORS[hit][0], { ok: false, error: RPC_ERRORS[hit][1] });
          throw error;
        }
        return reply(200, { ok: true });
      }
      case "customers": {
        const { data, error } = await supa.from("profiles").select("email, first_name, last_name, phone, country, created_at, customers(customer_status)")
          .eq("role", "customer").order("created_at", { ascending: false }).limit(100);
        if (error) throw error;
        return reply(200, { ok: true, rows: data });
      }
      case "logs": {
        const [a, t] = await Promise.all([
          supa.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(50),
          supa.from("transaction_logs").select("*, transactions(transaction_reference)").order("created_at", { ascending: false }).limit(50),
        ]);
        if (a.error || t.error) throw a.error || t.error;
        return reply(200, { ok: true, audit: a.data, transactions: t.data });
      }
      case "settings_get": {
        const { data, error } = await supa.from("financial_settings").select("*").eq("singleton", true).single();
        if (error) throw error;
        return reply(200, { ok: true, settings: data });
      }
      case "settings_update": {
        const s = b.settings || {};
        const data = {};
        for (const [k, [lo, hi]] of Object.entries(SETTING_FIELDS)) {
          const n = num(s[k], lo, hi);
          if (n === null) return reply(422, { ok: false, error: "INVALID_SETTING", field: k });
          data[k] = n;
        }
        data.provider_fees = fees(s.provider_fees);
        data.services_enabled = flags(s.services_enabled, SERVICES);
        data.methods_enabled = flags(s.methods_enabled, METHODS);
        for (const k of ["provider_fees", "services_enabled", "methods_enabled"]) {
          if (!data[k]) return reply(422, { ok: false, error: "INVALID_SETTING", field: k });
        }
        const { error } = await supa.rpc("admin_update_settings", { p_actor: user.id, p_data: data });
        if (error) throw error;
        return reply(200, { ok: true });
      }
      default:
        return reply(400, { ok: false, error: "UNKNOWN_ACTION" });
    }
  } catch (e) {
    log("error", "admin failed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
