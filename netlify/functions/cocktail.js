const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const { connectLambda, getStore } = require("@netlify/blobs");

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
const LOCK_HOURS = 72;
const RATE_LIMIT_LOCK_MS = LOCK_HOURS * 60 * 60 * 1000;
const RATE_LIMIT_STORE = "cocktail-rate-limit";
// Pending slots live only in memory so simultaneous calls can't all pass before a write.
// The same map is the limiter when Blobs is unreachable, and it covers the lag before a write is visible.
const memoryRateLimit = new Map(); // key -> { submissions: number[], lockedUntil: number|null, pending: number }

const LOCK_MESSAGE =
  "Looks like you're on a roll! You can try the cocktail designer again in about 3 days. Let's make it official — book a free consultation at heftology.com/#booking and Carissa and Michelle will craft the perfect menu for your event.";
const BUSY_MESSAGE = "We're still finishing your last design. Please wait a moment and try again.";

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

function emptyRecord() {
  return { submissions: [], lockedUntil: null, pending: 0 };
}

function getMemoryRecord(key) {
  let rec = memoryRateLimit.get(key);
  if (!rec) {
    rec = emptyRecord();
    memoryRateLimit.set(key, rec);
  }
  return rec;
}

// Accepts the current { submissions, lockedUntil } shape and the previous timestamp-array shape.
function normalizeRecord(raw) {
  if (Array.isArray(raw)) {
    const submissions = raw.filter((t) => typeof t === "number").sort((a, b) => a - b);
    const lockedUntil =
      submissions.length >= RATE_LIMIT_MAX ? submissions[RATE_LIMIT_MAX - 1] + RATE_LIMIT_LOCK_MS : null;
    return { submissions: submissions.slice(0, RATE_LIMIT_MAX), lockedUntil };
  }
  if (raw && typeof raw === "object") {
    const submissions = Array.isArray(raw.submissions)
      ? raw.submissions.filter((t) => typeof t === "number").sort((a, b) => a - b)
      : [];
    return {
      submissions,
      lockedUntil: typeof raw.lockedUntil === "number" ? raw.lockedUntil : null,
    };
  }
  return { submissions: [], lockedUntil: null };
}

// A finished lock is deleted. One or two successes that never became a lock are deleted
// LOCK_HOURS after the first of them, so they don't count forever.
function expireRecord(rec, now) {
  if (rec.lockedUntil && now >= rec.lockedUntil) {
    rec.submissions = [];
    rec.lockedUntil = null;
    return true;
  }
  if (rec.lockedUntil) return false;
  if (rec.submissions.length && now - rec.submissions[0] >= RATE_LIMIT_LOCK_MS) {
    rec.submissions = [];
    return true;
  }
  return false;
}

async function readStoredRecord(store, key) {
  if (!store) return { record: null, store };
  try {
    const raw = await store.get(key, { type: "json" });
    return { record: raw ? normalizeRecord(raw) : null, store };
  } catch (err) {
    console.error("Rate limit read failed, using in-memory fallback:", err.message);
    return { record: null, store: null };
  }
}

async function writeRecord(store, key, rec) {
  if (!store) return;
  try {
    await store.setJSON(key, { submissions: rec.submissions.slice(), lockedUntil: rec.lockedUntil || null });
  } catch (err) {
    console.error("Rate limit write failed, using in-memory fallback:", err.message);
  }
}

async function deleteRecord(store, key) {
  if (!store || typeof store.delete !== "function") return;
  try {
    await store.delete(key);
  } catch (err) {
    console.error("Rate limit delete failed, using in-memory fallback:", err.message);
  }
}

// Reserves a pending slot before the API call. commit() records a success; release() gives the slot back.
async function beginRateLimit(store, key, now) {
  const mem = getMemoryRecord(key);
  if (expireRecord(mem, now)) {
    // Keep pending. Stored copy is removed once we know which store to talk to.
  }

  if (mem.lockedUntil && now < mem.lockedUntil) {
    return { ok: false, reason: "locked" };
  }
  if (mem.submissions.length + mem.pending >= RATE_LIMIT_MAX) {
    return { ok: false, reason: "busy" };
  }
  mem.pending += 1;

  const loaded = await readStoredRecord(store, key);
  store = loaded.store;
  const stored = loaded.record;
  if (stored) {
    const storedExpired = expireRecord(stored, now);
    if (storedExpired) await deleteRecord(store, key);

    if (stored.lockedUntil && now < stored.lockedUntil) {
      mem.submissions = stored.submissions.slice();
      mem.lockedUntil = stored.lockedUntil;
      mem.pending = Math.max(0, mem.pending - 1);
      return { ok: false, reason: "locked" };
    }
    if (!mem.lockedUntil && stored.submissions.length > mem.submissions.length) {
      mem.submissions = stored.submissions.slice();
      mem.lockedUntil = stored.lockedUntil;
    }
  } else if (expireRecord(mem, now)) {
    await deleteRecord(store, key);
  }

  if (mem.lockedUntil && now < mem.lockedUntil) {
    mem.pending = Math.max(0, mem.pending - 1);
    return { ok: false, reason: "locked" };
  }
  if (mem.submissions.length + mem.pending > RATE_LIMIT_MAX) {
    mem.pending = Math.max(0, mem.pending - 1);
    return { ok: false, reason: "busy" };
  }

  let settled = false;
  return {
    ok: true,
    async commit(at) {
      if (settled) return;
      settled = true;
      mem.pending = Math.max(0, mem.pending - 1);
      mem.submissions.push(at);
      mem.submissions.sort((a, b) => a - b);
      if (mem.submissions.length >= RATE_LIMIT_MAX) {
        mem.lockedUntil = at + RATE_LIMIT_LOCK_MS;
      }
      await writeRecord(store, key, mem);
    },
    async release() {
      if (settled) return;
      settled = true;
      mem.pending = Math.max(0, mem.pending - 1);
    },
  };
}

exports.LOCK_HOURS = LOCK_HOURS;

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

    const store = openRateLimitStore(event);
    const gate = await beginRateLimit(store, rateLimitKey(getClientIp(event)), Date.now());
    if (!gate.ok) {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: gate.reason === "busy" ? BUSY_MESSAGE : LOCK_MESSAGE }),
      };
    }

    try {
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
      let cocktail;
      try {
        cocktail = JSON.parse(clean);
      } catch (parseErr) {
        await gate.release();
        console.error("Cocktail JSON parse error:", parseErr, clean.slice(0, 200));
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Could not craft that cocktail. Please try again." }),
        };
      }

      await gate.commit(Date.now());
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ cocktail }),
      };
    } catch (err) {
      await gate.release();
      throw err;
    }
  } catch (err) {
    console.error("Cocktail function error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

