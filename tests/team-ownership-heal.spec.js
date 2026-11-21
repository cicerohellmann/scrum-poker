const { expect, test } = require("@playwright/test");

// Regression: an OLD room whose owner's identity cookie has since changed (cleared
// / rotated / opened in another profile) but whose saved localStorage session
// still reattaches the seat. me.isOwner stays true (participant-based), so owner
// controls show. Before the fix, owner writes authorized off the *cookie* and
// 403'd, so teams appeared to add then vanished. The resume path now re-keys
// ownership to the current cookie, so owner writes succeed and teams persist.
test("owner whose identity cookie changed can still create teams that persist", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", `OldRoom ${Date.now()}`);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  const roomId = await page.evaluate(() => location.pathname.split("/").pop());

  // Simulate the cookie having changed since the room was created.
  await context.clearCookies();

  // Reload -> resume via the saved session token; ownership heals to the new cookie.
  await page.reload();
  await expect(page.locator("#roomView")).toBeVisible();

  let teamsStatus = null;
  page.on("response", (resp) => {
    if (resp.url().includes(`/api/rooms/${roomId}/teams`)) teamsStatus = resp.status();
  });

  // Owner controls are visible (participant-based ownership).
  await expect(page.locator("#roomEditButton")).toBeVisible();
  await page.locator("#roomEditButton").click();
  await expect(page.locator("#roomSettingsModal")).toBeVisible();

  await page.fill("#teamNameInput", "Android");
  await page.locator("#teamAddButton").click();
  await expect(page.locator("#teamsList")).toContainText("Android");

  // The write authorized (heal worked), not a silent 403.
  await expect.poll(() => teamsStatus).toBe(200);

  // Close, reopen: the team survived (truly persisted server-side).
  await page.locator("#roomSettingsClose").click();
  await expect(page.locator("#roomSettingsModal")).toBeHidden();
  await page.locator("#roomEditButton").click();
  await expect(page.locator("#roomSettingsModal")).toBeVisible();
  await expect(page.locator("#teamsList")).toContainText("Android");
});

// A non-owner must still never be able to write teams: reattaching a seat by a
// changed cookie only heals the *owner* seat, proven by its session token.
test("a non-owner still cannot create teams", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/");
  await ownerPage.evaluate(() => localStorage.clear());
  await ownerPage.fill("#createRoomName", `Guard ${Date.now()}`);
  await ownerPage.fill("#createName", "Host");
  await ownerPage.fill("#createPassword", "team-pass");
  await ownerPage.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(ownerPage.locator("#roomView")).toBeVisible();
  const roomId = await ownerPage.evaluate(() => location.pathname.split("/").pop());

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await playerPage.goto(`/r/${roomId}`);
  await playerPage.fill("#joinName", "Lin");
  await playerPage.fill("#joinPassword", "team-pass");
  await playerPage.locator("#joinRoomForm").getByRole("button", { name: /Join room|Enter room/ }).click();
  await expect(playerPage.locator("#roomView")).toBeVisible();

  // No owner controls, and a direct POST is rejected.
  await expect(playerPage.locator("#roomEditButton")).toBeHidden();
  const status = await playerPage.evaluate(async (id) => {
    const res = await fetch(`/api/rooms/${id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams: [{ name: "Sneaky", color: "#ff0000" }] }),
    });
    return res.status;
  }, roomId);
  expect(status).toBe(403);

  await ownerContext.close();
  await playerContext.close();
});
