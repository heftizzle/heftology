// Run from the repo root: node tests/designer-photo.test.js
// Empty gallery pool adds no figure. A failed image removes the figure without throwing.
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
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const flaggedAlts = {
  "images/gallery/gallery-02.jpg": "A Heftology bartender pours a cocktail from a shaker over a row of rocks glasses at a colorful bar.",
  "images/gallery/gallery-04.jpg": "Two Heftology bartenders in sunglasses pour shaken cocktails into a coupe at the bar.",
  "images/gallery/gallery-06.jpg": "Two Heftology bartenders shake and pour drinks side by side at the bar.",
  "images/gallery/gallery-08.jpg": "A Heftology bartender shakes a cocktail with a martini glass and lime waiting on the bar.",
  "images/gallery/gallery-16.jpg": "A Heftology bartender pours a spirit into a shaker beside three shot glasses.",
  "images/gallery/gallery-18.jpg": "A Heftology bartender stirs a cocktail in a rocks glass with a lime garnish.",
  "images/gallery/gallery-21.jpg": "Two Heftology bartenders at the bar holding finished cocktails, one red and one yellow.",
  "images/gallery/gallery-26.jpg": "A Heftology bartender shakes a cocktail with three red drinks lined up on the bar.",
};
const plainNumbers = [1, 3, 5, 7, 9, 10, 11, 12, 13, 14, 15, 17, 19, 20, 22, 23, 24, 25];

const imgs = [];
for (const tag of html.match(/<img class="gallery-item"[^>]*>/g) || []) {
  imgs.push({
    src: (tag.match(/\ssrc="([^"]+)"/) || [])[1],
    alt: (tag.match(/\salt="([^"]*)"/) || [])[1],
    flagged: /\sdata-designer-photo(?:\s|=|>)/.test(tag),
  });
}

check("gallery image count", imgs.length, 28);
check("flagged count", imgs.filter((img) => img.flagged).length, 8);
for (const [src, alt] of Object.entries(flaggedAlts)) {
  const img = imgs.find((item) => item.src === src);
  check("flagged " + src, img && img.flagged && img.alt, alt);
}
for (const n of plainNumbers) {
  const src = "images/gallery/gallery-" + String(n).padStart(2, "0") + ".jpg";
  const img = imgs.find((item) => item.src === src);
  check(
    "plain " + n,
    img && !img.flagged && img.alt,
    "Heftology behind the scenes — photo " + n
  );
}
for (const src of ["images/team-cheers.jpg", "images/team-craft.jpg"]) {
  const img = imgs.find((item) => item.src === src);
  check("lead stays out " + src, !!(img && !img.flagged && img.alt && !/photo \d+$/.test(img.alt)), true);
}

const photoRule = css.slice(css.indexOf(".cw-result-photo img {"), css.indexOf(".cw-result-photo figcaption"));
check("aspect ratio", photoRule.includes("aspect-ratio: 3 / 2"), true);
check("cover crop", photoRule.includes("object-fit: cover"), true);
check("crop position", photoRule.includes("object-position: center 30%"), true);
check("photo radius", photoRule.includes("border-radius: 8px"), true);
check("photo background", photoRule.includes("background: var(--black)"), true);
const captionRule = css.slice(css.indexOf(".cw-result-photo figcaption {"), css.indexOf(".cw-result-actions {"));
check("caption is pink", captionRule.includes("color: var(--pink)"), true);
check("gallery fit unchanged", /\.gallery-item\s*\{[^}]*object-fit:\s*contain/.test(css), true);
check("caption text is in the page", html.includes("Crafted by the Heftology bartenders"), true);

const block = html.match(/\/\/ designer-photo-fns\n([\s\S]*?)\n\/\/ end-designer-photo-fns/);
check("photo functions are present", !!block, true);
const context = { Math, String, Array };
vm.createContext(context);
vm.runInContext(block[1], context);

function node(tag) {
  const el = {
    tag,
    attrs: {},
    children: [],
    parentNode: null,
    className: "",
    alt: "",
    textContent: "",
    loading: "",
    decoding: "",
    listeners: {},
    fail: false,
    getAttribute(name) {
      if (name === "alt") return this.alt;
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (matches(child, sel)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    append(...kids) {
      for (const kid of kids) {
        kid.parentNode = this;
        this.children.push(kid);
      }
    },
    insertBefore(kid, before) {
      kid.parentNode = this;
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(kid);
      else this.children.splice(index, 0, kid);
    },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
  };
  Object.defineProperty(el, "src", {
    get() { return this.attrs.src || ""; },
    set(value) {
      this.attrs.src = value;
      if (this.fail && this.listeners.error) this.listeners.error();
    },
  });
  return el;
}

function matches(el, sel) {
  if (sel === "#gallery-track") return el.attrs.id === "gallery-track";
  if (sel === "img[data-designer-photo]") {
    return el.tag === "img" && Object.prototype.hasOwnProperty.call(el.attrs, "data-designer-photo");
  }
  if (sel === ".cw-result-actions") return el.className.split(/\s+/).includes("cw-result-actions");
  if (sel === ".cw-result-photo") return String(el.className).split(/\s+/).includes("cw-result-photo");
  if (sel === "img" || sel === "figcaption") return el.tag === sel;
  return false;
}

function makeDoc(images, options = {}) {
  const doc = node("document");
  doc.createElement = (tag) => {
    const el = node(tag);
    if (tag === "img" && options.failImages) el.fail = true;
    return el;
  };
  const track = node("div");
  track.attrs.id = "gallery-track";
  for (const image of images) {
    const picture = node("picture");
    const img = node("img");
    img.attrs.src = image.src;
    img.alt = image.alt;
    if (image.flagged) img.attrs["data-designer-photo"] = "";
    picture.append(img);
    track.append(picture);
  }
  doc.append(track);
  return doc;
}

function makeResult() {
  const result = node("div");
  const grid = node("div");
  grid.className = "cw-result-grid";
  const actions = node("div");
  actions.className = "cw-result-actions";
  result.append(grid, actions);
  return result;
}

const generic = "Heftology behind the scenes — photo 3";
check("generic alt is replaced", context.designerPhotoAlt(generic), "Heftology bartenders at work behind the bar.");
check("descriptive alt is copied", context.designerPhotoAlt(flaggedAlts["images/gallery/gallery-02.jpg"]), flaggedAlts["images/gallery/gallery-02.jpg"]);

const empty = makeResult();
let emptyThrew = false;
try {
  context.appendDesignerPhoto(empty, makeDoc([]), () => 0);
} catch (err) {
  emptyThrew = true;
}
check("empty pool adds nothing", empty.querySelector(".cw-result-photo"), null);
check("empty pool does not throw", emptyThrew, false);

const missing = makeResult();
context.appendDesignerPhoto(missing, node("document"), () => 0);
check("missing track adds nothing", missing.querySelector(".cw-result-photo"), null);

const flagged = Object.entries(flaggedAlts).map(([src, alt]) => ({ src, alt, flagged: true }));
const picked = makeResult();
context.appendDesignerPhoto(picked, makeDoc([{ src: "images/team-cheers.jpg", alt: "lead", flagged: false }].concat(flagged)), () => 0);
const photo = picked.querySelector(".cw-result-photo");
const photoImg = photo && photo.querySelector("img");
check("pick stays in the flagged pool", photoImg && photoImg.src, flagged[0].src);
check("pick copies the source alt", photoImg && photoImg.alt, flagged[0].alt);
check("pick is lazy", photoImg && photoImg.loading, "lazy");
check("pick decodes async", photoImg && photoImg.decoding, "async");
check("caption text", photo && photo.querySelector("figcaption") && photo.querySelector("figcaption").textContent, "Crafted by the Heftology bartenders");
check(
  "figure sits before the actions",
  picked.children.map((child) => child.className),
  ["cw-result-grid", "cw-result-photo", "cw-result-actions"]
);

const fallback = makeResult();
context.appendDesignerPhoto(fallback, makeDoc([{ src: "images/gallery/gallery-03.jpg", alt: generic, flagged: false }]), () => 0);
const fallbackImg = fallback.querySelector(".cw-result-photo").querySelector("img");
check("unflagged pool still renders", fallbackImg.src, "images/gallery/gallery-03.jpg");
check("unflagged generic alt is replaced", fallbackImg.alt, "Heftology bartenders at work behind the bar.");

const broken = makeResult();
let errorThrew = false;
try {
  context.appendDesignerPhoto(broken, makeDoc([{ src: "images/gallery/gallery-02.jpg", alt: flaggedAlts["images/gallery/gallery-02.jpg"], flagged: true }], { failImages: true }), () => 0);
} catch (err) {
  errorThrew = true;
}
check("image error removes the figure", broken.querySelector(".cw-result-photo"), null);
check("image error leaves the recipe", broken.children.map((child) => child.className), ["cw-result-grid", "cw-result-actions"]);
check("image error does not throw", errorThrew, false);

const failed = results.filter((line) => line.startsWith("FAIL"));
console.log(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
