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
    await expect(
      page.getByRole("img", { name: /^mealscout$/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^sign up$/i })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(page.getByRole("link", { name: /^log in$/i })).toBeVisible();
    await expect(page.getByText("Follow The Flavor")).toBeVisible();
    await expect(page.getByTestId("scout-map-container")).toHaveCount(0);
  });

  test("welcome signup opens role-aware signup paths", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/`, { waitUntil: "domcontentloaded" });
    await dismissBetaDialog(page);
    await page.getByRole("link", { name: /^sign up$/i }).click();

    await expect(page).toHaveURL(/\/signup(?:[?#].*)?$/);
    await expect(page.getByTestId("button-signup-flow-food_truck")).toBeVisible();
    await expect(page.getByTestId("button-signup-flow-private_chef")).toBeVisible();
    await page.getByTestId("button-signup-flow-private_chef").click();
    await expect(page).toHaveURL(/\/customer-signup\?role=business&businessType=private_chef/);
    await expect(page.getByTestId("input-business-name")).toBeVisible();
    await expect(page.getByTestId("button-business-type-private-chef")).toBeVisible();
  });

  test("event organizer choice creates an account before event setup", async ({ page }) => {
    await mockGuest(page);

    await page.goto(`${FRONTEND}/signup`, { waitUntil: "domcontentloaded" });
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

  test("/explore redirects to Scout", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/explore`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/scout(?:[?#].*)?$/);
    await expect(page.getByTestId("scout-map-container")).toBeVisible();
  });

  test("/explore-preview redirects to Scout instead of /explore", async ({ page }) => {
    await mockCustomer(page);
    await mockScoutFeeds(page);

    await page.goto(`${FRONTEND}/explore-preview`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/scout(?:[?#].*)?$/);
    await expect(page).not.toHaveURL(/\/explore(?:[?#].*)?$/);
    await expect(page.getByTestId("scout-map-container")).toBeVisible();
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
