const { expect, test } = require("@playwright/test");

async function createRoom(page, name, displayName) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", name);
  await page.fill("#createName", displayName);
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => location.pathname.split("/").pop());
}

test("the same browser does not create a duplicate seat after losing its saved session", async ({ page, context }) => {
  const roomId = await createRoom(page, `Dedup ${Date.now()}`, "Plop");
  await expect(page.locator(".table-seat")).toHaveCount(1);

  // A second tab in the SAME browser (shares the identity cookie) whose saved
  // localStorage session is gone must reattach to the existing participant via
  // the cookie, not mint a duplicate.
  const page2 = await context.newPage();
  await page2.goto(`/r/${roomId}`);
  await page2.evaluate(() => localStorage.clear());
  await page2.reload();
  await page2.fill("#joinName", "Plop");
  await page2.fill("#joinPassword", "team-pass");
  await page2.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(page2.locator("#roomView")).toBeVisible();

  await expect(page.locator(".table-seat")).toHaveCount(1);
  await expect(page2.locator(".table-seat")).toHaveCount(1);
});

test("two different browsers with the same name get distinct #NNNN suffixes", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Disc ${Date.now()}`, "Plop");

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(`/r/${roomId}`);
  await pageB.fill("#joinName", "Plop");
  await pageB.fill("#joinPassword", "team-pass");
  await pageB.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(pageB.locator("#roomView")).toBeVisible();

  await expect(page.locator(".table-seat")).toHaveCount(2);
  const names = await page.locator(".seat-name").allTextContents();
  expect(names).toHaveLength(2);
  for (const n of names) expect(n).toMatch(/^Plop#\d{4}$/);
  expect(names[0]).not.toBe(names[1]);

  await ctxB.close();
});
