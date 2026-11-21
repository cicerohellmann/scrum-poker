const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStore } = require("../store");

function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrum-store-"));
  return path.join(dir, "rooms.db");
}

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

test("saveRoom then loadAllRooms round-trips the durable fields", () => {
  const store = createStore(tempDbPath());
  const room = sampleRoom();
  store.saveRoom(room);

  const loaded = store.loadAllRooms();
  store.close();

  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], {
    id: "abcd",
    name: "Narwhal#1234",
    passwordSalt: "salt-value",
    passwordHash: "hash-value",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastJoinAt: "2026-01-01T00:00:00.000Z",
    voteHistory: [],
    participants: [],
    agenda: [],
    ownerClientId: null,
    teams: [],
    tickets: null,
  });
});

test("minimal participant identity round-trips, dropping live state", () => {
  const store = createStore(tempDbPath());
  const participants = new Map([
    ["host1", {
      id: "host1", name: "Ada", tokenHash: "hash-a", isHost: true, joinedAt: "2026-01-01T00:00:00.000Z",
      // Live state that must NOT be persisted:
      vote: "5", credits: 999, online: true, connectionCount: 3,
    }],
    ["p2", {
      id: "p2", name: "Lin", tokenHash: "hash-b", isHost: false, joinedAt: "2026-01-01T00:01:00.000Z",
      vote: "8", credits: 100, online: true, connectionCount: 1,
    }],
  ]);
  store.saveRoom(sampleRoom({ participants }));

  const loaded = store.loadAllRooms();
  store.close();

  assert.deepEqual(loaded[0].participants, [
    { id: "host1", name: "Ada", tokenHash: "hash-a", isHost: true, joinedAt: "2026-01-01T00:00:00.000Z", team: null },
    { id: "p2", name: "Lin", tokenHash: "hash-b", isHost: false, joinedAt: "2026-01-01T00:01:00.000Z", team: null },
  ]);
});

test("participant identity round-trips clientId, discriminator, and lastSeen", () => {
  const store = createStore(tempDbPath());
  const participants = new Map([
    ["p1", {
      id: "p1", name: "Plop", tokenHash: "hash-a", isHost: false,
      joinedAt: "2026-01-01T00:00:00.000Z",
      clientId: "client-xyz", discriminator: "1234", lastSeen: "2026-01-02T00:00:00.000Z",
      // Live state that must NOT persist:
      vote: "5", credits: 50, online: true, connectionCount: 2,
    }],
  ]);
  store.saveRoom(sampleRoom({ participants }));

  const loaded = store.loadAllRooms();
  store.close();

  assert.deepEqual(loaded[0].participants, [
    {
      id: "p1", name: "Plop", tokenHash: "hash-a", isHost: false,
      joinedAt: "2026-01-01T00:00:00.000Z",
      clientId: "client-xyz", discriminator: "1234", lastSeen: "2026-01-02T00:00:00.000Z",
      team: null,
    },
  ]);
});

test("rooms saved before the participants column load as an empty roster", () => {
  const { DatabaseSync } = require("node:sqlite");
  const dbPath = tempDbPath();

  // Simulate a legacy DB: the pre-participants schema with one room row.
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE rooms (
      id TEXT PRIMARY KEY, name TEXT, password_salt TEXT, password_hash TEXT,
      created_at TEXT, last_join_at TEXT, vote_history TEXT
    )
  `);
  legacy.prepare(
    "INSERT INTO rooms (id, name, password_salt, password_hash, created_at, last_join_at, vote_history) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("old", "Legacy", "s", "h", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "[]");
  legacy.close();

  // Opening through the store migrates the column in place.
  const store = createStore(dbPath);
  const loaded = store.loadAllRooms();
  store.close();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "old");
  assert.deepEqual(loaded[0].participants, []);
});

test("vote history survives as structured data", () => {
  const store = createStore(tempDbPath());
  const history = [
    { round: 1, revealedAt: "2026-01-02T10:00:00.000Z", votes: { Ada: "5", Lin: "8" } },
    { round: 2, revealedAt: "2026-01-02T10:05:00.000Z", votes: { Ada: "3" } },
  ];
  store.saveRoom(sampleRoom({ voteHistory: history }));

  const loaded = store.loadAllRooms();
  store.close();

  assert.deepEqual(loaded[0].voteHistory, history);
});

test("data persists across a store reopen (simulated restart)", () => {
  const dbPath = tempDbPath();
  const first = createStore(dbPath);
  first.saveRoom(sampleRoom({ id: "keep", voteHistory: [{ round: 1 }] }));
  first.close();

  const second = createStore(dbPath);
  const loaded = second.loadAllRooms();
  second.close();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "keep");
  assert.deepEqual(loaded[0].voteHistory, [{ round: 1 }]);
});

test("saveRoom upserts instead of duplicating by id", () => {
  const store = createStore(tempDbPath());
  store.saveRoom(sampleRoom({ name: "Old Name" }));
  store.saveRoom(sampleRoom({ name: "New Name" }));

  const loaded = store.loadAllRooms();
  store.close();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "New Name");
});

test("touchLastJoin updates only the retention timestamp", () => {
  const store = createStore(tempDbPath());
  store.saveRoom(sampleRoom({ lastJoinAt: "2026-01-01T00:00:00.000Z" }));

  store.touchLastJoin("abcd", "2026-03-01T12:00:00.000Z");

  const loaded = store.loadAllRooms();
  store.close();

  assert.equal(loaded[0].lastJoinAt, "2026-03-01T12:00:00.000Z");
  assert.equal(loaded[0].createdAt, "2026-01-01T00:00:00.000Z");
});

test("deleteRoom removes the row", () => {
  const store = createStore(tempDbPath());
  store.saveRoom(sampleRoom({ id: "gone" }));
  store.saveRoom(sampleRoom({ id: "stay" }));

  store.deleteRoom("gone");

  const ids = store.loadAllRooms().map((r) => r.id);
  store.close();

  assert.deepEqual(ids, ["stay"]);
});

test("saveRoom persists the agenda and it survives a reopen", () => {
  const dbPath = tempDbPath();
  const agenda = [
    { id: "n1", startMin: 540, endMin: 555, title: "Standup", url: "" },
    { id: "n2", startMin: 870, endMin: 930, title: "PROJ-1421", url: "https://jira/browse/PROJ-1421" },
  ];

  const first = createStore(dbPath);
  first.saveRoom(sampleRoom({ agenda }));
  first.close();

  const second = createStore(dbPath);
  const loaded = second.loadAllRooms();
  second.close();

  assert.deepEqual(loaded[0].agenda, agenda);
});

test("a room with no agenda loads as an empty array", () => {
  const store = createStore(tempDbPath());
  store.saveRoom(sampleRoom());
  const loaded = store.loadAllRooms();
  store.close();
  assert.deepEqual(loaded[0].agenda, []);
});

test("client history records joins per browser, upserts last-joined, and lists newest first", () => {
  const store = createStore(tempDbPath());
  store.recordHistory("clientA", "room1", "Sprint 42", "2026-06-01T00:00:00.000Z");
  store.recordHistory("clientA", "room2", "Bugfix", "2026-06-02T00:00:00.000Z");
  // Re-joining room1 later updates its last-joined and name, not a duplicate row.
  store.recordHistory("clientA", "room1", "Sprint 42 Planning", "2026-06-03T00:00:00.000Z");
  store.recordHistory("clientB", "room1", "Sprint 42", "2026-06-01T00:00:00.000Z");

  const history = store.historyForClient("clientA");
  store.close();

  assert.equal(history.length, 2); // clientB's row is not returned
  assert.deepEqual(history.map((h) => h.roomId), ["room1", "room2"]); // newest last-join first
  assert.equal(history[0].roomName, "Sprint 42 Planning"); // name updated on re-join
  assert.equal(history[0].firstJoinedAt, "2026-06-01T00:00:00.000Z"); // first preserved
  assert.equal(history[0].lastJoinedAt, "2026-06-03T00:00:00.000Z");
});

test("clearHistory removes a single browser+room entry", () => {
  const store = createStore(tempDbPath());
  store.recordHistory("clientA", "room1", "One", "2026-06-01T00:00:00.000Z");
  store.recordHistory("clientA", "room2", "Two", "2026-06-02T00:00:00.000Z");

  store.clearHistory("clientA", "room1");

  const ids = store.historyForClient("clientA").map((h) => h.roomId);
  store.close();
  assert.deepEqual(ids, ["room2"]);
});

test("deleteHistoryOlderThan prunes stale history entries", () => {
  const store = createStore(tempDbPath());
  store.recordHistory("clientA", "old", "Old", "2026-01-01T00:00:00.000Z");
  store.recordHistory("clientA", "fresh", "Fresh", "2026-06-01T00:00:00.000Z");

  store.deleteHistoryOlderThan("2026-03-01T00:00:00.000Z");

  const ids = store.historyForClient("clientA").map((h) => h.roomId);
  store.close();
  assert.deepEqual(ids, ["fresh"]);
});

test("client history survives a store reopen", () => {
  const dbPath = tempDbPath();
  const first = createStore(dbPath);
  first.recordHistory("clientA", "room1", "Kept", "2026-06-01T00:00:00.000Z");
  first.close();

  const second = createStore(dbPath);
  const history = second.historyForClient("clientA");
  second.close();
  assert.equal(history.length, 1);
  assert.equal(history[0].roomName, "Kept");
});

test("deleteRoomsOlderThan removes only rooms past the cutoff and reports them", () => {
  const store = createStore(tempDbPath());
  store.saveRoom(sampleRoom({ id: "stale", lastJoinAt: "2026-01-01T00:00:00.000Z" }));
  store.saveRoom(sampleRoom({ id: "fresh", lastJoinAt: "2026-06-01T00:00:00.000Z" }));

  const removed = store.deleteRoomsOlderThan("2026-03-01T00:00:00.000Z");

  const ids = store.loadAllRooms().map((r) => r.id);
  store.close();

  assert.deepEqual(removed, ["stale"]);
  assert.deepEqual(ids, ["fresh"]);
});
