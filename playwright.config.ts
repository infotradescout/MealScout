import { defineConfig, devices } from "@playwright/test";

const frontendUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:5174";

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
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
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Desktop Firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "Desktop Safari",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
