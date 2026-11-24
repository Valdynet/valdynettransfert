"use strict";
const { DEFAULT_CONFIG } = require("./finance");
const { db } = require("./common");

let cache = { at: 0, cfg: null };

// Rates and fees come from the financial_settings table (single source of truth).
// Without Supabase env vars (local demo only) DEFAULT_CONFIG is used; if Supabase IS configured
// and unreachable we fail instead of silently falling back to defaults.
async function getConfig() {
  if (cache.cfg && Date.now() - cache.at < 30000) return cache.cfg;
  let cfg = DEFAULT_CONFIG;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data, error } = await db().from("financial_settings").select("*").eq("singleton", true).single();
    if (error || !data) throw new Error("SETTINGS_UNAVAILABLE");
    cfg = {
      ...DEFAULT_CONFIG,
      depositRate: Number(data.deposit_rate),
      withdrawalRate: Number(data.withdrawal_rate),
      minimumUsd: Number(data.minimum_amount),
      lowFeeRate: Number(data.low_fee_rate),
      highFeeRate: Number(data.high_fee_rate),
      feeThresholdUsd: Number(data.fee_threshold),
    };
  }
  cache = { at: Date.now(), cfg };
  return cfg;
}

module.exports = { getConfig };
