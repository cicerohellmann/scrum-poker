const { expect, test } = require("@playwright/test");

async function createRoom(page, name) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", name);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
}

test("N card casts a free number shown on the card and the revealed seat", async ({ page }) => {
  await createRoom(page, `Free ${Date.now()}`);

  const nCard = page.locator('#deck .vote-card[data-value="N"]');
  await expect(nCard).toBeVisible();
  // N is the rightmost value card in the deck (the clear-vote card comes after it).
  await expect(page.locator("#deck .vote-card:not(.clear-card)").last()).toHaveAttribute("data-value", "N");

  await nCard.click();
  const input = page.locator("#freeNumberInput");
  await expect(input).toBeVisible();
  await input.fill("42");
  await input.press("Enter");

  // The N card reflects the chosen number and the selected state.
  await expect(nCard).toHaveClass(/selected/);
  await expect(nCard).toContainText("42");

  // Revealing (host taps the centre stack) shows the number on the seat.
  await page.locator("#tableStackButton").click();
  await expect(page.locator(".table-seat .seat-card")).toHaveText("42");
});

test("N card does not cast a value over the cap", async ({ page }) => {
  await createRoom(page, `FreeCap ${Date.now()}`);

  await page.locator('#deck .vote-card[data-value="N"]').click();
  const input = page.locator("#freeNumberInput");
  await input.fill("100001");
  await input.press("Enter");

  await expect(page.locator('#deck .vote-card[data-value="N"]')).not.toHaveClass(/selected/);
});
