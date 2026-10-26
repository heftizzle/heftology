// Run from the repo root: node tests/faq.test.js
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const chat = fs.readFileSync(path.join(root, "netlify", "functions", "chat.js"), "utf8");

const h1s = [...html.matchAll(/<h1\b[^>]*>[\s\S]*?<\/h1>/g)];
check("one h1", h1s.length, 1);

const faqSections = [...html.matchAll(/<section\b[^>]*\bid="faq"[^>]*>/g)];
check("one faq section", faqSections.length, 1);

const testimonialsAt = html.indexOf('id="testimonials"');
const faqAt = html.indexOf('id="faq"');
const bookingAt = html.indexOf('id="booking"');
check("faq between testimonials and booking", testimonialsAt < faqAt && faqAt < bookingAt, true);

const faqHtml = html.slice(faqAt, html.indexOf("</section>", faqAt));
const details = [...faqHtml.matchAll(/<details>/g)];
check("eight details", details.length, 8);
const summaries = [...faqHtml.matchAll(/<summary>/g)];
check("eight summaries", summaries.length, 8);
check("each details has a summary", details.length === summaries.length, true);

const nav = (html.match(/<ul class="nav-links"[\s\S]*?<\/ul>/) || [""])[0];
const footer = (html.match(/<ul class="footer-links"[\s\S]*?<\/ul>/) || [""])[0];
check("nav faq link", nav.includes('href="#faq"'), true);
check("footer faq link", footer.includes('href="#faq"'), true);
check("faq has no insured", /insured/i.test(faqHtml), false);

check("index has no 25%", html.includes("25%"), false);
check("chat has no 25%", chat.includes("25%"), false);
check("chat balance timing", chat.includes("5 days before"), true);
check("chat dropped old refund line", chat.includes("full deposit refunded"), false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
