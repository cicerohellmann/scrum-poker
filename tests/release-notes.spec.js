const { expect, test } = require("@playwright/test");

test("the version chip opens the What's new dialog with the latest release", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#whatsNewButton")).toBeVisible();
  await expect(page.locator("#versionLabel")).toHaveText("v1.2");
  await expect(page.locator("#whatsNewModal")).toBeHidden();

  await page.locator("#whatsNewButton").click();
  await expect(page.locator("#whatsNewModal")).toBeVisible();
  await expect(page.locator(".whatsnew-release-head strong").first()).toHaveText("v1.2");
  await expect(page.locator(".whatsnew-release li").first()).toBeVisible();

  await page.locator("#whatsNewClose").click();
  await expect(page.locator("#whatsNewModal")).toBeHidden();
});

test("a new version updates quietly without popping a notification dot", async ({ page }) => {
  await page.goto("/");
  // The version number updates, but nothing is pushed at the user: no unseen dot,
  // and the What's new dialog only opens when they tap the chip themselves.
  await expect(page.locator("#versionLabel")).toHaveText("v1.2");
  await expect(page.locator("#versionDot")).toBeHidden();
  await expect(page.locator("#whatsNewModal")).toBeHidden();
});
