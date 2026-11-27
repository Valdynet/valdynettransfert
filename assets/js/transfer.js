(async () => {
  "use strict";
  const A = window.VTAuth;
  const $ = (id) => document.getElementById(id);
  const ctx = await A.requireUser();
  if (!ctx) return;
  const { sb, user, profile } = ctx;
  const f = $("calc"), note = $("tx-note");

  f.elements.fullname.value = [profile && profile.first_name, profile && profile.last_name].filter(Boolean).join(" ");
  f.elements.email.value = user.email;
  f.elements.phone.value = (profile && profile.phone) || "";

  let idem = crypto.randomUUID(); // same key on retry => the server never creates two transactions
  const say = (t, ok) => { note.textContent = t; note.className = ok ? "note" : "error"; };
  const ERR = {
    RATE_LIMITED: "Trop de demandes. Patientez une minute.",
    EMAIL_NOT_VERIFIED: "Confirmez d’abord votre e-mail.",
    UNAUTHENTICATED: "Session expirée. Reconnectez-vous.",
    ACCOUNT_UNAVAILABLE: "Votre compte ne peut pas créer de transaction.",
    BELOW_MINIMUM: "Montant minimum : 10 USD ou l’équivalent en HTG.",
    INVALID_AMOUNT: "Entrez un montant valide.",
    SERVICE_UNAVAILABLE: "Ce service n’est pas disponible.",
    METHOD_UNAVAILABLE: "Ce moyen de paiement n’est pas disponible.",
  };

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!A.validate(f)) return;
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    say("", true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch("/api/create-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({
          service: $("service").value, method: $("method").value, amount: Number($("amount").value),
          recipientName: f.elements.rname.value, recipientContact: f.elements.rcontact.value, notes: f.elements.notes.value,
          confirmed: f.elements.confirm.checked, idempotencyKey: idem,
        }),
      });
      const d = await res.json();
      if (!d.ok) return say(ERR[d.error] || "Création impossible. Réessayez.", false);
      idem = crypto.randomUUID();
      location.assign("/customer/pay.html?ref=" + encodeURIComponent(d.reference)); // next step: pay
    } catch {
      say("Erreur réseau. Réessayez.", false);
    } finally {
      btn.disabled = false;
    }
  });
})();
