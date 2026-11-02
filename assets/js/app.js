
/* =====================================
   VALDYNET TRANSFERT
   Main JavaScript
===================================== */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("transaction-form");
  const message = document.getElementById("form-message");
  const submitButton = form?.querySelector('button[type="submit"]');
  const yearElement = document.getElementById("current-year");

  // Afficher automatiquement l'année actuelle
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  if (!form || !message || !submitButton) {
    console.error("Le formulaire de transaction est introuvable.");
    return;
  }

  let isSubmitting = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    // Vérifier les champs obligatoires
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);

    const transaction = {
      customer_name: String(formData.get("fullName") || "").trim(),
      customer_email: String(formData.get("email") || "").trim(),
      customer_phone: String(formData.get("phone") || "").trim(),
      service_code: String(formData.get("service") || ""),
      amount: Number(formData.get("amount")),
      currency: String(formData.get("currency") || ""),
      account_details: String(formData.get("accountDetails") || "").trim(),
      notes: String(formData.get("notes") || "").trim()
    };

    // Vérification des données
    if (
      !transaction.customer_name ||
      !transaction.customer_email ||
      !transaction.customer_phone ||
      !transaction.service_code ||
      !Number.isFinite(transaction.amount) ||
      transaction.amount <= 0 ||
      !["USD", "HTG"].includes(transaction.currency) ||
      !transaction.account_details
    ) {
      message.textContent = "Veuillez vérifier toutes les informations.";
      return;
    }

    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Envoi en cours...";
    message.textContent = "";

    try {
      /*
       * Le backend Netlify sera connecté ici.
       * Ne pas enregistrer directement les transactions
       * depuis le navigateur dans Supabase.
       */

      message.textContent =
        "Le formulaire est prêt, mais le serveur de réception n'est pas encore connecté. Votre demande n'a pas été enregistrée.";

      console.log("Données validées pour le backend :", transaction);

    } catch (error) {
      console.error("Erreur :", error);
      message.textContent =
        "Une erreur est survenue. Veuillez réessayer.";
    } finally {
      isSubmitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Envoyer ma demande";
    }
  });
});
