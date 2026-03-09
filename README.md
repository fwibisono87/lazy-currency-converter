# Lazy Currency Converter

Chrome extension + local cache server for detecting monetary amounts in web pages and converting them on demand.

## Prerequisite

- Node.js 18+ (for built-in `fetch` in the server runtime)

## Why a local server?

A local server is the better approach for your case because it:

- keeps `EXCHANGERATE_API_KEY` out of extension client code
- centralizes caching + request deduping
- lets you set TTL once via `.env`

## Project layout

- `extension/` - Chrome extension (Manifest V3)
- `server/` - small Node HTTP server (persistent cache)

## 1) Configure environment

Create a root `.env` file (or `server/.env`) from `.env.example`:

```env
EXCHANGERATE_API_KEY=your_key_here
EXCHANGE_RATE_TTL_HOURS=48
PORT=8787
```

`EXCHANGE_RATE_TTL_HOURS` defaults to `48` if omitted.

## 2) Run the server

```bash
npm run server:dev
```

Production-style:

```bash
npm run server
```

Server endpoints:

- `GET /health`
- `GET /api/convert?amount=79200&from=JPY&to=USD`

## 3) Run with Docker (VPS)

Lightweight image (`node:22-alpine`) is included at `server/Dockerfile`.

Build and run directly:

```bash
docker build -t lazy-currency-converter-server ./server
docker run -d \
  --name lazy-currency-converter-server \
  --restart unless-stopped \
  --env-file .env \
  -p 8787:8787 \
  -v lcc_server_cache:/app/data \
  lazy-currency-converter-server
```

Or with compose:

```bash
docker compose up -d --build
```

## 4) Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder in this repo

## 5) Use it

1. Open the extension popup.
2. Set your target currency (for example `USD`) and server URL (default `http://localhost:8787`).
3. Optional: enable `Auto-convert` to automatically rewrite every detected amount in place.
4. Optional: set domain and currency whitelist/blacklist rules for auto-convert.
5. Visit any page with amounts like `￥79,200` or `$129.99`.
6. Hover or click an amount.
7. If auto-convert applies to that amount, the tooltip shows the active rate immediately.
8. If auto-convert does not apply, use `Convert` and optionally `Replace text`.

## Preferences persistence

Extension settings are stored in `chrome.storage.sync`, so they persist across refreshes, tabs, and browser restarts (and can sync across Chrome profiles when sync is enabled).
