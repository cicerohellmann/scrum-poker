const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

// Persistence layer for rooms. Keeps only durable fields on disk; runtime state
// (participants, live connections, poker hand) is rebuilt empty on load.
function createStore(dbPath) {
  const dir = path.dirname(dbPath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id            TEXT PRIMARY KEY,
      name          TEXT,
      password_salt TEXT,
      password_hash TEXT,
      created_at    TEXT,
      last_join_at  TEXT,
      vote_history  TEXT,
      participants  TEXT,
      agenda        TEXT,
      owner_client_id TEXT,
      teams         TEXT,
      tickets       TEXT
    )
  `);

  // Per-browser history of every room a client id has ever joined. Keyed by the
  // identity cookie, it outlives the participant record so it can surface rooms
  // the browser has left or that have expired.
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_history (
      client_id        TEXT,
      room_id          TEXT,
      room_name        TEXT,
      first_joined_at  TEXT,
      last_joined_at   TEXT,
      PRIMARY KEY (client_id, room_id)
    )
  `);

  // Migrate older databases that predate later columns. New rows from CREATE
  // TABLE already have them; existing rooms get them added as NULL.
  const columns = db.prepare("PRAGMA table_info(rooms)").all().map((row) => row.name);
  if (!columns.includes("participants")) {
    db.exec("ALTER TABLE rooms ADD COLUMN participants TEXT");
  }
  if (!columns.includes("agenda")) {
    db.exec("ALTER TABLE rooms ADD COLUMN agenda TEXT");
  }
  if (!columns.includes("owner_client_id")) {
    db.exec("ALTER TABLE rooms ADD COLUMN owner_client_id TEXT");
  }
  if (!columns.includes("teams")) {
    db.exec("ALTER TABLE rooms ADD COLUMN teams TEXT");
  }
  if (!columns.includes("tickets")) {
    db.exec("ALTER TABLE rooms ADD COLUMN tickets TEXT");
  }

  const upsert = db.prepare(`
    INSERT INTO rooms (id, name, password_salt, password_hash, created_at, last_join_at, vote_history, participants, agenda, owner_client_id, teams, tickets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      password_salt = excluded.password_salt,
      password_hash = excluded.password_hash,
      created_at = excluded.created_at,
      last_join_at = excluded.last_join_at,
      vote_history = excluded.vote_history,
      participants = excluded.participants,
      agenda = excluded.agenda,
      owner_client_id = excluded.owner_client_id,
      teams = excluded.teams,
      tickets = excluded.tickets
  `);
  const selectAll = db.prepare("SELECT * FROM rooms");
  // One-time reconciliation for rooms that predate room-level ownership: adopt the
  // earliest recorded joiner (the creator, whose join is stamped at creation) as
  // the owner. Rooms whose history has been pruned stay ownerless (NULL).
  const backfillOwners = db.prepare(`
    UPDATE rooms SET owner_client_id = (
      SELECT ch.client_id FROM client_history ch
      WHERE ch.room_id = rooms.id
      ORDER BY ch.first_joined_at ASC
      LIMIT 1
    )
    WHERE owner_client_id IS NULL
  `);
  const updateLastJoin = db.prepare("UPDATE rooms SET last_join_at = ? WHERE id = ?");
  const removeOne = db.prepare("DELETE FROM rooms WHERE id = ?");
  const selectOlder = db.prepare("SELECT id FROM rooms WHERE last_join_at < ?");
  const removeOlder = db.prepare("DELETE FROM rooms WHERE last_join_at < ?");

  const upsertHistory = db.prepare(`
    INSERT INTO client_history (client_id, room_id, room_name, first_joined_at, last_joined_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(client_id, room_id) DO UPDATE SET
      room_name = excluded.room_name,
      last_joined_at = excluded.last_joined_at
  `);
  const selectHistory = db.prepare(
    "SELECT * FROM client_history WHERE client_id = ? ORDER BY last_joined_at DESC",
  );
  const removeHistoryOne = db.prepare(
    "DELETE FROM client_history WHERE client_id = ? AND room_id = ?",
  );
  const removeHistoryOlder = db.prepare("DELETE FROM client_history WHERE last_joined_at < ?");

  function saveRoom(room) {
    upsert.run(
      room.id,
      room.name,
      room.passwordSalt,
      room.passwordHash,
      room.createdAt,
      room.lastJoinAt,
      JSON.stringify(room.voteHistory ?? []),
      JSON.stringify(serializeParticipants(room.participants)),
      JSON.stringify(room.agenda ?? []),
      room.ownerClientId ?? null,
      JSON.stringify(room.teams ?? []),
      room.tickets ? JSON.stringify(room.tickets) : null,
    );
  }

  function loadAllRooms() {
    return selectAll.all().map((row) => ({
      id: row.id,
      name: row.name,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      lastJoinAt: row.last_join_at,
      voteHistory: parseHistory(row.vote_history),
      participants: parseParticipants(row.participants),
      agenda: parseHistory(row.agenda),
      ownerClientId: row.owner_client_id ?? null,
      teams: parseHistory(row.teams),
      tickets: parseObject(row.tickets),
    }));
  }

  // Assign ownership to pre-ownership rooms from their earliest recorded joiner.
  function backfillRoomOwners() {
    backfillOwners.run();
  }

  function touchLastJoin(id, iso) {
    updateLastJoin.run(iso, id);
  }

  function deleteRoom(id) {
    removeOne.run(id);
  }

  function deleteRoomsOlderThan(cutoffIso) {
    const removed = selectOlder.all(cutoffIso).map((row) => row.id);
    removeOlder.run(cutoffIso);
    return removed;
  }

  // Upsert a join into the per-browser history. First join records first=last;
  // a later join to the same room updates last_joined_at and room_name only,
  // preserving the original first_joined_at.
  function recordHistory(clientId, roomId, roomName, iso) {
    upsertHistory.run(clientId, roomId, roomName, iso, iso);
  }

  function historyForClient(clientId) {
    return selectHistory.all(clientId).map((row) => ({
      roomId: row.room_id,
      roomName: row.room_name,
      firstJoinedAt: row.first_joined_at,
      lastJoinedAt: row.last_joined_at,
    }));
  }

  function clearHistory(clientId, roomId) {
    removeHistoryOne.run(clientId, roomId);
  }

  function deleteHistoryOlderThan(cutoffIso) {
    removeHistoryOlder.run(cutoffIso);
  }

  function close() {
    db.close();
  }

  return {
    saveRoom,
    loadAllRooms,
    backfillRoomOwners,
    touchLastJoin,
    deleteRoom,
    deleteRoomsOlderThan,
    recordHistory,
    historyForClient,
    clearHistory,
    deleteHistoryOlderThan,
    close,
  };
}

function parseObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseHistory(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Persist only the minimal stable identity of each participant — never live
// state (votes, credits, connections, poker hand). Accepts either a Map (live
// room) or an array (already-serialized record).
function serializeParticipants(participants) {
  const values = participants instanceof Map
    ? Array.from(participants.values())
    : Array.isArray(participants)
      ? participants
      : [];
  return values.map((participant) => ({
    id: participant.id,
    name: participant.name,
    tokenHash: participant.tokenHash,
    isHost: Boolean(participant.isHost),
    joinedAt: participant.joinedAt,
    // Stable identity for cookie-based reattach and the per-session window.
    // Omitted (undefined → stripped by JSON) for legacy rows that predate them.
    clientId: participant.clientId,
    discriminator: participant.discriminator,
    lastSeen: participant.lastSeen,
    // Team affiliation the player picked (id into room.teams), or null.
    team: participant.team ?? null,
  }));
}

function parseParticipants(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && entry.id && entry.tokenHash);
  } catch {
    return [];
  }
}

module.exports = { createStore };
