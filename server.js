// Project Exit — prototype server.
//
// Serves ./prototype and proxies Finnhub under /api/*. The API key is read from
// .env.local and never leaves this process: the browser only ever talks to /api/*.
// This is the same boundary the Next.js route handlers will enforce in Phase 1.
//
//   npm run dev          → http://localhost:3000
//   node server.js 4000  → another port

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "prototype");
const PORT = Number(process.argv[2]) || 3000;
const BASE = "https://finnhub.io/api/v1";

/* ---------- config ---------- */

function loadKey() {
  if (process.env.FINNHUB_API_KEY) return process.env.FINNHUB_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
    const m = env.match(/^FINNHUB_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) {}
  console.error("No FINNHUB_API_KEY found in .env.local or the environment.");
  process.exit(1);
}
const KEY = loadKey();

/* ---------- cache ----------
   Finnhub's free tier allows 60 requests/minute. The dashboard watches ~14
   symbols, so without caching a single page would exhaust the budget in
   seconds. TTLs are tuned so a full refresh costs well under the limit. */

const cache = new Map();
function cached(key, ttlMs, produce) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.val);
  return produce().then((val) => {
    cache.set(key, { at: Date.now(), val });
    return val;
  });
}

let upstreamCalls = 0;
async function finnhub(endpoint) {
  upstreamCalls++;
  const url = BASE + endpoint + (endpoint.includes("?") ? "&" : "?") + "token=" + KEY;
  const r = await fetch(url);
  if (r.status === 429) throw Object.assign(new Error("Rate limited by Finnhub"), { code: 429 });
  if (r.status === 403) throw Object.assign(new Error("Not available on this Finnhub plan"), { code: 403 });
  if (!r.ok) throw Object.assign(new Error("Finnhub returned " + r.status), { code: 502 });
  return r.json();
}

/* ---------- synthetic history ----------
   Finnhub's free plan returns 403 for /stock/candle, so there is no real price
   history available. Rather than show an empty chart, we shape a plausible path
   that ENDS on the real current price — and every response is flagged
   `synthetic: true` so the UI can label it as not-real. Delete this the day a
   provider with candle access is wired in. */

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

  // Longer ranges drift more; 1D drift is anchored to the real day change.
  const drift = range === "1D" ? dayPct / 100 : (rnd() * 0.5 + 0.05) * (vol / 0.09);
  let v = endPrice / (1 + drift);
  const out = [];
  for (let i = 0; i < n; i++) {
    v = v * (1 + drift / n + (rnd() - 0.5) * (vol / 6));
    out.push(v);
  }
  out[out.length - 1] = endPrice; // always land on the real price
  return out;
}

/* ---------- api ---------- */

const routes = {
  // Real-time quote for one or more symbols: /api/quote?symbols=AAPL,NVDA
  async quote(q) {
    const symbols = String(q.symbols || q.symbol || "")
      .toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
    if (!symbols.length) throw Object.assign(new Error("Pass ?symbols="), { code: 400 });

    const out = {};
    await Promise.all(symbols.map(async (s) => {
      try {
        const d = await cached("q:" + s, 20000, () => finnhub("/quote?symbol=" + s));
        // Finnhub returns all-zero for unknown symbols.
        out[s] = d && d.c ? { price: d.c, change: d.d, pct: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc, at: d.t } : null;
      } catch (e) {
        out[s] = null;
      }
    }));
    return { quotes: out };
  },

  async search(q) {
    const term = String(q.q || "").trim();
    if (term.length < 1) return { results: [] };
    const d = await cached("s:" + term.toLowerCase(), 600000, () => finnhub("/search?q=" + encodeURIComponent(term)));
    const results = (d.result || [])
      .filter((r) => r.type === "Common Stock" && !r.symbol.includes("."))
      .slice(0, 8)
      .map((r) => ({ symbol: r.displaySymbol, name: r.description }));
    return { results };
  },

  async profile(q) {
    const s = String(q.symbol || "").toUpperCase();
    const d = await cached("p:" + s, 86400000, () => finnhub("/stock/profile2?symbol=" + s));
    return { name: d.name, exchange: d.exchange, industry: d.finnhubIndustry, logo: d.logo, marketCap: d.marketCapitalization, currency: d.currency };
  },

  async news(q) {
    const s = q.symbol ? String(q.symbol).toUpperCase() : null;
    if (s) {
      const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
      const iso = (d) => d.toISOString().slice(0, 10);
      const d = await cached("n:" + s, 300000, () => finnhub(`/company-news?symbol=${s}&from=${iso(from)}&to=${iso(to)}`));
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

  // Chart history. Finnhub free = 403 on candles, so this is shaped data
  // anchored to the real live price. Always flagged.
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

  // Ticker tape: quote + logo + display name for a list of symbols, in one
  // round trip. Quotes ride the 20s cache; logos/names the 24h profile cache,
  // so a full tape costs ~1 upstream call per symbol per 20s at worst.
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
          symbol: s,
          name: profile.name || s,
          logo: profile.logo || null,
          price: quote.c,
          change: quote.d,
          pct: quote.dp,
        };
      } catch (e) {
        return null;
      }
    }));
    return { items: items.filter(Boolean) };
  },

  async health() {
    return { ok: true, upstreamCalls, cacheEntries: cache.size, keyTail: "…" + KEY.slice(-4) };
  },
};

function shapeNews(arr, tk) {
  return (Array.isArray(arr) ? arr : []).slice(0, 12).map((n) => ({
    headline: n.headline, source: n.source, url: n.url,
    datetime: n.datetime, symbol: tk, image: n.image || null,
  }));
}

/* ---------- static ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5);
    const handler = routes[name];
    if (!handler) return send(404, { error: "No such endpoint: " + name });
    try {
      send(200, await handler(Object.fromEntries(u.searchParams)));
    } catch (e) {
      const code = e.code === 400 || e.code === 404 ? e.code : e.code === 429 ? 429 : 502;
      send(code, { error: e.message });
    }
    return;
  }

  let rel = decodeURIComponent(u.pathname);
  if (rel === "/") rel = "/dashboard.html";
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>404</h1><p>No file at " + rel + "</p>");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(buf);
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is busy. Try: node server.js " + (PORT + 1));
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, () => {
  console.log("Project Exit → http://localhost:" + PORT);
  console.log("Finnhub key …" + KEY.slice(-4) + " loaded server-side (never sent to the browser)");
  console.log("API: /api/quote /api/search /api/profile /api/news /api/metric /api/candles /api/health");
});
