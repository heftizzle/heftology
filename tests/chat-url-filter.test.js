// Run from the repo root: node tests/chat-url-filter.test.js
// The reply filter must strip invented paths such as /booking and leave the
// homepage anchor and carissa@heftology.com untouched.
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = got === want;
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  return ok;
}

const { filterReplyUrls } = require(path.join(__dirname, "..", "netlify", "functions", "chat.js"));

const input = [
  "Book at https://www.heftology.com/booking or https://heftology.com/booking.",
  "The form is https://heftology.com/#booking.",
  "Email carissa@heftology.com or mailto:carissa@heftology.com.",
].join(" ");

const out = filterReplyUrls(input);

check("strips /booking", out.includes("/booking"), false);
check("leaves #booking", out.includes("https://heftology.com/#booking"), true);
check("leaves the email", out.includes("carissa@heftology.com"), true);
check("leaves the mailto address", out.includes("mailto:carissa@heftology.com"), true);
check("replaces a bad link with booking-form text", out.includes("the booking form on our website"), true);

check(
  "allowlist keeps the homepage and any fragment",
  filterReplyUrls("See https://heftology.com/ and https://heftology.com/#services. Not https://www.heftology.com/ or https://example.com/booking."),
  "See https://heftology.com/ and https://heftology.com/#services. Not the booking form on our website or the booking form on our website."
);

const failed = results.filter((line) => line.startsWith("FAIL")).length;
results.forEach((line) => console.log(line));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
