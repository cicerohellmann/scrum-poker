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

// One real round: vote, reveal, then reset — the reset is what records history.
async function recordOneRound(page, value) {
  await page.locator(`.vote-card[data-value="${value}"]`).click();
  await page.locator("#tableStackButton").click(); // Reveal
  await expect(page.locator("#tableStackTitle")).toHaveText("Reset");
  await page.locator("#tableStackButton").click(); // Reset → records the round
  await expect(page.locator("#tableStackTitle")).toHaveText("Card stack");
}

test("Export sits by Previous votes, opens a picker preset to today, and downloads a CSV", async ({ page }) => {
  await createRoom(page, `Export ${Date.now()}`);
  await recordOneRound(page, "5");

  // History toggle becomes enabled once a round exists; open the panel.
  const toggle = page.locator("#historyToggleButton");
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.locator("#historyPanel")).toBeVisible();

  // Export button lives in the panel heading, right of "Previous votes".
  const exportBtn = page.locator("#exportButton");
  await expect(exportBtn).toBeVisible();

  // Opens a range picker preset to the local day boundaries.
  await exportBtn.click();
  const picker = page.locator("#exportPicker");
  await expect(picker).toBeVisible();

  const from = await page.locator("#exportFrom").inputValue();
  const to = await page.locator("#exportTo").inputValue();
  // Preset: today 00:00 -> tomorrow 00:00 in local time.
  expect(from).toMatch(/T00:00$/);
  expect(to).toMatch(/T00:00$/);

  // Download produces a CSV with the header and the recorded (disconnected) vote.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportDownload").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^scrum-poker-.+\.csv$/);

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");

  const lines = csv.trim().split(/\r\n/);
  expect(lines[0]).toBe("start,end,title,url,estimations");
  // No agenda note → the vote is a disconnected row carrying the host's estimate.
  expect(csv).toContain("Host: 5");
});
