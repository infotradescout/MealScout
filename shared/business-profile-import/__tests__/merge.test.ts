import { describe, it, expect } from "vitest";
import { mergeProfiles } from "../core/merge";
import { DEFAULT_MERGE_PREFERENCE } from "../types";
import type { UnifiedBusinessProfile, MergePreference } from "../types";

function makeProfile(
  provider: string,
  overrides: Partial<UnifiedBusinessProfile> = {},
): UnifiedBusinessProfile {
  return {
    source: {
      provider: provider as any,
      externalId: `${provider}-123`,
      importedAt: new Date("2024-01-01"),
      rawPayload: {},
    },
    name: `${provider} Business`,
    description: null,
    category: null,
    subcategories: [],
    address: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    websiteUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    twitterUrl: null,
    coverImageUrl: null,
    logoUrl: null,
    photos: [],
    hours: null,
    priceLevel: null,
    menuUrl: null,
    orderUrl: null,
    reservationUrl: null,
    rating: null,
    reviewCount: null,
    businessStatus: "operational" as const,
    amenities: {},
    ...overrides,
  };
}

describe("mergeProfiles", () => {
  it("should return the single profile when only one is provided", () => {
    const google = makeProfile("google", {
      name: "Taco Truck",
      description: "Best tacos in town",
    });

    const result = mergeProfiles([google], DEFAULT_MERGE_PREFERENCE);
    expect(result.name).toBe("Taco Truck");
    expect(result.description).toBe("Best tacos in town");
  });

  it("should prefer google for name by default", () => {
    const google = makeProfile("google", { name: "Google Name" });
    const facebook = makeProfile("facebook", { name: "Facebook Name" });

    const result = mergeProfiles([google, facebook], DEFAULT_MERGE_PREFERENCE);
    expect(result.name).toBe("Google Name");
  });

  it("should fill empty fields from secondary provider", () => {
    const google = makeProfile("google", {
      name: "Taco Truck",
      description: "From Google",
      phone: null,
      websiteUrl: null,
    });
    const facebook = makeProfile("facebook", {
      name: "Taco Truck FB",
      description: null,
      phone: "+1-555-1234",
      websiteUrl: "https://tacotruck.com",
    });

    const result = mergeProfiles([google, facebook], DEFAULT_MERGE_PREFERENCE);
    expect(result.name).toBe("Taco Truck");
    expect(result.description).toBe("From Google");
    expect(result.phone).toBe("+1-555-1234");
    expect(result.websiteUrl).toBe("https://tacotruck.com");
  });

  it("should combine photos from multiple providers when media is combine", () => {
    const google = makeProfile("google", {
      photos: [
        { url: "g1.jpg", width: 800, height: 600, caption: null, attribution: "Google", source: "google" as any },
      ],
    });
    const facebook = makeProfile("facebook", {
      photos: [
        { url: "f1.jpg", width: 800, height: 600, caption: null, attribution: null, source: "facebook" as any },
      ],
    });

    const pref: MergePreference = {
      ...DEFAULT_MERGE_PREFERENCE,
      media: "combine",
    };

    const result = mergeProfiles([google, facebook], pref);
    expect(result.photos).toHaveLength(2);
    expect(result.photos[0].url).toBe("g1.jpg");
    expect(result.photos[1].url).toBe("f1.jpg");
  });

  it("should merge amenities from both providers (later overwrites earlier)", () => {
    const google = makeProfile("google", {
      amenities: { wifi: true, parking: true },
    });
    const facebook = makeProfile("facebook", {
      amenities: { outdoor_seating: true, parking: false },
    });

    // Object.assign merges in order — facebook's parking:false overwrites google's parking:true
    const result = mergeProfiles([google, facebook], DEFAULT_MERGE_PREFERENCE);
    expect(result.amenities.wifi).toBe(true);
    expect(result.amenities.parking).toBe(false); // facebook overwrites
    expect(result.amenities.outdoor_seating).toBe(true);
  });

  it("should throw on empty profiles array", () => {
    expect(() => mergeProfiles([], DEFAULT_MERGE_PREFERENCE)).toThrow(
      "mergeProfiles requires at least one profile",
    );
  });

  it("should deduplicate photos by URL when combining", () => {
    const google = makeProfile("google", {
      photos: [
        { url: "same.jpg", width: 800, height: 600, caption: null, attribution: null, source: "google" as any },
      ],
    });
    const facebook = makeProfile("facebook", {
      photos: [
        { url: "same.jpg", width: 800, height: 600, caption: null, attribution: null, source: "facebook" as any },
        { url: "unique.jpg", width: 800, height: 600, caption: null, attribution: null, source: "facebook" as any },
      ],
    });

    const result = mergeProfiles([google, facebook], {
      ...DEFAULT_MERGE_PREFERENCE,
      media: "combine",
    });
    expect(result.photos).toHaveLength(2);
    expect(result.photos.map((p) => p.url)).toEqual(["same.jpg", "unique.jpg"]);
  });
});
