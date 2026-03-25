const Anthropic = require("@anthropic-ai/sdk");

const HEFTOLOGY_PROMPT = `You are Heftology's signature cocktail designer. Heftology is a Greater Tampa Bay mobile mixology company run by certified mixologists Carissa Hefta and Michelle Flannery.

When given an event theme, color palette, drink preferences, month, and venue type, you create ONE custom signature cocktail.

Factor in seasonality heavily — use warm spiced profiles for fall/winter (September–February) and fresh citrus/floral/herbal profiles for spring/summer (March–August). An apple spice drink has no business at a July beach wedding. Also factor in venue: beach/pool = tropical, frozen, heat-resistant; ballroom/hotel = elevated, sophisticated, presentation-forward; golf course = classic, approachable; rooftop = modern, sleek; boat/yacht = nautical, refreshing; backyard/home = casual, crowd-pleasing; warehouse/industrial = bold, unexpected; historic venue = classic with a twist; park/garden = floral, light, botanical; restaurant = refined.

Respond ONLY in this JSON format with no markdown or extra text:
{
  "name": "Creative cocktail name tied to the event theme",
  "tagline": "One evocative sentence describing the vibe",
  "ingredients": ["ingredient 1 with amount", "ingredient 2 with amount", "ingredient 3 with amount", "ingredient 4 with amount"],
  "garnish": "garnish description",
  "glass": "glass type",
  "method": "brief preparation method",
  "colorNote": "how the drink color ties to the event colors",
  "presenter": "Carissa or Michelle (randomly pick one)",
  "heftologyNote": "A short personal note from whichever presenter you picked about why this cocktail fits the event — warm, professional, expert tone"
}`;

function safeString(v) {
  return typeof v === "string" ? v.trim() : "";
}

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const rateLimitByIp = new Map(); // ip -> number[] (timestamps)

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

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const now = Date.now();
    const ip = getClientIp(event);
    const prev = rateLimitByIp.get(ip) || [];
    const recent = prev.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          error:
            "Looks like you're on a roll! Let's make it official — book a free consultation at heftology.com/#booking and Carissa will craft the perfect menu for your event.",
        }),
      };
    }
    recent.push(now);
    rateLimitByIp.set(ip, recent);

    const body = event.body ? JSON.parse(event.body) : {};
    const theme = safeString(body.theme);
    const colors = safeString(body.colors);
    const preferences = safeString(body.preferences);
    const month = safeString(body.month);
    const venue = safeString(body.venue);

    if (!theme || !colors || !preferences || !month || !venue) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "theme, colors, preferences, month, and venue are required" }),
      };
    }

    const userMessage = `Event theme: ${theme}\nColor palette: ${colors}\nDrink preferences: ${preferences}\nMonth of event: ${month}\nVenue type: ${venue}`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: process.env.COCKTAIL_MODEL || process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: HEFTOLOGY_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const raw = (response.content || [])
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
      .trim();

    // Best-effort cleanup if the model wraps JSON (shouldn't, per prompt).
    const clean = raw.replace(/```json|```/gi, "").trim();
    const cocktail = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ cocktail }),
    };
  } catch (err) {
    console.error("Cocktail function error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

