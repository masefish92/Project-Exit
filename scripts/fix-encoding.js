// Repairs cp1252 double-encoding and strips BOMs from the prototype files.
// Caused by a PowerShell Get-Content/Set-Content round-trip that read the file
// as ANSI and wrote it back as UTF-8. Safe to re-run.
const fs = require("fs");
const path = require("path");

const FIXES = [
  ["â€”", "—"], // —
  ["â€“", "–"], // –
  ["â€¢", "•"], // •
  ["â€¦", "…"], // …
  ["âˆ’", "−"], // − (minus sign)
  ["â€™", "’"], // ’
  ["Â·", "·"],       // ·
  ["Â ", " "],       // nbsp
];

const dir = path.join(__dirname, "..", "prototype");
for (const name of fs.readdirSync(dir)) {
  const file = path.join(dir, name);
  let text = fs.readFileSync(file, "utf8");
  const before = text;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  for (const [bad, good] of FIXES) text = text.split(bad).join(good);

  if (text !== before) {
    fs.writeFileSync(file, text, "utf8");
    console.log("fixed  " + name);
  } else {
    console.log("clean  " + name);
  }
}
