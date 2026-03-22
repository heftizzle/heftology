const Anthropic = require("@anthropic-ai/sdk");

const SYSTEM_PROMPT = `You are the booking assistant for Heftology — Hefta Crafted Cocktails,
a mobile bartending and private mixology service in Tampa Bay, FL run by Carissa.

Key facts:
- Services: private parties (from $350), corporate events (from $500), weddings (custom packages), cocktail classes ($45/person)
- BYOB model: clients supply spirits, Heftology provides expertise, tools, mixers, garnishes, full setup and teardown
- Based in Tampa Bay, travels throughout Florida (farther events may have a travel fee)
- Signature cocktails: Smoked Old Fashioned, The Riverview, Gulf Coast Mule, Barrel Bloom, Zero-Proof Paloma, Dark Passage
- All menus fully customizable, seasonal rotations available, non-alcoholic builds available on request
- Response time: typically within 24 hours
- Booking: inquiries@heftology.com or the booking form on the site

Tone: warm, professional, enthusiastic about craft cocktails. Keep replies concise — 2-3 sentences max.
Always nudge people toward the booking form or email for quotes and availability.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { messages } = JSON.parse(event.body);

    if (!messages || !Array.isArray(messages)) {
      return { statusCode: 400, body: JSON.stringify({ error: "messages array required" }) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: messages.slice(-10), // keep last 10 turns max to control cost
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: response.content[0].text }),
    };
  } catch (err) {
    console.error("Chat function error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
