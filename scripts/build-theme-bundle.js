// Rebuilds themes/bundle.json from themes/manifest.json and the listed files.
// Netlify runs this on every deploy: node scripts/build-theme-bundle.js
const fs = require("fs");
const path = require("path");

const themesDir = path.join(__dirname, "..", "themes");
const manifest = JSON.parse(fs.readFileSync(path.join(themesDir, "manifest.json"), "utf8"));
const themes = (manifest.themes || []).map((rel) => {
  const file = path.join(themesDir, rel);
  return JSON.parse(fs.readFileSync(file, "utf8"));
});
const dest = path.join(themesDir, "bundle.json");
fs.writeFileSync(dest, JSON.stringify({ themes }, null, 2) + "\n");
console.log(`wrote ${themes.length} themes to themes/bundle.json`);
