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

test("the owner can rename the room from the top-bar edit control", async ({ page }) => {
  const roomName = `Settings ${Date.now()}`;
  await createRoom(page, roomName);

  // The owner sees an edit control; a change to the name shows live in the title.
  const editButton = page.locator("#roomEditButton");
  await expect(editButton).toBeVisible();
  await editButton.click();

  await expect(page.locator("#roomSettingsModal")).toBeVisible();
  await page.fill("#roomSettingsName", "Renamed Live");
  await page.locator("#roomSettingsSaveName").click();

  await expect(page.locator("#roomTitle")).toHaveText("Renamed Live");
});

test("the owner sees an Edit control on their dashboard room card", async ({ page }) => {
  const roomName = `DashEdit ${Date.now()}`;
  await createRoom(page, roomName);

  await page.goto("/");
  const card = page.locator(".your-room-card").filter({ hasText: roomName });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("a non-owner does not see the edit control", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const roomId = await createRoom(ownerPage, `NonOwner ${Date.now()}`);

  // A second, independent browser joins the same room as a plain player.
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`/r/${roomId}`);
  await playerPage.fill("#joinName", "Lin");
  await playerPage.fill("#joinPassword", "team-pass");
  await playerPage.locator("#joinRoomForm").getByRole("button", { name: /Join room|Enter room/ }).click();
  await expect(playerPage.locator("#roomView")).toBeVisible();

  await expect(playerPage.locator("#roomEditButton")).toBeHidden();

  await ownerContext.close();
  await playerContext.close();
});
