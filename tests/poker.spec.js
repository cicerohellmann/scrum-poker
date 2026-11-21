const { expect, test } = require("@playwright/test");

async function createRoom(page, roomName) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => {
    const roomId = location.pathname.split("/").pop();
    const session = JSON.parse(localStorage.getItem(`scrum-poker:${roomId}`));
    return { roomId, session };
  });
}

async function joinOnline(browser, roomId, name) {
  const context = await browser.newContext();
  const guestPage = await context.newPage();
  await guestPage.goto(`/r/${roomId}`);
  await guestPage.fill("#joinName", name);
  await guestPage.fill("#joinPassword", "team-pass");
  await guestPage.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(guestPage.locator("#roomView")).toBeVisible();
  return { context, guestPage };
}

async function authedPost(page, roomId, session, action, body = {}) {
  const response = await page.request.post(`/api/rooms/${roomId}/${action}`, {
    data: { participantId: session.id, ...body },
    headers: { authorization: `Bearer ${session.token}` },
  });
  if (!response.ok()) {
    throw new Error(`${action} -> ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function enterPoker(page, roomId, session) {
  let snap;
  for (let i = 0; i < 3; i += 1) snap = await authedPost(page, roomId, session, "stack");
  return snap;
}

test("poker does not seat an offline participant", async ({ page, browser }) => {
  const { roomId, session } = await createRoom(page, `Poker seat ${Date.now()}`);

  // A guest joins (online), then closes their tab → persisted but offline.
  const guest = await joinOnline(browser, roomId, "Guest");
  await expect(page.locator(".table-seat")).toHaveCount(2);
  await guest.context.close();
  await expect(page.locator(".table-seat")).toHaveCount(1);

  // Host enters poker. Only the host is online, so no hand may start — the
  // offline guest must not be seated or dealt in.
  const snap = await enterPoker(page, roomId, session);
  expect(snap.room.mode).toBe("poker");
  expect(snap.room.poker.phase).toBe("waiting");
  expect(snap.room.poker.players).toHaveLength(1);
});

test("an offline player is auto-folded so the hand does not stall", async ({ page, browser }) => {
  const { roomId, session } = await createRoom(page, `Poker fold ${Date.now()}`);

  const guest = await joinOnline(browser, roomId, "Guest");
  await expect(page.locator(".table-seat")).toHaveCount(2);

  let snap = await enterPoker(page, roomId, session);
  expect(snap.room.mode).toBe("poker");
  expect(snap.room.poker.phase).toBe("preflop");

  // Move the action onto the guest: heads-up, the host (dealer) acts first.
  if (snap.room.poker.currentTurnParticipantId === session.id) {
    snap = await authedPost(page, roomId, session, "poker", { pokerAction: "call" });
  }
  expect(snap.room.poker.currentTurnParticipantId).not.toBe(session.id);

  // The guest drops on their turn — the hand must resolve, not hang.
  await guest.context.close();
  await expect(page.locator("#tableStackMeta")).toHaveText("Complete");
  await expect(page.locator("#tableTitle")).toContainText("wins");
});
