import { test, expect, type Page, type Route } from "@playwright/test";

const FRONTEND = process.env.FRONTEND_URL ?? "http://localhost:5174";

const RESTAURANT_ID = "11111111-1111-4111-8111-111111111111";
const TRUCK_ID = "22222222-2222-4222-8222-222222222222";
const HOST_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

type MediaOwnerType = "restaurant" | "food_truck" | "host" | "event";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockShellUser(
  page: Page,
  user = {
    id: "user-1",
    email: "diner@example.com",
    firstName: "Diner",
    lastName: "Tester",
    userType: "customer",
  },
) {
  await page.route("**/api/auth/user", (route) => fulfillJson(route, user));
  await page.route("**/api/affiliate/tag", (route) => fulfillJson(route, {}));
  await page.route("**/api/business-access/me", (route) => fulfillJson(route, null));
  await page.route("**/api/hosts", (route) => fulfillJson(route, []));
}

async function mockPublicVideos(
  page: Page,
  ownerType: MediaOwnerType,
  ownerId: string,
  options: {
    videoId: string;
    title: string;
    description?: string;
    recommendationVideos?: unknown[];
  },
) {
  await page.route(`**/api/media/${ownerType}/${ownerId}/videos`, (route) =>
    fulfillJson(route, {
      videos: [
        {
          id: options.videoId,
          title: options.title,
          description: options.description || "Approved public owner media.",
          fileUrl: `https://res.cloudinary.com/demo/video/upload/${options.videoId}.mp4`,
          thumbnailUrl: `https://res.cloudinary.com/demo/image/upload/${options.videoId}.jpg`,
          durationSeconds: 42,
          isFeatured: true,
        },
      ],
      recommendationVideos: options.recommendationVideos ?? [],
    }),
  );
}

async function mockRestaurantProfile(
  page: Page,
  options: {
    id?: string;
    name?: string;
    cuisineType?: string;
    isFoodTruck?: boolean;
    videoId?: string;
    videoTitle?: string;
    recommendationVideos?: unknown[];
  } = {},
) {
  await mockShellUser(page);

  const id = options.id || RESTAURANT_ID;
  const name = options.name || "Codex Tacos";
  const isFoodTruck = Boolean(options.isFoodTruck);
  const ownerType = isFoodTruck ? "food_truck" : "restaurant";

  await page.route(`**/api/restaurants/${id}/trust-stats`, (route) =>
    fulfillJson(route, { profileAccuracyScore: 92 }),
  );
  await page.route(`**/api/restaurants/${id}/recommendations/public?*`, (route) =>
    fulfillJson(route, []),
  );
  await page.route(`**/api/restaurants/${id}`, (route) =>
    fulfillJson(route, {
      id,
      name,
      cuisineType: options.cuisineType || "Tacos",
      description: "A public profile used for video gallery regression coverage.",
      address: "123 Test Ave",
      city: "Pensacola",
      state: "FL",
      phone: "555-123-4567",
      website: "https://example.com",
      businessType: isFoodTruck ? "food_truck" : "restaurant",
      isFoodTruck,
      isVerified: true,
      isActive: true,
      latitude: "30.4213",
      longitude: "-87.2169",
    }),
  );
  await page.route(`**/api/deals/restaurant/${id}`, (route) => fulfillJson(route, []));
  await page.route(`**/api/menus/${id}`, (route) =>
    fulfillJson(route, { menus: [], orderingEnabled: false }),
  );
  await page.route(`**/api/bookings/truck/${id}/schedule`, (route) =>
    fulfillJson(route, { schedule: [] }),
  );
  await page.route("**/api/stories/recommendation-status?*", (route) =>
    fulfillJson(route, { alreadyRecommended: false }),
  );

  await mockPublicVideos(page, ownerType, id, {
    videoId: options.videoId || "business-video-1",
    title: options.videoTitle || "Business reel",
    recommendationVideos: options.recommendationVideos,
  });
}

async function mockHostProfile(page: Page) {
  await mockShellUser(page);
  await page.route(`**/api/public/profiles/host/${HOST_ID}`, (route) =>
    fulfillJson(route, {
      entity: "host",
      id: HOST_ID,
      title: "Codex Yard",
      subtitle: "Parking pass host",
      description: "A host profile used for video gallery coverage.",
      address: "55 Yard Way",
      city: "Pensacola",
      state: "FL",
      profilePath: `/location/codex-yard--${HOST_ID}`,
      canonicalUrl: `${FRONTEND}/location/codex-yard--${HOST_ID}`,
    }),
  );
  await page.route("**/api/parking-pass", (route) => fulfillJson(route, []));
  await mockPublicVideos(page, "host", HOST_ID, {
    videoId: "host-video-1",
    title: "Host walkthrough",
  });
}

async function mockEventProfile(page: Page) {
  await mockShellUser(page);
  await page.route(`**/api/public/events/${EVENT_ID}`, (route) =>
    fulfillJson(route, {
      id: EVENT_ID,
      title: "Codex Night Market",
      description: "An event profile used for video gallery coverage.",
      date: "2026-06-01",
      startTime: "18:00",
      endTime: "21:00",
      status: "open",
      requiresPayment: false,
      host: {
        id: HOST_ID,
        name: "Codex Yard",
        address: "55 Yard Way",
        city: "Pensacola",
        state: "FL",
        path: `/location/codex-yard--${HOST_ID}`,
      },
      truck: null,
      canonicalUrl: `${FRONTEND}/event/codex-night-market--${EVENT_ID}`,
      ended: false,
    }),
  );
  await mockPublicVideos(page, "event", EVENT_ID, {
    videoId: "event-video-1",
    title: "Event promo",
  });
}

test.describe("Public profile video gallery", () => {
  test("renders restaurant business videos separately from user video recommendations", async ({ page }) => {
    await mockRestaurantProfile(page, {
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
    });

    await page.goto(`${FRONTEND}/restaurant/${RESTAURANT_ID}/codex-tacos`, {
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

    await page.goto(`${FRONTEND}/restaurant/${RESTAURANT_ID}/codex-tacos`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: /recommend with video/i }).click();

    await expect(page.getByText("Share Your Food Story")).toBeVisible();
    await expect(page.locator('input[type="file"][accept="video/*"]')).toBeVisible();
  });

  test("renders food truck profile videos and user recommendations", async ({ page }) => {
    await mockRestaurantProfile(page, {
      id: TRUCK_ID,
      name: "Codex Wheels",
      cuisineType: "Street food",
      isFoodTruck: true,
      videoId: "truck-video-1",
      videoTitle: "Truck reel",
      recommendationVideos: [
        {
          id: "truck-story-1",
          title: "Loaded fries stop",
          fileUrl: "https://res.cloudinary.com/demo/video/upload/truck-story.mp4",
          durationSeconds: 18,
          authorName: "Riley Scout",
          likeCount: 7,
          commentCount: 1,
          shareCount: 0,
          storyUrl: "/video/truck-story-1",
        },
      ],
    });

    await page.goto(`${FRONTEND}/truck/codex-wheels--${TRUCK_ID}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("public-video-gallery")).toBeVisible();
    await expect(page.getByText("Truck Videos")).toBeVisible();
    await expect(page.getByTestId("public-video-truck-video-1")).toContainText("Truck reel");
    await expect(page.getByTestId("public-recommendation-video-truck-story-1")).toContainText("Loaded fries stop");
  });

  test("renders host public videos on location pages", async ({ page }) => {
    await mockHostProfile(page);

    await page.goto(`${FRONTEND}/location/codex-yard--${HOST_ID}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("public-video-gallery")).toBeVisible();
    await expect(page.getByText("Host Videos")).toBeVisible();
    await expect(page.getByTestId("public-video-host-video-1")).toContainText("Host walkthrough");
    await expect(page.getByText("Community video recommendations")).toHaveCount(0);
  });

  test("renders event public videos on event pages", async ({ page }) => {
    await mockEventProfile(page);

    await page.goto(`${FRONTEND}/event/codex-night-market--${EVENT_ID}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("public-video-gallery")).toBeVisible();
    await expect(page.getByText("Event Videos")).toBeVisible();
    await expect(page.getByTestId("public-video-event-video-1")).toContainText("Event promo");
    await expect(page.getByText("Community video recommendations")).toHaveCount(0);
  });
});

test.describe("Admin video media workflows", () => {
  test("can upload and moderate reusable event videos from the admin page", async ({ page }) => {
    const mediaMutations: Array<{ method: string; body: unknown }> = [];
    let uploadPayload = "";

    await mockShellUser(page, {
      id: "admin-1",
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "Tester",
      userType: "admin",
    });
    await page.route("**/api/admin/media/pending", (route) =>
      fulfillJson(route, { videos: [] }),
    );
    await page.route(`**/api/media/manage/event/${EVENT_ID}/videos`, (route) =>
      fulfillJson(route, {
        videos: [
          {
            id: "event-video-1",
            ownerType: "event",
            ownerId: EVENT_ID,
            mediaType: "video",
            title: "Event promo",
            description: "Ready for admin moderation.",
            fileUrl: "https://res.cloudinary.com/demo/video/upload/event-video-1.mp4",
            thumbnailUrl: null,
            durationSeconds: 42,
            status: "processing",
            visibility: "public",
            isFeatured: false,
          },
        ],
      }),
    );
    await page.route("**/api/media/videos", async (route) => {
      uploadPayload = route.request().postData() || "";
      await fulfillJson(route, {
        video: {
          id: "event-video-2",
          ownerType: "event",
          ownerId: EVENT_ID,
          mediaType: "video",
          title: "Fresh event upload",
          fileUrl: "https://res.cloudinary.com/demo/video/upload/event-video-2.mp4",
          status: "active",
          visibility: "public",
          isFeatured: true,
        },
      }, 201);
    });
    await page.route("**/api/media/event-video-1", async (route) => {
      const request = route.request();
      mediaMutations.push({
        method: request.method(),
        body: request.method() === "DELETE" ? null : request.postDataJSON(),
      });
      await fulfillJson(route, {
        video: {
          id: "event-video-1",
          ownerType: "event",
          ownerId: EVENT_ID,
          mediaType: "video",
          title: "Event promo",
          fileUrl: "https://res.cloudinary.com/demo/video/upload/event-video-1.mp4",
          status: "active",
          visibility: "public",
          isFeatured: false,
        },
      });
    });

    await page.goto(`${FRONTEND}/admin/media/videos?ownerType=event&ownerId=${EVENT_ID}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("media-video-manager")).toBeVisible();
    await expect(page.getByTestId("input-media-video-file")).toHaveAttribute(
      "accept",
      "video/mp4,video/quicktime,video/webm",
    );
    await expect(page.getByTestId("select-media-video-status")).toBeVisible();

    await page.getByTestId("input-media-video-file").setInputFiles({
      name: "event-upload.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("fake mp4 payload"),
    });
    await page.getByTestId("input-media-video-title").fill("Fresh event upload");
    await page.getByTestId("button-upload-media-video").click();

    await expect.poll(() => uploadPayload).toContain(`name="ownerType"\r\n\r\nevent`);
    expect(uploadPayload).toContain(`name="ownerId"\r\n\r\n${EVENT_ID}`);

    const row = page.getByTestId("media-video-row-event-video-1");
    await expect(row).toContainText("Event promo");
    await row.getByRole("button", { name: /^approve$/i }).click();
    await row.getByRole("button", { name: /^reject$/i }).click();
    await row.getByRole("button", { name: /^feature$/i }).click();
    await row.getByRole("button", { name: /^delete$/i }).click();

    await expect.poll(() => mediaMutations.length).toBe(4);
    expect(mediaMutations).toEqual([
      { method: "PATCH", body: { status: "active" } },
      {
        method: "PATCH",
        body: {
          status: "rejected",
          rejectionReason: "Rejected by admin review.",
        },
      },
      { method: "PATCH", body: { isFeatured: true } },
      { method: "DELETE", body: null },
    ]);
  });
});
