const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { createStore } = require("./store");
const { TicketError, emptyTickets, normalizeStoredTickets, applyTicketOp, snapshotTickets } = require("./tickets");
const { CLIENT_COOKIE, parseCookies, makeDiscriminator, buildClientCookie, staleParticipantIds } = require("./identity");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 15 * 1000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "scrum-poker.db");
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 84);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PARTICIPANT_RETENTION_DAYS = Number(process.env.PARTICIPANT_RETENTION_DAYS || 14);
const PARTICIPANT_RETENTION_MS = PARTICIPANT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CLIENT_COOKIE_MAX_AGE = PARTICIPANT_RETENTION_DAYS * 24 * 60 * 60;
const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS || 84);
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_VOTE_HISTORY = Number(process.env.MAX_VOTE_HISTORY || 200);
const HEARTBEAT_MS = 20 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ACTIVE_ROOMS = Number(process.env.MAX_ACTIVE_ROOMS || 50);
const MAX_PARTICIPANTS_PER_ROOM = Number(process.env.MAX_PARTICIPANTS_PER_ROOM || 40);
const ROOM_CREATION_LIMIT = Number(process.env.ROOM_CREATION_LIMIT || 5);
const ROOM_CREATION_WINDOW_MS = Number(process.env.ROOM_CREATION_WINDOW_MS || 10 * 60 * 1000);
const VOTING_SCALE = ["0", "1", "2", "3", "5", "8", "13", "21", "?", "pass"];
const MAX_FREE_VOTE = 100000;
const MAX_TEAMS_PER_ROOM = 8;
const MAX_TEAM_NAME = 24;

// A vote is valid if it is one of the standard deck values, or a free-number
// estimate: a non-negative integer from 0 to MAX_FREE_VOTE.
function isAcceptableVote(vote) {
  if (VOTING_SCALE.includes(vote)) return true;
  return /^\d+$/.test(vote) && Number(vote) <= MAX_FREE_VOTE;
}
const POKER_STARTING_CREDITS = 100;
const POKER_SMALL_BLIND = 1;
const POKER_BIG_BLIND = 2;
const POKER_STEP = 5;
const POKER_SUITS = ["s", "h", "d", "c"];
const POKER_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const POKER_RANK_VALUES = new Map(POKER_RANKS.map((rank, index) => [rank, index + 2]));
const POKER_HAND_LABELS = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];
const ROOM_ANIMALS = [
  "Axolotl",
  "Badger",
  "Falcon",
  "Gecko",
  "Lynx",
  "Mantis",
  "Narwhal",
  "Octopus",
  "Pangolin",
  "Raven",
  "Tarantula",
  "Wombat",
];

const rooms = new Map();
const roomCreationAttempts = new Map();
const store = createStore(DB_PATH);

// Mirror a room's durable fields to disk. This includes minimal participant
// identity (id/name/tokenHash/isHost/joinedAt) so saved sessions re-authenticate
// after a restart; live state (votes, credits, connections, poker hand) is not.
function persistRoom(room) {
  store.saveRoom(room);
}

// Any successful join resets the retention window for the room.
function markRoomJoined(room) {
  room.lastJoinAt = nowIso();
  store.touchLastJoin(room.id, room.lastJoinAt);
}

// Log this browser's join into its per-cookie history. Outlives the participant
// record, so it can show rooms the browser later leaves or that expire.
function recordJoinHistory(clientId, room) {
  if (!clientId) return;
  store.recordHistory(clientId, room.id, room.name, nowIso());
}

// Rebuild an in-memory room from a stored record. Participant identities are
// restored present-but-offline (id/name/tokenHash/isHost) so a saved session can
// re-authenticate after a restart; all live state (votes, credits, connections,
// poker hand) is reset fresh.
function hydrateRoom(record) {
  const participants = new Map();
  const takenDisc = new Set(
    (Array.isArray(record.participants) ? record.participants : [])
      .map((saved) => saved.discriminator)
      .filter(Boolean),
  );
  for (const saved of Array.isArray(record.participants) ? record.participants : []) {
    // Legacy rows predate clientId/discriminator; give them a stable suffix now.
    const discriminator = saved.discriminator || makeDiscriminator(takenDisc);
    takenDisc.add(discriminator);
    participants.set(saved.id, {
      id: saved.id,
      name: saved.name,
      discriminator,
      clientId: saved.clientId || null,
      tokenHash: saved.tokenHash,
      isHost: Boolean(saved.isHost),
      vote: null,
      credits: POKER_STARTING_CREDITS,
      online: false,
      connectionCount: 0,
      joinedAt: saved.joinedAt || nowIso(),
      lastSeen: saved.lastSeen || saved.joinedAt || nowIso(),
      team: saved.team ?? null,
    });
  }

  return {
    id: record.id,
    name: record.name,
    ownerClientId: record.ownerClientId || null,
    createdAt: record.createdAt,
    updatedAt: nowIso(),
    emptySince: nowIso(),
    lastJoinAt: record.lastJoinAt,
    revealed: false,
    passwordSalt: record.passwordSalt,
    passwordHash: record.passwordHash,
    mode: "scrum",
    idleStackTaps: 0,
    voteHistory: Array.isArray(record.voteHistory) ? record.voteHistory : [],
    agenda: Array.isArray(record.agenda) ? record.agenda : [],
    teams: Array.isArray(record.teams) ? record.teams : [],
    tickets: normalizeStoredTickets(record.tickets),
    revealedRoundId: null,
    poker: null,
    participants,
    clients: new Set(),
  };
}

// Load persisted rooms at boot, pruning any past the retention window first.
function loadRoomsFromStore() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  store.deleteRoomsOlderThan(cutoff);
  // Adopt owners for rooms created before room-level ownership existed, using the
  // earliest recorded joiner. Runs once per boot; a no-op after everything owns.
  store.backfillRoomOwners();
  for (const record of store.loadAllRooms()) {
    rooms.set(record.id, hydrateRoom(record));
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(bytes = 6) {
  return crypto.randomBytes(bytes).toString("base64url").toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt).hash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cleanText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

// Sanitize an owner-submitted team list into the stored shape:
// [{ id, name, color }]. Ids are kept if valid (so existing picks stay attached)
// or minted; names are cleaned; colors must be #rrggbb; the list is capped and
// blank-named rows are dropped.
function normalizeTeams(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const teams = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const name = cleanText(raw.name, "", MAX_TEAM_NAME);
    if (!name) continue;
    const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color.trim())
      ? raw.color.trim().toLowerCase()
      : "#6b7a90";
    let id = typeof raw.id === "string" && /^[a-z0-9_-]{1,16}$/.test(raw.id) ? raw.id : createId(4);
    while (seenIds.has(id)) id = createId(4);
    seenIds.add(id);
    // A hidden team's members don't sit on the table and don't count toward voters.
    teams.push({ id, name, color, hidden: raw.hidden === true });
    if (teams.length >= MAX_TEAMS_PER_ROOM) break;
  }
  return teams;
}

function randomRoomName() {
  const animal = ROOM_ANIMALS[crypto.randomInt(ROOM_ANIMALS.length)];
  return `${animal}#${crypto.randomInt(1000, 10000)}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  const cfConnectingIp = req.headers["cf-connecting-ip"];
  if (typeof cfConnectingIp === "string" && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function isSecureRequest(req) {
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim() === "https") return true;
  return Boolean(req.socket && req.socket.encrypted);
}

// Ensure the browser has a stable client-identity cookie, refreshing its expiry
// (sliding window) on every authenticated request. Returns the client id.
function ensureClientId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const clientId = cookies[CLIENT_COOKIE] || createId(24);
  res.setHeader("Set-Cookie", buildClientCookie(clientId, CLIENT_COOKIE_MAX_AGE, { secure: isSecureRequest(req) }));
  return clientId;
}

function canCreateRoom(req) {
  const ip = getClientIp(req);
  const cutoff = Date.now() - ROOM_CREATION_WINDOW_MS;
  const attempts = (roomCreationAttempts.get(ip) || []).filter((timestamp) => timestamp > cutoff);

  roomCreationAttempts.set(ip, attempts);
  return attempts.length < ROOM_CREATION_LIMIT;
}

function recordRoomCreation(req) {
  const ip = getClientIp(req);
  const attempts = roomCreationAttempts.get(ip) || [];
  attempts.push(Date.now());
  roomCreationAttempts.set(ip, attempts);
}

// --- Password-guess throttle (in-process) ----------------------------------
// 5 wrong tries per IP (20 per room, so one guesser cannot lock a room for
// everyone for long), then a wait that doubles per extra failure, capped.
// Counters forget after a quiet hour; a correct password clears the IP's count.
const PASSWORD_IP_FREE_TRIES = 5;
const PASSWORD_ROOM_FREE_TRIES = 20;
const PASSWORD_LOCK_BASE_MS = Number(process.env.PASSWORD_LOCK_BASE_MS || 30 * 1000);
const PASSWORD_LOCK_MAX_MS = Number(process.env.PASSWORD_LOCK_MAX_MS || 10 * 60 * 1000);
const PASSWORD_FORGET_MS = 60 * 60 * 1000;
const passwordFailures = new Map(); // key -> { count, lockedUntil, last }

function passwordKeys(req, room) {
  return [
    { key: `ip:${room.id}:${getClientIp(req)}`, free: PASSWORD_IP_FREE_TRIES },
    { key: `room:${room.id}`, free: PASSWORD_ROOM_FREE_TRIES },
  ];
}

function passwordLockWaitMs(req, room) {
  const now = Date.now();
  let wait = 0;
  for (const { key } of passwordKeys(req, room)) {
    const entry = passwordFailures.get(key);
    if (entry && now - entry.last > PASSWORD_FORGET_MS) {
      passwordFailures.delete(key);
    } else if (entry && entry.lockedUntil > now) {
      wait = Math.max(wait, entry.lockedUntil - now);
    }
  }
  return wait;
}

function recordPasswordFailure(req, room) {
  const now = Date.now();
  for (const { key, free } of passwordKeys(req, room)) {
    const entry = passwordFailures.get(key) || { count: 0, lockedUntil: 0, last: now };
    entry.count += 1;
    entry.last = now;
    if (entry.count >= free) {
      const steps = Math.min(entry.count - free, 20);
      entry.lockedUntil = now + Math.min(PASSWORD_LOCK_BASE_MS * 2 ** steps, PASSWORD_LOCK_MAX_MS);
    }
    passwordFailures.set(key, entry);
  }
}

function clearPasswordFailures(req, room) {
  passwordFailures.delete(`ip:${room.id}:${getClientIp(req)}`);
}

setInterval(() => {
  const cutoff = Date.now() - PASSWORD_FORGET_MS;
  for (const [key, entry] of passwordFailures) if (entry.last < cutoff) passwordFailures.delete(key);
}, 10 * 60 * 1000).unref();

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function createRoom(roomName, password, creatorName, clientId) {
  let id = createId(4);
  while (rooms.has(id)) id = createId(4);

  const passwordRecord = hashPassword(password);
  const room = {
    id,
    name: roomName,
    // Durable, room-level ownership: the identity (client id) of the creator.
    // Independent of the ephemeral participant roster, so it survives restarts.
    ownerClientId: clientId || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    emptySince: nowIso(),
    lastJoinAt: nowIso(),
    revealed: false,
    passwordSalt: passwordRecord.salt,
    passwordHash: passwordRecord.hash,
    mode: "scrum",
    idleStackTaps: 0,
    voteHistory: [],
    agenda: [],
    teams: [],
    tickets: emptyTickets(),
    revealedRoundId: null,
    poker: null,
    participants: new Map(),
    clients: new Set(),
  };

  rooms.set(id, room);
  const result = addParticipant(room, creatorName, true, clientId);
  persistRoom(room);
  return result;
}

function takenDiscriminators(room) {
  const taken = new Set();
  for (const participant of room.participants.values()) {
    if (participant.discriminator) taken.add(participant.discriminator);
  }
  return taken;
}

function addParticipant(room, name, isHost, clientId) {
  const token = createId(24);
  const participant = {
    id: createId(5),
    name,
    discriminator: makeDiscriminator(takenDiscriminators(room)),
    clientId: clientId || null,
    tokenHash: hashToken(token),
    isHost,
    vote: null,
    credits: POKER_STARTING_CREDITS,
    online: false,
    connectionCount: 0,
    joinedAt: nowIso(),
    lastSeen: nowIso(),
    team: null,
  };

  room.participants.set(participant.id, participant);
  room.updatedAt = nowIso();

  return { room, participant, token };
}

// One browser (client id) maps to at most one participant per room, so a
// returning browser reattaches instead of creating a duplicate seat.
function findParticipantByClientId(room, clientId) {
  if (!clientId) return null;
  for (const participant of room.participants.values()) {
    if (participant.clientId && participant.clientId === clientId) return participant;
  }
  return null;
}

function getRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.updatedAt = nowIso();
  return room;
}

function markRoomOccupied(room) {
  room.emptySince = null;
  room.updatedAt = nowIso();
}

function markRoomEmpty(room) {
  if (!room.emptySince) {
    room.emptySince = nowIso();
  }
  room.updatedAt = nowIso();
}

function authenticateParticipant(room, participantId, token) {
  if (!participantId || !token) return null;
  const participant = room.participants.get(participantId);
  if (!participant) return null;

  const expected = Buffer.from(participant.tokenHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return null;
  }

  participant.lastSeen = nowIso();
  return participant;
}

function parseBearer(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function createPokerDeck() {
  const cards = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) {
      cards.push(`${rank}${suit}`);
    }
  }

  return cards;
}

function shuffle(cards) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function drawCard(poker) {
  return poker.deck.pop();
}

function pokerPlayers(room) {
  // Only seat players who are actually present. Offline/duplicate records keep
  // their credits but are never dealt in, so an absent seat can't stall a hand.
  return Array.from(room.participants.values()).filter((participant) => participant.online && participant.credits > 0);
}

function pokerStateFor(poker, participantId) {
  return poker.players.find((player) => player.participantId === participantId);
}

function playerName(room, participantId) {
  return room.participants.get(participantId)?.name || "Player";
}

function nextSeatIndex(poker, startIndex, predicate) {
  if (!poker.players.length) return -1;

  for (let offset = 1; offset <= poker.players.length; offset += 1) {
    const index = (startIndex + offset) % poker.players.length;
    if (predicate(poker.players[index])) return index;
  }

  return -1;
}

function activePokerPlayers(poker) {
  return poker.players.filter((player) => !player.folded && !player.out);
}

function playersWhoCanAct(poker) {
  return poker.players.filter((player) => !player.folded && !player.out && !player.allIn);
}

function payToPot(room, pokerPlayer, amount) {
  const poker = room.poker;
  const participant = room.participants.get(pokerPlayer.participantId);
  if (!participant || amount <= 0) return 0;

  const paid = Math.min(amount, participant.credits);
  participant.credits -= paid;
  pokerPlayer.bet += paid;
  pokerPlayer.committed += paid;
  poker.pot += paid;
  if (participant.credits === 0) pokerPlayer.allIn = true;
  return paid;
}

function startPokerMode(room) {
  room.mode = "poker";
  room.idleStackTaps = 0;
  room.revealed = false;
  room.revealedRoundId = null;
  for (const participant of room.participants.values()) {
    participant.vote = null;
  }

  room.poker = {
    handNumber: 0,
    dealerIndex: -1,
    phase: "waiting",
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    currentTurnParticipantId: null,
    minRaise: POKER_BIG_BLIND,
    message: "Waiting for at least two players.",
    winners: [],
    players: [],
  };

  maybeStartPokerHand(room);
}

function buildVoteSummary(votes) {
  const pickedVotes = votes.map((vote) => vote.value).filter((value) => value !== null);
  const numericVotes = pickedVotes.map(Number).filter((value) => Number.isFinite(value));
  const counts = new Map();

  for (const vote of pickedVotes) counts.set(vote, (counts.get(vote) || 0) + 1);

  const mostPicked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  if (numericVotes.length === 0) {
    return {
      average: null,
      range: null,
      mostPicked,
    };
  }

  const sum = numericVotes.reduce((total, value) => total + value, 0);
  const min = Math.min(...numericVotes);
  const max = Math.max(...numericVotes);

  return {
    average: Number((sum / numericVotes.length).toFixed(1)),
    range: min === max ? String(min) : `${min}-${max}`,
    mostPicked,
  };
}

function recordRevealedVotes(room) {
  if (!room.revealed) return;

  const votes = Array.from(room.participants.values()).map((participant) => ({
    participantId: participant.id,
    name: participant.name,
    value: participant.vote,
  }));

  if (!votes.some((vote) => vote.value !== null)) return;

  const roundId = createId(5);
  // The round on the table right now; a ticket can be confirmed with it.
  room.revealedRoundId = roundId;
  room.voteHistory.unshift({
    id: roundId,
    createdAt: nowIso(),
    votes,
    summary: buildVoteSummary(votes),
  });
  room.voteHistory = room.voteHistory.slice(0, MAX_VOTE_HISTORY);
}

// Snapshot the round into history the moment votes are revealed, not on reset.
// A solo estimator who reveals and never resets still gets a history entry.
// Idempotent so a repeated reveal can't double-record the same round.
function revealScrumVotes(room) {
  if (room.revealed) return;
  room.revealed = true;
  recordRevealedVotes(room);
  persistRoom(room);
}

function resetScrumVotes(room) {
  room.revealed = false;
  room.revealedRoundId = null;
  room.idleStackTaps = 0;
  for (const participant of room.participants.values()) {
    participant.vote = null;
  }
  persistRoom(room);
}

function scramPokerMode(room) {
  room.mode = "scrum";
  room.idleStackTaps = 0;
  room.revealed = false;
  room.revealedRoundId = null;
  room.poker = null;

  for (const participant of room.participants.values()) {
    participant.vote = null;
    participant.credits = POKER_STARTING_CREDITS;
  }
}

function maybeStartPokerHand(room) {
  if (room.mode !== "poker") return;
  if (room.poker && !["waiting", "complete", "showdown"].includes(room.poker.phase)) return;

  room.idleStackTaps = 0;

  const participants = pokerPlayers(room);
  if (participants.length < 2) {
    room.poker = {
      ...(room.poker || {}),
      phase: "waiting",
      deck: [],
      communityCards: [],
      pot: 0,
      currentBet: 0,
      currentTurnParticipantId: null,
      message: "Waiting for at least two players.",
      winners: [],
      players: participants.map((participant) => ({
        participantId: participant.id,
        cards: [],
        folded: false,
        out: false,
        allIn: participant.credits === 0,
        bet: 0,
        committed: 0,
        acted: false,
        role: "",
      })),
    };
    return;
  }

  startPokerHand(room, participants);
}

function startPokerHand(room, participants = pokerPlayers(room)) {
  const previousDealerId = room.poker?.players?.[room.poker.dealerIndex]?.participantId;
  const deck = shuffle(createPokerDeck());
  const players = participants.map((participant) => ({
    participantId: participant.id,
    cards: [],
    folded: false,
    out: false,
    allIn: participant.credits === 0,
    bet: 0,
    committed: 0,
    acted: false,
    role: "",
  }));

  let dealerIndex = 0;
  const previousIndex = players.findIndex((player) => player.participantId === previousDealerId);
  if (previousIndex >= 0) dealerIndex = (previousIndex + 1) % players.length;

  const poker = {
    handNumber: (room.poker?.handNumber || 0) + 1,
    dealerIndex,
    phase: "preflop",
    deck,
    communityCards: [],
    pot: 0,
    currentBet: POKER_BIG_BLIND,
    currentTurnParticipantId: null,
    minRaise: POKER_BIG_BLIND,
    message: "Pre-flop betting.",
    winners: [],
    players,
  };

  room.poker = poker;

  const smallBlindIndex = players.length === 2
    ? dealerIndex
    : nextSeatIndex(poker, dealerIndex, (player) => !player.out);
  const bigBlindIndex = nextSeatIndex(poker, smallBlindIndex, (player) => !player.out);
  players[dealerIndex].role = "D";
  players[smallBlindIndex].role = players[smallBlindIndex].role ? `${players[smallBlindIndex].role} SB` : "SB";
  players[bigBlindIndex].role = players[bigBlindIndex].role ? `${players[bigBlindIndex].role} BB` : "BB";

  payToPot(room, players[smallBlindIndex], POKER_SMALL_BLIND);
  payToPot(room, players[bigBlindIndex], POKER_BIG_BLIND);

  for (let round = 0; round < 2; round += 1) {
    for (let offset = 0; offset < players.length; offset += 1) {
      const index = (dealerIndex + 1 + offset) % players.length;
      players[index].cards.push(drawCard(poker));
    }
  }

  const firstToActIndex = players.length === 2
    ? dealerIndex
    : nextSeatIndex(poker, bigBlindIndex, (player) => !player.out && !player.allIn);
  poker.currentTurnParticipantId = players[firstToActIndex]?.participantId || null;
  for (const player of players) {
    player.acted = player.folded || player.out || player.allIn;
  }

  // Guard the opening action in case a seated player dropped between seating
  // and the deal.
  autoFoldOfflineTurn(room);
}

function resetPokerActionsAfterBet(poker, actingParticipantId) {
  for (const player of poker.players) {
    player.acted = player.folded || player.out || player.allIn || player.participantId === actingParticipantId;
  }
}

function findNextPokerTurn(poker, currentParticipantId) {
  const currentIndex = poker.players.findIndex((player) => player.participantId === currentParticipantId);
  const startIndex = currentIndex >= 0 ? currentIndex : poker.dealerIndex;
  const nextIndex = nextSeatIndex(
    poker,
    startIndex,
    (player) => !player.folded && !player.out && !player.allIn && (player.bet < poker.currentBet || !player.acted)
  );
  return nextIndex >= 0 ? poker.players[nextIndex].participantId : null;
}

function isBettingRoundComplete(poker) {
  const actors = playersWhoCanAct(poker);
  if (actors.length === 0) return true;
  return actors.every((player) => player.acted && player.bet === poker.currentBet);
}

function clearStageBets(poker) {
  poker.currentBet = 0;
  for (const player of poker.players) {
    player.bet = 0;
    player.acted = player.folded || player.out || player.allIn;
  }
}

function firstPostFlopPlayer(poker) {
  const index = nextSeatIndex(poker, poker.dealerIndex, (player) => !player.folded && !player.out && !player.allIn);
  return index >= 0 ? poker.players[index].participantId : null;
}

function advancePokerAfterAction(room) {
  const poker = room.poker;
  const remaining = activePokerPlayers(poker);
  if (remaining.length <= 1) {
    awardPokerPot(room, remaining);
    return;
  }

  if (!isBettingRoundComplete(poker)) {
    poker.currentTurnParticipantId = findNextPokerTurn(poker, poker.currentTurnParticipantId);
    poker.message = `${playerName(room, poker.currentTurnParticipantId)} to act.`;
    return;
  }

  if (poker.phase === "preflop") {
    poker.communityCards.push(drawCard(poker), drawCard(poker), drawCard(poker));
    poker.phase = "flop";
    poker.message = "Flop betting.";
  } else if (poker.phase === "flop") {
    poker.communityCards.push(drawCard(poker));
    poker.phase = "turn";
    poker.message = "Turn betting.";
  } else if (poker.phase === "turn") {
    poker.communityCards.push(drawCard(poker));
    poker.phase = "river";
    poker.message = "River betting.";
  } else if (poker.phase === "river") {
    settlePokerShowdown(room);
    return;
  }

  clearStageBets(poker);
  poker.currentTurnParticipantId = firstPostFlopPlayer(poker);
  if (!poker.currentTurnParticipantId || isBettingRoundComplete(poker)) {
    advancePokerAfterAction(room);
  }
}

// If the action sits on a player who has gone offline, fold them so the hand
// keeps moving instead of hanging on an absent seat. Loops in case several
// seated players are offline at once; bounded by the player count.
function autoFoldOfflineTurn(room) {
  const poker = room.poker;
  const live = ["preflop", "flop", "turn", "river"];
  for (let guard = 0; poker && live.includes(poker.phase) && guard <= poker.players.length; guard += 1) {
    const turnId = poker.currentTurnParticipantId;
    if (!turnId) return;
    const participant = room.participants.get(turnId);
    if (participant && participant.online) return; // a present player; wait for their move
    const player = pokerStateFor(poker, turnId);
    if (!player || player.folded || player.out) return;
    player.folded = true;
    player.acted = true;
    poker.message = `${playerName(room, turnId)} folded (offline).`;
    advancePokerAfterAction(room);
  }
}

function awardPokerPot(room, remainingPlayers) {
  const poker = room.poker;
  const winner = remainingPlayers[0];
  if (winner) {
    const participant = room.participants.get(winner.participantId);
    if (participant) participant.credits += poker.pot;
    poker.winners = [{
      participantId: winner.participantId,
      name: playerName(room, winner.participantId),
      amount: poker.pot,
      hand: "Everyone else folded",
    }];
    poker.message = `${playerName(room, winner.participantId)} wins ${poker.pot}.`;
  }

  poker.phase = "complete";
  poker.currentTurnParticipantId = null;
  poker.pot = 0;
}

function settlePokerShowdown(room) {
  const poker = room.poker;
  const contenders = activePokerPlayers(poker);
  const ranked = contenders.map((player) => ({
    player,
    result: evaluateBestPokerHand([...player.cards, ...poker.communityCards]),
  })).sort((a, b) => comparePokerHands(b.result.score, a.result.score));

  const best = ranked[0];
  const winners = ranked.filter((entry) => comparePokerHands(entry.result.score, best.result.score) === 0);
  const share = Math.floor(poker.pot / winners.length);
  const remainder = poker.pot - share * winners.length;

  winners.forEach((entry, index) => {
    const participant = room.participants.get(entry.player.participantId);
    if (participant) participant.credits += share + (index === 0 ? remainder : 0);
  });

  poker.winners = winners.map((entry, index) => ({
    participantId: entry.player.participantId,
    name: playerName(room, entry.player.participantId),
    amount: share + (index === 0 ? remainder : 0),
    hand: entry.result.label,
  }));
  poker.phase = "showdown";
  poker.currentTurnParticipantId = null;
  poker.message = poker.winners.map((winner) => `${winner.name} wins ${winner.amount} with ${winner.hand}`).join(", ");
  poker.pot = 0;
}

function normalizePokerCard(card) {
  return {
    rank: card[0],
    suit: card[1],
    value: POKER_RANK_VALUES.get(card[0]),
    code: card,
  };
}

function evaluateBestPokerHand(cards) {
  const normalized = cards.map(normalizePokerCard);
  const combinations = chooseFive(normalized);
  return combinations.map(scoreFiveCards).sort((a, b) => comparePokerHands(b.score, a.score))[0];
}

function chooseFive(cards) {
  const hands = [];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            hands.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return hands;
}

function scoreFiveCards(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => b - a);
  const suits = new Set(cards.map((card) => card.suit));
  const flush = suits.size === 1;
  const straightHigh = straightHighCard(values);
  const groups = Array.from(values.reduce((map, value) => {
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let category = 0;
  let ranks = values;

  if (flush && straightHigh) {
    category = 8;
    ranks = [straightHigh];
  } else if (groups[0][1] === 4) {
    category = 7;
    ranks = [groups[0][0], ...groups.filter((group) => group[1] !== 4).map((group) => group[0])];
  } else if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
    category = 6;
    ranks = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
    ranks = values;
  } else if (straightHigh) {
    category = 4;
    ranks = [straightHigh];
  } else if (groups[0][1] === 3) {
    category = 3;
    ranks = [groups[0][0], ...groups.filter((group) => group[1] !== 3).map((group) => group[0]).sort((a, b) => b - a)];
  } else if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    category = 2;
    ranks = [groups[0][0], groups[1][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0])];
  } else if (groups[0][1] === 2) {
    category = 1;
    ranks = [groups[0][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0]).sort((a, b) => b - a)];
  }

  return {
    label: POKER_HAND_LABELS[category],
    score: [category, ...ranks],
  };
}

function straightHighCard(values) {
  const unique = Array.from(new Set(values)).sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);

  for (let index = 0; index <= unique.length - 5; index += 1) {
    const slice = unique.slice(index, index + 5);
    if (slice.every((value, offset) => value === slice[0] - offset)) {
      return slice[0] === 1 ? 5 : slice[0];
    }
  }

  return 0;
}

function comparePokerHands(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function snapshotPoker(room, viewerParticipantId) {
  if (!room.poker) return null;
  const poker = room.poker;
  return {
    handNumber: poker.handNumber,
    phase: poker.phase,
    communityCards: poker.communityCards,
    pot: poker.pot,
    currentBet: poker.currentBet,
    currentTurnParticipantId: poker.currentTurnParticipantId,
    message: poker.message,
    winners: poker.winners,
    canStartNextHand: ["waiting", "complete", "showdown"].includes(poker.phase),
    players: poker.players.map((player) => {
      const showCards = player.participantId === viewerParticipantId || ["showdown", "complete"].includes(poker.phase);
      return {
        participantId: player.participantId,
        cards: showCards ? player.cards : player.cards.map(() => null),
        folded: player.folded,
        allIn: player.allIn,
        bet: player.bet,
        committed: player.committed,
        role: player.role,
        isTurn: player.participantId === poker.currentTurnParticipantId,
      };
    }),
  };
}

// The participant block returned to the joining client; the discriminator lets
// the UI show a stable `Name#1234` even before the next room snapshot.
function participantPayload(participant, token) {
  return {
    id: participant.id,
    name: participant.name,
    discriminator: participant.discriminator,
    token,
    isHost: participant.isHost,
  };
}

function isOwnerParticipant(room, participant) {
  return Boolean(room.ownerClientId && participant.clientId && participant.clientId === room.ownerClientId);
}

// The display name of the room owner, if that browser currently holds a seat.
// Ownership is durable but the roster is not, so an owner who is away (or a room
// freshly loaded from disk) has no seated participant and reads back as null.
function ownerName(room) {
  for (const participant of room.participants.values()) {
    if (isOwnerParticipant(room, participant)) return participant.name;
  }
  return null;
}

function snapshotRoom(room, viewerParticipantId) {
  const participants = Array.from(room.participants.values()).map((participant) => {
    const canSeeVote = room.revealed || participant.id === viewerParticipantId;

    return {
      id: participant.id,
      name: participant.name,
      discriminator: participant.discriminator,
      isHost: participant.isHost,
      isOwner: isOwnerParticipant(room, participant),
      online: participant.online,
      credits: room.mode === "poker" && participant.id === viewerParticipantId ? participant.credits : null,
      hasVote: participant.vote !== null,
      vote: canSeeVote ? participant.vote : null,
      joinedAt: participant.joinedAt,
      team: participant.team ?? null,
    };
  });

  // Group by team (in the owner's configured team order); teamless players fall
  // to the end. Within a group, owner first, then by join time.
  const teamOrder = new Map((room.teams || []).map((team, index) => [team.id, index]));
  const teamRank = (id) => (id != null && teamOrder.has(id) ? teamOrder.get(id) : Number.MAX_SAFE_INTEGER);
  participants.sort((a, b) => {
    const rankDiff = teamRank(a.team) - teamRank(b.team);
    if (rankDiff !== 0) return rankDiff;
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  return {
    id: room.id,
    name: room.name,
    ownerName: ownerName(room),
    mode: room.mode,
    revealed: room.revealed,
    idleStackTaps: room.idleStackTaps,
    voteHistory: room.voteHistory,
    agenda: room.agenda,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    votingScale: VOTING_SCALE,
    teams: room.teams || [],
    tickets: snapshotTickets(room),
    poker: snapshotPoker(room, viewerParticipantId),
    participants,
  };
}

function writeEvent(client, eventName, payload) {
  client.res.write(`event: ${eventName}\n`);
  client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendTerminalEvent(res, eventName, payload) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  writeEvent({ res }, eventName, payload);
  res.end();
}

function broadcastRoom(room) {
  room.updatedAt = nowIso();

  for (const client of room.clients) {
    try {
      writeEvent(client, "room", snapshotRoom(room, client.participantId));
    } catch {
      room.clients.delete(client);
    }
  }
}

function handleRoomEvents(req, res, url, room) {
  const participantId = url.searchParams.get("participantId");
  const token = url.searchParams.get("token");
  const participant = authenticateParticipant(room, participantId, token);

  if (!participant) {
    sendTerminalEvent(res, "session-invalid", { error: "Join the room again." });
    return;
  }

  // The token just proved possession of this seat. Refresh the identity cookie
  // (Set-Cookie must precede writeHead) and heal ownership across a cookie change:
  // if this is the owner seat but the browser's current cookie no longer matches
  // (cleared/rotated on an old room), re-key ownership to it so owner writes keep
  // authorizing. Every reload reconnects here, so this is where the heal must run.
  const clientId = ensureClientId(req, res);
  if (clientId && participant.clientId === room.ownerClientId && room.ownerClientId !== clientId) {
    room.ownerClientId = clientId;
    participant.clientId = clientId;
    persistRoom(room);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const client = { res, participantId: participant.id };
  room.clients.add(client);
  markRoomOccupied(room);
  participant.connectionCount += 1;
  participant.online = true;
  participant.lastSeen = nowIso();

  writeEvent(client, "room", snapshotRoom(room, participant.id));
  broadcastRoom(room);

  let disconnected = false;
  let heartbeat;
  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    clearInterval(heartbeat);
    room.clients.delete(client);
    participant.connectionCount = Math.max(0, participant.connectionCount - 1);
    participant.online = participant.connectionCount > 0;
    participant.lastSeen = nowIso();
    if (room.clients.size === 0) {
      markRoomEmpty(room);
    }
    // If they dropped on their poker turn, fold them so the hand keeps moving.
    if (room.mode === "poker" && !participant.online) autoFoldOfflineTurn(room);
    broadcastRoom(room);
  };

  heartbeat = setInterval(() => {
    try {
      writeEvent(client, "ping", { at: nowIso() });
    } catch {
      disconnect();
    }
  }, HEARTBEAT_MS);

  req.on("close", disconnect);
}

function handleStackTap(room, participant) {
  if (room.mode === "poker") {
    room.idleStackTaps += 1;
    if (room.idleStackTaps >= 3) {
      scramPokerMode(room);
    }
    return;
  }

  const votedCount = Array.from(room.participants.values()).filter((participant) => participant.vote !== null).length;

  if (room.revealed) {
    resetScrumVotes(room);
    return;
  }

  if (votedCount > 0) {
    room.idleStackTaps = 0;
    revealScrumVotes(room);
    return;
  }

  room.idleStackTaps += 1;
  if (room.idleStackTaps >= 3) {
    startPokerMode(room);
  }
}

function normalizePokerAmount(value, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.max(1, Math.floor(amount));
}

function handlePokerAction(room, participant, body) {
  if (room.mode !== "poker") {
    throw new Error("Poker mode is not active.");
  }

  const poker = room.poker;
  const action = String(body.pokerAction || "");
  room.idleStackTaps = 0;

  if (action === "start" || ["waiting", "complete", "showdown"].includes(poker.phase)) {
    maybeStartPokerHand(room);
    return;
  }

  const player = pokerStateFor(poker, participant.id);
  if (!player || player.folded || player.out || player.allIn) {
    throw new Error("You are not active in this hand.");
  }

  if (poker.currentTurnParticipantId !== participant.id) {
    throw new Error("It is not your turn.");
  }

  if (action === "fold") {
    player.folded = true;
    player.acted = true;
    poker.message = `${participant.name} folded.`;
    advancePokerAfterAction(room);
    return;
  }

  if (action === "check") {
    if (player.bet !== poker.currentBet) throw new Error("You cannot check against a bet.");
    player.acted = true;
    poker.message = `${participant.name} checked.`;
    advancePokerAfterAction(room);
    return;
  }

  if (action === "call") {
    const callAmount = Math.max(0, poker.currentBet - player.bet);
    payToPot(room, player, callAmount);
    player.acted = true;
    poker.message = `${participant.name} called ${callAmount}.`;
    advancePokerAfterAction(room);
    return;
  }

  if (action === "bet") {
    if (poker.currentBet !== 0) throw new Error("Use raise when there is already a bet.");
    const amount = normalizePokerAmount(body.amount, POKER_STEP);
    payToPot(room, player, amount);
    poker.currentBet = player.bet;
    poker.message = `${participant.name} bet ${amount}.`;
    resetPokerActionsAfterBet(poker, participant.id);
    advancePokerAfterAction(room);
    return;
  }

  if (action === "raise") {
    if (poker.currentBet === 0) throw new Error("Use bet when there is no current bet.");
    const raiseAmount = normalizePokerAmount(body.amount, POKER_STEP);
    const callAmount = Math.max(0, poker.currentBet - player.bet);
    payToPot(room, player, callAmount + raiseAmount);
    poker.currentBet = player.bet;
    poker.message = `${participant.name} raised ${raiseAmount}.`;
    resetPokerActionsAfterBet(poker, participant.id);
    advancePokerAfterAction(room);
    return;
  }

  throw new Error("Unknown poker action.");
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    cleanupRooms();

    if (rooms.size >= MAX_ACTIVE_ROOMS) {
      sendError(res, 429, "Too many active rooms right now. Try again in a minute.");
      return;
    }

    if (!canCreateRoom(req)) {
      sendError(res, 429, "Too many rooms created from this connection. Try again later.");
      return;
    }

    const body = await readJson(req);
    const password = typeof body.password === "string" ? body.password : "";

    if (password.trim().length < 4) {
      sendError(res, 400, "Room password must be at least 4 characters.");
      return;
    }

    const roomName = cleanText(body.roomName, randomRoomName(), 80);
    const creatorName = cleanText(body.name, "Host", 40);
    const clientId = ensureClientId(req, res);
    const created = createRoom(roomName, password, creatorName, clientId);
    recordJoinHistory(clientId, created.room);
    recordRoomCreation(req);

    sendJson(res, 201, {
      room: snapshotRoom(created.room, created.participant.id),
      participant: participantPayload(created.participant, created.token),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/my-rooms") {
    const clientId = ensureClientId(req, res);
    const list = [];
    for (const room of rooms.values()) {
      const participant = findParticipantByClientId(room, clientId);
      if (!participant) continue;
      const lastJoin = Date.parse(room.lastJoinAt);
      const seen = Date.parse(participant.lastSeen);
      list.push({
        roomId: room.id,
        roomName: room.name,
        name: participant.name,
        discriminator: participant.discriminator,
        isOwner: Boolean(room.ownerClientId && room.ownerClientId === clientId),
        roomExpiresAt: Number.isFinite(lastJoin) ? new Date(lastJoin + RETENTION_MS).toISOString() : null,
        sessionExpiresAt: Number.isFinite(seen) ? new Date(seen + PARTICIPANT_RETENTION_MS).toISOString() : null,
      });
    }
    sendJson(res, 200, { rooms: list });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/my-history") {
    // Every unique room this browser has ever joined, tagged with a live state:
    // rejoinable (room exists + this browser still holds a seat → password-free),
    // active (room exists, seat gone → needs the password), or gone (room deleted).
    const clientId = ensureClientId(req, res);
    const history = store.historyForClient(clientId).map((entry) => {
      const room = rooms.get(entry.roomId);
      let state = "gone";
      if (room) {
        state = findParticipantByClientId(room, clientId) ? "rejoinable" : "active";
      }
      return {
        roomId: entry.roomId,
        roomName: entry.roomName,
        lastJoinedAt: entry.lastJoinedAt,
        state,
      };
    });
    sendJson(res, 200, { history });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/history/clear") {
    const clientId = ensureClientId(req, res);
    const body = await readJson(req);
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    if (!roomId) {
      sendError(res, 400, "Missing roomId.");
      return;
    }
    store.clearHistory(clientId, roomId);
    sendJson(res, 200, { ok: true });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([a-z0-9_-]+)(?:\/([a-z]+))?$/);
  if (!roomMatch) {
    sendError(res, 404, "Not found.");
    return;
  }

  const room = getRoom(roomMatch[1]);
  const action = roomMatch[2] || "";

  if (!room) {
    if (req.method === "GET" && action === "events") {
      sendTerminalEvent(res, "session-invalid", { error: "Room not found." });
      return;
    }
    sendError(res, 404, "Room not found.");
    return;
  }

  if (req.method === "GET" && action === "events") {
    handleRoomEvents(req, res, url, room);
    return;
  }

  if (req.method === "POST" && action === "join") {
    const body = await readJson(req);
    const password = typeof body.password === "string" ? body.password : "";

    const lockWait = passwordLockWaitMs(req, room);
    if (lockWait > 0) {
      const seconds = Math.ceil(lockWait / 1000);
      res.setHeader("Retry-After", String(seconds));
      sendError(res, 429, `Too many wrong passwords. Try again in ${seconds} seconds.`);
      return;
    }

    if (!verifyPassword(password, room.passwordSalt, room.passwordHash)) {
      recordPasswordFailure(req, room);
      sendError(res, 403, "Wrong room password.");
      return;
    }
    clearPasswordFailures(req, room);

    const clientId = ensureClientId(req, res);
    const requestedParticipantId = typeof body.participantId === "string" ? body.participantId : "";
    const requestedToken = typeof body.token === "string" ? body.token : "";
    const requestedResume = Boolean(requestedParticipantId || requestedToken);
    const resumedParticipant = authenticateParticipant(room, requestedParticipantId, requestedToken);

    if (resumedParticipant) {
      // Adopt this browser's client id if the record predates cookies.
      if (clientId && !resumedParticipant.clientId) resumedParticipant.clientId = clientId;
      // Heal ownership across an identity-cookie change. The session token just
      // proved possession of this seat; if it's the owner seat but the browser's
      // current cookie no longer matches (cookie cleared/rotated on an old room),
      // re-key ownership to the current cookie so owner writes (rename, password,
      // teams) keep authorizing instead of silently 403-ing.
      if (clientId && resumedParticipant.clientId === room.ownerClientId && room.ownerClientId !== clientId) {
        room.ownerClientId = clientId;
        resumedParticipant.clientId = clientId;
      }
      resumedParticipant.lastSeen = nowIso();
      markRoomJoined(room);
      recordJoinHistory(clientId, room);
      persistRoom(room);
      sendJson(res, 200, {
        room: snapshotRoom(room, resumedParticipant.id),
        participant: participantPayload(resumedParticipant, requestedToken),
      });
      return;
    }

    // Same browser, but its saved token is gone (cleared storage, a new tab).
    // The identity cookie reattaches it to its existing seat with a fresh token
    // instead of minting a duplicate participant.
    const byClient = findParticipantByClientId(room, clientId);
    if (byClient) {
      const token = createId(24);
      byClient.tokenHash = hashToken(token);
      byClient.lastSeen = nowIso();
      markRoomJoined(room);
      recordJoinHistory(clientId, room);
      persistRoom(room);
      broadcastRoom(room);
      sendJson(res, 200, {
        room: snapshotRoom(room, byClient.id),
        participant: participantPayload(byClient, token),
      });
      return;
    }

    if (requestedResume) {
      sendJson(res, 409, {
        error: "Saved room session not available. Enter the room again.",
        code: "saved_session_invalid",
      });
      return;
    }

    if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) {
      sendError(res, 403, "This room is full.");
      return;
    }

    const name = cleanText(body.name, "Teammate", 40);
    const joined = addParticipant(room, name, false, clientId);
    persistRoom(room);
    markRoomJoined(room);
    recordJoinHistory(clientId, room);
    if (room.mode === "poker") maybeStartPokerHand(room);
    broadcastRoom(room);

    sendJson(res, 201, {
      room: snapshotRoom(room, joined.participant.id),
      participant: participantPayload(joined.participant, joined.token),
    });
    return;
  }

  if (req.method === "POST" && action === "resume") {
    // Password-free reconnect within the session window: the identity cookie
    // alone reattaches this browser to its existing seat with a fresh token.
    const clientId = ensureClientId(req, res);
    const existing = findParticipantByClientId(room, clientId);
    if (!existing) {
      sendError(res, 404, "No session to resume in this room.");
      return;
    }
    const token = createId(24);
    existing.tokenHash = hashToken(token);
    existing.lastSeen = nowIso();
    markRoomJoined(room);
    recordJoinHistory(clientId, room);
    persistRoom(room);
    broadcastRoom(room);
    sendJson(res, 200, {
      room: snapshotRoom(room, existing.id),
      participant: participantPayload(existing, token),
    });
    return;
  }

  if (req.method === "POST" && action === "leave") {
    // Leave removes the record entirely (unlike a disconnect, which keeps the
    // seat resumable). Callable in-room (token) or from the landing "Your rooms"
    // card (identity cookie).
    const leaveBody = await readJson(req);
    const clientId = ensureClientId(req, res);
    const leaver = authenticateParticipant(room, leaveBody.participantId, parseBearer(req))
      || findParticipantByClientId(room, clientId);
    if (!leaver) {
      sendError(res, 404, "No session to leave in this room.");
      return;
    }
    room.participants.delete(leaver.id);
    for (const client of [...room.clients]) {
      if (client.participantId === leaver.id) {
        try { client.res.end(); } catch { /* already closed */ }
        room.clients.delete(client);
      }
    }
    if (room.clients.size === 0) markRoomEmpty(room);
    if (room.mode === "poker") autoFoldOfflineTurn(room);
    persistRoom(room);
    broadcastRoom(room);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Owner-only room settings. Ownership is keyed on the identity cookie (not a
  // participant seat), so these work in-room and from the "Your rooms" dashboard
  // alike, and cannot be forged by a plain participant even via a direct call.
  if (req.method === "POST" && (action === "rename" || action === "password" || action === "teams")) {
    const settingsBody = await readJson(req);
    const clientId = ensureClientId(req, res);
    if (!room.ownerClientId || clientId !== room.ownerClientId) {
      sendError(res, 403, "Only the room owner can change room settings.");
      return;
    }

    if (action === "teams") {
      // Replace the room's whole team list. Any player pointing at a team that no
      // longer exists is quietly detached (their id simply won't resolve).
      room.teams = normalizeTeams(settingsBody.teams);
      const liveIds = new Set(room.teams.map((team) => team.id));
      for (const participant of room.participants.values()) {
        if (participant.team && !liveIds.has(participant.team)) participant.team = null;
      }
      persistRoom(room);
      broadcastRoom(room);
      sendJson(res, 200, { room: snapshotRoom(room, null) });
      return;
    }

    if (action === "rename") {
      room.name = cleanText(settingsBody.name, room.name, 80);
      persistRoom(room);
      broadcastRoom(room);
      sendJson(res, 200, { room: snapshotRoom(room, null) });
      return;
    }

    // action === "password": rotate the room password. Only affects future joins;
    // seated participants keep their session token, so no one is evicted.
    const password = typeof settingsBody.password === "string" ? settingsBody.password : "";
    if (password.trim().length < 4) {
      sendError(res, 400, "Room password must be at least 4 characters.");
      return;
    }
    const passwordRecord = hashPassword(password);
    room.passwordSalt = passwordRecord.salt;
    room.passwordHash = passwordRecord.hash;
    persistRoom(room);
    sendJson(res, 200, { ok: true });
    return;
  }

  const body = await readJson(req);
  const participant = authenticateParticipant(room, body.participantId, parseBearer(req));

  if (!participant) {
    sendError(res, 401, "Join the room again.");
    return;
  }

  if (req.method === "POST" && action === "stack") {
    try {
      handleStackTap(room, participant);
    } catch (error) {
      sendError(res, error.statusCode || 400, error.message);
      return;
    }
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "poker") {
    try {
      handlePokerAction(room, participant, body);
    } catch (error) {
      sendError(res, 400, error.message);
      return;
    }
    // The move may have passed the turn to a seat that has since gone offline.
    autoFoldOfflineTurn(room);
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "vote") {
    if (room.mode !== "scrum") {
      sendError(res, 409, "Scrum Poker voting is not active.");
      return;
    }

    if (room.revealed) {
      sendError(res, 409, "Reset the room before voting again.");
      return;
    }

    const vote = body.value === null ? null : String(body.value);
    if (vote !== null && !isAcceptableVote(vote)) {
      sendError(res, 400, "That vote is not in this room's deck.");
      return;
    }

    participant.vote = vote;
    participant.lastSeen = nowIso();
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "team") {
    // A player picks (or clears) their own team. null clears; any other value
    // must match a team currently configured on the room.
    const requested = body.team === null || body.team === undefined ? null : String(body.team);
    if (requested !== null && !(room.teams || []).some((team) => team.id === requested)) {
      sendError(res, 400, "That team is not available in this room.");
      return;
    }
    participant.team = requested;
    participant.lastSeen = nowIso();
    persistRoom(room);
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "reveal") {
    if (room.mode !== "scrum") {
      sendError(res, 409, "Scrum Poker reveal is not active.");
      return;
    }

    revealScrumVotes(room);
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "reset") {
    if (room.mode !== "scrum") {
      sendError(res, 409, "Scrum Poker reset is not active.");
      return;
    }

    resetScrumVotes(room);

    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  // Shared tickets. Same rule as the Reveal/Reset stack: any seated participant
  // with a valid token may act. One endpoint, one `op` per action.
  if (req.method === "POST" && action === "tickets") {
    try {
      applyTicketOp(room, body, { createId: () => createId(6), nowIso, resetRound: resetScrumVotes });
    } catch (error) {
      if (!(error instanceof TicketError)) throw error;
      sendError(res, error.statusCode, error.message);
      return;
    }
    participant.lastSeen = nowIso();
    persistRoom(room);
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  if (req.method === "POST" && action === "agenda") {
    applyAgendaChange(room, body);
    persistRoom(room);
    broadcastRoom(room);
    sendJson(res, 200, { room: snapshotRoom(room, participant.id) });
    return;
  }

  sendError(res, 404, "Not found.");
}

// Per-note upsert/delete so concurrent edits to different notes don't clobber.
function applyAgendaChange(room, body) {
  if (!Array.isArray(room.agenda)) room.agenda = [];

  if (body.op === "delete") {
    const id = String(body.id ?? "");
    room.agenda = room.agenda.filter((entry) => entry.id !== id);
    return;
  }

  if (body.op === "upsert" && body.entry && body.entry.id != null) {
    const entry = {
      id: String(body.entry.id),
      startMin: Number(body.entry.startMin),
      endMin: Number(body.entry.endMin),
      title: String(body.entry.title ?? ""),
      url: String(body.entry.url ?? ""),
      // The calendar day (YYYY-MM-DD, in the author's local zone) the entry
      // belongs to. Entries are never cleared — the client only shows today's,
      // and export reaches older days by this stamp. Legacy entries have none.
      day: body.entry.day ? String(body.entry.day).slice(0, 10) : null,
    };
    const index = room.agenda.findIndex((existing) => existing.id === entry.id);
    if (index >= 0) {
      room.agenda[index] = entry;
    } else {
      room.agenda.push(entry);
    }
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendError(res, 404, "Not found.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": /\.(html|css|js)$/.test(filePath) ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  });
}

function handleStatic(req, res, url) {
  if (req.method !== "GET") {
    sendError(res, 405, "Method not allowed.");
    return;
  }

  if (url.pathname === "/" || /^\/r\/[a-z0-9_-]+$/.test(url.pathname)) {
    serveFile(res, path.join(PUBLIC_DIR, "index.html"));
    return;
  }

  const decoded = decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  serveFile(res, filePath);
}

// A room is retained until RETENTION_DAYS pass with no join. Any successful join
// refreshes room.lastJoinAt, resetting the window.
function cleanupRooms() {
  const cutoff = Date.now() - RETENTION_MS;
  const participantCutoff = Date.now() - PARTICIPANT_RETENTION_MS;

  // Prune history rows nobody has touched within the retention window so the
  // per-browser log can't grow forever.
  store.deleteHistoryOlderThan(new Date(Date.now() - HISTORY_RETENTION_MS).toISOString());

  for (const [roomId, room] of rooms.entries()) {
    const lastJoin = Date.parse(room.lastJoinAt);
    if (Number.isFinite(lastJoin) && lastJoin < cutoff) {
      rooms.delete(roomId);
      store.deleteRoom(roomId);
      continue;
    }

    // Evict participants whose session has been idle past the per-user window,
    // independent of the room's own 84-day retention.
    const stale = staleParticipantIds(Array.from(room.participants.values()), participantCutoff);
    if (stale.length) {
      for (const id of stale) room.participants.delete(id);
      persistRoom(room);
    }
  }
}

setInterval(cleanupRooms, CLEANUP_INTERVAL_MS).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, rooms: rooms.size });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    handleStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || "Internal server error.");
  }
});

loadRoomsFromStore();

server.listen(PORT, HOST, () => {
  console.log(`Scrum poker running on http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  // Fall back to a hard exit if connections keep the server open.
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 1000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
