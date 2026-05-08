import { test, expect } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

const USER_COORDS = { lat: 30.4213, lng: -87.2169 };

async function mockScoutUser(page: any) {
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
        id: "scout-smoke-user",
        email: "info.mealscout@gmail.com",
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
      body: JSON.stringify([
        {
          id: "rest-menu",
          businessName: "Menu Smokehouse",
          cuisineType: "BBQ",
          city: "Pensacola",
          state: "FL",
          latitude: USER_COORDS.lat + 0.002,
          longitude: USER_COORDS.lng + 0.002,
          activeDealsCount: 1,
        },
      ]),
    });
  });

  await page.route("**/api/menus/rest-menu", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        menus: [
          {
            id: "menu-1",
            isActive: true,
            categories: [
              {
                id: "cat-1",
                name: "Favorites",
                items: [
                  {
                    id: "item-1",
                    name: "Brisket Tacos",
                    priceCents: 1299,
                    isAvailable: true,
                  },
                ],
              },
            ],
            uncategorizedItems: [],
          },
        ],
        orderingEnabled: true,
      }),
    });
  });

  await page.route("**/api/parking-pass", async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "deleted-host",
          status: "deleted",
          seriesStatus: "published",
          date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          startTime: "09:00",
          endTime: "15:00",
          hostName: "Deleted Test Host",
          businessName: "Deleted Test Host",
          spotCount: 2,
          bookedSpots: 0,
          availableSpotNumbers: [1, 2],
          latitude: USER_COORDS.lat + 0.001,
          longitude: USER_COORDS.lng + 0.001,
          host: {
            businessName: "Deleted Test Host",
            city: "Pensacola",
            state: "FL",
          },
        },
        {
          id: "active-host",
          status: "open",
          seriesStatus: "published",
          date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          startTime: "09:00",
          endTime: "15:00",
          hostName: "Active Test Host",
          businessName: "Active Test Host",
          spotCount: 2,
          bookedSpots: 0,
          availableSpotNumbers: [1, 2],
          latitude: USER_COORDS.lat + 0.001,
          longitude: USER_COORDS.lng + 0.001,
          host: {
            businessName: "Active Test Host",
            city: "Pensacola",
            state: "FL",
          },
        },
      ]),
    });
  });
}

test.describe("Scout local dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await mockScoutUser(page);
    await mockScoutFeeds(page);
  });

  test("deleted parking pass host does not appear on Scout", async ({ page }) => {
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Deleted Test Host")).toHaveCount(0);
  });

  test("active parking pass host appears on Scout", async ({ page }) => {
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Active Test Host")).toBeVisible();
  });

  test("Scout map container renders", async ({ page }) => {
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("scout-map-container")).toBeVisible();
  });

  test("restaurant with menu items shows menu preview and micro-actions", async ({ page }) => {
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("scout-menu-preview")).toBeVisible();
    await expect(page.getByText("Brisket Tacos")).toBeVisible();
    await expect(page.getByText("Menu").first()).toBeVisible();
    await expect(page.getByText("Save").first()).toBeVisible();
  });

  test("regular customer navigation does not link to standalone map", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    await expect(page.locator('a[href="/map"], a[href$="/map"]')).toHaveCount(0);
  });

  test("Scout map expand stays on Scout", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(`${FRONTEND}/scout`, { waitUntil: "domcontentloaded" });

    const mapContainer = page.getByTestId("scout-map-container");
    await expect(mapContainer).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /expand map to fullscreen/i })
      .click({ force: true });

    await expect(page).toHaveURL(/\/scout(?:[?#].*)?$/);
    await expect(page.getByRole("button", { name: /collapse/i })).toBeVisible();
  });

  test("Parking Pass route owns the parking map experience", async ({ page }) => {
    await page.goto(`${FRONTEND}/parking-pass`, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/parking-pass(?:[?#].*)?$/);
    await expect(page.locator('a[href="/map"], a[href$="/map"]')).toHaveCount(0);
  });
});
