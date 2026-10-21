// Run from the repo root: node tests/chat-service-area.test.js
// The chat system prompt must keep Lakeland on the covered list and must not
// tell the assistant that a covered city has a travel cost.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = got === want;
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  return ok;
}

const src = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "chat.js"), "utf8");
const open = src.indexOf("const SYSTEM_PROMPT = `");
const close = src.indexOf("`;", open);
const prompt = open >= 0 && close > open ? src.slice(open + "const SYSTEM_PROMPT = `".length, close) : "";
const areaStart = prompt.indexOf("## SERVICE AREA");
const areaEnd = prompt.indexOf("\n## ", areaStart + 1);
const area = areaStart >= 0 ? prompt.slice(areaStart, areaEnd > areaStart ? areaEnd : undefined) : "";
const covered = area.split("\n").find((line) => line.includes("Covered cities include:")) || "";

check("system prompt is present", prompt.length > 0, true);
check("Lakeland is on the covered list", covered.includes("Lakeland"), true);

const travelSentences = area.split(/(?<=\.)\s+/).filter((sentence) => /travel (?:cost|fee)/i.test(sentence));
const chargesCoveredCity = travelSentences.some((sentence) => {
  if (/no travel fee/i.test(sentence)) return false;
  if (/outside (?:this|that|the) list/i.test(sentence)) return false;
  return /covered|Lakeland/i.test(sentence);
});
check("prompt does not charge a covered city for travel", chargesCoveredCity, false);

const distantAt = area.indexOf("For a very distant place");
const distant = distantAt >= 0 ? area.slice(distantAt) : "";
check(
  "very distant replies must begin with That's probably outside our range",
  distant.includes('the reply must begin with "That\'s probably outside our range"'),
  true
);
check(
  "very distant replies then invite an email to carissa@heftology.com",
  distant.includes("invite an email to carissa@heftology.com"),
  true
);
check(
  "very distant replies forbid work something out, exception, may still be possible, and reach out to see if",
  distant.includes('Never use "work something out", "exception", "may still be possible", or "reach out to see if"'),
  true
);
check(
  "very distant means more than about two hours' drive from the Tampa Bay area",
  distant.includes("anywhere more than about two hours' drive from the Tampa Bay area") &&
    distant.includes("far South Florida") &&
    distant.includes("the Keys") &&
    distant.includes("the Panhandle") &&
    distant.includes("North Florida") &&
    distant.includes("out of state"),
  true
);
check(
  "nearby places outside the list stay case by case",
  area.includes("within about two hours' drive of the Tampa Bay area") && area.includes("case by case"),
  true
);
check("prompt does not name Cape Coral", prompt.includes("Cape Coral"), false);
check("prompt does not name Miami", prompt.includes("Miami"), false);
check("prompt does not name Cape Canaveral", prompt.includes("Cape Canaveral"), false);

const failed = results.filter((line) => line.startsWith("FAIL")).length;
results.forEach((line) => console.log(line));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
