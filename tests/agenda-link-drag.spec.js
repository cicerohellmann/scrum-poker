const { expect, test } = require("@playwright/test");

// SKIPPED: agenda hidden by Tickets, pending owner's decision on removing agenda.

async function makeNote(page, title, url) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", `Link ${Date.now()}`);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  // Agenda defaults to collapsed; open it before interacting with the viewport.
  await page.locator("#agendaToggle").click();
  await expect(page.locator("#agendaBoard")).not.toHaveClass(/collapsed/);
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.locator("#agendaEditor .agenda-entry-input.title").fill(title);
  if (url) await page.locator("#agendaEditor .agenda-entry-input.link").fill(url);
  await page.locator(".agenda-entry-btn.set").click();
  await expect(page.locator("#agendaEditor")).toBeHidden();
  return page.locator(".agenda-entry").first();
}

async function dragTitle(page, entry, dy) {
  const title = entry.locator(".agenda-entry-display");
  const box = await title.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 8 });
  await page.mouse.up();
}

// Regression guard: a note with a URL renders its title as an <a>. That anchor
// used to stopPropagation on pointerdown, which swallowed the move-drag so a
// linked note could not be dragged at all (on mouse or touch). It must drag now.
// (Tap-to-open-in-new-tab is covered by agenda-entries.spec.js.)
test.skip("a note WITH a link can still be dragged by its title", async ({ page }) => {
  const entry = await makeNote(page, "Linked topic", "http://example.com/x");
  const read = () => entry.evaluate((el) => Number(el.dataset.startMin));
  const before = await read();
  await dragTitle(page, entry, 56); // ~2 rows down
  const after = await read();
  expect(after).not.toBe(before);
});
