const { expect, test } = require("@playwright/test");

test.use({ colorScheme: "light" });

test("day/night toggle switches to dark and persists across reload", async ({ page }) => {
  await page.goto("/");

  const html = page.locator("html");
  const toggle = page.locator("#themeToggle");
  await expect(toggle).toBeVisible();

  // First visit with a light OS preference defaults to light.
  await expect(html).toHaveAttribute("data-theme", "light");
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).not.toBe(lightBg);

  // The choice persists across a reload.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("the toggle sits at the top-right of the header", async ({ page }) => {
  await page.goto("/");
  const toggleBox = await page.locator("#themeToggle").boundingBox();
  const headerBox = await page.locator(".topbar").boundingBox();
  // Right-aligned within the header.
  expect(toggleBox.x + toggleBox.width).toBeGreaterThan(headerBox.x + headerBox.width * 0.7);
});
