const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.AGENDA_TEST_PORT || 3043);
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let dbPath;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  child = spawn("node", ["--experimental-sqlite", SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, ROOM_CREATION_LIMIT: "100" },
    stdio: "ignore",
  });
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

function stopServer() {
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
}

before(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scrum-agenda-")), "rooms.db");
  await startServer();
});

after(() => stopServer());

async function newRoom() {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "Agenda", name: "Ada", password: "team-pass" }),
  });
  const data = await res.json();
  const post = (body) =>
    fetch(`${BASE}/api/rooms/${data.room.id}/agenda`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.participant.token}` },
      body: JSON.stringify({ participantId: data.participant.id, ...body }),
    });
  return { id: data.room.id, post };
}

test("upsert adds and updates a note by id; delete removes it; everyone sees it", async () => {
  const room = await newRoom();

  let res = await room.post({ op: "upsert", entry: { id: "n1", startMin: 540, endMin: 555, title: "Standup", url: "" } });
  assert.equal(res.status, 200);
  let agenda = (await res.json()).room.agenda;
  // Entries now carry a `day` stamp; one sent without it persists as null.
  assert.deepEqual(agenda, [{ id: "n1", startMin: 540, endMin: 555, title: "Standup", url: "", day: null }]);

  // Updating the same id replaces it (no duplicate).
  res = await room.post({ op: "upsert", entry: { id: "n1", startMin: 600, endMin: 615, title: "Standup", url: "" } });
  agenda = (await res.json()).room.agenda;
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].startMin, 600);

  // A second note is added.
  res = await room.post({ op: "upsert", entry: { id: "n2", startMin: 870, endMin: 930, title: "PROJ-1", url: "https://jira/x" } });
  agenda = (await res.json()).room.agenda;
  assert.equal(agenda.length, 2);

  // Delete by id.
  res = await room.post({ op: "delete", id: "n1" });
  agenda = (await res.json()).room.agenda;
  assert.deepEqual(agenda.map((e) => e.id), ["n2"]);
});

test("agenda survives a server restart", async () => {
  const room = await newRoom();
  await room.post({ op: "upsert", entry: { id: "keep", startMin: 120, endMin: 150, title: "Persisted", url: "" } });

  await stopServer();
  await startServer();

  const rejoin = await fetch(`${BASE}/api/rooms/${room.id}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bo", password: "team-pass" }),
  });
  const agenda = (await rejoin.json()).room.agenda;
  assert.deepEqual(agenda.map((e) => e.id), ["keep"]);
});
