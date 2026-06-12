import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync("shared/schema/legacy.ts", "utf8");
const migration = readFileSync(
  "migrations/107_public_business_slug_ownerships.sql",
  "utf8",
);
const ownership = readFileSync(
  "server/publicProfiles/publicBusinessSlugOwnership.ts",
  "utf8",
);
const resolver = readFileSync(
  "server/publicProfiles/publicBusinessSlugResolver.ts",
  "utf8",
);
const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const publicDiscovery = readFileSync(
  "server/routes/publicDiscoveryRoutes.ts",
  "utf8",
);
const adminRoutes = readFileSync(
  "server/routes/admin/userAdminRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync(
  "client/src/pages/admin-dashboard.tsx",
  "utf8",
);
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

assert(
  schema.includes("publicBusinessSlugOwnerships") &&
    schema.includes('unique("uq_public_business_slug_ownerships_slug")') &&
    schema.includes('unique("uq_public_business_slug_ownerships_entity")'),
  "Schema must define durable public business slug ownership with unique slug and unique entity ownership.",
);

assert(
  migration.includes("CREATE TABLE IF NOT EXISTS public_business_slug_ownerships") &&
    migration.includes("uq_public_business_slug_ownerships_slug") &&
    migration.includes("uq_public_business_slug_ownerships_entity"),
  "Migration must create the durable ownership table and assignment-time uniqueness guards.",
);

assert(
  ownership.includes("ensurePublicBusinessSlugOwnership") &&
    ownership.includes("buildSlugCandidates") &&
    ownership.includes("city ? `${base}-${city}`") &&
    ownership.includes("state ? `${base}-${state}`") &&
    ownership.includes("`${base}-${suffix}`") &&
    ownership.includes('assignmentStatus: slug === preferredSlug ? "assigned" : "assigned_variant"'),
  "Assignment must deterministically prevent duplicate public root slugs with location-aware and numeric variants.",
);

assert(
  resolver.includes("listPublicBusinessSlugOwnershipsBySlug") &&
    resolver.includes("verifyOwnedSlugTarget") &&
    resolver.includes("return candidates;") &&
    resolver.includes("ensurePublicBusinessSlugOwnershipForEntity") &&
    resolver.includes('resolution.status !== "unique"'),
  "Resolver must prefer assigned owned slugs, emit only assigned unique clean paths, and keep unique-only defense checks.",
);

assert(
  resolver.includes('status: "ambiguous"') &&
    resolver.includes("restaurantRows") &&
    resolver.includes("hostRows") &&
    resolver.includes("supplierRows"),
  "Runtime ambiguity fallback must remain for legacy or bad data instead of silently routing a colliding slug.",
);

assert(
  shareRoutes.includes("resolveUniqueCleanShareTarget") &&
    shareRoutes.includes("resolveUniqueCleanBusinessPathForEntity") &&
    shareRoutes.includes("(await resolveUniqueCleanShareTarget(sharePath)) || sharePath"),
  "Tracked share generation must use assigned unique clean slugs where available and preserve compatibility fallback.",
);

assert(
  publicDiscovery.includes("cleanBusinessPath") &&
    publicDiscovery.includes("resolveUniqueCleanBusinessPathForEntity") &&
    publicDiscovery.includes('app.get("/api/public/resolve-business/:businessSlug"'),
  "Public profile APIs must return assigned clean business paths without changing legacy profile routes.",
);

assert(
  adminRoutes.includes("publicSlugStatus") &&
    adminRoutes.includes("cleanBusinessPath") &&
    adminRoutes.includes("resolveUniqueCleanBusinessPathForEntity"),
  "Admin detail APIs must expose assigned slug governance fields.",
);

assert(
  adminDashboard.includes("Public slug") &&
    adminDashboard.includes("Slug status") &&
    adminDashboard.includes("attachedRestaurant?.cleanBusinessPath") &&
    adminDashboard.includes("attachedHostProfile?.cleanBusinessPath"),
  "Admin UI must show assigned public slug/status and prefer clean assigned links for affiliate output.",
);

assert(
  ownerDashboard.includes("cleanBusinessPath") &&
    ownerDashboard.includes("resolveCanonicalShareUrlSync"),
  "Owner QR/share surfaces must continue to prefer server-proven clean business paths.",
);

const bannedPublicEmissionFragments = [
  "/p/location",
  "/referral-redirect",
  "?ref=",
  "to=",
];

for (const fragment of bannedPublicEmissionFragments) {
  assert.equal(
    adminDashboard.includes(`Affiliate Link") && adminDashboard.includes("${fragment}`),
    false,
    `Admin affiliate output must not intentionally emit banned public URL fragment: ${fragment}`,
  );
}

console.log("mealscout-public-business-slug-ownership.contract: PASS");
