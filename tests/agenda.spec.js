const { expect, test } = require("@playwright/test");

// SKIPPED: agenda hidden by Tickets, pending owner's decision on removing agenda.

async function createRoom(page, name) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", name);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
}

test.skip("agenda board shows a 5-minute time rail aligned to now and collapses", async ({ page }) => {
  await createRoom(page, `Agenda ${Date.now()}`);

  const board = page.locator("#agendaBoard");
  await expect(board).toBeVisible();
  // It lives inside the table scene (the canvas), not the top chrome.
  await expect(page.locator(".round-table-scene #agendaBoard")).toHaveCount(1);

  // Defaults to collapsed; opening it reveals the time rail.
  const toggle = page.locator("#agendaToggle");
  await expect(board).toHaveClass(/collapsed/);
  await toggle.click();
  await expect(board).not.toHaveClass(/collapsed/);

  // Time labels are 5-minute increments in HH:MM.
  const times = (await page.locator("#agendaRail .agenda-time").allInnerTexts()).filter(Boolean);
  expect(times.length).toBeGreaterThan(10);
  for (const t of times.slice(0, 6)) expect(t).toMatch(/^\d{2}:\d{2}$/);

  // Consecutive rows are 5 minutes apart.
  const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  expect(toMinutes(times[1]) - toMinutes(times[0])).toBe(5);

  // The highlighted "now" row matches the current 5-minute block.
  const { nowLabel, expected } = await page.evaluate(() => {
    const el = document.querySelector("#agendaRail .agenda-row.is-now .agenda-time");
    const d = new Date();
    const m = Math.floor(d.getMinutes() / 5) * 5;
    const expected = String(d.getHours()).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    return { nowLabel: el ? el.textContent : null, expected };
  });
  expect(nowLabel).toBe(expected);

  // Collapses again on toggle.
  await toggle.click();
  await expect(board).toHaveClass(/collapsed/);
});
