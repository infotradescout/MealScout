import assert from "node:assert/strict";
import { webkit } from "playwright";

assert.equal(process.env.MEALSCOUT_ISOLATED_RECOVERY_PROOF, "1");
assert.match(process.env.FRONTEND_URL || "", /^http:\/\/127\.0\.0\.1:\d+$/);
const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.FRONTEND_URL}/__recovery/browser-preflight`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  assert.equal(await page.textContent("h1"), "MealScout isolated browser preflight");
  console.log("Actual WebKit launch and owned loopback HTTP navigation: PASS");
} finally {
  await browser.close();
}
