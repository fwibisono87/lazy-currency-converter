const http = require("node:http");
const { URL } = require("node:url");
const { CacheStore } = require("./cache-store");
const { getConfig, loadEnv } = require("./config");
const { ExchangeRateClient } = require("./exchange-rate-client");

loadEnv();
const config = getConfig();

if (!config.apiKey) {
  console.error(
    "EXCHANGERATE_API_KEY is missing. Add it in .env, then restart the server."
  );
  process.exit(1);
}

const cacheStore = new CacheStore(config.cacheFile);
const exchangeClient = new ExchangeRateClient({
  apiKey: config.apiKey,
  ttlMs: config.ttlMs,
  cacheStore
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function formatCurrency(value, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`;
  }
}

function toAmount(rawAmount) {
  const normalized = String(rawAmount || "")
    .trim()
    .replace(/,/g, "");
  return Number(normalized);
}

async function handleRequest(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, "http://localhost");

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "lazy-currency-converter-server",
      cacheFile: config.cacheFile,
      ttlHours: config.ttlHours
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/convert") {
    const rawAmount = requestUrl.searchParams.get("amount");
    const fromCurrency = normalizeCurrency(requestUrl.searchParams.get("from"));
    const toCurrency = normalizeCurrency(requestUrl.searchParams.get("to"));

    const amount = toAmount(rawAmount);
    if (!Number.isFinite(amount)) {
      sendJson(response, 400, {
        ok: false,
        error: "Invalid amount. Example: amount=79200.50"
      });
      return;
    }

    if (!/^[A-Z]{3}$/.test(fromCurrency) || !/^[A-Z]{3}$/.test(toCurrency)) {
      sendJson(response, 400, {
        ok: false,
        error: "Invalid currency code. Use 3-letter ISO code (e.g. JPY, USD)."
      });
      return;
    }

    try {
      const conversion = await exchangeClient.convert({
        amount,
        fromCurrency,
        toCurrency
      });

      sendJson(response, 200, {
        ok: true,
        amount: conversion.amount,
        fromCurrency: conversion.fromCurrency,
        toCurrency: conversion.toCurrency,
        rate: conversion.rate,
        convertedAmount: conversion.convertedAmount,
        convertedDisplay: formatCurrency(
          conversion.convertedAmount,
          conversion.toCurrency
        ),
        source: conversion.source,
        cachedAt: new Date(conversion.fetchedAt).toISOString(),
        ttlHours: config.ttlHours
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isClientError = message.startsWith("No rate available");
      sendJson(response, isClientError ? 400 : 502, {
        ok: false,
        error: message
      });
    }
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Not found"
  });
}

async function bootstrap() {
  await cacheStore.init();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) {
        setCorsHeaders(response);
        sendJson(response, 500, {
          ok: false,
          error: "Internal server error"
        });
      } else {
        response.end();
      }
    });
  });

  server.listen(config.port, () => {
    console.log(
      `lazy-currency-converter server listening at http://localhost:${config.port}`
    );
    console.log(`TTL: ${config.ttlHours} hours`);
    console.log(`Cache file: ${config.cacheFile}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
