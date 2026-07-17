import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const owner = read("client/src/pages/restaurant-owner-dashboard.tsx");
const workspace = read("client/src/components/owner-profile-workspace.tsx");
const mediaRoutes = read("server/routes/mediaRoutes.ts");
const profileRoutes = read("server/routes/restaurantOperationsRoutes.ts");

// Profile and Photos are complete workspace destinations, not setup cards
// sitting above unrelated dashboard tabs.
assert.match(owner, /<OwnerProfileWorkspace/);
assert.match(
  owner,
  /mode=\{setupMode === "profile-media" \? "media" : "profile"\}/,
);
assert.match(owner, /setupMode === "profile"[\s\S]*\? "profile"/);
assert.match(owner, /setupMode === "profile-media"[\s\S]*\? "media"/);
assert.match(
  owner,
  /setupMode &&[\s\S]*!\["schedule", "bookings"\]\.includes\(setupMode\)/,
);
assert.match(workspace, /data-testid="owner-profile-workspace"/);
assert.match(workspace, /data-testid="owner-photos-workspace"/);
assert.match(workspace, /data-testid="owner-profile-preview"/);
assert.doesNotMatch(
  workspace,
  /Business onboarding|Profile basics workspace|Media workspace/,
);

// The profile form uses visible labels and groups secondary links instead of
// relying on a wall of placeholders.
for (const copy of [
  "What customers see",
  "Business identity",
  "Cuisine or food type",
  "About your business",
  "Website, ordering, and inquiry links",
  "Social links",
  "Save profile",
]) {
  assert.ok(workspace.includes(copy), `Missing profile workflow copy: ${copy}`);
}
assert.match(workspace, /<form[\s\S]*onSubmit/);
assert.match(workspace, /type="tel"/);
assert.match(workspace, /type="url"/);

// Image persistence is owned only by media endpoints. A later text save must
// never send stale logo or cover values back through profile-basics.
assert.match(
  owner,
  /logoUrl: _logoUrl,[\s\S]*coverImageUrl: _coverImageUrl,[\s\S]*\.\.\.profileBasics/,
);
assert.match(owner, /profile-basics`,[\s\S]*profileBasics/);
assert.doesNotMatch(owner, /profile-basics`,\s*payload/);
assert.match(owner, /setQueryData<Restaurant\[\]>/);
assert.match(
  owner,
  /variables\.kind === "logo"[\s\S]*logoUrl: String\(payload\.url\)/,
);
assert.match(
  owner,
  /variables\.kind === "cover"[\s\S]*coverImageUrl: String\(payload\.url\)/,
);
assert.match(
  owner,
  /variables\.kind === "gallery"[\s\S]*publicGalleryImages: nextGallery/,
);

// Uploads save immediately, expose current media, and preserve the existing
// approval model without inventing deletion or moderation behavior.
for (const copy of [
  "Uploads save immediately",
  "Cover photo",
  "Logo",
  "Food and business photos",
  "Add photo",
  "Visible",
  "Pending",
]) {
  assert.ok(workspace.includes(copy), `Missing photos workflow copy: ${copy}`);
}
assert.match(workspace, /accept="image\/\*"/);
assert.match(workspace, /onApprovalChange/);
assert.doesNotMatch(workspace, /Delete photo|Remove photo/);

// API, permission, and persistence contracts are unchanged by this UI slice.
for (const endpoint of [
  "/api/upload/restaurant-logo",
  "/api/upload/restaurant-cover",
  "/api/upload/restaurant-gallery",
  "/api/restaurants/:restaurantId/media-gallery/:mediaId",
]) {
  assert.ok(
    mediaRoutes.includes(endpoint),
    `Missing preserved media endpoint: ${endpoint}`,
  );
}
assert.ok(
  profileRoutes.includes("/api/restaurants/:restaurantId/profile-basics"),
  "Missing preserved profile endpoint",
);
assert.match(mediaRoutes, /hasBusinessPermissionForRestaurant/);
assert.match(profileRoutes, /verifyRestaurantOwnership/);

console.log("mealscout-owner-profile-media-workspace.contract: PASS");
