// Phase 0 spike: probe which Finnhub endpoints this key can actually reach.
// Run: node scripts/spike.js
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const KEY = (env.match(/^FINNHUB_API_KEY=(.+)$/m) || [])[1].trim();

const now = Math.floor(Date.now() / 1000);
const PROBES = [
  ["quote            ", "/quote?symbol=AAPL"],
  ["profile2         ", "/stock/profile2?symbol=AAPL"],
  ["search           ", "/search?q=nvidia"],
  ["company-news     ", "/company-news?symbol=AAPL&from=2026-08-06&to=2026-08-13"],
  ["market-news      ", "/news?category=general"],
  ["candle (1Y daily)", `/stock/candle?symbol=AAPL&resolution=D&from=${now - 31536000}&to=${now}`],
  ["metric/basic     ", "/stock/metric?symbol=AAPL&metric=all"],
  ["peers            ", "/stock/peers?symbol=AAPL"],
  ["earnings         ", "/stock/earnings?symbol=AAPL"],
  ["recommendation   ", "/stock/recommendation?symbol=AAPL"],
  ["index constituent", "/index/constituents?symbol=%5EGSPC"],
  ["forex rates      ", "/forex/rates?base=USD"],
];

function preview(body) {
  const s = body.replace(/\s+/g, " ").trim();
  return s.length > 110 ? s.slice(0, 110) + "…" : s;
}

(async () => {
  console.log("Probing Finnhub with key …" + KEY.slice(-6) + "\n");
  for (const [name, ep] of PROBES) {
    const url = "https://finnhub.io/api/v1" + ep + (ep.includes("?") ? "&" : "?") + "token=" + KEY;
    try {
      const r = await fetch(url);
      const body = await r.text();
      const ok = r.status === 200 && body !== "{}" && !/error/i.test(body.slice(0, 60));
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${r.status}  ${preview(body)}`);
    } catch (e) {
      console.log(`FAIL  ${name}  ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 350)); // stay under the rate limit
  }
})();
