// Run from the repo root: node tests/daily-budget.test.js
// A full UTC day stops both functions with 503 before the model or a per-IP slot.
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

let now = Date.UTC(2026, 9, 21, 16, 0, 0);
Date.now = () => now;

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
          return { content: [{ type: "text", text: '{"name":"Test Pour"}' }] };
        },
      };
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
      };
    },
  },
};

const chat = require(path.join(__dirname, "..", "netlify", "functions", "chat.js"));
const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));

const SECRET = "secret-phrase-do-not-log";
const RAW_IP = "203.0.113.50";
const logs = [];
const originalLog = console.log;
console.log = (...args) => {
  logs.push(args.map(String).join(" "));
};

function chatEvent(ip, text = "Hello") {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
  };
}

function designEvent(ip) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": ip },
    body: JSON.stringify({
      theme: "t",
      colors: "c",
      preferences: "p",
      month: "July",
      venue: "beach",
    }),
  };
}

(async () => {
  const day = "2026-10-21";
  records.set(day, { count: 400 });
  const blockedChat = await chat.handler(chatEvent(RAW_IP, SECRET));
  check("chat at ceiling status", blockedChat.statusCode, 503);
  check("chat at ceiling mentions booking", blockedChat.body.includes("heftology.com/#booking"), true);
  check("chat at ceiling says capacity", blockedChat.body.includes("at capacity today"), true);
  check("chat at ceiling did not call the model", createCalls, 0);
  check("chat at ceiling did not take an IP slot", records.has(require("crypto").createHash("sha256").update(RAW_IP).digest("hex")), false);
  const exhausted = logs.filter((line) => line.includes("daily_budget_exhausted"));
  check("chat ceiling logged once", exhausted.length, 1);
  const line = exhausted[0] || "";
  check("chat ceiling log has no message", line.includes(SECRET), false);
  check("chat ceiling log has no raw IP", line.includes(RAW_IP), false);

  records.set(day, { count: 150 });
  const beforeDesign = createCalls;
  const blockedDesign = await cocktail.handler(designEvent("198.51.100.8"));
  check("design at ceiling status", blockedDesign.statusCode, 503);
  check("design at ceiling mentions booking", blockedDesign.body.includes("heftology.com/#booking"), true);
  check("design at ceiling did not call the model", createCalls, beforeDesign);
  check("design ceiling logged once more", logs.filter((line) => line.includes("daily_budget_exhausted")).length, 2);

  records.delete(day);
  createCalls = 0;
  blobsEnabled = false;
  logs.length = 0;
  for (let i = 1; i <= 400; i++) {
    const res = await chat.handler(chatEvent("mem-chat-" + i));
    if (res.statusCode !== 200) {
      check("memory chat success before ceiling", res.statusCode, 200);
      break;
    }
  }
  const memoryBlocked = await chat.handler(chatEvent("mem-chat-over"));
  check("memory chat ceiling status", memoryBlocked.statusCode, 503);
  check("memory chat ceiling did not call past the limit", createCalls, 400);
  check("memory chat ceiling logged", logs.some((line) => line.includes("daily_budget_exhausted")), true);

  for (let i = 1; i <= 150; i++) {
    const res = await cocktail.handler(designEvent("mem-design-" + i));
    if (res.statusCode !== 200) {
      check("memory design success before ceiling", res.statusCode, 200);
      break;
    }
  }
  const memoryDesign = await cocktail.handler(designEvent("mem-design-over"));
  check("memory design ceiling status", memoryDesign.statusCode, 503);

  console.log = originalLog;
  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
