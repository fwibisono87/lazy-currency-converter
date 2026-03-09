const fs = require("node:fs/promises");
const path = require("node:path");

class CacheStore {
  constructor(cacheFilePath) {
    this.cacheFilePath = cacheFilePath;
    this.data = CacheStore.createEmpty();
    this.initialized = false;
    this.writeQueue = Promise.resolve();
  }

  static createEmpty() {
    return {
      version: 1,
      baseRates: {}
    };
  }

  static isValidData(payload) {
    return (
      payload &&
      typeof payload === "object" &&
      payload.baseRates &&
      typeof payload.baseRates === "object"
    );
  }

  async init() {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.cacheFilePath, "utf8");
      const parsed = JSON.parse(raw);
      if (CacheStore.isValidData(parsed)) {
        this.data = parsed;
      } else {
        await this.persist();
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(
          `[cache] Failed to parse ${this.cacheFilePath}, resetting cache.`
        );
      }
      await this.persist();
    }

    this.initialized = true;
  }

  get(baseCurrency) {
    return this.data.baseRates[baseCurrency] || null;
  }

  async set(baseCurrency, value) {
    this.data.baseRates[baseCurrency] = value;
    await this.persist();
  }

  async persist() {
    const payload = JSON.stringify(this.data, null, 2);
    const tempPath = `${this.cacheFilePath}.tmp`;

    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(tempPath, payload, "utf8");
      await fs.rename(tempPath, this.cacheFilePath);
    });

    await this.writeQueue;
  }
}

module.exports = {
  CacheStore
};
