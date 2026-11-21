const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.PERSIST_TEST_PORT || 3041);
const BASE = `http://127.0.0.1:${PORT}`;

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrum-persist-"));
  return path.join(dir, "rooms.db");
}

function startServer(dbPath) {
  const child = spawn("node", ["--experimental-sqlite", SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: dbPath,
      ROOM_CREATION_LIMIT: "50",
    },
    stdio: "ignore",
  });
  return child;
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await delay(50);
  }
  throw new Error("server did not become healthy in time");
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read the first streamed chunk of an SSE response, then let the caller abort.
async function readFirstChunk(res) {
  const reader = res.body.getReader();
  const { value } = await reader.read();
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(value || new Uint8Array());
}

test("a room and its vote history survive a process restart", async () => {
  const dbPath = tempDbPath();

  // First boot: create a room and complete one revealed-and-reset round.
  let child = startServer(dbPath);
  await waitForHealth();

  const createRes = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "Persisted", name: "Ada", password: "team-pass" }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const roomId = created.room.id;
  const { id: participantId, token } = created.participant;

  const authed = (action, payload) =>
    fetch(`${BASE}/api/rooms/${roomId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ participantId, ...payload }),
    });

  assert.equal((await authed("vote", { value: "5" })).status, 200);
  // Revealing the round records it into history; reset then clears the table.
  assert.equal((await authed("reveal", {})).status, 200);
  assert.equal((await authed("reset", {})).status, 200);

  await stopServer(child);

  // Second boot: same DB. The room must still exist at the same id with history.
  child = startServer(dbPath);
  await waitForHealth();

  // The feature: the creator's saved session must re-authenticate after restart.
  // Resume sends the persisted participantId + token and lands back as the same,
  // still-host participant — no re-login, no duplicate record.
  const resumeRes = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, token, password: "team-pass" }),
  });
  assert.equal(resumeRes.status, 200, "saved session should resume (200), not be wiped after restart");

  const resumed = await resumeRes.json();
  assert.equal(resumed.room.id, roomId);
  assert.equal(resumed.participant.id, participantId, "resumed participant keeps the same id");
  assert.equal(resumed.participant.isHost, true, "the returning creator stays host after restart");
  assert.equal(resumed.room.voteHistory.length, 1, "vote history should survive restart");

  // The real browser-reload path: the SSE stream re-authenticates with token only
  // (no password). After restart this must yield a `room` event, not session-invalid.
  const eventsController = new AbortController();
  const eventsRes = await fetch(
    `${BASE}/api/rooms/${roomId}/events?participantId=${participantId}&token=${token}`,
    { signal: eventsController.signal },
  );
  const firstChunk = await readFirstChunk(eventsRes);
  eventsController.abort();
  assert.match(
    firstChunk,
    /event: room/,
    "a token-only SSE reconnect should re-authenticate after restart (no re-login)",
  );
  assert.doesNotMatch(firstChunk, /session-invalid/, "the saved session must not be wiped on reload");

  // A brand-new browser still joins fresh as a separate participant.
  const rejoinRes = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Lin", password: "team-pass" }),
  });
  assert.equal(rejoinRes.status, 201, "a new participant can still join the restored room");

  const rejoined = await rejoinRes.json();
  assert.notEqual(rejoined.participant.id, participantId, "a fresh join is not the restored host");

  const rejoinedAuthed = (action, payload) =>
    fetch(`${BASE}/api/rooms/${roomId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rejoined.participant.token}`,
      },
      body: JSON.stringify({ participantId: rejoined.participant.id, ...payload }),
    });

  assert.equal((await rejoinedAuthed("vote", { value: "8" })).status, 200);
  assert.equal(
    (await rejoinedAuthed("reveal", {})).status,
    200,
    "any participant should be able to reveal in a restored room",
  );
  assert.equal((await rejoinedAuthed("reset", {})).status, 200);

  await stopServer(child);
});

test("a room retains well beyond 20 rounds of vote history", async () => {
  const dbPath = tempDbPath();
  const child = startServer(dbPath);
  await waitForHealth();

  const createRes = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "Long History", name: "Ada", password: "team-pass" }),
  });
  const created = await createRes.json();
  const roomId = created.room.id;
  const { id: participantId, token } = created.participant;

  const authed = (action, payload) =>
    fetch(`${BASE}/api/rooms/${roomId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participantId, ...payload }),
    });

  // Complete 25 revealed-and-reset rounds; revealing each one records a history entry.
  let lastRoom;
  for (let round = 0; round < 25; round++) {
    await authed("vote", { value: "5" });
    await authed("reveal", {});
    lastRoom = (await (await authed("reset", {})).json()).room;
  }

  assert.equal(lastRoom.voteHistory.length, 25, "all 25 rounds should be retained, not capped at 20");

  await stopServer(child);
});
