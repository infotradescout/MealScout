import { beforeAll, describe, expect, it } from "vitest";
import type { PublicFeedMediaAssetRow, PublicFeedStoryRow } from "./storiesRoutes";

let helpers: typeof import("./storiesRoutes");

beforeAll(async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  helpers = await import("./storiesRoutes");
  process.env.NODE_ENV = previousNodeEnv;
});

describe("video story upload validation", () => {
  it("accepts normal user recommendation upload fields before Cloudinary metadata exists", () => {
    const result = helpers.videoStoryUploadBodySchema.safeParse({
      title: "Best tacos",
      description: "Worth the line.",
      duration: 30,
      restaurantId: "restaurant-1",
      replyToStoryId: null,
      hashtags: ["#tacos"],
      cuisine: "Mexican",
    });

    expect(result.success).toBe(true);
  });

  it("keeps the public recommendation duration cap at 30 seconds", () => {
    const result = helpers.videoStoryUploadBodySchema.safeParse({
      title: "Too long",
      duration: 31,
      restaurantId: "restaurant-1",
      replyToStoryId: null,
      hashtags: [],
      cuisine: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.duration?.[0]).toContain("30");
    }
  });
});

describe("public video feed safety", () => {
  const baseFeedStory = (
    overrides: Partial<PublicFeedStoryRow> = {},
  ): PublicFeedStoryRow => ({
    id: "story-1",
    videoUrl: "https://res.cloudinary.com/demo/video/upload/story.mp4",
    status: "ready",
    isApproved: true,
    deletedAt: null,
    expiresAt: new Date("2026-05-03T12:00:00Z"),
    ...overrides,
  });

  it("allows only ready, approved, unexpired stories in the main feed", () => {
    const now = new Date("2026-05-02T12:00:00Z");

    expect(helpers.isPublicFeedStoryRenderable(baseFeedStory(), now)).toBe(true);
    expect(
      helpers.isPublicFeedStoryRenderable(
        baseFeedStory({ status: "processing" }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedStoryRenderable(
        baseFeedStory({ isApproved: false }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedStoryRenderable(
        baseFeedStory({ deletedAt: new Date("2026-05-02T10:00:00Z") }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedStoryRenderable(
        baseFeedStory({ expiresAt: new Date("2026-05-01T12:00:00Z") }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedStoryRenderable(baseFeedStory({ videoUrl: "" }), now),
    ).toBe(false);
  });

  it("allows ready approved stories without an expiration date", () => {
    expect(
      helpers.isPublicFeedStoryRenderable(
        baseFeedStory({ expiresAt: null }),
        new Date("2026-05-02T12:00:00Z"),
      ),
    ).toBe(true);
  });

  const baseFeedMediaAsset = (
    overrides: Partial<PublicFeedMediaAssetRow> = {},
  ): PublicFeedMediaAssetRow => ({
    id: "media-1",
    ownerType: "restaurant",
    ownerId: "restaurant-1",
    mediaType: "video",
    title: "Owner intro",
    description: "A reusable profile video.",
    fileUrl: "https://res.cloudinary.com/demo/video/upload/profile.mp4",
    thumbnailUrl: "https://res.cloudinary.com/demo/image/upload/profile.jpg",
    durationSeconds: 28,
    status: "active",
    visibility: "public",
    isFeatured: true,
    deletedAt: null,
    createdAt: new Date("2026-05-02T12:00:00Z"),
    ...overrides,
  });

  it("allows only active public reusable profile media in the main feed", () => {
    expect(helpers.isPublicFeedMediaAssetRenderable(baseFeedMediaAsset())).toBe(true);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ status: "processing" }),
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ visibility: "private" }),
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ mediaType: "image" }),
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ deletedAt: new Date("2026-05-02T10:00:00Z") }),
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ ownerType: "user" }),
      ),
    ).toBe(false);
    expect(
      helpers.isPublicFeedMediaAssetRenderable(
        baseFeedMediaAsset({ fileUrl: "" }),
      ),
    ).toBe(false);
  });

  it("maps reusable profile media to a distinct feed item type", () => {
    const mediaVideo = helpers.toPublicFeedMediaAssetVideo(
      baseFeedMediaAsset({
        ownerType: "event",
        ownerId: "event-1",
        id: "media-event-1",
      }),
    );

    expect(mediaVideo).toMatchObject({
      __type: "profile_media",
      id: "media:media-event-1",
      mediaAssetId: "media-event-1",
      ownerType: "event",
      ownerId: "event-1",
      targetUrl: "/event/event-1",
      isFeatured: true,
    });
  });
});
