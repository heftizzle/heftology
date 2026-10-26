const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { connectLambda, getStore } = require("@netlify/blobs");

const SYSTEM_PROMPT = `You are the booking assistant for Heftology — Hefta Crafted Cocktails, a mobile bartending and private mixology service in the greater Tampa Bay area, FL.

## WHO WE ARE
Carissa Hefta (certified mixologist) and Michelle Flannery (lead bartender), co-founders, come to your venue. We handle everything — setup, teardown, custom cocktails, mixers, garnishes, and tools. Clients supply the spirits (BYOB model).

## PACKAGES
- The Craft Bar: up to 50 guests, 3 hours, from $600 — includes 1 Headline Cocktail via the Signature Cocktail Designer, custom cocktail consultation, shopping list guidance. Girls Night Out / Bachelorette Bar is the same package and price with a signature shots menu.
- The Signature Pour: up to 100 guests, 6 hours, from $950 (weddings/receptions) — 2 custom cocktails incl. your Headline Cocktail; mixers & garnishes included
- The Full Experience: up to 150 guests, 8 hours, from $1,500 — 4 custom cocktails incl. your Headline Cocktail; cocktail menu cards; mixers, garnishes & syrups
- Cocktail Classes: from $45/person
- Events over 150 guests: custom quote only — direct all inquiries to Carissa and Michelle at carissa@heftology.com

## SIGNATURE COCKTAILS
Classic Old Fashioned, Mango Chili Margarita, Peach Bellini, two zero-proof cocktails (Flamingo Fizz and Tropic Like It's Hot), plus a rotating seasonal cocktail. All menus fully customizable. Non-alcoholic builds available on request. Guests can also design a Headline Cocktail on the website using the Signature Cocktail Designer.

## SERVICE AREA
We serve the greater Tampa Bay area. Covered cities include: Tampa, St. Pete, Clearwater, Dunedin, Safety Harbor, Brandon, Riverview, Valrico, Wesley Chapel, Zephyrhills, Spring Hill, Brooksville, New Port Richey, Tarpon Springs, Sarasota, Bradenton, Ruskin, Lakeland, and surrounding communities. Events in these covered cities carry no travel fee.

When a visitor asks about a covered city, say it is in our service area and that there is no travel fee. Do not mention travel costs unless the visitor asks about a place outside this list.

For a place outside that list but within about two hours' drive of the Tampa Bay area, the event may still be possible. Travel cost for a place outside the list is decided case by case, and Carissa or Michelle confirm it. Never promise a date and never quote a specific fee.

For a very distant place, anywhere more than about two hours' drive from the Tampa Bay area, such as far South Florida, the Keys, the Panhandle, North Florida, or out of state, the reply must begin with "That's probably outside our range" and then invite an email to carissa@heftology.com. Never use "work something out", "exception", "may still be possible", or "reach out to see if".

## DEPOSIT, BALANCE & CANCELLATION POLICY
- A 50% deposit holds the date and is invoiced once event details are confirmed
- The balance is due 5 days before the event and is charged to the card on file the client authorizes in the signed agreement
- If the balance is not paid, the booking is not held and the deposit is kept
- The deposit is non-refundable. If the client cancels at least 30 days before the event, the deposit becomes credit toward a future Heftology booking within 12 months. Closer than 30 days, the deposit is kept. Once the balance is charged, it is non-refundable
- One reschedule, subject to availability, if asked at least 14 days before the original date
- Guest count changes: tell us at least 7 days before the event
- If a Heftology bartender cannot make it, Heftology sends a qualified replacement; if it cannot, the client gets a full refund of everything paid
- Do not negotiate or offer exceptions. Never mention or hint at any refund beyond what is listed here. Direct disputes and exception requests to Carissa and Michelle at carissa@heftology.com

## CONTACT & BOOKING
- Email only carissa@heftology.com. That address reaches Carissa and Michelle. Never give any other email address.
- Booking form: https://heftology.com/#booking
- Response time: typically within 24 hours
- The ONLY links you may ever give are https://heftology.com/#booking and the email carissa@heftology.com. Never invent other URLs, pages, or email addresses.

## RULES — FOLLOW THESE WITHOUT EXCEPTION
1. Never confirm availability for any date — always direct to Carissa and Michelle
2. Never quote custom pricing beyond the listed package starting rates
3. Never make promises about what a custom package includes — that is Carissa and Michelle's conversation to have
4. Never confirm whether Heftology is licensed, insured, or permitted for a specific event — direct to Carissa and Michelle
5. Never discuss deposit amounts, payment methods, or contract terms beyond what is listed above
6. If you don't know the answer, say so and point to carissa@heftology.com
7. Stay on topic — only discuss Heftology services, events, cocktails, and booking. If asked about anything unrelated, politely redirect
8. Never confirm an event is booked or locked in — every conversation ends with a handoff to Carissa and Michelle
9. Never negotiate, create exceptions, or override any policy — Carissa and Michelle handle all exceptions
10. The ONLY links you may ever give are https://heftology.com/#booking and the email carissa@heftology.com. Email only carissa@heftology.com. Never invent other URLs, pages, or email addresses.

## TONE
Warm, professional, enthusiastic about craft cocktails. Replies should be 2–3 sentences max. Always end with a nudge toward https://heftology.com/#booking or carissa@heftology.com.`;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_STORE = "chat-rate-limit";
const DAILY_LIMIT = 400;
const DAILY_STORE = "chat-daily-budget";
const DAILY_CAPACITY_MESSAGE =
  "We're at capacity today. Please book at heftology.com/#booking.";
const MAX_BODY_BYTES = 24000;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 2000;
const TOO_LONG_MESSAGE = "That message is too long. Please shorten it to 2,000 characters.";
// Blobs edge reads can lag writes by up to ~60s, so a per-instance copy is merged in to
// catch rapid repeats; it is also the only limiter if Blobs is unreachable.
const memoryRateLimit = new Map(); // key -> number[] (timestamps)
const memoryDaily = new Map(); // UTC day -> successful model calls

function getClientIp(event) {
  const h = event.headers || {};
  const direct =
    h["x-nf-client-connection-ip"] ||
    h["X-Nf-Client-Connection-Ip"] ||
    h["x-real-ip"] ||
    h["X-Real-Ip"] ||
    h["client-ip"] ||
    h["Client-Ip"];
  if (direct) return String(direct).split(",")[0].trim();

  const xff = h["x-forwarded-for"] || h["X-Forwarded-For"];
  if (xff) return String(xff).split(",")[0].trim();

  return "unknown";
}

let warnedUnsaltedHash = false;

function rateLimitKey(ip) {
  const salt = process.env.RATE_LIMIT_SALT;
  if (typeof salt === "string" && salt.length > 0) {
    return crypto.createHmac("sha256", salt).update(String(ip)).digest("hex");
  }
  if (!warnedUnsaltedHash) {
    warnedUnsaltedHash = true;
    console.log(JSON.stringify({ event: "ip_hash_unsalted" }));
  }
  return crypto.createHash("sha256").update(String(ip)).digest("hex");
}

function openStore(event, name, label) {
  try {
    connectLambda(event);
    return getStore(name);
  } catch (err) {
    console.error(label + " store unavailable, using in-memory fallback:", err.message);
    return null;
  }
}

function openRateLimitStore(event) {
  return openStore(event, RATE_LIMIT_STORE, "Rate limit");
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

async function readDailyCount(store, day) {
  let fromStore = 0;
  let live = store;
  if (live) {
    try {
      const rec = await live.get(day, { type: "json" });
      fromStore = rec && typeof rec.count === "number" ? rec.count : 0;
    } catch (err) {
      console.error("Daily budget read failed, using in-memory fallback:", err.message);
      live = null;
    }
  }
  return { count: Math.max(fromStore, memoryDaily.get(day) || 0), store: live };
}

async function checkDailyBudget(event, now) {
  const day = utcDay(now);
  const opened = openStore(event, DAILY_STORE, "Daily budget");
  const { count, store } = await readDailyCount(opened, day);
  if (count >= DAILY_LIMIT) return { ok: false };
  return { ok: true, store, day };
}

async function recordDailySuccess(store, day) {
  const nextMemory = (memoryDaily.get(day) || 0) + 1;
  memoryDaily.set(day, nextMemory);
  if (!store) return;
  try {
    const rec = await store.get(day, { type: "json" });
    const stored = rec && typeof rec.count === "number" ? rec.count : 0;
    const count = Math.max(stored + 1, nextMemory);
    memoryDaily.set(day, count);
    await store.setJSON(day, { count });
  } catch (err) {
    console.error("Daily budget write failed, using in-memory fallback:", err.message);
  }
}

// Returns true if this request is allowed (and records it), false if over the limit.
async function consumeRateLimit(store, key, now) {
  let stored = [];
  if (store) {
    try {
      stored = (await store.get(key, { type: "json" })) || [];
    } catch (err) {
      console.error("Rate limit read failed, using in-memory fallback:", err.message);
      store = null;
    }
  }

  const inWindow = (list) =>
    (Array.isArray(list) ? list : []).filter((t) => typeof t === "number" && now - t < RATE_LIMIT_WINDOW_MS);
  const fromStore = inWindow(stored);
  const fromMemory = inWindow(memoryRateLimit.get(key));
  const recent = fromMemory.length > fromStore.length ? fromMemory : fromStore;
  if (recent.length >= RATE_LIMIT_MAX) return false;

  recent.push(now);
  memoryRateLimit.set(key, recent);
  if (store) {
    try {
      await store.setJSON(key, recent);
    } catch (err) {
      console.error("Rate limit write failed, using in-memory fallback:", err.message);
    }
  }
  return true;
}

const DISALLOWED_LINK_TEXT = "the booking form on our website";
const ALLOWED_EMAIL = "carissa@heftology.com";

// Allowed: https://heftology.com/ with an optional fragment, and mailto:carissa@heftology.com.
// Every other URL or email is replaced. Do not log the reply text.
function splitTrailingPunctuation(token) {
  const match = String(token).match(/^(.*?)([.,!?;:,]+)$/);
  if (!match || !match[1]) return { core: String(token), trailing: "" };
  return { core: match[1], trailing: match[2] };
}

function isAllowedEmail(value) {
  return String(value).trim().toLowerCase() === ALLOWED_EMAIL;
}

function isAllowedUrl(raw) {
  const { core } = splitTrailingPunctuation(String(raw).trim().replace(/^<|>$/g, ""));
  if (/^mailto:/i.test(core)) {
    const rest = core.slice("mailto:".length);
    const address = rest.split(/[?#]/)[0];
    return isAllowedEmail(address) && rest.toLowerCase() === address.toLowerCase();
  }

  let url;
  try {
    url = new URL(core);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "heftology.com") return false;
  if (url.username || url.password || url.port || url.search) return false;

  const afterScheme = core.replace(/^https:\/\//i, "");
  if (!afterScheme.toLowerCase().startsWith("heftology.com")) return false;
  const afterHost = afterScheme.slice("heftology.com".length);
  return /^(?:\/)?(?:#[^\s]*)?$/.test(afterHost);
}

function replaceDisallowed(token) {
  const { core, trailing } = splitTrailingPunctuation(token);
  return (isAllowedUrl(core) ? core : DISALLOWED_LINK_TEXT) + trailing;
}

function filterReplyUrls(text) {
  if (typeof text !== "string" || !text) return text;

  const withoutMarkdown = text.replace(/!?\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (match, label, href) => {
    if (isAllowedUrl(href)) return match;
    const visible = filterReplyUrls(label).trim();
    if (!visible || visible === DISALLOWED_LINK_TEXT) return DISALLOWED_LINK_TEXT;
    return `${visible} ${DISALLOWED_LINK_TEXT}`;
  });

  // Scheme, www, bare heftology.com, and any other host that has a path.
  // The lookbehind skips the host inside an email address.
  const withoutUrls = withoutMarkdown.replace(
    /(?<![@\w])(?:https?:\/\/[^\s<>\[\]()'"]+|mailto:[^\s<>\[\]()'"]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?![\w.])(?:\/[^\s<>\[\]()'"]*)?|heftology\.com(?![\w.])(?:\/[^\s<>\[\]()'"]*)?|(?:[a-z0-9-]+\.)+[a-z]{2,}(?![\w.])\/[^\s<>\[\]()'"]*)/gi,
    (match) => replaceDisallowed(match)
  );

  return withoutUrls.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (match) =>
    isAllowedEmail(match) ? match : DISALLOWED_LINK_TEXT
  );
}

function normalizeMessages(messages) {
  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-MAX_MESSAGES);

  // Anthropic requires the conversation to start with a user turn
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

function readBody(event) {
  if (!event.body) return { text: "", bytes: 0 };
  if (event.isBase64Encoded) {
    const buf = Buffer.from(event.body, "base64");
    return { text: buf.toString("utf8"), bytes: buf.length };
  }
  return { text: event.body, bytes: Buffer.byteLength(event.body, "utf8") };
}

function validateChatInput(event) {
  const { text, bytes } = readBody(event);
  if (bytes > MAX_BODY_BYTES) {
    return { error: "Request is too large." };
  }
  let messages;
  try {
    ({ messages } = JSON.parse(text || "{}"));
  } catch {
    return { error: "invalid JSON" };
  }
  if (!messages || !Array.isArray(messages)) {
    return { error: "messages array required" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { error: "Please send no more than 10 messages." };
  }
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { error: "Each message needs a user or assistant role." };
    }
    if (message.role !== "user" && message.role !== "assistant") {
      return { error: "Each message needs a user or assistant role." };
    }
    if (typeof message.content !== "string") {
      return { error: "Each message needs text content." };
    }
    if (message.content.trim().length > MAX_MESSAGE_CHARS) {
      return { error: TOO_LONG_MESSAGE };
    }
  }
  const normalized = normalizeMessages(messages);
  if (!normalized.length) return { error: "At least one user message is required" };
  return { messages: normalized };
}

exports.filterReplyUrls = filterReplyUrls;

function respond(eventName, started, ip, statusCode, headers, body, usage, err) {
  const line = {
    event: eventName,
    status: statusCode,
    latencyMs: Date.now() - started,
    inputTokens: usage && typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: usage && typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    ipHash: rateLimitKey(ip),
  };
  if (statusCode === 500 && err && typeof err === "object") {
    if (typeof err.name === "string") line.errorName = err.name;
    if (typeof err.status === "number") line.errorStatus = err.status;
  }
  console.log(JSON.stringify(line));
  return { statusCode, headers, body };
}

exports.handler = async (event) => {
  const started = Date.now();
  const ip = getClientIp(event);
  const headers = { "Content-Type": "application/json" };
  const send = (statusCode, responseHeaders, body, usage, err, eventName = "chat") =>
    respond(eventName, started, ip, statusCode, responseHeaders, body, usage, err);

  if (event.httpMethod === "OPTIONS") {
    return send(204, {
      ...headers,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    }, "");
  }

  if (event.httpMethod !== "POST") {
    return send(405, headers, JSON.stringify({ error: "Method Not Allowed" }));
  }

  const parsed = validateChatInput(event);
  if (parsed.error) {
    return send(400, headers, JSON.stringify({ error: parsed.error }));
  }
  const normalized = parsed.messages;

  const budget = await checkDailyBudget(event, Date.now());
  if (!budget.ok) {
    return send(503, headers, JSON.stringify({ error: DAILY_CAPACITY_MESSAGE }), null, null, "daily_budget_exhausted");
  }

  try {
    const store = openRateLimitStore(event);
    if (!(await consumeRateLimit(store, rateLimitKey(ip), Date.now()))) {
      return send(429, headers, JSON.stringify({ error: "Too many messages. Please try again later or email carissa@heftology.com." }));
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: normalized,
    });
    await recordDailySuccess(budget.store, budget.day);

    const reply = filterReplyUrls(
      (response.content || [])
        .map((block) => (block && block.type === "text" ? block.text : ""))
        .join("")
        .trim()
    );

    return send(
      200,
      headers,
      JSON.stringify({ reply: reply || "Sorry, I could not get a response. Please email carissa@heftology.com directly." }),
      response.usage
    );
  } catch (err) {
    console.error("Chat function error");
    return send(500, headers, JSON.stringify({ error: "Internal server error" }), null, err);
  }
};
