import { readFileSync } from "node:fs";

const indexHtml = readFileSync("client/index.html", "utf8");
const scoutPage = readFileSync(
  "client/src/pages/explore-preview-v2.tsx",
  "utf8",
);
const publicProfile = readFileSync(
  "client/src/pages/public-profile.tsx",
  "utf8",
);
const prerender = readFileSync("server/seo/publicProfilePrerender.ts", "utf8");
const publicDiscoveryRoutes = readFileSync(
  "server/routes/publicDiscoveryRoutes.ts",
  "utf8",
);

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

assert(
  indexHtml.includes("MealScout | Discover Local Food Near You"),
  "Default public HTML title should use broader food-discovery positioning.",
);
assert(
  indexHtml.includes(
    "Discover food trucks, restaurants, dishes, events, and local food deals near you with MealScout.",
  ),
  "Default public description should cover food discovery beyond food trucks.",
);
assert(
  !indexHtml.includes("MealScout | Find Food Trucks Near You"),
  "Default public metadata should not keep the old truck-first title.",
);
assert(
  scoutPage.includes('title="Scout Local Food Discovery | MealScout"') &&
    scoutPage.includes(
      'description="Discover food trucks, restaurants, dishes, events, and local food deals near you with MealScout."',
    ),
  "/scout route metadata should align with food-discovery positioning.",
);

assert(
  prerender.includes('{ label: "Scout", href: "/scout" }'),
  'Public profile CTA should label the action "Scout".',
);
assert(
  publicProfile.includes("Scout") &&
    !/Open Scout|Scout nearby|Keep scouting/i.test(publicProfile),
  'Public profiles should label the discovery action "Scout" without modifiers.',
);
assert(
  !prerender.includes("Scout local dashboard"),
  "Public profile prerender must not expose dashboard language.",
);

assert(
  prerender.includes(
    'if (normalized === "private_residence") return "Private event location";',
  ) &&
    prerender.includes('if (normalized === "other") return "Host location";'),
  "Prerendered location pages should format raw location types as consumer labels.",
);
assert(
  !prerender.includes("Location type: ${row.locationType}"),
  "Prerendered location pages should not expose raw location type values.",
);

assert(
  prerender.includes("isSyntheticPublicEntityName(name)") &&
    prerender.includes(
      "isUnclaimed || isSyntheticTestEntity ? noindexRobots : indexableRobots",
    ),
  "Obvious synthetic test profiles should be noindexed in prerendered public profile HTML.",
);

assert(
  publicDiscoveryRoutes.includes(
    "friendlyLocationTypeLabel(row.locationType)",
  ) && !publicDiscoveryRoutes.includes("Location type: ${row.locationType}"),
  "Public discovery source truth statements should use friendly location type labels.",
);

console.log("scout-public-copy-index-hygiene.contract: PASS");
