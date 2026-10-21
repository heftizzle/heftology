// Run from the repo root: node tests/bot-friction.test.js
// A filled honeypot or a too-fast elapsedMs returns a normal cocktail without the model.
const fs = require("fs");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let createCalls = 0;
const sdkPath = require.resolve("@anthropic-ai/sdk");
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: class {
    constructor() {
      this.messages = {
        create: async () => {
          createCalls += 1;
          return { content: [{ type: "text", text: '{"name":"Real Pour"}' }] };
        },
      };
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
      };
    },
  },
};

const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));
const valid = { theme: "t", colors: "c", preferences: "p", month: "July", venue: "beach" };

function post(body) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "203.0.113.20" },
    body: JSON.stringify(body),
  };
}

(async () => {
  const honeypot = await cocktail.handler(post({ ...valid, hp_field: "bot" }));
  check("honeypot status", honeypot.statusCode, 200);
  check("honeypot looks like a cocktail", Boolean(JSON.parse(honeypot.body).cocktail.name), true);
  check("honeypot did not call the model", createCalls, 0);
  check("honeypot stored nothing", records.size, 0);

  const fast = await cocktail.handler(post({ ...valid, elapsedMs: 100 }));
  check("fast elapsed status", fast.statusCode, 200);
  check("fast elapsed did not call the model", createCalls, 0);
  check("fast elapsed stored nothing", records.size, 0);

  const missing = await cocktail.handler(post(valid));
  check("missing elapsed still designs", missing.statusCode, 200);
  check("missing elapsed called the model", createCalls, 1);

  const notNumeric = await cocktail.handler(post({ ...valid, elapsedMs: "soon" }));
  check("non-numeric elapsed still designs", notNumeric.statusCode, 200);
  check("non-numeric elapsed called the model", createCalls, 2);

  const slow = await cocktail.handler(post({ ...valid, elapsedMs: 4000, hp_field: "" }));
  check("slow empty honeypot still designs", slow.statusCode, 200);
  check("slow empty honeypot called the model", createCalls, 3);

  const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("page has no netlify honeypot drop", page.includes("netlify-honeypot"), false);
  check("booking subject can be marked", page.includes("[possible bot]"), true);
  check("page sends elapsedMs from loadedAt", page.includes("Date.now() - loadedAt"), true);
  const bookingListener = page.slice(page.indexOf("bookingForm.addEventListener"), page.indexOf("const welcome"));
  check("booking listener does not skip the post", bookingListener.includes("preventDefault"), false);

  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
