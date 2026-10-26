// Run from the repo root: node tests/designer-wizard.test.js
// Chip choices write the existing Designer fields, and drink chips stop at 400 characters.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const formStart = html.indexOf('id="cocktail-widget-form"');
const form = html.slice(formStart, html.indexOf("</form>", formStart));
const block = html.match(/\/\/ designer-wizard-fns\n([\s\S]*?)\n\/\/ end-designer-wizard-fns/);
check("wizard helpers are present", !!block, true);
const context = {};
vm.createContext(context);
vm.runInContext(block[1], context);

const themes = ["Wedding", "Bridal shower", "Bachelorette", "Birthday", "Anniversary", "Corporate event", "Holiday party", "Other"];
const colors = ["Blush & sage", "Navy & gold", "Black & white", "Tropical", "Jewel tones", "Earth tones", "Other"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const drinks = ["Not too sweet", "Fruity", "Citrus", "Spicy", "Smoky", "Tequila", "Whiskey", "Vodka", "Gin", "Rum", "Zero-proof", "No coconut"];

function values(target) {
  return [...form.matchAll(new RegExp('data-target="' + target + '" data-value="([^"]+)"', "g"))].map((item) => item[1].replace(/&amp;/g, "&"));
}
check("theme chips", values("theme"), themes);
check("color chips", values("colors"), colors);
check("month chips", values("month"), months);

check("other clears a theme chip", context.designerApplySingle("theme", "Other"), { value: "", reveal: true });
check("other clears a color chip", context.designerApplySingle("colors", "Other"), { value: "", reveal: true });
check("a theme chip writes the label", context.designerApplySingle("theme", "Wedding"), { value: "Wedding", reveal: false });
check("a month chip writes the month", context.designerApplySingle("month", "July"), { value: "July", reveal: false });
check("a venue chip writes the venue", context.designerApplySingle("venue", "Beach"), { value: "Beach", reveal: false });

check("arrow right moves forward", context.designerRadioStep(0, 8, "ArrowRight"), 1);
check("arrow up moves back", context.designerRadioStep(3, 8, "ArrowUp"), 2);
check("arrow left wraps", context.designerRadioStep(0, 8, "ArrowLeft"), 7);
check("arrow down wraps", context.designerRadioStep(7, 8, "ArrowDown"), 0);
check("home moves to the first radio", context.designerRadioStep(5, 12, "Home"), 0);
check("end moves to the last radio", context.designerRadioStep(2, 12, "End"), 11);

const radios = [...form.matchAll(/<button\b[^>]*\brole="radio"[^>]*>/g)].map((item) => item[0]);
check("four single-select groups", (form.match(/role="radiogroup"/g) || []).length, 4);
check("radios use aria-checked", radios.length > 0 && radios.every((tag) => tag.includes('aria-checked="false"')), true);
check("radios are not pressed toggles", radios.every((tag) => !tag.includes("aria-pressed")), true);
check("radios have no field name", radios.every((tag) => !/\sname=/.test(tag)), true);

const drinksMarkup = form.slice(form.indexOf('class="wz-chips qb-compact cw-drinks"'), form.indexOf('id="cw-preferences"'));
check("drink chips", [...drinksMarkup.matchAll(/data-pref="([^"]+)"/g)].map((item) => item[1]), drinks);
check("drink chips use aria-pressed", (drinksMarkup.match(/aria-pressed="false"/g) || []).length, drinks.length);
check("drink chips are not radios", drinksMarkup.includes('role="radio"'), false);
check("preferences cap matches the server", form.includes('id="cw-preferences" name="preferences" rows="3" maxlength="400"'), true);

check("append joins a new drink", context.designerAppendPreference("love citrus", "Citrus", 400), { value: "love citrus, Citrus", accepted: true });
check("append leaves an existing phrase", context.designerAppendPreference("Citrus, extra", "Citrus", 400), { value: "Citrus, extra", accepted: true });
check("remove keeps typed text", context.designerRemovePreference("love citrus, Citrus, extra", "Citrus"), "love citrus, extra");
check("chip accepts exactly 400 characters", context.designerAppendPreference("y".repeat(395), "Gin", 400), { value: "y".repeat(395) + ", Gin", accepted: true });
check("chip stops at 400 characters", context.designerAppendPreference("x".repeat(397), "Gin", 400).accepted, false);
check("a rejected chip leaves the typed text", context.designerAppendPreference("x".repeat(397), "Gin", 400).value, "x".repeat(397));

const designer = html.slice(html.indexOf("function renderCocktail"));
check("designer result event", designer.includes("new CustomEvent('designer:result'"), true);
check("designer result sends the name", designer.includes("name: c.name || ''"), true);
check("designer result sends the tagline", designer.includes("tagline: c.tagline || ''"), true);
check("designer result sends the venue", designer.includes("venue: (document.getElementById('cw-venue') || {}).value || ''"), true);
check("mixing status", html.includes("Mixing your cocktail..."), true);
check("design button label", designer.includes("Design my cocktail"), true);
check("step alert sentence", form.includes(">Please complete this step to continue.</p>"), true);
check("steps 2 through 5 start hidden", [2, 3, 4, 5].every((step) => new RegExp('class="wz-step cw-step" data-step="' + step + '" hidden').test(form)), true);
check("back stays a button", form.includes('<button class="btn-ghost cw-back" id="cw-back" type="button">Back</button>'), true);
check("next stays a button", form.includes('<button class="btn-primary cw-next" id="cocktail-widget-submit" type="button">Next</button>'), true);

const radioScript = html.slice(html.indexOf("function selectRadio"), html.indexOf("function syncPreferences"));
const radioStart = html.indexOf('form.querySelectorAll(\'[role="radiogroup"]\')');
const radioKeys = html.slice(radioStart, html.indexOf('form.querySelectorAll(\'[data-pref]\')', radioStart));
check("other field focuses only when asked", radioScript.includes("function selectRadio(btn, opts)") && radioScript.includes("if (applied.reveal && input && opts && opts.focusField) input.focus();"), true);
check("click enter and space focus the other field", radioKeys.includes("selectRadio(btn, { focusField: true })") && radioKeys.includes("event.key === 'Enter' || event.key === ' '"), true);
check("arrow keys leave focus on the chip", /selectRadio\(next\);\r?\n\s*next\.focus\(\);/.test(radioKeys), true);
check("arrow keys do not ask to focus the other field", radioKeys.includes("selectRadio(next, { focusField"), false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
