const DEFAULT_SETTINGS = {
  targetCurrency: "USD",
  serverBaseUrl: "http://localhost:8787",
  autoConvert: false,
  autoConvertDomainWhitelist: [],
  autoConvertDomainBlacklist: [],
  autoConvertCurrencyWhitelist: [],
  autoConvertCurrencyBlacklist: []
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const updates = {};

  if (!existing.targetCurrency) {
    updates.targetCurrency = DEFAULT_SETTINGS.targetCurrency;
  }
  if (!existing.serverBaseUrl) {
    updates.serverBaseUrl = DEFAULT_SETTINGS.serverBaseUrl;
  }
  if (typeof existing.autoConvert !== "boolean") {
    updates.autoConvert = DEFAULT_SETTINGS.autoConvert;
  }
  if (!Array.isArray(existing.autoConvertDomainWhitelist)) {
    updates.autoConvertDomainWhitelist = DEFAULT_SETTINGS.autoConvertDomainWhitelist;
  }
  if (!Array.isArray(existing.autoConvertDomainBlacklist)) {
    updates.autoConvertDomainBlacklist = DEFAULT_SETTINGS.autoConvertDomainBlacklist;
  }
  if (!Array.isArray(existing.autoConvertCurrencyWhitelist)) {
    updates.autoConvertCurrencyWhitelist = DEFAULT_SETTINGS.autoConvertCurrencyWhitelist;
  }
  if (!Array.isArray(existing.autoConvertCurrencyBlacklist)) {
    updates.autoConvertCurrencyBlacklist = DEFAULT_SETTINGS.autoConvertCurrencyBlacklist;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "getSettings") {
    chrome.storage.sync
      .get(DEFAULT_SETTINGS)
      .then((settings) => {
        sendResponse({
          ok: true,
          settings: normalizeSettings(settings)
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to load settings"
        });
      });
    return true;
  }

  if (message.type === "convertCurrency") {
    convertCurrency(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Failed to convert currency"
        });
      });
    return true;
  }

  return undefined;
});

function normalizeSettings(settings) {
  return {
    targetCurrency: String(settings.targetCurrency || DEFAULT_SETTINGS.targetCurrency)
      .trim()
      .toUpperCase(),
    serverBaseUrl: String(settings.serverBaseUrl || DEFAULT_SETTINGS.serverBaseUrl)
      .trim()
      .replace(/\/+$/, ""),
    autoConvert: Boolean(settings.autoConvert),
    autoConvertDomainWhitelist: normalizeDomainList(
      settings.autoConvertDomainWhitelist
    ),
    autoConvertDomainBlacklist: normalizeDomainList(
      settings.autoConvertDomainBlacklist
    ),
    autoConvertCurrencyWhitelist: normalizeCurrencyList(
      settings.autoConvertCurrencyWhitelist
    ),
    autoConvertCurrencyBlacklist: normalizeCurrencyList(
      settings.autoConvertCurrencyBlacklist
    )
  };
}

function normalizeDomainList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const entry of value) {
    const normalized = normalizeDomainRule(entry);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function normalizeDomainRule(value) {
  if (!value) {
    return "";
  }

  let normalized = String(value).trim().toLowerCase();
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

function normalizeCurrencyList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const entry of value) {
    const normalized = String(entry || "")
      .trim()
      .toUpperCase();
    if (/^[A-Z]{3}$/.test(normalized)) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

async function convertCurrency(payload) {
  const amount = Number(payload?.amount);
  const fromCurrency = String(payload?.fromCurrency || "")
    .trim()
    .toUpperCase();
  const toCurrency = String(payload?.toCurrency || "")
    .trim()
    .toUpperCase();

  if (!Number.isFinite(amount)) {
    throw new Error("Invalid amount");
  }
  if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
    throw new Error("Invalid currency code");
  }

  const settings = normalizeSettings(await chrome.storage.sync.get(DEFAULT_SETTINGS));
  const requestUrl = new URL("/api/convert", settings.serverBaseUrl);
  requestUrl.searchParams.set("amount", String(amount));
  requestUrl.searchParams.set("from", fromCurrency);
  requestUrl.searchParams.set("to", toCurrency);

  const response = await fetch(requestUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    const message = body?.error || `Server request failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}
