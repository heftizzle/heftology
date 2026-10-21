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
const DAILY_LIMIT = 150;
const DAILY_STORE = "cocktail-daily-budget";
const DAILY_CAPACITY_MESSAGE =
  "We're at capacity today. Please book at heftology.com/#booking.";
const MAX_BODY_BYTES = 8000;
const MAX_FIELD_CHARS = 400;
const MIN_ELAPSED_MS = 1500;
const QUIET_COCKTAIL = {
  name: "The House Welcome",
  tagline: "A signature pour for the evening.",
  ingredients: ["2 oz spirit of your choice", "1 oz fresh citrus", "1/2 oz simple syrup", "Sparkling water"],
  garnish: "Citrus peel",
  glass: "Coupe",
  method: "Shake and strain",
  colorNote: "A warm blush that suits the room.",
  presenter: "Carissa",
  heftologyNote: "We can refine this together when you book.",
};

function quietBotSignal(body) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.hp_field === "string" ? body.hp_field.trim() : body.hp_field) return true;
  if (!Object.prototype.hasOwnProperty.call(body, "elapsedMs") || body.elapsedMs === null || body.elapsedMs === "") {
    return false;
  }
  const elapsed = typeof body.elapsedMs === "number" ? body.elapsedMs : Number(body.elapsedMs);
  return Number.isFinite(elapsed) && elapsed < MIN_ELAPSED_MS;
}
// Pending slots live only in memory so simultaneous calls can't all pass before a write.
// The same map is the limiter when Blobs is unreachable, and it covers the lag before a write is visible.
const memoryRateLimit = new Map(); // key -> { submissions: number[], lockedUntil: number|null, pending: number }
const memoryDaily = new Map(); // UTC day -> successful model calls

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
  if (count >= DAILY_LIMIT) {
    console.log(JSON.stringify({ event: "daily_budget_exhausted" }));
    return { ok: false };
  }
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

const ALLOWED_ORIGINS = new Set(["https://heftology.com", "https://www.heftology.com"]);

function corsHeadersFor(event) {
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || "";
  const corsHeaders = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) corsHeaders["Access-Control-Allow-Origin"] = origin;
  return corsHeaders;
}

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
  const corsHeaders = corsHeadersFor(event);
  const send = (statusCode, body, usage, err) =>
    respond("cocktail", started, ip, statusCode, corsHeaders, body, usage, err);

  if (event.httpMethod === "OPTIONS") {
    return send(204, "");
  }

  if (event.httpMethod !== "POST") {
    return send(405, JSON.stringify({ error: "Method Not Allowed" }));
  }

  if (Buffer.byteLength(event.body || "", "utf8") > MAX_BODY_BYTES) {
    return send(400, JSON.stringify({ error: "Request is too large." }));
  }

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return send(400, JSON.stringify({ error: "invalid JSON" }));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return send(400, JSON.stringify({ error: "invalid JSON" }));
    }
  }

  if (quietBotSignal(body)) {
    return send(200, JSON.stringify({ cocktail: QUIET_COCKTAIL }));
  }

  try {
    const theme = safeString(body && body.theme);
    const colors = safeString(body.colors);
    const preferences = safeString(body.preferences);
    const month = safeString(body.month);
    const venue = safeString(body.venue);
    const fields = [theme, colors, preferences, month, venue];
    if (fields.some((field) => field.length > MAX_FIELD_CHARS)) {
      return send(400, JSON.stringify({ error: "That field is too long." }));
    }

    if (!theme || !colors || !preferences || !month || !venue) {
      return send(400, JSON.stringify({ error: "theme, colors, preferences, month, and venue are required" }));
    }

    const budget = await checkDailyBudget(event, Date.now());
    if (!budget.ok) {
      return send(503, JSON.stringify({ error: DAILY_CAPACITY_MESSAGE }));
    }

    const store = openRateLimitStore(event);
    const gate = await beginRateLimit(store, rateLimitKey(ip), Date.now());
    if (!gate.ok) {
      return send(429, JSON.stringify({ error: gate.reason === "busy" ? BUSY_MESSAGE : LOCK_MESSAGE }));
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
      } catch {
        await gate.release();
        console.error("Cocktail JSON parse error");
        return send(502, JSON.stringify({ error: "Could not craft that cocktail. Please try again." }));
      }

      await gate.commit(Date.now());
      await recordDailySuccess(budget.store, budget.day);
      return send(200, JSON.stringify({ cocktail }), response.usage);
    } catch (err) {
      await gate.release();
      throw err;
    }
  } catch (err) {
    console.error("Cocktail function error");
    return send(500, JSON.stringify({ error: "Internal server error" }), null, err);
  }
};

