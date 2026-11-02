
"use strict";

/*
 * VALDYNET TRANSFERT
 * JavaScript jeneral sit la.
 *
 * Vèsyon sa a prepare fonksyon debaz yo.
 * Li poko konekte ak Supabase oswa Netlify Functions.
 */

const ValdynetApp = (() => {

  const CONFIG = {
    brand: "Valdynet Transfert",
    storage: {
      financialSettings: "valdynetFinancialSettings",
      demoProfile: "valdynetDemoProfile"
    }
  };

  const DEFAULT_FINANCIAL_SETTINGS = Object.freeze({
    depositRate: 140,
    withdrawRate: 130,
    lowRate: 5,
    highRate: 10,
    threshold: 30,
    minimum: 10
  });

  function getFinancialSettings() {
    try {
      const saved = localStorage.getItem(
        CONFIG.storage.financialSettings
      );

      if (!saved) {
        return { ...DEFAULT_FINANCIAL_SETTINGS };
      }

      const parsed = JSON.parse(saved);

      return {
        ...DEFAULT_FINANCIAL_SETTINGS,
        ...parsed
      };
    } catch (error) {
      console.error("Financial settings error:", error);
      return { ...DEFAULT_FINANCIAL_SETTINGS };
    }
  }

  function formatMoney(amount, currency = "USD") {
    const safeCurrency = currency === "HTG" ? "HTG" : "USD";

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency
    }).format(Number(amount) || 0);
  }

  function formatDate(dateValue) {
    if (!dateValue) return "—";

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "—";
    }

    return new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function getElement(selector) {
    return document.querySelector(selector);
  }

  function setText(selector, value) {
    const element = getElement(selector);

    if (element) {
      element.textContent = value ?? "";
    }
  }

  function showMessage(selector, message) {
    setText(selector, message);
  }

  function validateEmail(email) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(String(email || "").trim());
  }

  function validatePhone(phone) {
    const cleaned = String(phone || "").trim();
    return cleaned.length >= 7 && cleaned.length <= 20;
  }

  function generateReference() {
    const randomPart = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();

    return `VT-${Date.now()}-${randomPart}`;
  }

  function getCurrentYear() {
    return new Date().getFullYear();
  }

  function updateCurrentYear() {
    document.querySelectorAll("#current-year").forEach(element => {
      element.textContent = getCurrentYear();
    });
  }

  function initialize() {
    updateCurrentYear();
  }

  return {
    CONFIG,
    DEFAULT_FINANCIAL_SETTINGS,
    getFinancialSettings,
    formatMoney,
    formatDate,
    getElement,
    setText,
    showMessage,
    validateEmail,
    validatePhone,
    generateReference,
    updateCurrentYear,
    initialize
  };

})();

document.addEventListener("DOMContentLoaded", () => {
  ValdynetApp.initialize();
});

/*
 * Fonksyon yo disponib sou lòt paj yo atravè:
 * ValdynetApp.formatMoney(...)
 * ValdynetApp.getFinancialSettings()
 * ValdynetApp.validateEmail(...)
 */
