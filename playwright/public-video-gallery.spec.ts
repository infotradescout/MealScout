import { test, expect, type Page } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

async function mockRestaurantProfile(page: Page) {
  await page.route("**/api/auth/user", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        email: "diner@example.com",
        firstName: "Diner",
        lastName: "Tester",
        userType: "customer",
      }),
    });
  });

  await page.route("**/api/affiliate/tag", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.route("**/api/business-access/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    });
  });

  await page.route("**/api/hosts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/restaurants/restaurant-1/trust-stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profileAccuracyScore: 92 }),
    });
  });

  await page.route("**/api/restaurants/restaurant-1/recommendations/public?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/restaurants/restaurant-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "restaurant-1",
        name: "Codex Tacos",
        cuisineType: "Tacos",
        description: "A public profile used for video gallery regression coverage.",
        address: "123 Test Ave",
        city: "Pensacola",
        state: "FL",
        phoneNumber: "555-123-4567",
        website: "https://example.com",
        businessType: "restaurant",
        isFoodTruck: false,
        isVerified: true,
        isActive: true,
        latitude: "30.4213",
        longitude: "-87.2169",
      }),
    });
  });

  await page.route("**/api/deals/restaurant/restaurant-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.route("**/api/menus/restaurant-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ menus: [], orderingEnabled: false }),
    });
  });

  await page.route("**/api/media/restaurant/restaurant-1/videos", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        videos: [
          {
            id: "business-video-1",
            title: "Business reel",
            description: "Approved public owner media.",
            fileUrl: "https://res.cloudinary.com/demo/video/upload/business.mp4",
            thumbnailUrl: "https://res.cloudinary.com/demo/image/upload/business.jpg",
            durationSeconds: 42,
            isFeatured: true,
          },
        ],
        recommendationVideos: [
          {
            id: "story-1",
            title: "Try the birria",
            description: "A community video recommendation.",
            fileUrl: "https://res.cloudinary.com/demo/video/upload/story.mp4",
            thumbnailUrl: "https://res.cloudinary.com/demo/image/upload/story.jpg",
            durationSeconds: 14,
            authorName: "Casey Diner",
            likeCount: 4,
            commentCount: 2,
            shareCount: 1,
            storyUrl: "/video/story-1",
          },
        ],
      }),
    });
  });

  await page.route("**/api/stories/recommendation-status?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ alreadyRecommended: false }),
    });
  });
}

test.describe("Public profile video gallery", () => {
  test("renders business videos separately from user video recommendations", async ({ page }) => {
    await mockRestaurantProfile(page);

    await page.goto(`${FRONTEND}/restaurant/restaurant-1/codex-tacos`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("public-video-gallery")).toBeVisible();
    await expect(page.getByTestId("public-video-business-video-1")).toContainText("Business reel");
    await expect(page.getByText("Community video recommendations")).toBeVisible();
    await expect(page.getByTestId("public-recommendation-video-story-1")).toContainText("Try the birria");
    await expect(page.getByTestId("public-recommendation-video-story-1")).toContainText("Recommended by Casey Diner");
  });

  test("opens the restaurant video recommendation modal for signed-in diners", async ({ page }) => {
    await mockRestaurantProfile(page);

    await page.goto(`${FRONTEND}/restaurant/restaurant-1/codex-tacos`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: /recommend with video/i }).click();

    await expect(page.getByText("Share Your Food Story")).toBeVisible();
    await expect(page.locator('input[type="file"][accept="video/*"]')).toBeVisible();
  });
});
