// Seed a "player" room for the room-ownership demo.
//
// Ownership is keyed on the browser's identity cookie, so a room where YOU are a
// plain player is simply a room owned by someone else. This script posts to the
// running server without any cookie, so the server mints a fresh owner identity
// for the room — different from your browser. You then join it from the UI and
// see no edit control. (Create your own room from the UI to be the owner there.)
//
// Usage: start the app (npm start), then: npm run seed:demo

const BASE = process.env.SEED_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const ROOM_NAME = process.env.SEED_ROOM_NAME || "Demo — you are a player";
const PASSWORD = process.env.SEED_ROOM_PASSWORD || "demo-pass";

async function main() {
  let res;
  try {
    res = await fetch(`${BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName: ROOM_NAME, name: "Demo Owner", password: PASSWORD }),
    });
  } catch (error) {
    console.error(`Could not reach the server at ${BASE}.`);
    console.error("Start it first with `npm start`, then re-run `npm run seed:demo`.");
    console.error(`(${error.message})`);
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`Server rejected the seed request (${res.status}): ${body.error || "unknown error"}`);
    process.exit(1);
  }

  const { room } = await res.json();
  const url = `${BASE}/r/${room.id}`;

  console.log("");
  console.log("Seeded a room owned by someone else (your player room):");
  console.log(`  Name:     ${room.name}`);
  console.log(`  Room ID:  ${room.id}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  URL:      ${url}`);
  console.log("");
  console.log("Demo steps:");
  console.log(`  1. Owner room:  open ${BASE}/ and create a room — you'll see the ✎ Edit control.`);
  console.log(`  2. Player room: open ${url}, join with the password above — no Edit control.`);
  console.log("");
}

main();
