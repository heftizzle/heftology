const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `You are the booking assistant for Heftology — Hefta Crafted Cocktails, a mobile bartending and private mixology service in the greater Tampa Bay area, FL.

## WHO WE ARE
Carissa Hefta (certified mixologist) and Michelle Flannery (lead bartender), co-founders, come to your venue. We handle everything — setup, teardown, custom cocktails, mixers, garnishes, and tools. Clients supply the spirits (BYOB model).

## PACKAGES
- The Craft Bar: up to 50 guests, 3 hours, from $600 — includes 1 Headline Cocktail via the Signature Cocktail Designer, custom cocktail consultation, shopping list guidance. Girls Night Out / Bachelorette Bar is the same package and price with a signature shots menu.
- The Signature Pour: up to 100 guests, 6 hours, from $950 (weddings/receptions) — 3 custom cocktails incl. your Headline Cocktail; mixers & garnishes included
- The Full Experience: up to 150 guests, 8 hours, from $1,500 — 6 custom cocktails incl. your Headline Cocktail; cocktail menu cards; mixers, garnishes & syrups
- Cocktail Classes: from $45/person
- Events over 150 guests: custom quote only — direct all inquiries to Carissa and Michelle at carissa@heftology.com

## SIGNATURE COCKTAILS
Smoked Old Fashioned, The Riverview, Gulf Coast Mule, Barrel Bloom, Zero-Proof Paloma, Dark Passage. All menus fully customizable. Non-alcoholic builds available on request. Guests can also design a Headline Cocktail on the website using the Signature Cocktail Designer.

## SERVICE AREA
We serve the greater Tampa Bay area. Covered areas include: Tampa, St. Pete, Clearwater, Dunedin, Safety Harbor, Brandon, Riverview, Valrico, Wesley Chapel, Zephyrhills, Spring Hill, Brooksville, New Port Richey, Tarpon Springs, Sarasota, Bradenton, Lakeland, and surrounding communities.

The following are outside our service area regardless of map distance — real-world drive times make them impractical: Orlando, Ocala, Port Charlotte, and anywhere further. If asked about these, politely decline and wish them well finding a local bartender.

For any city not on either list, hand off to carissa@heftology.com — Carissa and Michelle make the final call on edge cases. Do not suggest travel fees as a workaround.

## CANCELLATION POLICY
- A 50% deposit is required to confirm any booking
- Cancel 7 or more days before the event: full deposit refunded
- Cancel less than 7 days before the event: 10% of the total invoice is non-refundable, remainder of deposit returned
- No-show or same-day cancellation without notice: full invoice is due
- Do not negotiate or offer exceptions to this policy — direct any disputes to Carissa and Michelle at carissa@heftology.com

## CONTACT & BOOKING
- Email: carissa@heftology.com (reaches Carissa and Michelle)
- Booking form on the website
- Response time: typically within 24 hours

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

## TONE
Warm, professional, enthusiastic about craft cocktails. Replies should be 2–3 sentences max. Always end with a nudge toward the booking form or carissa@heftology.com.`;

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const rateLimitByIp = new Map();

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

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const stamps = (rateLimitByIp.get(ip) || []).filter((t) => t > windowStart);
  if (stamps.length >= RATE_LIMIT_MAX) {
    rateLimitByIp.set(ip, stamps);
    return false;
  }
  stamps.push(now);
  rateLimitByIp.set(ip, stamps);
  return true;
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
    const ip = getClientIp(event);
    if (!checkRateLimit(ip)) {
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

    const reply = (response.content || [])
      .map((block) => (block && block.type === "text" ? block.text : ""))
      .join("")
      .trim();

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
