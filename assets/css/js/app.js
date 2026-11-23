(() => {
  // --- Language (FR default, Haitian Creole) ---
  const HT = {
    "nav.home": "Akèy", "nav.services": "Sèvis", "nav.how": "Kijan li mache", "nav.fees": "Frè",
    "nav.contact": "Kontak", "nav.account": "Espas kliyan",
    "hero.sub": "Voye, resevwa epi chanje USD ak HTG fasil, ak frè yo make anvan w peye.",
    "calc.title": "Kalkile transfè ou a", "calc.service": "Sèvis", "calc.method": "Metòd peman",
    "calc.amount": "Montan", "calc.currency": "Lajan",
    "r.amount": "Montan inisyal", "r.rate": "To chanj", "r.conv": "Montan konvèti",
    "r.fee": "Frè Valdynet", "r.pfee": "Frè founisè a", "r.total": "Total pou peye",
    "r.recv": "Moun k ap resevwa a jwenn", "auth.in": "Konekte", "auth.up": "Kreye yon kont",
  };
  const lang = document.getElementById("lang");
  lang.addEventListener("change", () => {
    document.documentElement.lang = lang.value;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.dataset.fr ??= el.textContent;
      el.textContent = lang.value === "ht" ? HT[el.dataset.i18n] ?? el.dataset.fr : el.dataset.fr;
    });
  });

  // --- Auth tabs ---
  const tabs = [...document.querySelectorAll("[role=tab]")];
  const select = (tab) => tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      select(n); n.focus();
    });
  });

  // --- Client-side validation (UX only; Supabase Auth + server checks come in Phase 2) ---
  const rules = {
    required: (v) => v.trim() !== "" || "Champ obligatoire.",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || "Adresse e-mail invalide.",
    password: (v) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(v) || "8 caractères minimum, avec majuscule, minuscule et chiffre.",
  };
  document.querySelectorAll("form[data-auth]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let ok = true;
      form.querySelectorAll("[data-rule]").forEach((el) => {
        const rule = el.dataset.rule;
        const r = rule === "match" ? el.value === form.elements.password.value || "Les mots de passe ne correspondent pas."
          : rule === "checked" ? el.checked || "Vous devez accepter les conditions."
          : rules[rule](el.value);
        const out = el.closest("label").querySelector(".err");
        out.textContent = r === true ? "" : r;
        el.setAttribute("aria-invalid", r !== true);
        if (r !== true) ok = false;
      });
      form.querySelector(".note").textContent = ok
        ? "Champs valides. La connexion à Supabase Auth arrive en Phase 2 : aucun compte n’est créé pour l’instant."
        : "";
    });
  });
})();
