const { expect, test } = require("@playwright/test");

async function createRoom(page, roomName) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  // In State B (this browser already has rooms) the create form is a collapsed
  // rail accordion — expand it before filling.
  const nameInput = page.locator("#createRoomName");
  const heading = page.locator("#createRoomForm .surface-heading");
  for (let i = 0; i < 3 && !(await nameInput.isVisible()); i += 1) {
    await heading.click();
    await page.waitForTimeout(100);
  }
  await nameInput.fill(roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => location.pathname.split("/").pop());
}

test("resume reattaches a known browser to its seat without a password", async ({ page }) => {
  const roomId = await createRoom(page, `Resume ${Date.now()}`);
  const session = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem(`scrum-poker:${id}`)),
    roomId,
  );

  // page.request carries the page's identity cookie; no password is sent.
  const res = await page.request.post(`/api/rooms/${roomId}/resume`, { data: {} });
  expect(res.ok()).toBeTruthy();
  const payload = await res.json();
  expect(payload.participant.id).toBe(session.id);
  expect(payload.participant.isHost).toBe(true);
  expect(typeof payload.participant.token).toBe("string");
});

test("resume 404s for a browser with no session in the room", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Resume404 ${Date.now()}`);

  const stranger = await browser.newContext();
  const res = await stranger.request.post(`/api/rooms/${roomId}/resume`, { data: {} });
  expect(res.status()).toBe(404);
  await stranger.close();
});

test("my-rooms lists every room this browser has a session in, with expiries", async ({ page }) => {
  const roomA = await createRoom(page, `MyRoomsA ${Date.now()}`);
  const roomB = await createRoom(page, `MyRoomsB ${Date.now()}`);

  const res = await page.request.get(`/api/my-rooms`);
  expect(res.ok()).toBeTruthy();
  const { rooms } = await res.json();
  const ids = rooms.map((r) => r.roomId);
  expect(ids).toContain(roomA);
  expect(ids).toContain(roomB);

  const entry = rooms.find((r) => r.roomId === roomA);
  expect(entry.name).toBe("Host");
  expect(entry.discriminator).toMatch(/^\d{4}$/);
  expect(Date.parse(entry.roomExpiresAt)).toBeGreaterThan(Date.now());
  expect(Date.parse(entry.sessionExpiresAt)).toBeGreaterThan(Date.now());
});

test("my-rooms is empty for a browser with no sessions", async ({ browser }) => {
  const fresh = await browser.newContext();
  const res = await fresh.request.get(`/api/my-rooms`);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).rooms).toEqual([]);
  await fresh.close();
});

test("my-history tags a live session rejoinable and a left room active", async ({ page }) => {
  const liveId = await createRoom(page, `HistLive ${Date.now()}`);
  const leftId = await createRoom(page, `HistLeft ${Date.now()}`);

  // Leave the second room: the participant is deleted but the room (and the
  // history row) remain, so its history state drops from rejoinable to active.
  const leave = await page.request.post(`/api/rooms/${leftId}/leave`, { data: {} });
  expect(leave.ok()).toBeTruthy();

  const res = await page.request.get(`/api/my-history`);
  expect(res.ok()).toBeTruthy();
  const { history } = await res.json();

  const live = history.find((h) => h.roomId === liveId);
  const left = history.find((h) => h.roomId === leftId);
  expect(live.state).toBe("rejoinable");
  expect(left.state).toBe("active");
  expect(typeof live.roomName).toBe("string");
  expect(typeof live.lastJoinedAt).toBe("string");
});

test("history/clear removes a single entry from this browser's history", async ({ page }) => {
  const keepId = await createRoom(page, `HistKeep ${Date.now()}`);
  const dropId = await createRoom(page, `HistDrop ${Date.now()}`);

  const clear = await page.request.post(`/api/history/clear`, { data: { roomId: dropId } });
  expect(clear.ok()).toBeTruthy();

  const { history } = await (await page.request.get(`/api/my-history`)).json();
  const ids = history.map((h) => h.roomId);
  expect(ids).toContain(keepId);
  expect(ids).not.toContain(dropId);
});

test("my-history is empty for a browser with no joins", async ({ browser }) => {
  const fresh = await browser.newContext();
  const res = await fresh.request.get(`/api/my-history`);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).history).toEqual([]);
  await fresh.close();
});
