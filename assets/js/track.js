(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const f = $("f-track"), out = $("t-out"), note = f.querySelector(".note"), err = f.querySelector(".err");
  const STATUS = { pending: "En attente", pending_verification: "Vérification en cours", payment_received: "Paiement reçu",
    processing: "En traitement", completed: "Terminée", cancelled: "Annulée", rejected: "Rejetée", refunded: "Remboursée" };
  const SERVICE = { deposit: "Dépôt", withdrawal: "Retrait", wallet_transfer: "Portefeuille à portefeuille", international: "International" };
  const say = (t, ok) => { note.textContent = t; note.className = ok ? "note" : "error"; };

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    out.hidden = true;
    say("", true);
    const reference = f.elements.reference.value.trim().toUpperCase();
    err.textContent = reference ? "" : "Entrez un identifiant.";
    if (!reference) return;
    try {
      const res = await fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }) });
      const d = await res.json();
      if (res.status === 429) return say("Trop de demandes. Réessayez dans quelques minutes.", false);
      if (!d.ok) return say(res.status === 404 ? "Aucune transaction trouvée pour cet identifiant." : "Service indisponible. Réessayez plus tard.", false);
      $("t-ref").textContent = d.reference;
      $("t-date").textContent = new Date(d.createdAt).toLocaleString("fr-FR");
      $("t-service").textContent = SERVICE[d.service] || d.service;
      $("t-amount").textContent = new Intl.NumberFormat("fr-FR", { style: "currency", currency: d.currency }).format(d.amount);
      $("t-status").textContent = STATUS[d.status] || d.status;
      $("t-upd").textContent = new Date(d.updatedAt).toLocaleString("fr-FR");
      out.hidden = false;
    } catch {
      say("Erreur réseau. Réessayez.", false);
    }
  });
})();
