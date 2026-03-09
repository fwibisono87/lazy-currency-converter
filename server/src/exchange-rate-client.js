class ExchangeRateClient {
  constructor({ apiKey, ttlMs, cacheStore, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.ttlMs = ttlMs;
    this.cacheStore = cacheStore;
    this.fetchImpl = fetchImpl;
    this.inFlightByBase = new Map();
  }

  async convert({ amount, fromCurrency, toCurrency }) {
    if (fromCurrency === toCurrency) {
      return {
        amount,
        fromCurrency,
        toCurrency,
        convertedAmount: amount,
        rate: 1,
        source: "identity",
        fetchedAt: Date.now()
      };
    }

    const ratesResult = await this.getRatesForBase(fromCurrency);
    const rate = ratesResult.rates[toCurrency];
    if (rate === undefined) {
      throw new Error(`No rate available for target currency ${toCurrency}`);
    }

    return {
      amount,
      fromCurrency,
      toCurrency,
      convertedAmount: amount * rate,
      rate,
      source: ratesResult.source,
      fetchedAt: ratesResult.fetchedAt
    };
  }

  async getRatesForBase(baseCurrency) {
    const cached = this.cacheStore.get(baseCurrency);
    const now = Date.now();

    if (
      cached &&
      typeof cached.fetchedAt === "number" &&
      cached.rates &&
      typeof cached.rates === "object" &&
      now - cached.fetchedAt < this.ttlMs
    ) {
      return {
        rates: cached.rates,
        source: "cache",
        fetchedAt: cached.fetchedAt
      };
    }

    if (this.inFlightByBase.has(baseCurrency)) {
      return this.inFlightByBase.get(baseCurrency);
    }

    const request = this.fetchLatestRates(baseCurrency).finally(() => {
      this.inFlightByBase.delete(baseCurrency);
    });

    this.inFlightByBase.set(baseCurrency, request);
    return request;
  }

  async fetchLatestRates(baseCurrency) {
    if (!this.apiKey) {
      throw new Error(
        "Missing EXCHANGERATE_API_KEY. Add it to .env before starting server."
      );
    }

    const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(
      this.apiKey
    )}/latest/${encodeURIComponent(baseCurrency)}`;

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ExchangeRate API request failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.result !== "success" || !payload.conversion_rates) {
      const reason = payload["error-type"] || "Unknown upstream API error";
      throw new Error(`ExchangeRate API error: ${reason}`);
    }

    const entry = {
      fetchedAt: Date.now(),
      rates: payload.conversion_rates
    };

    await this.cacheStore.set(baseCurrency, entry);

    return {
      rates: entry.rates,
      source: "upstream",
      fetchedAt: entry.fetchedAt
    };
  }
}

module.exports = {
  ExchangeRateClient
};
