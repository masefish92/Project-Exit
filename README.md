# Project Exit

A stock investment app — live pricing, market news, research notes, and a
paywalled portfolio. Currently a **front-end design prototype** with a live
Finnhub data proxy. See [PLAN.md](PLAN.md) for the full build plan.

## Run locally

```bash
cp .env.example .env.local     # then paste your Finnhub key in
npm run dev                    # http://localhost:3000
```

No dependencies to install — the server is plain Node.

## Pages

| Route | File | Access |
|---|---|---|
| `/` | `prototype/dashboard.html` | Free — ticker tape, chart, movers, news, featured writing |
| `/takes` | `prototype/takes.html` | Free — articles and market commentary |
| `/research` | `prototype/research.html` | Paid — company research notes |
| `/premium` | `prototype/premium.html` | Paid — the owner's portfolio, delayed one trading day |

Both paid pages carry a **"Prototype state"** switcher at the bottom to preview
the free-visitor and subscriber views. It disappears once real entitlement is wired.

## Architecture

The browser never sees the Finnhub key. `server.js` reads it from `.env.local`
and proxies every request under `/api/*`, with an in-memory cache sized to stay
inside the free tier's 60 req/min ceiling:

| Endpoint | Cache | Notes |
|---|---|---|
| `/api/quote?symbols=` | 20s | Batched real-time quotes |
| `/api/tape?symbols=` | 20s / 24h | Quotes + logos for the ticker tape |
| `/api/search?q=` | 10min | Symbol lookup |
| `/api/profile?symbol=` | 24h | Company name, industry, logo |
| `/api/news[?symbol=]` | 5min | Market or company news |
| `/api/metric?symbol=` | 24h | Fundamentals |
| `/api/candles?symbol=&range=` | — | **Shaped**, see below |
| `/api/health` | — | Upstream call count, cache size |

### Known gap: price history

Finnhub's free plan returns **403 for `/stock/candle`**, so there is no real
historical data. `/api/candles` returns a shaped series anchored to end on the
real live price, flagged `synthetic: true`, and the chart shows an amber
**"Shaped history"** badge. Closing this gap means a paid plan — Polygon.io
Starter (~$29/mo) or Finnhub Starter (~$50/mo).

> Free market-data tiers are licensed for **personal, non-commercial use**.
> A paid plan is required before this serves real users.

## Deploying

`vercel.json` serves `prototype/` statically and Vercel picks up `api/[fn].js`
as a serverless function, so `/api/*` works in production exactly as it does
locally — both delegate to `lib/finnhub.js`.

**Required:** set `FINNHUB_API_KEY` in Vercel → Settings → Environment
Variables. Without it every `/api/*` call returns a 500 explaining what's
missing, and the pages still render with the chart falling back to a local shape.

`server.js` is not used on Vercel; it exists so local dev matches production.

> Serverless functions are stateless between cold starts, so the in-memory cache
> is best-effort in production. The TTLs still keep a page load inside Finnhub's
> 60 req/min ceiling, but a busy site needs a shared cache (Upstash Redis).

## Repo layout

```
prototype/     the design — one shared stylesheet, one file per page
lib/finnhub.js Finnhub access: fetch, cache, endpoint shapes (shared)
api/[fn].js    Vercel serverless function → /api/quote, /api/tape, …
server.js      local dev server (static + same /api/*)
scripts/       spike.js (probe Finnhub access), fix-encoding.js
reference/     design reference image and video (gitignored)
PLAN.md        phased build plan, schema, legal notes
```

## Disclaimer

Nothing in this project is investment advice. Portfolio positions, research
notes, and articles in the prototype are placeholder content for layout.
