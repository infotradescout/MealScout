import { test, expect } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";
const USER_COORDS = { lat: 30.4213, lng: -87.2169 };

async function mockGuest(page: any) {
  await page.route("**/api/auth/user", async (route: any) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });
}

async function mockCustomer(page: any) {
  await page.addInitScript((coords) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: any) => {
          success({
            coords: {
              latitude: coords.lat,
              longitude: coords.lng,
              accuracy: 20,
            },
          });
        },
      },
    });
  }, USER_COORDS);

  await page.route("**/api/auth/user", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "welcome-routing-user",
        email: "scout@example.test",
        firstName: "Scout",
        lastName: "Tester",
        userType: "customer",
        roles: [],
        emailVerified: true,
      }),
    });
  });
}

async function mockScoutFeeds(page: any) {
  await page.route("**/api/trucks/live?*", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ trucks: [] }),
    });
  });

  await page.route("**/api/deals/featured", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deals: [] }),
    });
  });

  await page.route("**/api/deals/nearby/**", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/events/public", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [] }),
    });
  });

  await page.route("**/api/restaurants/subscribed/**", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/parking-pass", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

async function dismissBetaDialog(page: any) {
  const betaButton = page.getByRole("button", { name: /got it/i });
  if (await betaButton.isVisible().catch(() => false)) {
    await betaButton.click();
  }
}

test.describe("welcome and Scout routing law", () => {
  test("logged-out root shows Welcome, not Scout map UI", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/`, { waitUntil: "domcontentloaded" });
    await dismissBetaDialog(page);

    await expect(page.getByTestId("welcome-landing")).toBeVisible();
    // The welcome page dropped its logo mark (commit 34454aa3, "Remove welcome
    // logo"); the document title is the remaining accessible brand signal.
    await expect(page).toHaveTitle(/mealscout/i);
    await expect(page.getByRole("link", { name: /^sign up$/i })).toHaveAttribute(
      "href",
      "/customer-signup",
    );
    await expect(page.getByRole("link", { name: /^log in$/i })).toBeVisible();
    await expect(page.getByText("Follow The Flavor")).toBeVisible();
    await expect(page.getByTestId("scout-map-container")).toHaveCount(0);
  });

  // Business flows now hand off to restaurant-signup's account-creation
  // gate, not directly to a business-details form (that form is behind
  // account creation) — the title says "account creation" rather than
  // "signup paths" so it doesn't overclaim reaching the business form.
  test("welcome signup opens role-aware paths into account creation", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/`, { waitUntil: "domcontentloaded" });
    await dismissBetaDialog(page);
    await page.getByRole("link", { name: /^sign up$/i }).click();

    // "/signup" was retired in commit 650582c1 ("Clean up legacy page
    // routes"); the role picker now lives directly on /customer-signup.
    await expect(page).toHaveURL(/\/customer-signup(?:[?#].*)?$/);
    await expect(page.getByTestId("button-signup-flow-food_truck")).toBeVisible();
    await expect(page.getByTestId("button-signup-flow-private_chef")).toBeVisible();
    await page.getByTestId("button-signup-flow-private_chef").click();
    // Business flows now hand off to the dedicated restaurant-signup form
    // instead of staying on customer-signup with role/businessType params.
    // That form gates its business-details fields (name, type) behind
    // account creation, so as a guest the reachable, role-aware signal is
    // the businessType carried in the URL plus the account-creation screen.
    await expect(page).toHaveURL(/\/restaurant-signup\?.*businessType=private_chef/);
    await expect(page.getByTestId("button-signup-toggle")).toBeVisible();
  });

  test("event organizer choice creates an account before event setup", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/customer-signup`, { waitUntil: "domcontentloaded" });
    await dismissBetaDialog(page);
    await page.getByTestId("button-signup-flow-event_organizer").click();

    await expect(page).toHaveURL(/\/customer-signup\?role=event_coordinator/);
    await expect(page.getByTestId("input-event-name")).toBeVisible();
    await expect(page.getByTestId("button-login-submit")).toHaveCount(0);
  });

  test("logged-in root redirects to Scout", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/scout(?:[?#].*)?$/);
    await expect(page.getByTestId("scout-map-container")).toBeVisible();
  });

  // "/explore" and "/explore-preview" redirect aliases were deliberately
  // retired in commit 650582c1 ("Clean up legacy page routes"). Neither path
  // is a registered route anymore, so they fall through to the public-profile
  // catch-all, which renders "Profile not found" with a link back to Scout.
  test("/explore is a retired route that offers a way back to Scout", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/explore`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/explore$/);
    // Assert the intentional not-found outcome via its stable testid
    // (public-profile.tsx), not the catch-all's incidental copy — and
    // confirm it did not silently render as Scout.
    await expect(page.getByTestId("public-profile-not-found")).toBeVisible();
    await expect(page.getByTestId("scout-map-container")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Scout" })).toHaveAttribute(
      "href",
      "/scout",
    );
  });

  test("/explore-preview is a retired route that offers a way back to Scout", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/explore-preview`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/explore-preview$/);
    await expect(page.getByTestId("public-profile-not-found")).toBeVisible();
    await expect(page.getByTestId("scout-map-container")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Scout" })).toHaveAttribute(
      "href",
      "/scout",
    );
  });

  test("Scout map stays embedded in Scout", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/scout(?:[?#].*)?$/);
    await expect(page.getByTestId("scout-map-container")).toBeVisible();
    await expect(page.locator('[data-testid="scout-map-container"]')).toHaveCount(1);
  });
});
