import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const policy = read("shared/merchantCrossPromotion.ts");
const discovery = read("server/routes/publicDiscoveryRoutes.ts");
const orders = read("server/routes/pickupOrderRoutes.ts");
const operations = read("server/routes/restaurantOperationsRoutes.ts");
const schema = read("shared/schema/legacy.ts");
const migration = read(
  "migrations/117_merchant_cross_promotion_attribution.sql",
);

assert.match(policy, /approvalMode: "automatic" \| "approved_only"/);
assert.match(policy, /excludedBusinessIds/);
assert.match(policy, /crossPromotionCandidateAllowed/);

assert.match(discovery, /readMerchantCrossPromotionPolicy/);
assert.match(discovery, /crossPromotionCandidateAllowed/);
assert.match(discovery, /crossPromotionSourceId/);
assert.match(discovery, /httpOnly: true/);

assert.match(orders, /promotionSourceRestaurantId/);
assert.match(orders, /promotionAffiliateUserId/);
assert.match(orders, /req\.cookies\?\.crossPromotionSourceId/);
assert.match(orders, /promotionSourceId !== body\.restaurantId/);

assert.match(operations, /\/cross-promotion"/);
assert.match(operations, /\/cross-promotion\/report"/);
assert.match(operations, /clickToOrderRate/);
assert.match(operations, /withLockedRestaurantSettings/);

assert.match(schema, /promotionSourceRestaurantId/);
assert.match(schema, /promotionAffiliateUserId/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
assert.match(migration, /idx_pickup_orders_promotion_source/);

console.log("merchant-cross-promotion.contract: PASS");
