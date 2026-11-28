(async () => {
  "use strict";
  const A = window.VTAuth;
  const $ = (id) => document.getElementById(id);
  const ctx = await A.requireUser();
  if (!ctx) return;
  const { sb } = ctx;
  $("logout").addEventListener("click", A.logout);

  const STATUS = { pending: "En attente", pending_verification: "Vérification en cours", completed: "Validé", failed: "Rejeté / échoué", cancelled: "Annulé", refunded: "Remboursé" };
  const METHOD = { paypal: "PayPal", wise: "Wise", moncash: "MonCash", natcash: "NatCash" };
  const ERR = { NOT_PENDING_VERIFICATION: "Ce paiement n’est plus en attente de vérification.", NOTE_REQUIRED: "Une note est obligatoire pour rejeter.",
    NOT_FOUND: "Paiement introuvable.", TRANSITION_NOT_ALLOWED: "Changement de statut non autorisé.", INVALID_SETTING: "Valeur invalide.", NO_PROOF: "Aucune preuve jointe." };
  const money = (n, c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: c }).format(n);
  const fmt = (d) => new Date(d).toLocaleString("fr-FR");
  const mk = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

  async function api(action, data = {}) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch("/api/admin-payments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ action, ...data }) });
    if (res.status === 401 || res.status === 403) { location.replace("/customer/dashboard.html"); throw new Error("FORBIDDEN"); }
    return res.json().catch(() => ({ ok: false, error: "UNAVAILABLE" }));
  }

  let page = 0, filters = {}, current = null;
  async function load(reset) {
    if (reset) { page = 0; $("p-body").replaceChildren(); }
    $("p-err").hidden = true;
    const d = await api("payments", { filters, page });
    if (!d.ok) { $("p-err").textContent = "Chargement impossible. Réessayez."; $("p-err").hidden = false; return; }
    if (reset && !d.rows.length) { const tr = mk("tr"), td = mk("td", "Aucun paiement."); td.colSpan = 9; tr.append(td); $("p-body").append(tr); }
    d.rows.forEach((p) => {
      const pr = p.transactions && p.transactions.customers && p.transactions.customers.profiles;
      const b = mk("button", "Gérer", "btn"); b.type = "button"; b.addEventListener("click", () => open(p));
      const tr = mk("tr");
      [fmt(p.created_at), p.transactions ? p.transactions.transaction_reference : "–", pr ? pr.email : "–", METHOD[p.provider] || p.provider,
        p.provider_transaction_id || "–", p.payment_reference || "–", money(p.amount, p.currency), STATUS[p.status] || p.status, b]
        .forEach((v) => { const td = mk("td"); if (v instanceof Node) td.append(v); else td.textContent = v; tr.append(td); });
      $("p-body").append(tr);
    });
    $("p-more").hidden = d.rows.length < d.pageSize;
  }
  $("f-pay").addEventListener("submit", (e) => { e.preventDefault(); const f = e.currentTarget.elements; filters = { method: f.method.value, status: f.status.value }; load(true); });
  $("p-more").addEventListener("click", () => { page += 1; load(false); });

  function open(p) {
    current = p;
    const pr = p.transactions && p.transactions.customers && p.transactions.customers.profiles;
    const list = $("d-list");
    list.replaceChildren();
    [["Date", fmt(p.created_at)], ["Transaction", p.transactions ? p.transactions.transaction_reference : "–"],
      ["Client", pr ? [pr.first_name, pr.last_name].filter(Boolean).join(" ") + " (" + pr.email + ")" : "–"],
      ["Moyen", METHOD[p.provider] || p.provider], ["Montant attendu", money(p.amount, p.currency)],
      ["ID de transaction fournisseur", p.provider_transaction_id || "–"], ["Référence de paiement", p.payment_reference || "–"],
      ["Statut", STATUS[p.status] || p.status], ["Vérifié le", p.verified_at ? fmt(p.verified_at) : "–"], ["Note", p.review_note || "–"]]
      .forEach(([k, v]) => { const d = mk("div"); d.append(mk("dt", k), mk("dd", v)); list.append(d); });
    $("proof-btn").hidden = !p.proof_path;
    $("proof-link").hidden = true;
    $("review").hidden = p.status !== "pending_verification";
    $("r-note").value = ""; $("r-msg").textContent = "";
    $("p-dialog").showModal();
  }
  $("d-close").addEventListener("click", () => $("p-dialog").close());
  $("proof-btn").addEventListener("click", async () => {
    const d = await api("proof_url", { id: current.id });
    if (!d.ok) { $("r-msg").textContent = ERR[d.error] || "Preuve indisponible."; return; }
    $("proof-link").href = d.url; $("proof-link").hidden = false;
  });
  const review = async (approve) => {
    const d = await api("review", { id: current.id, approve, note: $("r-note").value });
    if (d.ok) { $("p-dialog").close(); load(true); } else $("r-msg").textContent = ERR[d.error] || "Action impossible. Réessayez.";
  };
  $("r-ok").addEventListener("click", () => review(true));
  $("r-no").addEventListener("click", () => review(false));

  const sf = $("f-pset");
  const s = await api("settings_get");
  if (s.ok) { sf.elements.wise.value = s.settings.wise_instructions; sf.elements.moncash.value = s.settings.moncash_number; sf.elements.natcash.value = s.settings.natcash_number; }
  sf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = await api("settings_update", { settings: { wise_instructions: sf.elements.wise.value, moncash_number: sf.elements.moncash.value, natcash_number: sf.elements.natcash.value } });
    $("s-note").textContent = d.ok ? "Instructions enregistrées et journalisées." : ERR[d.error] || "Enregistrement impossible.";
    $("s-note").className = d.ok ? "note" : "error";
  });
  load(true);
})();
