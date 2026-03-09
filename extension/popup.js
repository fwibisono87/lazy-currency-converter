const DEFAULT_SETTINGS = {
  targetCurrency: "USD",
  serverBaseUrl: "http://localhost:8787",
  autoConvert: false,
  autoConvertDomainWhitelist: [],
  autoConvertDomainBlacklist: [],
  autoConvertCurrencyWhitelist: [],
  autoConvertCurrencyBlacklist: []
};

const CURRENCY_CODES = [
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "CNY",
  "CAD",
  "AUD",
  "INR",
  "KRW",
  "IDR",
  "SGD",
  "CHF",
  "HKD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "MXN",
  "BRL",
  "RUB",
  "TRY",
  "THB",
  "PHP",
  "VND",
  "PLN",
  "ILS",
  "UAH",
  "MYR",
  "ZAR"
];

const form = document.getElementById("settingsForm");
const targetCurrencySelect = document.getElementById("targetCurrency");
const autoConvertInput = document.getElementById("autoConvert");
const domainWhitelistInput = document.getElementById("domainWhitelist");
const domainBlacklistInput = document.getElementById("domainBlacklist");
const currencyWhitelistInput = document.getElementById("currencyWhitelist");
const currencyBlacklistInput = document.getElementById("currencyBlacklist");
const serverBaseUrlInput = document.getElementById("serverBaseUrl");
const statusElement = document.getElementById("status");

init().catch((error) => {
  setStatus(error instanceof Error ? error.message : "Initialization failed");
});

async function init() {
  populateCurrencyList();
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  targetCurrencySelect.value = String(settings.targetCurrency || "USD")
    .trim()
    .toUpperCase();
  autoConvertInput.checked = Boolean(settings.autoConvert);
  domainWhitelistInput.value = (settings.autoConvertDomainWhitelist || []).join("\n");
  domainBlacklistInput.value = (settings.autoConvertDomainBlacklist || []).join("\n");
  currencyWhitelistInput.value = (settings.autoConvertCurrencyWhitelist || []).join(", ");
  currencyBlacklistInput.value = (settings.autoConvertCurrencyBlacklist || []).join(", ");
  serverBaseUrlInput.value = String(
    settings.serverBaseUrl || DEFAULT_SETTINGS.serverBaseUrl
  )
    .trim()
    .replace(/\/+$/, "");

  form.addEventListener("submit", onSubmit);
}

function populateCurrencyList() {
  targetCurrencySelect.innerHTML = "";
  for (const currencyCode of CURRENCY_CODES) {
    const option = document.createElement("option");
    option.value = currencyCode;
    option.textContent = currencyCode;
    targetCurrencySelect.append(option);
  }
}

async function onSubmit(event) {
  event.preventDefault();

  const targetCurrency = String(targetCurrencySelect.value || "USD")
    .trim()
    .toUpperCase();
  const autoConvert = Boolean(autoConvertInput.checked);
  const autoConvertDomainWhitelist = parseDomainList(domainWhitelistInput.value);
  const autoConvertDomainBlacklist = parseDomainList(domainBlacklistInput.value);
  const autoConvertCurrencyWhitelist = parseCurrencyList(currencyWhitelistInput.value);
  const autoConvertCurrencyBlacklist = parseCurrencyList(currencyBlacklistInput.value);
  const serverBaseUrl = String(serverBaseUrlInput.value || "")
    .trim()
    .replace(/\/+$/, "");

  if (!/^[A-Z]{3}$/.test(targetCurrency)) {
    setStatus("Target currency must be a valid 3-letter code.");
    return;
  }
  if (!/^https?:\/\//.test(serverBaseUrl)) {
    setStatus("Server URL must start with http:// or https://");
    return;
  }

  await chrome.storage.sync.set({
    targetCurrency,
    autoConvert,
    autoConvertDomainWhitelist,
    autoConvertDomainBlacklist,
    autoConvertCurrencyWhitelist,
    autoConvertCurrencyBlacklist,
    serverBaseUrl
  });
  setStatus("Settings saved.");
}

function parseDomainList(rawValue) {
  const entries = String(rawValue || "")
    .split(/[\n,]/)
    .map((entry) => normalizeDomainRule(entry))
    .filter(Boolean);
  return Array.from(new Set(entries));
}

function normalizeDomainRule(value) {
  let normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  normalized = normalized.replace(/^https?:\/\//, "");
  normalized = normalized.split("/")[0];
  if (normalized.startsWith("*.")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/^\.+/, "").replace(/\.+$/, "");
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function parseCurrencyList(rawValue) {
  const entries = String(rawValue || "")
    .split(/[\s,]+/)
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter((entry) => /^[A-Z]{3}$/.test(entry));
  return Array.from(new Set(entries));
}

function setStatus(message) {
  statusElement.textContent = message;
}
