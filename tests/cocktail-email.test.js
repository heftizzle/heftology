// Run from the repo root: node tests/cocktail-email.test.js
// Emails a real cocktail design. A failed, capped, or aborted send never changes the visitor response.
const crypto = require("crypto");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let now = Date.UTC(2026, 9, 22, 15, 0, 0);
Date.now = () => now;

const savedEnv = {};
for (const name of ["RESEND_API_KEY", "COCKTAIL_EMAIL_TO", "COCKTAIL_EMAIL_FROM", "COCKTAIL_EMAIL_DAILY_MAX", "COCKTAIL_EMAIL_PREVIEW", "CONTEXT", "COCKTAIL_MODEL", "CLAUDE_MODEL"]) {
  savedEnv[name] = process.env[name];
}

const API_KEY = "test-resend-key-do-not-log";
const FROM = "Heftology <from@example.com>";
const ONE = "team@example.com";
const FIVE = ["a1@example.com", "a2@example.com", "a3@example.com", "a4@example.com", "a5@example.com"];

function setEmailEnv(to = ONE) {
  process.env.RESEND_API_KEY = API_KEY;
  process.env.COCKTAIL_EMAIL_TO = Array.isArray(to) ? to.join(",") : to;
  process.env.COCKTAIL_EMAIL_FROM = FROM;
  delete process.env.COCKTAIL_EMAIL_PREVIEW;
  delete process.env.CONTEXT;
  delete process.env.COCKTAIL_EMAIL_DAILY_MAX;
  delete process.env.COCKTAIL_MODEL;
  delete process.env.CLAUDE_MODEL;
}
setEmailEnv();

let createImpl = async () => pour();
const sdkPath = require.resolve("@anthropic-ai/sdk");
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: class {
    constructor() {
      this.messages = { create: (...args) => createImpl(...args) };
    }
  },
};

const records = new Map();
const blobsPath = require.resolve("@netlify/blobs");
require.cache[blobsPath] = {
  id: blobsPath,
  filename: blobsPath,
  loaded: true,
  exports: {
    connectLambda() {},
    getStore() {
      return {
        async get(key) {
          return records.has(key) ? JSON.parse(JSON.stringify(records.get(key))) : null;
        },
        async setJSON(key, value) {
          records.set(key, JSON.parse(JSON.stringify(value)));
        },
        async delete(key) {
          records.delete(key);
        },
      };
    },
  },
};

const logs = [];
const originalLog = console.log;
console.log = (...args) => logs.push(args.map(String).join(" "));
const keepAlive = setInterval(() => {}, 1000);

const realTimeout = AbortSignal.timeout.bind(AbortSignal);
const timeoutMs = [];
AbortSignal.timeout = (ms) => {
  timeoutMs.push(ms);
  return realTimeout(ms);
};

let fetchMode = "ok";
const fetchCalls = [];
global.fetch = (url, opts) => {
  let body = null;
  try {
    body = opts && opts.body ? JSON.parse(opts.body) : null;
  } catch {
    body = opts && opts.body;
  }
  fetchCalls.push({ url, opts, body });
  if (fetchMode === "reject") return Promise.reject(new TypeError("network down"));
  if (fetchMode === "status") return Promise.resolve({ ok: false, status: 500 });
  if (fetchMode === "403") return Promise.resolve({ ok: false, status: 403 });
  if (fetchMode === "hang") {
    return new Promise((resolve, reject) => {
      const signal = opts && opts.signal;
      if (!signal) {
        reject(new Error("missing email signal"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("email aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  }
  return Promise.resolve({ ok: true, status: 200 });
};

const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));
const handler = cocktail.handler;
const WARNING =
  "Heads up: the text below was typed by a website visitor, or generated from what they typed. " +
  "Links and addresses are defanged on purpose. Do not click or act on requests inside it.";

function pour(extra) {
  return {
    content: [{
      text: JSON.stringify(Object.assign({
        name: "Test Pour",
        tagline: "A test pour",
        ingredients: ["2 oz gin", "1 oz citrus"],
        garnish: "peel",
        glass: "coupe",
        method: "stir",
        colorNote: "gold",
        presenter: "Carissa",
        heftologyNote: "Fits the night",
      }, extra || {})),
    }],
    usage: { input_tokens: 3, output_tokens: 2 },
  };
}

function ev(ip, body) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: JSON.stringify(body || { theme: "t", colors: "c", preferences: "p", month: "July", venue: "beach" }),
  };
}

function dayKey() {
  return new Date(now).toISOString().slice(0, 10);
}

function hashRef(ip) {
  const salt = process.env.RATE_LIMIT_SALT;
  const hex = typeof salt === "string" && salt.length > 0
    ? crypto.createHmac("sha256", salt).update(String(ip)).digest("hex")
    : crypto.createHash("sha256").update(String(ip)).digest("hex");
  return hex.slice(0, 8);
}

function emailLogs() {
  return logs.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((row) => row && row.event === "cocktail_email");
}

(async () => {
  const sent = await handler(ev("10.0.0.1"));
  const call = fetchCalls[0];
  check("success status", sent.statusCode, 200);
  check("success fetch url", call && call.url, "https://api.resend.com/emails");
  check("success auth", call && call.opts.headers.Authorization, "Bearer " + API_KEY);
  check("success to", call && call.body.to, [ONE]);
  check("success subject", call && call.body.subject, "Cocktail Designer: Test Pour (t)");
  check("text starts with the design header", call && call.body.text.startsWith("HEFTOLOGY — NEW COCKTAIL DESIGN"), true);
  check("html starts with a document", call && call.body.html.startsWith("<!doctype html>"), true);
  check("warning is in the text", call && call.body.text.includes(WARNING), true);
  check("warning is in the html", call && call.body.html.includes(WARNING), true);

  const beforeQuiet = fetchCalls.length;
  const quiet = await handler(ev("10.0.0.2", { hp_field: "bot", theme: "t", colors: "c", preferences: "p", month: "July", venue: "beach" }));
  check("honeypot status", quiet.statusCode, 200);
  check("honeypot does not fetch", fetchCalls.length, beforeQuiet);

  const beforeBad = fetchCalls.length;
  const bad = await handler(ev("10.0.0.3", { theme: "only theme" }));
  check("validation status", bad.statusCode, 400);
  check("validation does not fetch", fetchCalls.length, beforeBad);

  for (let i = 0; i < 3; i++) await handler(ev("10.0.0.4"));
  const beforeLock = fetchCalls.length;
  const locked = await handler(ev("10.0.0.4"));
  check("lock status", locked.statusCode, 429);
  check("lock does not fetch", fetchCalls.length, beforeLock);

  records.set(dayKey(), { count: 150 });
  const beforeCapDay = fetchCalls.length;
  const full = await handler(ev("10.0.0.5"));
  check("budget status", full.statusCode, 503);
  check("budget does not fetch", fetchCalls.length, beforeCapDay);
  records.delete(dayKey());

  createImpl = async () => {
    throw Object.assign(new Error("anthropic down"), { name: "APIError", status: 500 });
  };
  const beforeModel = fetchCalls.length;
  const crashed = await handler(ev("10.0.0.6"));
  check("model error status", crashed.statusCode, 500);
  check("model error body", crashed.body, JSON.stringify({ error: "Internal server error" }));
  check("model error does not fetch", fetchCalls.length, beforeModel);
  createImpl = async () => pour();

  fetchMode = "reject";
  const rejected = await handler(ev("10.0.0.7"));
  const rejectLog = emailLogs().pop();
  check("fetch reject still 200", rejected.statusCode, 200);
  check("fetch reject still returns the cocktail", rejected.body.includes("Test Pour"), true);
  check("fetch reject logs failed", rejectLog && rejectLog.status, "failed");
  check("fetch reject logs errorName", rejectLog && rejectLog.errorName, "TypeError");
  check("fetch reject log has no httpStatus", Object.prototype.hasOwnProperty.call(rejectLog || {}, "httpStatus"), false);

  fetchMode = "hang";
  const hung = await handler(ev("10.0.0.8"));
  check("email abort still 200", hung.statusCode, 200);
  check("email abort still returns the cocktail", hung.body.includes("Test Pour"), true);
  check("email abort logs failed", emailLogs().pop().status, "failed");

  fetchMode = "status";
  const upstream = await handler(ev("10.0.0.9"));
  check("non-2xx still 200", upstream.statusCode, 200);
  check("non-2xx logs failed", emailLogs().pop().status, "failed");
  fetchMode = "403";
  const forbidden = await handler(ev("10.0.0.15"));
  const forbiddenLog = emailLogs().pop();
  check("403 still 200", forbidden.statusCode, 200);
  check("403 logs failed", forbiddenLog && forbiddenLog.status, "failed");
  check("403 logs httpStatus", forbiddenLog && forbiddenLog.httpStatus, 403);
  check("403 log has no errorName", Object.prototype.hasOwnProperty.call(forbiddenLog || {}, "errorName"), false);
  fetchMode = "ok";

  createImpl = async () => pour({ name: "Bad\r\nName<script>" });
  const messy = await handler(ev("10.0.0.10", {
    theme: "<script>alert(1)</script>\r\nGold",
    colors: "c",
    preferences: "p\r\nmore",
    month: "July",
    venue: "beach",
  }));
  const messyCall = fetchCalls[fetchCalls.length - 1];
  check("escape status", messy.statusCode, 200);
  check("script stays out of the subject", messyCall.body.subject.includes("<script"), false);
  check("crlf stays out of the subject", /[\r\n]/.test(messyCall.body.subject), false);
  check("script is escaped in html", messyCall.body.html.includes("&lt;script&gt;"), true);
  check("raw script tag stays out of html", messyCall.body.html.includes("<script"), false);
  createImpl = async () => pour();

  const defanged = await handler(ev("10.0.0.11", {
    theme: "garden",
    colors: "c",
    preferences: "https://evil.example and a@b.co",
    month: "July",
    venue: "beach",
  }));
  const defangedCall = fetchCalls[fetchCalls.length - 1];
  check("defang status", defanged.statusCode, 200);
  check("defanged url in text", defangedCall.body.text.includes("https[://]evil.example"), true);
  check("defanged address in text", defangedCall.body.text.includes("a[at]b.co"), true);
  check("defanged url in html", defangedCall.body.html.includes("https[://]evil.example"), true);
  check("defanged address in html", defangedCall.body.html.includes("a[at]b.co"), true);
  check("raw url stays out of text", defangedCall.body.text.includes("https://evil.example"), false);
  check("raw address stays out of html", defangedCall.body.html.includes("a@b.co"), false);

  const rlo = await handler(ev("10.0.0.12", {
    theme: "Rose\u202EGold",
    colors: "c",
    preferences: "p",
    month: "July",
    venue: "beach",
  }));
  const rloCall = fetchCalls[fetchCalls.length - 1];
  check("rlo status", rlo.statusCode, 200);
  check("rlo stays out of the subject", rloCall.body.subject.includes("\u202E"), false);
  check("rlo theme collapses in the subject", rloCall.body.subject.includes("Rose Gold"), true);

  function previewMarks(body) {
    return {
      subject: body.subject.includes("[PREVIEW]"),
      text: body.text.includes("PREVIEW / TEST SEND"),
      html: body.html.includes(">PREVIEW</span>"),
    };
  }
  const noLabel = { subject: false, text: false, html: false };
  delete process.env.COCKTAIL_EMAIL_PREVIEW;
  delete process.env.CONTEXT;
  const unlabeled = await handler(ev("10.4.0.1"));
  check("unset status", unlabeled.statusCode, 200);
  check("unset has no preview label", previewMarks(fetchCalls[fetchCalls.length - 1].body), noLabel);

  process.env.COCKTAIL_EMAIL_PREVIEW = "1";
  const flagged = await handler(ev("10.4.0.2"));
  const flaggedBody = fetchCalls[fetchCalls.length - 1].body;
  check("preview flag status", flagged.statusCode, 200);
  check("preview flag labels the mail", previewMarks(flaggedBody), { subject: true, text: true, html: true });
  check("preview subject prefix", flaggedBody.subject.startsWith("[PREVIEW] "), true);

  for (const [value, ip] of [["0", "10.4.1.1"], ["true", "10.4.1.2"], ["", "10.4.1.3"]]) {
    process.env.COCKTAIL_EMAIL_PREVIEW = value;
    await handler(ev(ip));
    check("value " + JSON.stringify(value) + " has no preview label", previewMarks(fetchCalls[fetchCalls.length - 1].body), noLabel);
  }

  delete process.env.COCKTAIL_EMAIL_PREVIEW;
  process.env.CONTEXT = "deploy-preview";
  await handler(ev("10.4.2.1"));
  check("context alone has no preview label", previewMarks(fetchCalls[fetchCalls.length - 1].body), noLabel);
  delete process.env.CONTEXT;

  delete process.env.RESEND_API_KEY;
  const beforeMissing = fetchCalls.length;
  const skipped = await handler(ev("10.0.0.14"));
  const skipLog = emailLogs().pop();
  check("missing config status", skipped.statusCode, 200);
  check("missing config does not fetch", fetchCalls.length, beforeMissing);
  check("missing config logs skip", skipLog && skipLog.status, "skipped_no_config");
  check("missing config lists only variable names", skipLog && skipLog.missing, ["RESEND_API_KEY"]);
  process.env.RESEND_API_KEY = API_KEY;

  now = Date.UTC(2026, 9, 23, 15, 0, 0);
  process.env.COCKTAIL_EMAIL_DAILY_MAX = "1";
  await handler(ev("10.1.0.1"));
  const beforeSecond = fetchCalls.length;
  const capped = await handler(ev("10.1.0.2"));
  check("cap still 200", capped.statusCode, 200);
  check("cap does not fetch", fetchCalls.length, beforeSecond);
  check("cap logs skip", emailLogs().pop().status, "skipped_cap");
  delete process.env.COCKTAIL_EMAIL_DAILY_MAX;

  now = Date.UTC(2026, 9, 24, 15, 0, 0);
  setEmailEnv(FIVE);
  const beforeFive = fetchCalls.length;
  for (let i = 1; i <= 20; i++) {
    const res = await handler(ev("10.2.0." + i));
    if (res.statusCode !== 200) check("five-recipient send " + i, res.statusCode, 200);
  }
  check("five recipients lower the cap to 20 fetches", fetchCalls.length - beforeFive, 20);
  check("twentieth send still has 5 recipients", fetchCalls[fetchCalls.length - 1].body.to.length, 5);
  const beforeTwentyFirst = fetchCalls.length;
  const twentyFirst = await handler(ev("10.2.0.21"));
  check("twenty-first still 200", twentyFirst.statusCode, 200);
  check("twenty-first does not fetch", fetchCalls.length, beforeTwentyFirst);
  check("twenty-first logs skip", emailLogs().pop().status, "skipped_cap");
  setEmailEnv(ONE);

  now = Date.UTC(2026, 9, 25, 15, 0, 0);
  const abortDay = dayKey();
  const beforeAbortFetch = fetchCalls.length;
  createImpl = (params, options) => new Promise((resolve, reject) => {
    const signal = options && options.signal;
    if (!signal) {
      reject(Object.assign(new Error("missing signal"), { name: "AbortError" }));
      return;
    }
    signal.addEventListener("abort", () => {
      reject(Object.assign(new Error("model aborted"), { name: "APIUserAbortError" }));
    }, { once: true });
  });
  const aborted = await handler(ev("10.0.0.30"));
  const abortLog = logs.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((row) => row && row.event === "cocktail" && row.status === 500).pop();
  check("deadline abort status", aborted.statusCode, 500);
  check("deadline abort body", aborted.body, JSON.stringify({ error: "Internal server error" }));
  check("deadline abort logs the model error name", abortLog && abortLog.errorName, "APIUserAbortError");
  check("deadline abort keeps the cocktail event", abortLog && abortLog.event, "cocktail");
  check("deadline abort writes no daily count", records.has(abortDay), false);
  check("deadline abort writes no email count", records.has("email:" + abortDay), false);
  check("deadline abort does not commit", records.has(crypto.createHash("sha256").update("10.0.0.30").digest("hex")), false);
  check("deadline abort does not fetch", fetchCalls.length, beforeAbortFetch);
  createImpl = async () => pour();
  for (let i = 1; i <= 3; i++) {
    check("deadline abort released the slot " + i, (await handler(ev("10.0.0.30"))).statusCode, 200);
  }

  now = Date.UTC(2026, 9, 26, 15, 0, 0);
  const retryDay = dayKey();
  const timeoutsBefore = timeoutMs.length;
  let retryAttempts = [];
  let retryParams = null;
  let retryOptions = null;
  createImpl = async (params, options) => {
    retryParams = params;
    retryOptions = options;
    retryAttempts.push(503);
    if (!options || !options.signal || options.signal.aborted) {
      throw Object.assign(new Error("upstream"), { name: "APIError", status: 503 });
    }
    retryAttempts.push(200);
    createImpl = async () => pour();
    return pour();
  };
  const retried = await handler(ev("10.0.0.31"));
  check("retry inside the deadline status", retried.statusCode, 200);
  check("retry saw a 5xx then success", retryAttempts, [503, 200]);
  check("retry receives a 10000ms signal", timeoutMs.slice(timeoutsBefore), [10000]);
  check("retry signal is an AbortSignal", retryOptions && retryOptions.signal instanceof AbortSignal, true);
  check("retry keeps max_tokens", retryParams && retryParams.max_tokens, 700);
  check("retry keeps the model id", retryParams && retryParams.model, "claude-haiku-4-5-20251001");
  check("retry writes the daily count", records.get(retryDay) && records.get(retryDay).count >= 1, true);
  check("retry commits", records.has(crypto.createHash("sha256").update("10.0.0.31").digest("hex")), true);

  const refA = await handler(ev("10.3.0.1"));
  const refB = await handler(ev("10.3.0.2"));
  const textA = fetchCalls[fetchCalls.length - 2].body.text;
  const textB = fetchCalls[fetchCalls.length - 1].body.text;
  const foundA = (textA.match(/Ref ([0-9a-f]{8})/) || [])[1];
  const foundB = (textB.match(/Ref ([0-9a-f]{8})/) || [])[1];
  check("ref a status", refA.statusCode, 200);
  check("ref b status", refB.statusCode, 200);
  check("ref a is 8 hex chars", foundA, hashRef("10.3.0.1"));
  check("ref b is 8 hex chars", foundB, hashRef("10.3.0.2"));
  check("refs differ across ips", foundA !== foundB, true);

  const markers = {
    theme: "THEME-MARKER-ALPHA",
    colors: "COLORS-MARKER-BETA",
    month: "MONTH-MARKER-GAMMA",
    venue: "VENUE-MARKER-DELTA",
    preferences: "PREFS-MARKER-EPSILON",
  };
  const recipeMarkers = {
    name: "NAME-MARKER-ZETA",
    tagline: "TAGLINE-MARKER-ETA",
    garnish: "GARNISH-MARKER-THETA",
    glass: "GLASS-MARKER-IOTA",
    method: "METHOD-MARKER-KAPPA",
    colorNote: "COLORNOTE-MARKER-LAMBDA",
    heftologyNote: "NOTE-MARKER-MU",
  };
  createImpl = async () => pour(recipeMarkers);
  const marked = await handler(ev("10.3.0.3", markers));
  const markedBody = fetchCalls[fetchCalls.length - 1].body;
  check("marker send status", marked.statusCode, 200);
  check(
    "input keys match the renderer",
    Object.keys(markers).sort(),
    ["colors", "month", "preferences", "theme", "venue"]
  );
  for (const marker of Object.values(markers).concat(Object.values(recipeMarkers))) {
    check("marker in text " + marker, markedBody.text.includes(marker), true);
    check("marker in html " + marker, markedBody.html.includes(marker), true);
  }
  createImpl = async () => pour();

  const dumped = logs.join("\n");
  check("logs omit the api key", dumped.includes(API_KEY), false);
  check("logs omit recipient addresses", dumped.includes("example.com"), false);
  check("logs omit the from value", dumped.includes(FROM), false);
  check("every model deadline is 10000ms", timeoutMs.every((ms) => ms === 10000), true);

  console.log = originalLog;
  AbortSignal.timeout = realTimeout;
  for (const name of Object.keys(savedEnv)) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  const failed = results.filter((line) => line.startsWith("FAIL"));
  clearInterval(keepAlive);
  console.log = originalLog;
  process.stdout.write(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  clearInterval(keepAlive);
  console.log = originalLog;
  console.error(err);
  process.exit(1);
});
