// Run from the repo root: node tests/booking-form.test.js
// The booking form is static HTML. Netlify Forms only sees fields that are in the markup.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const builder = fs.readFileSync(path.join(root, "quote-builder.js"), "utf8");
const formStart = html.indexOf('<form id="booking-form"');
const formEnd = html.indexOf("</form>", formStart);
const form = html.slice(formStart, formEnd);
const script = html.slice(formEnd);

check("booking form is in the page", formStart > 0 && formEnd > formStart, true);
check("form posts to thank-you", form.startsWith('<form id="booking-form" name="booking" method="POST" netlify action="/thank-you.html">'), true);
check("form-name hidden", form.includes('<input type="hidden" name="form-name" value="booking">'), true);
check("honeypot unchanged", form.includes('<input class="hp-field" tabindex="-1" autocomplete="off" name="hp_field" aria-hidden="true">'), true);
check("subject hidden", form.includes('<input type="hidden" name="subject" id="booking-subject" value="New event inquiry">'), true);

function names(step) {
  const fieldset = form.match(new RegExp(`<fieldset class="wz-step" data-step="${step}"[\\s\\S]*?</fieldset>`));
  if (!fieldset) return [];
  return [...fieldset[0].matchAll(/\sname="([^"]+)"/g)].map((item) => item[1]).filter((name, index, list) => list.indexOf(name) === index);
}

check("step 1 controls", names(1), ["eventType", "eventDate", "location", "cityZip"]);
check("step 2 controls", names(2), ["startTime", "serviceHours", "serviceHoursUnsure", "guests"]);
check("step 3 controls", names(3), ["packageInterest", "headlineCocktail"]);
check("step 4 controls", names(4), ["name", "email", "phone", "contactPreference", "heardAbout", "notes"]);

const kept = ["name", "email", "phone", "eventType", "eventDate", "startTime", "serviceHours", "guests", "contactPreference", "location", "cityZip", "heardAbout", "notes"];
for (const name of kept) {
  check(name + " still exists", form.includes(`name="${name}"`), true);
}

function count(name) {
  return form.split(`name="${name}"`).length - 1;
}
check("packageInterest is one radio group", count("packageInterest"), 5);
check("headlineCocktail once", count("headlineCocktail"), 1);
check("serviceHoursUnsure once", count("serviceHoursUnsure"), 1);
check("serviceHours once", count("serviceHours"), 1);
check("eventType is one radio group", count("eventType"), 5);
check("location is one radio group", count("location"), 16);
check("contactPreference is one radio group", count("contactPreference"), 3);

check("start time input", /<input id="startTime" name="startTime" type="time" step="900" required\b/.test(form), true);
check("start time helper", form.includes('id="startTime-hint">When you\'d like the bar to open.</p>'), true);
check("service hours is a range", /<input id="serviceHours" name="serviceHours" class="wz-slider qb-hours-slider" type="range" min="3" max="12" step="1" value="4"/.test(form), true);
check("service hours helper", form.includes('id="serviceHours-hint">Approximate bar service time. We\'ll confirm it in your quote.</p>'), true);
check("service hours helper has no price", /price|\$/.test(form.slice(form.indexOf('id="serviceHours"'), form.indexOf('id="field-guests"'))), false);
check("guests number", /<input id="field-guests" name="guests" type="number" inputmode="numeric" min="1" max="500" required\b/.test(form), true);
check("guests start empty with a 50 placeholder", /id="field-guests"[^>]*placeholder="50"/.test(form) && !/id="field-guests"[^>]*\svalue=/.test(form), true);
check("city or zip required", /<input id="cityZip" name="cityZip" type="text" placeholder="e\.g\. Tampa or 33579" required\b/.test(form), true);

const heardAt = form.indexOf('<select id="heardAbout"');
const heard = form.slice(heardAt, form.indexOf("</select>", heardAt));
check("heard about optional", heard.startsWith('<select id="heardAbout" name="heardAbout">'), true);
check("heard about options", [...heard.matchAll(/<option\b[^>]*>([^<]*)<\/option>/g)].map((item) => item[1]), [
  "Select one…", "The Knot", "Instagram", "Google search", "Friend or family", "Other",
]);
check("notes placeholder", form.includes('placeholder="Best time to reach you, 1-2 custom cocktails?, zero-proof options, anything else we should know."'), true);
check("time chips have no name", [...form.matchAll(/<button\b[^>]*data-time="[^"]+"[^>]*>/g)].every((item) => !/\sname=/.test(item[0])), true);
check("guest chips have no name", [...form.matchAll(/<button\b[^>]*data-guests="[^"]+"[^>]*>/g)].every((item) => !/\sname=/.test(item[0])), true);

for (const name of ["theme", "colors", "extras"]) {
  check("booking form has no " + name, new RegExp(`\\sname="${name}"`).test(form), false);
}
check("fields are not created with createElement", /createElement\(\s*['"]input['"]/.test(script) || /createElement\(\s*['"]input['"]/.test(builder), false);
check("fields are not injected with innerHTML", /\.innerHTML\s*=/.test(builder), false);
check("book this vibe is only an anchor", html.includes('<a class="btn-primary cw-book" href="#booking">Book this vibe</a>'), true);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
