"use strict";
const { DEFAULT_CONFIG } = require("./finance");
const { db } = require("./common");

let cache = { at: 0, cfg: null };
const flagsFor = (keys, src) => Object.fromEntries(Object.keys(keys).map((k) => [k, !!src && src[k] === true])); // missing => disabled

// Rates, fees, provider fees and availability come from financial_settings (single source of truth).
// Without Supabase env vars (local demo only) DEFAULT_CONFIG is used; if Supabase IS configured
// and unreachable we fail instead of silently falling back to defaults.
// The cache lasts 30 s, so a settings change can take up to 30 s to reach every function instance.
async function getConfig() {
  if (cache.cfg && Date.now() - cache.at < 30000) return cache.cfg;
  let cfg = DEFAULT_CONFIG;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data, error } = await db().from("financial_settings").select("*").eq("singleton", true).single();
    if (error || !data) throw new Error("SETTINGS_UNAVAILABLE");
    const enabled = flagsFor(DEFAULT_CONFIG.methods, data.methods_enabled);
    cfg = {
      ...DEFAULT_CONFIG,
      depositRate: Number(data.deposit_rate),
      withdrawalRate: Number(data.withdrawal_rate),
      minimumUsd: Number(data.minimum_amount),
      lowFeeRate: Number(data.low_fee_rate),
      highFeeRate: Number(data.high_fee_rate),
      feeThresholdUsd: Number(data.fee_threshold),
      providerFees: Object.fromEntries(Object.keys(DEFAULT_CONFIG.providerFees).map((k) => {
        const v = data.provider_fees && data.provider_fees[k];
        return [k, v == null ? null : Number(v)];
      })),
      services: flagsFor(DEFAULT_CONFIG.services, data.services_enabled),
      methods: Object.fromEntries(Object.entries(DEFAULT_CONFIG.methods).map(([k, m]) => [k, { ...m, enabled: enabled[k] }])),
    };
  }
  cache = { at: Date.now(), cfg };
  return cfg;
}

module.exports = { getConfig };
