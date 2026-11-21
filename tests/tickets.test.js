const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { createStore } = require("../store");
const { applyTicketOp, snapshotTickets, emptyTickets, normalizeStoredTickets, MAX_OPEN_TICKETS } = require("../tickets");
const { buildExportRows } = require("../public/export");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.TICKETS_TEST_PORT || 3049);
const BASE = `http://127.0.0.1:${PORT}`;

// ---- Pure ticket logic ----------------------------------------------------

function fakeRoom() {
  return {
    mode: "scrum",
    revealed: false,
    revealedRoundId: null,
    voteHistory: [],
    tickets: emptyTickets(),
    votes: { a: null, b: null },
  };
}

function hooks() {
  let n = 0;
  return {
    createId: () => `t${++n}`,
    nowIso: () => "2026-11-11T10:00:00.000Z",
    resetRound: (room) => {
      room.revealed = false;
      room.revealedRoundId = null;
      room.votes = { a: null, b: null };
    },
  };
}

// Mimics the server's reveal: records the round in history and remembers it.
function reveal(room, id, votes) {
  room.revealed = true;
  room.revealedRoundId = id;
  room.voteHistory.unshift({ id, createdAt: "2026-11-11T10:00:00.000Z", votes });
}

const VOTES = [
  { participantId: "a", name: "Ada", value: "5" },
  { participantId: "b", name: "Lin", value: "8" },
  { participantId: "c", name: "Sam", value: null },
];

test("add validates and caps fields; title is required", () => {
  const room = fakeRoom();
  const h = hooks();
  assert.throws(() => applyTicketOp(room, { op: "add", ticket: { title: "   " } }, h), /title/);
  const ticket = applyTicketOp(room, {
    op: "add",
    ticket: { title: "x".repeat(500), link: "jira.example/ABC-1", description: "d".repeat(5000) },
  }, h);
  assert.equal(ticket.title.length, 200);
  assert.equal(ticket.link, "https://jira.example/ABC-1");
  assert.equal(ticket.description.length, 1000);
  assert.equal(room.tickets.open.length, 1);
});

test("open list is capped", () => {
  const room = fakeRoom();
  const h = hooks();
  for (let i = 0; i < MAX_OPEN_TICKETS; i++) applyTicketOp(room, { op: "add", ticket: { title: `T${i}` } }, h);
  assert.throws(() => applyTicketOp(room, { op: "add", ticket: { title: "one more" } }, h), /at most/);
});

test("select and unselect only mark tickets and leave the round alone", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  const two = applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  room.votes.a = "3";
  applyTicketOp(room, { op: "select", id: one.id }, h);
  assert.deepEqual(room.tickets.selectedIds, [one.id]);
  assert.equal(room.votes.a, "3", "votes kept when marking a ticket");

  reveal(room, "r1", VOTES);
  applyTicketOp(room, { op: "add", ticket: { title: "Three" } }, h);
  applyTicketOp(room, { op: "unselect", id: one.id }, h);
  assert.deepEqual(room.tickets.selectedIds, []);
  applyTicketOp(room, { op: "select", id: two.id }, h);
  assert.deepEqual(room.tickets.selectedIds, [two.id]);
  assert.equal(room.revealed, true, "revealed round survives marking and unmarking");
  assert.equal(room.voteHistory.length, 1);
  applyTicketOp(room, { op: "confirm", id: two.id }, h);
  assert.equal(room.tickets.done[0].id, two.id, "round confirms onto the ticket marked at the end");
  assert.equal(room.tickets.open.find((t) => t.id === one.id).title, "One", "unmarked ticket stays open");
});

test("two marked tickets are confirmed together with the same votes", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  const two = applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  const three = applyTicketOp(room, { op: "add", ticket: { title: "Three" } }, h);
  applyTicketOp(room, { op: "select", id: one.id }, h);
  applyTicketOp(room, { op: "select", id: two.id }, h);
  applyTicketOp(room, { op: "select", id: two.id }, h);
  assert.deepEqual(room.tickets.selectedIds, [one.id, two.id], "selecting twice does not duplicate");
  reveal(room, "r1", VOTES);
  assert.throws(() => applyTicketOp(room, { op: "confirm", id: three.id }, h), /being estimated/);
  applyTicketOp(room, { op: "confirm", id: two.id }, h);
  assert.deepEqual(room.tickets.done.map((t) => t.title).sort(), ["One", "Two"]);
  for (const t of room.tickets.done) {
    assert.equal(t.roundId, "r1");
    assert.deepEqual(t.votes, [{ name: "Ada", value: "5" }, { name: "Lin", value: "8" }]);
  }
  assert.deepEqual(room.tickets.open.map((t) => t.id), [three.id]);
  assert.deepEqual(room.tickets.selectedIds, []);
  assert.equal(room.voteHistory.length, 1, "the shared round stays in history once");
});

test("removing a marked ticket unmarks it", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  const two = applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  applyTicketOp(room, { op: "select", id: one.id }, h);
  applyTicketOp(room, { op: "select", id: two.id }, h);
  applyTicketOp(room, { op: "remove", id: one.id }, h);
  assert.deepEqual(room.tickets.selectedIds, [two.id]);
});

test("clear drops the revealed round and keeps the ticket selected", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  applyTicketOp(room, { op: "select", id: one.id }, h);
  reveal(room, "r1", VOTES);
  applyTicketOp(room, { op: "clear" }, h);
  assert.deepEqual(room.tickets.selectedIds, [one.id]);
  assert.equal(room.revealed, false);
  assert.deepEqual(room.voteHistory, []);
});

test("confirm needs a reveal, the selected ticket, and an unused round", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One", link: "https://x.test/1" } }, h);
  const two = applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  applyTicketOp(room, { op: "select", id: one.id }, h);
  assert.throws(() => applyTicketOp(room, { op: "confirm", id: one.id }, h), /Reveal/);
  reveal(room, "r1", VOTES);
  assert.throws(() => applyTicketOp(room, { op: "confirm", id: two.id }, h), /being estimated/);
  assert.equal(snapshotTickets(room).confirmableRoundId, "r1");

  applyTicketOp(room, { op: "confirm", id: one.id }, h);
  const done = room.tickets.done[0];
  assert.equal(done.title, "One");
  assert.equal(done.roundId, "r1");
  assert.deepEqual(done.votes, [{ name: "Ada", value: "5" }, { name: "Lin", value: "8" }]);
  assert.deepEqual(room.tickets.selectedIds, []);
  assert.equal(room.voteHistory.length, 1, "a confirmed round stays in history");
  assert.equal(snapshotTickets(room).confirmableRoundId, null);

  // The same round cannot go onto a second ticket.
  applyTicketOp(room, { op: "select", id: two.id }, h);
  room.revealed = true;
  room.revealedRoundId = "r1";
  assert.throws(() => applyTicketOp(room, { op: "confirm", id: two.id }, h), /already confirmed/);
});

test("re-estimate moves the ticket back, selects it, and drops its old round", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  applyTicketOp(room, { op: "select", id: one.id }, h);
  reveal(room, "r1", VOTES);
  applyTicketOp(room, { op: "confirm", id: one.id }, h);
  applyTicketOp(room, { op: "reestimate", id: one.id }, h);
  assert.equal(room.tickets.done.length, 0);
  assert.equal(room.tickets.open[0].id, one.id);
  assert.equal(room.tickets.open[0].votes, undefined);
  assert.deepEqual(room.tickets.selectedIds, [one.id]);
  assert.equal(room.revealed, false);
  assert.deepEqual(room.voteHistory, []);
});

test("remove takes only open tickets; round ops need scrum mode", () => {
  const room = fakeRoom();
  const h = hooks();
  const one = applyTicketOp(room, { op: "add", ticket: { title: "One" } }, h);
  applyTicketOp(room, { op: "remove", id: one.id }, h);
  assert.equal(room.tickets.open.length, 0);
  assert.throws(() => applyTicketOp(room, { op: "remove", id: one.id }, h), /not in the list/);
  const two = applyTicketOp(room, { op: "add", ticket: { title: "Two" } }, h);
  room.mode = "poker";
  assert.throws(() => applyTicketOp(room, { op: "select", id: two.id }, h), /Scrum Poker/);
  assert.throws(() => applyTicketOp(room, { op: "bogus" }, h), /Unknown/);
});

test("import lands only on an empty room and is sanitized", () => {
  const room = fakeRoom();
  const h = hooks();
  applyTicketOp(room, {
    op: "import",
    open: [{ title: "Old", link: "a.test", description: "d" }, { title: "" }],
    done: [{ title: "Done", votes: [{ name: "Ada", value: "3" }, { name: "X", value: null }], roundId: "zzz" }],
  }, h);
  assert.equal(room.tickets.open.length, 1);
  assert.equal(room.tickets.open[0].link, "https://a.test");
  assert.equal(room.tickets.done[0].roundId, null);
  assert.deepEqual(room.tickets.done[0].votes, [{ name: "Ada", value: "3" }]);
  assert.throws(() => applyTicketOp(room, { op: "import", open: [{ title: "Again" }] }, h), /already has/);
});

test("normalizeStoredTickets turns NULL or junk into the empty shape", () => {
  assert.deepEqual(normalizeStoredTickets(null), emptyTickets());
  assert.deepEqual(normalizeStoredTickets([1, 2]), emptyTickets());
  const fixed = normalizeStoredTickets({ open: [{ id: "a", title: "A" }], selectedId: "gone" });
  assert.deepEqual(fixed.selectedIds, []);
  const old = normalizeStoredTickets({ open: [{ id: "a", title: "A" }], selectedId: "a" });
  assert.deepEqual(old.selectedIds, ["a"], "a room saved with one selectedId keeps it");
});

test("export lists confirmed tickets once, not their round as well", () => {
  const history = [
    { id: "r1", createdAt: "2026-11-11T10:00:00.000Z", votes: [{ name: "Ada", value: "5" }] },
    { id: "r2", createdAt: "2026-11-11T11:00:00.000Z", votes: [{ name: "Ada", value: "2" }] },
  ];
  const tickets = {
    done: [{ id: "t1", title: "Login", link: "https://x.test/1", roundId: "r1", confirmedAt: "2026-11-11T10:01:00.000Z", votes: [{ name: "Ada", value: "5" }] }],
    usedRoundIds: ["r1"],
  };
  const rows = buildExportRows(history, [], { tzOffsetMin: 0, tickets });
  assert.deepEqual(rows, [
    { start: "10:01", end: "", title: "Login", url: "https://x.test/1", estimations: "Ada: 5" },
    { start: "11:00", end: "", title: "", url: "", estimations: "Ada: 2" },
  ]);
});

// ---- Storage migration ----------------------------------------------------

test("an older database without the tickets column migrates and loads empty", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scrum-tickets-mig-")), "rooms.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT, password_salt TEXT, password_hash TEXT,
    created_at TEXT, last_join_at TEXT, vote_history TEXT, participants TEXT, agenda TEXT,
    owner_client_id TEXT, teams TEXT)`);
  db.prepare("INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    "old1", "Old room", "s", "h", "2026-01-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "[]", "[]", "[]", null, "[]",
  );
  db.close();

  const store = createStore(dbPath);
  const loaded = store.loadAllRooms();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "Old room");
  assert.equal(loaded[0].tickets, null);
  assert.deepEqual(normalizeStoredTickets(loaded[0].tickets), emptyTickets());
  store.close();
});

// ---- Over HTTP: two players, restart --------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(dbPath) {
  return spawn("node", ["--experimental-sqlite", SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ROOM_CREATION_LIMIT: "50" },
    stdio: "ignore",
  });
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // not up yet
    }
    await delay(50);
  }
  throw new Error("server did not become healthy");
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

async function post(pathname, body, token) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("two players share tickets over HTTP and they survive a restart", async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scrum-tickets-http-")), "rooms.db");
  let child = startServer(dbPath);
  try {
    await waitForHealth();
    const created = await post("/api/rooms", { roomName: "Tickets", name: "Ada", password: "team-pass" });
    const roomId = created.data.room.id;
    const ada = created.data.participant;
    const joined = await post(`/api/rooms/${roomId}/join`, { name: "Lin", password: "team-pass" });
    const lin = joined.data.participant;
    const as = (who, action, body) => post(`/api/rooms/${roomId}/${action}`, { participantId: who.id, ...body }, who.token);

    // Bad token is refused like any other room action.
    assert.equal((await post(`/api/rooms/${roomId}/tickets`, { participantId: lin.id, op: "add", ticket: { title: "x" } }, "nope")).status, 401);

    const added = await as(ada, "tickets", { op: "add", ticket: { title: "Login page", link: "jira.test/A-1" } });
    assert.equal(added.status, 200);
    await as(lin, "tickets", { op: "add", ticket: { title: "Signup" } });
    const [login] = added.data.room.tickets.open;
    assert.equal(login.title, "Login page");

    // Lin (not the owner) may select, as with Reveal/Reset.
    let r = await as(lin, "tickets", { op: "select", id: login.id });
    assert.equal(r.status, 200);
    await as(ada, "vote", { value: "5" });
    await as(lin, "vote", { value: "8" });
    await as(ada, "reveal", {});
    r = await as(lin, "tickets", { op: "clear" });
    assert.equal(r.data.room.voteHistory.length, 0, "cleared round left history");
    assert.equal(r.data.room.revealed, false);

    await as(ada, "vote", { value: "3" });
    await as(lin, "vote", { value: "3" });
    r = await as(ada, "reveal", {});
    assert.ok(r.data.room.tickets.confirmableRoundId);
    r = await as(lin, "tickets", { op: "confirm", id: login.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.room.tickets.done[0].title, "Login page");
    assert.deepEqual(r.data.room.tickets.done[0].votes.map((v) => v.value).sort(), ["3", "3"]);

    // Lin's own view of the room carries the same tickets.
    const linView = (await as(lin, "tickets", { op: "add", ticket: { title: "Third" } })).data.room;
    assert.equal(linView.tickets.done.length, 1);
    assert.equal(linView.tickets.open.length, 2);

    await stopServer(child);
    child = startServer(dbPath);
    await waitForHealth();
    const back = await as(ada, "tickets", { op: "reestimate", id: login.id });
    assert.equal(back.status, 200);
    assert.equal(back.data.room.tickets.done.length, 0);
    assert.deepEqual(back.data.room.tickets.selectedIds, [login.id]);
    assert.equal(back.data.room.tickets.open.length, 3);
  } finally {
    await stopServer(child);
  }
});
