// Run from the repo root: node tests/invalid-json.test.js
// A syntactically broken POST body is 400 and does not touch the rate-limit store.
const path = require("path");

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

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

const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));
const chat = require(path.join(__dirname, "..", "netlify", "functions", "chat.js"));

function post(body) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "9.9.9.9" },
    body,
  };
}

(async () => {
  const cocktailBroken = await cocktail.handler(post("{"));
  check("cocktail broken JSON status", cocktailBroken.statusCode, 400);
  check("cocktail broken JSON error", JSON.parse(cocktailBroken.body).error, "invalid JSON");
  check("cocktail broken JSON stored nothing", records.size, 0);

  const cocktailEmpty = await cocktail.handler(post("{}"));
  check("cocktail empty object status", cocktailEmpty.statusCode, 400);
  check("cocktail empty object is not the invalid-JSON error", JSON.parse(cocktailEmpty.body).error.includes("required"), true);

  const chatBroken = await chat.handler(post("{"));
  check("chat broken JSON status", chatBroken.statusCode, 400);
  check("chat broken JSON error", JSON.parse(chatBroken.body).error, "invalid JSON");
  check("chat broken JSON stored nothing", records.size, 0);

  const chatEmpty = await chat.handler(post("{}"));
  check("chat empty object status", chatEmpty.statusCode, 400);
  check("chat empty object error", JSON.parse(chatEmpty.body).error, "messages array required");

  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
