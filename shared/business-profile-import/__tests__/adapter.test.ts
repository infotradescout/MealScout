import { describe, it, expect } from "vitest";
import {
  MealScoutRestaurantAdapter,
  MealScoutHostAdapter,
  toBusinessPhotoInserts,
} from "../adapters/mealscout";
import type { UnifiedBusinessProfile, ImportedPhoto } from "../types";

function makeProfile(
  overrides: Partial<UnifiedBusinessProfile> = {},
): UnifiedBusinessProfile {
  return {
    source: {
      provider: "google",
      externalId: "ChIJ123",
      importedAt: new Date("2024-01-01"),
      rawPayload: {},
    },
    name: "Test Restaurant",
    description: "A great place to eat",
    category: "Food Truck",
    subcategories: ["Mexican", "Tacos"],
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    country: "US",
    latitude: 30.2672,
    longitude: -97.7431,
    phone: "+1-555-0123",
    email: "info@test.com",
    websiteUrl: "https://test.com",
    facebookUrl: "https://facebook.com/test",
    instagramUrl: null,
    twitterUrl: null,
    coverImageUrl: "https://img.com/cover.jpg",
    logoUrl: "https://img.com/logo.jpg",
    photos: [
      {
        url: "https://img.com/1.jpg",
        width: 800,
        height: 600,
        caption: "Front view",
        attribution: "Owner",
        source: "google",
      },
    ],
    hours: {
      monday: [{ open: "09:00", close: "17:00" }],
      tuesday: [{ open: "09:00", close: "17:00" }],
      wednesday: [{ open: "09:00", close: "17:00" }],
      thursday: [{ open: "09:00", close: "17:00" }],
      friday: [{ open: "09:00", close: "21:00" }],
      saturday: [{ open: "10:00", close: "21:00" }],
      sunday: [],
    },
    priceLevel: 2,
    menuUrl: "https://test.com/menu",
    orderUrl: "https://doordash.com/test",
    reservationUrl: null,
    rating: 4.5,
    reviewCount: 120,
    businessStatus: "operational",
    amenities: { wifi: true, outdoor_seating: true },
    ...overrides,
  };
}

describe("MealScoutRestaurantAdapter", () => {
  it("should map unified profile to restaurant update fields", () => {
    const adapter = new MealScoutRestaurantAdapter("overwrite_all");
    const profile = makeProfile();
    const updates = adapter.toEntityUpdate(profile);

    expect(updates.description).toBe("A great place to eat");
    expect(updates.websiteUrl).toBe("https://test.com");
    expect(updates.menuUrl).toBe("https://test.com/menu");
    expect(updates.orderUrl).toBe("https://doordash.com/test");
    // Google rating is stored as string in MealScout schema
    expect(updates.googleRating).toBe("4.5");
    expect(updates.googleReviewCount).toBe(120);
    expect(updates.googlePriceLevel).toBe(2);
    expect(updates.profileSource).toBe("google");
  });

  it("should only fill empty fields in fill_empty mode", () => {
    const adapter = new MealScoutRestaurantAdapter("fill_empty");
    const profile = makeProfile();
    const existing = {
      description: "Existing description",
      websiteUrl: null,
      menuUrl: null,
    };

    const updates = adapter.toEntityUpdate(profile, existing as any);

    // Should NOT overwrite existing description
    expect(updates.description).toBeUndefined();
    // Should fill empty websiteUrl
    expect(updates.websiteUrl).toBe("https://test.com");
  });

  it("should set profileSource to mixed when importing from a different provider", () => {
    const adapter = new MealScoutRestaurantAdapter("overwrite_all");

    // First import from google
    const googleProfile = makeProfile();
    const googleUpdates = adapter.toEntityUpdate(googleProfile);
    expect(googleUpdates.profileSource).toBe("google");

    // Second import from facebook into entity that already has google source
    // The adapter checks existing.profileSource (not source.provider)
    const fbProfile = makeProfile({
      source: { provider: "facebook", externalId: "fb123", importedAt: new Date(), rawPayload: {} },
    });
    // Pass existing entity with profileSource set to "google" — the adapter should detect
    // that the new provider ("facebook") differs from existing source ("google") and set "mixed"
    const existingEntity = { profileSource: "google" };
    const fbUpdates = adapter.toEntityUpdate(fbProfile, existingEntity as any);
    expect(fbUpdates.profileSource).toBe("mixed");
  });

  it("should set profileSource to same provider when re-importing from same source", () => {
    const adapter = new MealScoutRestaurantAdapter("overwrite_all");
    const profile = makeProfile();
    const updates = adapter.toEntityUpdate(profile, { profileSource: "google" } as any);
    expect(updates.profileSource).toBe("google");
  });
});

describe("MealScoutHostAdapter", () => {
  it("should map unified profile to host update fields", () => {
    const adapter = new MealScoutHostAdapter("overwrite_all");
    const profile = makeProfile();
    const updates = adapter.toEntityUpdate(profile);

    expect(updates.description).toBe("A great place to eat");
    expect(updates.businessWebsite).toBe("https://test.com");
    expect(updates.menuUrl).toBe("https://test.com/menu");
    // Google rating is stored as string in MealScout schema
    expect(updates.googleRating).toBe("4.5");
    expect(updates.profileSource).toBe("google");
  });
});

describe("toBusinessPhotoInserts", () => {
  it("should convert imported photos to database insert format", () => {
    const photos: ImportedPhoto[] = [
      { url: "https://img.com/1.jpg", width: 800, height: 600, caption: "Front", attribution: "Owner", source: "google" },
      { url: "https://img.com/2.jpg", width: 800, height: 600, caption: null, attribution: null, source: "google" },
    ];

    const inserts = toBusinessPhotoInserts(photos, {
      restaurantId: "rest-123",
      uploadedByUserId: "user-456",
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0].restaurantId).toBe("rest-123");
    expect(inserts[0].uploadedByUserId).toBe("user-456");
    expect(inserts[0].url).toBe("https://img.com/1.jpg");
    expect(inserts[0].source).toBe("import");
    expect(inserts[0].sourceProvider).toBe("google");
    expect(inserts[0].sortOrder).toBe(0);
    expect(inserts[1].sortOrder).toBe(1);
  });

  it("should respect maxPhotos limit", () => {
    const photos: ImportedPhoto[] = Array.from({ length: 30 }, (_, i) => ({
      url: `https://img.com/${i}.jpg`,
      width: 800,
      height: 600,
      caption: null,
      attribution: null,
      source: "google" as const,
    }));

    const inserts = toBusinessPhotoInserts(photos, {
      restaurantId: "rest-123",
      uploadedByUserId: "user-456",
      maxPhotos: 10,
    });

    expect(inserts).toHaveLength(10);
  });

  it("should set hostId when provided instead of restaurantId", () => {
    const photos: ImportedPhoto[] = [
      { url: "https://img.com/1.jpg", width: 800, height: 600, caption: null, attribution: null, source: "facebook" },
    ];

    const inserts = toBusinessPhotoInserts(photos, {
      hostId: "host-789",
      uploadedByUserId: "user-456",
    });

    expect(inserts[0].hostId).toBe("host-789");
    // restaurantId is null (not undefined) because the function always sets both
    expect(inserts[0].restaurantId).toBeNull();
    expect(inserts[0].sourceProvider).toBe("facebook");
  });

  it("should mark first photo as featured", () => {
    const photos: ImportedPhoto[] = [
      { url: "https://img.com/1.jpg", width: 800, height: 600, caption: null, attribution: null, source: "google" },
      { url: "https://img.com/2.jpg", width: 800, height: 600, caption: null, attribution: null, source: "google" },
    ];

    const inserts = toBusinessPhotoInserts(photos, {
      restaurantId: "rest-123",
      uploadedByUserId: "user-456",
    });

    expect(inserts[0].isFeatured).toBe(true);
    expect(inserts[1].isFeatured).toBe(false);
  });
});
