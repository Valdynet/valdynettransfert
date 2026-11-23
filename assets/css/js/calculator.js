// Display only. Every number comes from POST /api/calculate (central service in netlify/functions/_lib/finance.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const f = { service: $("service"), method: $("method"), amount: $("amount"), currency: $("currency") };
  const CUR = { paypal: "USD", wise: "USD", moncash: "HTG", natcash: "HTG" };
  const ERR = {
    SERVICE_UNAVAILABLE: "Ce service n’est pas disponible.",
    METHOD_UNAVAILABLE: "Ce moyen de paiement n’est pas disponible.",
    INVALID_AMOUNT: "Entrez un montant valide.",
    BELOW_MINIMUM: "Montant minimum : 10 USD ou l’équivalent en HTG.",
  };
  const money = (n, c) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: c }).format(n);
  const cells = ["r-amount", "r-rate", "r-conv", "r-fee", "r-pfee", "r-total", "r-recv"].map($);
  const err = $("calc-error");

  const show = (msg) => {
    err.textContent = msg;
    err.hidden = !msg;
    if (msg) cells.forEach((c) => (c.textContent = "–"));
  };

  const render = (d) => {
    if (!d.ok) return show(ERR[d.error] || "Calcul impossible. Vérifiez les champs.");
    show("");
    const [a, r, c, fee, pf, t, rc] = cells;
    a.textContent = money(d.senderAmount, d.senderCurrency);
    r.textContent = "1 USD = " + d.exchangeRate + " HTG";
    c.textContent = money(d.convertedAmount, d.recipientCurrency);
    fee.textContent = money(d.serviceFee, d.senderCurrency) + " (" + d.feeRate * 100 + " %)";
    pf.textContent = d.providerFeePending ? "À confirmer" : money(d.providerFee, d.senderCurrency);
    t.textContent = money(d.totalAmount, d.senderCurrency);
    rc.textContent = money(d.recipientAmount, d.recipientCurrency);
  };

  let seq = 0;
  const run = async () => {
    f.currency.value = CUR[f.method.value];
    const id = ++seq;
    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: f.service.value, method: f.method.value, amount: Number(f.amount.value) }),
      });
      const d = await res.json();
      if (id === seq) render(d);
    } catch {
      if (id === seq) show("Service de calcul indisponible. Réessayez dans un instant.");
    }
  };

  let timer;
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  Object.values(f).forEach((el) => el.addEventListener("input", later));
  $("calc").addEventListener("submit", (e) => e.preventDefault());
  run();
})();
