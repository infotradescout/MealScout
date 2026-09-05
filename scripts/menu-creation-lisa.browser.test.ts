import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { chromium, expect, type Route } from "@playwright/test";

// Rendered client proof only. All API responses are synthetic, all non-local
// requests are blocked, and no application server or database is started.
const root = resolve(import.meta.dirname, "..");
const build = resolve(root, "client/dist");
assert.ok(existsSync(resolve(build, "index.html")), "Build the client before this check");
const output = resolve(root, "artifacts/menu-lisa-browser");
mkdirSync(output, { recursive: true });
const app = express();
app.use(express.static(build));
app.get("*", (_req, res) => res.sendFile(resolve(build, "index.html")));
const server = createServer(app);
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
server.unref(); // A failed browser launch must not leave a listening test process.
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const restaurantId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: "22222222-2222-4222-8222-222222222222", userType: "restaurant_owner",
  email: "owner@example.test", firstName: "Fixture", lastName: "Owner",
  emailVerified: true, profileComplete: true, accountOnboardingComplete: true,
  businessOnboardingRequired: false, nextRequiredStep: "complete", restaurantId,
};
const business = { id: restaurantId, ownerId: user.id, name: "Fixture Kitchen", businessType: "restaurant", city: "Pensacola", state: "FL" };
const permissions = { manageDeals: true, manageParkingPass: true, viewAnalytics: true, manageProfile: true };
const records = new Map<string, { id: string; restaurantId: string; name: string; serviceType: string; isActive: boolean }>();
const submissions: Array<{ id: string; name: string }> = [];
const uncertain = "Menu creation could not be confirmed. Retry this same request; it will not create a second menu.";
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

try {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== baseUrl) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth/user") return json(route, user);
    if (url.pathname === "/api/restaurants/my-restaurants") return json(route, [business]);
    if (url.pathname === "/api/business-access/me") return json(route, { hasAnyAccess: true, permissions, restaurants: [{ id: restaurantId, isOwner: true, permissions }] });
    if (url.pathname === "/api/notifications/unread-count") return json(route, { count: 0 });
    if (url.pathname === `/api/restaurants/${restaurantId}/ordering-review`) {
      // The marketplace integration also renders its existing review workspace.
      // Supply its real response shape, not the generic optional-endpoint fallback.
      const readiness = { orderingEnabled: false, blockingReasons: ["Synthetic fixture: ordering review not configured"], checks: [] };
      return json(route, {
        restaurant: { id: restaurantId, orderingApprovedAt: null, orderingAuthorityVersion: 1, pickupAcknowledgementMinutes: 10 },
        request: null, currentReadiness: readiness, reviewReadiness: readiness,
      });
    }
    if (url.pathname === "/api/owner/menus/create") {
      const input = route.request().postDataJSON();
      const id = route.request().headers()["idempotency-key"];
      assert.match(id, /^[0-9a-f-]{36}$/i);
      submissions.push({ id, name: input.name });
      if (input.name === "Version handoff C" && submissions.filter((item) => item.id === id).length === 1) {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Old app shell</title>" });
      }
      const prior = records.get(id);
      if (!prior) {
        // Simulate a committed result whose completion receipt was lost.
        records.set(id, { ...input, id, isActive: true });
        return json(route, { message: uncertain }, 503);
      }
      assert.equal(prior.name, input.name);
      return json(route, { menu: prior, lisaRecord: { id, status: "recorded" }, replayed: true }, 201);
    }
    if (url.pathname === `/api/owner/menus/${restaurantId}`) return json(route, { menus: [...records.values()] });
    if (url.pathname.endsWith("/details")) {
      const menu = records.get(url.pathname.split("/").at(-2)!);
      return json(route, { menu: { ...menu, categories: [], uncategorizedItems: [] } });
    }
    if (url.pathname.endsWith("/ordering-readiness")) return json(route, { orderingEnabled: false, blockingReasons: [], checks: [] });
    return json(route, {});
  });
  await page.goto(`${baseUrl}/menu-builder?restaurantId=${restaurantId}`);
  await expect(page.getByRole("heading", { name: "Menus and items" })).toBeVisible();
  await page.getByRole("button", { name: "New menu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = page.getByLabel("Menu name", { exact: true });
  const submit = dialog.getByRole("button", { name: "Create menu", exact: true });
  await name.fill("Original A");
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText(uncertain);
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue("Original A");
  await page.screenshot({ path: resolve(output, "desktop-unconfirmed.png"), fullPage: true });
  await name.fill("Edited B");
  await submit.click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(submit).toBeEnabled();
  await name.fill("Original A");
  await submit.click();
  await expect(dialog).not.toBeVisible();
  assert.equal(submissions[0].id, submissions[2].id);
  assert.notEqual(submissions[0].id, submissions[1].id);
  assert.equal(records.size, 2);
  await expect(page.getByRole("button", { name: /Original A All day/ })).toBeVisible();
  await page.screenshot({ path: resolve(output, "desktop-recovered.png"), fullPage: true });

  // The unfinished B identity survives reload and a narrow-screen interaction.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "New menu", exact: true }).click();
  await name.fill("Edited B");
  await submit.click();
  await expect(dialog).not.toBeVisible();
  assert.equal(submissions[1].id, submissions[3].id);
  assert.equal(records.size, 2);
  const pendingKeys = await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("mealscout.menu-creation:")));
  assert.deepEqual(pendingKeys, []);
  await expect(page.getByRole("heading", { name: "Menus and items" })).toBeVisible();
  await page.screenshot({ path: resolve(output, "mobile-recovered.png"), fullPage: true });

  await page.getByRole("button", { name: "New menu", exact: true }).click();
  await name.fill("Version handoff C");
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText("Menu creation could not be confirmed. Retry this same request.");
  assert.equal(records.size, 2);
  await submit.click();
  await expect(dialog.getByRole("alert")).toHaveText(uncertain);
  await submit.click();
  await expect(dialog).not.toBeVisible();
  assert.equal(new Set(submissions.slice(4).map((item) => item.id)).size, 1);
  assert.equal(records.size, 3);

  await page.getByRole("button", { name: "New menu", exact: true }).click();
  await name.fill("Storage unavailable D");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreMenuStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("mealscout.menu-creation:")) throw new Error("fixture storage unavailable");
      original.call(this, key, value);
    };
  });
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("Nothing was submitted.");
  assert.equal(submissions.length, 7);
  await page.evaluate(() => (window as any).__restoreMenuStorage());
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ status: "PASS", proof: "built-client-with-synthetic-api", desktop: "A-B-A retry", mobile: "reload-and-retry-B", malformedReceipt: "rejected-and-recovered", unavailableStorage: "no-submission", requests: submissions.length, distinctRecords: records.size, pageErrors, screenshots: output }));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", pageErrors }));
  await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
}
