import { defineConfig } from "@playwright/test";

const frontendUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:5174";

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  retries: 0,
  webServer: process.env.FRONTEND_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1",
        url: frontendUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      },
  use: {
    baseURL: frontendUrl,
    headless: true,
    trace: "retain-on-failure",
  },
});
