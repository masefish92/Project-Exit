# Project Exit — Build Plan

A stock investment web app: live pricing, market news, and portfolio tracking.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Public product — real users, real auth, real signup |
| Data budget | Free tier during development; paid plan required at public launch |
| Platform | Responsive web app |
| Stack | Next.js (App Router) + TypeScript + Tailwind + Supabase |

### The data-licensing constraint

Free market-data tiers (Finnhub, Alpha Vantage, Twelve Data) are licensed for
**personal, non-commercial use only**. Serving that data to third-party users of
a public product requires a paid plan.

Mitigation: all provider access goes through a single adapter interface
(`lib/market-data/provider.ts`). Development runs against Finnhub's free tier.
Switching to a paid provider at launch means writing one new adapter — no changes
to routes, components, or caching. Budget ~$30–50/mo at launch.

---

## Architecture

```
Browser
  │
  ├── Server Components ──────► quote pages, news, market overview (SEO, fast TTFB)
  ├── WebSocket ─────────────► live price ticks → Zustand store
  └── Route Handlers (/api/*)
        │
        ├── Redis cache (Upstash)
        │     quotes 10s · news 5min · fundamentals 24h · profiles 7d
        │
        ├── MarketDataProvider (adapter interface)
        │     └── FinnhubProvider  ← dev
        │     └── PolygonProvider  ← launch
        │
        └── Supabase (Postgres + Auth + RLS)
```

**Non-negotiables**
- The data-provider API key lives server-side only. Every provider call is proxied.
- Redis caching is built in Phase 1, not retrofitted. Free tiers have hard rate
  limits; without caching we exhaust them on the first day of real traffic.
- Row Level Security on every user-owned table from the moment it is created.

### Key libraries

| Concern | Choice | Why |
|---|---|---|
| Charts | `lightweight-charts` | TradingView's OSS lib, purpose-built for financial series |
| UI | `shadcn/ui` + Tailwind | Own the components, no runtime dep |
| DB access | Drizzle ORM | Typed schema, real migrations |
| Client state | Zustand | Live tick stream needs cheap, frequent updates |
| Server state | TanStack Query | Caching, refetch, stale-while-revalidate |
| Validation | Zod | Contract enforcement at every API boundary |
| Money math | `decimal.js` | Never use floats for currency |

### Schema sketch

```
users              (Supabase auth)
portfolios         id, user_id, name, currency, created_at
holdings           id, portfolio_id, symbol, qty, avg_cost      ← derived, cached
transactions       id, portfolio_id, symbol, type, qty, price, fees, executed_at
watchlists         id, user_id, name
watchlist_items    watchlist_id, symbol, sort_order
alerts             id, user_id, symbol, condition, threshold, status
```

`transactions` is the source of truth. `holdings` is a materialized view of it —
this matters, because cost basis must be recomputable from history.

---

## Phases

### Phase 0 — Foundations (~1 week)
- Next.js + TS + Tailwind + shadcn scaffold; ESLint/Prettier; Vercel deploy
- Supabase project, Drizzle configured
- Finnhub account; **spike a single quote fetch end-to-end**
- Define the `MarketDataProvider` interface before writing any feature code

> Gate: validate the provider's actual data quality and rate limits before
> committing to it. This spike is cheap; discovering the limits in Phase 3 is not.

### Phase 1 — Read-only market data (~2 weeks) · *demo-able milestone*
- Symbol search with typeahead
- Quote page: price, day change, OHLC, volume, market cap, P/E, 52wk range
- Interactive chart: 1D / 5D / 1M / 6M / YTD / 1Y / 5Y / MAX, hover crosshair
- News feed — per-symbol and general market
- Market overview: index tiles, gainers/losers/most-active
- **Redis caching layer**
- Loading skeletons, error states, empty states

### Phase 2 — Accounts & watchlists (~1.5 weeks)
- Supabase Auth (email + Google OAuth)
- Schema + migrations + RLS policies
- Watchlist CRUD, drag-to-reorder
- Personal dashboard

### Phase 3 — Portfolio (~2 weeks) · *the hard part*
- Transaction entry (buy/sell: qty, price, date, fees)
- **Cost-basis engine** — average cost, plus FIFO for realized gains
- Unrealized/realized P&L, total return %, day change in dollars
- Allocation charts by holding and sector
- CSV import/export
- Multiple portfolios

> The P&L math carries the real risk: stock splits, dividends, partial sells,
> and FIFO lot matching. Unit-test this module hard against known scenarios.
> Everything else in this app is presentation; this is correctness.

### Phase 4 — Live pricing (~1 week)
- Finnhub WebSocket → Zustand tick store
- Reconnect with exponential backoff; tab-visibility throttling
- Flash-green/red on tick; live portfolio value
- Graceful degradation to polling when the socket is unavailable

### Phase 5 — Launch readiness (~1.5 weeks)
- Price alerts (cron-evaluated, email via Resend)
- Compare mode: 2–5 tickers normalized to %
- Fundamentals tab
- Dark mode, mobile layouts, PWA manifest
- **Legal:** "informational purposes only, not investment advice" disclaimer,
  data-attribution notice, terms of service, privacy policy
- Rate limiting on public routes, Sentry, analytics
- **Switch to a paid data provider**

### Phase 6 — Exit Premium (paywall) (~2 weeks)

Subscribers pay to see **the owner's** portfolio, published on a delay.

| Decision | Choice |
|---|---|
| Product | Full portfolio, delayed one trading day. No live alerts. |
| Sizing | Dollar amounts (`SIZING` flag also supports `pct` / `shares`) |
| Billing | Free tier + paid tier, ~$19/mo via Stripe |

- Stripe Checkout for signup, Customer Portal for cancellation and card changes
- Webhooks are the source of truth for entitlement — signature-verified and
  **idempotent** (Stripe retries; a double-processed `invoice.paid` is a real bug)
- Publishing job runs after the close, snapshotting positions to `positions_public`
- Teaser page is SEO-indexed and renders genuinely different content

```
subscriptions     user_id, stripe_customer_id, stripe_sub_id, status, current_period_end
trade_posts       id, symbol, side, qty, price, thesis, executed_at, published_at
positions_public  snapshot_date, symbol, qty, avg_cost, value   ← published, delayed
```

> **Entitlement is enforced server-side and gated data is never sent to an
> unentitled client.** Blurred-CSS paywalls with the real content in the DOM are
> bypassed in seconds. The teaser sends redaction placeholders, not hidden values.

> **Keep the private portfolio and the published portfolio as separate tables.**
> You will want to hold things you don't publish. Conflating them is painful to
> unwind after launch.

**Legal — resolve before taking payment.** Selling access to your trades can
cross from publishing into investment advice requiring registration; the
publisher's exemption (*Lowe v. SEC*) generally covers impersonal commentary but
not personalized recommendations. Two hard rules regardless: never trade ahead of
subscribers (front-running them is fraud), and disclose any paid promotion
(§17(b)). The one-trading-day delay and the no-personal-advice stance are
deliberate mitigations. This is a single consultation with a securities attorney —
not legal advice from this document.

**Estimate: ~11 weeks** at a steady solo pace. Phases 1–3 alone (~5.5 weeks) is a
genuinely useful app.

---

## Deferred (post-launch)

Sector heatmap · dividend tracking · full tax-lot accounting · benchmark
comparison vs SPY · options chains · brokerage sync via Plaid/SnapTrade ·
shared/public portfolios · native mobile app
