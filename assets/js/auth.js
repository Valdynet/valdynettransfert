(() => {
  "use strict";
  const ADMIN_HOME = null; // Phase 4: "/admin/dashboard.html"

  const rules = {
    required: (v) => v.trim() !== "" || "Champ obligatoire.",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || "Adresse e-mail invalide.",
    password: (v) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(v) || "8 caractères minimum, avec majuscule, minuscule et chiffre.",
  };

  function validate(form) {
    let ok = true;
    form.querySelectorAll("[data-rule]").forEach((el) => {
      const rule = el.dataset.rule;
      const r = rule === "match" ? el.value === form.elements.password.value || "Les mots de passe ne correspondent pas."
        : rule === "checked" ? el.checked || "Cette case doit être cochée."
        : rules[rule](el.value);
      el.closest("label").querySelector(".err").textContent = r === true ? "" : r;
      el.setAttribute("aria-invalid", r !== true);
      if (r !== true) ok = false;
    });
    return ok;
  }

  let client = null;
  async function getClient() {
    if (client) return client;
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("CONFIG");
    const c = await res.json();
    // Only the Supabase session token is stored (never a password). "Remember me" off => tab-only session.
    const store = localStorage.getItem("vt_remember") === "0" ? sessionStorage : localStorage;
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { storage: store, persistSession: true, autoRefreshToken: true },
    });
    return client;
  }

  const friendly = (e) => {
    const m = (e && e.message) || "";
    if (/Invalid login/i.test(m)) return "E-mail ou mot de passe incorrect.";
    if (/not confirmed/i.test(m)) return "Confirmez d’abord votre e-mail : ouvrez le lien reçu dans votre boîte de réception.";
    if (/rate limit|too many/i.test(m)) return "Trop de tentatives. Réessayez dans quelques minutes.";
    if (/CONFIG/.test(m)) return "Le service d’authentification n’est pas encore configuré.";
    return "Opération impossible pour le moment. Réessayez.";
  };

  // The role is read from the database (RLS-protected, not editable by the user).
  // Admin pages re-verify it on the server in Phase 4.
  async function home(sb, user) {
    const { data } = await sb.from("profiles").select("role").eq("id", user.id).single();
    return data && data.role === "admin" && ADMIN_HOME ? ADMIN_HOME : "/customer/dashboard.html";
  }

  async function submit(form) {
    const note = form.querySelector(".note");
    const btn = form.querySelector("button[type=submit]");
    const say = (t, ok) => { note.textContent = t; note.className = ok ? "note" : "error"; };
    const v = (n) => form.elements[n].value.trim();
    btn.disabled = true;
    say("", true);
    try {
      const isUp = form.closest("[role=tabpanel]").id === "panel-up";
      if (!isUp) {
        localStorage.setItem("vt_remember", form.elements.remember.checked ? "1" : "0");
        client = null;
      }
      const sb = await getClient();
      if (isUp) {
        const { error } = await sb.auth.signUp({
          email: v("email"),
          password: form.elements.password.value,
          options: {
            emailRedirectTo: location.origin + "/index.html",
            data: { first_name: v("first"), last_name: v("last"), phone: v("phone"), country: form.elements.country.value },
          },
        });
        if (error) throw error;
        form.reset();
        // Same message whether or not the e-mail already exists (no account enumeration).
        say("Si l’adresse est valide, un e-mail de confirmation vient d’être envoyé. Ouvrez-le pour activer votre compte.", true);
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email: v("email"), password: form.elements.password.value });
        if (error) throw error;
        location.href = await home(sb, data.user);
      }
    } catch (e) {
      say(friendly(e), false);
    } finally {
      btn.disabled = false;
    }
  }

  async function requireUser() {
    const sb = await getClient();
    const { data } = await sb.auth.getUser(); // verified with the Auth server, not just read from storage
    const user = data && data.user;
    if (!user) { location.replace("/index.html#auth"); return null; }
    const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).single();
    return { sb, user, profile };
  }

  async function logout() {
    const sb = await getClient();
    await sb.auth.signOut();
    location.replace("/index.html");
  }

  // --- forgot-password.html: request link, then set new password after the e-mail link ---
  const reqForm = document.getElementById("f-reset");
  const newForm = document.getElementById("f-newpass");
  if (reqForm && newForm) {
    const say = (f, t, ok) => { const n = f.querySelector(".note"); n.textContent = t; n.className = ok ? "note" : "error"; };
    reqForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validate(reqForm)) return;
      try {
        const sb = await getClient();
        await sb.auth.resetPasswordForEmail(reqForm.elements.email.value.trim(), { redirectTo: location.origin + "/forgot-password.html" });
        say(reqForm, "Si cette adresse existe, un lien de réinitialisation vient d’être envoyé.", true);
      } catch (err) { say(reqForm, friendly(err), false); }
    });
    getClient().then((sb) => sb.auth.onAuthStateChange((ev) => {
      if (ev === "PASSWORD_RECOVERY") { reqForm.hidden = true; newForm.hidden = false; }
    })).catch(() => {});
    newForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validate(newForm)) return;
      try {
        const sb = await getClient();
        const { error } = await sb.auth.updateUser({ password: newForm.elements.password.value });
        if (error) throw error;
        say(newForm, "Mot de passe mis à jour. Redirection…", true);
        setTimeout(() => location.assign("/customer/dashboard.html"), 1200);
      } catch (err) { say(newForm, friendly(err), false); }
    });
  }

  window.VTAuth = { rules, validate, submit, requireUser, logout, getClient, friendly };
})();
