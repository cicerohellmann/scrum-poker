const { expect, test } = require("@playwright/test");

async function createRoom(page, roomName) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => location.pathname.split("/").pop());
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

async function rosterNames(browser, roomId) {
  // A fresh browser (its own cookie) reads the room roster, including offline records.
  const obs = await browser.newContext();
  const res = await obs.request.post(`/api/rooms/${roomId}/join`, {
    data: { name: "Observer", password: "team-pass" },
  });
  const payload = await res.json();
  await obs.close();
  return payload.room.participants.map((p) => p.name);
}

test("Leave removes the participant from the room for everyone", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Leave ${Date.now()}`);
  const guest = await joinOnline(browser, roomId, "Guest");
  await expect(page.locator(".table-seat")).toHaveCount(2);

  await guest.guestPage.locator("#leaveRoomButton").click();
  await expect(guest.guestPage.locator("#introView")).toBeVisible();

  // The host sees the seat removed...
  await expect(page.locator(".table-seat")).toHaveCount(1);
  // ...and the record is actually gone, not merely offline.
  expect(await rosterNames(browser, roomId)).not.toContain("Guest");

  await guest.context.close();
});

test("closing a tab keeps the participant (resumable), unlike Leave", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Disconnect ${Date.now()}`);
  const guest = await joinOnline(browser, roomId, "Guest");
  await expect(page.locator(".table-seat")).toHaveCount(2);

  await guest.context.close(); // just close the tab — not an explicit Leave
  await expect(page.locator(".table-seat")).toHaveCount(1); // offline → no seat

  // The record persists (offline), so the seat is still resumable later.
  expect(await rosterNames(browser, roomId)).toContain("Guest");
});
