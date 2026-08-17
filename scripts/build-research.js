// Builds public/research/* from the markdown in content/research/.
//
//   node scripts/build-research.js
//
// For each note it writes:
//   public/research/<slug>.html       the page: header, meta, and the FREE preview
//   public/research/<slug>.body.html  the gated remainder, fetched only when unlocked
//   public/research/index.json        metadata the Research index page renders from
//
// The preview/gated split happens at the first "## 1." heading: everything above
// it (data table, thesis summary, why now) is free; the analysis is paid.
//
// NOTE FOR PRODUCTION: <slug>.body.html is a plain static file, so in this
// prototype a determined visitor can fetch it directly. That is acceptable while
// there is no auth. When Stripe entitlement lands, the body must be served by an
// authenticated endpoint that checks the subscription BEFORE returning content —
// see PLAN.md Phase 6. The split exists now so that swap is a one-line change.

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "content", "research");
const OUT = path.join(__dirname, "..", "public", "research");

/* ---------- encoding repair ----------
   Source documents arrive with cp1252 double-encoding from upstream tooling. */
const MOJIBAKE = [
  ["â€”", "—"], ["â€“", "–"], ["â€¢", "•"], ["â€¦", "…"],
  ["â€™", "’"], ["â€œ", "“"], ["â€", "”"], ["Â±", "±"], ["Â·", "·"], ["Â ", " "],
];
function repair(s) {
  for (const [bad, good] of MOJIBAKE) s = s.split(bad).join(good);
  return s;
}

/* ---------- frontmatter ---------- */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body: m[2] };
}

/* ---------- markdown ---------- */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderTable(rows) {
  const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return (
    '<div class="table-scroll"><table>' +
    "<thead><tr>" + head.map((c) => `<th scope="col">${inline(c)}</th>`).join("") + "</tr></thead>" +
    "<tbody>" + body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody>" +
    "</table></div>"
  );
}

function markdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // table
    if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }

    // heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const id = h[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      out.push(`<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^---+\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }

    // list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*[-*]\s+/, "")));
        i++;
      }
      out.push("<ul>" + items.map((t) => `<li>${t}</li>`).join("") + "</ul>");
      continue;
    }

    // paragraph (gather until blank line)
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*[-*]\s|---+\s*$)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      const joined = para.join(" ").trim();
      // a paragraph that is entirely italic reads as a standing note
      const isNote = /^\*[^*].*\*$/.test(joined);
      out.push(isNote ? `<p class="note-para">${inline(joined)}</p>` : `<p>${inline(joined)}</p>`);
    }
  }
  return out.join("\n");
}

/* ---------- page shell ---------- */
const STANCE_LABEL = {
  accumulating: "Accumulating", holding: "Holding", trimming: "Trimming",
  exited: "Exited", passed: "Passed",
};

function page(meta, previewHtml, slug) {
  return `<title>${esc(meta.symbol)} — Exit Research</title>
<link rel="stylesheet" href="/app.css">

<div class="app">
  <div class="orb" aria-hidden="true"><i class="up"></i><i class="down"></i><i class="core"></i></div>

  <header class="topbar">
    <a class="brand" href="/" style="text-decoration:none;color:inherit">
      <svg class="mark" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <defs><linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#E879C7"/><stop offset=".55" stop-color="#8B5CF6"/><stop offset="1" stop-color="#3B5BFF"/>
        </linearGradient></defs>
        <path d="M3 15.5 8 9.5l4 3.6 7-9.1" stroke="url(#bg1)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="19" cy="4" r="2.6" fill="url(#bg1)"/>
      </svg>
      <b>Exit</b>
    </a>
    <nav class="pills" aria-label="Primary">
      <a href="/portfolio">Portfolio</a>
      <a href="/trades">Trades</a>
      <a href="/research" aria-current="page">Research</a>
      <a href="/takes">C:\\Takes</a>
    </nav>
    <span class="spacer"></span>
    <span class="chip" id="tier-chip">Free plan</span>
    <div class="avatar" title="Marcus">M</div>
  </header>

  <a class="backlink" href="/research">
    <span class="arr">&#10229;</span> All research
  </a>

  <article class="report-page">
    <div class="rp-head">
      <div class="rp-top">
        <span class="rp-sym">${esc(meta.symbol)}</span>
        <span class="stance ${esc(meta.stance)}">${STANCE_LABEL[meta.stance] || esc(meta.stance)}</span>
        <span class="type-tag">${esc(meta.sector || "Equity")}</span>
      </div>
      <h1>${esc(meta.company)}</h1>
      <p class="rp-sub">${inline(meta.subtitle || "")}</p>
      <div class="rp-meta">
        <span>${esc(meta.date)}</span><span class="sep">·</span>
        <span>Stage: ${esc(meta.stage)}</span><span class="sep">·</span>
        <span>${esc(meta.read)} read</span>
      </div>
    </div>

    <div class="prose">${previewHtml}</div>

    <div id="gate"></div>
  </article>

  <p class="disclaimer">
    ${esc(meta.disclaimer || "For informational purposes only. Not investment advice.")}
    I hold positions in many companies covered here and may buy or sell at any time —
    see <a href="/portfolio" style="color:var(--ink-2)">what I own</a>. Written at a point in
    time and not maintained afterwards.
  </p>

  <!-- Removed once real Stripe entitlement is wired; see PLAN.md Phase 6. -->
  <div class="devbar">
    Prototype state
    <div class="seg" id="statesw" role="group" aria-label="Preview state">
      <button type="button" aria-pressed="true" data-s="locked">Free visitor</button>
      <button type="button" aria-pressed="false" data-s="unlocked">Subscriber</button>
    </div>
  </div>
</div>

<script>
(function(){
  "use strict";
  var $=function(s){return document.querySelector(s);};
  var SLUG=${JSON.stringify(slug)};
  var loaded=false;

  var LOCK='<div class="gate-lock">'+
    '<h3>Read the full note</h3>'+
    '<p>The rest of this note — company detail, financials, catalysts, the bull and bear cases, '+
    'and what would change my mind — is for subscribers. $19/month, cancel anytime.</p>'+
    '<button class="btn" type="button" id="sub">Subscribe'+
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'+
    '</button></div>';

  async function unlock(){
    if(loaded){ $("#gate").hidden=false; return; }
    $("#gate").innerHTML='<p class="loading">Loading the full note…</p>';
    try{
      // Phase 6: this becomes an authenticated endpoint that verifies the
      // subscription server-side before returning any content.
      var r=await fetch("/research/"+SLUG+".body.html");
      if(!r.ok) throw new Error("HTTP "+r.status);
      $("#gate").innerHTML='<div class="prose">'+(await r.text())+'</div>';
      loaded=true;
    }catch(e){
      $("#gate").innerHTML='<p class="loading">Could not load the rest of this note. Please refresh.</p>';
    }
  }

  function setState(on){
    $("#tier-chip").textContent=on?"Premium":"Free plan";
    $("#tier-chip").style.cssText=on
      ?"color:var(--magenta);border-color:rgba(232,121,199,.3);background:rgba(232,121,199,.09)":"";
    [].forEach.call($("#statesw").children,function(c){
      c.setAttribute("aria-pressed",String((c.dataset.s==="unlocked")===on));
    });
    if(on){ unlock(); }
    else { $("#gate").innerHTML=LOCK; bindSub(); }
  }
  function bindSub(){
    var b=$("#sub"); if(b) b.addEventListener("click",function(){ setState(true); });
  }

  $("#statesw").addEventListener("click",function(e){
    var b=e.target.closest("button"); if(!b) return;
    setState(b.dataset.s==="unlocked");
  });

  setState(false);
})();
</script>
`;
}

/* ---------- build ---------- */
fs.mkdirSync(OUT, { recursive: true });

const index = [];
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".md"))) {
  const slug = file.replace(/\.md$/, "");
  const raw = repair(fs.readFileSync(path.join(SRC, file), "utf8"));
  const { meta, body } = parseFrontmatter(raw);

  // Drop the leading H1 and the italic strapline — the page header carries them.
  let content = body.replace(/^#\s+.*$/m, "").replace(/^\*Equity Research[^\n]*\*$/m, "");

  // Split free preview from paid remainder at the first numbered section.
  const splitAt = content.search(/^##\s+1\./m);
  const preview = splitAt > -1 ? content.slice(0, splitAt) : content;
  const rest = splitAt > -1 ? content.slice(splitAt) : "";

  fs.writeFileSync(path.join(OUT, slug + ".html"), page(meta, markdown(preview), slug), "utf8");
  fs.writeFileSync(path.join(OUT, slug + ".body.html"), markdown(rest), "utf8");

  // Pull the first bold sentence of the thesis as the index card's summary.
  const hook = (preview.match(/\*\*([^*]{80,400})\*\*/) || [])[1] || "";

  index.push({
    slug, symbol: meta.symbol, company: meta.company, subtitle: meta.subtitle,
    date: meta.date, stage: meta.stage, stance: meta.stance, sector: meta.sector,
    read: meta.read, hook: hook.trim(),
    words: (rest.split(/\s+/).length + preview.split(/\s+/).length).toLocaleString("en-US"),
  });

  console.log(`built  ${slug.padEnd(10)} ${meta.symbol.padEnd(6)} preview ${preview.length} chars, gated ${rest.length} chars`);
}

index.sort((a, b) => (a.date < b.date ? 1 : -1));
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2), "utf8");
console.log(`\nwrote index.json with ${index.length} notes`);
