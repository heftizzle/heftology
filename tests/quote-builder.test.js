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
check("end 22:00 + 4", qb.endTimeLabel("22:00", 4), "Bar open 10:00 PM to 2:00 AM (next day)");
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
check("step 2 legend", form.includes(">How will the event run?</legend>"), true);
check("booking form has no last night", /last night/i.test(form), false);
check("next uses btn-primary", form.includes('<button type="button" class="btn-primary" id="qb-next">Next</button>'), true);
check("send uses btn-primary", form.includes('<button type="submit" class="btn-primary" id="form-submit-btn">Send My Quote Request →</button>'), true);
check("no recap panel", form.includes("qb-recap"), false);
check("no recap strip", form.includes("qb-strip"), false);
check("no step dots", form.includes("wz-dot"), false);
check("quote builder has no inline svg", /<svg\b/i.test(form), false);

const optionEmoji = ["🎉", "💍", "💼", "🍹", "✨", "🏖️", "💃", "🏨", "🏊", "⛳", "🏠", "🏡", "🌆", "⛵", "🌳", "🏭", "🏛️", "🍽️", "🍷", "🏢", "🥂", "🤔", "📞", "💬", "✉️", "✓"];
const formWithoutHidden = form.replace(/<span\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "");
optionEmoji.forEach((emoji) => {
  check(emoji + " sits in an aria-hidden span", new RegExp('<span\\b[^>]*aria-hidden="true"[^>]*>' + emoji + "</span>").test(form), true);
  check(emoji + " is not duplicated outside that span", formWithoutHidden.includes(emoji), false);
});
check("craft bar summary has no extra emoji", form.includes("💅"), false);

const designerVenues = [...html.matchAll(/data-target="venue" data-value="([^"]+)"/g)].map((item) => item[1]);
const locationValues = [...form.matchAll(/name="location" value="([^"]+)"/g)].map((item) => item[1]);
check("designer venues lead the location chips", locationValues.slice(0, designerVenues.length), designerVenues);
check("office and other follow the designer venues", locationValues.slice(designerVenues.length), ["Office", "Other"]);
check("readme keeps the venue lists in sync", readme.includes("venue lists stay in sync"), true);

check("designer result sends the venue", designer.includes("venue:"), true);
check("designer venue fills an empty choice", qb.applyDesignerVenue({ current: "", source: "", incoming: "Beach" }), { selection: "Beach", source: "designer" });
check("designer venue keeps a visitor choice", qb.applyDesignerVenue({ current: "Hotel", source: "user", incoming: "Beach" }), { selection: "Hotel", source: "user" });
check("clear designer venue drops a designer pick", qb.clearDesignerVenue({ current: "Beach", source: "designer" }), { selection: "", source: "" });
check("clear designer venue keeps a visitor pick", qb.clearDesignerVenue({ current: "Hotel", source: "user" }), { selection: "Hotel", source: "user" });
check("review time uses the same clock", qb.formatTimeLabel("18:00"), "6:00 PM");
check("roller 6pm", qb.formatRollerTime(18 * 60), "6:00\u00A0PM");
check("roller noon", qb.formatRollerTime(12 * 60), "12:00\u00A0PM");
check("roller 10am", qb.formatRollerTime(10 * 60), "10:00\u00A0AM");
check("roller label keeps the time on one line", qb.formatRollerTime(18 * 60).includes(" "), false);
const slots = qb.startTimeSlots();
check("slot count", slots.length, 25);
check("slot first", slots[0], { value: "10:00", label: "10:00\u00A0AM" });
check("slot 6pm", slots[16], { value: "18:00", label: "6:00\u00A0PM" });
check("slot last", slots[24], { value: "22:00", label: "10:00\u00A0PM" });
check("slots step 30 minutes", slots.every((slot, index) => {
  if (!index) return true;
  const prev = slots[index - 1].value.split(":").map(Number);
  const next = slot.value.split(":").map(Number);
  return next[0] * 60 + next[1] - (prev[0] * 60 + prev[1]) === 30;
}), true);
check("nearest slot at the top", qb.nearestSlotIndex(0, 44, 25), 0);
check("nearest slot is 6pm", qb.nearestSlotIndex(16 * 44, 44, 25), 16);
check("nearest slot rounds down", qb.nearestSlotIndex(16 * 44 + 20, 44, 25), 16);
check("nearest slot rounds up", qb.nearestSlotIndex(16 * 44 + 22, 44, 25), 17);
check("nearest slot clamps", qb.nearestSlotIndex(9999, 44, 25), 24);
check("hours summary", qb.hoursSummary("18:00", 4, false), "6:00\u00A0PM \u2013 10:00\u00A0PM (4 hours)");
check("hours summary crosses midnight", qb.hoursSummary("22:00", 4, false), "10:00\u00A0PM \u2013 2:00\u00A0AM (4 hours) (next day)");
check("hours summary unsure", qb.hoursSummary("18:00", 4, true), "Not sure yet");
check("7:15 PM stays exact", qb.keptStartTime("19:15", "19:30"), "19:15");
check("4:45 PM stays exact", qb.keptStartTime("16:45", "17:00"), "16:45");
check("4:45 PM using note", qb.typedTimeNote("16:45", "17:00"), "Using 4:45 PM");
check("7:15 PM using note", qb.typedTimeNote("19:15", "19:30"), "Using 7:15 PM");
check("slot time has no using note", qb.typedTimeNote("18:00", "18:00"), "");
check("7:15 PM review line", qb.hoursSummary("19:15", 4, false), "7:15\u00A0PM \u2013 11:15\u00A0PM (4 hours)");
check("4:45 PM review line", qb.hoursSummary("16:45", 4, false), "4:45\u00A0PM \u2013 8:45\u00A0PM (4 hours)");
check("thumb center at 3 hours", qb.thumbCenter(0, 300, 19, 32), 35);
check("thumb center at 6 hours", Math.round(qb.thumbCenter(3 / 9, 300, 19, 32) * 1000) / 1000, Math.round((19 + 16 + (3 / 9) * (300 - 38 - 32)) * 1000) / 1000);
check("thumb center at 12 hours", qb.thumbCenter(1, 300, 19, 32), 265);
check("time error sits under the roller", form.includes('id="qb-time-error"') && form.includes(">Choose when the bar opens.</p>"), true);
check("no time chips", form.includes("data-time"), false);
check("roller listbox", form.includes('role="listbox" aria-label="Start time"'), true);
check("exact time button", form.includes(">Enter an exact time</button>"), true);
check("scroll hint", form.includes(">Scroll to choose</p>"), true);

const builder = fs.readFileSync(path.join(root, "quote-builder.js"), "utf8");
check("validation stays inline", builder.includes("reportValidity"), false);
check("listbox carries the time error", builder.includes('setAttribute("aria-invalid", "true")') && builder.includes('setAttribute("aria-describedby", "qb-time-error")'), true);
check("exact times are kept", builder.includes("keptStartTime(startInput.value, nearest)"), true);
check("fallback date input", /<input id="field-date" name="eventDate" type="date"/.test(form), true);
check("fallback time input", /<input id="startTime" name="startTime" type="time"/.test(form), true);
check("fallback hours range", /id="serviceHours"[^>]*type="range"/.test(form), true);
check("fallback guest number", /id="field-guests"[^>]*type="number"/.test(form), true);
check("css does not hide the hours slider", /\.wz-slider[^{]*\{[^}]*display:\s*none/.test(css), false);
check("css does not hide the date input", /#field-date[^{]*\{[^}]*display:\s*none/.test(css), false);
check("css does not hide the guest number", /#field-guests[^{]*\{[^}]*display:\s*none/.test(css), false);

const scriptUrls = [
  ...html.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/g),
  ...html.matchAll(/script\.src\s*=\s*"(https?:\/\/[^"]+)"/g),
].map((item) => item[1]);
check("remote scripts are tag manager or calendly", scriptUrls.every((url) => (
  url.includes("googletagmanager.com") || url.includes("assets.calendly.com")
)), true);
check("remote script count", scriptUrls.length, 2);

const thirdParty = fs.readFileSync(path.join(root, "THIRD-PARTY.md"), "utf8");
check("third-party note exists", thirdParty.length > 0, true);
check("no library is vendored", /no library is vendored/i.test(thirdParty), true);
check("third-party note names the bundler", thirdParty.includes("no front-end bundler"), true);
check("third-party note drops the build-step phrase", thirdParty.includes("no build step"), false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
