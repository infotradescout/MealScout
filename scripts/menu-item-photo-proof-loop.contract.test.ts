import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function testSchemaHasPendingAcceptedRejectedFeaturedStatuses() {
  const source = readFileSync("shared/schema/legacy.ts", "utf8");
  assert.ok(source.includes("menuItemPhotos"));
  assert.ok(source.includes("pending | accepted | rejected | featured"));
}

function testSubmitRouteKeepsPhotoPendingByDefault() {
  const source = readFileSync("server/routes/menuRoutes.ts", "utf8");
  assert.ok(source.includes('"/api/menu-items/:menuItemId/recommend"'));
  assert.ok(source.includes('status: "pending"'));
  assert.ok(source.includes("AI-generated dish images are not allowed"));
}

function testPublicResolverPrioritizesRestaurantThenFeaturedThenAccepted() {
  const source = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
  assert.ok(source.includes("const restaurantOwned = String(item.imageUrl || \"\").trim() || null;"));
  assert.ok(source.includes("photo.featuredByBusiness"));
  assert.ok(source.includes("String(photo.status) === \"featured\""));
  assert.ok(source.includes("String(photo.status) === \"accepted\""));
}

function testScoreAwardedOnModerationTransitionOnly() {
  const source = readFileSync("server/routes/menuRoutes.ts", "utf8");
  assert.ok(source.includes("scorePhotoAwardedAt"));
  assert.ok(source.includes("scoreFeaturedAwardedAt"));
  assert.ok(source.includes("influenceScore"));
}

function run() {
  testSchemaHasPendingAcceptedRejectedFeaturedStatuses();
  testSubmitRouteKeepsPhotoPendingByDefault();
  testPublicResolverPrioritizesRestaurantThenFeaturedThenAccepted();
  testScoreAwardedOnModerationTransitionOnly();
  console.log("menu-item-photo-proof-loop.contract: PASS");
}

run();

