"use strict";
/*
 * Central financial service: the ONLY place where rates, fees and totals are computed.
 * Used by the Netlify Function /api/calculate now, and by transaction creation in Phase 3.
 *
 * FEE POLICY "full_amount" (default, configurable later):
 *   the applicable % is applied to the WHOLE transaction amount (no tiers),
 *   based on its USD equivalent: 10..30 USD inclusive => lowFeeRate, above 30 => highFeeRate.
 *   The fee is added on top of the amount and expressed in the sender's currency.
 * Provider fees stay separate and are never counted as Valdynet revenue.
 * DEFAULT_CONFIG will be replaced by the financial_settings table (Phase 2/4).
 */
const DEFAULT_CONFIG = {
  depositRate: 140,      // 1 USD = 140 HTG
  withdrawalRate: 130,   // 1 USD = 130 HTG
  minimumUsd: 10,
  lowFeeRate: 0.05,
  highFeeRate: 0.10,
  feeThresholdUsd: 30,
  feePolicy: "full_amount",
  providerFees: { paypal: null, wise: null, moncash: null, natcash: null }, // null = "À confirmer"
  methods: {
    paypal: { currency: "USD", enabled: true },
    wise: { currency: "USD", enabled: true },
    moncash: { currency: "HTG", enabled: true },
    natcash: { currency: "HTG", enabled: true },
  },
  // Only configured routes are offered. Rates for the last two are not defined yet.
  services: { deposit: true, withdrawal: true, wallet_transfer: false, international: false },
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

function calculate(input, cfg = DEFAULT_CONFIG) {
  const service = input && input.service;
  const method = input && input.method;
  const amount = Number(input && input.amount);

  if (typeof service !== "string" || cfg.services[service] !== true) return fail("SERVICE_UNAVAILABLE");
  const m = typeof method === "string" && Object.hasOwn(cfg.methods, method) ? cfg.methods[method] : null;
  if (!m || !m.enabled) return fail("METHOD_UNAVAILABLE");
  if (!Number.isFinite(amount) || amount <= 0) return fail("INVALID_AMOUNT");

  const rate = service === "withdrawal" ? cfg.withdrawalRate : cfg.depositRate;
  const isUsd = m.currency === "USD";
  const usdEquivalent = isUsd ? amount : amount / rate;
  if (usdEquivalent < cfg.minimumUsd) return fail("BELOW_MINIMUM", { minimumUsd: cfg.minimumUsd });

  const feeRate = usdEquivalent <= cfg.feeThresholdUsd ? cfg.lowFeeRate : cfg.highFeeRate;
  const serviceFee = round2(amount * feeRate);
  const providerFee = cfg.providerFees[method];
  const converted = round2(isUsd ? amount * rate : amount / rate);

  return {
    ok: true,
    service,
    method,
    senderCurrency: m.currency,
    recipientCurrency: isUsd ? "HTG" : "USD",
    senderAmount: round2(amount),
    exchangeRate: rate,
    convertedAmount: converted,
    feeRate,
    serviceFee,
    providerFee: providerFee ?? null,
    providerFeePending: providerFee == null,
    totalAmount: round2(amount + serviceFee + (providerFee ?? 0)),
    recipientAmount: converted,
  };
}

module.exports = { calculate, DEFAULT_CONFIG, round2 };
