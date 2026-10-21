// Run from the repo root: node tests/input-limits.test.js
// Oversized, over-long, and wrong-role input is 400 before a rate-limit slot or the model.
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
          return { content: [{ type: "text", text: "ok" }] };
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

const chat = require(path.join(__dirname, "..", "netlify", "functions", "chat.js"));
const cocktail = require(path.join(__dirname, "..", "netlify", "functions", "cocktail.js"));

function post(body) {
  return {
    httpMethod: "POST",
    headers: { "x-nf-client-connection-ip": "203.0.113.9" },
    body,
  };
}

(async () => {
  const tooBig = "x".repeat(24001);
  const chatBig = await chat.handler(post(tooBig));
  check("chat oversized status", chatBig.statusCode, 400);
  check("chat oversized did not call the model", createCalls, 0);
  check("chat oversized stored nothing", records.size, 0);

  const many = Array.from({ length: 11 }, () => ({ role: "user", content: "Hi" }));
  const chatMany = await chat.handler(post(JSON.stringify({ messages: many })));
  check("chat too many messages status", chatMany.statusCode, 400);
  check("chat too many stored nothing", records.size, 0);

  const long = await chat.handler(post(JSON.stringify({
    messages: [{ role: "user", content: "a".repeat(2001) }],
  })));
  check("chat over-long status", long.statusCode, 400);
  check("chat over-long says too long", JSON.parse(long.body).error.includes("too long"), true);
  check("chat over-long stored nothing", records.size, 0);

  const role = await chat.handler(post(JSON.stringify({
    messages: [{ role: "system", content: "Hi" }],
  })));
  check("chat bad role status", role.statusCode, 400);
  check("chat bad role stored nothing", records.size, 0);
  check("rejected chat input did not call the model", createCalls, 0);

  const design = {
    theme: "t",
    colors: "c",
    preferences: "p".repeat(401),
    month: "July",
    venue: "beach",
  };
  const longField = await cocktail.handler(post(JSON.stringify(design)));
  check("design over-long field status", longField.statusCode, 400);
  check("design over-long stored nothing", records.size, 0);

  const bigDesign = await cocktail.handler(post("y".repeat(8001)));
  check("design oversized status", bigDesign.statusCode, 400);
  check("design oversized stored nothing", records.size, 0);
  check("rejected design input did not call the model", createCalls, 0);

  const page = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  check("chat input maxlength is 2000", page.includes('id="chat-input"') && page.includes('maxlength="2000"'), true);
  check("chat page explains an over-long message", page.includes("Please shorten it and try again."), true);
  check("chat page sends only the last 10 messages", page.includes("chatHistory.slice(-10)"), true);

  const failed = results.filter((line) => line.startsWith("FAIL"));
  console.log(results.join("\n"));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
