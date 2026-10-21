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

For a place outside that list, the event may still be possible. Travel cost for a place outside the list is decided case by case, and Carissa or Michelle confirm it. Never promise a date and never quote a specific fee.

For a very distant place, far outside the covered list, say it is probably outside our range. Invite them to email Carissa or Michelle at carissa@heftology.com in case an exception is possible. Do not say it might still be possible.

## CANCELLATION POLICY
- A 50% deposit is required to confirm any booking
- Cancel 7 or more days before the event: full deposit refunded
- Cancel less than 7 days before the event: 10% of the total invoice is non-refundable, remainder of deposit returned
- No-show or same-day cancellation without notice: full invoice is due
- Do not negotiate or offer exceptions to this policy — direct any disputes to Carissa and Michelle at carissa@heftology.com

## CONTACT & BOOKING
- Email: carissa@heftology.com (reaches Carissa and Michelle)
- Booking form: https://heftology.com/#booking
- Response time: typically within 24 hours
- The ONLY links you may ever give are https://heftology.com/#booking and the email carissa@heftology.com. Never invent other URLs or pages.

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
10. The ONLY links you may ever give are https://heftology.com/#booking and the email carissa@heftology.com. Never invent other URLs or pages.

## TONE
Warm, professional, enthusiastic about craft cocktails. Replies should be 2–3 sentences max. Always end with a nudge toward https://heftology.com/#booking or carissa@heftology.com.`;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_STORE = "chat-rate-limit";
// Blobs edge reads can lag writes by up to ~60s, so a per-instance copy is merged in to
// catch rapid repeats; it is also the only limiter if Blobs is unreachable.
const memoryRateLimit = new Map(); // key -> number[] (timestamps)

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

function rateLimitKey(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function openRateLimitStore(event) {
  try {
    connectLambda(event);
    return getStore(RATE_LIMIT_STORE);
  } catch (err) {
    console.error("Rate limit store unavailable, using in-memory fallback:", err.message);
    return null;
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

// Homepage, with or without a fragment, and mailto:carissa@heftology.com.
// Any other URL is replaced. Do not log the reply text.
function isAllowedUrl(raw) {
  let value = String(raw).trim().replace(/^<|>$/g, "");
  if (/^mailto:/i.test(value)) {
    const rest = value.slice("mailto:".length);
    const address = rest.split(/[?#]/)[0];
    return address.toLowerCase() === "carissa@heftology.com" && rest === address;
  }
  if (/^www\./i.test(value)) value = "https://" + value;
  else if (/^heftology\.com(?:[/#?]|$)/i.test(value)) value = "https://" + value;

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "heftology.com") return false;
  if (url.username || url.password || url.port || url.search) return false;

  const afterScheme = value.replace(/^https:\/\//i, "");
  if (afterScheme.toLowerCase().indexOf("heftology.com") !== 0) return false;
  const afterHost = afterScheme.slice("heftology.com".length);
  return /^(?:\/)?(?:#[^\s]*)?$/.test(afterHost);
}

function filterReplyUrls(text) {
  if (typeof text !== "string" || !text) return text;
  const withoutMarkdown = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, _label, href) =>
    isAllowedUrl(href) ? match : DISALLOWED_LINK_TEXT
  );
  return withoutMarkdown.replace(
    /\b(?:https?:\/\/|mailto:|www\.|heftology\.com\/)[^\s<>\[\]()'"]+/gi,
    (match) => {
      const trimmed = match.replace(/[.,!?;:]+$/g, "");
      const trailing = match.slice(trimmed.length);
      return (isAllowedUrl(trimmed) ? trimmed : DISALLOWED_LINK_TEXT) + trailing;
    }
  );
}

function normalizeMessages(messages) {
  const cleaned = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-10);

  // Anthropic requires the conversation to start with a user turn
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned;
}

exports.filterReplyUrls = filterReplyUrls;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        ...headers,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const store = openRateLimitStore(event);
    if (!(await consumeRateLimit(store, rateLimitKey(getClientIp(event)), Date.now()))) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: "Too many messages. Please try again later or email carissa@heftology.com." }),
      };
    }

    const { messages } = JSON.parse(event.body || "{}");

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "messages array required" }) };
    }

    const normalized = normalizeMessages(messages);
    if (!normalized.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "At least one user message is required" }) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: normalized,
    });

    const reply = filterReplyUrls(
      (response.content || [])
        .map((block) => (block && block.type === "text" ? block.text : ""))
        .join("")
        .trim()
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: reply || "Sorry, I could not get a response. Please email carissa@heftology.com directly." }),
    };
  } catch (err) {
    console.error("Chat function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
