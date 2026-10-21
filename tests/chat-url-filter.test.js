// Run from the repo root: node tests/chat-url-filter.test.js
// The reply filter must strip invented paths, bare domains, other mailboxes,
// and markdown links, and leave only the https homepage and carissa@heftology.com.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = got === want;
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  return ok;
}

const chatPath = path.join(__dirname, "..", "netlify", "functions", "chat.js");
const { filterReplyUrls } = require(chatPath);

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

check(
  "strips bare, www, http, and https booking paths",
  filterReplyUrls(
    "A heftology.com/booking B www.heftology.com/booking C http://heftology.com/booking D https://heftology.com/booking E"
  ),
  "A the booking form on our website B the booking form on our website C the booking form on our website D the booking form on our website E"
);

check(
  "keeps a trailing period on a stripped bare path",
  filterReplyUrls("Visit heftology.com/booking."),
  "Visit the booking form on our website."
);
check(
  "keeps a trailing exclamation on a stripped www path",
  filterReplyUrls("Visit www.heftology.com/booking!"),
  "Visit the booking form on our website!"
);
check(
  "keeps a trailing period on a stripped https path",
  filterReplyUrls("Visit https://heftology.com/booking."),
  "Visit the booking form on our website."
);
check(
  "keeps a trailing comma on a stripped http path",
  filterReplyUrls("Visit http://heftology.com/booking, please."),
  "Visit the booking form on our website, please."
);

check(
  "only the https homepage and mailto survive",
  filterReplyUrls(
    "Yes https://heftology.com/ and https://heftology.com/#booking and mailto:carissa@heftology.com. No http://heftology.com/ or http://heftology.com/#booking or https://www.heftology.com/ or www.heftology.com/ or heftology.com/ or heftology.com/#booking."
  ),
  "Yes https://heftology.com/ and https://heftology.com/#booking and mailto:carissa@heftology.com. No the booking form on our website or the booking form on our website or the booking form on our website or the booking form on our website or the booking form on our website or the booking form on our website."
);

const markdown = filterReplyUrls("Please [book a tasting](https://heftology.com/booking) today.");
check(
  "markdown link keeps its text",
  markdown,
  "Please book a tasting the booking form on our website today."
);
check("markdown replacement leaves no link syntax", markdown.includes("]("), false);
check(
  "markdown bare path keeps its text",
  filterReplyUrls("Please [book a tasting](heftology.com/booking) today."),
  "Please book a tasting the booking form on our website today."
);
check(
  "markdown www path keeps its text",
  filterReplyUrls("Please [book a tasting](www.heftology.com/booking) today."),
  "Please book a tasting the booking form on our website today."
);
check(
  "markdown http path keeps its text",
  filterReplyUrls("Please [book a tasting](http://heftology.com/booking) today."),
  "Please book a tasting the booking form on our website today."
);
check(
  "allowed markdown link keeps the homepage url",
  filterReplyUrls("Use [the form](https://heftology.com/#booking) please."),
  "Use [the form](https://heftology.com/#booking) please."
);
check(
  "allowed markdown mailto keeps Carissa's address",
  filterReplyUrls("Use [email](mailto:carissa@heftology.com) please."),
  "Use [email](mailto:carissa@heftology.com) please."
);

check(
  "replaces every email except carissa@heftology.com",
  filterReplyUrls("Try michelle@heftology.com, info@heftology.com, or carissa@heftology.com."),
  "Try the booking form on our website, the booking form on our website, or carissa@heftology.com."
);
check(
  "replaces a mailto to another address",
  filterReplyUrls("Write mailto:michelle@heftology.com or mailto:info@heftology.com."),
  "Write the booking form on our website or the booking form on our website."
);
check(
  "markdown mailto to someone else keeps its text",
  filterReplyUrls("Ask [Michelle](mailto:michelle@heftology.com) instead."),
  "Ask Michelle the booking form on our website instead."
);

const src = fs.readFileSync(chatPath, "utf8");
const open = src.indexOf("const SYSTEM_PROMPT = `");
const close = src.indexOf("`;", open);
const prompt = open >= 0 && close > open ? src.slice(open + "const SYSTEM_PROMPT = `".length, close) : "";
check("prompt says to email only Carissa's address", prompt.includes("Email only carissa@heftology.com"), true);
check("prompt does not invent another mailbox", /michelle@|info@/i.test(prompt), false);

const failed = results.filter((line) => line.startsWith("FAIL")).length;
results.forEach((line) => console.log(line));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
