(async () => {
  "use strict";
  const A = window.VTAuth;
  const $ = (id) => document.getElementById(id);
  const ctx = await A.requireUser();
  if (!ctx) return;
  const { sb, user } = ctx;
  $("who").textContent = user.email;
  $("logout").addEventListener("click", A.logout);

  const STATUS = { pending: "En attente", pending_verification: "Vérification en cours", payment_received: "Paiement reçu",
    processing: "En traitement", completed: "Terminée", cancelled: "Annulée", rejected: "Rejetée", refunded: "Remboursée" };
  const SERVICE = { deposit: "Dépôt", withdrawal: "Retrait", wallet_transfer: "Portefeuille à portefeuille", international: "International" };
  const METHOD = { paypal: "PayPal", wise: "Wise", moncash: "MonCash", natcash: "NatCash" };
  const ERR = {
    TRANSITION_NOT_ALLOWED: "Ce changement de statut n’est pas autorisé.",
    NOTE_REQUIRED: "Une note est obligatoire pour rejeter, annuler ou rembourser.",
    NOT_FOUND: "Transaction introuvable.", RATE_LIMITED: "Trop de requêtes. Patientez un instant.",
    INVALID_SETTING: "Valeur invalide. Vérifiez les champs.",
  };
  const money = (n, c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: c }).format(n);
  const fmt = (d) => new Date(d).toLocaleString("fr-FR");
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const fill = (tbody, rows) => {
    tbody.replaceChildren();
    rows.forEach((r) => {
      const tr = mk("tr");
      r.forEach((v) => { const td = mk("td"); if (v instanceof Node) td.append(v); else td.textContent = v; tr.append(td); });
      tbody.append(tr);
    });
  };

  // Every call is re-authorized on the server; a non-admin is sent away.
  async function api(action, data = {}) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ action, ...data }),
    });
    if (res.status === 401 || res.status === 403) { location.replace("/customer/dashboard.html"); throw new Error("FORBIDDEN"); }
    return res.json().catch(() => ({ ok: false, error: "UNAVAILABLE" }));
  }

  Object.entries(STATUS).forEach(([k, v]) => { const o = mk("option", v); o.value = k; $("f-status").append(o); });

  // --- Overview ---
  async function overview() {
    const d = await api("overview");
    const box = $("o-cards");
    box.replaceChildren();
    if (!d.ok) return box.append(mk("p", "Chargement impossible.", "error"));
    [["Clients", d.customers], ...Object.entries(d.byStatus).map(([k, v]) => [STATUS[k], v])].forEach(([l, v]) => {
      const c = mk("div", null, "card"); c.append(mk("p", l), mk("strong", v)); box.append(c);
    });
  }

  // --- Transactions ---
  let page = 0, filters = {}, allowed = {};
  async function loadTx(reset) {
    if (reset) { page = 0; $("tx-body").replaceChildren(); }
    $("tx-err").hidden = true;
    const d = await api("transactions", { filters, page });
    if (!d.ok) { $("tx-err").textContent = "Chargement impossible. Réessayez."; $("tx-err").hidden = false; return; }
    allowed = d.allowed || {};
    const tbody = $("tx-body");
    if (reset && !d.rows.length) { const tr = mk("tr"); const td = mk("td", "Aucune transaction."); td.colSpan = 8; tr.append(td); tbody.append(tr); }
    d.rows.forEach((t) => {
      const p = t.customers && t.customers.profiles;
      const b = mk("button", "Gérer", "btn"); b.type = "button"; b.addEventListener("click", () => openTx(t));
      const tr = mk("tr");
      [t.transaction_reference, fmt(t.created_at), p ? p.email : "–", SERVICE[t.service_type] || t.service_type, METHOD[t.payment_method] || t.payment_method,
        money(t.sender_amount, t.sender_currency), STATUS[t.status] || t.status, b].forEach((v) => { const td = mk("td"); if (v instanceof Node) td.append(v); else td.textContent = v; tr.append(td); });
      tbody.append(tr);
    });
    $("tx-more").hidden = d.rows.length < d.pageSize;
  }
  $("f-tx").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    filters = { q: f.q.value, status: f.status.value, method: f.method.value, from: f.from.value, to: f.to.value };
    loadTx(true);
  });
  $("tx-more").addEventListener("click", () => { page += 1; loadTx(false); });

  function openTx(t) {
    const p = t.customers && t.customers.profiles;
    const list = $("t-list");
    list.replaceChildren();
    [["Identifiant", t.transaction_reference], ["Date", fmt(t.created_at)],
      ["Client", p ? [p.first_name, p.last_name].filter(Boolean).join(" ") + " (" + p.email + ")" : "–"],
      ["Service", SERVICE[t.service_type] || t.service_type], ["Moyen de paiement", METHOD[t.payment_method] || t.payment_method],
      ["Montant", money(t.sender_amount, t.sender_currency)], ["Taux", "1 USD = " + t.exchange_rate + " HTG"],
      ["Frais Valdynet", money(t.service_fee, t.sender_currency)],
      ["Frais du fournisseur", t.provider_fee == null ? "À confirmer" : money(t.provider_fee, t.sender_currency)],
      ["Total", money(t.total_amount, t.sender_currency)], ["Destinataire reçoit", money(t.recipient_amount, t.recipient_currency)],
      ["Destinataire", (t.recipient_name || "–") + " · " + (t.recipient_contact || "–")], ["Notes", t.notes || "–"],
      ["Statut", STATUS[t.status] || t.status]].forEach(([k, v]) => {
      const d = mk("div"); d.append(mk("dt", k), mk("dd", v)); list.append(d);
    });
    const next = allowed[t.status] || [];
    const sel = $("s-status");
    sel.replaceChildren();
    next.forEach((s) => { const o = mk("option", STATUS[s]); o.value = s; sel.append(o); });
    $("s-form").hidden = !next.length;
    $("s-none").hidden = !!next.length;
    $("s-form").dataset.id = t.id;
    $("s-note").value = "";
    $("s-msg").textContent = "";
    $("tx-dialog").showModal();
  }
  $("d-close").addEventListener("click", () => $("tx-dialog").close());
  $("s-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = await api("status_update", { id: e.currentTarget.dataset.id, status: $("s-status").value, note: $("s-note").value });
    if (d.ok) { $("tx-dialog").close(); loadTx(true); } else $("s-msg").textContent = ERR[d.error] || "Action impossible. Réessayez.";
  });

  // --- Customers ---
  async function customers() {
    const d = await api("customers");
    if (!d.ok) return;
    fill($("c-body"), d.rows.map((c) => [c.email, [c.first_name, c.last_name].filter(Boolean).join(" ") || "–", c.phone || "–", c.country || "–",
      (c.customers && c.customers.customer_status) || "–", fmt(c.created_at)]));
  }

  // --- Financial settings ---
  const sf = $("f-settings");
  async function settings() {
    const d = await api("settings_get");
    if (!d.ok) return;
    const s = d.settings;
    ["deposit_rate", "withdrawal_rate", "minimum_amount", "fee_threshold", "low_fee_rate", "high_fee_rate"].forEach((k) => { sf.elements[k].value = s[k]; });
    Object.keys(METHOD).forEach((k) => {
      sf.elements["pf_" + k].value = s.provider_fees[k] == null ? "" : s.provider_fees[k];
      sf.elements["mt_" + k].checked = s.methods_enabled[k] === true;
    });
    Object.keys(SERVICE).forEach((k) => { sf.elements["sv_" + k].checked = s.services_enabled[k] === true; });
  }
  sf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const el = sf.elements, note = $("s-note");
    const payload = {};
    ["deposit_rate", "withdrawal_rate", "minimum_amount", "fee_threshold", "low_fee_rate", "high_fee_rate"].forEach((k) => { payload[k] = el[k].value; });
    payload.provider_fees = {}; payload.methods_enabled = {}; payload.services_enabled = {};
    Object.keys(METHOD).forEach((k) => { payload.provider_fees[k] = el["pf_" + k].value === "" ? null : el["pf_" + k].value; payload.methods_enabled[k] = el["mt_" + k].checked; });
    Object.keys(SERVICE).forEach((k) => { payload.services_enabled[k] = el["sv_" + k].checked; });
    const d = await api("settings_update", { settings: payload });
    note.textContent = d.ok ? "Paramètres enregistrés et journalisés." : (ERR[d.error] || "Enregistrement impossible.") + (d.field ? " (" + d.field + ")" : "");
    note.className = d.ok ? "note" : "error";
  });

  // --- Logs ---
  async function logs() {
    const d = await api("logs");
    if (!d.ok) return;
    fill($("l-audit"), d.audit.map((l) => [fmt(l.created_at), l.action, l.entity_type, JSON.stringify(l.metadata).slice(0, 160)]));
    fill($("l-tx"), d.transactions.map((l) => [fmt(l.created_at), (l.transactions && l.transactions.transaction_reference) || "–",
      (STATUS[l.previous_status] || l.previous_status || "–") + " → " + (STATUS[l.new_status] || l.new_status || "–"), l.description || ""]));
  }

  // --- Tabs ---
  const loaders = { overview, transactions: () => loadTx(true), customers, settings, logs };
  const tabs = [...document.querySelectorAll("[role=tab]")];
  tabs.forEach((t) => t.addEventListener("click", () => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; $(x.getAttribute("aria-controls")).hidden = !on; });
    loaders[t.dataset.load]();
  }));
  overview();
})();
