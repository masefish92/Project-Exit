# Project Exit

A stock investment app — live pricing, a published portfolio, research notes
and a paywalled trade log. Currently a **front-end design prototype** with a live
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
| `/` | `public/index.html` | Free — ticker tape, price chart, movers, featured writing. Landing page, not a nav tab. |
| `/portfolio` | `public/portfolio.html` | Free — profile, top 5 holdings, **percentages only** |
| `/trades` | `public/trades.html` | Paid — trade log with rationale, delayed one trading day |
| `/research` | `public/research.html` | Free index, **paid** notes — generated from `content/research/` |
| `/takes` | `public/takes.html` | Free — articles and market commentary |

Both paid pages carry a **"Prototype state"** switcher at the bottom to preview
the free-visitor and subscriber views. It disappears once real entitlement is wired.

### Where dollar amounts may appear

`/portfolio` is public, so it publishes **allocation percentages and never share
counts or position values** — share count times the live market price on the same
page would reconstruct the position size. Dollar amounts appear only behind the
paywall on `/trades`. The `SIZING` constant at the top of `portfolio.html`
switches that page between `pct`, `usd` and `shares` if the decision changes.

## Publishing a research note

Notes are written as markdown in `content/research/` and built into pages:

```bash
npm run build:research
```

Each note produces three things in `public/research/`:

| File | Contents |
|---|---|
| `<slug>.html` | The page, with the **free preview** inline |
| `<slug>.body.html` | The **gated remainder**, fetched only when unlocked |
| `index.json` | Metadata the Research index renders from |

The free/paid split happens automatically at the first `## 1.` heading — the data
table, thesis summary and "why now" are free; the analysis is paid. Frontmatter
drives the index card:

```yaml
symbol: MU
company: Micron Technology, Inc.
subtitle: AI Memory Supercycle
date: 2026-08-14
stage: Diligence
stance: accumulating   # accumulating | holding | trimming | exited | passed
sector: Semiconductors
read: 19 min
```

Because the index is generated, it can never drift from what was actually
published. Adding a note is one markdown file plus one command.

> **Before launch:** `<slug>.body.html` is a static file, so a determined visitor
> can fetch it directly. That is fine with no auth in place, but when Stripe
> entitlement lands the body must come from an endpoint that verifies the
> subscription **before** returning content. The split exists now so that swap is
> a one-line change.

## Architecture

The browser never sees the Finnhub key. `server.js` reads it from `.env.local`
and proxies every request under `/api/*`, with an in-memory cache sized to stay
inside the free tier's 60 req/min ceiling:

| Endpoint | Cache | Notes |
|---|---|---|
| `/api/quote?symbols=` | 60s | Batched real-time quotes |
| `/api/tape?symbols=` | 60s / 24h | Quotes + logos for the ticker tape |
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

`vercel.json` sets `cleanUrls`; Vercel serves `public/` statically by convention and picks up `api/[fn].js`
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
public/       the design — one shared stylesheet, one file per page
lib/finnhub.js Finnhub access: fetch, cache, endpoint shapes (shared)
api/[fn].js    Vercel serverless function → /api/quote, /api/tape, …
server.js      local dev server (static + same /api/*)
content/       research notes in markdown (source of truth)
scripts/       build-research.js, spike.js, fix-encoding.js, ratecheck.js
reference/     design reference image and video (gitignored)
PLAN.md        phased build plan, schema, legal notes
```

## Disclaimer

Nothing in this project is investment advice. The notes in `content/research/`
are real analysis; portfolio positions, trades and C:\Takes articles are still
placeholder content for layout.
