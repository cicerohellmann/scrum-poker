const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { createStore } = require("../store");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.OWNER_TEST_PORT || 3047);
const BASE = `http://127.0.0.1:${PORT}`;

function tempDbPath(prefix = "scrum-owner-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, "rooms.db");
}

function startServer(dbPath) {
  const child = spawn("node", ["--experimental-sqlite", SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ROOM_CREATION_LIMIT: "50" },
    stdio: "ignore",
  });
  return child;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
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

// The identity cookie the server sets on the create/join response. Ownership is
// keyed on it, so acting "as the owner" means replaying this exact cookie.
function clientCookie(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  const match = setCookie.match(/scrum_poker_client=([^;]+)/);
  return match ? `scrum_poker_client=${match[1]}` : "";
}

// --- Server integration -----------------------------------------------------

test("the room owner can rename; a non-owner cannot", async () => {
  const child = startServer(tempDbPath());
  await waitForHealth();
  try {
    const createRes = await fetch(`${BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName: "Original", name: "Ada", password: "team-pass" }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const roomId = created.room.id;
    const ownerCookie = clientCookie(createRes);

    // Owner (same identity cookie) renames the room.
    const renameRes = await fetch(`${BASE}/api/rooms/${roomId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ name: "Renamed Room" }),
    });
    assert.equal(renameRes.status, 200, "owner rename should succeed");
    const renamed = await renameRes.json();
    assert.equal(renamed.room.name, "Renamed Room", "snapshot reflects the new name");

    // A second browser joins as a plain player (a fresh identity cookie).
    const joinRes = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lin", password: "team-pass" }),
    });
    assert.equal(joinRes.status, 201);
    const playerCookie = clientCookie(joinRes);

    // Non-owner rename is rejected server-side, regardless of the UI.
    const badRename = await fetch(`${BASE}/api/rooms/${roomId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: playerCookie },
      body: JSON.stringify({ name: "Hijacked" }),
    });
    assert.equal(badRename.status, 403, "a non-owner cannot rename");

    // And the name is unchanged.
    const stillNamed = await fetch(`${BASE}/api/rooms/${roomId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ name: "Renamed Room" }),
    });
    assert.equal((await stillNamed.json()).room.name, "Renamed Room");
  } finally {
    await stopServer(child);
  }
});

test("the owner can change the password without evicting seated players", async () => {
  const child = startServer(tempDbPath());
  await waitForHealth();
  try {
    const createRes = await fetch(`${BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName: "Secret", name: "Ada", password: "old-pass" }),
    });
    const created = await createRes.json();
    const roomId = created.room.id;
    const { id: participantId, token } = created.participant;
    const ownerCookie = clientCookie(createRes);

    // Owner rotates the password.
    const pwRes = await fetch(`${BASE}/api/rooms/${roomId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ password: "new-pass" }),
    });
    assert.equal(pwRes.status, 200, "owner can change the password");

    // A new joiner must use the new password; the old one no longer works.
    const oldPwJoin = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lin", password: "old-pass" }),
    });
    assert.equal(oldPwJoin.status, 403, "the old password stops working");

    const newPwJoin = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lin", password: "new-pass" }),
    });
    assert.equal(newPwJoin.status, 201, "the new password works for new joiners");

    // The already-seated creator keeps their session — token still authenticates.
    const stillIn = await fetch(`${BASE}/api/rooms/${roomId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participantId, value: "5" }),
    });
    assert.equal(stillIn.status, 200, "a seated participant is not evicted by a password change");

    // Too-short passwords are rejected.
    const shortPw = await fetch(`${BASE}/api/rooms/${roomId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ password: "abc" }),
    });
    assert.equal(shortPw.status, 400, "password must be at least 4 characters");

    // A non-owner cannot change the password.
    const playerCookie = clientCookie(newPwJoin);
    const badPw = await fetch(`${BASE}/api/rooms/${roomId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: playerCookie },
      body: JSON.stringify({ password: "hijack-pass" }),
    });
    assert.equal(badPw.status, 403, "a non-owner cannot change the password");
  } finally {
    await stopServer(child);
  }
});

test("the snapshot exposes isOwner per viewer and the owner's name", async () => {
  const child = startServer(tempDbPath());
  await waitForHealth();
  try {
    const createRes = await fetch(`${BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName: "Owned", name: "Ada", password: "team-pass" }),
    });
    const created = await createRes.json();
    const roomId = created.room.id;

    assert.equal(created.room.ownerName, "Ada", "snapshot names the owner");
    const creatorSeat = created.room.participants.find((p) => p.id === created.participant.id);
    assert.equal(creatorSeat.isOwner, true, "the creator is the owner");

    const joinRes = await fetch(`${BASE}/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Lin", password: "team-pass" }),
    });
    const joined = await joinRes.json();
    const playerSeat = joined.room.participants.find((p) => p.id === joined.participant.id);
    assert.equal(playerSeat.isOwner, false, "a plain joiner is not the owner");
    assert.equal(joined.room.ownerName, "Ada", "the owner name is visible to everyone");
  } finally {
    await stopServer(child);
  }
});

test("my-rooms marks which rooms this browser owns", async () => {
  const child = startServer(tempDbPath());
  await waitForHealth();
  try {
    const createRes = await fetch(`${BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName: "Mine", name: "Ada", password: "team-pass" }),
    });
    const ownerCookie = clientCookie(createRes);

    const myRooms = await fetch(`${BASE}/api/my-rooms`, {
      headers: { Cookie: ownerCookie },
    });
    const body = await myRooms.json();
    assert.equal(body.rooms.length, 1);
    assert.equal(body.rooms[0].isOwner, true, "the creator owns their room in the dashboard list");
  } finally {
    await stopServer(child);
  }
});

test("ownership survives a server restart", async () => {
  const dbPath = tempDbPath();

  let child = startServer(dbPath);
  await waitForHealth();
  const createRes = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "Durable", name: "Ada", password: "team-pass" }),
  });
  const created = await createRes.json();
  const roomId = created.room.id;
  const ownerCookie = clientCookie(createRes);
  await stopServer(child);

  // Second boot: same DB. The creator's identity cookie must still own the room —
  // rename succeeds and the roster (empty after restart) does not matter.
  child = startServer(dbPath);
  await waitForHealth();
  try {
    const renameRes = await fetch(`${BASE}/api/rooms/${roomId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ name: "Still Mine" }),
    });
    assert.equal(renameRes.status, 200, "the owner still owns the room after a restart");
    assert.equal((await renameRes.json()).room.name, "Still Mine");

    // A different browser is still not the owner after the restart.
    const badRename = await fetch(`${BASE}/api/rooms/${roomId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope" }),
    });
    assert.equal(badRename.status, 403, "a non-owner still cannot rename after a restart");
  } finally {
    await stopServer(child);
  }
});

// --- Store layer ------------------------------------------------------------

function sampleRoom(overrides = {}) {
  return {
    id: "abcd",
    name: "Narwhal#1234",
    passwordSalt: "salt-value",
    passwordHash: "hash-value",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastJoinAt: "2026-01-01T00:00:00.000Z",
    voteHistory: [],
    ...overrides,
  };
}

test("owner_client_id round-trips through the store", () => {
  const store = createStore(tempDbPath("scrum-owner-store-"));
  store.saveRoom(sampleRoom({ ownerClientId: "client-xyz" }));
  const loaded = store.loadAllRooms();
  store.close();
  assert.equal(loaded[0].ownerClientId, "client-xyz");
});

test("a room saved without an owner loads as ownerless (null)", () => {
  const store = createStore(tempDbPath("scrum-owner-store-"));
  store.saveRoom(sampleRoom());
  const loaded = store.loadAllRooms();
  store.close();
  assert.equal(loaded[0].ownerClientId, null);
});

test("opening a pre-owner database migrates in the owner_client_id column", () => {
  const dbPath = tempDbPath("scrum-owner-migrate-");
  // Simulate an older database created before the owner column existed.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY, name TEXT, password_salt TEXT, password_hash TEXT,
      created_at TEXT, last_join_at TEXT, vote_history TEXT, participants TEXT, agenda TEXT
    )
  `);
  legacy.prepare("INSERT INTO rooms (id, name) VALUES (?, ?)").run("old1", "Legacy Room");
  legacy.close();

  const store = createStore(dbPath);
  const loaded = store.loadAllRooms();
  store.close();
  const room = loaded.find((r) => r.id === "old1");
  assert.equal(room.name, "Legacy Room", "the legacy room still loads");
  assert.equal(room.ownerClientId, null, "the migrated column defaults to null");
});

test("backfill assigns ownership to the earliest joiner from client history", () => {
  const store = createStore(tempDbPath("scrum-owner-backfill-"));
  store.saveRoom(sampleRoom({ id: "room1", ownerClientId: undefined }));
  // The creator joins first; a second browser joins later.
  store.recordHistory("creator-client", "room1", "Room One", "2026-01-01T00:00:00.000Z");
  store.recordHistory("later-client", "room1", "Room One", "2026-01-02T00:00:00.000Z");

  store.backfillRoomOwners();
  const loaded = store.loadAllRooms();
  store.close();
  assert.equal(loaded[0].ownerClientId, "creator-client", "earliest joiner becomes the owner");
});
