import { beforeAll, describe, expect, it } from "vitest";
import type { PublicUserVideoRecommendationRow } from "./mediaRoutes";

let helpers: typeof import("./mediaRoutes");

beforeAll(async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  helpers = await import("./mediaRoutes");
  process.env.NODE_ENV = previousNodeEnv;
});

const baseRecommendationRow = (
  overrides: Partial<PublicUserVideoRecommendationRow> = {},
): PublicUserVideoRecommendationRow => ({
  id: "story-1",
  title: "Best tacos",
  description: "Worth the line.",
  fileUrl: "https://res.cloudinary.com/demo/video/upload/story.mp4",
  thumbnailUrl: "https://res.cloudinary.com/demo/image/upload/story.jpg",
  durationSeconds: 14,
  status: "ready",
  isApproved: true,
  deletedAt: null,
  expiresAt: new Date("2026-05-03T12:00:00Z"),
  createdAt: new Date("2026-05-02T12:00:00Z"),
  userId: "user-1",
  authorName: "Casey Diner",
  likeCount: 3,
  commentCount: 2,
  shareCount: 1,
  viewCount: 20,
  ...overrides,
});

describe("public media video helpers", () => {
  it("allows ready, approved, unexpired user video recommendations", () => {
    expect(
      helpers.isPublicUserVideoRecommendationRenderable(
        baseRecommendationRow(),
        new Date("2026-05-02T12:00:00Z"),
      ),
    ).toBe(true);
  });

  it("blocks user video recommendations that are not public-safe", () => {
    const now = new Date("2026-05-02T12:00:00Z");

    expect(
      helpers.isPublicUserVideoRecommendationRenderable(
        baseRecommendationRow({ status: "processing" }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicUserVideoRecommendationRenderable(
        baseRecommendationRow({ isApproved: false }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicUserVideoRecommendationRenderable(
        baseRecommendationRow({ deletedAt: new Date("2026-05-02T10:00:00Z") }),
        now,
      ),
    ).toBe(false);
    expect(
      helpers.isPublicUserVideoRecommendationRenderable(
        baseRecommendationRow({ expiresAt: new Date("2026-05-01T12:00:00Z") }),
        now,
      ),
    ).toBe(false);
  });

  it("maps user video recommendations without claiming business ownership", () => {
    const mapped = helpers.toPublicUserVideoRecommendation(
      baseRecommendationRow({ authorName: "" }),
    );

    expect(mapped.source).toBe("user_recommendation");
    expect(mapped.fileUrl).toContain("story.mp4");
    expect(mapped.storyUrl).toBe("/video/story-1");
    expect(mapped.authorName).toBe("MealScout diner");
  });
});
