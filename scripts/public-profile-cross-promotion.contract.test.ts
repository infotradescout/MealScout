import assert from "node:assert/strict";
import {
  rankPublicCrossPromotions,
  type PublicCrossPromotionCandidate,
} from "../shared/publicCrossPromotion";

const candidate = (
  id: string,
  cuisineType: string,
): PublicCrossPromotionCandidate => ({
  id,
  name: id,
  profileType: "restaurant",
  cuisineType,
  city: "Pensacola",
  state: "FL",
  logoUrl: null,
  coverImageUrl: null,
  profilePath: `/${id}`,
  attributedProfilePath: `/${id}/merchant-tag`,
  attributionApplied: true,
});

const ranked = rankPublicCrossPromotions(
  { id: "source", cuisineType: "Pizza Italian" },
  [
    candidate("source", "Pizza"),
    candidate("pizza-two", "Pizza Italian"),
    candidate("dessert", "Dessert Bakery"),
    candidate("tacos", "Mexican Tacos"),
  ],
  2,
);

assert.equal(ranked.length, 2);
assert.ok(ranked.every((row) => row.id !== "source"));
assert.ok(
  ranked.every((row) => row.id !== "pizza-two"),
  "Complementary food should rank before a same-cuisine near duplicate.",
);
assert.ok(
  ranked.every(
    (row) =>
      row.attributedProfilePath.startsWith("/") &&
      !row.attributedProfilePath.includes("?"),
  ),
  "Cross-promotion must preserve clean in-app attributed paths.",
);

console.log("public-profile-cross-promotion.contract: PASS");
