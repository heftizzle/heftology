// Run from the repo root: node tests/request-log.test.js
// Each request logs status, latency, token counts, and a hashed IP. Never the message.
const crypto = require("crypto");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const chatPath = path.join(__dirname, "..", "netlify", "functions", "chat.js");
const cocktailPath = path.join(__dirname, "..", "netlify", "functions", "cocktail.js");
const SECRET = "do-not-log-this-phrase";
const IP = "203.0.113.77";

let createCalls = 0;
let failNext = false;
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
          if (failNext) {
            failNext = false;
            throw new Error(`sdk blew up with ${SECRET}`);
          }
          return {
            content: [{ type: "text", text: '{"name":"Logged Pour"}' }],
            usage: { input_tokens: 11, output_tokens: 4 },
          };
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

const logs = [];
const errors = [];
console.log = (...args) => logs.push(args.map(String).join(" "));
console.error = (...args) => errors.push(args.map(String).join(" "));

function requestLogs() {
  return logs
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter((row) => row && (row.event === "chat" || row.event === "cocktail"));
}

delete process.env.RATE_LIMIT_SALT;
const chat = require(chatPath);
const cocktail = require(cocktailPath);

(async () => {
  const chatRes = await chat.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ messages: [{ role: "user", content: SECRET }] }),
  });
  const chatLog = requestLogs().find((row) => row.event === "chat" && row.status === 200);
  check("chat status", chatRes.statusCode, 200);
  check("chat log status", chatLog && chatLog.status, 200);
  check("chat input tokens", chatLog && chatLog.inputTokens, 11);
  check("chat output tokens", chatLog && chatLog.outputTokens, 4);
  check("chat latency is a number", typeof (chatLog && chatLog.latencyMs), "number");
  check("chat ip hash", chatLog && chatLog.ipHash, crypto.createHash("sha256").update(IP).digest("hex"));

  const bad = await chat.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: `{${SECRET}`,
  });
  const badLog = requestLogs().filter((row) => row.event === "chat").pop();
  check("invalid json status", bad.statusCode, 400);
  check("invalid json tokens are null", [badLog && badLog.inputTokens, badLog && badLog.outputTokens], [null, null]);

  failNext = true;
  const crashed = await chat.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "203.0.113.78" },
    body: JSON.stringify({ messages: [{ role: "user", content: SECRET }] }),
  });
  check("model failure status", crashed.statusCode, 500);
  check("model failure tokens are null", requestLogs().filter((row) => row.status === 500)[0].inputTokens, null);

  const quiet = await cocktail.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ hp_field: "bot", theme: SECRET }),
  });
  const quietLog = requestLogs().find((row) => row.event === "cocktail");
  check("honeypot status", quiet.statusCode, 200);
  check("honeypot tokens are null", [quietLog.inputTokens, quietLog.outputTokens], [null, null]);
  check("honeypot did not call the model", createCalls, 2);

  const design = await cocktail.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "198.51.100.8" },
    body: JSON.stringify({ theme: SECRET, colors: "gold", preferences: "citrus", month: "July", venue: "beach" }),
  });
  const designLog = requestLogs().filter((row) => row.event === "cocktail" && row.status === 200).pop();
  check("design status", design.statusCode, 200);
  check("design tokens", [designLog.inputTokens, designLog.outputTokens], [11, 4]);

  const dumped = logs.concat(errors).join("\n");
  check("log omits the message", dumped.includes(SECRET), false);
  check("log omits the raw IP", dumped.includes(IP), false);

  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log = console.error = () => {};
  process.stdout.write(`${results.join("\n")}\n\n${results.length - failed.length}/${results.length} passed\n`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
