// Shared tickets for a room: stories the team estimates one at a time.
//
// Stored on the room as one JSON object (rooms.tickets column):
//   { open: [ticket], done: [ticket + votes], selectedIds, usedRoundIds }
// selectedIds: the tickets being estimated now (one or more, or none).
// A ticket is { id, title, link, description, createdAt }. A confirmed ticket
// also carries roundId, votes [{ name, value }] and confirmedAt.
//
// The round itself (votes, reveal, reset) stays the room's normal round; this
// module only decides what a ticket action does to it, through the hooks the
// server passes in (resetRound, nowIso, createId).

const MAX_OPEN_TICKETS = 200;
const MAX_DONE_TICKETS = 200;
const MAX_USED_ROUNDS = 400;
const MAX_TITLE = 200;
const MAX_LINK = 2000;
const MAX_DESCRIPTION = 1000;
const MAX_VOTES = 60;
const MAX_VOTE_NAME = 60;
const MAX_VOTE_VALUE = 12;

class TicketError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function emptyTickets() {
  return { open: [], done: [], selectedIds: [], usedRoundIds: [] };
}

function cleanLine(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanBlock(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

// Same rule the browser used: bare "jira.example/X-1" becomes https://.
// The client still renders only http(s) links as real hrefs.
function normalizeLink(raw) {
  const value = cleanLine(raw, MAX_LINK);
  if (!value) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.slice(0, MAX_LINK);
}

function cleanVotes(votes) {
  if (!Array.isArray(votes)) return [];
  const result = [];
  for (const vote of votes) {
    if (!vote || vote.value === null || vote.value === undefined) continue;
    const name = cleanLine(String(vote.name ?? ""), MAX_VOTE_NAME);
    const value = cleanLine(String(vote.value), MAX_VOTE_VALUE);
    if (!value) continue;
    result.push({ name, value });
    if (result.length >= MAX_VOTES) break;
  }
  return result;
}

function cleanTicket(raw, id, createdAt) {
  return {
    id,
    title: cleanLine(raw?.title, MAX_TITLE),
    link: normalizeLink(raw?.link),
    description: cleanBlock(raw?.description, MAX_DESCRIPTION),
    createdAt,
  };
}

// Coerce whatever is stored (NULL on rooms that predate tickets, or anything
// malformed) into the stored shape.
function normalizeStoredTickets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyTickets();
  const open = Array.isArray(value.open) ? value.open.filter((t) => t && t.id && t.title) : [];
  const done = Array.isArray(value.done) ? value.done.filter((t) => t && t.id && t.title) : [];
  const ids = new Set(open.map((t) => t.id));
  // Rooms saved before multi-select stored a single selectedId.
  const stored = Array.isArray(value.selectedIds) ? value.selectedIds : [value.selectedId];
  return {
    open,
    done,
    selectedIds: [...new Set(stored)].filter((id) => ids.has(id)),
    usedRoundIds: Array.isArray(value.usedRoundIds) ? value.usedRoundIds.map(String) : [],
  };
}

// Returns the room's live tickets object. It is only replaced when missing or
// malformed, so references held by a caller stay valid.
function ensureTickets(room) {
  const t = room.tickets;
  const ok = t && typeof t === "object" && Array.isArray(t.open) && Array.isArray(t.done)
    && Array.isArray(t.usedRoundIds) && Array.isArray(t.selectedIds);
  if (!ok) room.tickets = normalizeStoredTickets(t);
  return room.tickets;
}

// The revealed round a ticket can still be confirmed with, or null.
function confirmableRoundId(room) {
  const tickets = ensureTickets(room);
  if (room.mode !== "scrum" || !room.revealed || !room.revealedRoundId) return null;
  if (tickets.usedRoundIds.includes(room.revealedRoundId)) return null;
  return room.revealedRoundId;
}

function dropRoundFromHistory(room, roundId) {
  if (!roundId || !Array.isArray(room.voteHistory)) return;
  room.voteHistory = room.voteHistory.filter((entry) => entry.id !== roundId);
}

// Start a fresh round. A revealed round that was never confirmed onto a ticket
// is abandoned, so it is taken back out of vote history.
function discardCurrentRound(room, hooks) {
  const roundId = confirmableRoundId(room);
  if (roundId) dropRoundFromHistory(room, roundId);
  hooks.resetRound(room);
}

function requireScrum(room) {
  if (room.mode !== "scrum") throw new TicketError(409, "Tickets work in Scrum Poker mode only.");
}

function findOpen(tickets, id) {
  return tickets.open.find((ticket) => ticket.id === id) || null;
}

// Apply one ticket action to the room. Throws TicketError on bad input.
// hooks: { createId(), nowIso(), resetRound(room) }
function applyTicketOp(room, body, hooks) {
  const tickets = ensureTickets(room);
  const op = String(body?.op ?? "");
  const id = body?.id === undefined || body?.id === null ? "" : String(body.id);

  if (op === "add") {
    if (tickets.open.length >= MAX_OPEN_TICKETS) {
      throw new TicketError(400, `A room can hold at most ${MAX_OPEN_TICKETS} tickets to estimate.`);
    }
    const ticket = cleanTicket(body.ticket, hooks.createId(), hooks.nowIso());
    if (!ticket.title) throw new TicketError(400, "A ticket needs a title.");
    tickets.open.push(ticket);
    return ticket;
  }

  if (op === "remove") {
    if (!findOpen(tickets, id)) throw new TicketError(404, "That ticket is not in the list.");
    tickets.open = tickets.open.filter((ticket) => ticket.id !== id);
    tickets.selectedIds = tickets.selectedIds.filter((selected) => selected !== id);
    return null;
  }

  if (op === "select") {
    requireScrum(room);
    if (!findOpen(tickets, id)) throw new TicketError(404, "That ticket is not in the list.");
    // Selecting only marks which tickets the round is for; several can be
    // marked at once. The round itself (votes, reveal) is left alone until it
    // is confirmed or cleared.
    if (!tickets.selectedIds.includes(id)) tickets.selectedIds.push(id);
    return null;
  }

  if (op === "unselect") {
    requireScrum(room);
    if (!findOpen(tickets, id)) throw new TicketError(404, "That ticket is not in the list.");
    // Unmarking a ticket also leaves the round alone.
    tickets.selectedIds = tickets.selectedIds.filter((selected) => selected !== id);
    return null;
  }

  if (op === "clear") {
    requireScrum(room);
    if (tickets.selectedIds.length === 0) throw new TicketError(409, "No ticket is being estimated.");
    discardCurrentRound(room, hooks);
    return null;
  }

  if (op === "confirm") {
    requireScrum(room);
    const ticket = findOpen(tickets, id);
    if (!ticket) throw new TicketError(404, "That ticket is not in the list.");
    if (!tickets.selectedIds.includes(id)) throw new TicketError(409, "Only a ticket being estimated can be confirmed.");
    if (!room.revealed) throw new TicketError(409, "Reveal the votes before confirming.");
    if (!room.revealedRoundId) throw new TicketError(409, "This round has no votes to confirm.");
    if (tickets.usedRoundIds.includes(room.revealedRoundId)) {
      throw new TicketError(409, "This round is already confirmed on a ticket.");
    }
    const round = (room.voteHistory || []).find((entry) => entry.id === room.revealedRoundId);
    if (!round) throw new TicketError(409, "This round is no longer in history.");

    // The round goes onto every marked ticket at once, each with the same votes.
    const marked = tickets.open.filter((item) => tickets.selectedIds.includes(item.id));
    const confirmedAt = hooks.nowIso();
    const votes = cleanVotes(round.votes);
    tickets.open = tickets.open.filter((item) => !tickets.selectedIds.includes(item.id));
    tickets.done.unshift(...marked.map((item) => ({ ...item, roundId: round.id, votes, confirmedAt })));
    tickets.done = tickets.done.slice(0, MAX_DONE_TICKETS);
    tickets.usedRoundIds.push(round.id);
    tickets.usedRoundIds = tickets.usedRoundIds.slice(-MAX_USED_ROUNDS);
    tickets.selectedIds = [];
    return null;
  }

  if (op === "reestimate") {
    requireScrum(room);
    const ticket = tickets.done.find((item) => item.id === id);
    if (!ticket) throw new TicketError(404, "That ticket is not in History.");
    if (tickets.open.length >= MAX_OPEN_TICKETS) {
      throw new TicketError(400, `A room can hold at most ${MAX_OPEN_TICKETS} tickets to estimate.`);
    }
    tickets.done = tickets.done.filter((item) => item.id !== id);
    // Its old votes leave History entirely, including "Other rounds".
    dropRoundFromHistory(room, ticket.roundId);
    discardCurrentRound(room, hooks);
    const { roundId, votes, confirmedAt, ...rest } = ticket;
    tickets.open.unshift(rest);
    tickets.selectedIds = [rest.id];
    return null;
  }

  if (op === "import") {
    // One-time carry-over from a browser that kept tickets in localStorage.
    // Only lands on a room that has no tickets at all, so two browsers racing
    // to upload cannot double the list.
    if (tickets.open.length > 0 || tickets.done.length > 0) {
      throw new TicketError(409, "This room already has tickets.");
    }
    const now = hooks.nowIso();
    const open = (Array.isArray(body.open) ? body.open : [])
      .map((raw) => cleanTicket(raw, hooks.createId(), now))
      .filter((ticket) => ticket.title)
      .slice(0, MAX_OPEN_TICKETS);
    const done = (Array.isArray(body.done) ? body.done : [])
      .map((raw) => ({
        ...cleanTicket(raw, hooks.createId(), now),
        roundId: null,
        votes: cleanVotes(raw?.votes),
        confirmedAt: typeof raw?.confirmedAt === "string" ? raw.confirmedAt.slice(0, 40) : now,
      }))
      .filter((ticket) => ticket.title)
      .slice(0, MAX_DONE_TICKETS);
    tickets.open = open;
    tickets.done = done;
    tickets.selectedIds = [];
    return null;
  }

  throw new TicketError(400, "Unknown ticket action.");
}

// What clients see. confirmableRoundId tells the selected ticket whether the
// revealed round can still be confirmed onto it.
function snapshotTickets(room) {
  const tickets = ensureTickets(room);
  return {
    open: tickets.open,
    done: tickets.done,
    selectedIds: tickets.selectedIds,
    usedRoundIds: tickets.usedRoundIds,
    confirmableRoundId: confirmableRoundId(room),
  };
}

module.exports = {
  MAX_OPEN_TICKETS,
  MAX_TITLE,
  MAX_LINK,
  MAX_DESCRIPTION,
  TicketError,
  emptyTickets,
  normalizeStoredTickets,
  applyTicketOp,
  snapshotTickets,
  confirmableRoundId,
};
