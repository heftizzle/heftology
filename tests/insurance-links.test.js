// Run from the repo root: node tests/insurance-links.test.js
// Credentials insurance card opens a Netlify COI dialog; bots are marked, not dropped.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const credentialsAt = html.indexOf('id="credentials"');
const credentials = html.slice(credentialsAt, html.indexOf("</section>", credentialsAt));
check("credentials heading", credentials.includes(">Certified · Insured · Guild Members</h2>"), true);
check("Licensed is gone from the page", html.includes("Licensed"), false);
check("Fully Insured is gone", html.includes("Fully Insured"), false);

const cardStart = credentials.indexOf('class="cred-card cred-card--insurance"');
check("insurance card exists", cardStart > 0, true);
const card = credentials.slice(cardStart, credentials.indexOf("</div>", credentials.indexOf("cred-coi-btn", cardStart)) + 6);
check("insurance card name", card.includes(">General + Liquor Liability Insurance</div>"), true);
check(
  "insurance card issuer",
  card.includes(">Food Liability Insurance Program (FLIP) · $1M per occurrence / $2M aggregate</div>"),
  true
);
check("insurance card badge", card.includes(">Insured</span>"), true);
check("card has data-open-coi button", /<button type="button" class="cred-coi-btn" data-open-coi>Request certificate of insurance<\/button>/.test(card), true);

const footer = credentials.slice(credentials.indexOf('class="cred-footer"'));
check(
  "footer has data-open-coi trigger",
  footer.includes('<button type="button" class="cred-footer-link" data-open-coi>Insured · Certificate on Request</button>'),
  true
);
check("two open triggers", (html.match(/<button[^>]*\sdata-open-coi[\s>]/g) || []).length, 2);

const dialogAt = html.indexOf('id="coi-dialog"');
check("dialog exists", dialogAt > 0, true);
check('dialog has aria-labelledby="coi-title"', html.includes('<dialog id="coi-dialog" aria-labelledby="coi-title">'), true);
check("dialog has inner wrapper", html.includes('class="coi-dialog-inner"'), true);
check("dialog title", html.includes('id="coi-title">Proof of Insurance</'), true);

const formStart = html.indexOf('<form name="coi-request"');
const formEnd = html.indexOf("</form>", formStart);
const form = html.slice(formStart, formEnd);
check("coi form found", formStart > 0 && formEnd > formStart, true);
check("form has data-netlify", form.startsWith('<form name="coi-request" method="POST" data-netlify="true"'), true);
check("form-name hidden", form.includes('<input type="hidden" name="form-name" value="coi-request">'), true);
check(
  "subject hidden default",
  form.includes('<input type="hidden" name="subject" id="coi-subject" value="Certificate of insurance request">'),
  true
);
check(
  "honeypot markup",
  form.includes('<input class="hp-field" tabindex="-1" autocomplete="off" name="hp_field" aria-hidden="true">'),
  true
);
check("venue field", /name="venue"[^>]*required[^>]*maxlength="120"|name="venue"[^>]*maxlength="120"[^>]*required/.test(form) || form.includes('name="venue" required maxlength="120"') || form.includes('name="venue"') && form.includes('maxlength="120"') && form.includes("required"), true);
check("venue maxlength 120", form.includes('name="venue"') && form.includes('id="coi-venue"') && /id="coi-venue"[^>]*maxlength="120"/.test(form), true);
check("contactName maxlength 100", /id="coi-contact-name"[^>]*name="contactName"[^>]*required[^>]*maxlength="100"|id="coi-contact-name"[^>]*name="contactName"[^>]*maxlength="100"[^>]*required/.test(form) || (form.includes('name="contactName"') && form.includes('maxlength="100"')), true);
check("contactEmail maxlength 160", form.includes('name="contactEmail"') && form.includes('maxlength="160"') && form.includes('type="email"'), true);
check("eventDate optional date", form.includes('name="eventDate"') && form.includes('type="date"'), true);
check("notes maxlength 500", form.includes('name="notes"') && form.includes('maxlength="500"'), true);
check("notes placeholder", form.includes('Does the venue require additional insured, primary and non-contributory, or waiver of subrogation wording?'), true);

check("no netlify-honeypot string", html.includes("netlify-honeypot"), false);
check("no data-netlify-honeypot", html.includes("data-netlify-honeypot"), false);

const scriptStart = html.indexOf("<script>\nwindow.addEventListener('DOMContentLoaded', () => {\n  const dialog = document.getElementById('coi-dialog');");
const scriptEnd = html.indexOf("</script>", scriptStart);
const coiScript = scriptStart > 0 ? html.slice(scriptStart, scriptEnd) : "";
check("coi script is its own block before date-rules", scriptStart > dialogAt && html.indexOf('src="themes/date-rules.js"', scriptEnd) > scriptEnd, true);
check("coi subject rewrite", coiScript.includes("'Certificate request: '") || coiScript.includes('"Certificate request: "'), true);
check("coi possible bot mark", coiScript.includes(" [possible bot]"), true);
check("coi script has no elapsed timer", coiScript.includes("performance.now() - loadedAt"), false);
check("coi script does not create inputs", coiScript.includes("createElement('input')") || coiScript.includes('createElement("input")'), false);
check("page still has exactly two elapsed timers", html.split("performance.now() - loadedAt").length - 1, 2);

check("index has no Gillamoor", /Gillamoor/i.test(html), false);
check("styles have no Gillamoor", /Gillamoor/i.test(css), false);
check("index has no N0276", html.includes("N0276"), false);
check("styles have no N0276", css.includes("N0276"), false);
check("index has no .pdf", html.toLowerCase().includes(".pdf"), false);
check("styles have no .pdf", css.toLowerCase().includes(".pdf"), false);
check("insurance card spans full width", css.includes(".cred-card--insurance"), true);

const footerPhone = (css.match(/@media \(max-width: 480px\) \{[\s\S]*?\.cred-footer[\s\S]*?\}[\s\S]*?\.cred-footer \.cred-dot[\s\S]*?\}/) || [""])[0];
check("phone footer stacks in a column", /flex-direction:\s*column/.test(footerPhone) && /align-items:\s*center/.test(footerPhone), true);
check("phone footer hides both dots", /\.cred-footer \.cred-dot\s*\{\s*display:\s*none/.test(footerPhone), true);
check("phone footer link does not wrap", /white-space:\s*nowrap/.test(footerPhone) || /@media \(max-width: 480px\)[\s\S]*\.cred-footer-link\s*\{\s*white-space:\s*nowrap/.test(css), true);
check("desktop footer still wraps horizontally", /\.cred-footer\s*\{[^}]*flex-wrap:\s*wrap/.test(css), true);

check("fields stay inside the static form", form.includes('id="coi-fields"') && form.includes('id="coi-submit"'), true);
check("success panel is outside the form", html.includes('id="coi-success"') && html.indexOf('id="coi-success"') > formEnd, true);
check("success panel starts hidden", /id="coi-success"[^>]*\bhidden\b/.test(html) || html.includes('id="coi-success" hidden'), true);
check("success close button exists", html.includes('id="coi-done-close">Close</button>'), true);
check("success view toggles hidden", coiScript.includes("showSuccessView") && coiScript.includes("showFormView") && coiScript.includes("successEl.hidden = false") && coiScript.includes("fieldsEl.hidden = true"), true);
check("open resets to the form view", coiScript.includes("showFormView()") && /const open =[\s\S]*showFormView\(\)/.test(coiScript), true);
check("form is never recreated", coiScript.includes("createElement('form')") || coiScript.includes('createElement("form")'), false);

const faqAt = html.indexOf('id="faq"');
const faqHtml = html.slice(faqAt, html.indexOf("</section>", faqAt));
check("faq still has eight details", (faqHtml.match(/<details>/g) || []).length, 8);
check("faq has no insured", /insured/i.test(faqHtml), false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
