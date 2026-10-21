// Run from the repo root: node tests/cocktail.rate-limit.test.js
// Covers the 72-hour lock: 1st/2nd/3rd allowed, 4th blocked, day 2 blocked,
// day 3 allowed, a failed API call not counting, and a different IP unaffected.
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let now = Date.UTC(2026, 9, 21, 16, 0, 0);
Date.now = () => now;
const DAY = 24 * 60 * 60 * 1000;

let createImpl = async () => ({ content: [{ text: '{"name":"Test Pour"}' }] });
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
let blobsEnabled = true;
const blobsPath = require.resolve("@netlify/blobs");
require.cache[blobsPath] = {
  id: blobsPath,
  filename: blobsPath,
  loaded: true,
  exports: {
    connectLambda() {
      if (!blobsEnabled) throw new Error("no blobs");
    },
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

const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));
const handler = cocktail.handler;
const LOCK_MS = cocktail.LOCK_HOURS * 60 * 60 * 1000;
const valid = { theme: "t", colors: "c", preferences: "p", month: "July", venue: "beach" };

function ev(ip, body = valid) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: JSON.stringify(body),
  };
}

(async () => {
  check("blank form does not count", (await handler(ev("1.1.1.1", {}))).statusCode, 400);
  check("blank form stored nothing", records.size, 0);

  const start = now;
  for (let i = 1; i <= 3; i++) check(`submission ${i} allowed`, (await handler(ev("1.1.1.1"))).statusCode, 200);
  const fourth = await handler(ev("1.1.1.1"));
  check("4th blocked", fourth.statusCode, 429);
  check("4th says about 3 days", fourth.body.includes("about 3 days"), true);
  check("4th points to booking", fourth.body.includes("heftology.com/#booking"), true);

  check("different IP allowed", (await handler(ev("2.2.2.2"))).statusCode, 200);

  now = start + 2 * DAY;
  check("day 2 still blocked", (await handler(ev("1.1.1.1"))).statusCode, 429);

  now = start + LOCK_MS;
  check("day 3 allowed and count reset", (await handler(ev("1.1.1.1"))).statusCode, 200);

  now = start;
  createImpl = async () => {
    throw new Error("anthropic down");
  };
  check("failed API call", (await handler(ev("3.3.3.3"))).statusCode, 500);
  createImpl = async () => ({ content: [{ text: "not json" }] });
  check("unparseable reply", (await handler(ev("3.3.3.3"))).statusCode, 502);
  createImpl = async () => ({ content: [{ text: '{"name":"Test Pour"}' }] });
  for (let i = 1; i <= 3; i++) {
    check(`after failures submission ${i} allowed`, (await handler(ev("3.3.3.3"))).statusCode, 200);
  }
  check("after failures 4th blocked", (await handler(ev("3.3.3.3"))).statusCode, 429);

  blobsEnabled = false;
  for (let i = 1; i <= 3; i++) check(`memory fallback ${i} allowed`, (await handler(ev("5.5.5.5"))).statusCode, 200);
  check("memory fallback 4th blocked", (await handler(ev("5.5.5.5"))).statusCode, 429);
  blobsEnabled = true;

  now = start;
  check("casual first success", (await handler(ev("6.6.6.6"))).statusCode, 200);
  now = start + LOCK_MS;
  for (let i = 1; i <= 3; i++) check(`after casual expiry ${i} allowed`, (await handler(ev("6.6.6.6"))).statusCode, 200);
  check("after casual expiry 4th blocked", (await handler(ev("6.6.6.6"))).statusCode, 429);

  now = start + 4 * DAY;
  const pendingCreates = [];
  createImpl = () => new Promise((resolve) => pendingCreates.push(resolve));
  const inflight = [1, 2, 3, 4].map(() => handler(ev("7.7.7.7")));
  await new Promise((r) => setTimeout(r, 30));
  check("only 3 simultaneous API calls start", pendingCreates.length, 3);
  const codes = [];
  const tracked = inflight.map((p) => p.then((res) => codes.push(res.statusCode)));
  await new Promise((r) => setTimeout(r, 20));
  check("4th simultaneous call blocked while the others are in flight", codes.includes(429), true);
  for (const resolve of pendingCreates) resolve({ content: [{ text: '{"name":"Test Pour"}' }] });
  await Promise.all(tracked);
  codes.sort((a, b) => a - b);
  check("simultaneous results are three successes and one block", codes, [200, 200, 200, 429]);

  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
