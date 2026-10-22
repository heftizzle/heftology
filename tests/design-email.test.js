// Run from the repo root: node tests/design-email.test.js
// Hostile input against the design-email renderer. The renderer itself is not modified here.
const path = require("path");
const { renderDesignEmail } = require(path.join(__dirname, "..", "netlify", "functions", "lib", "design-email"));

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const evil = "<script>alert(1)</script> https://evil.example/pay a@b.co www.evil.com \u202Egnp.exe\u200B";
const crlf = "Line1\r\nBcc: attacker@evil.example\r\nX: y";
const out = renderDesignEmail({
  cocktail: {
    name: crlf + evil + "N".repeat(300),
    tagline: evil,
    ingredients: [evil, crlf, "ok 1 oz"],
    garnish: evil,
    glass: evil,
    method: evil + "M".repeat(2000),
    colorNote: evil,
    heftologyNote: evil,
    presenter: evil,
  },
  input: { theme: crlf + evil, colors: evil, month: evil, venue: evil, preferences: evil },
  ref: "<b>x</b>" + evil,
  isPreview: true,
  now: new Date("2026-10-22T17:45:00Z"),
});

const core = out.subject.replace("[PREVIEW] ", "");
check("subject has no CR or LF", /[\r\n]/.test(out.subject), false);
check("subject has no angle brackets", /[<>]/.test(out.subject), false);
check("preview subject prefix", out.subject.startsWith("[PREVIEW] Cocktail Designer: "), true);
check("subject core is at most 120 chars", Array.from(core).length <= 120, true);

const hidden = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;
for (const key of Object.keys(out)) {
  check(key + " has no bidi or zero-width", hidden.test(out[key]), false);
  check(key + " has no live URL", /https?:\/\//i.test(String(out[key]).replace(/<meta[^>]*>/g, "")), false);
  check(key + " has no live email address", /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(out[key]), false);
}

check("html has no script tag", /<script/i.test(out.html), false);
check("html has no anchor tag", /<a\s/i.test(out.html), false);
check("html has no img tag", /<img\s/i.test(out.html), false);
check("text is not html-escaped", /&lt;script/.test(out.text), false);
check("html escapes script", out.html.includes("&lt;script&gt;"), true);
check("text defangs urls", out.text.includes("[://]"), true);
check("text defangs addresses", out.text.includes("[at]"), true);
check("html size stays sane", out.html.length < 40000, true);

const plain = renderDesignEmail({
  cocktail: { name: "Garden Cup" },
  input: { theme: "garden" },
  ref: "abcdef12",
  isPreview: false,
  now: new Date("2026-10-22T17:45:00Z"),
});
check("production subject has no preview prefix", plain.subject.startsWith("[PREVIEW]"), false);
check("production subject has no CR or LF", /[\r\n]/.test(plain.subject), false);
check("production subject has no angle brackets", /[<>]/.test(plain.subject), false);
check("production subject is at most 120 chars", Array.from(plain.subject).length <= 120, true);
check("production html has no script tag", /<script/i.test(plain.html), false);
check("production html has no anchor tag", /<a\s/i.test(plain.html), false);
check("production html has no img tag", /<img\s/i.test(plain.html), false);

const empty = renderDesignEmail({});
check("empty call names a signature cocktail", empty.subject.includes("Signature Cocktail"), true);
check("empty call still returns html", empty.html.includes("<html"), true);

const odd = renderDesignEmail({ cocktail: { ingredients: "not-an-array" }, input: null });
check("odd ingredients still render text", odd.text.length > 0, true);

const failed = results.filter((line) => line.startsWith("FAIL"));
process.stdout.write(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
