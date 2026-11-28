"use strict";
// Provider-agnostic mailer. EMAIL_PROVIDER=none (default, nothing is sent) | resend.
// Needs EMAIL_API_KEY and EMAIL_FROM (a sender address verified with your provider). Add other providers in `providers`.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function render({ title, message }) {
  return {
    text: title + "\n\n" + message + "\n\nValdynet Transfert – Sevis rapid",
    html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#14213D">' +
      '<h2 style="color:#0B2545">' + esc(title) + "</h2><p>" + esc(message) + "</p>" +
      '<p style="color:#52606D;font-size:13px">Valdynet Transfert – Sevis rapid</p></div>',
  };
}

const providers = {
  async resend({ to, subject, html, text }) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.EMAIL_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
    });
    if (!r.ok) throw new Error("EMAIL_PROVIDER_" + r.status);
  },
};

function configured() {
  const p = (process.env.EMAIL_PROVIDER || "none").toLowerCase();
  return providers[p] && process.env.EMAIL_API_KEY && process.env.EMAIL_FROM ? p : null;
}

async function send(to, n) {
  const p = configured();
  if (!p) throw new Error("EMAIL_NOT_CONFIGURED");
  await providers[p]({ to, subject: n.title + " – Valdynet Transfert", ...render(n) });
}

module.exports = { render, send, configured, esc };
