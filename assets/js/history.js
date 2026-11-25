(async () => {
  "use strict";
  const A = window.VTAuth;
  const $ = (id) => document.getElementById(id);
  const ctx = await A.requireUser();
  if (!ctx) return;
  const { sb } = ctx;

  const PAGE = 20;
  const STATUS = { pending: "En attente", pending_verification: "Vérification en cours", payment_received: "Paiement reçu",
    processing: "En traitement", completed: "Terminée", cancelled: "Annulée", rejected: "Rejetée", refunded: "Remboursée" };
  const SERVICE = { deposit: "Dépôt", withdrawal: "Retrait", wallet_transfer: "Portefeuille à portefeuille", international: "International" };
  const METHOD = { paypal: "PayPal", wise: "Wise", moncash: "MonCash", natcash: "NatCash" };
  const money = (n, c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: c }).format(n);

  const body = $("h-body"), more = $("more"), note = $("h-note"), form = $("f-filter");
  let page = 0;
  let filters = { status: "", q: "" };

  const cell = (tr, v) => { const td = document.createElement("td"); td.textContent = v; tr.append(td); return td; };

  function openDetail(t) {
    const list = $("d-list");
    list.replaceChildren();
    const rows = [
      ["Identifiant", t.transaction_reference],
      ["Date", new Date(t.created_at).toLocaleString("fr-FR")],
      ["Service", SERVICE[t.service_type] || t.service_type],
      ["Moyen de paiement", METHOD[t.payment_method] || t.payment_method],
      ["Montant", money(t.sender_amount, t.sender_currency)],
      ["Taux utilisé", "1 USD = " + t.exchange_rate + " HTG"],
      ["Montant converti", money(t.converted_amount, t.recipient_currency)],
      ["Frais Valdynet", money(t.service_fee, t.sender_currency)],
      ["Frais du fournisseur", t.provider_fee == null ? "À confirmer" : money(t.provider_fee, t.sender_currency)],
      ["Total payé", money(t.total_amount, t.sender_currency)],
      ["Le destinataire reçoit", money(t.recipient_amount, t.recipient_currency)],
      ["Destinataire", t.recipient_name || "–"],
      ["Contact du destinataire", t.recipient_contact || "–"],
      ["Notes", t.notes || "–"],
      ["Statut", STATUS[t.status] || t.status],
    ];
    rows.forEach(([k, v]) => {
      const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = k; dd.textContent = v; d.append(dt, dd); list.append(d);
    });
    $("detail").showModal();
  }

  async function load(reset) {
    if (reset) { page = 0; body.replaceChildren(); }
    note.hidden = true;
    more.disabled = true;
    let q = sb.from("transactions").select("*").order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.q) q = q.ilike("transaction_reference", "%" + filters.q + "%");
    const { data, error } = await q; // RLS limits results to this customer
    more.disabled = false;
    if (error) { note.textContent = "Impossible de charger l’historique. Réessayez."; note.hidden = false; more.hidden = true; return; }
    if (reset && !data.length) {
      const tr = document.createElement("tr"); const td = cell(tr, "Aucune transaction trouvée."); td.colSpan = 8; body.append(tr);
    }
    data.forEach((t) => {
      const tr = document.createElement("tr");
      cell(tr, t.transaction_reference);
      cell(tr, new Date(t.created_at).toLocaleDateString("fr-FR"));
      cell(tr, SERVICE[t.service_type] || t.service_type);
      cell(tr, METHOD[t.payment_method] || t.payment_method);
      cell(tr, money(t.sender_amount, t.sender_currency));
      cell(tr, money(t.service_fee, t.sender_currency));
      cell(tr, STATUS[t.status] || t.status);
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn"; b.textContent = "Détails";
      b.addEventListener("click", () => openDetail(t));
      cell(tr, "").append(b);
      body.append(tr);
    });
    more.hidden = data.length < PAGE;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    filters = {
      status: form.elements.status.value,
      q: form.elements.q.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase(), // no LIKE wildcards from the user
    };
    load(true);
  });
  more.addEventListener("click", () => { page += 1; load(false); });
  load(true);
})();
