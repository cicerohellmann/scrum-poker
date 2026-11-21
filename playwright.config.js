const { defineConfig } = require("@playwright/test");

const port = process.env.PW_PORT || "3010";
// Optional: run an already-installed Chromium whose build differs from the one this Playwright wants.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `PORT=${port} ROOM_CREATION_LIMIT=500 MAX_ACTIVE_ROOMS=500 DB_PATH=./data/test-rooms.db npm start`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
