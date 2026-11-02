
const DEFAULT_FINANCIAL_SETTINGS = {
  depositRate: 140,
  withdrawRate: 130,
  lowRate: 5,
  highRate: 10,
  threshold: 30,
  minimum: 10
};

function getFinancialSettings() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("valdynetFinancialSettings") || "{}"
    );

    return {
      ...DEFAULT_FINANCIAL_SETTINGS,
      ...saved
    };
  } catch {
    return DEFAULT_FINANCIAL_SETTINGS;
  }
}

// Frè Valdynet: 5% jiska $30, 10% sou tout montan
// lè tranzaksyon an depase $30.
function calculateValdynetFee(amountUSD) {
  const settings = getFinancialSettings();

  if (!Number.isFinite(amountUSD) || amountUSD < settings.minimum) {
    throw new Error(
      `Minimum transaction is $${settings.minimum} USD.`
    );
  }

  const rate = amountUSD <= settings.threshold
    ? settings.lowRate / 100
    : settings.highRate / 100;

  return Number((amountUSD * rate).toFixed(2));
}

// To echanj diferan pou depo ak retrè.
function convertCurrency(amount, fromCurrency, toCurrency, operation) {
  const settings = getFinancialSettings();

  let rate;

  if (operation === "deposit") {
    rate = settings.depositRate;
  } else if (operation === "withdraw") {
    rate = settings.withdrawRate;
  } else {
    throw new Error("Unknown transaction operation.");
  }

  if (fromCurrency === toCurrency) {
    return Number(amount.toFixed(2));
  }

  if (fromCurrency === "USD" && toCurrency === "HTG") {
    return Number((amount * rate).toFixed(2));
  }

  if (fromCurrency === "HTG" && toCurrency === "USD") {
    return Number((amount / rate).toFixed(2));
  }

  throw new Error("Unsupported currency conversion.");
}

// Rezime montan kliyan an.
function calculateTransaction(amountUSD, operation) {
  const settings = getFinancialSettings();
  const valdynetFee = calculateValdynetFee(amountUSD);

  const exchangeRate = operation === "deposit"
    ? settings.depositRate
    : settings.withdrawRate;

  return {
    originalAmountUSD: Number(amountUSD.toFixed(2)),
    exchangeRate,
    convertedAmountHTG: Number((amountUSD * exchangeRate).toFixed(2)),
    valdynetFeeUSD: valdynetFee,
    providerFeeUSD: 0,
    totalBeforeProviderFeesUSD: Number(
      (amountUSD + valdynetFee).toFixed(2)
    )
  };
}
