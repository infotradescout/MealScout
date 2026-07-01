import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const mapPage = readFileSync("client/src/pages/map.tsx", "utf8");
const userDashboardPage = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

const userFacingPromotionPatterns: RegExp[] = [
  /<Link\s+href=["']\/trending["']/,
  /href=["']\/trending["']/,
  /href:\s*["']\/trending["']/,
  /navigate\(\s*["']\/trending["']\s*\)/,
  /location\.href\s*=\s*["']\/trending["']/,
];

const assertNoTrendingPromotion = (source: string, contextLabel: string) => {
  for (const pattern of userFacingPromotionPatterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${contextLabel} must not include visible /trending promotion pattern: ${pattern}`,
    );
  }
};

assert.ok(
  !scoutPage.includes("See trending"),
  "Scout page must not include a visible 'See trending' CTA label.",
);

assertNoTrendingPromotion(scoutPage, "Scout page");
assertNoTrendingPromotion(mapPage, "Map page");
assertNoTrendingPromotion(userDashboardPage, "User dashboard");

console.log("scout-trending-promotion.contract: PASS");
