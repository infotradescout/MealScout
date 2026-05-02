import { expect, test, type Page, type Route } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockVideoFeedShell(page: Page) {
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, {
      id: "diner-1",
      email: "diner@example.com",
      firstName: "Diner",
      lastName: "Tester",
      userType: "customer",
    }),
  );
  await page.route("**/api/following/restaurants", (route) =>
    fulfillJson(route, []),
  );
  await page.route("**/api/affiliate/tag", (route) => fulfillJson(route, {}));
  await page.route("**/api/business-access/me", (route) =>
    fulfillJson(route, null),
  );
  await page.route("**/api/hosts", (route) => fulfillJson(route, []));
}

test.describe("Video feed", () => {
  test("renders reusable profile media separately from recommendations and ads", async ({
    page,
  }) => {
    await mockVideoFeedShell(page);
    await page.route("**/api/stories/feed?*", (route) =>
      fulfillJson(route, {
        stories: [
          {
            __type: "profile_media",
            id: "media:event-video-1",
            mediaAssetId: "event-video-1",
            ownerType: "event",
            ownerId: "event-1",
            title: "Night Market preview",
            description: "A reusable public event video.",
            mediaUrl:
              "https://res.cloudinary.com/demo/video/upload/event-video-1.mp4",
            thumbnailUrl:
              "https://res.cloudinary.com/demo/image/upload/event-video-1.jpg",
            durationSeconds: 32,
            targetUrl: "/event/event-1",
            isFeatured: true,
          },
        ],
        hasMore: false,
        page: 0,
      }),
    );

    await page.goto(`${FRONTEND}/video`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Profile video")).toBeVisible();
    await expect(page.getByText("Night Market preview")).toBeVisible();
    await expect(page.getByText("A reusable public event video.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View event" })).toHaveAttribute(
      "href",
      "/event/event-1",
    );
    await expect(page.getByText("Recommendation")).toHaveCount(0);
    await expect(page.getByText("Sponsored")).toHaveCount(0);
  });
});
