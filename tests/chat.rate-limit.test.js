// Run from the repo root: node tests/chat.rate-limit.test.js
// The chat assistant allows 20 messages per hashed IP per hour, then returns 429.
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let now = Date.UTC(2026, 9, 21, 16, 0, 0);
Date.now = () => now;

const sdkPath = require.resolve("@anthropic-ai/sdk");
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: class {
    constructor() {
      this.messages = { create: async () => ({ content: [{ type: "text", text: "ok" }] }) };
    }
  },
};

let blobsEnabled = true;
const records = new Map();
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
      };
    },
  },
};

const chat = require(path.join(__dirname, "..", "netlify", "functions", "chat.js"));

function ev(ip) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  };
}

(async () => {
  for (let i = 1; i <= 20; i++) check(`message ${i} allowed`, (await chat.handler(ev("1.1.1.1"))).statusCode, 200);
  const blocked = await chat.handler(ev("1.1.1.1"));
  check("21st blocked", blocked.statusCode, 429);
  check("21st points to email", blocked.body.includes("carissa@heftology.com"), true);
  check("different IP allowed", (await chat.handler(ev("2.2.2.2"))).statusCode, 200);

  blobsEnabled = false;
  for (let i = 1; i <= 20; i++) check(`memory message ${i} allowed`, (await chat.handler(ev("3.3.3.3"))).statusCode, 200);
  check("memory 21st blocked", (await chat.handler(ev("3.3.3.3"))).statusCode, 429);

  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
