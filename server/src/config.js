const fs = require("node:fs");
const path = require("node:path");

function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const parsed = parseEnvText(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "..", ".env"),
    path.resolve(__dirname, "..", "..", ".env")
  ];

  for (const candidate of candidates) {
    applyEnvFile(candidate);
  }
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getConfig() {
  const ttlHours = parseNumber(process.env.EXCHANGE_RATE_TTL_HOURS, 48);
  const port = Math.trunc(parseNumber(process.env.PORT, 8787));
  const cacheFile = process.env.CACHE_FILE
    ? path.resolve(process.cwd(), process.env.CACHE_FILE)
    : path.resolve(__dirname, "..", "data", "rates-cache.json");

  return {
    apiKey:
      process.env.EXCHANGERATE_API_KEY || process.env.EXCHANGE_RATE_API_KEY || "",
    ttlHours,
    ttlMs: ttlHours * 60 * 60 * 1000,
    port,
    cacheFile
  };
}

module.exports = {
  getConfig,
  loadEnv
};
