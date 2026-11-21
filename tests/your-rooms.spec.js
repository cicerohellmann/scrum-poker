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

test("the root page lists a joined room and rejoins it password-free", async ({ page }) => {
  const roomName = `Yours ${Date.now()}`;
  const roomId = await createRoom(page, roomName);

  await page.goto("/");
  await expect(page.locator("#yourRooms")).toBeVisible();

  const card = page.locator(".your-room-card").filter({ hasText: roomName });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Room expires in");
  await expect(card).toContainText("session expires in");

  await card.getByRole("button", { name: "Rejoin" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/r/${roomId}$`));
});

test("Leave from a your-rooms card removes it from the list", async ({ page }) => {
  const roomName = `LeaveCard ${Date.now()}`;
  await createRoom(page, roomName);

  await page.goto("/");
  const card = page.locator(".your-room-card").filter({ hasText: roomName });
  await expect(card).toHaveCount(1);

  await card.getByRole("button", { name: "Leave" }).click();
  await expect(card).toHaveCount(0);
});

test("a fresh browser sees no 'Your rooms' panel", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#yourRooms")).toBeHidden();
  await expect(page.locator("#introView")).not.toHaveClass(/has-rooms/);
  await expect(page.locator("#createRoomName")).toBeVisible(); // State A: forms open
});

test("State B collapses the create/join forms into an expandable left rail", async ({ page }) => {
  const roomName = `Rail ${Date.now()}`;
  await createRoom(page, roomName); // created on a fresh State A page
  await page.goto("/"); // now State B for this browser

  await expect(page.locator("#introView")).toHaveClass(/has-rooms/);
  await expect(page.locator("#createRoomName")).toBeHidden(); // collapsed by default

  await page.locator("#createRoomForm .surface-heading").click();
  await expect(page.locator("#createRoomName")).toBeVisible();

  // Opening Join collapses Start (one open at a time).
  await page.locator("#joinRoomForm .surface-heading").click();
  await expect(page.locator("#joinRoomId")).toBeVisible();
  await expect(page.locator("#createRoomName")).toBeHidden();
});
