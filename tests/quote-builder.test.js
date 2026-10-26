// Run from the repo root: node tests/quote-builder.test.js
const fs = require("fs");
const path = require("path");
const qb = require("../quote-builder");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const chat = fs.readFileSync(path.join(root, "netlify", "functions", "chat.js"), "utf8");

check("30 guests 3h", qb.recommendPackage({ guests: 30, hours: 3 }), "The Craft Bar");
check("30 guests 5h", qb.recommendPackage({ guests: 30, hours: 5 }), "The Signature Pour");
check("100 guests 6h", qb.recommendPackage({ guests: 100, hours: 6 }), "The Signature Pour");
check("101 guests 6h", qb.recommendPackage({ guests: 101, hours: 6 }), "The Full Experience");
check("150 guests 8h", qb.recommendPackage({ guests: 150, hours: 8 }), "The Full Experience");
check("151 guests", qb.recommendPackage({ guests: 151, hours: 8 }), "custom");
check("60 guests unsure", qb.recommendPackage({ guests: 60, hoursUnsure: true }), "The Signature Pour");
check("cocktail class event", qb.recommendPackage({ guests: 30, hours: 3, eventType: "Cocktail Class" }), "Cocktail Class");

check("end 18:00 + 4", qb.endTimeLabel("18:00", 4), "Bar open 6:00 PM to 10:00 PM");
check("end 21:00 + 5", qb.endTimeLabel("21:00", 5), "Bar open 9:00 PM to 2:00 AM (next day)");
check("end empty start", qb.endTimeLabel("", 4), "4 hours");

check("tampa", qb.matchCoveredCity("tampa"), "Tampa");
check("st pete padded", qb.matchCoveredCity(" St. Pete "), "St. Pete");
check("lakeland", qb.matchCoveredCity("Lakeland"), "Lakeland");
check("zip is not a city", qb.matchCoveredCity("33579"), "");
check("orlando", qb.matchCoveredCity("Orlando"), "");
check("covered message", qb.cityMessage("tampa"), "Great, Tampa is in our service area. No travel fee.");
check("other message", qb.cityMessage("Orlando").includes("outside our area"), false);

check("long date", qb.formatDateLabel("2026-11-07", "long"), "Saturday, November 7, 2026");
check("short date", qb.formatDateLabel("2026-11-07", "short"), "Sat, Nov 7");

check("auto follows recommendation", qb.decideSelection({
  current: "The Craft Bar", source: "auto", recommended: "The Full Experience", guests: 120, hours: 6,
}), { selection: "The Full Experience", source: "auto", note: "" });
check("user choice that no longer covers stays", qb.decideSelection({
  current: "The Craft Bar", source: "user", recommended: "The Full Experience", guests: 120, hours: 6,
}), {
  selection: "The Craft Bar",
  source: "user",
  note: "The Craft Bar covers up to 50 guests. For 120 guests, The Full Experience fits best.",
});
check("larger user choice still covers", qb.decideSelection({
  current: "The Full Experience", source: "user", recommended: "The Craft Bar", guests: 30, hours: 3,
}), { selection: "The Full Experience", source: "user", note: "" });

const formStart = html.indexOf('<form id="booking-form"');
const form = html.slice(formStart, html.indexOf("</form>", formStart));
const prices = [...form.matchAll(/data-price="(\d+)"/g)].map((item) => item[1]);
check("data prices", prices, ["600", "950", "1500", "45"]);
check("services 600", html.includes("Starting at $600"), true);
check("services 950", html.includes("Starting at $950"), true);
check("services 1500", html.includes("Starting at $1,500"), true);
check("services 45", html.includes("Starting at $45/person"), true);

const readmeLine = readme.split("\n").find((line) => line.includes("Covered locations include")) || "";
const readmeCities = readmeLine
  .replace(/^.*Covered locations include\s+/, "")
  .replace(/\.\s*$/, "")
  .replace(/,?\s+and surrounding communities$/, "")
  .split(", ")
  .map((city) => city.replace(/^and\s+/, "").trim())
  .filter(Boolean);
const datalist = [...form.matchAll(/<option value="([^"]+)"><\/option>/g)].map((item) => item[1]);
check("datalist cities are covered", datalist.every((city) => readmeCities.includes(city)), true);
check("readme cities are in chat", readmeCities.every((city) => chat.includes(city)), true);
check("datalist matches the helper list", datalist, qb.coveredCities);

const policyStart = form.indexOf('id="qb-policy"');
const policy = form.slice(policyStart, form.indexOf("</p>", policyStart));
check("policy has deposit", policy.includes("50%"), true);
check("policy has balance timing", policy.includes("5 days"), true);
check("policy links faq", policy.includes('href="#faq"'), true);
check("policy has no refund language", /refund|credit|25%/i.test(policy), false);
check("page has faq section", html.includes('id="faq"'), true);

const submits = [...form.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)].map((item) => item[0]);
check("one submit button", submits.length, 1);
check("submit id", submits[0].includes('id="form-submit-btn"'), true);

function badgeText(chunk) {
  const badge = chunk.match(/<a class="knot-badge"[\s\S]*?<\/a>/);
  return badge ? badge[0].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}
const hero = html.slice(html.indexOf('class="hero-knot"'), html.indexOf("</section>", html.indexOf('class="hero-knot"')));
const review = form.slice(form.indexOf('class="qb-trust"'), form.indexOf("</fieldset>", form.indexOf('class="qb-trust"')));
check("review knot badge matches hero", badgeText(review), badgeText(hero));

const wizardMotion = (css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.wz-step[\s\S]*?\}/) || [""])[0];
check("reduced motion covers wizard transitions", wizardMotion.includes(".wz-step") && wizardMotion.includes("transition: none"), true);

const designer = html.slice(html.indexOf("function renderCocktail"));
check("designer result event", designer.includes("new CustomEvent('designer:result'"), true);
check("designer reset event", designer.includes("new CustomEvent('designer:reset'"), true);

check("step 1 legend", form.includes(">Choose who or what you're celebrating.</legend>"), true);
check("next uses btn-primary", form.includes('<button type="button" class="btn-primary" id="qb-next">Next</button>'), true);
check("send uses btn-primary", form.includes('<button type="submit" class="btn-primary" id="form-submit-btn">Send My Quote Request →</button>'), true);
check("no recap panel", form.includes("qb-recap"), false);
check("no recap strip", form.includes("qb-strip"), false);
check("no step dots", form.includes("wz-dot"), false);
check("quote builder has no inline svg", /<svg\b/i.test(form), false);

const optionEmoji = ["🎉", "💍", "💼", "🍹", "✨", "🏡", "🏛️", "🍽️", "🏢", "🥂", "🤔", "📞", "💬", "✉️", "✓"];
const formWithoutHidden = form.replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "");
optionEmoji.forEach((emoji) => {
  check(emoji + " sits in an aria-hidden span", new RegExp('<span\\b[^>]*aria-hidden="true"[^>]*>' + emoji + "</span>").test(form), true);
  check(emoji + " is not duplicated outside that span", formWithoutHidden.includes(emoji), false);
});
check("craft bar summary has no extra emoji", form.includes("💅"), false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
