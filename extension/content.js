(function () {
  const TOKEN_CLASS = "lcc-money-token";
  const AUTO_CONVERTED_CLASS = "lcc-auto-converted";
  const TOOLTIP_CLASS = "lcc-tooltip";
  const EXCLUDED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "BUTTON",
    "CODE",
    "PRE"
  ]);

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

  const CURRENCY_CODES_PATTERN = CURRENCY_CODES.join("|");
  const CURRENCY_CODE_REGEX = new RegExp(`\\b(?:${CURRENCY_CODES_PATTERN})\\b`, "i");
  const CURRENCY_SYMBOL_REGEX = /US\$|CA\$|C\$|A\$|S\$|HK\$|NZ\$|R\$|€|£|¥|￥|₹|₩|₽|₫|₺|₴|₪|₱|฿|\$/;
  const AMOUNT_PATTERN = "(?:\\d{1,3}(?:[\\s,]\\d{3})+|\\d+)(?:\\.\\d+)?";

  const MONEY_REGEX = new RegExp(
    [
      `(?:US\\$|CA\\$|C\\$|A\\$|S\\$|HK\\$|NZ\\$|R\\$|€|£|¥|￥|₹|₩|₽|₫|₺|₴|₪|₱|฿|\\$)\\s?${AMOUNT_PATTERN}`,
      `${AMOUNT_PATTERN}\\s?(?:${CURRENCY_CODES_PATTERN})`,
      `(?:${CURRENCY_CODES_PATTERN})\\s?${AMOUNT_PATTERN}`
    ].join("|"),
    "g"
  );

  const SYMBOL_TO_CURRENCY = [
    ["US$", "USD"],
    ["CA$", "CAD"],
    ["C$", "CAD"],
    ["A$", "AUD"],
    ["S$", "SGD"],
    ["HK$", "HKD"],
    ["NZ$", "NZD"],
    ["R$", "BRL"],
    ["￥", "JPY"],
    ["¥", "JPY"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["₹", "INR"],
    ["₩", "KRW"],
    ["₽", "RUB"],
    ["₫", "VND"],
    ["₺", "TRY"],
    ["₴", "UAH"],
    ["₪", "ILS"],
    ["₱", "PHP"],
    ["฿", "THB"],
    ["$", "USD"]
  ];

  const state = {
    settings: {
      targetCurrency: "USD",
      autoConvert: false,
      autoConvertDomainWhitelist: [],
      autoConvertDomainBlacklist: [],
      autoConvertCurrencyWhitelist: [],
      autoConvertCurrencyBlacklist: []
    },
    tooltip: null,
    activeToken: null,
    latestConversion: null,
    scanTimer: null,
    hideTimer: null,
    queuedRoots: new Set(),
    rateInfoPromisesByPair: new Map(),
    autoConvertRunId: 0,
    tooltipRateRequestId: 0
  };

  injectStyles();
  wireDocumentEvents();
  refreshSettings().finally(() => {
    queueScan(document.body);
    observeDocumentMutations();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    let shouldRefreshTooltip = false;
    let shouldReprocessAutoConvert = false;

    if (changes.targetCurrency?.newValue) {
      state.settings.targetCurrency = String(changes.targetCurrency.newValue)
        .trim()
        .toUpperCase();
      state.rateInfoPromisesByPair.clear();
      shouldRefreshTooltip = true;
      shouldReprocessAutoConvert = true;
    }
    if (typeof changes.autoConvert?.newValue === "boolean") {
      state.settings.autoConvert = Boolean(changes.autoConvert.newValue);
      shouldReprocessAutoConvert = true;
      shouldRefreshTooltip = true;
    }
    if (changes.autoConvertDomainWhitelist?.newValue) {
      state.settings.autoConvertDomainWhitelist = normalizeDomainList(
        changes.autoConvertDomainWhitelist.newValue
      );
      shouldReprocessAutoConvert = true;
      shouldRefreshTooltip = true;
    }
    if (changes.autoConvertDomainBlacklist?.newValue) {
      state.settings.autoConvertDomainBlacklist = normalizeDomainList(
        changes.autoConvertDomainBlacklist.newValue
      );
      shouldReprocessAutoConvert = true;
      shouldRefreshTooltip = true;
    }
    if (changes.autoConvertCurrencyWhitelist?.newValue) {
      state.settings.autoConvertCurrencyWhitelist = normalizeCurrencyList(
        changes.autoConvertCurrencyWhitelist.newValue
      );
      shouldReprocessAutoConvert = true;
      shouldRefreshTooltip = true;
    }
    if (changes.autoConvertCurrencyBlacklist?.newValue) {
      state.settings.autoConvertCurrencyBlacklist = normalizeCurrencyList(
        changes.autoConvertCurrencyBlacklist.newValue
      );
      shouldReprocessAutoConvert = true;
      shouldRefreshTooltip = true;
    }

    if (shouldReprocessAutoConvert) {
      reprocessAllTokensForAutoConvert();
    }
    if (shouldRefreshTooltip && state.activeToken) {
      renderTooltip(state.activeToken);
    }
  });

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .${TOKEN_CLASS} {
        cursor: pointer;
        border-bottom: 1px dashed #1f6fab;
        background: rgba(31, 111, 171, 0.1);
        border-radius: 2px;
        padding: 0 1px;
      }
      .${TOKEN_CLASS}:hover,
      .${TOKEN_CLASS}:focus-visible {
        background: rgba(31, 111, 171, 0.2);
        outline: none;
      }
      .${TOKEN_CLASS}.${AUTO_CONVERTED_CLASS} {
        border-bottom: none;
        background: transparent;
        padding: 0;
      }
      .${TOOLTIP_CLASS} {
        position: absolute;
        z-index: 2147483647;
        min-width: 230px;
        max-width: 300px;
        background: #10161d;
        color: #f6f8fa;
        border: 1px solid #2d333b;
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
        padding: 10px;
        font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.4;
      }
      .${TOOLTIP_CLASS}.is-hidden {
        display: none;
      }
      .${TOOLTIP_CLASS} .lcc-title {
        font-weight: 600;
        margin-bottom: 8px;
        font-family: "Michroma", "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      .${TOOLTIP_CLASS} .lcc-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .${TOOLTIP_CLASS} button {
        border: 0;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .${TOOLTIP_CLASS} .lcc-convert {
        background: #238636;
        color: #ffffff;
      }
      .${TOOLTIP_CLASS} .lcc-replace {
        background: #1f6feb;
        color: #ffffff;
      }
      .${TOOLTIP_CLASS} .lcc-result {
        margin-top: 8px;
      }
      .${TOOLTIP_CLASS} .lcc-muted {
        color: #9aa3ad;
        font-size: 12px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function wireDocumentEvents() {
    document.addEventListener("mouseover", (event) => {
      const token = findTokenFromEvent(event);
      if (!token) {
        return;
      }
      showTooltip(token);
    });

    document.addEventListener("mouseout", (event) => {
      const source = event.target;
      if (!(source instanceof Element)) {
        return;
      }

      const isFromTokenOrTooltip = Boolean(
        source.closest(`.${TOKEN_CLASS}`) || source.closest(`.${TOOLTIP_CLASS}`)
      );
      if (!isFromTokenOrTooltip) {
        return;
      }

      if (isWithinTokenOrTooltip(event.relatedTarget)) {
        return;
      }

      scheduleHideTooltip();
    });

    document.addEventListener("click", (event) => {
      const token = findTokenFromEvent(event);
      const tooltip = getTooltip();
      const target = event.target;

      if (token) {
        showTooltip(token);
        return;
      }

      if (!(target instanceof Node) || !tooltip.contains(target)) {
        hideTooltip();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideTooltip();
      }
    });

    window.addEventListener(
      "scroll",
      () => {
        if (state.activeToken && state.tooltip && !state.tooltip.classList.contains("is-hidden")) {
          positionTooltip(state.activeToken, state.tooltip);
        }
      },
      true
    );
  }

  function observeDocumentMutations() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" && mutation.target.parentNode) {
          queueScan(mutation.target.parentNode);
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.parentNode) {
            queueScan(node.parentNode);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            queueScan(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function queueScan(root) {
    if (!root) {
      return;
    }
    state.queuedRoots.add(root);
    if (state.scanTimer) {
      return;
    }
    state.scanTimer = window.setTimeout(() => {
      state.scanTimer = null;
      const roots = Array.from(state.queuedRoots);
      state.queuedRoots.clear();
      for (const queuedRoot of roots) {
        scanRoot(queuedRoot);
      }
    }, 250);
  }

  function scanRoot(root) {
    if (!root || !document.body) {
      return;
    }

    const rootNode =
      root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
    if (!(rootNode instanceof Node)) {
      return;
    }

    if (rootNode instanceof Element && rootNode.closest(`.${TOOLTIP_CLASS}`)) {
      return;
    }

    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return isProcessableTextNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const textNode of textNodes) {
      transformTextNode(textNode);
    }
  }

  function isProcessableTextNode(textNode) {
    if (!textNode?.nodeValue || !textNode.parentElement) {
      return false;
    }
    if (!/\d/.test(textNode.nodeValue)) {
      return false;
    }
    if (
      !CURRENCY_SYMBOL_REGEX.test(textNode.nodeValue) &&
      !CURRENCY_CODE_REGEX.test(textNode.nodeValue)
    ) {
      return false;
    }

    const parent = textNode.parentElement;
    if (EXCLUDED_TAGS.has(parent.tagName)) {
      return false;
    }
    if (parent.closest(`.${TOKEN_CLASS}`) || parent.closest(`.${TOOLTIP_CLASS}`)) {
      return false;
    }
    if (parent.isContentEditable) {
      return false;
    }
    return true;
  }

  function transformTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text) {
      return;
    }

    const matcher = new RegExp(MONEY_REGEX.source, "g");
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let didReplace = false;
    let match;

    while ((match = matcher.exec(text)) !== null) {
      const raw = match[0];
      const parsed = parseMoney(raw);
      if (!parsed) {
        continue;
      }

      const start = match.index;
      const end = start + raw.length;

      if (start > lastIndex) {
        fragment.append(document.createTextNode(text.slice(lastIndex, start)));
      }

      const token = document.createElement("span");
      token.className = TOKEN_CLASS;
      token.tabIndex = 0;
      token.textContent = raw;
      token.dataset.amount = String(parsed.amount);
      token.dataset.currency = parsed.currency;
      token.dataset.originalText = raw;
      token.dataset.originalAmount = String(parsed.amount);
      token.dataset.originalCurrency = parsed.currency;
      token.dataset.autoConverted = "0";
      token.dataset.autoConvertedTo = "";
      token.title = `Convert ${parsed.currency} to ${state.settings.targetCurrency}`;
      fragment.append(token);

      if (isTokenEligibleForAutoConvert(token)) {
        autoConvertToken(token, state.autoConvertRunId);
      }

      didReplace = true;
      lastIndex = end;
    }

    if (!didReplace) {
      return;
    }

    if (lastIndex < text.length) {
      fragment.append(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  function parseMoney(rawText) {
    const value = String(rawText || "").trim();
    if (!value) {
      return null;
    }

    let currency = null;
    const codeMatch = value.match(CURRENCY_CODE_REGEX);
    if (codeMatch) {
      currency = codeMatch[0].toUpperCase();
    } else {
      for (const [symbol, code] of SYMBOL_TO_CURRENCY) {
        if (value.startsWith(symbol)) {
          currency = code;
          break;
        }
      }
    }

    if (!currency) {
      return null;
    }

    const amountPart = value
      .replace(CURRENCY_CODE_REGEX, "")
      .replace(/[^\d.,\s-]/g, "")
      .trim();
    const normalized = amountPart.replace(/\s/g, "").replace(/,/g, "");
    const amount = Number(normalized);

    if (!Number.isFinite(amount)) {
      return null;
    }

    return { currency, amount };
  }

  function reprocessAllTokensForAutoConvert() {
    state.autoConvertRunId += 1;
    const runId = state.autoConvertRunId;
    const tokens = document.querySelectorAll(`.${TOKEN_CLASS}`);

    for (const token of tokens) {
      if (!(token instanceof HTMLElement)) {
        continue;
      }
      restoreTokenToOriginal(token);
      updateTokenTitle(token);

      if (isTokenEligibleForAutoConvert(token)) {
        autoConvertToken(token, runId);
      }
    }
  }

  function restoreTokenToOriginal(token) {
    const originalText = token.dataset.originalText;
    const originalAmount = Number(token.dataset.originalAmount);
    const originalCurrency = String(token.dataset.originalCurrency || "").toUpperCase();

    if (originalText) {
      token.textContent = originalText;
    }
    if (Number.isFinite(originalAmount)) {
      token.dataset.amount = String(originalAmount);
    }
    if (/^[A-Z]{3}$/.test(originalCurrency)) {
      token.dataset.currency = originalCurrency;
    }

    token.dataset.autoConverted = "0";
    token.dataset.autoConvertedTo = "";
    token.classList.remove(AUTO_CONVERTED_CLASS);
  }

  async function autoConvertToken(token, runId) {
    if (!(token instanceof HTMLElement)) {
      return;
    }
    if (!isTokenEligibleForAutoConvert(token) || runId !== state.autoConvertRunId) {
      return;
    }

    const amount = getTokenSourceAmount(token);
    const fromCurrency = getTokenSourceCurrency(token);
    const toCurrency = state.settings.targetCurrency;

    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(fromCurrency)) {
      return;
    }

    if (token.dataset.autoConverted === "1" && token.dataset.autoConvertedTo === toCurrency) {
      return;
    }

    try {
      const rateInfo = await getRateInfo(fromCurrency, toCurrency);
      if (!isTokenEligibleForAutoConvert(token) || runId !== state.autoConvertRunId) {
        return;
      }

      const convertedAmount = amount * rateInfo.rate;
      const convertedLabel = formatMoney(convertedAmount, toCurrency);
      const originalLabel = formatOriginalAmount(amount);

      token.textContent = `${convertedLabel} (${fromCurrency} ${originalLabel})`;
      token.dataset.autoConverted = "1";
      token.dataset.autoConvertedTo = toCurrency;
      token.classList.add(AUTO_CONVERTED_CLASS);
      token.title = `Convert ${fromCurrency} to ${toCurrency}`;
    } catch (error) {
      token.dataset.autoConverted = "0";
      token.classList.remove(AUTO_CONVERTED_CLASS);
      token.title =
        error instanceof Error
          ? `Auto-convert failed: ${error.message}`
          : "Auto-convert failed";
    }
  }

  function isTokenEligibleForAutoConvert(token) {
    if (!state.settings.autoConvert) {
      return false;
    }
    if (!isCurrentDomainAllowedForAutoConvert()) {
      return false;
    }

    const fromCurrency = getTokenSourceCurrency(token);
    if (!/^[A-Z]{3}$/.test(fromCurrency)) {
      return false;
    }
    if (fromCurrency === state.settings.targetCurrency) {
      return false;
    }
    if (!isCurrencyAllowedForAutoConvert(fromCurrency)) {
      return false;
    }

    return true;
  }

  function isCurrentDomainAllowedForAutoConvert() {
    const hostname = window.location.hostname.toLowerCase();
    const blacklist = state.settings.autoConvertDomainBlacklist;
    const whitelist = state.settings.autoConvertDomainWhitelist;

    if (blacklist.some((rule) => doesDomainMatchRule(hostname, rule))) {
      return false;
    }
    if (whitelist.length > 0 && !whitelist.some((rule) => doesDomainMatchRule(hostname, rule))) {
      return false;
    }
    return true;
  }

  function doesDomainMatchRule(hostname, rule) {
    if (!rule) {
      return false;
    }
    return hostname === rule || hostname.endsWith(`.${rule}`);
  }

  function isCurrencyAllowedForAutoConvert(currencyCode) {
    const whitelist = state.settings.autoConvertCurrencyWhitelist;
    const blacklist = state.settings.autoConvertCurrencyBlacklist;

    if (blacklist.includes(currencyCode)) {
      return false;
    }
    if (whitelist.length > 0 && !whitelist.includes(currencyCode)) {
      return false;
    }
    return true;
  }

  function getTokenSourceAmount(token) {
    const original = Number(token.dataset.originalAmount);
    if (Number.isFinite(original)) {
      return original;
    }
    return Number(token.dataset.amount);
  }

  function getTokenSourceCurrency(token) {
    return String(token.dataset.originalCurrency || token.dataset.currency || "")
      .trim()
      .toUpperCase();
  }

  function updateTokenTitle(token) {
    const fromCurrency = getTokenSourceCurrency(token);
    if (!/^[A-Z]{3}$/.test(fromCurrency)) {
      return;
    }
    token.title = isTokenEligibleForAutoConvert(token)
      ? `Auto-convert ${fromCurrency} to ${state.settings.targetCurrency}`
      : `Convert ${fromCurrency} to ${state.settings.targetCurrency}`;
  }

  async function getRateInfo(fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return {
        rate: 1,
        source: "identity",
        cachedAt: null
      };
    }

    const pairKey = `${fromCurrency}->${toCurrency}`;
    if (!state.rateInfoPromisesByPair.has(pairKey)) {
      const rateInfoPromise = sendRuntimeMessage({
        type: "convertCurrency",
        payload: {
          amount: 1,
          fromCurrency,
          toCurrency
        }
      })
        .then((response) => {
          if (!response?.ok) {
            throw new Error(response?.error || "Failed to fetch exchange rate");
          }
          const rate = Number(response.data?.rate);
          if (!Number.isFinite(rate) || rate <= 0) {
            throw new Error("Received invalid exchange rate");
          }
          return {
            rate,
            source: String(response.data?.source || "unknown"),
            cachedAt: String(response.data?.cachedAt || "")
          };
        })
        .catch((error) => {
          state.rateInfoPromisesByPair.delete(pairKey);
          throw error;
        });

      state.rateInfoPromisesByPair.set(pairKey, rateInfoPromise);
    }

    return state.rateInfoPromisesByPair.get(pairKey);
  }

  function findTokenFromEvent(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const token = target.closest(`.${TOKEN_CLASS}`);
    return token instanceof HTMLElement ? token : null;
  }

  function getTooltip() {
    if (state.tooltip) {
      return state.tooltip;
    }

    const tooltip = document.createElement("div");
    tooltip.className = `${TOOLTIP_CLASS} is-hidden`;
    tooltip.innerHTML = `
      <div class="lcc-title"></div>
      <div class="lcc-actions">
        <button type="button" class="lcc-convert">Convert</button>
        <button type="button" class="lcc-replace" style="display:none;">Replace text</button>
      </div>
      <div class="lcc-result"></div>
      <div class="lcc-muted"></div>
    `;

    const convertButton = tooltip.querySelector(".lcc-convert");
    const replaceButton = tooltip.querySelector(".lcc-replace");
    convertButton.addEventListener("click", () => convertActiveToken());
    replaceButton.addEventListener("click", () => replaceActiveTokenText());
    tooltip.addEventListener("mouseenter", () => clearHideTooltipTimer());
    tooltip.addEventListener("mouseleave", (event) => {
      if (isWithinTokenOrTooltip(event.relatedTarget)) {
        return;
      }
      scheduleHideTooltip();
    });

    document.body.append(tooltip);
    state.tooltip = tooltip;
    return tooltip;
  }

  function showTooltip(token) {
    clearHideTooltipTimer();
    state.activeToken = token;
    state.latestConversion = null;
    renderTooltip(token);
  }

  function renderTooltip(token) {
    const tooltip = getTooltip();
    const amount = getTokenSourceAmount(token);
    const fromCurrency = getTokenSourceCurrency(token);
    const toCurrency = state.settings.targetCurrency;
    const autoConvertEligible = isTokenEligibleForAutoConvert(token);

    const title = tooltip.querySelector(".lcc-title");
    const convertButton = tooltip.querySelector(".lcc-convert");
    const replaceButton = tooltip.querySelector(".lcc-replace");
    const result = tooltip.querySelector(".lcc-result");
    const meta = tooltip.querySelector(".lcc-muted");

    title.textContent = `${formatMoney(amount, fromCurrency)} -> ${toCurrency}`;
    result.textContent = "";
    meta.textContent = "";

    if (autoConvertEligible) {
      convertButton.style.display = "none";
      replaceButton.style.display = "none";
      result.textContent =
        token.dataset.autoConverted === "1" && token.dataset.autoConvertedTo === toCurrency
          ? token.textContent
          : "Auto-converting...";
      meta.textContent = "Loading rate...";
      renderAutoRateInTooltip(token);
    } else {
      convertButton.style.display = "inline-block";
      convertButton.textContent = `Convert to ${toCurrency}`;
      convertButton.disabled = false;
      replaceButton.style.display = "none";

      if (state.settings.autoConvert && !isCurrentDomainAllowedForAutoConvert()) {
        meta.textContent = "Auto-convert is ON, but this domain is excluded.";
      } else if (state.settings.autoConvert && !isCurrencyAllowedForAutoConvert(fromCurrency)) {
        meta.textContent = `Auto-convert is ON, but ${fromCurrency} is excluded.`;
      } else if (state.settings.autoConvert && fromCurrency === toCurrency) {
        meta.textContent = "Source and target currency are the same.";
      } else {
        meta.textContent = "Hover or click an amount, then convert on demand.";
      }
    }

    tooltip.classList.remove("is-hidden");
    positionTooltip(token, tooltip);
  }

  function renderAutoRateInTooltip(token) {
    const requestId = ++state.tooltipRateRequestId;
    const amount = getTokenSourceAmount(token);
    const fromCurrency = getTokenSourceCurrency(token);
    const toCurrency = state.settings.targetCurrency;

    getRateInfo(fromCurrency, toCurrency)
      .then((rateInfo) => {
        if (
          !state.activeToken ||
          state.activeToken !== token ||
          requestId !== state.tooltipRateRequestId
        ) {
          return;
        }

        const tooltip = getTooltip();
        const result = tooltip.querySelector(".lcc-result");
        const meta = tooltip.querySelector(".lcc-muted");
        const preview = `${formatMoney(amount * rateInfo.rate, toCurrency)} (${fromCurrency} ${formatOriginalAmount(amount)})`;

        if (!result.textContent || result.textContent === "Auto-converting...") {
          result.textContent = preview;
        }
        meta.textContent = `Rate: 1 ${fromCurrency} = ${Number(rateInfo.rate).toFixed(6)} ${toCurrency} (${rateInfo.source})`;
      })
      .catch((error) => {
        if (
          !state.activeToken ||
          state.activeToken !== token ||
          requestId !== state.tooltipRateRequestId
        ) {
          return;
        }
        const tooltip = getTooltip();
        const meta = tooltip.querySelector(".lcc-muted");
        meta.textContent =
          error instanceof Error ? `Rate unavailable: ${error.message}` : "Rate unavailable";
      });
  }

  async function convertActiveToken() {
    if (!state.activeToken) {
      return;
    }

    const tooltip = getTooltip();
    const convertButton = tooltip.querySelector(".lcc-convert");
    const replaceButton = tooltip.querySelector(".lcc-replace");
    const result = tooltip.querySelector(".lcc-result");
    const meta = tooltip.querySelector(".lcc-muted");

    const amount = getTokenSourceAmount(state.activeToken);
    const fromCurrency = getTokenSourceCurrency(state.activeToken);
    const toCurrency = state.settings.targetCurrency;

    convertButton.disabled = true;
    result.textContent = "Converting...";
    meta.textContent = "";

    const response = await sendRuntimeMessage({
      type: "convertCurrency",
      payload: {
        amount,
        fromCurrency,
        toCurrency
      }
    });

    convertButton.disabled = false;

    if (!response?.ok) {
      result.textContent = response?.error || "Conversion failed.";
      replaceButton.style.display = "none";
      return;
    }

    const data = response.data;
    state.latestConversion = data;
    result.textContent = data.convertedDisplay || formatMoney(data.convertedAmount, toCurrency);
    meta.textContent = `Rate: 1 ${fromCurrency} = ${Number(data.rate).toFixed(6)} ${toCurrency} (${data.source})`;
    replaceButton.style.display = "inline-block";
  }

  function replaceActiveTokenText() {
    if (!state.activeToken || !state.latestConversion) {
      return;
    }
    const converted = Number(state.latestConversion.convertedAmount);
    const toCurrency = state.latestConversion.toCurrency;
    const replacedText = formatMoney(converted, toCurrency);
    state.activeToken.textContent = replacedText;
    state.activeToken.dataset.amount = String(converted);
    state.activeToken.dataset.currency = toCurrency;
    state.activeToken.dataset.originalText = replacedText;
    state.activeToken.dataset.originalAmount = String(converted);
    state.activeToken.dataset.originalCurrency = toCurrency;
    state.activeToken.dataset.autoConverted = "0";
    state.activeToken.dataset.autoConvertedTo = "";
    state.activeToken.classList.remove(AUTO_CONVERTED_CLASS);
    state.activeToken.title = `Convert ${toCurrency} to ${state.settings.targetCurrency}`;
    hideTooltip();
  }

  function hideTooltip() {
    if (!state.tooltip) {
      return;
    }
    clearHideTooltipTimer();
    state.tooltipRateRequestId += 1;
    state.tooltip.classList.add("is-hidden");
    state.activeToken = null;
    state.latestConversion = null;
  }

  function scheduleHideTooltip() {
    clearHideTooltipTimer();
    state.hideTimer = window.setTimeout(() => {
      state.hideTimer = null;
      hideTooltip();
    }, 140);
  }

  function clearHideTooltipTimer() {
    if (!state.hideTimer) {
      return;
    }
    window.clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }

  function isWithinTokenOrTooltip(node) {
    if (!(node instanceof Node)) {
      return false;
    }
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) {
      return false;
    }
    return Boolean(
      element.closest(`.${TOKEN_CLASS}`) || element.closest(`.${TOOLTIP_CLASS}`)
    );
  }

  function positionTooltip(token, tooltip) {
    const rect = token.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - tooltip.offsetWidth - 8, 8);
    const left = Math.min(Math.max(rect.left + window.scrollX, 8), maxLeft + window.scrollX);
    const top = rect.bottom + window.scrollY + 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function formatMoney(value, currencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
        maximumFractionDigits: 2
      }).format(value);
    } catch {
      return `${Number(value).toFixed(2)} ${currencyCode}`;
    }
  }

  function formatOriginalAmount(value) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
  }

  async function refreshSettings() {
    const response = await sendRuntimeMessage({
      type: "getSettings"
    });
    if (!response?.ok || !response.settings) {
      return;
    }
    state.settings.targetCurrency = String(response.settings.targetCurrency || "USD")
      .trim()
      .toUpperCase();
    state.settings.autoConvert = Boolean(response.settings.autoConvert);
    state.settings.autoConvertDomainWhitelist = normalizeDomainList(
      response.settings.autoConvertDomainWhitelist
    );
    state.settings.autoConvertDomainBlacklist = normalizeDomainList(
      response.settings.autoConvertDomainBlacklist
    );
    state.settings.autoConvertCurrencyWhitelist = normalizeCurrencyList(
      response.settings.autoConvertCurrencyWhitelist
    );
    state.settings.autoConvertCurrencyBlacklist = normalizeCurrencyList(
      response.settings.autoConvertCurrencyBlacklist
    );
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

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : "Runtime message failed"
        });
      }
    });
  }
})();
