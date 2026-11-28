(async () => {
  "use strict";
  const A = window.VTAuth;
  const $ = (id) => document.getElementById(id);
  const ctx = await A.requireUser();
  if (!ctx) return;
  const { sb } = ctx;
  const ref = (new URLSearchParams(location.search).get("ref") || "").toUpperCase();

  const STATUS = { pending: "En attente", pending_verification: "Vérification en cours", payment_received: "Paiement reçu", processing: "En traitement",
    completed: "Terminée", cancelled: "Annulée", rejected: "Rejetée", refunded: "Remboursée" };
  const METHOD = { paypal: "PayPal", wise: "Wise", moncash: "MonCash", natcash: "NatCash" };
  const ERR = {
    RATE_LIMITED: "Trop de demandes. Patientez une minute.", NOT_PAYABLE: "Cette transaction ne peut plus être payée.",
    PAYMENT_ALREADY_ACTIVE: "Un paiement est déjà en cours pour cette transaction.", NOT_FOUND: "Transaction introuvable.",
    REFERENCE_ALREADY_USED: "Cet identifiant de transaction a déjà été utilisé.", NOT_ALLOWED: "Cette transaction ne peut plus être soumise.",
    INVALID_TRANSACTION_ID: "Identifiant invalide (4 à 64 caractères : lettres, chiffres, . _ -).",
    INVALID_PAYMENT_REFERENCE: "Référence de paiement invalide.", INVALID_PROOF: "Preuve de paiement invalide.",
    EMAIL_NOT_VERIFIED: "Confirmez d’abord votre e-mail.",
  };
  const money = (n, c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: c }).format(n);
  const mkp = (t) => { const p = document.createElement("p"); p.textContent = t; return p; };
  const fail = (t) => { $("pay-err").textContent = t; $("pay-err").hidden = false; };
  // Optional WhatsApp contact, offered only after a PayPal payment or a submitted manual payment. Carries only the reference.
  async function whatsapp() {
    const c = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (!/^\d{8,15}$/.test(c.whatsappNumber || "")) return;
    const a = document.createElement("a");
    a.href = "https://wa.me/" + c.whatsappNumber + "?text=" + encodeURIComponent("Bonjour, je vous écris au sujet de ma transaction " + ref + ".");
    a.textContent = "Nous contacter sur WhatsApp"; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "btn";
    $("p-status").after(a);
  }
  const done = (t) => { whatsapp(); $("paypal-box").hidden = true; $("f-manual").hidden = true; $("pay-err").hidden = true; $("p-status").textContent = t; $("p-status").hidden = false; };

  async function post(url, body) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify(body) });
    return r.json().catch(() => ({ ok: false, error: "UNAVAILABLE" }));
  }

  const { data: tx } = await sb.from("transactions").select("transaction_reference,status,payment_method,total_amount,sender_currency")
    .eq("transaction_reference", ref).maybeSingle(); // RLS: only the customer's own transaction
  if (!tx) return fail("Transaction introuvable.");
  [["Transaction", tx.transaction_reference], ["Moyen de paiement", METHOD[tx.payment_method]], ["Total à payer", money(tx.total_amount, tx.sender_currency)], ["Statut", STATUS[tx.status] || tx.status]]
    .forEach(([k, v]) => { const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; d.append(dt, dd); $("p-sum").append(d); });
  if (tx.status !== "pending") { $("p-status").textContent = "Aucun paiement n’est requis pour l’instant (statut : " + (STATUS[tx.status] || tx.status) + ")."; $("p-status").hidden = false; return; }

  if (tx.payment_method === "paypal") {
    const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (!cfg.paypalClientId) return fail("PayPal n’est pas encore configuré.");
    $("paypal-box").hidden = false;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(cfg.paypalClientId) + "&currency=USD&intent=capture";
      s.onload = res; s.onerror = rej; document.head.append(s);
    }).catch(() => fail("Impossible de charger PayPal."));
    if (!window.paypal) return;
    window.paypal.Buttons({
      createOrder: async () => {
        $("pay-err").hidden = true;
        const d = await post("/api/paypal-create-order", { reference: ref }); // amount is never sent by the browser
        if (!d.ok) { fail(ERR[d.error] || "Paiement impossible. Réessayez."); throw new Error(d.error); }
        return d.orderId;
      },
      onApprove: async (data) => {
        const d = await post("/api/paypal-capture-order", { orderId: data.orderID });
        if (d.ok && !d.pending) done("Paiement reçu. Votre transaction " + ref + " est en cours de traitement.");
        else if (d.ok) done("Paiement en attente de confirmation par PayPal.");
        else fail("Le paiement n’a pas pu être vérifié. Ne payez pas une seconde fois : contactez-nous avec la référence " + ref + ".");
      },
      onCancel: () => fail("Paiement annulé. Vous pouvez réessayer."),
      onError: () => fail("Erreur PayPal. Réessayez."),
    }).render("#paypal-buttons");
    return;
  }

  // Manual methods (Wise, MonCash, NatCash): stays "Vérification en cours" until an admin approves.
  const info = await post("/api/manual-payment", { action: "info", reference: ref });
  if (!info.ok) return fail(ERR[info.error] || "Instructions indisponibles. Réessayez.");
  const box = $("m-instr");
  box.append(mkp("Envoyez exactement " + money(info.amount, info.currency) + " avec " + METHOD[info.method] + ", puis renseignez les références ci-dessous."));
  if (!info.instructions) box.append(mkp("Les instructions de paiement ne sont pas encore configurées : contactez-nous avant de payer."));
  else if (info.method === "wise") String(info.instructions).split("\n").forEach((l) => box.append(mkp(l)));
  else box.append(mkp("Numéro " + METHOD[info.method] + " : " + info.instructions));
  $("f-manual").hidden = false;

  const form = $("f-manual"), note = $("m-note");
  const say = (t, ok) => { note.textContent = t; note.className = ok ? "note" : "error"; };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!A.validate(form)) return;
    const file = form.elements.proof.files[0];
    const fileErr = form.elements.proof.closest("label").querySelector(".err");
    fileErr.textContent = "";
    if (file && (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      fileErr.textContent = "Fichier JPG, PNG ou PDF de 5 Mo maximum."; return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true; say("", true);
    try {
      let proofPath = null;
      if (file) {
        const up = await post("/api/manual-payment", { action: "upload_url", reference: ref, contentType: file.type });
        if (!up.ok) return say(ERR[up.error] || "Envoi de la preuve impossible.", false);
        const { error } = await sb.storage.from("payment-proofs").uploadToSignedUrl(up.path, up.token, file, { contentType: file.type });
        if (error) return say("Envoi de la preuve impossible. Réessayez.", false);
        proofPath = up.path;
      }
      const d = await post("/api/manual-payment", { action: "submit", reference: ref, providerTransactionId: form.elements.txid.value, paymentReference: form.elements.payref.value, proofPath });
      if (!d.ok) return say(ERR[d.error] || "Envoi impossible. Réessayez.", false);
      done("Paiement soumis. Il est en cours de vérification par notre équipe ; vous serez informé du résultat.");
    } catch { say("Erreur réseau. Réessayez.", false); } finally { btn.disabled = false; }
  });
})();
