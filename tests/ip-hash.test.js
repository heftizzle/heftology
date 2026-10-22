// Run from the repo root: node tests/ip-hash.test.js
// RATE_LIMIT_SALT turns the IP key into an HMAC. Without it, the old SHA-256 remains.
const crypto = require("crypto");
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const IP = "203.0.113.44";
const SALT = "super-secret-salt";
const chatPath = path.join(__dirname, "..", "netlify", "functions", "chat.js");
const cocktailPath = path.join(__dirname, "..", "netlify", "functions", "cocktail.js");

const sdkPath = require.resolve("@anthropic-ai/sdk");
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: class {
    constructor() {
      this.messages = { create: async () => ({ content: [{ type: "text", text: '{"name":"Test"}' }] }) };
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
const originalLog = console.log;
console.log = (...args) => {
  logs.push(args.map(String).join(" "));
};

function storedHash() {
  return [...records.keys()].find((key) => /^[a-f0-9]{64}$/.test(key)) || "";
}

function load(file) {
  delete require.cache[file];
  return require(file);
}

(async () => {
  delete process.env.RATE_LIMIT_SALT;
  const chat = load(chatPath);
  await chat.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  });
  const plain = crypto.createHash("sha256").update(IP).digest("hex");
  check("chat without salt matches SHA-256", storedHash(), plain);
  const unsalted = logs.filter((line) => line.includes("ip_hash_unsalted"));
  check("unsalted chat log once", unsalted.length, 1);
  check("unsalted log is only the event", unsalted[0], '{"event":"ip_hash_unsalted"}');
  await chat.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello again" }] }),
  });
  check("unsalted chat log stays once", logs.filter((line) => line.includes("ip_hash_unsalted")).length, 1);

  records.clear();
  process.env.RATE_LIMIT_SALT = SALT;
  const chatSalted = load(chatPath);
  await chatSalted.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
  });
  const hmac = crypto.createHmac("sha256", SALT).update(IP).digest("hex");
  check("chat with salt matches HMAC", storedHash(), hmac);
  check("chat with salt is not the plain hash", storedHash() === plain, false);
  check("salted chat does not log unsalted", logs.filter((line) => line.includes("ip_hash_unsalted")).length, 1);
  check("salt is not logged", logs.some((line) => line.includes(SALT)), false);

  records.clear();
  delete process.env.RATE_LIMIT_SALT;
  const cocktail = load(cocktailPath);
  await cocktail.handler({
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": IP },
    body: JSON.stringify({ theme: "t", colors: "c", preferences: "p", month: "July", venue: "beach" }),
  });
  check("design without salt matches SHA-256", storedHash(), plain);
  check("unsalted design log once", logs.filter((line) => line.includes("ip_hash_unsalted")).length, 2);

  console.log = originalLog;
  delete process.env.RATE_LIMIT_SALT;
  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
