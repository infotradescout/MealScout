import { assertPublicResponseSafe } from "../server/publicProfiles/assertPublicResponseSafe";

function expectThrows(label: string, fn: () => void, expectedPath: string) {
  try {
    fn();
    throw new Error(`[${label}] expected throw but passed`);
  } catch (error) {
    const message = String((error as Error)?.message || "");
    if (!message.includes(expectedPath)) {
      throw new Error(
        `[${label}] expected error path "${expectedPath}" but got "${message}"`,
      );
    }
  }
}

function expectPass(label: string, fn: () => void) {
  try {
    fn();
  } catch (error) {
    throw new Error(
      `[${label}] expected pass but threw "${String((error as Error)?.message || error)}"`,
    );
  }
}

expectThrows(
  "nested forbidden key fails",
  () => assertPublicResponseSafe({ profile: { ownerId: "abc" } }),
  'profile.ownerId',
);

expectThrows(
  "forbidden key inside array fails",
  () =>
    assertPublicResponseSafe({
      trucksNow: [{ name: "Truck A", parkingPassId: "pp_1" }],
    }),
  "trucksNow[0].parkingPassId",
);

expectPass("safe shaped restaurant profile passes", () =>
  assertPublicResponseSafe({
    id: "r1",
    profileType: "restaurant",
    displayName: "Riverbend Cafe",
    slug: "riverbend-cafe",
    city: "Pensacola",
    state: "FL",
    cta: [{ label: "View details", href: "/p/restaurant/r1/riverbend-cafe", type: "internal", safe: true }],
    seo: {
      canonicalUrl: "https://www.mealscout.us/p/restaurant/r1/riverbend-cafe",
      seoTitle: "Riverbend Cafe on MealScout",
      seoDescription: "Local profile",
      ogImageUrl: "https://images.mealscout.us/riverbend.jpg",
    },
  }),
);

expectPass("safe shaped location profile passes", () =>
  assertPublicResponseSafe({
    id: "h1",
    profileType: "location",
    displayName: "Downtown Food Park",
    slug: "downtown-food-park",
    city: "Pensacola",
    state: "FL",
    trucksNow: [
      {
        truckId: "t1",
        truckName: "Taco Bandito",
        cta: [{ label: "View", href: "/p/truck/t1/taco-bandito", type: "internal", safe: true }],
      },
    ],
  }),
);

expectThrows(
  "public location discovery payload cannot include parkingPass or hostInventory",
  () =>
    assertPublicResponseSafe({
      hostId: "h1",
      trucksNow: [],
      hostInventory: { slots: 10 },
      parkingPass: { id: "pp_9" },
    }),
  "hostInventory",
);

expectPass("public resolver payload passes", () =>
  assertPublicResponseSafe({
    exists: true,
    entityType: "truck",
    id: "t1",
    slug: "taco-bandito",
    canonicalUrl: "https://www.mealscout.us/p/truck/t1/taco-bandito",
  }),
);

console.log("test:public-response-safety passed");
