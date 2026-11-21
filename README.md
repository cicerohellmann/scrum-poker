# Scrum Poker

A small hosted Scrum Poker app for remote teams.

Production URL: https://sizingpoker.de

[Deploy to Render](https://render.com/deploy?repo=https://github.com/cicerohellmann/scrum-poker)

## Features

- Password-protected planning rooms.
- Auto-populated animal room names such as `Tarantula#5242`.
- Invite links for each room.
- Stable per-browser identity cookie (`scrum_poker_client`): a returning browser is always one participant — no duplicate seats — and gets a `Name#1234` discriminator so same-named people are distinguishable.
- Password-free reconnect for 14 days (sliding), plus a "Your rooms" landing that lists every room this browser can rejoin, each with room- and session-expiry countdowns.
- Per-browser room History: rooms you left or that expired stay one tap away.
- Cookie-based nickname memory for prefilling name fields.
- Live participant presence with Server-Sent Events.
- Round-table Scrum Poker room with voters seated around the table.
- Hidden votes until the host reveals.
- Center card stack for reveal, reset, and hidden poker unlock.
- Hidden Texas Hold'em mode with room-lifetime credits.
- Free-number "N" card for estimating outside the standard deck.
- Previous Scrum vote history inside each active room, including average, range, and most picked.
- Export Agenda notes correlated with vote history to a CSV for any time range (defaults to today).
- Shared per-room Agenda notepad: a day-long time rail that tracks the clock, with notes you create, edit in a floating editor, link out, drag, and resize.
- One-tap day/night theme, remembered per browser.
- Laptop-first compact layout with a mobile-friendly fallback (no horizontal overflow).
- Persistent rooms: the same URL and its history survive restarts and redeploys for 12 weeks after the last join.
- Abuse limits for active rooms, participants, and room creation rate.
- Embedded SQLite storage via Node's built-in `node:sqlite` — no external database, auth provider, or paid realtime service.

## How It Works

### Rooms

The room name field is prefilled with a simple animal name and four-digit suffix, such as `Tarantula#5242`. Users can keep it or replace it.

Creating a room also generates a short room ID and URL:

```text
https://sizingpoker.de/r/<room-id>
```

Room passwords are hashed on the server and are required to join.

Rooms are persisted to an on-disk SQLite database (see [Persistence](#persistence)) and stay reachable at the same URL across restarts. They are retained for 12 weeks after the last join (see [Room Retention](#room-retention)), then cleaned up — they are for recurring planning sessions, not permanent archival storage.

### Invites

Inside a room, the invite link is shown in the room screen. The host or any participant can use **Copy link** and send the URL to teammates.

The password is not included in the invite link. Share it separately or in a trusted team channel.

When someone opens an invite URL like:

```text
https://sizingpoker.de/r/<room-id>
```

they land in a waiting room view. That view asks for their name and the room password before they can enter the live voting room.

The invite screen is intentionally compact. It shows a focused enter-room form instead of the full create-room landing layout.

### Identity & nicknames

Two cookies work together. `scrum_poker_nickname` simply remembers the display name you last used and prefills the name fields on future visits — convenience only, no authentication.

`scrum_poker_client` is a stable, `HttpOnly` per-browser **identity**. The server issues it on first contact and slides its expiry on every authenticated request. It is the browser's identity across every room: each room maps one client id to at most one participant, so a returning browser **reattaches to its existing seat instead of creating a duplicate**. New participants also get a stable four-digit **discriminator**, shown as `Name#1234`, so two people who both pick "Plop" stay distinguishable.

### Sessions & reconnect

When you create or join a room the server records your participant under your client id. For **14 days** after you last join (`PARTICIPANT_RETENTION_DAYS`, sliding — every join resets it) that browser can **reconnect without the password**:

- Returning to a room you still hold a seat in resumes it silently (`POST /api/rooms/<id>/resume`, cookie only, no password).
- A plain **disconnect** — closing the tab, a network drop, a redeploy — keeps your seat; it stays resumable.
- Only an explicit **Leave** (below) or 14 days of inactivity removes the participant. After that, rejoining needs the password again. A cleanup pass evicts offline participants past the window.

Participant identity is persisted (id, name, discriminator, client id, token hash, last-seen), so the 14-day window survives restarts and redeploys; live state — votes, the 100 poker credits, any in-progress hand — still resets fresh.

### Your rooms

On a returning browser the landing page **does not auto-connect**. Instead it shows **Your rooms** — every room this browser still has a live session in (`GET /api/my-rooms`, cookie only) — each as a card with your `Name#1234`, a one-tap password-free **Rejoin**, a **Leave**, and two countdowns: when the **room** expires (the 84-day retention since anyone last joined) and when **your session** expires (14 days since *you* last joined). Joining resets both. When there are rooms to show, the create/join forms collapse into a slim left rail (click a heading to expand it); a brand-new browser just sees the two full create/join cards.

### Leaving a room

Pressing **Leave** is an explicit exit: the browser calls `POST /api/rooms/<id>/leave`, and the server **removes the participant record** from the room (in memory and on disk) and closes their live stream. Their seat disappears for everyone, and if they were sitting on a poker turn the hand auto-advances. This is different from simply closing the tab — a disconnect keeps the record so the seat stays resumable; only Leave (or, later, session expiry) deletes it. Coming back after Leave is a fresh join.

### History

The landing page keeps a per-browser **History** of every room this browser has ever joined, so a room you have left or that has since expired is still one tap away. History is keyed to the browser identity cookie (`scrum_poker_client`) and is stored server-side in a `client_history` table, so — unlike "Your rooms" — it **survives Leave and the 14-day session expiry**.

On a returning browser the landing shows a slim left rail; **History** is the third collapsible item under *Start a room* / *Join a room* (one open at a time), with a count badge. Expanding it reveals a scrollable list where each row is tagged with a live state, checked against the current room table:

- **Rejoinable** — the room exists and this browser still holds a seat; tapping the row resumes it password-free (`POST /api/rooms/<id>/resume`).
- **Active** — the room exists but the seat is gone (you left, or the session lapsed); tapping the row opens the prefilled enter form so you can rejoin with the password.
- **Gone** — the room has been deleted; the row is dimmed and can only be cleared.

Each row has its own **Clear (⨯)** button that drops just that entry (`POST /api/history/clear` with `{ roomId }`). A browser that has left every room still gets the rail and History — "Your rooms" simply shows a muted empty note in that case.

Endpoints (cookie only, no password):

- `GET /api/my-history` → `[{ roomId, roomName, lastJoinedAt, state }]` for this browser, newest join first.
- `POST /api/history/clear` `{ roomId }` → removes one entry from this browser's history.

History rows are written on every create/join/resume. To keep the log from growing forever, the cleanup loop prunes entries not touched within `HISTORY_RETENTION_DAYS` (default **84**). Persistence cost is one small row per browser per room joined.

### Voting

Participants choose from this deck:

```text
0, 1, 2, 3, 5, 8, 13, 21, ?, pass
```

Votes are hidden from other participants while the room is in the voting state. Each participant can see their own selected vote.

The room view is a compact round-table workspace designed to fit laptop screens. The top bar shows the room name, room ID, invite copy action, history action, and leave action. Hosts also see a selected **Host** chip there. In Scrum mode, participants line up along the bottom of the table so names and vote cards are easy to scan. In poker mode, players move back around the table in seat order. The Scrum Poker cards are the only card-picking control and appear as the hand below the table.

The table center holds a stack of cards:

- If votes are waiting, only the host can tap the stack to reveal them.
- If votes are revealed, only the host can tap the stack to reset the room for the next story.
- If nobody has voted, tapping the stack three times switches the room into hidden poker mode. The room does not show an in-table hint for this easter egg.

When a revealed vote is reset, the room stores that round in **Previous votes**. Each history entry shows the voters, their estimates, average, range, and most-picked value. History stays in the top bar, opens as a popover, stays out of the main table flow by default, and is disabled until the room has at least one saved round. History is persisted to disk with the room (see [Persistence](#persistence)), so it survives a server restart or redeploy and is available at the same room URL. A room keeps up to `MAX_VOTE_HISTORY` rounds (default `200`) — enough for a full PI of recurring planning — after which the oldest rounds roll off.

### Export

An **Export** button sits to the right of the "Previous votes" heading. It opens a small picker with a **From**/**To** range, preset to the host's current local day (today 00:00 → tomorrow 00:00), and downloads a CSV.

The CSV correlates **Agenda notes** with **vote rounds** by time. Each row is `start, end, title, url, estimations`, where `estimations` is each participant's pick joined as `Name: value` (a non-vote shows `-`). A vote round belongs to a note when its local time-of-day falls inside that note's `[start, end)` window:

- A note with one or more rounds in its window produces one row per round (same title/url repeated). The host curates the notes; the export reflects whatever is there.
- A note with no votes still appears, with an empty `estimations` cell.
- A vote round that matches no note appears as a disconnected row (its time in `start`, blank `end`/`title`/`url`).
- Time with neither a note nor a vote produces no row.

Matching is intentionally simple/best-effort — there is no fuzzy reconciliation. The export is generated entirely in the browser from the room's already-loaded notes and history (no new endpoint, no persistence, no server cost). The file is named `scrum-poker-<roomId>-<YYYY-MM-DD>.csv` (date = range start). Note times have no calendar date, so a multi-day range applies each note window to every day in the range; the default single-day range avoids that.

### Poker Mode

Poker mode replaces the Scrum Poker hand with a Texas Hold'em table. Each participant receives `100` room-lifetime credits when they join. Credits are hidden during Scrum Poker and shown only to the current player after poker mode is unlocked.

Players are shown in contained seat boxes around the table so names, cards, turn state, and blind tokens stay visually grouped. Visible playing cards use standard suit symbols. Small blind, big blind, and dealer state appear as compact corner tokens on the seat; the dealer token is kept because it still controls blind rotation and action order even though dealing is automated.

Poker mode runs in memory with the room:

- Only **online** players are seated and dealt in. Offline or duplicate records keep their credits but are never given a seat, so an absent player can't be dealt cards or block the action.
- If a seated player goes offline mid-hand, they are **auto-folded** when the action reaches their seat, so a disconnect never stalls the table.
- Dealer, small blind, and big blind are assigned each hand.
- Players receive two private hole cards.
- Betting moves clockwise through pre-flop, flop, turn, and river.
- Available actions are fold, check, call, bet, and raise.
- The table only shows the actions that are currently legal. Unavailable poker actions are hidden instead of shown disabled, and if it is not your turn the poker action row is hidden.
- The table deals three flop cards, one turn card, and one river card.
- At showdown, the server evaluates the best five-card hand and awards the pot.
- After showdown or a completed hand, tapping the center stack starts the next hand.
- Any participant can tap the center stack three times to end poker mode, reset every participant to `100` credits, clear poker cards and bets, and return the room to Scrum Poker.

### Agenda

Each room has an Agenda notepad: a ruled, day-long time rail (5-minute rows) that scrolls with the real clock. A clock icon at the top-right keeps the rail pinned to "now"; scrolling the notepad unlocks it (the clock greys out), and clicking the clock re-locks and jumps back to the current time.

**Notes.** Click an empty spot on the notepad to start a note at that time. Notes have a **Title** and an optional **Link**. When the link holds a URL, the title renders as a hyperlink (the URL is scheme-sanitised to http/https so a shared `javascript:`/`data:` link can never execute). A note can be dragged up/down to move and stretched from its top or bottom edge to change its time; hovering a note reveals trash and edit controls just outside the notepad. Dragging and tapping are distinguished by movement, so a note with a link is still draggable by its title — a **tap** on the linked title opens the URL in a new tab, while a **drag** moves the note (and does not open the link). This works the same with a mouse or by touch.

**Editing.** Creating or editing a note opens a fixed-size floating editor anchored over the note, so the Title, Link, and Set/Cancel controls are never squished by a short time-box and you don't have to resize the note to edit it. Save with **Set**, Enter on the link field, or by clicking outside the editor; back out with **Escape** or **Cancel**. There is no validation, but a brand-new note with nothing typed is discarded rather than creating an empty block.

**Sharing and persistence.** The agenda is shared with everyone in the room: notes are stored in an `agenda` column on the room, broadcast live over Server-Sent Events (per-note upsert/delete by id), and persisted with the room (see [Persistence](#persistence)), so they survive a restart or redeploy and reappear at the same room URL.

### Tickets

The **Tickets** column holds the stories to estimate. Clicking a ticket **marks** it as being estimated; clicking a marked ticket **unmarks** it. Several tickets can be marked at once. Marking and unmarking **never reset the round**: votes already cast, and a revealed round, stay on the table while you add, mark or unmark tickets.

The round only ends with **Confirm**, **Clear**, **Re-estimate** or the normal Reset on the card stack. **Confirm** (shown on each marked ticket once votes are revealed; it reads "Confirm both" or "Confirm all N" when more than one is marked) puts the revealed round onto **every marked ticket at once**, each with the same votes, and moves them all to History. **Clear** throws the round away and keeps the marks. Rooms saved before multi-marking keep their one selected ticket.

### Reveal and Reset

Any participant can use the table's center card stack to reveal pending Scrum votes or reset a revealed round. In poker mode, three taps on that same stack return the room to Scrum Poker. There is no separate host role: knowing the room password is the access control. (A dedicated host/role model may be added later.)

### Persistence

Rooms are persisted to a local SQLite database using Node's built-in `node:sqlite` (no external database or dependency). The database path is set by `DB_PATH` (default `./data/scrum-poker.db`).

Durable fields are stored: room name, password hash, creation time, the retention timestamp, vote history, the agenda, and each participant's **identity** (id, name, discriminator, client id, token hash, joined/last-seen). Persisting identity is what lets a saved session and the 14-day reconnect window survive restarts and redeploys. Live state — votes, the 100 poker credits, online/connection status, and any in-progress poker hand — is **not** persisted: after a restart the room reopens at the same URL with its history and rosters' identities intact but everyone offline (they reconnect, password-free if within their window). The per-browser join History lives in its own `client_history` table.

`node:sqlite` requires Node 22.5 or newer and prints a one-line `ExperimentalWarning` at startup, which is expected and harmless (verified on `node:22-alpine`, currently v22.23.1). The `start`/`dev` scripts pass `--experimental-sqlite` so the server boots on any Node 22.x where the module is still flag-gated as well as on newer versions where the flag is accepted but unnecessary.

### Room Retention

A room is retained for 12 weeks (84 days, `RETENTION_DAYS`) after the last time anyone joins it. Any successful join resets that window, so a room stays alive as long as the team keeps using it.

A room is deleted — from both memory and the database — only once `RETENTION_DAYS` pass with no join. Rooms are no longer deleted just for being empty, and they survive restarts and redeploys as long as the persistent disk is retained.

### Limits

Defaults:

- `MAX_ACTIVE_ROOMS=50`
- `MAX_PARTICIPANTS_PER_ROOM=40`
- `ROOM_CREATION_LIMIT=5`
- `ROOM_CREATION_WINDOW_MS=600000`
- `RETENTION_DAYS=84`
- `PARTICIPANT_RETENTION_DAYS=14`
- `HISTORY_RETENTION_DAYS=84`
- `CLEANUP_INTERVAL_MS=15000`
- `MAX_VOTE_HISTORY=200`
- `DB_PATH=./data/scrum-poker.db`

These can be changed as environment variables on Render.

If too many active rooms exist, new room creation returns:

```text
Too many active rooms right now. Try again in a minute.
```

If one IP creates too many rooms too quickly, new room creation returns:

```text
Too many rooms created from this connection. Try again later.
```

If a room reaches the participant limit, joining returns:

```text
This room is full.
```

## Run Locally

```bash
npm start
```

Open `http://localhost:3000`.

To run on another port:

```bash
PORT=3001 npm start
```

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render, create a new Blueprint from the repo.
3. Render reads `render.yaml`, installs Node dependencies, and exposes a public HTTPS URL.

The app binds to Render's `PORT` automatically and exposes `/health` for the health check.

The included Render blueprint uses the Starter web service plan so the app is not relying on a sleeping free instance.

### Persistent disk

The blueprint mounts a 1 GB persistent disk at `/data` and sets `DB_PATH=/data/scrum-poker.db` so rooms survive restarts **and** redeploys. Without a persistent disk, Render's filesystem is wiped on every deploy, so the database — and all rooms — would be lost on each commit. Attaching a disk pins the service to a single instance and makes deploys stop-then-start rather than zero-downtime, which is fine for this workload.

## Cost Shape

The app runs as one Render Starter web service plus a small (1 GB) persistent disk. It uses an on-disk SQLite database via Node's built-in `node:sqlite` — no external managed database, object storage, Redis, or paid realtime provider.

Expected normal cost is the web service cost plus the persistent disk, plus any Render bandwidth overage if the public URL is abused or receives unusually high traffic.

## License

MIT. See [LICENSE](LICENSE).
