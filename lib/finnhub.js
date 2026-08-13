// Finnhub access layer, shared by the local dev server (server.js) and the
// Vercel serverless function (api/[fn].js). No HTTP server here on purpose —
// this module only knows how to fetch, cache, and shape data.

const fs = require("fs");
const path = require("path");

const BASE = "https://finnhub.io/api/v1";

/* ---------- key ----------
   Environment variable first (Vercel, CI), then .env.local for local dev.
   Never throws at import time — a missing key must surface as a clean 500 from
   the request handler, not as a crashed process. */

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  if (process.env.FINNHUB_API_KEY) return (cachedKey = process.env.FINNHUB_API_KEY);
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    const m = env.match(/^FINNHUB_API_KEY=(.+)$/m);
    if (m) return (cachedKey = m[1].trim());
  } catch (_) {}
  throw Object.assign(
    new Error("FINNHUB_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, or to .env.local locally."),
    { code: 500 }
  );
}

/* ---------- cache ----------
   Finnhub's free tier allows 60 requests/minute. On Vercel this cache lives per
   warm lambda instance, so it is a best-effort saving rather than a guarantee —
   the TTLs below still keep a single page load well inside the ceiling. */

const cache = new Map();
let upstreamCalls = 0;

function cached(key, ttlMs, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
  return produce().then((val) => {
    cache.set(key, { at: Date.now(), val });
    return val;
  });
}

async function finnhub(endpoint) {
  upstreamCalls++;
  const url = BASE + endpoint + (endpoint.includes("?") ? "&" : "?") + "token=" + getKey();
  const r = await fetch(url);
  if (r.status === 429) throw Object.assign(new Error("Rate limited by Finnhub"), { code: 429 });
  if (r.status === 403) throw Object.assign(new Error("Not available on this Finnhub plan"), { code: 403 });
  if (!r.ok) throw Object.assign(new Error("Finnhub returned " + r.status), { code: 502 });
  return r.json();
}

/* ---------- synthetic history ----------
   Finnhub's free plan returns 403 for /stock/candle, so there is no real price
   history. Rather than an empty chart we shape a plausible path that ENDS on the
   real current price, flagged `synthetic: true` so the UI can label it.
   Delete this once a provider with candle access is wired in. */

function seeded(s) {
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGE_SHAPE = {
  "1D": [78, 0.004], "5D": [90, 0.010], "1M": [110, 0.022], "6M": [130, 0.060],
  "YTD": [130, 0.075], "1Y": [140, 0.090], "5Y": [150, 0.200], "MAX": [160, 0.320],
};

function syntheticSeries(symbol, range, endPrice, dayPct) {
  const [n, vol] = RANGE_SHAPE[range] || RANGE_SHAPE["1Y"];
  let seed = 0;
  for (const ch of symbol + range) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rnd = seeded(seed);

  const drift = range === "1D" ? dayPct / 100 : (rnd() * 0.5 + 0.05) * (vol / 0.09);
  let v = endPrice / (1 + drift);
  const out = [];
  for (let i = 0; i < n; i++) {
    v = v * (1 + drift / n + (rnd() - 0.5) * (vol / 6));
    out.push(v);
  }
  out[out.length - 1] = endPrice;
  return out;
}

function shapeNews(arr, tk) {
  return (Array.isArray(arr) ? arr : []).slice(0, 12).map((n) => ({
    headline: n.headline, source: n.source, url: n.url,
    datetime: n.datetime, symbol: tk, image: n.image || null,
  }));
}

/* ---------- endpoints ---------- */

const routes = {
  async quote(q) {
    const symbols = String(q.symbols || q.symbol || "")
      .toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
    if (!symbols.length) throw Object.assign(new Error("Pass ?symbols="), { code: 400 });

    const out = {};
    await Promise.all(symbols.map(async (s) => {
      try {
        const d = await cached("q:" + s, 20000, () => finnhub("/quote?symbol=" + s));
        out[s] = d && d.c
          ? { price: d.c, change: d.d, pct: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc, at: d.t }
          : null;
      } catch (e) {
        out[s] = null;
      }
    }));
    return { quotes: out };
  },

  async tape(q) {
    const symbols = String(q.symbols || "")
      .toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    if (!symbols.length) throw Object.assign(new Error("Pass ?symbols="), { code: 400 });

    const items = await Promise.all(symbols.map(async (s) => {
      try {
        const [quote, profile] = await Promise.all([
          cached("q:" + s, 20000, () => finnhub("/quote?symbol=" + s)),
          cached("p:" + s, 86400000, () => finnhub("/stock/profile2?symbol=" + s)).catch(() => ({})),
        ]);
        if (!quote || !quote.c) return null;
        return {
          symbol: s, name: profile.name || s, logo: profile.logo || null,
          price: quote.c, change: quote.d, pct: quote.dp,
        };
      } catch (e) {
        return null;
      }
    }));
    return { items: items.filter(Boolean) };
  },

  async search(q) {
    const term = String(q.q || "").trim();
    if (!term) return { results: [] };
    const d = await cached("s:" + term.toLowerCase(), 600000, () => finnhub("/search?q=" + encodeURIComponent(term)));
    return {
      results: (d.result || [])
        .filter((r) => r.type === "Common Stock" && !r.symbol.includes("."))
        .slice(0, 8)
        .map((r) => ({ symbol: r.displaySymbol, name: r.description })),
    };
  },

  async profile(q) {
    const s = String(q.symbol || "").toUpperCase();
    const d = await cached("p:" + s, 86400000, () => finnhub("/stock/profile2?symbol=" + s));
    return {
      name: d.name, exchange: d.exchange, industry: d.finnhubIndustry,
      logo: d.logo, marketCap: d.marketCapitalization, currency: d.currency,
    };
  },

  async news(q) {
    const s = q.symbol ? String(q.symbol).toUpperCase() : null;
    if (s) {
      const iso = (d) => d.toISOString().slice(0, 10);
      const d = await cached("n:" + s, 300000, () =>
        finnhub(`/company-news?symbol=${s}&from=${iso(new Date(Date.now() - 7 * 864e5))}&to=${iso(new Date())}`));
      return { news: shapeNews(d, s) };
    }
    const d = await cached("n:general", 300000, () => finnhub("/news?category=general"));
    return { news: shapeNews(d, null) };
  },

  async metric(q) {
    const s = String(q.symbol || "").toUpperCase();
    const d = await cached("m:" + s, 86400000, () => finnhub("/stock/metric?symbol=" + s + "&metric=all"));
    const m = d.metric || {};
    return {
      peRatio: m.peTTM, eps: m.epsTTM, high52: m["52WeekHigh"], low52: m["52WeekLow"],
      beta: m.beta, divYield: m.dividendYieldIndicatedAnnual, avgVolume: m["10DayAverageTradingVolume"],
    };
  },

  async candles(q) {
    const s = String(q.symbol || "").toUpperCase();
    const range = String(q.range || "1Y").toUpperCase();
    const { quotes } = await routes.quote({ symbols: s });
    const live = quotes[s];
    if (!live) throw Object.assign(new Error("No quote for " + s), { code: 404 });
    return {
      symbol: s, range, synthetic: true,
      reason: "Finnhub's free plan does not include /stock/candle (403). Prices shown are shaped, not historical.",
      values: syntheticSeries(s, range, live.price, live.pct || 0),
      last: live.price,
    };
  },

  async health() {
    let keyState;
    try { getKey(); keyState = "present"; } catch (e) { keyState = "MISSING"; }
    return { ok: keyState === "present", key: keyState, upstreamCalls, cacheEntries: cache.size };
  },
};

/** Run a named endpoint. Throws errors carrying a `.code` for the HTTP status. */
async function handle(name, query) {
  const fn = routes[name];
  if (!fn) throw Object.assign(new Error("No such endpoint: " + name), { code: 404 });
  return fn(query || {});
}

function statusFor(err) {
  const c = err && err.code;
  return c === 400 || c === 404 || c === 429 || c === 403 || c === 500 ? c : 502;
}

module.exports = { handle, statusFor, routes };
