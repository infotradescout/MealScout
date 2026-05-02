import { beforeAll, describe, expect, it } from "vitest";
import type { PublicFeedStoryRow } from "./storiesRoutes";

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
});
