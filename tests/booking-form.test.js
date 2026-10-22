// Run from the repo root: node tests/booking-form.test.js
// The booking form is static HTML. Netlify Forms only sees fields that are in the markup.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const formStart = html.indexOf('<form id="booking-form"');
const formEnd = html.indexOf("</form>", formStart);
const form = html.slice(formStart, formEnd);
const script = html.slice(formEnd);

check("booking form is in the page", formStart > 0 && formEnd > formStart, true);
check("form posts to thank-you", form.startsWith('<form id="booking-form" name="booking" method="POST" netlify action="/thank-you.html">'), true);
check("form-name hidden", form.includes('<input type="hidden" name="form-name" value="booking">'), true);
check("honeypot unchanged", form.includes('<input class="hp-field" tabindex="-1" autocomplete="off" name="hp_field" aria-hidden="true">'), true);
check("subject hidden", form.includes('<input type="hidden" name="subject" id="booking-subject" value="New event inquiry">'), true);

function control(id) {
  const labelRe = new RegExp(`<label for="${id}">([^<]*)</label>`);
  const label = form.match(labelRe);
  const after = label ? form.slice(form.indexOf(label[0]) + label[0].length) : "";
  const tag = after.match(/^\s*<(input|select|textarea)\b[^>]*>/);
  if (!label || !tag) return null;
  const open = tag[0].trim();
  const kind = tag[1];
  const attr = (name) => {
    const found = open.match(new RegExp(`\\s${name}="([^"]*)"`));
    return found ? found[1] : null;
  };
  let options = null;
  if (kind === "select") {
    const block = after.match(/<select\b[\s\S]*?<\/select>/);
    options = [...block[0].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((item) => ({
      value: (item[1].match(/\svalue="([^"]*)"/) || [])[1],
      text: item[2],
      disabled: /\sdisabled(?:\s|>|$)/.test(item[1]),
    }));
  }
  return {
    kind,
    name: attr("name"),
    type: kind === "input" ? attr("type") : kind,
    required: /\srequired(?:\s|>|$)/.test(open),
    placeholder: attr("placeholder"),
    step: attr("step"),
    label: label[1],
    options,
  };
}

const labels = [...form.matchAll(/<label for="([^"]+)">/g)].map((item) => item[1]);
const controls = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*\sid="([^"]+)"/g)].map((item) => item[1]);
const visible = controls.filter((id) => id !== "booking-subject");

check("visible controls", visible, [
  "field-name", "field-email", "field-phone", "field-type",
  "field-date", "startTime", "serviceHours",
  "field-guests", "contactPreference", "field-location", "cityZip",
  "heardAbout", "field-notes",
]);
check("labels match visible controls", labels, visible);

const date = control("field-date");
check("event date", date && { kind: date.kind, name: date.name, type: date.type, required: date.required, label: date.label }, {
  kind: "input", name: "eventDate", type: "date", required: true, label: "Event Date",
});

const start = control("startTime");
check("start time", start && { kind: start.kind, name: start.name, type: start.type, step: start.step, required: start.required, label: start.label }, {
  kind: "input", name: "startTime", type: "time", step: "900", required: true, label: "Start Time",
});
check("start time helper", form.includes('<label for="startTime">Start Time</label>\n            <input id="startTime" name="startTime" type="time" step="900" required aria-describedby="startTime-hint">\n            <p class="form-hint" id="startTime-hint">When you\'d like the bar to open.</p>'), true);

const hours = control("serviceHours");
const hourOptions = [{ value: "", text: "Select one…", disabled: true }];
for (let n = 3; n <= 12; n++) hourOptions.push({ value: String(n), text: n + " hours", disabled: false });
hourOptions.push({ value: "unsure", text: "Not sure yet", disabled: false });
check("service hours", hours && { kind: hours.kind, name: hours.name, required: hours.required, label: hours.label, options: hours.options }, {
  kind: "select", name: "serviceHours", required: true, label: "Approx. Service Hours", options: hourOptions,
});
check("service hours helper", form.includes('<select id="serviceHours" name="serviceHours" required aria-describedby="serviceHours-hint">') && form.includes('<p class="form-hint" id="serviceHours-hint">Approximate bar service time. We\'ll confirm it in your quote.</p>'), true);
check("service hours helper has no price", /price|\$/.test(form.slice(form.indexOf('id="serviceHours"'), form.indexOf('id="field-guests"'))), false);

const guests = control("field-guests");
check("guests", guests && { kind: guests.kind, name: guests.name, type: guests.type, required: guests.required, placeholder: guests.placeholder, label: guests.label }, {
  kind: "input", name: "guests", type: "text", required: true, placeholder: "e.g. 45", label: "Guest Count",
});

const contact = control("contactPreference");
check("contact preference", contact && { kind: contact.kind, name: contact.name, required: contact.required, label: contact.label, options: contact.options }, {
  kind: "select",
  name: "contactPreference",
  required: true,
  label: "Best Way to Reach You",
  options: [
    { value: "", text: "Select one…", disabled: true },
    { value: "Call", text: "Call", disabled: false },
    { value: "Text", text: "Text", disabled: false },
    { value: "Email", text: "Email", disabled: false },
  ],
});

const venue = control("field-location");
check("venue type", venue && { kind: venue.kind, name: venue.name, type: venue.type, required: venue.required, placeholder: venue.placeholder, label: venue.label }, {
  kind: "input", name: "location", type: "text", required: false, placeholder: "Backyard, ballroom, restaurant, etc.", label: "Venue Type",
});

const city = control("cityZip");
check("city or zip", city && { kind: city.kind, name: city.name, type: city.type, required: city.required, placeholder: city.placeholder, label: city.label }, {
  kind: "input", name: "cityZip", type: "text", required: true, placeholder: "e.g. Tampa or 33579", label: "City or ZIP",
});
check("coverage title is on city or zip", form.includes('id="cityZip" name="cityZip" type="text" placeholder="e.g. Tampa or 33579" required title="Greater Tampa Bay area; questions about coverage — carissa@heftology.com."'), true);
check("venue type has no title", /<input id="field-location"[^>]*\stitle=/.test(form), false);

const heard = control("heardAbout");
check("heard about", heard && { kind: heard.kind, name: heard.name, required: heard.required, label: heard.label, options: heard.options }, {
  kind: "select",
  name: "heardAbout",
  required: false,
  label: "How Did You Hear About Us?",
  options: [
    { value: "", text: "Select one…", disabled: false },
    { value: "The Knot", text: "The Knot", disabled: false },
    { value: "Instagram", text: "Instagram", disabled: false },
    { value: "Google search", text: "Google search", disabled: false },
    { value: "Friend or family", text: "Friend or family", disabled: false },
    { value: "Other", text: "Other", disabled: false },
  ],
});
check("heard about sits above notes", form.indexOf('id="heardAbout"') < form.indexOf('id="field-notes"'), true);

const notes = control("field-notes");
check("notes", notes && { kind: notes.kind, name: notes.name, required: notes.required, placeholder: notes.placeholder, label: notes.label }, {
  kind: "textarea",
  name: "notes",
  required: false,
  placeholder: "Best time to reach you, 1-2 custom cocktails?, zero-proof options, anything else we should know.",
  label: "Tell Us More",
});

for (const name of ["theme", "colors", "extras"]) {
  check("booking form has no " + name, new RegExp(`\\sname="${name}"`).test(form), false);
}

const added = ["startTime", "serviceHours", "cityZip", "contactPreference", "heardAbout"];
for (const name of added) {
  const inForm = form.split(`name="${name}"`).length - 1;
  const inScript = script.split(name).length - 1;
  check(name + " is static markup", inForm, 1);
  check(name + " is not built in script", inScript, 0);
}
check("book this vibe is only an anchor", html.includes('<a class="btn-primary cw-book" href="#booking">Book this vibe</a>'), true);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
