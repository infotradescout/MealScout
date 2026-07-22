import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { BusinessPromotionDependencies } from "../server/services/businessOnboardingPromotion";

process.env.NODE_ENV = "development";

const {
  promoteBusinessSetupToProfile,
  resolvePromotionBusinessType,
} = await import("../server/services/businessOnboardingPromotion");
const { toPublicTruckProfile } = await import(
  "../server/publicProfiles/toPublicTruckProfile"
);

const baseInput = {
  businessName: "Second Business",
  businessType: "food_truck",
  address: "100 Admin Lane",
  city: "Pensacola",
  state: "FL",
  cuisineType: "Various",
  menuItems: [{ name: "Owner-approved special", priceCents: 1200 }],
};

function buildDependencies(options?: {
  target?: Record<string, unknown> | null;
}) {
  const calls = {
    created: [] as Array<Record<string, unknown>>,
    hydrated: [] as Array<{ restaurantId: string; rawMenuItems: unknown }>,
    targetReads: [] as string[],
  };
  const restaurantsByAttemptId = new Map<string, Record<string, unknown>>();
  const dependencies: BusinessPromotionDependencies = {
    getUser: async (userId) => ({
      id: userId,
      userType: "restaurant_owner",
      accountSettings: {},
    }),
    getRestaurant: async (restaurantId) => {
      calls.targetReads.push(restaurantId);
      return options?.target ?? null;
    },
    createRestaurantWithMenu: async (restaurant, rawMenuItems) => {
      const requestedId = String(restaurant.id || "").trim();
      const existing = requestedId
        ? restaurantsByAttemptId.get(requestedId)
        : null;
      if (existing) {
        if (existing.ownerId !== restaurant.ownerId) {
          throw new Error("Onboarding attempt belongs to a different owner");
        }
        return { restaurant: existing, insertedCount: 0, created: false };
      }
      calls.created.push(restaurant);
      const created = {
        id: requestedId || `created-${calls.created.length}`,
        ...restaurant,
      };
      if (requestedId) restaurantsByAttemptId.set(requestedId, created);
      calls.hydrated.push({ restaurantId: created.id, rawMenuItems });
      return {
        restaurant: created,
        insertedCount: Array.isArray(rawMenuItems) ? rawMenuItems.length : 0,
        created: true,
      };
    },
    hydrateMenuItems: async (restaurantId, rawMenuItems) => {
      calls.hydrated.push({ restaurantId, rawMenuItems });
      return { insertedCount: Array.isArray(rawMenuItems) ? rawMenuItems.length : 0 };
    },
    getAccessContext: async () => ({ businesses: [] }),
  };
  return { calls, dependencies };
}

{
  const attemptId = "7be03246-5014-4fa4-a776-7ca68877d655";
  const { calls, dependencies } = buildDependencies();
  const first = await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, onboardingAttemptId: attemptId },
    dependencies,
  );
  const recovered = await promoteBusinessSetupToProfile(
    "owner-1",
    {
      ...baseInput,
      onboardingAttemptId: attemptId,
      businessName: "Edited after a lost response",
    },
    dependencies,
  );
  assert.equal(first.created, true);
  assert.equal(recovered.created, false);
  assert.equal(first.restaurant.id, attemptId);
  assert.equal(recovered.restaurant.name, "Second Business");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.hydrated.length, 1);
}

{
  const attemptId = "a47279a2-a7d5-4b68-a188-dbed01c55ec7";
  const { calls, dependencies } = buildDependencies();
  await assert.rejects(
    promoteBusinessSetupToProfile(
      "owner-1",
      { ...baseInput, onboardingAttemptId: attemptId, city: "" },
      dependencies,
    ),
    /Missing required business setup fields/,
  );
  const created = await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, onboardingAttemptId: attemptId },
    dependencies,
  );
  assert.equal(created.created, true);
  assert.equal(calls.created.length, 1);
}

{
  const attemptId = "3bc27e17-304e-4716-97ef-5d586a59dd1e";
  const { dependencies } = buildDependencies();
  await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, onboardingAttemptId: attemptId },
    dependencies,
  );
  await assert.rejects(
    promoteBusinessSetupToProfile(
      "owner-2",
      { ...baseInput, onboardingAttemptId: attemptId },
      dependencies,
    ),
    /different owner/,
  );
}

{
  const { calls, dependencies } = buildDependencies({
    target: {
      id: "business-a",
      ownerId: "owner-1",
      businessType: "restaurant",
      isFoodTruck: false,
    },
  });
  const result = await promoteBusinessSetupToProfile(
    "owner-1",
    baseInput,
    dependencies,
  );
  assert.equal(result.created, true);
  assert.equal(result.restaurant.id, "created-1");
  assert.deepEqual(calls.targetReads, []);
  assert.equal(
    calls.hydrated[0]?.restaurantId,
    "created-1",
    "A new signup must hydrate its newly created business, never owner business A",
  );
}

{
  const { calls, dependencies } = buildDependencies({
    target: {
      id: "truck-b",
      ownerId: "owner-1",
      name: "Second Business",
      address: "100 Admin Lane",
      city: "Pensacola",
      state: "FL",
      businessType: "food_truck",
      isFoodTruck: true,
    },
  });
  const result = await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, targetRestaurantId: "truck-b" },
    dependencies,
  );
  assert.equal(result.created, false);
  assert.deepEqual(calls.created, []);
  assert.equal(calls.hydrated[0]?.restaurantId, "truck-b");
}

{
  const { calls, dependencies } = buildDependencies({
    target: {
      id: "truck-a",
      ownerId: "owner-1",
      name: "First Business",
      address: "10 Other Street",
      city: "Pensacola",
      state: "FL",
      businessType: "food_truck",
      isFoodTruck: true,
    },
  });
  await assert.rejects(
    promoteBusinessSetupToProfile(
      "owner-1",
      { ...baseInput, targetRestaurantId: "truck-a" },
      dependencies,
    ),
    /identity does not match/,
  );
  assert.deepEqual(calls.hydrated, []);
}

{
  const { calls, dependencies } = buildDependencies({
    target: {
      id: "legacy-truck",
      ownerId: "owner-1",
      name: baseInput.businessName,
      address: baseInput.address,
      city: baseInput.city,
      state: baseInput.state,
      businessType: "restaurant",
      isFoodTruck: true,
    },
  });
  const result = await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, targetRestaurantId: "legacy-truck" },
    dependencies,
  );
  assert.equal(result.restaurant.id, "legacy-truck");
  assert.equal(calls.hydrated.length, 1);
  assert.deepEqual(calls.created, []);
}

{
  const { calls, dependencies } = buildDependencies({
    target: {
      id: "foreign-truck",
      ownerId: "somebody-else",
      businessType: "food_truck",
      isFoodTruck: true,
    },
  });
  await assert.rejects(
    promoteBusinessSetupToProfile(
      "owner-1",
      { ...baseInput, targetRestaurantId: "foreign-truck" },
      dependencies,
    ),
    /does not belong to this owner/,
  );
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.hydrated, []);
}

for (const businessType of [
  "restaurant",
  "bar",
  "food_truck",
  "caterer",
  "private_chef",
] as const) {
  const { calls, dependencies } = buildDependencies();
  await promoteBusinessSetupToProfile(
    "owner-1",
    { ...baseInput, businessType },
    dependencies,
  );
  assert.equal(calls.created[0]?.businessType, businessType);
  assert.equal(calls.created[0]?.isFoodTruck, businessType === "food_truck");
}

assert.equal(resolvePromotionBusinessType("brewery"), "bar");
assert.equal(resolvePromotionBusinessType("mobile_food_vendor"), "food_truck");
assert.throws(() => resolvePromotionBusinessType("host_venue"), /Unsupported/);

{
  const { calls, dependencies } = buildDependencies();
  await promoteBusinessSetupToProfile(
    "owner-1",
    {
      ...baseInput,
      placeEvidence: {
        placeId: "google-place-123",
        formattedAddress: "100 Admin Lane, Pensacola, FL",
        latitude: 30.4213,
        longitude: -87.2169,
      },
    },
    dependencies,
  );
  const created = calls.created[0] as any;
  assert.equal(created.latitude, undefined);
  assert.equal(created.longitude, undefined);
  assert.equal(created.rawData.onboardingPlaceEvidence.placeId, "google-place-123");
  assert.equal(
    created.rawData.onboardingPlaceEvidence.publicLocationApproved,
    false,
  );
  assert.equal(created.rawData.profileLocations.addressKind, "business_admin");
  assert.equal(created.rawData.profileLocations.addressPublicByDefault, false);
  const publicProfile = toPublicTruckProfile({
    row: created,
    baseUrl: "https://www.mealscout.us",
  });
  assert.equal(publicProfile.addressPublicLabel, null);
  assert.equal(publicProfile.latitude, null);
  assert.equal(publicProfile.longitude, null);
  assert.equal(
    publicProfile.cta.some((action) => action.type === "map"),
    false,
    "Google place evidence must not create public truck directions",
  );
}

const root = process.cwd();
const promotionSource = fs.readFileSync(
  path.join(root, "server", "services", "businessOnboardingPromotion.ts"),
  "utf8",
);
const profileRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "restaurantOperationsRoutes.ts"),
  "utf8",
);
const ownerDashboardSource = fs.readFileSync(
  path.join(root, "client", "src", "pages", "restaurant-owner-dashboard.tsx"),
  "utf8",
);
const signupRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "restaurantSignupRoutes.ts"),
  "utf8",
);
const signupPageSource = fs.readFileSync(
  path.join(root, "client", "src", "pages", "restaurant-signup.tsx"),
  "utf8",
);
assert.match(
  promotionSource,
  /db\.transaction\([\s\S]*ensureRestaurantMenuItems/,
  "Canonical menu hydration must execute in one database transaction",
);
assert.match(
  promotionSource,
  /pg_advisory_xact_lock[\s\S]*menus\.serviceType, "all"/,
  "Concurrent onboarding must serialize creation of the canonical all-service menu",
);
assert.match(
  promotionSource,
  /menuItems\.restaurantId, restaurantId[\s\S]*menuItems\.menuId, menuId/,
  "Onboarding deduplication must stay inside the canonical menu variant",
);
assert.doesNotMatch(
  promotionSource,
  /getRestaurantsByOwner\(userId\)[\s\S]*owned\[0\]/,
  "Promotion must never infer a mutation target from the owner's first business",
);
assert.doesNotMatch(
  profileRouteSource,
  /businessType:\s*z\./,
  "Routine profile edits must not reclassify canonical business identity",
);
assert.match(
  ownerDashboardSource,
  /businessType:\s*_businessType/,
  "Routine profile saves must omit business identity",
);
assert.doesNotMatch(
  promotionSource,
  /truckManualSchedules/,
  "Onboarding place evidence must not create a truck stop",
);
assert.match(
  promotionSource,
  /onConflictDoNothing\(\{ target: restaurants\.id \}\)[\s\S]*Onboarding attempt belongs to a different owner/,
  "A retry must recover one owner-bound profile by its onboarding attempt id",
);
assert.match(
  signupRouteSource,
  /onboardingAttemptId: z\.string\(\)\.uuid\(\)[\s\S]*A stable onboarding attempt is required/,
  "The authenticated signup route must require a valid stable attempt id",
);
assert.match(
  signupRouteSource,
  /error instanceof BusinessPromotionError[\s\S]*error\.statusCode/,
  "Typed identity conflicts must retain their HTTP 400/409 status",
);
assert.match(
  signupRouteSource,
  /scope: "restaurants:signup"[\s\S]*limit: 6[\s\S]*windowMs: 60 \* 60 \* 1000/,
  "Authenticated onboarding must rate-limit fresh profile creation attempts",
);
assert.match(
  signupPageSource,
  /RESTAURANT_ONBOARDING_ATTEMPT_KEY[\s\S]*onboardingAttemptId,[\s\S]*\/api\/restaurants\/signup/,
  "The browser must persist and submit the same onboarding attempt across retries",
);

console.log("business-signup-menu-attachment.contract: PASS");
