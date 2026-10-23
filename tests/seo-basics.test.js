// Run from the repo root: node tests/seo-basics.test.js
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function meta(attr, name) {
  const re = new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`);
  const found = html.match(re);
  return found ? found[1] : null;
}

const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const description = meta("name", "description");
const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((item) => item[1].replace(/<[^>]+>/g, "").trim());

check("title length", title && title.length <= 60, true);
check("title", title, "Heftology | Mobile Bartending & Craft Cocktails in Tampa Bay");
check("one h1", h1s.length, 1);
check("h1 phrase", h1s[0] && h1s[0].includes("Mobile Bartending in Tampa Bay"), true);
check("description length", description && description.length <= 160, true);
check("description", description, "Heftology (Hefta Crafted Cocktails): mobile bartenders for weddings, corporate events & private parties in Tampa Bay. You bring the spirits; we bring the craft.");
check("canonical", (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1], "https://heftology.com/");
check("og title matches", meta("property", "og:title"), title);
check("twitter title matches", meta("name", "twitter:title"), title);
check("og description matches", meta("property", "og:description"), description);

const jsonText = (html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/) || [])[1];
let parsed = null;
let parseError = null;
try {
  parsed = JSON.parse(jsonText);
} catch (err) {
  parseError = err.message;
}
check("json-ld parses", parseError, null);
check("json-ld type", parsed && parsed["@type"], "LocalBusiness");

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
