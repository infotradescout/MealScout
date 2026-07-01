import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const navigation = read("client/src/components/navigation.tsx");
const scout = read("client/src/pages/explore-preview.tsx");
const map = read("client/src/pages/map.tsx");
const publicProfile = read("client/src/pages/public-profile.tsx");
const app = read("client/src/App.tsx");

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert(startIndex >= 0, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(endIndex >= 0, `Missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const guestPrimary = sliceBetween(navigation, "guest: [", "customer: [");
const guestMore = sliceBetween(navigation, 'if (lane === "guest")', "} else if");
const sixSlotNav = sliceBetween(navigation, "const sixSlotNav: NavItem[] = [", "];");

for (const redGuestLink of [
  'path: "/video"',
  'path: "/events"',
  'path: "/customer-signup"',
  'path: "/share-hub"',
]) {
  assert(
    !guestPrimary.includes(redGuestLink),
    `Guest primary nav must not promote red link ${redGuestLink}`,
  );
  assert(
    !guestMore.includes(redGuestLink),
    `Guest more nav must not promote red link ${redGuestLink}`,
  );
}

assert(
  sixSlotNav.includes('lane === "guest"') && sixSlotNav.includes('path: "/claim-truck"'),
  "Guest six-slot nav must replace the share slot with claim-truck containment.",
);
assert(
  navigation.includes('path: "/restaurant-signup?businessType=food_truck"'),
  "Guest nav must preserve the food-truck signup intake lane.",
);

for (const blockedScoutExit of [
  "Local matches will include places, dishes, trucks, deals, and events.",
]) {
  assert(
    !scout.includes(blockedScoutExit),
    `Scout must not promote red exit: ${blockedScoutExit}`,
  );
}
assert(
  scout.includes("/scout — The canonical MealScout food discovery page.") &&
    scout.includes("Coverage is still thin here") &&
    scout.includes("Browse nearby or open the map"),
  "Scout must keep honest limited-coverage copy visible.",
);
assert(
  scout.includes('window.location.href = `/login?redirect=${encodeURIComponent("/scout")}`;'),
  "Scout account action must send guests to login with a Scout redirect.",
);

const mapExploreLinks = sliceBetween(map, "const mapExploreLinks = [", "];");
assert(
  mapExploreLinks.includes('href: "/scout"') && mapExploreLinks.includes('href: "/search"'),
  "Map explore links must preserve Scout and Browse nearby exits.",
);
for (const blockedMapLink of ['href: "/events"', "Search Food Deals", "Food Truck Events"]) {
  assert(
    !mapExploreLinks.includes(blockedMapLink),
    `Map explore links must not promote red destination: ${blockedMapLink}`,
  );
}
assert(
  map.includes("const trendingLinks: Array") && map.includes("= [];"),
  "Map trending search exits must remain suppressed during containment.",
);
assert(
  map.includes("const showContainedMapExtendedSections = false;"),
  "Map event/supplier/deal list sections must stay runtime-suppressed.",
);
assert(
  !map.includes("`/restaurant/${"),
  "Map truck CTAs must not use restaurant-shaped profile URLs during containment.",
);
assert(
  map.includes('entityType: "truck"'),
  "Map truck CTAs must route through public truck profile path building.",
);

for (const blockedProfileLink of [
  "Places to eat nearby",
  "Deals today",
  "Local food events",
  "Find similar spots nearby",
]) {
  assert(
    !publicProfile.includes(blockedProfileLink),
    `Public profile related discovery must not promote ${blockedProfileLink}.`,
  );
}
assert(
  publicProfile.includes("cta?.safe && cta?.href"),
  "Public profile CTA filtering must continue to require cta.safe.",
);
assert(
  publicProfile.includes("MealScout coverage is limited"),
  "Public profile must disclose limited coverage near related discovery.",
);

for (const requiredRoute of [
  '<Route path="/scout"',
  '<Route path="/restaurant-signup"',
  '<Route path="/claim-truck"',
  '<Route path="/map"',
]) {
  assert(app.includes(requiredRoute), `Required green/yellow route must remain present: ${requiredRoute}`);
}

console.log("mealscout-live-exposure-guardrails.contract: PASS");
