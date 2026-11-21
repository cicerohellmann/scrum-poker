const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseCookies, makeDiscriminator, buildClientCookie, CLIENT_COOKIE, staleParticipantIds } = require("../identity");

test("parseCookies reads name/value pairs from a Cookie header", () => {
  assert.deepEqual(parseCookies("a=1; scrum_poker_client=abc123; b=two"), {
    a: "1",
    scrum_poker_client: "abc123",
    b: "two",
  });
});

test("parseCookies tolerates a missing or empty header", () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(""), {});
});

test("makeDiscriminator returns a 4-digit string not already taken", () => {
  // randInt returns 1234 first (taken), then 5678 (free).
  const sequence = [1234, 5678];
  const randInt = () => sequence.shift();
  const d = makeDiscriminator(new Set(["1234"]), randInt);
  assert.equal(d, "5678");
  assert.match(d, /^\d{4}$/);
});

test("buildClientCookie sets HttpOnly, SameSite=Lax, Path, and Max-Age", () => {
  const cookie = buildClientCookie("abc123", 1209600, { secure: false });
  assert.ok(cookie.startsWith(`${CLIENT_COOKIE}=abc123`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=1209600/);
  assert.doesNotMatch(cookie, /Secure/); // omitted over plain http
});

test("buildClientCookie adds Secure only when requested (https)", () => {
  const cookie = buildClientCookie("abc123", 1209600, { secure: true });
  assert.match(cookie, /Secure/);
});

test("staleParticipantIds returns only offline participants past the cutoff", () => {
  const cutoff = Date.parse("2026-06-14T00:00:00.000Z");
  const participants = [
    { id: "stale", lastSeen: "2026-06-01T00:00:00.000Z", online: false },
    { id: "fresh", lastSeen: "2026-06-20T00:00:00.000Z", online: false },
    { id: "online-but-old", lastSeen: "2026-06-01T00:00:00.000Z", online: true },
  ];
  assert.deepEqual(staleParticipantIds(participants, cutoff), ["stale"]);
});
