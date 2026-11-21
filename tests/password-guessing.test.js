const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "server.js");
const PORT = Number(process.env.GUESS_TEST_PORT || 3058);
const BASE = `http://127.0.0.1:${PORT}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrum-guess-"));
  const child = spawn("node", ["--experimental-sqlite", SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(dir, "rooms.db"), ROOM_CREATION_LIMIT: "50", ...extraEnv },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return child; } catch {}
    await delay(50);
  }
  throw new Error("server did not start");
}
const stop = (child) => new Promise((r) => { child.once("exit", r); child.kill("SIGTERM"); });

const post = (url, body, ip) => fetch(`${BASE}${url}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
  body: JSON.stringify(body),
});
const join = (roomId, password, ip) => post(`/api/rooms/${roomId}/join`, { name: "Eve", password }, ip);

async function makeRoom() {
  const res = await post("/api/rooms", { roomName: "R", name: "Ada", password: "right-pass" }, "10.0.0.1");
  assert.equal(res.status, 201);
  return (await res.json()).room.id;
}

test("unlimited wrong guesses from one IP are refused after 5 tries, even the right password", async () => {
  const child = await start({ PASSWORD_LOCK_BASE_MS: "400" });
  try {
    const roomId = await makeRoom();
    for (let i = 0; i < 5; i++) {
      assert.equal((await join(roomId, `bad-${i}`, "9.9.9.9")).status, 403);
    }
    const blocked = await join(roomId, "right-pass", "9.9.9.9");
    assert.equal(blocked.status, 429, "6th attempt must be rate limited");
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

    // A different IP is not locked out by one guesser (room limit is higher).
    assert.equal((await join(roomId, "right-pass", "8.8.8.8")).status, 201);

    // The lock is short: after the wait the right password works again.
    await delay(1300);
    assert.equal((await join(roomId, "right-pass", "9.9.9.9")).status, 201);
  } finally { await stop(child); }
});

test("many IPs guessing one room are limited per room", async () => {
  const child = await start();
  try {
    const roomId = await makeRoom();
    let limited = false;
    for (let i = 0; i < 60 && !limited; i++) {
      const res = await join(roomId, `bad-${i}`, `7.7.${Math.floor(i / 200)}.${i % 200}`);
      if (res.status === 429) limited = true;
    }
    assert.ok(limited, "room must lock after many wrong guesses across IPs");
  } finally { await stop(child); }
});
