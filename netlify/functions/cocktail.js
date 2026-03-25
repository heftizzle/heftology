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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const theme = safeString(body.theme);
    const colors = safeString(body.colors);
    const preferences = safeString(body.preferences);
    const month = safeString(body.month);
    const venue = safeString(body.venue);

    if (!theme || !colors || !preferences || !month || !venue) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cocktail }),
    };
  } catch (err) {
    console.error("Cocktail function error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

