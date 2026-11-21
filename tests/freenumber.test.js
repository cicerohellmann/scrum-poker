const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.FREENUMBER_TEST_PORT || 3042);
const BASE = `http://127.0.0.1:${PORT}`;

let child;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrum-freenum-"));
  child = spawn("node", ["--experimental-sqlite", SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, "rooms.db"), ROOM_CREATION_LIMIT: "100" },
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
});

after(async () => {
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
});

async function newRoom() {
  const res = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "FreeNum", name: "Ada", password: "team-pass" }),
  });
  const data = await res.json();
  const { id } = data.room;
  const { id: participantId, token } = data.participant;
  const post = (action, payload) =>
    fetch(`${BASE}/api/rooms/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participantId, ...payload }),
    });
  return { id, post };
}

test("accepts a free non-negative integer vote and flows it into the summary", async () => {
  const { post } = await newRoom();

  assert.equal((await post("vote", { value: "42" })).status, 200, "free integer 42 should be accepted");
  assert.equal((await post("reveal", {})).status, 200);
  const resetBody = await (await post("reset", {})).json();

  assert.equal(resetBody.room.voteHistory[0].summary.average, 42, "free number should drive the average");
});

test("rejects non-integer, negative, and out-of-range free votes", async () => {
  const { post } = await newRoom();

  assert.equal((await post("vote", { value: "100001" })).status, 400, "above the cap should be rejected");
  assert.equal((await post("vote", { value: "4.5" })).status, 400, "decimals should be rejected");
  assert.equal((await post("vote", { value: "-3" })).status, 400, "negatives should be rejected");
  assert.equal((await post("vote", { value: "abc" })).status, 400, "non-numbers should be rejected");
});

test("still accepts the Fibonacci voting scale", async () => {
  const { post } = await newRoom();

  assert.equal((await post("vote", { value: "8" })).status, 200);
  assert.equal((await post("vote", { value: "?" })).status, 200);
  assert.equal((await post("vote", { value: "pass" })).status, 200);
});

test("accepts the cap boundary 100000", async () => {
  const { post } = await newRoom();

  assert.equal((await post("vote", { value: "100000" })).status, 200, "the cap value itself should be accepted");
});
