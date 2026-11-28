"use strict";
const { db, reply, log } = require("./_lib/common");
const email = require("./_lib/email");

// Scheduled every 5 minutes (netlify.toml, production deploys only).
// Harmless if called by hand: it only sends pending, recent notifications to their owners, and is rate limited.
exports.handler = async () => {
  if (!email.configured()) return reply(200, { ok: true, skipped: "EMAIL_NOT_CONFIGURED" });
  try {
    const supa = db();
    const { data: allowed } = await supa.rpc("check_rate_limit", { p_key: "dispatch", p_max: 30, p_window_seconds: 3600 });
    if (allowed !== true) return reply(429, { ok: false, error: "RATE_LIMITED" });
    const { data: rows, error } = await supa.rpc("claim_email_notifications", { p_limit: 20 });
    if (error) throw error;
    let sent = 0;
    for (const n of rows) {
      try {
        await email.send(n.out_email, { title: n.out_title, message: n.out_message });
        await supa.rpc("finish_email_notification", { p_id: n.out_id, p_ok: true, p_error: null });
        sent += 1;
      } catch (e) {
        await supa.rpc("finish_email_notification", { p_id: n.out_id, p_ok: false, p_error: e.message });
        log("error", "email failed", { id: n.out_id, message: e.message });
      }
    }
    return reply(200, { ok: true, sent, claimed: rows.length });
  } catch (e) {
    log("error", "send-notifications failed", { message: e.message });
    return reply(503, { ok: false, error: "UNAVAILABLE" });
  }
};
