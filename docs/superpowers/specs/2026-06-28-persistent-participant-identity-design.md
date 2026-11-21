# Persistent participant identity, room sessions, and real Leave

**Date:** 2026-06-28
**Status:** Design — awaiting review

## Problem

The poker table seats and deals **offline and duplicate participants**, which stalls
hands. Two root causes, both confirmed in code:

1. **Offline players are dealt in.** `pokerPlayers(room)` (`server.js:352`) filters
   only by `credits > 0`, ignoring the `online` flag. A participant whose tab is
   closed still gets a seat, hole cards, and a turn — and the hand waits forever for
   an action that never comes.
2. **Ghost / duplicate records accumulate.** Participant *identity* is already
   persisted (`store.js` `serializeParticipants`: `id, name, tokenHash, isHost,
   joinedAt`, restored offline on boot), but `join` has **no stable-identity
   dedup**. There is no `clientId`, so when resume fails — localStorage cleared,
   a different browser/profile, or any form-join — `addParticipant`
   (`server.js:267`) mints a **second** record with the same name *alongside* the
   persisted one (e.g. two "Plop" seats). And records are never removed except when
   the whole room is deleted: "Leave" (`app.js:996`) only closes the SSE and clears
   local storage — it never tells the server — and disconnect (`server.js:938`) only
   flips `online=false`.

## Goal

Give each browser a **stable identity** so a returning user is always *one*
participant, hold a seat across disconnects, remove it on an explicit Leave or after
inactivity, surface the rooms a browser belongs to, and never seat an offline player
in poker.

## The model (agreed rules)

1. **Join issues a persistent identity cookie.** Reconnecting within a **14-day
   window needs no password**; every join **refreshes** the window. After 14 days
   with no join, the participant is cleaned out and a return requires the password.
2. **Disconnect ≠ leave.** Closing the tab, a network drop, or a server redeploy is
   *not* leaving — the seat is held and the browser silently reconnects as the same
   participant (same name, same `#NNNN`).
3. **Leave button = real exit.** It calls the server to **delete the participant
   immediately**. Coming back is a fresh join.
4. **No ghosts, no duplicates.** A rejoin maps back to the one existing record via
   the cookie. We never leave a second record behind, and stale records are cleaned.
5. **`Name#1234` discriminator** — a stable 4-digit suffix per participant so two
   genuinely different people both named "Plop" are distinguishable. Reconnect keeps
   the same suffix.
6. **Poker seats only online players.** Offline/held seats are never dealt into a new
   hand; a player who drops mid-hand is auto-folded when the action reaches them, so
   a hand can never stall on an absent seat.
7. **Root page never auto-connects.** `/` is a deliberate home screen.
8. **Root page lists "your rooms"** (role-agnostic — for hosts managing several
   rooms and estimators across teams). Every room this cookie still has a live
   session in is shown for one-click, password-free rejoin within the window.
9. **Each listed room shows two countdowns:** time until the **room** expires
   (the 84-day retention since anyone last joined) and time until **your session**
   for it expires (the 14-day window since *you* last joined). Joining the room
   resets both.
10. **Two-state landing (one `/` route).** *State A — nothing to rejoin:* today's
    two side-by-side cards (*Start a room* | *Join a room*). *State B — you have
    rejoinable rooms:* rejoin is the hero — *Start a room* / *Join a room* demote to
    a slim left rail (buttons that expand the form in place), and the centre is your
    rejoin list (one card if a single room). Each rejoin card has **Rejoin** *and*
    **Leave**.
11. **Leave from a rejoin card** removes your session for that room (same
    `POST /leave`); the room drops out of "Your rooms" but stays in History.
12. **History.** A third left-rail button (under Start/Join) opens the list of every
    unique room this cookie has *ever* joined, each tagged with an accurate state by
    checking the room table: **Rejoinable** (room exists + live session →
    password-free), **Active** (room exists, session lapsed/left → needs password),
    or **Gone** (room deleted). This needs a server-side history log keyed by
    `clientId` that outlives the participant record.

## Architecture

### Two identity layers

- **Client identity cookie** `scrum_poker_client` — a random secret (`createId(24)`),
  `HttpOnly; SameSite=Lax; Secure; Max-Age` ≈ the session window, **sliding**
  (re-set on each authenticated request). Set by the server on first contact if
  absent. This is the stable *browser* identity; possession proves "this browser."
  One client id maps to **many** per-room participant records.
- **Per-room participant token** — the existing bearer (`participant.tokenHash`),
  returned to the client on join/resume and used unchanged for SSE/API auth
  (passed as `participantId`+`token` query params on the EventSource, see
  `app.js:218`). The cookie does not replace this; it gates *resume* and *my-rooms*.

### Participant record (additions)

```
{
  id, name,                       // name is the base; display = `${name}#${discriminator}`
  discriminator,                  // stable 4-digit string, unique within the room
  clientId,                       // NEW — the browser identity this record belongs to
  tokenHash, isHost,
  vote, credits, online,          // live only (not persisted / reset on load)
  connectionCount,                // live only
  joinedAt,
  lastSeen,                       // refreshed on join/resume/auth; drives 14-day cleanup
}
```

### Persistence

Identity is **already** persisted (`store.js` `serializeParticipants` writes
`id, name, tokenHash, isHost, joinedAt`; restored offline on boot). We **extend**
that set with `clientId`, `discriminator`, and `lastSeen` so the cookie→record
mapping and the 14-day window survive restarts/redeploys. This means adding those
three to `serializeParticipants` and the load path (`server.js:86`), plus a schema
note (they live in the existing `participants` JSON blob, so no new SQL column).

**Not** persisted (live state, reset on load exactly as today): `vote`, `credits`,
`online`, `connectionCount`, and any in-progress `poker` hand. Live state still
resets on restart; only identity is durable.

### Endpoints

- `POST /api/rooms/:id/join` (password required) — reads the client cookie. If a
  participant with this `clientId` already exists in the room, **reattach** to it
  (refresh `lastSeen`, return its token) instead of creating a duplicate. Otherwise
  create a new record stamped with `clientId` and a fresh `discriminator`. Sets the
  cookie if missing.
- `POST /api/rooms/:id/resume` (NEW, cookie only, no password) — if this `clientId`
  has a non-expired participant in the room, refresh `lastSeen` and return
  `{participant, token}`. 404/empty otherwise. Used by "your rooms" clicks and by
  `/r/:id` auto-resume.
- `GET /api/my-rooms` (NEW, cookie only) — returns
  `[{ roomId, roomName, name, discriminator, roomExpiresAt, sessionExpiresAt }]`
  for every room this `clientId` has a non-expired participant in, where
  `roomExpiresAt = room.lastJoinAt + RETENTION_DAYS` and
  `sessionExpiresAt = participant.lastSeen + PARTICIPANT_RETENTION_DAYS`. Keyed
  solely to the caller's own cookie — no cross-user exposure.
- `POST /api/rooms/:id/leave` (NEW) — delete the caller's participant from memory and
  DB, broadcast presence, then the browser returns to the home screen. Callable from
  inside the room (Leave button) and from a "Your rooms" card.
- `GET /api/my-history` (NEW, cookie only) — returns every unique room this `clientId`
  has ever joined: `[{ roomId, roomName, firstJoinedAt, lastJoinedAt, state }]` where
  `state ∈ {rejoinable, active, gone}` computed against the live room table + the
  caller's participant record. Backed by a persisted history log.

### History log

A small persisted store keyed by `clientId` — `(clientId, roomId, roomName,
firstJoinedAt, lastJoinedAt)` — written on every join, **not** removed on Leave or
participant cleanup, so it can show rooms you've left or that expired. Capped: prune
entries whose room has been **Gone** longer than a retention window
(`HISTORY_RETENTION_DAYS`, default 84) so it can't grow forever. (Storage choice —
new table vs JSON keyed by clientId — decided at implementation; a dedicated
`client_history` table is the natural fit.)

### Cleanup

Extend the existing cleanup loop (`CLEANUP_INTERVAL_MS`): in every loaded room,
remove participants whose `lastSeen` is older than `PARTICIPANT_RETENTION_DAYS`
(default **14**), then persist. Independent of the room's 84-day retention — a
room can outlive an individual's session.

### Poker seating

- `pokerPlayers(room)` → filter `p.online && p.credits > 0`.
- In the turn engine, when the action reaches a player who is `!online`, auto-fold
  them (reuse the existing fold path) and advance, so a mid-hand disconnect can't
  stall the table.

### Client

- **Cookie is transparent to the client** (HttpOnly) — the browser sends it
  automatically; JS never reads it.
- **Root `/`** never auto-connects. On load it calls `GET /api/my-rooms`. Empty →
  **State A** (today's two cards). Non-empty → **State B**: slim left rail with
  *Start a room* / *Join a room* (expand-in-place) and a **History** button, and a
  centre "Your rooms" list. Each rejoin card shows room name + `Name#1234`, two
  relative countdowns ("room expires in 11 days", "your session expires in 6 days")
  from `roomExpiresAt`/`sessionExpiresAt`, and **Rejoin** + **Leave**. Rejoin calls
  `resume`; Leave calls `POST /leave` and the card moves to History.
- **History** (left-rail button) opens `GET /api/my-history` and lists every unique
  room ever joined, tagged Rejoinable / Active / Gone; Rejoinable → `resume`,
  Active → the enter form prefilled with the room id, Gone → disabled.
- **`/r/:id`** attempts `resume` first; on success it drops straight in (no password),
  on failure it shows the existing name+password enter form.
- **Leave button** calls `POST /leave`, then clears local state and shows home.
- The existing `scrum_poker_nickname` cookie is retained for name prefill; the
  localStorage room-session resume is superseded by the cookie+`resume` flow.

## Out of scope

- A real host/role/transfer model (Leave by the original host just removes that
  record; knowing the password remains the access control).
- Persisting poker credits or in-progress hands across restarts.
- Cross-device identity (the cookie is per browser by design).

## Testing

- **Unit (store):** participants round-trip through save/reopen; live fields reset on
  load; cleanup removes only participants past `PARTICIPANT_RETENTION_DAYS`.
- **Unit/integration (server):** join with an existing `clientId` reattaches (no
  duplicate); `resume` succeeds within window and fails after expiry; `my-rooms`
  lists exactly the caller's rooms (with `roomExpiresAt`/`sessionExpiresAt`); `leave`
  deletes the record.
- **Playwright:** root page shows no room until a session exists, then lists it with
  both expiry countdowns and rejoins password-free; `/r/:id` auto-resumes a known browser and prompts an unknown
  one; Leave removes the seat and clears the list; two browsers with the same name
  show distinct `#NNNN`; **poker** seats only online players and does not stall when a
  seat goes offline (auto-fold).

## Docs (required by AGENTS.md)

Update `README.md`: replace the "Nicknames" / "Room Session Resume" sections with the
cookie-identity model, document the 14-day participant window + `PARTICIPANT_RETENTION_DAYS`,
the new endpoints, "Your rooms", real Leave, and the poker online-only seating; note that
identity is now persisted while live state still resets.
