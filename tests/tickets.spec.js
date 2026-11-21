const { expect, test } = require("@playwright/test");

async function createRoom(page, roomName = `Tickets ${Date.now()}`) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.fill("#createRoomName", roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  return page.evaluate(() => location.pathname.split("/").pop());
}

async function addTickets(page, titles) {
  await page.locator("#ticketsAddButton").click();
  await expect(page.locator("#ticketAddModal")).toBeVisible();
  for (const title of titles) {
    await page.fill("#ticketTitleInput", title);
    await page.locator("#ticketAddSubmit").click();
    await expect(page.locator("#ticketAddedNote")).toContainText(title);
  }
  await page.locator("#ticketAddDone").click();
  await expect(page.locator("#ticketAddModal")).toBeHidden();
}

async function selectTicket(page, title) {
  const card = page.locator(".ticket-card").filter({ hasText: title });
  if (!(await card.evaluate((el) => el.classList.contains("selected")))) await card.click();
  await expect(card).toHaveClass(/selected/);
  return card;
}

async function voteAndReveal(page, value = "5") {
  await page.locator(`#deck .vote-card[data-value="${value}"]`).click();
  await page.locator("#tableStackButton").click();
}

test("adding two tickets lists both in the Tickets column", async ({ page }) => {
  await createRoom(page);
  await addTickets(page, ["Login page", "Billing export"]);
  await expect(page.locator(".ticket-card")).toHaveCount(2);
  await expect(page.locator(".ticket-card").nth(0)).toContainText("Login page");
  await expect(page.locator(".ticket-card").nth(1)).toContainText("Billing export");
  await expect(page.locator("#ticketsCount")).toHaveText("2 to estimate");
});

test("reveal shows Confirm and Clear (no select); Clear wipes votes and leaves History empty", async ({ page }) => {
  await createRoom(page);
  await addTickets(page, ["Clear me"]);
  const card = await selectTicket(page, "Clear me");
  await voteAndReveal(page);

  await expect(card.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  await expect(page.locator(".ticket-confirm select, .ticket-card select")).toHaveCount(0);

  await card.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(card.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  await expect(page.locator("#tableTitle")).toHaveText("Pick your estimate");
  await expect(page.locator("#deck .vote-card.selected")).toHaveCount(0);
  await expect(page.locator("#historyToggleButton")).toBeDisabled();
  await expect(page.locator("#ticketHistoryList .history-card")).toHaveCount(0);
  await expect(page.locator("#historyList .history-card")).toHaveCount(0);
});

test("Confirm moves the ticket to History with vote chips; Re-estimate brings it back", async ({ page }) => {
  await createRoom(page);
  await addTickets(page, ["Ship it"]);
  const card = await selectTicket(page, "Ship it");
  await voteAndReveal(page, "5");
  await card.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(page.locator("#historyPanel")).toBeVisible();
  const done = page.locator("#ticketHistoryList .history-card");
  await expect(done).toHaveCount(1);
  await expect(done).toContainText("Ship it");
  await expect(done.locator(".history-card-chips span")).toHaveText(["Host: 5"]);
  // No summary line and no value badge on History cards.
  await expect(done.locator(".history-card-summary, .history-card-badge, .ticket-badge, .badge")).toHaveCount(0);
  await expect(page.locator(".ticket-card").filter({ hasText: "Ship it" })).toHaveCount(0);

  await done.getByRole("button", { name: "Re-estimate" }).click();
  await expect(page.locator("#ticketHistoryList .history-card")).toHaveCount(0);
  await expect(page.locator(".ticket-card").filter({ hasText: "Ship it" })).toHaveCount(1);
});

test("switching and unmarking tickets keeps the vote; two marked tickets confirm together", async ({ page }) => {
  await createRoom(page);
  await addTickets(page, ["First", "Second", "Third"]);
  await page.locator('#deck .vote-card[data-value="5"]').click();
  await selectTicket(page, "First");
  await selectTicket(page, "Third");
  // Clicking a marked ticket unmarks it.
  const third = page.locator(".ticket-card").filter({ hasText: "Third" });
  await third.click();
  await expect(third).not.toHaveClass(/selected/);
  await expect(page.locator('#deck .vote-card[data-value="5"]')).toHaveClass(/selected/);

  await selectTicket(page, "Second");
  await expect(page.locator(".ticket-card.selected")).toHaveCount(2);
  await page.locator("#tableStackButton").click();
  const first = page.locator(".ticket-card").filter({ hasText: "First" });
  await first.getByRole("button", { name: "Confirm both", exact: true }).click();

  const done = page.locator("#ticketHistoryList .history-card");
  await expect(done).toHaveCount(2);
  await expect(done.filter({ hasText: "First" }).locator(".history-card-chips span")).toHaveText(["Host: 5"]);
  await expect(done.filter({ hasText: "Second" }).locator(".history-card-chips span")).toHaveText(["Host: 5"]);
  await expect(page.locator(".ticket-card")).toHaveCount(1);
  await expect(page.locator(".ticket-card")).toContainText("Third");
});

test("a second browser context in the same room sees the same tickets", async ({ page, browser }) => {
  const roomId = await createRoom(page);
  await addTickets(page, ["Shared one", "Shared two"]);

  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(`/r/${roomId}`);
    await guest.fill("#joinName", "Guest");
    await guest.fill("#joinPassword", "team-pass");
    await guest.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
    await expect(guest.locator("#roomView")).toBeVisible();
    await expect(guest.locator(".ticket-card")).toHaveCount(2);
    await expect(guest.locator(".ticket-card").nth(0)).toContainText("Shared one");
    await expect(guest.locator(".ticket-card").nth(1)).toContainText("Shared two");

    // And a later change on the host reaches the guest live.
    await addTickets(page, ["Shared three"]);
    await expect(guest.locator(".ticket-card")).toHaveCount(3);
  } finally {
    await context.close();
  }
});

async function openHistoryWithOneTicket(page) {
  await createRoom(page);
  await addTickets(page, ["Layout ticket"]);
  const card = await selectTicket(page, "Layout ticket");
  await voteAndReveal(page);
  await card.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator("#historyPanel")).toBeVisible();
}

test.describe("widths", () => {
  test("at 1024px wide History's right edge is inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openHistoryWithOneTicket(page);
    const box = await page.locator("#historyPanel").boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024 + 0.5);
  });

  test("at 390px wide a deck card is at least 44px wide", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createRoom(page);
    const box = await page.locator("#deck .vote-card").first().boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test("at 1440px the Tickets panel is 300px and History is 340px wide", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHistoryWithOneTicket(page);
    const tickets = await page.locator("#ticketsPanel").boundingBox();
    const history = await page.locator("#historyPanel").boundingBox();
    expect(Math.round(tickets.width)).toBe(300);
    expect(Math.round(history.width)).toBe(340);
  });
});
