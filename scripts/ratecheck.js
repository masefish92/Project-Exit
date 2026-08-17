// Measures how many Finnhub calls ONE open dashboard tab actually costs.
// Replays what the page does: one /api/tape load, then /api/quote every 20s.
// Run the dev server first, then: node scripts/ratecheck.js
const B = "http://localhost:3000";

const TAPE = ["SPY","QQQ","DIA","AAPL","MSFT","NVDA","GOOGL","AMZN","TSLA","META","AMD","AVGO","JPM","GLD"];
const POLL = [ // HOLD + WATCH + INDICES, deduplicated the way the page polls them
  "AAPL","MSFT","NVDA","GOOGL","AMZN","TSLA","AMD",
  "META","AVGO","JPM",
  "SPY","QQQ","DIA","IWM","GLD",
];

const calls = async () => (await (await fetch(B + "/api/health")).json()).upstreamCalls;

(async () => {
  const start = await calls();
  console.log("baseline upstream calls:", start);

  await fetch(B + "/api/tape?symbols=" + TAPE.join(","));
  console.log("after initial tape load: ", await calls(), " (quotes + logos)");

  const t0 = Date.now();
  for (let i = 0; i < 3; i++) {
    await fetch(B + "/api/quote?symbols=" + POLL.join(","));
    const n = await calls();
    console.log(`  t+${String(Math.round((Date.now() - t0) / 1000)).padStart(2)}s  total=${n}  delta=${n - start}`);
    if (i < 3) await new Promise((r) => setTimeout(r, 60000));
  }

  const end = await calls();
  const secs = (Date.now() - t0) / 1000;
  const perMin = ((end - start) / secs) * 60;

  console.log("\n--- one browser tab, steady state ---");
  console.log("upstream calls in " + Math.round(secs) + "s:", end - start);
  console.log("→ " + perMin.toFixed(0) + " calls/min   (Finnhub free tier ceiling: 60/min)");
  console.log(perMin > 60 ? "OVER BUDGET" : perMin > 45 ? "TIGHT — little headroom" : "comfortable");
})();
