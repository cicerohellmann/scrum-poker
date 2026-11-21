const { expect, test } = require("@playwright/test");

async function createRoom(page, roomName = `Reconnect ${Date.now()}`) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    document.cookie = "scrum_poker_nickname=; Max-Age=0; Path=/";
  });
  await page.fill("#createRoomName", roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm button[type=submit]").click();
  await expect(page.locator("#roomView")).toBeVisible();

  return page.evaluate(() => {
    const roomId = location.pathname.split("/").pop();
    return { roomId, roomUrl: location.href };
  });
}

// In State B (this browser already has rooms) the landing join form is a
// collapsed rail accordion — expand it before filling.
async function expandJoinForm(page) {
  const input = page.locator("#joinRoomId");
  const heading = page.locator("#joinRoomForm .surface-heading");
  for (let i = 0; i < 3 && !(await input.isVisible()); i += 1) {
    await heading.click();
    await page.waitForTimeout(100);
  }
}

test.describe("room reconnect", () => {
  test("refreshing the same room keeps the original host session", async ({ page }) => {
    await createRoom(page, "Refresh reconnect");

    await page.reload();

    await expect(page.locator("#roomView")).toBeVisible();
    await expect(page.locator(".table-seat .seat-name")).toHaveText([/^Host#\d{4}$/]);
    await expect(page.locator("#hostBadge")).toBeVisible();
  });

  test("initial reconnect retries after a transient SSE failure", async ({ page }) => {
    await createRoom(page, "Retry reconnect");

    let eventAttempts = 0;
    await page.route(/\/api\/rooms\/[a-z0-9_-]+\/events\?.*/, async (route) => {
      eventAttempts += 1;
      if (eventAttempts === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.reload();

    await expect(page.locator("#introNotice")).toHaveText("Reconnecting to room...");
    await expect(page.locator("#roomView")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".table-seat .seat-name")).toHaveText([/^Host#\d{4}$/]);
    await expect(page.locator("#hostBadge")).toBeVisible();
    expect(eventAttempts).toBeGreaterThanOrEqual(2);
  });

  test("persistent reconnect failures return the join form", async ({ page }) => {
    await createRoom(page, "Reconnect timeout");

    await page.route(/\/api\/rooms\/[a-z0-9_-]+\/events\?.*/, async (route) => {
      await route.abort("failed");
    });

    await page.reload();

    await expect(page.locator("#introNotice")).toHaveText("Reconnecting to room...");
    await expect(page.locator("#joinRoomForm")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#introNotice")).toHaveText("Automatic reconnect is taking too long. Enter the room again.");
    await expect(page.locator("#roomView")).toBeHidden();
  });

  test("joining the same room from the landing form resumes the saved session", async ({ page }) => {
    const { roomId } = await createRoom(page, "Manual reconnect");

    await page.goto("/");
    await expandJoinForm(page);
    await page.fill("#joinRoomId", roomId);
    await page.fill("#joinName", "Host");
    await page.fill("#joinPassword", "team-pass");
    await page.locator("#joinRoomForm button[type=submit]").click();

    await expect(page.locator("#roomView")).toBeVisible();
    await expect(page.locator(".table-seat .seat-name")).toHaveText([/^Host#\d{4}$/]);
    await expect(page.locator("#hostBadge")).toBeVisible();
  });

  test("invalid saved room sessions fall back to the join screen", async ({ page }) => {
    const { roomId } = await createRoom(page, "Invalid reconnect");

    await page.evaluate((id) => {
      const key = `scrum-poker:${id}`;
      const session = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({
        ...session,
        token: "invalid-token",
      }));
    }, roomId);

    await page.reload();

    await expect(page.locator("#roomView")).toBeHidden();
    await expect(page.locator("#joinRoomForm")).toBeVisible();
    await expect(page.locator("#introNotice")).toHaveText("Saved room session not available. Enter the room again.");
  });

  test("manual join with stale saved credentials reattaches via the identity cookie, with no duplicate", async ({ page, browser }) => {
    const { roomId } = await createRoom(page, "Stale manual reconnect");

    // Corrupt the saved token so the token-resume path fails; the identity
    // cookie (still valid) should reattach this browser to its existing seat.
    await page.evaluate((id) => {
      const key = `scrum-poker:${id}`;
      const session = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({
        ...session,
        token: "invalid-token",
      }));
    }, roomId);

    await page.goto("/");
    await expandJoinForm(page);
    await page.fill("#joinRoomId", roomId);
    await page.fill("#joinName", "Host");
    await page.fill("#joinPassword", "team-pass");
    await page.locator("#joinRoomForm button[type=submit]").click();

    // Reattached, not re-prompted: the browser lands back in the room as Host.
    await expect(page.locator("#roomView")).toBeVisible();
    await expect(page.locator(".table-seat .seat-name")).toHaveText([/^Host#\d{4}$/]);
    await expect(page.locator("#hostBadge")).toBeVisible();

    // An independent browser (its own cookie) confirms there is still exactly
    // one Host — the reattach did not leave a duplicate behind.
    const observerCtx = await browser.newContext();
    const observerJoin = await observerCtx.request.post(`/api/rooms/${roomId}/join`, {
      data: { name: "Observer", password: "team-pass" },
    });
    expect(observerJoin.ok()).toBeTruthy();
    const observerPayload = await observerJoin.json();
    const hostParticipants = observerPayload.room.participants.filter((participant) => participant.name === "Host");

    expect(hostParticipants).toHaveLength(1);
    expect(hostParticipants[0].isHost).toBeTruthy();
    await observerCtx.close();
  });
});
