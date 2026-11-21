(function () {
  const els = {
    connectionStatus: document.querySelector("#connectionStatus"),
    introView: document.querySelector("#introView"),
    introEyebrow: document.querySelector("#introEyebrow"),
    introTitle: document.querySelector("#introTitle"),
    introSubtitle: document.querySelector("#introSubtitle"),
    roomView: document.querySelector("#roomView"),
    yourRooms: document.querySelector("#yourRooms"),
    yourRoomsList: document.querySelector("#yourRoomsList"),
    yourRoomsEmpty: document.querySelector("#yourRoomsEmpty"),
    historyRail: document.querySelector("#historyRail"),
    historyRailList: document.querySelector("#historyRailList"),
    historyRailCount: document.querySelector("#historyRailCount"),
    createRoomForm: document.querySelector("#createRoomForm"),
    createRoomName: document.querySelector("#createRoomName"),
    joinRoomForm: document.querySelector("#joinRoomForm"),
    joinRoomId: document.querySelector("#joinRoomId"),
    joinRoomIdLabel: document.querySelector("#joinRoomIdLabel"),
    joinHeading: document.querySelector("#joinHeading"),
    joinButton: document.querySelector("#joinButton"),
    waitingRoomMeta: document.querySelector("#waitingRoomMeta"),
    introNotice: document.querySelector("#introNotice"),
    roomNotice: document.querySelector("#roomNotice"),
    topbarRoom: document.querySelector("#topbarRoom"),
    topbarActions: document.querySelector("#topbarActions"),
    whatsNewButton: document.querySelector("#whatsNewButton"),
    versionLabel: document.querySelector("#versionLabel"),
    versionDot: document.querySelector("#versionDot"),
    whatsNewModal: document.querySelector("#whatsNewModal"),
    whatsNewClose: document.querySelector("#whatsNewClose"),
    whatsNewList: document.querySelector("#whatsNewList"),
    roomTitle: document.querySelector("#roomTitle"),
    roomIdText: document.querySelector("#roomIdText"),
    roomEditButton: document.querySelector("#roomEditButton"),
    roomSettingsModal: document.querySelector("#roomSettingsModal"),
    roomSettingsClose: document.querySelector("#roomSettingsClose"),
    roomSettingsName: document.querySelector("#roomSettingsName"),
    roomSettingsSaveName: document.querySelector("#roomSettingsSaveName"),
    roomSettingsPassword: document.querySelector("#roomSettingsPassword"),
    roomSettingsSavePassword: document.querySelector("#roomSettingsSavePassword"),
    roomSettingsNotice: document.querySelector("#roomSettingsNotice"),
    teamsEditor: document.querySelector("#teamsEditor"),
    teamsList: document.querySelector("#teamsList"),
    teamAddForm: document.querySelector("#teamAddForm"),
    teamNameInput: document.querySelector("#teamNameInput"),
    teamHueInput: document.querySelector("#teamHueInput"),
    teamSwatch: document.querySelector("#teamSwatch"),
    teamBoard: document.querySelector("#teamBoard"),
    teamBoardList: document.querySelector("#teamBoardList"),
    inviteLinkInput: document.querySelector("#inviteLinkInput"),
    copyLinkButton: document.querySelector("#copyLinkButton"),
    leaveRoomButton: document.querySelector("#leaveRoomButton"),
    themeToggle: document.querySelector("#themeToggle"),
    agendaBoard: document.querySelector("#agendaBoard"),
    agendaToggle: document.querySelector("#agendaToggle"),
    agendaClock: document.querySelector("#agendaClock"),
    agendaViewport: document.querySelector("#agendaViewport"),
    agendaRail: document.querySelector("#agendaRail"),
    agendaControls: document.querySelector("#agendaControls"),
    agendaTrash: document.querySelector("#agendaTrash"),
    agendaEdit: document.querySelector("#agendaEdit"),
    agendaEditor: document.querySelector("#agendaEditor"),
    tableRoom: document.querySelector("#tableRoom"),
    hostBadge: document.querySelector("#hostBadge"),
    tableModeLabel: document.querySelector("#tableModeLabel"),
    tableTitle: document.querySelector("#tableTitle"),
    tableStackButton: document.querySelector("#tableStackButton"),
    tableStackTitle: document.querySelector("#tableStackTitle"),
    tableStackMeta: document.querySelector("#tableStackMeta"),
    communityCards: document.querySelector("#communityCards"),
    tableSeats: document.querySelector("#tableSeats"),
    tablePokerControls: document.querySelector("#tablePokerControls"),
    scrumHand: document.querySelector("#scrumHand"),
    deck: document.querySelector("#deck"),
    freeNumberPopover: document.querySelector("#freeNumberPopover"),
    freeNumberForm: document.querySelector("#freeNumberForm"),
    freeNumberInput: document.querySelector("#freeNumberInput"),
    freeNumberCancel: document.querySelector("#freeNumberCancel"),
    pokerFoldButton: document.querySelector("#pokerFoldButton"),
    pokerCheckButton: document.querySelector("#pokerCheckButton"),
    pokerCallButton: document.querySelector("#pokerCallButton"),
    pokerBetButton: document.querySelector("#pokerBetButton"),
    pokerRaiseButton: document.querySelector("#pokerRaiseButton"),
    pokerStartButton: document.querySelector("#pokerStartButton"),
    historyToggleButton: document.querySelector("#historyToggleButton"),
    historyPanel: document.querySelector("#historyPanel"),
    historyList: document.querySelector("#historyList"),
    exportButton: document.querySelector("#exportButton"),
    exportPicker: document.querySelector("#exportPicker"),
    exportFrom: document.querySelector("#exportFrom"),
    exportTo: document.querySelector("#exportTo"),
    exportCancel: document.querySelector("#exportCancel"),
    exportDownload: document.querySelector("#exportDownload"),
    ticketsLayout: document.querySelector("#ticketsLayout"),
    ticketsPanel: document.querySelector("#ticketsPanel"),
    ticketsCount: document.querySelector("#ticketsCount"),
    ticketsList: document.querySelector("#ticketsList"),
    ticketsAddButton: document.querySelector("#ticketsAddButton"),
    ticketHistoryList: document.querySelector("#ticketHistoryList"),
    historyRoundsHeading: document.querySelector("#historyRoundsHeading"),
    ticketAddModal: document.querySelector("#ticketAddModal"),
    ticketAddForm: document.querySelector("#ticketAddForm"),
    ticketAddClose: document.querySelector("#ticketAddClose"),
    ticketAddDone: document.querySelector("#ticketAddDone"),
    ticketTitleInput: document.querySelector("#ticketTitleInput"),
    ticketLinkInput: document.querySelector("#ticketLinkInput"),
    ticketDescInput: document.querySelector("#ticketDescInput"),
    ticketAddedNote: document.querySelector("#ticketAddedNote"),
  };

  const app = {
    roomId: roomIdFromPath(),
    room: null,
    session: null,
    events: null,
    reconnecting: false,
    reconnectTimeout: null,
    // Owner's staged team list while the settings modal is open.
    settingsTeams: [],
    // Participant id the remembered-team cookie was already applied for. Keyed by
    // id so it runs once per seat and a deliberate "clear team" is never fought.
    teamAutoAppliedFor: null,
    // Timestamp until which a reset tap is ignored, armed the moment votes are
    // revealed so the revealer can't instantly wipe the round with a second tap.
    revealLockUntil: 0,
    // Pending re-render that re-enables the stack once the reveal lock lifts.
    revealLockTimer: null,
  };
  const RECONNECT_GRACE_MS = 5000;
  // Grace window after a reveal during which the stack won't reset the round.
  const REVEAL_RESET_LOCK_MS = 1200;
  // Tickets prototype state (declared early: renderRoom reads it).
  const ticketCarry = { tried: new Set() };
  const ticketUi = { signature: "" };

  const NICKNAME_COOKIE = "scrum_poker_nickname";
  const TEAM_COOKIE = "scrum_poker_team";
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

  function roomIdFromPath() {
    const match = window.location.pathname.match(/^\/r\/([a-z0-9_-]+)$/);
    return match ? match[1] : "";
  }

  function sessionKey(roomId) {
    return `scrum-poker:${roomId}`;
  }

  function loadSession(roomId) {
    if (!roomId) return null;
    try {
      return JSON.parse(localStorage.getItem(sessionKey(roomId)));
    } catch {
      return null;
    }
  }

  function saveSession(roomId, participant) {
    localStorage.setItem(sessionKey(roomId), JSON.stringify(participant));
  }

  function clearSession(roomId) {
    if (roomId) localStorage.removeItem(sessionKey(roomId));
  }

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(prefix));
    if (!cookie) return "";

    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      return "";
    }
  }

  function writeCookie(name, value, maxAgeDays) {
    const maxAge = Math.max(1, maxAgeDays) * 24 * 60 * 60;
    document.cookie = [
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
      `Max-Age=${maxAge}`,
      "Path=/",
      "SameSite=Lax",
      window.location.protocol === "https:" ? "Secure" : "",
    ].filter(Boolean).join("; ");
  }

  function rememberNickname(name) {
    const nickname = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (nickname) writeCookie(NICKNAME_COOKIE, nickname, 365);
  }

  // Team colors are picked by hue alone; saturation and lightness are fixed to a
  // mid range so nothing comes out too dark or too washed-out.
  const TEAM_SATURATION = 62;
  const TEAM_LIGHTNESS = 56;

  function hueToHex(hue) {
    const s = TEAM_SATURATION / 100;
    const l = TEAM_LIGHTNESS / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((hue % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const toByte = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  }

  // A slightly lighter partner shade so the card frame reads as a gradient rather
  // than a flat fill, matching the app's existing gradient-frame look.
  function lightenHex(hex, amount = 26) {
    const value = hex.replace("#", "");
    const num = parseInt(value.length === 3
      ? value.split("").map((c) => c + c).join("")
      : value, 16);
    const clamp = (n) => Math.max(0, Math.min(255, n));
    const r = clamp(((num >> 16) & 255) + amount);
    const g = clamp(((num >> 8) & 255) + amount);
    const b = clamp((num & 255) + amount);
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }

  function roomTeams() {
    return (app.room && Array.isArray(app.room.teams)) ? app.room.teams : [];
  }

  function findTeam(teamId) {
    return roomTeams().find((team) => team.id === teamId) || null;
  }

  function randomRoomName() {
    const animal = ROOM_ANIMALS[Math.floor(Math.random() * ROOM_ANIMALS.length)];
    const id = Math.floor(1000 + Math.random() * 9000);
    return `${animal}#${id}`;
  }

  function prefillRoomName() {
    if (els.createRoomName && !els.createRoomName.value) {
      els.createRoomName.value = randomRoomName();
    }
  }

  function prefillNickname() {
    const nickname = readCookie(NICKNAME_COOKIE);
    if (!nickname) return;

    for (const input of [document.querySelector("#createName"), document.querySelector("#joinName")]) {
      if (input && !input.value) input.value = nickname;
    }
  }

  function setNotice(target, message, tone) {
    target.textContent = message || "";
    if (message && tone) {
      target.dataset.tone = tone;
    } else {
      delete target.dataset.tone;
    }
  }

  function setConnected(connected) {
    els.connectionStatus.textContent = connected ? "Online" : "Offline";
    els.connectionStatus.classList.toggle("online", connected);
  }

  async function request(path, options) {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Request failed.");
      error.status = response.status;
      error.code = typeof payload.code === "string" ? payload.code : "";
      throw error;
    }

    return payload;
  }

  function setRoute(roomId) {
    const nextPath = roomId ? `/r/${roomId}` : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    app.roomId = roomId;
  }

  function inviteLink() {
    return `${window.location.origin}/r/${app.roomId}`;
  }

  function connect() {
    if (!app.roomId || !app.session) return;
    if (app.events) app.events.close();

    const params = new URLSearchParams({
      participantId: app.session.id,
      token: app.session.token,
    });

    app.events = new EventSource(`/api/rooms/${app.roomId}/events?${params.toString()}`);

    app.events.addEventListener("open", () => {
      setConnected(true);
      setNotice(els.roomNotice, "");
    });

    app.events.addEventListener("room", (event) => {
      clearReconnectTimeout();
      app.reconnecting = false;
      const wasRevealed = app.room && app.room.revealed;
      app.room = JSON.parse(event.data);
      // Arm the reset lock on the exact false -> true reveal transition.
      if (app.room.revealed && !wasRevealed) {
        app.revealLockUntil = Date.now() + REVEAL_RESET_LOCK_MS;
      }
      renderRoom();
    });

    app.events.addEventListener("session-invalid", () => {
      disconnect();
      clearSession(app.roomId);
      app.reconnecting = false;
      app.room = null;
      app.session = null;
      showIntro();
      setNotice(els.introNotice, "Saved room session not available. Enter the room again.");
    });

    app.events.addEventListener("error", () => {
      setConnected(false);
      if (app.reconnecting && !app.room) {
        setNotice(els.introNotice, "Reconnecting to room...");
        return;
      }

      setNotice(els.roomNotice, "Connection lost. Reconnecting...");
    });
  }

  function disconnect() {
    clearReconnectTimeout();
    if (app.events) {
      app.events.close();
      app.events = null;
    }
    setConnected(false);
  }

  function clearReconnectTimeout() {
    if (app.reconnectTimeout) {
      clearTimeout(app.reconnectTimeout);
      app.reconnectTimeout = null;
    }
  }

  function startReconnectTimeout() {
    clearReconnectTimeout();
    app.reconnectTimeout = setTimeout(() => {
      if (!app.reconnecting || app.room) return;
      disconnect();
      app.reconnecting = false;
      showIntro();
      setNotice(els.introNotice, "Automatic reconnect is taking too long. Enter the room again.");
    }, RECONNECT_GRACE_MS);
  }

  function showIntro() {
    const isInvite = Boolean(app.roomId);
    const isReconnect = Boolean(app.roomId && app.session && app.reconnecting);

    document.body.classList.remove("room-active");
    els.introView.classList.remove("has-rooms"); // re-added by loadLanding on root
    if (els.yourRooms) els.yourRooms.hidden = true; // root-only; shown after fetch
    if (els.yourRoomsEmpty) els.yourRoomsEmpty.hidden = true; // root-only
    if (els.historyRail) els.historyRail.hidden = true; // root-only; shown after fetch
    els.topbarRoom.hidden = true;
    els.topbarActions.hidden = true;
    els.hostBadge.hidden = true;
    els.roomEditButton.hidden = true;
    els.introView.hidden = false;
    els.roomView.hidden = true;
    els.joinRoomId.value = app.roomId || "";
    els.joinRoomIdLabel.hidden = isInvite;
    els.waitingRoomMeta.hidden = !isInvite && !isReconnect;
    els.introView.classList.toggle("invite-mode", isInvite);
    els.createRoomForm.hidden = isInvite || isReconnect;
    els.joinRoomForm.hidden = isReconnect;

    if (isReconnect) {
      els.introEyebrow.textContent = "Reconnecting";
      els.introTitle.textContent = "Rejoining room";
      els.introSubtitle.textContent = "Restoring your saved room session.";
      els.waitingRoomMeta.textContent = `Room ${app.roomId.toUpperCase()}`;
      setNotice(els.introNotice, "Reconnecting to room...");
      setConnected(false);
      return;
    }

    els.joinRoomForm.hidden = false;
    setNotice(els.introNotice, "");

    if (isInvite) {
      els.introEyebrow.textContent = "Waiting room";
      els.introTitle.textContent = "Enter room";
      els.introSubtitle.textContent = "";
      els.joinHeading.textContent = "Enter room";
      els.joinButton.textContent = "Enter room";
      els.waitingRoomMeta.textContent = `Room ${app.roomId.toUpperCase()}`;
    } else {
      els.introEyebrow.textContent = "Planning room";
      els.introTitle.textContent = "Team Scrum Poker";
      els.introSubtitle.textContent = "Private rooms, hidden votes, clean reveals.";
      els.joinHeading.textContent = "Join a room";
      els.joinButton.textContent = "Join room";
      els.waitingRoomMeta.textContent = "";
    }

    setConnected(false);
    if (!isInvite) loadLanding();
  }

  function formatRelative(iso) {
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms)) return "";
    if (ms <= 0) return "expired";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `in ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `in ${hours} h`;
    return `in ${Math.round(hours / 24)} days`;
  }

  // Returning-browser landing: fetch both live sessions ("Your rooms") and the
  // per-browser join history, then decide State B from either being non-empty so
  // a browser that left every room still keeps the rail + History.
  async function loadLanding() {
    if (!els.yourRooms) return;
    const [rooms, history] = await Promise.all([
      request("/api/my-rooms", { method: "GET" }).then((r) => (Array.isArray(r.rooms) ? r.rooms : [])).catch(() => []),
      request("/api/my-history", { method: "GET" }).then((r) => (Array.isArray(r.history) ? r.history : [])).catch(() => []),
    ]);
    const stateB = rooms.length > 0 || history.length > 0;
    els.introView.classList.toggle("has-rooms", stateB);
    renderMyRooms(rooms, stateB);
    renderHistoryRail(history);
    // In State B with no live sessions, the hero is replaced by a muted note.
    if (els.yourRoomsEmpty) els.yourRoomsEmpty.hidden = !(stateB && !rooms.length);
  }

  function renderMyRooms(rooms, stateB) {
    els.yourRoomsList.replaceChildren();
    // The hero hides when there are no live rooms; History alone can still hold
    // State B, in which case the right column shows a muted empty note.
    els.yourRooms.hidden = !rooms.length;
    if (!rooms.length) return;
    rooms.sort((a, b) => String(b.sessionExpiresAt || "").localeCompare(String(a.sessionExpiresAt || "")));

    for (const room of rooms) {
      const card = document.createElement("div");
      card.className = "your-room-card";

      const main = document.createElement("div");
      main.className = "your-room-main";
      const title = document.createElement("strong");
      title.textContent = room.roomName || room.roomId;
      const who = document.createElement("span");
      who.className = "your-room-who";
      who.textContent = `as ${room.name}#${room.discriminator}`;
      main.append(title, who);

      const meta = document.createElement("div");
      meta.className = "your-room-meta";
      const roomExp = document.createElement("span");
      roomExp.textContent = `Room expires ${formatRelative(room.roomExpiresAt)}`;
      const sessExp = document.createElement("span");
      sessExp.textContent = `Your session expires ${formatRelative(room.sessionExpiresAt)}`;
      meta.append(roomExp, sessExp);

      const actions = document.createElement("div");
      actions.className = "your-room-actions";
      const rejoin = document.createElement("button");
      rejoin.type = "button";
      rejoin.className = "primary-button your-room-rejoin";
      rejoin.textContent = "Rejoin";
      rejoin.addEventListener("click", () => rejoinRoom(room.roomId));
      const leave = document.createElement("button");
      leave.type = "button";
      leave.className = "ghost-button your-room-leave";
      leave.textContent = "Leave";
      leave.addEventListener("click", () => leaveRoomFromList(room.roomId, leave));
      actions.append(rejoin, leave);

      // Owner-only: edit the room's name/password without entering it.
      if (room.isOwner) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "ghost-button your-room-edit";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => openRoomSettings(room.roomId, room.roomName || ""));
        actions.append(edit);
      }

      card.append(main, meta, actions);
      els.yourRoomsList.appendChild(card);
    }
  }

  // History: every unique room this browser has joined, tagged with a live state.
  // Shown only for returning browsers (non-empty). Part of the same one-open-at-a-
  // time rail accordion as Start/Join.
  const HISTORY_STATE_LABEL = {
    rejoinable: "live · rejoin →",
    active: "enter →",
    gone: "gone",
  };

  function renderHistoryRail(history) {
    if (!els.historyRail) return;
    els.historyRailList.replaceChildren();
    els.historyRail.hidden = !history.length;
    if (els.historyRailCount) {
      els.historyRailCount.hidden = !history.length;
      els.historyRailCount.textContent = history.length ? `(${history.length})` : "";
    }
    if (!history.length) {
      els.historyRail.classList.remove("expanded");
      return;
    }

    for (const entry of history) {
      const row = document.createElement("div");
      row.className = `history-rail-row state-${entry.state}`;

      const main = document.createElement("button");
      main.type = "button";
      main.className = "history-rail-main";
      main.disabled = entry.state === "gone";
      const name = document.createElement("span");
      name.className = "history-rail-name";
      name.textContent = entry.roomName || entry.roomId;
      const state = document.createElement("span");
      state.className = "history-rail-state";
      state.textContent = HISTORY_STATE_LABEL[entry.state] || entry.state;
      main.append(name, state);
      main.addEventListener("click", () => enterFromHistory(entry));

      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "history-rail-clear";
      clear.setAttribute("aria-label", `Clear ${entry.roomName || entry.roomId} from history`);
      clear.textContent = "⨯";
      clear.addEventListener("click", () => clearHistoryEntry(entry.roomId, clear));

      row.append(main, clear);
      els.historyRailList.appendChild(row);
    }
  }

  function enterFromHistory(entry) {
    if (entry.state === "gone") return;
    if (entry.state === "rejoinable") {
      rejoinRoom(entry.roomId); // live session → password-free resume
      return;
    }
    // active: room exists but the seat is gone — show the prefilled enter form.
    app.roomId = entry.roomId;
    setRoute(entry.roomId);
    showIntro();
  }

  async function clearHistoryEntry(roomId, button) {
    if (button) button.disabled = true;
    try {
      await request("/api/history/clear", { method: "POST", body: { roomId } });
    } catch {
      // best-effort; the reload reconciles
    }
    loadLanding();
  }

  async function rejoinRoom(roomId) {
    try {
      const payload = await request(`/api/rooms/${roomId}/resume`, { method: "POST", body: {} });
      app.session = payload.participant;
      app.room = payload.room;
      saveSession(roomId, payload.participant);
      setRoute(roomId);
      connect();
      renderRoom();
    } catch (error) {
      setNotice(els.introNotice, error.message || "Could not rejoin that room.");
    }
  }

  // Owner-only room settings (name + password). Ownership is enforced server-side
  // via the identity cookie, so this opens the same way in-room or from a "Your
  // rooms" card; the request carries the cookie automatically (same origin).
  function openRoomSettings(roomId, currentName) {
    app.settingsRoomId = roomId;
    els.roomSettingsName.value = currentName || "";
    els.roomSettingsPassword.value = "";
    setNotice(els.roomSettingsNotice, "");
    // Team management only makes sense for the room we're actually inside (its
    // roster + teams are loaded); from the dashboard we hide it.
    const editingCurrent = app.roomId === roomId && app.room;
    app.settingsTeams = editingCurrent
      ? (app.room.teams || []).map((team) => ({ ...team }))
      : [];
    els.teamsEditor.hidden = !editingCurrent;
    if (editingCurrent) {
      els.teamNameInput.value = "";
      els.teamHueInput.value = "210";
      updateTeamSwatch();
      renderTeamsEditor();
    }
    els.roomSettingsModal.hidden = false;
    els.roomSettingsName.focus();
  }

  function closeRoomSettings() {
    els.roomSettingsModal.hidden = true;
    app.settingsRoomId = null;
  }

  async function saveRoomName() {
    const roomId = app.settingsRoomId;
    if (!roomId) return;
    const name = els.roomSettingsName.value.trim();
    if (!name) {
      setNotice(els.roomSettingsNotice, "Room name cannot be empty.");
      return;
    }
    try {
      await request(`/api/rooms/${roomId}/rename`, { method: "POST", body: { name } });
      setNotice(els.roomSettingsNotice, "Name saved.", "success");
      // In-room the live SSE broadcast updates the title; on the dashboard, refresh
      // the card labels.
      if (app.roomId !== roomId) loadLanding();
    } catch (error) {
      setNotice(els.roomSettingsNotice, error.message || "Could not rename the room.");
    }
  }

  async function saveRoomPassword() {
    const roomId = app.settingsRoomId;
    if (!roomId) return;
    const password = els.roomSettingsPassword.value;
    if (password.trim().length < 4) {
      setNotice(els.roomSettingsNotice, "Password must be at least 4 characters.");
      return;
    }
    try {
      await request(`/api/rooms/${roomId}/password`, { method: "POST", body: { password } });
      els.roomSettingsPassword.value = "";
      setNotice(els.roomSettingsNotice, "Password changed. New joiners will need it.", "success");
    } catch (error) {
      setNotice(els.roomSettingsNotice, error.message || "Could not change the password.");
    }
  }

  // Live preview of the hue slider's resulting color on the "add" swatch.
  function updateTeamSwatch() {
    els.teamSwatch.style.background = hueToHex(Number(els.teamHueInput.value) || 0);
  }

  // Open/slashed eye SVGs for the hide toggle; CSS shows one based on state.
  const EYE_ICONS =
    '<svg class="eye-open" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>' +
    '<circle cx="12" cy="12" r="3"></circle></svg>' +
    '<svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 3l18 18"></path>' +
    '<path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.2 3.1M6.6 6.6C3.9 8.2 2 12 2 12s3.5 7 10 7a10.6 10.6 0 0 0 4-.8"></path>' +
    '<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>';

  // Render the owner's staged team list. Each row has a hide (eye) toggle and a
  // delete control; hidden teams don't sit on the table or count toward voters.
  function renderTeamsEditor() {
    els.teamsList.replaceChildren();
    if (app.settingsTeams.length === 0) {
      const empty = document.createElement("p");
      empty.className = "teams-empty";
      empty.textContent = "No teams yet. Add one below.";
      els.teamsList.appendChild(empty);
      els.teamAddForm.hidden = false;
      return;
    }

    const head = document.createElement("div");
    head.className = "teams-list-head";
    const headName = document.createElement("span");
    headName.textContent = "Team";
    const headHide = document.createElement("span");
    headHide.className = "teams-list-head-hide";
    headHide.title = "Hidden teams don't sit on the table or count toward voters";
    headHide.innerHTML = EYE_ICONS + "<span>Hide</span>";
    head.append(headName, headHide);
    els.teamsList.appendChild(head);

    app.settingsTeams.forEach((team, index) => {
      const row = document.createElement("div");
      row.className = "team-row";
      row.classList.toggle("is-hidden", team.hidden === true);

      const dot = document.createElement("span");
      dot.className = "team-row-dot";
      dot.style.background = team.color;

      const label = document.createElement("span");
      label.className = "team-row-name";
      label.textContent = team.name;

      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "team-row-eye";
      eye.classList.toggle("is-hidden", team.hidden === true);
      eye.setAttribute("aria-pressed", team.hidden === true ? "true" : "false");
      eye.setAttribute("aria-label", `${team.hidden ? "Show" : "Hide"} ${team.name} on the table`);
      eye.innerHTML = EYE_ICONS;
      eye.addEventListener("click", () => toggleTeamHidden(index));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "team-row-remove";
      remove.setAttribute("aria-label", `Remove ${team.name}`);
      remove.textContent = "✕";
      remove.addEventListener("click", () => removeTeam(index));

      row.append(dot, label, eye, remove);
      els.teamsList.appendChild(row);
    });

    els.teamAddForm.hidden = app.settingsTeams.length >= 8;
  }

  function toggleTeamHidden(index) {
    const team = app.settingsTeams[index];
    if (!team) return;
    team.hidden = !(team.hidden === true);
    renderTeamsEditor();
    saveTeams();
  }

  function addTeamFromForm() {
    const name = els.teamNameInput.value.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!name) {
      setNotice(els.roomSettingsNotice, "Give the team a name first.");
      els.teamNameInput.focus();
      return;
    }
    if (app.settingsTeams.length >= 8) return;
    const color = hueToHex(Number(els.teamHueInput.value) || 0);
    app.settingsTeams.push({ name, color });
    els.teamNameInput.value = "";
    renderTeamsEditor();
    saveTeams();
    els.teamNameInput.focus();
  }

  function removeTeam(index) {
    app.settingsTeams.splice(index, 1);
    renderTeamsEditor();
    saveTeams();
  }

  // Persist the whole staged list; the server mints ids and echoes back the
  // canonical teams, which we adopt so later edits keep stable ids.
  async function saveTeams() {
    const roomId = app.settingsRoomId;
    if (!roomId) return;
    try {
      const payload = await request(`/api/rooms/${roomId}/teams`, {
        method: "POST",
        body: { teams: app.settingsTeams },
      });
      if (payload.room && Array.isArray(payload.room.teams)) {
        app.settingsTeams = payload.room.teams.map((team) => ({ ...team }));
        renderTeamsEditor();
      }
      setNotice(els.roomSettingsNotice, "Teams updated.");
    } catch (error) {
      // The edit didn't persist — restore the authoritative list (last state the
      // server broadcast) so the UI never shows a team the server rejected.
      app.settingsTeams = (app.room && Array.isArray(app.room.teams) ? app.room.teams : []).map((team) => ({ ...team }));
      renderTeamsEditor();
      setNotice(els.roomSettingsNotice, error.message || "Could not update teams.");
    }
  }

  async function leaveRoomFromList(roomId, button) {
    if (button) button.disabled = true;
    try {
      await request(`/api/rooms/${roomId}/leave`, { method: "POST", body: {} });
      clearSession(roomId);
    } catch {
      // best-effort; the list re-fetch reconciles
    }
    loadLanding();
  }

  // In State B the create/join forms are a collapsed accordion in the left rail:
  // clicking a heading expands that form's fields and collapses the other.
  function setupFormAccordion() {
    const forms = [els.createRoomForm, els.joinRoomForm, els.historyRail].filter(Boolean);
    for (const form of forms) {
      const heading = form.querySelector(".surface-heading");
      if (!heading) continue;
      heading.addEventListener("click", () => {
        if (!els.introView.classList.contains("has-rooms")) return;
        const willExpand = !form.classList.contains("expanded");
        for (const other of forms) other.classList.remove("expanded");
        if (willExpand) form.classList.add("expanded");
      });
    }
  }

  // In-app release notes: a version chip opens a "What's new" dialog, with an
  // unseen dot until the browser has opened the current release.
  const SEEN_RELEASE_KEY = "scrum-poker:seen-release";

  function setupWhatsNew() {
    const releases = Array.isArray(window.SCRUM_RELEASES) ? window.SCRUM_RELEASES : [];
    if (!releases.length || !els.whatsNewButton) return;

    const latest = releases[0].version;
    if (els.versionLabel) els.versionLabel.textContent = `v${latest}`;
    // Update the version number quietly — no attention-grabbing "unseen" dot.
    // What's new stays available on demand by tapping the version chip.
    if (els.versionDot) els.versionDot.hidden = true;

    els.whatsNewList.replaceChildren();
    for (const release of releases) {
      const block = document.createElement("div");
      block.className = "whatsnew-release";

      const heading = document.createElement("div");
      heading.className = "whatsnew-release-head";
      const version = document.createElement("strong");
      version.textContent = `v${release.version}`;
      const date = document.createElement("span");
      date.className = "whatsnew-date";
      date.textContent = release.date || "";
      heading.append(version, date);

      const list = document.createElement("ul");
      for (const item of release.items || []) {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      }

      block.append(heading, list);
      els.whatsNewList.appendChild(block);
    }

    const open = () => {
      els.whatsNewModal.hidden = false;
      try {
        localStorage.setItem(SEEN_RELEASE_KEY, latest);
      } catch {
        // ignore storage failures (private mode)
      }
      if (els.versionDot) els.versionDot.hidden = true;
    };
    const close = () => {
      els.whatsNewModal.hidden = true;
    };

    els.whatsNewButton.addEventListener("click", open);
    els.whatsNewClose.addEventListener("click", close);
    els.whatsNewModal.addEventListener("click", (event) => {
      if (event.target === els.whatsNewModal) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.whatsNewModal.hidden) close();
    });
  }

  function showRoomShell() {
    document.body.classList.add("room-active");
    els.topbarRoom.hidden = false;
    els.topbarActions.hidden = false;
    els.introView.hidden = true;
    els.roomView.hidden = false;
    if (typeof tickAgenda === "function") tickAgenda();
  }

  function renderRoom() {
    if (!app.room || !app.session) {
      showIntro();
      return;
    }

    showRoomShell();
    const mode = app.room.mode || "scrum";
    const allParticipants = app.room.participants || [];
    const me = allParticipants.find((participant) => participant.id === app.session.id);
    // Members of a team the owner marked hidden don't sit on the table and aren't
    // counted toward voters — drop them from the list that drives seats + totals.
    // (me is resolved above from the full list, so a hidden viewer keeps their deck.)
    const hiddenTeamIds = new Set((app.room.teams || []).filter((team) => team.hidden).map((team) => team.id));
    const isVisible = (participant) => !hiddenTeamIds.has(participant.team);
    // In Scrum mode only people currently connected are shown and counted, so a
    // closed tab removes that player from the room like joining adds them.
    const participants = (mode === "poker"
      ? allParticipants
      : allParticipants.filter((participant) => participant.online)
    ).filter(isVisible);
    const votedCount = participants.filter((participant) => participant.hasVote).length;
    const isOwner = Boolean(me && me.isOwner);

    els.tableRoom.dataset.mode = mode;
    els.roomTitle.textContent = app.room.name;
    els.roomIdText.textContent = app.room.id;
    els.inviteLinkInput.value = inviteLink();
    els.hostBadge.hidden = !isOwner;
    els.roomEditButton.hidden = !isOwner;
    els.scrumHand.hidden = mode !== "scrum";
    els.tablePokerControls.hidden = mode !== "poker";
    els.ticketsLayout.dataset.mode = mode;
    els.ticketsPanel.hidden = mode !== "scrum";
    renderHistoryToggle(mode);

    if (mode === "poker") {
      renderPokerMode(participants, me);
    } else {
      renderScrumMode(participants, votedCount, me);
    }

    renderTableSeats(participants, me);
    renderHistory();
    renderTickets();
    syncAgendaFromRoom();
  }

  function renderScrumMode(participants, votedCount, me) {
    els.tableModeLabel.textContent = "Scrum Poker";
    els.tableTitle.textContent = app.room.revealed ? "Votes revealed" : "Pick your estimate";

    clearTimeout(app.revealLockTimer);
    if (app.room.revealed) {
      els.tableStackTitle.textContent = "Reset";
      // Brief grace after revealing: the reset is locked so a second tap on the
      // same spot can't wipe the round. Re-render when the lock lifts to re-arm it.
      const lockRemaining = app.revealLockUntil - Date.now();
      if (lockRemaining > 0) {
        els.tableStackButton.disabled = true;
        els.tableStackMeta.textContent = "Take a moment...";
        app.revealLockTimer = setTimeout(renderRoom, lockRemaining);
      } else {
        els.tableStackButton.disabled = false;
        els.tableStackMeta.textContent = "Start the next story";
      }
    } else if (votedCount > 0) {
      els.tableStackButton.disabled = false;
      els.tableStackTitle.textContent = "Reveal";
      els.tableStackMeta.textContent = `${votedCount}/${participants.length} voted`;
    } else {
      els.tableStackButton.disabled = false;
      els.tableStackTitle.textContent = "Card stack";
      els.tableStackMeta.textContent = "";
    }

    els.communityCards.replaceChildren();
    els.communityCards.hidden = true;
    renderTeamBoard(me);
    renderScrumDeck(me);
  }

  function renderPokerMode(participants, me) {
    const poker = app.room.poker || {};
    const myPoker = poker.players?.find((player) => player.participantId === app.session.id);

    els.tableModeLabel.textContent = "Texas Hold'em";
    els.tableTitle.textContent = poker.message || "Poker mode";
    els.tableStackButton.disabled = false;
    els.tableStackTitle.textContent = "Card stack";
    els.tableStackMeta.textContent = titleCase(poker.phase || "waiting");

    renderCommunityCards(poker.communityCards || []);
    els.tablePokerControls.hidden = !renderPokerActions(poker, myPoker);
  }

  function renderScrumDeck(me) {
    els.deck.replaceChildren();
    const selectedVote = me ? me.vote : null;

    for (const value of app.room.votingScale) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vote-card";
      button.dataset.value = value === "pass" ? "P" : value;
      button.setAttribute("aria-label", `Vote ${value}`);
      button.disabled = app.room.revealed;
      button.classList.toggle("long-value", value.length > 2);
      button.classList.toggle("word-card", value === "pass"); // word label, sized like clear/Teams
      button.classList.toggle("selected", selectedVote === value);
      button.addEventListener("click", () => castVote(value));

      const label = document.createElement("span");
      label.className = "vote-card-value";
      label.textContent = value;
      button.appendChild(label);

      els.deck.appendChild(button);
    }

    // Free-number "N" card at the right of the deck for arbitrary estimates.
    const isFreeNumber = selectedVote !== null && !app.room.votingScale.includes(selectedVote);
    const nCard = document.createElement("button");
    nCard.type = "button";
    nCard.className = "vote-card free-number-card";
    nCard.id = "freeNumberCard";
    nCard.dataset.value = "N";
    nCard.setAttribute("aria-label", "Vote a custom number");
    nCard.disabled = app.room.revealed;
    nCard.classList.toggle("selected", isFreeNumber);
    nCard.classList.toggle("long-value", isFreeNumber && selectedVote.length > 2);

    const nLabel = document.createElement("span");
    nLabel.className = "vote-card-value";
    nLabel.textContent = isFreeNumber ? selectedVote : "N";
    nCard.appendChild(nLabel);

    nCard.addEventListener("click", () => openFreeNumberInput(isFreeNumber ? selectedVote : ""));
    els.deck.appendChild(nCard);

    // "clear" card at the far right of the deck — clears the viewer's own vote.
    // Disabled when there is nothing to clear (revealed round, or no vote yet).
    const clearCard = document.createElement("button");
    clearCard.type = "button";
    clearCard.className = "vote-card clear-card word-card";
    clearCard.setAttribute("aria-label", "Clear your vote");
    clearCard.addEventListener("click", clearVote);

    const clearLabel = document.createElement("span");
    clearLabel.className = "vote-card-value";
    clearLabel.textContent = "clear";
    clearCard.appendChild(clearLabel);

    els.deck.appendChild(clearCard);

    // "Teams" card at the far right — the viewer's own team board. Only shown
    // when the room has teams; its dot carries the viewer's current team color.
    if (me && roomTeams().length > 0) {
      const myTeam = me.team ? findTeam(me.team) : null;
      const teamsCard = document.createElement("button");
      teamsCard.type = "button";
      teamsCard.className = "vote-card teams-card word-card";
      teamsCard.setAttribute("aria-label", "Your team");
      teamsCard.setAttribute("aria-haspopup", "dialog");
      if (myTeam) teamsCard.style.setProperty("--my-team", myTeam.color);

      const inner = document.createElement("span");
      inner.className = "teams-card-inner";
      const dot = document.createElement("span");
      dot.className = myTeam ? "teams-card-dot" : "teams-card-dot empty";
      const teamsLabel = document.createElement("span");
      teamsLabel.className = "vote-card-value";
      teamsLabel.textContent = "Teams";
      inner.appendChild(dot);
      inner.appendChild(teamsLabel);
      teamsCard.appendChild(inner);

      teamsCard.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleTeamBoard(teamsCard);
      });
      els.deck.appendChild(teamsCard);
    }
  }

  function renderCommunityCards(cards) {
    els.communityCards.replaceChildren();
    els.communityCards.hidden = false;

    for (let index = 0; index < 5; index += 1) {
      els.communityCards.appendChild(createPlayingCard(cards[index] || null));
    }
  }

  function renderPokerActions(poker, myPoker) {
    const phase = poker.phase || "waiting";
    const canAct = Boolean(myPoker && poker.currentTurnParticipantId === app.session.id && !["waiting", "complete", "showdown"].includes(phase));
    const callAmount = Math.max(0, (poker.currentBet || 0) - (myPoker?.bet || 0));
    const buttons = [
      els.pokerFoldButton,
      els.pokerCheckButton,
      els.pokerCallButton,
      els.pokerBetButton,
      els.pokerRaiseButton,
      els.pokerStartButton,
    ];

    for (const button of buttons) {
      button.hidden = true;
      button.disabled = false;
    }

    if (poker.canStartNextHand && (poker.players || []).length >= 2) {
      els.pokerStartButton.hidden = false;
      return true;
    }

    if (poker.canStartNextHand) {
      return false;
    }

    if (!canAct) {
      return false;
    }

    els.pokerFoldButton.hidden = false;

    if (callAmount > 0) {
      els.pokerCallButton.hidden = false;
      els.pokerRaiseButton.hidden = false;
      els.pokerCallButton.textContent = `Call ${callAmount}`;
      return true;
    }

    els.pokerCheckButton.hidden = false;
    els.pokerBetButton.hidden = false;
    els.pokerCallButton.textContent = "Call";
    return true;
  }

  function renderTableSeats(participants, me) {
    els.tableSeats.replaceChildren();
    const poker = app.room.poker;
    const isPokerMode = (app.room.mode || "scrum") === "poker";
    const seatedParticipants = isPokerMode ? sortPokerSeats(participants, poker, me?.id) : participants;
    const total = seatedParticipants.length;

    els.tableSeats.classList.toggle("scrum-lineup", !isPokerMode);
    els.tableSeats.classList.toggle("poker-ring", isPokerMode);
    els.tableSeats.classList.toggle("dense", total > 8);
    els.tableSeats.classList.toggle("crowded", total > 14);

    seatedParticipants.forEach((participant, index) => {
      const pokerPlayer = poker?.players?.find((player) => player.participantId === participant.id);
      const seat = document.createElement("div");
      seat.className = "table-seat";
      seat.classList.toggle("current-user", participant.id === me?.id);
      seat.classList.toggle("host-seat", participant.isHost);
      seat.classList.toggle("voted", participant.hasVote || Boolean(pokerPlayer?.cards?.length));
      seat.classList.toggle("is-turn", pokerPlayer?.isTurn);
      seat.classList.toggle("folded", pokerPlayer?.folded);
      if (isPokerMode) positionTableSeat(seat, index, total);

      const cards = document.createElement("div");
      cards.className = "seat-cards";
      if (app.room.mode === "poker") {
        const holeCards = pokerPlayer?.cards?.length ? pokerPlayer.cards : [null, null];
        for (const card of holeCards) cards.appendChild(createPlayingCard(card));
      } else {
        cards.appendChild(createScrumSeatCard(participant));
      }

      const name = document.createElement("span");
      name.className = "seat-name";
      name.textContent = participant.discriminator
        ? `${participant.name}#${participant.discriminator}`
        : participant.name;

      const badges = document.createElement("div");
      badges.className = "seat-badges";
      badges.hidden = !pokerPlayer?.role;
      for (const role of pokerRoleTokens(pokerPlayer?.role)) {
        const badge = document.createElement("span");
        badge.className = "seat-role";
        badge.textContent = role;
        badges.appendChild(badge);
      }

      seat.append(badges, cards, name);
      // Poker keeps a state line (folded / turn / bet); Scrum is just card + name.
      if (isPokerMode) {
        const meta = document.createElement("span");
        meta.className = "seat-state";
        meta.textContent = seatMeta(participant, pokerPlayer);
        seat.append(meta);
      }
      els.tableSeats.appendChild(seat);
    });
  }

  function sortPokerSeats(participants, poker, viewerId) {
    if (!poker?.players?.length) return participants;

    const ordered = [...participants].sort((a, b) => {
      const pokerOrder = new Map(poker.players.map((player, index) => [player.participantId, index]));
      const aIndex = pokerOrder.has(a.id) ? pokerOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bIndex = pokerOrder.has(b.id) ? pokerOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.joinedAt.localeCompare(b.joinedAt);
    });

    if (!viewerId) return ordered;
    const viewerIndex = ordered.findIndex((participant) => participant.id === viewerId);
    if (viewerIndex <= 0) return ordered;
    return [...ordered.slice(viewerIndex), ...ordered.slice(0, viewerIndex)];
  }

  // Three visual states, carried by the card alone (no state text):
  //   revealed    -> the value, in gradient text
  //   hidden-vote -> voted but not revealed, a gradient dot
  //   empty       -> waiting, a dim frame
  function createScrumSeatCard(participant) {
    const card = document.createElement("span");
    card.className = "seat-card";
    const team = findTeam(participant.team);
    if (team) {
      card.classList.add("has-team");
      card.style.setProperty("--team-color", team.color);
      card.style.setProperty("--team-color-2", lightenHex(team.color));
    }
    if (participant.vote != null) {
      card.classList.add("revealed");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = participant.vote;
      card.appendChild(num);
    } else if (participant.hasVote) {
      card.classList.add("hidden-vote");
    } else {
      card.classList.add("empty");
    }
    return card;
  }

  function createPlayingCard(card) {
    const element = document.createElement("span");
    element.className = "playing-card play-card";
    if (!card) {
      element.classList.add("face-down");
      element.textContent = "";
      return element;
    }

    const rank = displayPokerRank(card.slice(0, -1).toUpperCase());
    const suit = card.slice(-1).toLowerCase();
    const symbol = suitSymbol(suit);

    element.dataset.suit = symbol;
    element.dataset.suitCode = suit;
    element.dataset.rank = rank;

    const topCorner = document.createElement("span");
    topCorner.className = "playing-card-corner playing-card-corner-top";
    topCorner.textContent = symbol;

    const centerRank = document.createElement("span");
    centerRank.className = "playing-card-rank rank";
    centerRank.textContent = rank;

    const bottomCorner = document.createElement("span");
    bottomCorner.className = "playing-card-corner playing-card-corner-bottom";
    bottomCorner.textContent = symbol;

    element.append(topCorner, centerRank, bottomCorner);
    return element;
  }

  function suitSymbol(suit) {
    return {
      h: "\u2665",
      d: "\u2666",
      c: "\u2663",
      s: "\u2660",
    }[suit] || suit.toUpperCase();
  }

  function displayPokerRank(rank) {
    return rank === "T" ? "10" : rank;
  }

  function pokerRoleTokens(role) {
    return String(role || "")
      .split(/\s+/)
      .filter(Boolean);
  }

  function seatMeta(participant, pokerPlayer) {
    if (app.room.mode !== "poker") {
      if (app.room.revealed && !participant.hasVote) return "No vote";
      return participant.hasVote ? "Voted" : "Waiting";
    }
    if (!pokerPlayer) return "Sitting out";
    if (pokerPlayer.folded) return "Folded";
    if (pokerPlayer.isTurn) return "Turn";
    if (pokerPlayer.allIn) return "All in";
    if (pokerPlayer.bet > 0) return `Bet ${pokerPlayer.bet}`;
    return "Playing";
  }

  function positionTableSeat(seat, index, total) {
    if (total <= 0) return;

    const isShort = window.matchMedia("(max-height: 760px)").matches;
    const shortLayouts = {
      2: [
        { x: 50, y: 86 },
        { x: 50, y: 18 },
      ],
      3: [
        { x: 50, y: 86 },
        { x: 24, y: 26 },
        { x: 76, y: 26 },
      ],
      4: [
        { x: 50, y: 86 },
        { x: 20, y: 54 },
        { x: 50, y: 18 },
        { x: 80, y: 54 },
      ],
    };

    if (isShort && shortLayouts[total]?.[index]) {
      const { x, y } = shortLayouts[total][index];
      seat.style.left = `${x}%`;
      seat.style.top = `${y}%`;
      return;
    }

    const angle = total === 1 ? 90 : 90 + (index * 360) / total;
    const radians = (angle * Math.PI) / 180;
    const isNarrow = window.matchMedia("(max-width: 620px)").matches;
    const isCompactLaptop = !isNarrow && window.matchMedia("(max-width: 1120px)").matches;
    const xRadius = isNarrow ? 35 : isCompactLaptop ? 42 : 42;
    const yRadius = isNarrow ? 30 : isCompactLaptop ? 34 : 32;
    const yCenter = isNarrow ? 55 : isCompactLaptop ? 52 : 53;
    const x = 50 + Math.cos(radians) * xRadius;
    const y = yCenter + Math.sin(radians) * yRadius;

    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;
  }

  function titleCase(value) {
    return String(value || "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function renderHistory() {
    els.historyList.replaceChildren();
    els.ticketHistoryList.replaceChildren();

    if ((app.room.mode || "scrum") !== "scrum") return;

    const store = ticketStore();
    maybeCarryOverTickets(store);
    for (const ticket of store.done) {
      const card = buildHistoryCard({
        title: ticket.title,
        link: ticket.link,
        votes: ticket.votes,
      });
      const redo = document.createElement("button");
      redo.type = "button";
      redo.className = "ghost-button history-card-redo";
      redo.textContent = "Re-estimate";
      redo.addEventListener("click", () => reEstimateTicket(ticket.id));
      card.appendChild(redo);
      els.ticketHistoryList.appendChild(card);
    }
    if (store.done.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tickets-empty";
      empty.textContent = "No tickets estimated yet. Confirm a revealed round on a ticket to see it here.";
      els.ticketHistoryList.appendChild(empty);
    }

    const rounds = plainHistoryRounds();
    els.historyRoundsHeading.hidden = rounds.length === 0;
    for (const entry of rounds) {
      els.historyList.appendChild(buildHistoryCard({
        title: `Round at ${formatHistoryTime(entry.createdAt)}`,
        votes: (entry.votes || []).filter((v) => v.value !== null),
        plain: true,
      }));
    }
  }

  // Vote-history rounds that were not confirmed onto a ticket.
  function plainHistoryRounds() {
    const store = ticketStore();
    const attached = new Set([...store.usedRoundIds, ...store.done.map((ticket) => ticket.roundId)]);
    return (app.room?.voteHistory || []).filter((entry) => !attached.has(entry.id));
  }

  function buildHistoryCard({ title, link, votes, plain }) {
    const card = document.createElement("article");
    card.className = plain ? "history-card plain" : "history-card";

    const text = document.createElement("div");
    text.className = "history-card-text";
    const heading = document.createElement("strong");
    heading.className = "history-card-title";
    heading.textContent = title;
    text.appendChild(heading);
    if (link) text.appendChild(buildTicketLink(link));

    const chips = document.createElement("div");
    chips.className = "history-votes history-card-chips";
    for (const vote of votes || []) {
      const chip = document.createElement("span");
      chip.textContent = `${vote.name}: ${vote.value}`;
      chips.appendChild(chip);
    }

    card.append(text, chips);
    return card;
  }

  function renderHistoryToggle(mode) {
    const isScrumMode = mode === "scrum";
    // Confirmed tickets count too, otherwise a room whose rounds all went onto
    // tickets would lock the panel shut.
    const historyCount = ticketStore().done.length + plainHistoryRounds().length;
    const hasHistory = isScrumMode && historyCount > 0;
    els.historyToggleButton.hidden = !isScrumMode;
    els.historyToggleButton.disabled = !hasHistory;

    if (!isScrumMode) {
      setHistoryOpen(false);
      return;
    }

    if (!hasHistory) {
      els.historyToggleButton.textContent = "History";
      setHistoryOpen(false);
      return;
    }

    els.historyToggleButton.textContent = `History (${historyCount})`;
    els.historyToggleButton.setAttribute("aria-expanded", String(!els.historyPanel.hidden));
  }

  function setHistoryOpen(open) {
    els.historyPanel.hidden = !open;
    els.ticketsLayout.classList.toggle("history-open", open);
    els.historyToggleButton.setAttribute("aria-expanded", String(open));
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Previous round";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // <input type="datetime-local"> value for a local Date (no timezone suffix).
  function toLocalInputValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  // Anchor the fixed picker under the Export button (right-aligned), clamped to
  // the viewport so it never spills off-screen.
  function positionExportPicker() {
    if (els.exportPicker.hidden) return;
    const btn = els.exportButton.getBoundingClientRect();
    const picker = els.exportPicker.getBoundingClientRect();
    const margin = 8;
    let top = btn.bottom + margin;
    if (top + picker.height > window.innerHeight - margin) {
      top = Math.max(margin, btn.top - margin - picker.height);
    }
    let left = btn.right - picker.width;
    left = Math.min(Math.max(margin, left), window.innerWidth - picker.width - margin);
    els.exportPicker.style.top = `${top}px`;
    els.exportPicker.style.left = `${left}px`;
  }

  function setExportPickerOpen(open) {
    els.exportPicker.hidden = !open;
    els.exportButton.setAttribute("aria-expanded", String(open));
    if (!open) return;
    // Preset to the host's current local day: today 00:00 -> tomorrow 00:00.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    els.exportFrom.value = toLocalInputValue(start);
    els.exportTo.value = toLocalInputValue(end);
    positionExportPicker();
  }

  function downloadExportCsv() {
    if (!window.ScrumExport || !app.room) return;
    const fromTs = els.exportFrom.value ? new Date(els.exportFrom.value).getTime() : undefined;
    const toTs = els.exportTo.value ? new Date(els.exportTo.value).getTime() : undefined;
    const rows = window.ScrumExport.buildExportRows(
      app.room.voteHistory || [],
      app.room.agenda || [],
      { fromTs, toTs, tzOffsetMin: new Date().getTimezoneOffset(), tickets: app.room.tickets },
    );
    const csv = window.ScrumExport.toCsv(rows);

    const day = els.exportFrom.value ? els.exportFrom.value.slice(0, 10) : "export";
    const filename = `scrum-poker-${app.roomId || "room"}-${day}.csv`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportPickerOpen(false);
  }

  async function castVote(value) {
    try {
      setNotice(els.roomNotice, "");
      await request(`/api/rooms/${app.roomId}/vote`, {
        method: "POST",
        token: app.session.token,
        body: {
          participantId: app.session.id,
          value,
        },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message);
    }
  }

  // The player's own team board: options behind the "Teams" card in the deck
  // (see renderScrumDeck). Populates the popover list and applies the
  // remembered-team cookie once. Hidden when the room has no teams configured.
  function renderTeamBoard(me) {
    const teams = roomTeams();
    if (!me || teams.length === 0) {
      closeTeamBoard();
      els.teamBoard.hidden = true;
      els.teamBoardList.replaceChildren();
      return;
    }
    els.teamBoard.hidden = false;
    els.teamBoardList.replaceChildren();

    const makeOption = (team) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "team-opt";
      const selected = team ? me.team === team.id : !me.team;
      option.classList.toggle("selected", selected);
      if (team) option.style.setProperty("--team-color", team.color);
      const dot = document.createElement("span");
      dot.className = team ? "team-opt-dot" : "team-opt-dot none";
      option.appendChild(dot);
      const label = document.createElement("span");
      label.textContent = team ? team.name : "No team";
      option.appendChild(label);
      option.addEventListener("click", () => {
        setTeam(team ? team.id : null);
        closeTeamBoard();
      });
      return option;
    };

    els.teamBoardList.appendChild(makeOption(null));
    for (const team of teams) els.teamBoardList.appendChild(makeOption(team));

    // One-shot: if this player has no team yet, adopt the remembered one when a
    // team of the same name exists here. Never overrides a deliberate clear.
    if (app.teamAutoAppliedFor !== me.id) {
      app.teamAutoAppliedFor = me.id;
      if (!me.team) {
        const remembered = readCookie(TEAM_COOKIE).trim().toLowerCase();
        const match = remembered
          ? teams.find((team) => team.name.trim().toLowerCase() === remembered)
          : null;
        if (match) setTeam(match.id);
      }
    }
  }

  // The team board is a fixed popover (like the free-number one) so no ancestor
  // overflow clips it. It opens upward from the "Teams" card at the bottom deck.
  function toggleTeamBoard(anchor) {
    if (els.teamBoard.classList.contains("open")) {
      closeTeamBoard();
      return;
    }
    els.teamBoard.classList.add("open");
    positionTeamBoard(anchor);
    document.addEventListener("click", handleTeamBoardOutside);
    document.addEventListener("keydown", handleTeamBoardKey);
  }

  function closeTeamBoard() {
    els.teamBoard.classList.remove("open");
    document.removeEventListener("click", handleTeamBoardOutside);
    document.removeEventListener("keydown", handleTeamBoardKey);
  }

  function positionTeamBoard(anchor) {
    const a = anchor.getBoundingClientRect();
    const bw = els.teamBoard.offsetWidth;
    const bh = els.teamBoard.offsetHeight;
    let left = a.left + a.width / 2 - bw / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - bw - 10));
    let top = Math.max(10, a.top - bh - 10); // open above the card, kept on-screen
    els.teamBoard.style.left = `${left}px`;
    els.teamBoard.style.top = `${top}px`;
  }

  function handleTeamBoardOutside(event) {
    if (els.teamBoard.contains(event.target)) return;
    if (event.target.closest(".teams-card")) return;
    closeTeamBoard();
  }

  function handleTeamBoardKey(event) {
    if (event.key === "Escape") closeTeamBoard();
  }

  async function setTeam(teamId) {
    if (!app.session) return;
    const team = teamId ? findTeam(teamId) : null;
    // Remember by name so a future room with the same team name re-applies it;
    // clearing the team also clears the memory.
    writeCookie(TEAM_COOKIE, team ? team.name : "", 365);
    try {
      setNotice(els.roomNotice, "");
      await request(`/api/rooms/${app.roomId}/team`, {
        method: "POST",
        token: app.session.token,
        body: { participantId: app.session.id, team: teamId },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message || "Could not set team.");
    }
  }

  const MAX_FREE_VOTE = 100000;

  function openFreeNumberInput(currentValue) {
    if (app.room && app.room.revealed) return;
    els.freeNumberInput.value = currentValue || "";
    els.freeNumberPopover.hidden = false;
    positionFreeNumberPopover();
    els.freeNumberInput.focus();
    els.freeNumberInput.select();
    syncFreeNumberToKeyboard();
  }

  function closeFreeNumberInput() {
    els.freeNumberPopover.hidden = true;
    els.freeNumberPopover.style.bottom = "";
  }

  function submitFreeNumber() {
    const raw = els.freeNumberInput.value.trim();
    if (!/^\d+$/.test(raw)) return;
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 0 || number > MAX_FREE_VOTE) return;
    castVote(String(number));
    closeFreeNumberInput();
  }

  function positionFreeNumberPopover() {
    const pop = els.freeNumberPopover;
    const card = document.getElementById("freeNumberCard");

    // Mobile: pin to the bottom so the field rides on top of the soft keyboard.
    if (window.innerWidth <= 620) {
      pop.classList.add("free-number-popover--mobile");
      pop.style.left = "";
      pop.style.top = "";
      return;
    }

    // Desktop: float just above the N card.
    pop.classList.remove("free-number-popover--mobile");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - popRect.width / 2),
      window.innerWidth - popRect.width - 8,
    );
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, rect.top - popRect.height - 10)}px`;
  }

  function syncFreeNumberToKeyboard() {
    const pop = els.freeNumberPopover;
    if (pop.hidden || !pop.classList.contains("free-number-popover--mobile")) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const bottomInset = window.innerHeight - (vv.height + vv.offsetTop);
    pop.style.bottom = `${Math.max(0, bottomInset)}px`;
  }

  async function clearVote() {
    // No-op when there is nothing to clear (a revealed round is locked), so the
    // always-enabled clear card never errors.
    if (!app.room || app.room.revealed) return;
    try {
      setNotice(els.roomNotice, "");
      await request(`/api/rooms/${app.roomId}/vote`, {
        method: "POST",
        token: app.session.token,
        body: {
          participantId: app.session.id,
          value: null,
        },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message);
    }
  }

  async function tapStack() {
    // Ignore a reset tap in the grace window right after a reveal, so an eager
    // second tap on the same spot (now labeled Reset) can't wipe the round.
    if (app.room && app.room.revealed && Date.now() < app.revealLockUntil) return;
    try {
      setNotice(els.roomNotice, "");
      await request(`/api/rooms/${app.roomId}/stack`, {
        method: "POST",
        token: app.session.token,
        body: {
          participantId: app.session.id,
        },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message);
    }
  }

  async function pokerAction(pokerAction, amount) {
    try {
      setNotice(els.roomNotice, "");
      await request(`/api/rooms/${app.roomId}/poker`, {
        method: "POST",
        token: app.session.token,
        body: {
          participantId: app.session.id,
          pokerAction,
          amount,
        },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message);
    }
  }

  async function copyInviteLink() {
    const link = inviteLink();

    try {
      await navigator.clipboard.writeText(link);
      setNotice(els.roomNotice, "Invite link copied.", "success");
    } catch {
      setNotice(els.roomNotice, link, "info");
    }
  }

  els.createRoomForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    app.reconnecting = false;
    setNotice(els.introNotice, "");

    const form = new FormData(els.createRoomForm);

    try {
      const payload = await request("/api/rooms", {
        method: "POST",
        body: {
          roomName: form.get("roomName"),
          name: form.get("name"),
          password: form.get("password"),
        },
      });

      app.session = payload.participant;
      app.room = payload.room;
      rememberNickname(form.get("name"));
      saveSession(payload.room.id, payload.participant);
      setRoute(payload.room.id);
      connect();
      renderRoom();
    } catch (error) {
      setNotice(els.introNotice, error.message);
    }
  });

  els.joinRoomForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    app.reconnecting = false;
    setNotice(els.introNotice, "");

    const form = new FormData(els.joinRoomForm);
    const roomId = app.roomId || String(form.get("roomId") || "").trim();
    const savedSession = loadSession(roomId);

    if (!roomId) {
      setNotice(els.introNotice, "Room ID is required.");
      return;
    }

    try {
      const payload = await request(`/api/rooms/${roomId}/join`, {
        method: "POST",
        body: {
          name: form.get("name"),
          password: form.get("password"),
          participantId: savedSession?.id || "",
          token: savedSession?.token || "",
        },
      });

      app.session = payload.participant;
      app.room = payload.room;
      rememberNickname(form.get("name"));
      saveSession(roomId, payload.participant);
      setRoute(roomId);
      connect();
      renderRoom();
    } catch (error) {
      if (savedSession && error.status === 409 && error.code === "saved_session_invalid") {
        clearSession(roomId);
        if (app.roomId === roomId) app.session = null;
      }
      setNotice(els.introNotice, error.message);
    }
  });

  // ---- Tickets --------------------------------------------------------------
  // Tickets are part of the room on the server and arrive with every room
  // snapshot, so every player sees the same list, selection and History. The
  // round itself (votes, reveal, reset) is the room's normal round; a ticket
  // gets votes only when someone presses Confirm on it after a reveal.

  function ticketStore() {
    const tickets = app.room?.tickets || {};
    return {
      tickets: Array.isArray(tickets.open) ? tickets.open : [],
      done: Array.isArray(tickets.done) ? tickets.done : [],
      selectedIds: Array.isArray(tickets.selectedIds) ? tickets.selectedIds : [],
      usedRoundIds: Array.isArray(tickets.usedRoundIds) ? tickets.usedRoundIds : [],
      confirmableRoundId: tickets.confirmableRoundId ?? null,
    };
  }

  async function ticketOp(body) {
    if (!app.session || !app.roomId) return null;
    try {
      setNotice(els.roomNotice, "");
      return await request(`/api/rooms/${app.roomId}/tickets`, {
        method: "POST",
        token: app.session.token,
        body: { participantId: app.session.id, ...body },
      });
    } catch (error) {
      setNotice(els.roomNotice, error.message);
      return null;
    }
  }

  // One-time carry-over from the prototype, which kept tickets in this
  // browser's localStorage. If the room on the server has no tickets yet, the
  // local ones are uploaded once; either way the local copy is then dropped.
  function legacyTicketKey(roomId) {
    return `scrum-poker-tickets:${roomId}`;
  }

  function maybeCarryOverTickets(store) {
    const roomId = app.roomId;
    if (!roomId || !app.session || !app.room?.tickets || ticketCarry.tried.has(roomId)) return;
    ticketCarry.tried.add(roomId);
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(legacyTicketKey(roomId)) || "null");
    } catch {
      data = null;
    }
    const open = Array.isArray(data?.tickets) ? data.tickets : [];
    const done = Array.isArray(data?.done) ? data.done : [];
    const dropLocal = () => {
      try {
        localStorage.removeItem(legacyTicketKey(roomId));
      } catch {
        // Storage blocked: nothing to drop.
      }
    };
    if (open.length === 0 && done.length === 0) {
      if (data) dropLocal();
      return;
    }
    if (store.tickets.length > 0 || store.done.length > 0) {
      dropLocal();
      return;
    }
    request(`/api/rooms/${roomId}/tickets`, {
      method: "POST",
      token: app.session.token,
      body: {
        participantId: app.session.id,
        op: "import",
        open: open.map(({ title, link, description }) => ({ title, link, description })),
        done: done.map(({ title, link, description, votes, confirmedAt }) => ({ title, link, description, votes, confirmedAt })),
      },
    }).then(dropLocal, (error) => {
      // 409: the room got tickets from someone else first. On any other error
      // the local copy is kept (it is the only one); no retry this session.
      if (error.status === 409) dropLocal();
    });
  }

  function normalizeTicketLink(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  }

  function buildTicketLink(href) {
    const link = document.createElement("a");
    link.className = "ticket-link";
    link.href = /^https?:\/\//i.test(href) ? href : "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = href.replace(/^https?:\/\//i, "");
    return link;
  }

  // The revealed round that can still be confirmed onto the selected ticket.
  // The server names it (confirmableRoundId): null when nothing is revealed,
  // nobody voted, or that round was already confirmed onto a ticket.
  function currentRevealedRound() {
    if (!app.room || (app.room.mode || "scrum") !== "scrum" || !app.room.revealed) return null;
    const roundId = ticketStore().confirmableRoundId;
    if (!roundId) return null;
    const entry = (app.room.voteHistory || []).find((item) => item.id === roundId);
    if (!entry) return null;
    const votes = (entry.votes || []).filter((vote) => vote.value !== null);
    if (votes.length === 0) return null;
    return { id: entry.id, votes };
  }

  function renderTickets() {
    if (!app.room) return;
    const store = ticketStore();
    const round = currentRevealedRound();

    els.ticketsCount.textContent = store.tickets.length === 1
      ? "1 to estimate"
      : `${store.tickets.length} to estimate`;

    // SSE re-renders the room on every presence/vote change; only rebuild the
    // list when something it shows changed, so buttons are not rebuilt mid-click.
    const signature = JSON.stringify([store.tickets, store.selectedIds, round?.id, app.room.votingScale]);
    if (signature === ticketUi.signature) return;
    ticketUi.signature = signature;

    els.ticketsList.replaceChildren();
    if (store.tickets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tickets-empty";
      empty.textContent = "No tickets yet. Press Tickets + to add the stories you want to estimate.";
      els.ticketsList.appendChild(empty);
      return;
    }

    for (const ticket of store.tickets) {
      const selected = store.selectedIds.includes(ticket.id);
      const card = document.createElement("article");
      card.className = selected ? "ticket-card selected" : "ticket-card";
      card.dataset.ticketId = String(ticket.id);
      card.tabIndex = 0;

      const main = document.createElement("div");
      main.className = "ticket-card-main";
      if (selected) {
        const now = document.createElement("span");
        now.className = "ticket-now";
        now.textContent = "Estimating now";
        main.appendChild(now);
      }
      const title = document.createElement("strong");
      title.className = "ticket-title";
      title.textContent = ticket.title;
      main.appendChild(title);
      if (ticket.description) {
        const desc = document.createElement("p");
        desc.className = "ticket-desc";
        desc.textContent = ticket.description;
        main.appendChild(desc);
      }
      if (ticket.link) main.appendChild(buildTicketLink(ticket.link));
      card.appendChild(main);

      if (selected && round) {
        card.appendChild(buildConfirmBox(ticket, round, store.selectedIds.length));
      } else if (!selected) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ticket-remove";
        remove.setAttribute("aria-label", `Remove ${ticket.title}`);
        remove.textContent = "✕";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          removeTicket(ticket.id);
        });
        card.appendChild(remove);
      }

      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, select")) return;
        toggleTicket(ticket.id);
      });
      card.addEventListener("keydown", (event) => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleTicket(ticket.id);
        }
      });
      els.ticketsList.appendChild(card);
    }
  }

  // Confirm puts the round onto every marked ticket at once.
  function buildConfirmBox(ticket, round, markedCount) {
    const box = document.createElement("div");
    box.className = "ticket-confirm";

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary-button ticket-confirm-button";
    confirm.textContent = markedCount === 1 ? "Confirm"
      : markedCount === 2 ? "Confirm both" : `Confirm all ${markedCount}`;
    confirm.addEventListener("click", () => ticketOp({ op: "confirm", id: ticket.id }).then((payload) => {
      if (payload) setHistoryOpen(true);
    }));

    // Clear throws the round away (it does not stay in History) and starts a
    // fresh one; the ticket stays selected.
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ghost-button ticket-confirm-button";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => ticketOp({ op: "clear" }));

    box.append(confirm, clear);
    return box;
  }

  // Clicking a ticket marks it for the current round; clicking a marked
  // ticket unmarks it. Several tickets can be marked at once.
  function toggleTicket(id) {
    const op = ticketStore().selectedIds.includes(id) ? "unselect" : "select";
    ticketOp({ op, id });
  }

  function removeTicket(id) {
    ticketOp({ op: "remove", id });
  }

  function reEstimateTicket(id) {
    ticketOp({ op: "reestimate", id });
  }

  function openTicketAdd() {
    els.ticketAddModal.hidden = false;
    els.ticketAddedNote.textContent = "";
    els.ticketTitleInput.focus();
  }

  function closeTicketAdd() {
    els.ticketAddModal.hidden = true;
    els.ticketAddForm.reset();
    els.ticketAddedNote.textContent = "";
    els.ticketsAddButton.focus();
  }

  els.ticketsAddButton.addEventListener("click", openTicketAdd);
  els.ticketAddDone.addEventListener("click", closeTicketAdd);
  els.ticketAddClose.addEventListener("click", closeTicketAdd);
  els.ticketAddModal.addEventListener("click", (event) => {
    if (event.target === els.ticketAddModal) closeTicketAdd();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.ticketAddModal.hidden) closeTicketAdd();
  });
  els.ticketAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = els.ticketTitleInput.value.trim();
    if (!title) {
      els.ticketTitleInput.focus();
      return;
    }
    ticketOp({
      op: "add",
      ticket: {
        title,
        link: normalizeTicketLink(els.ticketLinkInput.value),
        description: els.ticketDescInput.value.trim(),
      },
    }).then((payload) => {
      if (!payload) {
        els.ticketAddedNote.textContent = "Could not add the ticket. Try again.";
        return;
      }
      els.ticketAddForm.reset();
      els.ticketAddedNote.textContent = `Added "${title}"`;
      els.ticketTitleInput.focus();
    });
  });

  els.copyLinkButton.addEventListener("click", copyInviteLink);
  els.historyToggleButton.addEventListener("click", () => {
    setHistoryOpen(els.historyPanel.hidden);
  });
  els.exportButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setExportPickerOpen(els.exportPicker.hidden);
  });
  els.exportCancel.addEventListener("click", () => setExportPickerOpen(false));
  els.exportDownload.addEventListener("click", downloadExportCsv);
  els.exportPicker.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("resize", positionExportPicker);
  window.addEventListener("scroll", positionExportPicker, true);
  document.addEventListener("click", () => {
    if (!els.exportPicker.hidden) setExportPickerOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.exportPicker.hidden) setExportPickerOpen(false);
  });
  setupFormAccordion();
  setupWhatsNew();
  els.roomEditButton.addEventListener("click", () => {
    if (app.room) openRoomSettings(app.roomId, app.room.name);
  });
  els.roomSettingsClose.addEventListener("click", closeRoomSettings);
  els.roomSettingsModal.addEventListener("click", (event) => {
    if (event.target === els.roomSettingsModal) closeRoomSettings();
  });
  els.roomSettingsSaveName.addEventListener("click", saveRoomName);
  els.roomSettingsSavePassword.addEventListener("click", saveRoomPassword);
  // Enter in each field submits that field's own action, so typing a password and
  // pressing Enter changes the password (it used to do nothing, which read as the
  // change silently failing).
  els.roomSettingsName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); saveRoomName(); }
  });
  els.roomSettingsPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); saveRoomPassword(); }
  });
  els.teamHueInput.addEventListener("input", updateTeamSwatch);
  els.teamAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTeamFromForm();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.roomSettingsModal.hidden) closeRoomSettings();
  });
  els.tableStackButton.addEventListener("click", tapStack);
  els.leaveRoomButton.addEventListener("click", () => {
    // Tell the server to drop the participant for good (best-effort), so leaving
    // removes the seat for everyone rather than lingering as a resumable record.
    if (app.roomId && app.session) {
      request(`/api/rooms/${app.roomId}/leave`, {
        method: "POST",
        token: app.session.token,
        body: { participantId: app.session.id },
      }).catch(() => {});
    }
    disconnect();
    app.reconnecting = false;
    clearSession(app.roomId);
    app.room = null;
    app.session = null;
    showIntro();
  });

  els.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("scrum-poker:theme", next);
    } catch (error) {
      // ignore storage failures (private mode); the toggle still works for the session
    }
  });

  // --- Agenda board: a notepad time rail that scrolls with real time ---
  const AGENDA_ROW_PX = 28;
  const AGENDA_ROWS = 288; // a full day in 5-minute blocks
  const AGENDA_DAY_MIN = AGENDA_ROWS * 5; // 1440
  const AGENDA_DEFAULT_MIN = 15; // new entries span 15 minutes
  let agendaNowMin = null;
  let agendaInteracting = false;
  let agendaSuppressCreate = false;
  // True for one tick right after a move-drag, so a linked note's title doesn't
  // open its URL when the drag ends over the link.
  let agendaJustDragged = false;
  let agendaEditing = false;
  let agendaTimeLocked = true;
  let agendaSendTimer = null;
  let agendaEntriesEl = null;
  const agendaEntries = [];

  function buildAgendaRail() {
    if (!els.agendaRail || els.agendaRail.childElementCount) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < AGENDA_ROWS; i += 1) {
      const mins = i * 5;
      const hh = String(Math.floor(mins / 60)).padStart(2, "0");
      const mm = String(mins % 60).padStart(2, "0");
      const row = document.createElement("div");
      row.className = "agenda-row";
      row.dataset.min = String(mins);
      const time = document.createElement("span");
      time.className = "agenda-time";
      time.textContent = `${hh}:${mm}`;
      const slot = document.createElement("span");
      slot.className = "agenda-slot";
      row.append(time, slot);
      frag.appendChild(row);
    }
    els.agendaRail.appendChild(frag);
    els.agendaRail.style.height = `${AGENDA_ROWS * AGENDA_ROW_PX}px`;
  }

  function highlightAgendaNow() {
    const now = new Date();
    const blockMin = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
    if (blockMin === agendaNowMin) return;
    const prev = els.agendaRail.querySelector(".agenda-row.is-now");
    if (prev) prev.classList.remove("is-now");
    const next = els.agendaRail.querySelector(`.agenda-row[data-min="${blockMin}"]`);
    if (next) next.classList.add("is-now");
    agendaNowMin = blockMin;
  }

  function positionAgendaRail() {
    if (!els.agendaBoard || !els.agendaBoard.offsetParent) return;
    if (agendaInteracting) return; // hold the rail still while dragging an entry
    if (!agendaTimeLocked) return; // user is scrolling freely; don't follow time
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const railPos = (nowMin / 5) * AGENDA_ROW_PX;
    const viewportHeight = els.agendaViewport.clientHeight || els.agendaBoard.clientHeight;
    els.agendaViewport.scrollTop = Math.max(0, railPos - viewportHeight * 0.33);
  }

  function setAgendaTimeLock(locked) {
    agendaTimeLocked = locked;
    if (els.agendaClock) els.agendaClock.classList.toggle("unlocked", !locked);
    if (locked) positionAgendaRail();
  }

  function tickAgenda() {
    highlightAgendaNow();
    positionAgendaRail();
  }

  function clampDayMin(min) {
    return Math.max(0, Math.min(AGENDA_DAY_MIN, min));
  }

  function snap5(min) {
    return Math.round(min / 5) * 5;
  }

  function applyEntryPosition(el, entry) {
    el.style.top = `${(entry.startMin / 5) * AGENDA_ROW_PX}px`;
    el.style.height = `${((entry.endMin - entry.startMin) / 5) * AGENDA_ROW_PX}px`;
    el.dataset.startMin = String(entry.startMin);
    el.dataset.endMin = String(entry.endMin);
  }

  function renderAgendaEntries() {
    if (!agendaEntriesEl) return;
    hideAgendaControls();
    agendaEntriesEl.replaceChildren();
    for (const entry of agendaEntries) {
      const el = document.createElement("div");
      el.className = "agenda-entry";
      el.dataset.id = entry.id;
      const top = document.createElement("div");
      top.className = "agenda-entry-handle top";
      const body = document.createElement("div");
      body.className = "agenda-entry-body";
      const bottom = document.createElement("div");
      bottom.className = "agenda-entry-handle bottom";
      // The block always shows just the display; the editable form lives in the
      // floating editor popover so a short note never squishes the fields.
      el.classList.toggle("is-editing", Boolean(entry.draft));
      body.append(buildAgendaDisplay(entry));
      el.append(top, body, bottom);
      if (!entry.draft) {
        el.addEventListener("mouseenter", () => showAgendaControls(entry, el));
        el.addEventListener("mouseleave", scheduleHideAgendaControls);
      }
      applyEntryPosition(el, entry);

      top.addEventListener("pointerdown", (event) => startEntryDrag(event, el, entry, "top"));
      bottom.addEventListener("pointerdown", (event) => startEntryDrag(event, el, entry, "bottom"));
      body.addEventListener("pointerdown", (event) => startEntryDrag(event, el, entry, "move"));

      agendaEntriesEl.appendChild(el);
      fitAgendaDisplay(el);
    }
  }

  const AGENDA_LINK_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 13a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"></path><path d="M15 11a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"></path></svg>';

  function buildAgendaField(kind, entry) {
    const field = document.createElement("div");
    field.className = `agenda-entry-field ${kind}`;

    const icon = document.createElement("span");
    icon.className = "agenda-entry-icon";
    if (kind === "title") icon.textContent = "T";
    else icon.innerHTML = AGENDA_LINK_ICON;

    const input = document.createElement("input");
    input.className = `agenda-entry-input ${kind}`;
    input.type = "text";
    input.value = kind === "title" ? entry.title || "" : entry.url || "";
    input.placeholder = kind === "title" ? "Note" : "Link";

    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("focus", () => {
      agendaEditing = true;
    });
    input.addEventListener("blur", () => {
      if (entry.draft) return; // keep the draft open until Set/Cancel/Enter
      agendaEditing = false;
      flushAgendaSend(entry);
    });
    input.addEventListener("input", () => {
      if (kind === "title") entry.title = input.value;
      else entry.url = input.value;
      if (!entry.draft) queueAgendaSend(entry);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (kind === "title") {
        focusAgendaField(entry.id, "link");
      } else if (entry.draft) {
        commitAgendaDraft(entry); // last field, no extra field -> create the note
      } else {
        input.blur();
      }
    });

    field.append(icon, input);
    return field;
  }

  function buildAgendaActions(entry) {
    const actions = document.createElement("div");
    actions.className = "agenda-entry-actions";
    actions.addEventListener("pointerdown", (event) => event.stopPropagation());

    const set = document.createElement("button");
    set.type = "button";
    set.className = "primary-button agenda-entry-btn set";
    set.textContent = "Set";
    set.addEventListener("click", () => commitAgendaDraft(entry));

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost-button agenda-entry-btn cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => cancelAgendaDraft(entry));

    actions.append(set, cancel);
    return actions;
  }

  // A committed note shows only its title. With a link the title is a real
  // anchor, so only the link text is clickable and it opens in a new tab.
  function buildAgendaDisplay(entry) {
    const hasLink = Boolean(entry.url && entry.url.trim());
    const display = document.createElement(hasLink ? "a" : "div");
    display.className = "agenda-entry-display";
    display.textContent = entry.title || "";
    if (hasLink) {
      display.classList.add("link");
      display.href = normalizeAgendaUrl(entry.url);
      display.target = "_blank";
      display.rel = "noopener noreferrer";
      display.draggable = false;
      display.title = entry.url.trim();
      // Let pointerdown bubble to the body so the note is still draggable by its
      // (link) title; only suppress the navigation when the gesture was a drag,
      // so a plain tap still opens the link in a new tab.
      display.addEventListener("click", (event) => {
        if (agendaJustDragged) event.preventDefault();
      });
    }
    return display;
  }

  function normalizeAgendaUrl(url) {
    const trimmed = url.trim();
    // Only http/https open as-is; anything else gets https:// so a stray
    // "javascript:" can never execute when another player taps a shared note.
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  }

  // The title wraps and uses as many lines as fit the note's current height,
  // then ellipsises. Recomputed on render and whenever the box is resized.
  function fitAgendaDisplay(noteEl) {
    const display = noteEl.querySelector(".agenda-entry-display");
    const body = noteEl.querySelector(".agenda-entry-body");
    if (!display || !body) return;
    const lineHeight = parseFloat(getComputedStyle(display).lineHeight) || 16;
    const lines = Math.max(1, Math.floor((body.clientHeight + 1) / lineHeight));
    display.style.webkitLineClamp = String(lines);
    display.style.setProperty("line-clamp", String(lines));
    display.dataset.lines = String(lines);
  }

  function queueAgendaSend(entry) {
    if (agendaSendTimer) window.clearTimeout(agendaSendTimer);
    agendaSendTimer = window.setTimeout(() => {
      agendaSendTimer = null;
      sendAgenda({ op: "upsert", entry });
    }, 500);
  }

  function flushAgendaSend(entry) {
    if (agendaSendTimer) {
      window.clearTimeout(agendaSendTimer);
      agendaSendTimer = null;
    }
    sendAgenda({ op: "upsert", entry });
  }

  function startEntryDrag(event, el, entry, mode) {
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const origStart = entry.startMin;
    const origEnd = entry.endMin;
    const duration = origEnd - origStart;
    let moved = false;
    let dragging = false;
    const DRAG_THRESHOLD_PX = 3;
    // The thin resize handles (top/bottom) must grab the pointer immediately or
    // it slips off the 9px strip before a drag registers. The body (move) instead
    // waits for real movement, so a plain tap on a linked title stays a click and
    // still opens its URL.
    const deferCapture = mode === "move";

    const beginDrag = () => {
      dragging = true;
      agendaInteracting = true;
      try {
        handle.setPointerCapture(pointerId);
      } catch (error) {
        // pointer capture is best-effort
      }
    };

    if (!deferCapture) {
      event.preventDefault();
      beginDrag();
    }

    const onMove = (moveEvent) => {
      const dyPx = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.abs(dyPx) < DRAG_THRESHOLD_PX) return;
        beginDrag();
      }
      // Dragging moves in 1-minute steps (rows are 5 minutes / AGENDA_ROW_PX).
      const deltaMin = Math.round((dyPx / AGENDA_ROW_PX) * 5);
      if (deltaMin !== 0) moved = true;
      if (mode === "move") {
        let start = clampDayMin(origStart + deltaMin);
        start = Math.max(0, Math.min(start, AGENDA_DAY_MIN - duration));
        entry.startMin = start;
        entry.endMin = start + duration;
      } else if (mode === "top") {
        entry.startMin = Math.min(clampDayMin(origStart + deltaMin), origEnd - 1);
      } else if (mode === "bottom") {
        entry.endMin = Math.max(clampDayMin(origEnd + deltaMin), origStart + 1);
      }
      applyEntryPosition(el, entry);
      if (!entry.draft) fitAgendaDisplay(el);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      if (!dragging) {
        // A plain tap (no drag): a linked title opens its URL via the native
        // click; a non-linked note reveals its controls (for touch).
        if (mode === "move" && !entry.draft && !(entry.url && entry.url.trim())) {
          showAgendaControls(entry, el);
        }
        return;
      }
      try {
        handle.releasePointerCapture(pointerId);
      } catch (error) {
        // ignore
      }
      agendaInteracting = false;
      if (moved) {
        agendaSuppressCreate = true;
        agendaJustDragged = true;
        window.setTimeout(() => {
          agendaSuppressCreate = false;
          agendaJustDragged = false;
        }, 0);
        if (!entry.draft) sendAgenda({ op: "upsert", entry });
      } else if (mode === "move" && !entry.draft) {
        // a plain tap on a committed note reveals its controls (for touch)
        showAgendaControls(entry, el);
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function agendaEntryId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `n${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  }

  function sendAgenda(body) {
    if (!app.roomId || !app.session) return;
    request(`/api/rooms/${app.roomId}/agenda`, {
      method: "POST",
      token: app.session.token,
      body: { participantId: app.session.id, ...body },
    }).catch(() => {
      // best-effort; the next room broadcast reconciles state
    });
  }

  // Replace local notes with the room's shared agenda, except while the viewer is
  // mid-drag (so a teammate's update never yanks the block out from under them).
  function syncAgendaFromRoom() {
    if (!agendaEntriesEl || agendaInteracting || agendaEditing) return;
    const serverAgenda = app.room && Array.isArray(app.room.agenda) ? app.room.agenda : [];
    const drafts = agendaEntries.filter((entry) => entry.draft);
    agendaEntries.length = 0;
    // The board only shows today's entries. Older days are kept on the server
    // and reachable through Export — they just don't clutter the live board.
    // Legacy entries with no day are treated as today's so nothing disappears.
    const today = localDayString();
    for (const entry of serverAgenda) {
      if (entry.day && entry.day !== today) continue;
      agendaEntries.push({ ...entry, committed: true });
    }
    for (const draft of drafts) agendaEntries.push(draft);
    renderAgendaEntries();
  }

  // Local calendar day as YYYY-MM-DD (author's own zone), stamped on each entry
  // so older days can be kept + exported while the board shows only today's.
  function localDayString(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function createAgendaEntry(clientY) {
    const rect = els.agendaRail.getBoundingClientRect();
    const min = clampDayMin(snap5(((clientY - rect.top) / AGENDA_ROW_PX) * 5));
    const start = Math.max(0, Math.min(min, AGENDA_DAY_MIN - AGENDA_DEFAULT_MIN));
    const entry = { id: agendaEntryId(), startMin: start, endMin: start + AGENDA_DEFAULT_MIN, title: "", url: "", day: localDayString(), draft: true };
    agendaEntries.push(entry);
    agendaEditing = true; // hold remote re-renders while the draft is open
    renderAgendaEntries();
    openAgendaEditor(entry);
  }

  function focusAgendaField(id, kind) {
    // Fields live in the floating editor while it's open; only one entry's
    // fields exist there at a time, so a kind-only lookup is unambiguous.
    if (els.agendaEditor && !els.agendaEditor.hidden) {
      const editing = els.agendaEditor.querySelector(`.agenda-entry-input.${kind}`);
      if (editing) editing.focus();
      return;
    }
    if (!agendaEntriesEl) return;
    const input = agendaEntriesEl.querySelector(`.agenda-entry[data-id="${id}"] .agenda-entry-input.${kind}`);
    if (input) input.focus();
  }

  function commitAgendaDraft(entry) {
    // A brand-new note with nothing typed is discarded rather than creating an
    // empty block; a note with a link, or an existing note, can still be blank.
    if (!entry.committed && !(entry.title || "").trim() && !(entry.url || "").trim()) {
      cancelAgendaDraft(entry);
      return;
    }
    entry.draft = false;
    entry.committed = true;
    agendaEditing = false;
    closeAgendaEditor();
    sendAgenda({ op: "upsert", entry });
    renderAgendaEntries();
  }

  function cancelAgendaDraft(entry) {
    agendaEditing = false;
    closeAgendaEditor();
    if (entry.committed) {
      // editing an existing note: revert to its saved values, keep the note
      entry.title = entry.savedTitle ?? entry.title;
      entry.url = entry.savedUrl ?? entry.url;
      entry.draft = false;
      renderAgendaEntries();
      return;
    }
    const index = agendaEntries.indexOf(entry);
    if (index >= 0) agendaEntries.splice(index, 1);
    renderAgendaEntries();
  }

  function editAgendaEntry(entry) {
    entry.savedTitle = entry.title;
    entry.savedUrl = entry.url;
    entry.draft = true;
    agendaEditing = true;
    renderAgendaEntries();
    openAgendaEditor(entry);
  }

  function deleteAgendaEntry(entry) {
    if (entry === agendaEditorTarget) closeAgendaEditor();
    const index = agendaEntries.indexOf(entry);
    if (index >= 0) agendaEntries.splice(index, 1);
    agendaEditing = false;
    renderAgendaEntries();
    if (entry.committed) sendAgenda({ op: "delete", id: entry.id });
  }

  // The editable form (Title + Link + Set/Cancel) floats in one popover anchored
  // to the note being edited, with secured dimensions so a short note's fields
  // are never squished. Editing never happens inside the time-box itself.
  let agendaEditorTarget = null;
  let agendaEditorNoteEl = null;

  function openAgendaEditor(entry) {
    if (!els.agendaEditor) return;
    const noteEl = agendaEntriesEl.querySelector(`.agenda-entry[data-id="${entry.id}"]`);
    if (!noteEl) return;
    agendaEditorTarget = entry;
    agendaEditorNoteEl = noteEl;
    hideAgendaControls();
    els.agendaEditor.replaceChildren(
      buildAgendaField("title", entry),
      buildAgendaField("link", entry),
      buildAgendaActions(entry),
    );
    els.agendaEditor.hidden = false;
    positionAgendaEditor(noteEl);
    focusAgendaField(entry.id, "title");
  }

  function closeAgendaEditor() {
    if (!els.agendaEditor) return;
    els.agendaEditor.hidden = true;
    els.agendaEditor.replaceChildren();
    agendaEditorTarget = null;
    agendaEditorNoteEl = null;
  }

  function positionAgendaEditor(noteEl) {
    if (!els.agendaEditor || els.agendaEditor.hidden || !noteEl) return;
    const boardRect = els.agendaBoard.getBoundingClientRect();
    const paperRect = els.agendaViewport.getBoundingClientRect();
    const noteRect = noteEl.getBoundingClientRect();
    const top = noteRect.top - boardRect.top;
    const minTop = paperRect.top - boardRect.top;
    const maxTop = Math.max(minTop, paperRect.bottom - boardRect.top - els.agendaEditor.offsetHeight);
    els.agendaEditor.style.top = `${Math.max(minTop, Math.min(top, maxTop))}px`;
  }

  // The trash/edit controls are one widget floating outside the notepad, shown
  // beside whichever committed note you hover (or tap on touch).
  let agendaControlsTarget = null;
  let agendaHideTimer = null;

  function showAgendaControls(entry, noteEl) {
    if (!els.agendaControls) return;
    cancelHideAgendaControls();
    agendaControlsTarget = entry;
    els.agendaControls.hidden = false;
    const boardRect = els.agendaBoard.getBoundingClientRect();
    const paperRect = els.agendaViewport.getBoundingClientRect();
    const noteRect = noteEl.getBoundingClientRect();
    let top = noteRect.top - boardRect.top;
    const minTop = paperRect.top - boardRect.top;
    const maxTop = paperRect.bottom - boardRect.top - els.agendaControls.offsetHeight;
    els.agendaControls.style.top = `${Math.max(minTop, Math.min(top, maxTop))}px`;
  }

  function hideAgendaControls() {
    if (!els.agendaControls) return;
    els.agendaControls.hidden = true;
    agendaControlsTarget = null;
  }

  function scheduleHideAgendaControls() {
    cancelHideAgendaControls();
    agendaHideTimer = window.setTimeout(hideAgendaControls, 140);
  }

  function cancelHideAgendaControls() {
    if (agendaHideTimer) {
      window.clearTimeout(agendaHideTimer);
      agendaHideTimer = null;
    }
  }

  if (els.agendaBoard) {
    buildAgendaRail();
    agendaEntriesEl = document.createElement("div");
    agendaEntriesEl.className = "agenda-entries";
    els.agendaRail.appendChild(agendaEntriesEl);
    tickAgenda();
    window.setInterval(tickAgenda, 1000);
    window.addEventListener("resize", positionAgendaRail);

    els.agendaViewport.addEventListener("click", (event) => {
      if (agendaSuppressCreate) return;
      if (event.target.closest(".agenda-entry")) return;
      createAgendaEntry(event.clientY);
    });

    // Manual scrolling disables the time-lock; the clock re-enables it + jumps to now.
    const unlockOnScroll = () => {
      // Scrolling unlocks even while editing, so you can scroll the notepad
      // without the time-lock snapping it back to now.
      if (agendaTimeLocked && !agendaInteracting) setAgendaTimeLock(false);
    };
    els.agendaViewport.addEventListener("wheel", unlockOnScroll, { passive: true });
    els.agendaViewport.addEventListener("touchmove", unlockOnScroll, { passive: true });
    els.agendaClock.addEventListener("click", () => setAgendaTimeLock(true));

    if (els.agendaControls) {
      els.agendaControls.addEventListener("mouseenter", cancelHideAgendaControls);
      els.agendaControls.addEventListener("mouseleave", scheduleHideAgendaControls);
      els.agendaTrash.addEventListener("click", () => {
        if (agendaControlsTarget) deleteAgendaEntry(agendaControlsTarget);
        hideAgendaControls();
      });
      els.agendaEdit.addEventListener("click", () => {
        if (agendaControlsTarget) editAgendaEntry(agendaControlsTarget);
        hideAgendaControls();
      });
    }

    if (els.agendaEditor) {
      // Escape discards a new note / reverts an edit; click outside saves.
      els.agendaEditor.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && agendaEditorTarget) {
          event.preventDefault();
          cancelAgendaDraft(agendaEditorTarget);
        }
      });
      document.addEventListener("pointerdown", (event) => {
        if (els.agendaEditor.hidden || !agendaEditorTarget) return;
        if (els.agendaEditor.contains(event.target)) return;
        // Saving on the way out must not also create a fresh note where we clicked.
        agendaSuppressCreate = true;
        window.setTimeout(() => {
          agendaSuppressCreate = false;
        }, 0);
        commitAgendaDraft(agendaEditorTarget);
      });
      // Keep the popover pinned to its note as the rail scrolls under it.
      els.agendaViewport.addEventListener(
        "scroll",
        () => positionAgendaEditor(agendaEditorNoteEl),
        { passive: true },
      );
    }

    // Restore the agenda's open/closed state per-browser. Default: closed.
    let agendaCollapsed = true;
    try {
      const stored = localStorage.getItem("scrum-poker:agenda-collapsed");
      if (stored !== null) agendaCollapsed = stored === "true";
    } catch (e) {}
    els.agendaBoard.classList.toggle("collapsed", agendaCollapsed);
    els.agendaToggle.setAttribute("aria-expanded", String(!agendaCollapsed));
    if (!agendaCollapsed) tickAgenda();

    els.agendaToggle.addEventListener("click", () => {
      const collapsed = els.agendaBoard.classList.toggle("collapsed");
      els.agendaToggle.setAttribute("aria-expanded", String(!collapsed));
      try {
        localStorage.setItem("scrum-poker:agenda-collapsed", String(collapsed));
      } catch (e) {}
      if (!collapsed) tickAgenda();
    });
  }

  els.freeNumberForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitFreeNumber();
  });
  els.freeNumberCancel.addEventListener("click", closeFreeNumberInput);
  els.freeNumberInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFreeNumberInput();
  });
  document.addEventListener("pointerdown", (event) => {
    if (els.freeNumberPopover.hidden) return;
    if (els.freeNumberPopover.contains(event.target)) return;
    if (event.target.closest("#freeNumberCard")) return;
    closeFreeNumberInput();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncFreeNumberToKeyboard);
    window.visualViewport.addEventListener("scroll", syncFreeNumberToKeyboard);
  }

  els.pokerFoldButton.addEventListener("click", () => pokerAction("fold"));
  els.pokerCheckButton.addEventListener("click", () => pokerAction("check"));
  els.pokerCallButton.addEventListener("click", () => pokerAction("call"));
  els.pokerBetButton.addEventListener("click", () => pokerAction("bet", 5));
  els.pokerRaiseButton.addEventListener("click", () => pokerAction("raise", 5));
  els.pokerStartButton.addEventListener("click", () => pokerAction("start"));

  window.addEventListener("popstate", () => {
    disconnect();
    app.roomId = roomIdFromPath();
    app.room = null;
    app.session = loadSession(app.roomId);
    if (app.roomId && app.session) {
      app.reconnecting = true;
      showIntro();
      startReconnectTimeout();
      connect();
    } else {
      app.reconnecting = false;
      showIntro();
    }
  });

  app.session = loadSession(app.roomId);
  prefillRoomName();
  prefillNickname();
  if (app.roomId && app.session) {
    app.reconnecting = true;
    showIntro();
    startReconnectTimeout();
    connect();
  } else {
    app.reconnecting = false;
    showIntro();
  }
})();
