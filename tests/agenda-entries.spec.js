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
  // The agenda board defaults to collapsed; open it so its viewport is interactive.
  await page.locator("#agendaToggle").click();
  await expect(page.locator("#agendaBoard")).not.toHaveClass(/collapsed/);
  return page.evaluate(() => location.pathname.split("/").pop());
}

async function dragBy(page, locator, dy) {
  const box = await locator.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

test.skip("tap creates a blob you can resize up/down and move up/down", async ({ page }) => {
  await createRoom(page, `Entries ${Date.now()}`);

  // Tap the notebook to create an entry.
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  const entry = page.locator(".agenda-entry").first();
  await expect(entry).toBeVisible();

  const read = () => entry.evaluate((el) => ({ s: Number(el.dataset.startMin), e: Number(el.dataset.endMin) }));
  const a = await read();
  expect(a.e - a.s).toBe(15); // default 15-minute block

  // Commit first: the floating editor overlays the note, so geometry handles
  // are only interactive once the editor is closed.
  await page.locator("#agendaEditor .agenda-entry-input.title").fill("Block");
  await page.locator(".agenda-entry-btn.set").click();
  await expect(page.locator("#agendaEditor")).toBeHidden();

  // Stretch the bottom edge down 2 rows (+10 min end); start unchanged.
  await dragBy(page, entry.locator(".agenda-entry-handle.bottom"), 56);
  const b = await read();
  expect(b.s).toBe(a.s);
  expect(b.e).toBe(a.e + 10);

  // Stretch the top edge down 1 row (+5 min start); end unchanged.
  await dragBy(page, entry.locator(".agenda-entry-handle.top"), 28);
  const c = await read();
  expect(c.s).toBe(b.s + 5);
  expect(c.e).toBe(b.e);

  // Move the whole block up 2 rows (-10 min both); duration preserved.
  await dragBy(page, entry.locator(".agenda-entry-body"), -56);
  const d = await read();
  expect(d.s).toBe(c.s - 10);
  expect(d.e).toBe(c.e - 10);
});

test.skip("dragging snaps to 1-minute steps, not 5", async ({ page }) => {
  await createRoom(page, `Entries1 ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  const entry = page.locator(".agenda-entry").first();
  await expect(entry).toBeVisible();
  const read = () => entry.evaluate((el) => ({ s: Number(el.dataset.startMin), e: Number(el.dataset.endMin) }));

  // Commit so the editor closes and the resize handle is interactive.
  await page.locator("#agendaEditor .agenda-entry-input.title").fill("Block");
  await page.locator(".agenda-entry-btn.set").click();
  await expect(page.locator("#agendaEditor")).toBeHidden();

  const a = await read();
  // ~17px ≈ 3 minutes (5min = 28px). Under 5-min snapping this would round to 5.
  await dragBy(page, entry.locator(".agenda-entry-handle.bottom"), 17);
  const b = await read();
  expect(b.e - a.e).toBe(3);
});

test.skip("a new note is a draft: Enter advances fields, then creates it", async ({ page }) => {
  await createRoom(page, `Draft ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  const entry = page.locator(".agenda-entry").first();
  await expect(entry).toBeVisible();
  const editor = page.locator("#agendaEditor");
  await expect(editor.locator(".agenda-entry-actions")).toBeVisible(); // Set/Cancel
  await expect(editor.locator(".agenda-entry-input.title")).toBeFocused();

  await page.keyboard.type("Standup");
  await page.keyboard.press("Enter");
  await expect(editor.locator(".agenda-entry-input.link")).toBeFocused();

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/agenda") && r.request().method() === "POST"),
    page.keyboard.press("Enter"), // last field -> create the note
  ]);
  await expect(page.locator(".agenda-entry-actions")).toHaveCount(0); // committed, no buttons
  await expect(editor).toBeHidden();
});

test.skip("Cancel discards a draft and creates nothing", async ({ page }) => {
  await createRoom(page, `Cancel ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await expect(page.locator(".agenda-entry")).toHaveCount(1);
  await page.locator(".agenda-entry-btn.cancel").click();
  await expect(page.locator(".agenda-entry")).toHaveCount(0);
});

test.skip("committing or clicking away from an untouched note discards it", async ({ page }) => {
  await createRoom(page, `Empty ${Date.now()}`);

  // Set on a brand-new note with nothing typed creates nothing.
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await expect(page.locator(".agenda-entry")).toHaveCount(1);
  await page.locator(".agenda-entry-btn.set").click();
  await expect(page.locator(".agenda-entry")).toHaveCount(0);
  await expect(page.locator("#agendaEditor")).toBeHidden();

  // Clicking outside an untouched note also discards it (no empty note left).
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await expect(page.locator(".agenda-entry")).toHaveCount(1);
  await page.locator(".brand").click();
  await expect(page.locator(".agenda-entry")).toHaveCount(0);
});

test.skip("a note has a title (T) field and a link field that persist", async ({ page }) => {
  await createRoom(page, `Fields ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  const entry = page.locator(".agenda-entry").first();
  await expect(entry).toBeVisible();

  // Two fields, each with a left-side label/icon (in the floating editor).
  const editor = page.locator("#agendaEditor");
  await expect(editor.locator(".agenda-entry-field.title .agenda-entry-icon")).toHaveText("T");
  const title = editor.locator(".agenda-entry-input.title");
  const link = editor.locator(".agenda-entry-input.link");
  await expect(title).toBeVisible();
  await expect(link).toBeVisible();

  await title.fill("Standup");
  await link.fill("https://jira/x");
  await link.press("Enter"); // commit: Enter on the last field creates the note

  // After a reload the committed note shows its title, styled as a link because
  // a URL was stored (both fields survived on the server).
  await page.reload();
  const display = page.locator(".agenda-entry-display").first();
  await expect(display).toHaveText("Standup");
  await expect(display).toHaveClass(/link/);
});

test.skip("a committed note shows only the title; a linked title opens in a new tab", async ({ page, context }) => {
  await createRoom(page, `Link ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.keyboard.type("PROJ-1");
  await page.keyboard.press("Enter"); // -> link field
  await page.keyboard.type("https://example.com/PROJ-1");
  await page.keyboard.press("Enter"); // commit

  const entry = page.locator(".agenda-entry").first();
  await expect(entry.locator(".agenda-entry-input")).toHaveCount(0); // no input boxes anymore
  const display = entry.locator(".agenda-entry-display");
  await expect(display).toHaveText("PROJ-1");
  await expect(display).toHaveClass(/link/);

  const popupPromise = context.waitForEvent("page");
  await display.click();
  const popup = await popupPromise;
  expect(popup.url()).toContain("example.com/PROJ-1");
  await popup.close();
});

test.skip("clicking the card (not the link text) does not open the link", async ({ page, context }) => {
  await createRoom(page, `CardClick ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.keyboard.type("PROJ-1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("https://example.com/x");
  await page.keyboard.press("Enter");

  let opened = false;
  context.on("page", () => {
    opened = true;
  });

  // Click the card body, away from the (top-left, text-hugging) link.
  const entry = page.locator(".agenda-entry").first();
  await expect(entry.locator(".agenda-entry-display.link")).toBeVisible();
  await entry.click({ position: { x: 120, y: 55 }, force: true });
  await page.waitForTimeout(300);
  expect(opened).toBe(false);
});

test.skip("a long note title wraps and re-fits when the box is resized", async ({ page }) => {
  await createRoom(page, `Wrap ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.keyboard.type("This is a very long agenda note title that should wrap across multiple lines");
  await page.keyboard.press("Enter"); // -> link
  await page.keyboard.press("Enter"); // commit, no link

  const entry = page.locator(".agenda-entry").first();
  const display = entry.locator(".agenda-entry-display");
  await expect(display).toBeVisible();

  const lines1 = await display.evaluate((el) => Number(el.dataset.lines));
  expect(lines1).toBeGreaterThan(1); // wraps to several lines, not a single ellipsised line

  // Resizing the box taller fits more lines.
  await dragBy(page, entry.locator(".agenda-entry-handle.bottom"), 84);
  const lines2 = await display.evaluate((el) => Number(el.dataset.lines));
  expect(lines2).toBeGreaterThan(lines1);
});

test.skip("hovering a committed note reveals trash + edit controls outside the notepad", async ({ page }) => {
  await createRoom(page, `Controls ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.keyboard.type("Standup");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // commit

  const entry = page.locator(".agenda-entry").first();
  const controls = page.locator("#agendaControls");
  await expect(controls).toBeHidden(); // not shown until hovered

  await entry.hover();
  await expect(controls).toBeVisible();

  // Edit re-opens the form (in the floating editor) with the current values.
  await page.locator("#agendaEdit").click();
  await expect(page.locator("#agendaEditor .agenda-entry-input.title")).toHaveValue("Standup");
  // Cancel reverts to the committed display (does not delete).
  await page.locator(".agenda-entry-btn.cancel").click();
  await expect(page.locator("#agendaEditor")).toBeHidden();
  await expect(page.locator(".agenda-entry-display")).toHaveText("Standup");

  // Trash deletes the note.
  await page.locator(".agenda-entry").first().hover();
  await page.locator("#agendaTrash").click();
  await expect(page.locator(".agenda-entry")).toHaveCount(0);
});

test.skip("a committed note without a link shows a plain title", async ({ page }) => {
  await createRoom(page, `Plain ${Date.now()}`);

  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await page.keyboard.type("Standup");
  await page.keyboard.press("Enter"); // -> link field
  await page.keyboard.press("Enter"); // commit with empty link

  const display = page.locator(".agenda-entry-display").first();
  await expect(display).toHaveText("Standup");
  await expect(display).not.toHaveClass(/link/);
});

test.skip("the agenda clock follows time, unlocks on scroll, and re-locks on click", async ({ page }) => {
  await createRoom(page, `Clock ${Date.now()}`);

  const clock = page.locator("#agendaClock");
  await expect(clock).toBeVisible(); // shown while the agenda is open
  await expect(clock).not.toHaveClass(/unlocked/); // locked = coloured

  // Scrolling the notepad disables the time-lock (clock goes grey).
  await page.locator("#agendaViewport").hover();
  await page.mouse.wheel(0, 240);
  await expect(clock).toHaveClass(/unlocked/);

  // Clicking the clock re-enables the lock and jumps to now.
  await clock.click();
  await expect(clock).not.toHaveClass(/unlocked/);

  // The clock hides when the agenda is collapsed.
  await page.locator("#agendaToggle").click();
  await expect(clock).toBeHidden();
});

test.skip("scrolling while editing a note still unlocks the time-lock", async ({ page }) => {
  await createRoom(page, `EditScroll ${Date.now()}`);

  // Open a draft — this focuses the title field in the floating editor.
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await expect(page.locator("#agendaEditor .agenda-entry-input.title")).toBeFocused();

  const clock = page.locator("#agendaClock");
  await expect(clock).not.toHaveClass(/unlocked/); // still locked while editing

  // Scrolling the notepad while editing must still unlock (so you can scroll).
  // Scroll over the time gutter, which the floating editor does not cover.
  await page.locator("#agendaViewport").hover({ position: { x: 20, y: 150 } });
  await page.mouse.wheel(0, 240);
  await expect(clock).toHaveClass(/unlocked/);
});

test.skip("notes are shared with everyone in the room", async ({ page, browser }) => {
  const roomId = await createRoom(page, `Shared ${Date.now()}`);

  // Person A creates a draft note, types a title, then commits it (which shares it).
  await page.locator("#agendaViewport").click({ position: { x: 170, y: 90 } });
  await expect(page.locator(".agenda-entry")).toHaveCount(1);
  await page.locator("#agendaEditor .agenda-entry-input.title").fill("Standup");
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/agenda") && r.request().method() === "POST"),
    page.locator(".agenda-entry-btn.set").click(),
  ]);

  // Person B joins the same room and sees the note.
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await pageB.goto(`/r/${roomId}`);
  await pageB.fill("#joinName", "Bo");
  await pageB.fill("#joinPassword", "team-pass");
  await pageB.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(pageB.locator("#roomView")).toBeVisible();

  await expect(pageB.locator(".agenda-entry")).toHaveCount(1);

  await contextB.close();
});
