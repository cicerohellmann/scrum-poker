const { expect, test } = require("@playwright/test");

async function createRoom(page, name) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", name);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => location.pathname.split("/").pop());
}

async function joinRoom(page, roomId, name) {
  await page.goto(`/r/${roomId}`);
  await page.fill("#joinName", name);
  await page.fill("#joinPassword", "team-pass");
  await page.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
}

test("a participant's seat disappears when they close their tab", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Presence ${Date.now()}`);
  await expect(page.locator(".table-seat")).toHaveCount(1); // just the host

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await joinRoom(guestPage, roomId, "Guest");

  // Host sees the guest join live.
  await expect(page.locator(".table-seat")).toHaveCount(2);

  // Guest closes their tab -> host should see the guest's seat removed.
  await guestContext.close();
  await expect(page.locator(".table-seat")).toHaveCount(1);
});
