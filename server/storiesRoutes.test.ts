import { beforeAll, describe, expect, it } from "vitest";

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
