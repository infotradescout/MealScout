import assert from "node:assert/strict";
import {
  calculatePromotedOrderCommissionCents,
  isAttributionUsable,
  promotionCandidateAllowed,
} from "../shared/merchantPromotion";

assert.equal(
  promotionCandidateAllowed({
    enabled: false,
    approvalMode: "automatic",
  }),
  false,
);
assert.equal(
  promotionCandidateAllowed({
    enabled: true,
    approvalMode: "approved_only",
    partnerStatus: null,
  }),
  false,
);
assert.equal(
  promotionCandidateAllowed({
    enabled: true,
    approvalMode: "approved_only",
    partnerStatus: "approved",
  }),
  true,
);
assert.equal(
  promotionCandidateAllowed({
    enabled: true,
    approvalMode: "automatic",
    partnerStatus: "excluded",
  }),
  false,
);

assert.equal(calculatePromotedOrderCommissionCents(10_00, 500), 50);
assert.equal(calculatePromotedOrderCommissionCents(9_99, 250), 24);
assert.equal(calculatePromotedOrderCommissionCents(-100, 500), 0);

const now = new Date("2026-07-28T18:00:00.000Z");
assert.equal(
  isAttributionUsable({
    sourceRestaurantId: "source",
    targetRestaurantId: "target",
    expectedTargetRestaurantId: "target",
    clickedAt: new Date("2026-07-28T17:00:00.000Z"),
    expiresAt: new Date("2026-07-29T17:00:00.000Z"),
    now,
  }),
  true,
);
assert.equal(
  isAttributionUsable({
    sourceRestaurantId: "source",
    targetRestaurantId: "target",
    expectedTargetRestaurantId: "other-target",
    clickedAt: new Date("2026-07-28T17:00:00.000Z"),
    expiresAt: new Date("2026-07-29T17:00:00.000Z"),
    now,
  }),
  false,
);
assert.equal(
  isAttributionUsable({
    sourceRestaurantId: "source",
    targetRestaurantId: "target",
    expectedTargetRestaurantId: "target",
    clickedAt: new Date("2026-07-28T17:00:00.000Z"),
    expiresAt: new Date("2026-07-28T17:30:00.000Z"),
    now,
  }),
  false,
);

console.log("merchant-promotion.behavior: PASS");
