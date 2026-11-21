const { expect, test } = require("@playwright/test");

// Single create per test keeps the helper in State A (no rail accordion to fight).
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

test("History accordion appears for a returning browser and expands to the list", async ({ page }) => {
  const roomName = `Hist ${Date.now()}`;
  await createRoom(page, roomName);

  await page.goto("/");
  await expect(page.locator("#introView")).toHaveClass(/has-rooms/);

  const rail = page.locator("#historyRail");
  await expect(rail).toBeVisible();
  await expect(page.locator("#historyRailList")).toBeHidden(); // collapsed by default

  await rail.locator(".surface-heading").click();
  await expect(page.locator("#historyRailList")).toBeVisible();
  const row = page.locator(".history-rail-row").filter({ hasText: roomName });
  await expect(row).toHaveCount(1);
});

test("Clear removes a single History row", async ({ page }) => {
  const roomName = `HistClear ${Date.now()}`;
  await createRoom(page, roomName);

  await page.goto("/");
  await page.locator("#historyRail .surface-heading").click();
  const row = page.locator(".history-rail-row").filter({ hasText: roomName });
  await expect(row).toHaveCount(1);

  await row.locator(".history-rail-clear").click();
  await expect(row).toHaveCount(0);
});

test("tapping a rejoinable History row re-enters the room password-free", async ({ page }) => {
  const roomName = `HistRejoin ${Date.now()}`;
  const roomId = await createRoom(page, roomName);

  await page.goto("/");
  await page.locator("#historyRail .surface-heading").click();
  const row = page.locator(".history-rail-row").filter({ hasText: roomName });
  await expect(row).toHaveClass(/state-rejoinable/);

  await row.locator(".history-rail-main").click();
  await expect(page.locator("#roomView")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/r/${roomId}$`));
});

test("tapping an active History row opens the prefilled enter form", async ({ page }) => {
  const roomName = `HistEnter ${Date.now()}`;
  const roomId = await createRoom(page, roomName);

  await page.goto("/");
  await page.request.post(`/api/rooms/${roomId}/leave`, { data: {} }); // seat gone → active
  await page.goto("/");
  await page.locator("#historyRail .surface-heading").click();
  const row = page.locator(".history-rail-row").filter({ hasText: roomName });
  await expect(row).toHaveClass(/state-active/);

  await row.locator(".history-rail-main").click();
  await expect(page.locator("#introView")).toHaveClass(/invite-mode/);
  await expect(page.locator("#joinRoomId")).toHaveValue(roomId);
  await expect(page).toHaveURL(new RegExp(`/r/${roomId}$`));
});

test("after leaving every room the rail and History still show", async ({ page }) => {
  const roomName = `HistLeftAll ${Date.now()}`;
  await createRoom(page, roomName);

  await page.goto("/");
  const card = page.locator(".your-room-card").filter({ hasText: roomName });
  await card.getByRole("button", { name: "Leave" }).click();
  await expect(card).toHaveCount(0);

  // The live "Your rooms" hero is empty, but History outlives Leave, so the
  // browser stays in State B with the rail + History.
  await expect(page.locator("#yourRooms")).toBeHidden();
  await expect(page.locator("#introView")).toHaveClass(/has-rooms/);
  await expect(page.locator("#historyRail")).toBeVisible();

  await page.locator("#historyRail .surface-heading").click();
  const row = page.locator(".history-rail-row").filter({ hasText: roomName });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/state-active/); // room exists, seat gone → needs the password
  await expect(row).toContainText("enter");
});
