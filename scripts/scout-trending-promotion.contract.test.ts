import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appRoutes = readFileSync("client/src/App.tsx", "utf8");
const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const userDashboardPage = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
const dealsFeaturedPage = readFileSync("client/src/pages/deals-featured.tsx", "utf8");
const helpPage = readFileSync("client/src/pages/profile/help.tsx", "utf8");

const userFacingPromotionPatterns: RegExp[] = [
  /<Link\s+href=["']\/trending["']/,
  /href=["']\/trending["']/,
  /href:\s*["']\/trending["']/,
  /navigate\(\s*["']\/trending["']\s*\)/,
  /location\.href\s*=\s*["']\/trending["']/,
  /<Link\s+href=["']\/map["']/,
  /href=["']\/map["']/,
  /href:\s*["']\/map["']/,
  /navigate\(\s*["']\/map["']\s*\)/,
  /location\.href\s*=\s*["']\/map["']/,
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
assert.ok(
  !scoutPage.includes("What's Hot") && !scoutPage.includes("What’s Hot"),
  "Scout page must not include visible What's Hot promotion language.",
);
assert.ok(
  !userDashboardPage.includes("Open Map"),
  "User dashboard must not include visible Open Map language.",
);
assert.ok(
  !dealsFeaturedPage.includes("Open Map"),
  "Deals surface must not include visible Open Map language.",
);
assert.ok(
  !helpPage.includes('{ label: "Map", href: "/map" }'),
  "Help page must not include a visible Map quick link.",
);

assert.ok(
  appRoutes.includes('<Route path="/trending" component={RedirectToScout} />'),
  "Stale /trending route must redirect to /scout.",
);
assert.ok(
  appRoutes.includes('<Route path="/map" component={RedirectToScout} />'),
  "Stale /map route must redirect to /scout.",
);
assert.ok(
  !appRoutes.includes('<Route path="/trending" component={Trending} />'),
  "Standalone /trending page route must not be active.",
);
assert.ok(
  !appRoutes.includes('<Route path="/map" component={MapPage} />'),
  "Standalone /map page route must not be active.",
);

assert.ok(
  !navigation.includes('{ path: "/map", icon: MapPin, label: "Map" }'),
  "Navigation must not expose /map as a public discovery slot.",
);

assertNoTrendingPromotion(scoutPage, "Scout page");
assertNoTrendingPromotion(userDashboardPage, "User dashboard");
assertNoTrendingPromotion(navigation, "Navigation");
assertNoTrendingPromotion(helpPage, "Help page");

console.log("scout-trending-promotion.contract: PASS");
