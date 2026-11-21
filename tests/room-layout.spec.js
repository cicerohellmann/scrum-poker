const { expect, test } = require("@playwright/test");

const SPLIT_LAPTOP = { width: 980, height: 700 };
const LAPTOP_14 = { width: 1512, height: 820 };
const LAPTOP_16 = { width: 1728, height: 960 };
const MOBILE = { width: 390, height: 844 };

async function createRoom(page, roomName = `Layout ${Date.now()}`) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    document.cookie = "scrum_poker_nickname=; Max-Age=0; Path=/";
  });
  await page.fill("#createRoomName", roomName);
  await page.fill("#createName", "Host");
  await page.fill("#createPassword", "team-pass");
  await page.locator("#createRoomForm").getByRole("button", { name: "Create room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  await expect(page.locator("#topbarRoom")).toBeVisible();

  return page.evaluate(() => {
    const roomId = location.pathname.split("/").pop();
    const session = JSON.parse(localStorage.getItem(`scrum-poker:${roomId}`));
    return { roomId, session };
  });
}

async function authedPost(page, roomId, session, action, body = {}) {
  const response = await page.request.post(`/api/rooms/${roomId}/${action}`, {
    data: {
      participantId: session.id,
      ...body,
    },
    headers: {
      authorization: `Bearer ${session.token}`,
    },
  });

  expect(response.ok()).toBeTruthy();
  return response.json();
}

// Join a room in its own browser context so the participant holds a live event
// stream (online). API-only joins are offline and are not shown in the room.
async function joinViaBrowser(browser, roomId, name, viewport) {
  const context = await browser.newContext(viewport ? { viewport } : undefined);
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  await page.fill("#joinName", name);
  await page.fill("#joinPassword", "team-pass");
  await page.locator("#joinRoomForm").getByRole("button", { name: "Enter room" }).click();
  await expect(page.locator("#roomView")).toBeVisible();
  const session = await page.evaluate(() => {
    const roomId = location.pathname.split("/").pop();
    return JSON.parse(localStorage.getItem(`scrum-poker:${roomId}`));
  });
  return { context, page, session };
}

async function createVoteHistory(page, roomId, session) {
  await authedPost(page, roomId, session, "vote", { value: "5" });
  await authedPost(page, roomId, session, "reveal");
  await authedPost(page, roomId, session, "reset");
  await expect(page.getByRole("button", { name: /History \(1\)/ })).toBeVisible();
}

async function createInviteRoom(page, roomName = `Invite ${Date.now()}`) {
  const { roomId } = await createRoom(page, roomName);
  return roomId;
}

async function assertVisibleWithinViewport(page, selectorOrLocator, label) {
  const locator = typeof selectorOrLocator === "string" ? page.locator(selectorOrLocator) : selectorOrLocator;
  await expect(locator, `${label} should be visible`).toBeVisible();

  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label} should have layout bounds`).not.toBeNull();
  expect(box.x, `${label} should not start left of viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} should not start above viewport`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} should not overflow right`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${label} should not overflow bottom`).toBeLessThanOrEqual(viewport.height + 1);
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));

  expect(overflow.x, `${label} should not scroll horizontally`).toBeLessThanOrEqual(1);
  expect(overflow.y, `${label} should not scroll vertically`).toBeLessThanOrEqual(1);
}

async function assertDeckCardsContained(page, label) {
  const contained = await page.evaluate(() => {
    const deck = document.querySelector("#deck")?.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll("#deck .vote-card"));
    if (!deck || cards.length === 0) return null;

    const first = cards[0].getBoundingClientRect();
    const last = cards[cards.length - 1].getBoundingClientRect();
    return {
      firstLeft: first.left >= deck.left - 1,
      lastRight: last.right <= deck.right + 1,
    };
  });

  expect(contained, `${label} should have a visible card deck`).not.toBeNull();
  expect(contained.firstLeft, `${label} first card should not be clipped`).toBeTruthy();
  expect(contained.lastRight, `${label} last card should not be clipped`).toBeTruthy();
}

async function assertRoomShellFits(page, label) {
  await assertNoPageOverflow(page, label);
  await assertVisibleWithinViewport(page, "#topbarRoom", `${label} room title`);
  await assertVisibleWithinViewport(page, "#copyLinkButton", `${label} copy link`);
  await assertVisibleWithinViewport(page, "#historyToggleButton", `${label} history`);
  await assertVisibleWithinViewport(page, "#leaveRoomButton", `${label} leave`);
  await assertVisibleWithinViewport(page, ".round-table-scene", `${label} table`);
  await assertVisibleWithinViewport(page, "#scrumHand", `${label} card hand`);
  await assertDeckCardsContained(page, `${label} deck`);
}

async function assertSeatsAvoidCenter(page, label) {
  const contained = await page.locator(".table-seat").evaluateAll((seats) => {
    const scene = document.querySelector(".round-table-scene").getBoundingClientRect();
    const center = document.querySelector(".table-center-panel").getBoundingClientRect();
    const tolerance = 6;
    return seats.map((seat) => {
      const rect = seat.getBoundingClientRect();
      return {
        left: rect.left >= scene.left - tolerance,
        right: rect.right <= scene.right + tolerance,
        top: rect.top >= scene.top - tolerance,
        bottom: rect.bottom <= scene.bottom + tolerance,
        avoidsCenter:
          rect.right <= center.left + tolerance ||
          rect.left >= center.right - tolerance ||
          rect.bottom <= center.top + tolerance ||
          rect.top >= center.bottom - tolerance,
      };
    });
  });

  expect(contained.length, `${label} should render seats`).toBeGreaterThan(0);
  expect(contained.every((bounds) => Object.values(bounds).every(Boolean)), `${label} seats should stay inside scene and away from the center`).toBeTruthy();
}

test.describe("room layout", () => {
  test("keeps the landing page focused on the forms without the large banner panel", async ({ page }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    await page.goto("/");

    await expect(page.locator(".intro-copy")).toBeHidden();
    await expect(page.locator("#createRoomForm")).toBeVisible();
    await expect(page.locator("#joinRoomForm")).toBeVisible();
    await assertVisibleWithinViewport(page, "#createRoomForm", "landing create form");
    await assertVisibleWithinViewport(page, "#joinRoomForm", "landing join form");
  });

  test("keeps invite links on a compact enter-room form", async ({ page, browser }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    const roomId = await createInviteRoom(page, "Invite compact");

    const invitePage = await browser.newPage({ viewport: SPLIT_LAPTOP });
    await invitePage.goto(`/r/${roomId}`);

    await expect(invitePage.locator("#createRoomForm")).toBeHidden();
    await expect(invitePage.locator(".intro-copy")).toBeHidden();
    await expect(invitePage.locator("#joinRoomForm")).toBeVisible();
    await expect(invitePage.locator("#joinHeading")).toHaveText("Enter room");
    await expect(invitePage.locator("#waitingRoomMeta")).toContainText(roomId.toUpperCase());
    await assertVisibleWithinViewport(invitePage, "#joinRoomForm", "invite join form");
    await assertVisibleWithinViewport(invitePage, "#joinButton", "invite submit button");

    await invitePage.close();
  });

  test("keeps room actions, history, table, and cards visible in split laptop windows", async ({ page }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    const { roomId, session } = await createRoom(page, "History layout");
    await expect(page.locator("#historyToggleButton")).toBeDisabled();
    await createVoteHistory(page, roomId, session);

    await assertRoomShellFits(page, "split laptop");

    const historyButton = page.locator("#historyToggleButton");
    await historyButton.click();
    await expect(page.locator("#historyPanel")).toBeVisible();
    await expect(page.locator(".history-card")).toHaveCount(1);
    await assertVisibleWithinViewport(page, "#historyPanel", "history popover");
    await assertNoPageOverflow(page, "split laptop with history open");
  });

  test("keeps the revealed scrum state fixed without a separate result panel", async ({ page, browser }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    const { roomId, session } = await createRoom(page, "Revealed layout");

    const guest = await joinViaBrowser(browser, roomId, "Guest", SPLIT_LAPTOP);

    await authedPost(page, roomId, session, "vote", { value: "8" });
    await authedPost(page, roomId, session, "reveal");

    await assertNoPageOverflow(page, "revealed scrum");
    await assertVisibleWithinViewport(page, ".round-table-scene", "revealed scrum table");
    await assertVisibleWithinViewport(page, "#scrumHand", "revealed scrum card hand");
    await expect(page.locator("#resultsPanel")).toHaveCount(0);
    await assertDeckCardsContained(page, "revealed scrum deck");
    await assertSeatsAvoidCenter(page, "revealed scrum");
    await expect
      .poll(() =>
        page.locator(".table-seat").evaluateAll((seats) =>
          Object.fromEntries(
            seats.map((seat) => [
              // Strip the #NNNN discriminator so the assertion keys on the name.
              seat.querySelector(".seat-name")?.textContent?.replace(/#\d{4}$/, ""),
              // Scrum seats show state via the card only (no state text): the
              // revealed value, or an empty card for a non-voter.
              seat.querySelector(".seat-card")?.textContent || "",
            ]),
          ),
        ),
      )
      .toEqual({
        Host: "8",
        Guest: "",
      });

    await guest.context.close();
  });

  test("shows reveal to late joiners and lets any participant reveal via the stack", async ({ page, browser }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    const { roomId, session } = await createRoom(page, "Late reveal guard");

    const voter = await joinViaBrowser(browser, roomId, "Voter", SPLIT_LAPTOP);
    await authedPost(page, roomId, voter.session, "vote", { value: "5" });

    const late = await joinViaBrowser(browser, roomId, "Late", SPLIT_LAPTOP);
    const latePage = late.page;

    await expect(latePage.locator("#tableStackTitle")).toHaveText("Reveal");
    await expect(latePage.locator("#tableStackMeta")).toHaveText("1/3 voted");

    const lateSession = late.session;
    expect(lateSession.id).not.toBe(session.id);

    const lateReveal = await latePage.request.post(`/api/rooms/${roomId}/stack`, {
      data: {
        participantId: lateSession.id,
      },
      headers: {
        authorization: `Bearer ${lateSession.token}`,
      },
    });

    expect(lateReveal.status()).toBe(200);
    const revealedRoom = (await lateReveal.json()).room;
    expect(revealedRoom.revealed).toBe(true);
    await expect(page.locator("#tableTitle")).toHaveText("Votes revealed");
    await expect(page.locator("#tableStackTitle")).toHaveText("Reset");

    await late.context.close();
    await voter.context.close();
  });

  for (const [name, viewport] of [
    ["14-inch laptop", LAPTOP_14],
    ["16-inch laptop", LAPTOP_16],
  ]) {
    test(`keeps the active room fixed to the ${name} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { roomId, session } = await createRoom(page, `${name} layout`);
      await createVoteHistory(page, roomId, session);

      await assertRoomShellFits(page, name);
    });
  }

  test("keeps mobile usable without horizontal overflow", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    const { roomId, session } = await createRoom(page, "Mobile layout");
    await createVoteHistory(page, roomId, session);

    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.x, "mobile should not scroll horizontally").toBeLessThanOrEqual(1);
    await expect(page.locator("#copyLinkButton")).toBeVisible();
    await expect(page.locator("#historyToggleButton")).toBeVisible();
    await expect(page.locator("#leaveRoomButton")).toBeVisible();

    // The seat row must not overlap the vote deck below it (regression guard:
    // the scene used to keep a desktop height on phones and spill onto the deck).
    const rects = await page.evaluate(() => {
      const seats = document.querySelector('.table-room[data-mode="scrum"] .table-seats').getBoundingClientRect();
      const deck = document.querySelector("#scrumHand").getBoundingClientRect();
      return { seatsBottom: seats.bottom, deckTop: deck.top };
    });
    expect(rects.seatsBottom, "participant seats must not overlap the vote deck").toBeLessThanOrEqual(rects.deckTop + 1);
  });

  test("keeps poker seats contained, shows centered ranks with diagonal suits, and keeps other player credits private", async ({ page, browser }) => {
    await page.setViewportSize(SPLIT_LAPTOP);
    const { roomId, session } = await createRoom(page, "Poker layout");

    // The guest is a different browser (its own identity cookie) AND must hold a
    // live event stream: poker only seats online players, so an API-only (offline)
    // join would not be dealt in.
    const guest = await joinViaBrowser(browser, roomId, "Guest", SPLIT_LAPTOP);
    const guestJoin = { participant: guest.session };

    let pokerSnapshot;
    for (let tap = 0; tap < 3; tap += 1) {
      pokerSnapshot = await authedPost(page, roomId, session, "stack");
    }

    expect(pokerSnapshot.room.mode).toBe("poker");
    expect(pokerSnapshot.room.participants.find((participant) => participant.name === "Guest").credits).toBeNull();

    await expect(page.locator("#tableRoom")).toHaveAttribute("data-mode", "poker");
    await expect(page.locator(".table-seat")).toHaveCount(2);
    await expect(page.locator(".seat-role", { hasText: "BB" })).toBeVisible();
    await expect(page.locator(".seat-role", { hasText: "SB" })).toBeVisible();
    await expect(page.locator("#pokerPanel")).toHaveCount(0);
    await expect(page.locator(".hole-cards")).toHaveCount(0);
    await expect(page.locator("#tablePokerControls")).toBeVisible();
    await expect(page.locator("#pokerActions")).toBeVisible();
    await expect(page.locator("#pokerScramButton")).toHaveCount(0);
    await expect(page.locator("#pokerFoldButton")).toBeVisible();
    await expect(page.locator("#pokerCallButton")).toBeVisible();
    await expect(page.locator("#pokerRaiseButton")).toBeVisible();
    await expect(page.locator("#pokerCheckButton")).toBeHidden();
    await expect(page.locator("#pokerBetButton")).toBeHidden();
    await expect(page.locator("#pokerStartButton")).toBeHidden();

    const visibleDisabledActions = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#pokerActions button"))
        .filter((button) => !button.hidden && button.disabled)
        .map((button) => button.textContent.trim())
    );
    expect(visibleDisabledActions).toEqual([]);

    const cardFace = await page.locator(".playing-card:not(.face-down)").first().evaluate((card) => {
      const rank = card.querySelector(".playing-card-rank")?.getBoundingClientRect();
      const topCorner = card.querySelector(".playing-card-corner-top")?.getBoundingClientRect();
      const bottomCorner = card.querySelector(".playing-card-corner-bottom")?.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      if (!rank || !topCorner || !bottomCorner) return null;

      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const rankCenterX = rank.left + rank.width / 2;
      const rankCenterY = rank.top + rank.height / 2;
      const intersects = (a, b) =>
        !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

      return {
        centered: Math.abs(rankCenterX - centerX) <= 3 && Math.abs(rankCenterY - centerY) <= 3,
        topCornerPlaced: topCorner.left <= box.left + 8 && topCorner.top <= box.top + 8,
        bottomCornerPlaced: bottomCorner.right >= box.right - 8 && bottomCorner.bottom >= box.bottom - 8,
        rankClearOfTopCorner: !intersects(rank, topCorner),
        rankClearOfBottomCorner: !intersects(rank, bottomCorner),
        rankText: card.querySelector(".playing-card-rank")?.textContent || "",
      };
    });

    expect(cardFace).not.toBeNull();
    expect(cardFace.centered).toBeTruthy();
    expect(cardFace.topCornerPlaced).toBeTruthy();
    expect(cardFace.bottomCornerPlaced).toBeTruthy();
    expect(cardFace.rankClearOfTopCorner).toBeTruthy();
    expect(cardFace.rankClearOfBottomCorner).toBeTruthy();
    expect(cardFace.rankText).toMatch(/^(10|[2-9AJQK])$/);

    const sampleTen = await page.evaluate(() => {
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.left = "-9999px";
      host.style.top = "0";
      document.body.appendChild(host);

      const card = document.createElement("span");
      card.className = "playing-card play-card";
      card.dataset.suit = "♥";
      card.dataset.rank = "10";

      const topCorner = document.createElement("span");
      topCorner.className = "playing-card-corner playing-card-corner-top";
      topCorner.textContent = "♥";

      const rank = document.createElement("span");
      rank.className = "playing-card-rank rank long-rank";
      rank.textContent = "10";

      const bottomCorner = document.createElement("span");
      bottomCorner.className = "playing-card-corner playing-card-corner-bottom";
      bottomCorner.textContent = "♥";

      card.append(topCorner, rank, bottomCorner);
      host.appendChild(card);

      const rankBox = rank.getBoundingClientRect();
      const topBox = topCorner.getBoundingClientRect();
      const bottomBox = bottomCorner.getBoundingClientRect();

      const intersects = (a, b) =>
        !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

      return {
        rankText: rank.textContent,
        clearTop: !intersects(rankBox, topBox),
        clearBottom: !intersects(rankBox, bottomBox),
      };
    });

    expect(sampleTen.rankText).toBe("10");
    expect(sampleTen.clearTop).toBeTruthy();
    expect(sampleTen.clearBottom).toBeTruthy();

    const seatLeaks = await page.locator(".table-seat").evaluateAll((seats) =>
      seats.filter((seat) => /credits?/i.test(seat.innerText)).map((seat) => seat.innerText)
    );
    expect(seatLeaks).toEqual([]);

    const pokerLayout = await page.evaluate(() => {
      const table = document.querySelector(".round-table")?.getBoundingClientRect();
      const controls = document.querySelector("#tablePokerControls")?.getBoundingClientRect();
      const currentSeat = document.querySelector(".table-seat.current-user")?.getBoundingClientRect();
      const otherSeats = Array.from(document.querySelectorAll(".table-seat:not(.current-user)")).map((seat) => seat.getBoundingClientRect());

      if (!table || !controls || !currentSeat || otherSeats.length === 0) return null;

      return {
        controlsInsideTable:
          controls.left >= table.left - 1 &&
          controls.right <= table.right + 1 &&
          controls.top >= table.top - 1 &&
          controls.bottom <= table.bottom + 1,
        currentUserIsBottom: otherSeats.every((seat) => currentSeat.top > seat.top),
      };
    });

    expect(pokerLayout).not.toBeNull();
    expect(pokerLayout.controlsInsideTable).toBeTruthy();
    expect(pokerLayout.currentUserIsBottom).toBeTruthy();

    await page.getByRole("button", { name: "Call 1" }).click();
    await expect(page.locator("#tablePokerControls")).toBeHidden();

    await assertSeatsAvoidCenter(page, "poker split laptop");
    await assertNoPageOverflow(page, "poker split laptop");

    let returnSnapshot;
    for (let tap = 0; tap < 3; tap += 1) {
      returnSnapshot = await authedPost(page, roomId, guestJoin.participant, "stack");
    }

    expect(returnSnapshot.room.mode).toBe("scrum");
    await expect(page.locator("#tableRoom")).toHaveAttribute("data-mode", "scrum");
    await expect(page.locator("#scrumHand")).toBeVisible();

    await guest.context.close();
  });
});
