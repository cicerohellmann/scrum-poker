const crypto = require("node:crypto");

// The stable per-browser identity cookie. One client id maps to many per-room
// participant records, so a returning browser is always the same person.
const CLIENT_COOKIE = "scrum_poker_client";

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string" || !header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

function defaultRandInt(min, max) {
  return crypto.randomInt(min, max);
}

// A 4-digit suffix (1000–9999) that distinguishes two people with the same name
// in one room. Stable per participant; skips values already taken in the room.
function makeDiscriminator(taken, randInt = defaultRandInt) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(randInt(1000, 10000));
    if (!taken.has(candidate)) return candidate;
  }
  for (let n = 1000; n < 10000; n += 1) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  return "0000";
}

function buildClientCookie(clientId, maxAgeSeconds, { secure = true } = {}) {
  const parts = [
    `${CLIENT_COOKIE}=${clientId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

// Offline participants whose session has been idle past the cutoff. Online
// participants are always kept (their lastSeen is refreshed while connected).
function staleParticipantIds(participants, cutoffMs) {
  const ids = [];
  for (const participant of participants) {
    if (participant.online) continue;
    const seen = Date.parse(participant.lastSeen);
    if (Number.isFinite(seen) && seen < cutoffMs) ids.push(participant.id);
  }
  return ids;
}

module.exports = { CLIENT_COOKIE, parseCookies, makeDiscriminator, buildClientCookie, staleParticipantIds };
