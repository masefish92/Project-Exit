// Local dev server. Serves ./prototype and exposes the same /api/* endpoints
// that api/[fn].js serves on Vercel — both delegate to lib/finnhub.js, so there
// is one implementation and dev cannot drift from production.
//
// This file is NOT used on Vercel.
//
//   npm run dev          → http://localhost:3000
//   node server.js 4000  → another port

const http = require("http");
const fs = require("fs");
const path = require("path");
const { handle, statusFor } = require("./lib/finnhub");

const ROOT = path.join(__dirname, "public");
const PORT = Number(process.argv[2]) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon",
};

// Mirrors the rewrites in vercel.json so local URLs match production.
// Mirrors Vercel's `cleanUrls: true`, so local URLs match production exactly.
function resolveStatic(pathname) {
  if (pathname === "/") return "/index.html";
  if (path.extname(pathname)) return pathname;
  return pathname + ".html";
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");

  if (u.pathname.startsWith("/api/")) {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    try {
      const data = await handle(u.pathname.slice(5), Object.fromEntries(u.searchParams));
      res.writeHead(200).end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(statusFor(err)).end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const rel = resolveStatic(decodeURIComponent(u.pathname));
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
  console.log("API: /api/quote /api/tape /api/search /api/profile /api/news /api/metric /api/candles /api/health");
});
