import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(
  "client/src/components/consumer-collection-shell.tsx",
  "utf8",
);
const favorites = readFileSync("client/src/pages/favorites.tsx", "utf8");
const deals = readFileSync("client/src/pages/deals-featured.tsx", "utf8");
const cityDeals = readFileSync("client/src/pages/deals-city.tsx", "utf8");
const events = readFileSync("client/src/pages/events.tsx", "utf8");
const eventsRouter = readFileSync("client/src/pages/events-router.tsx", "utf8");
const eventCoordinator = readFileSync(
  "client/src/pages/event-coordinator-dashboard.tsx",
  "utf8",
);
const profile = readFileSync("client/src/pages/profile.tsx", "utf8");

for (const phrase of [
  'data-consumer-collection-shell="true"',
  'label: "Saved", href: "/favorites"',
  'label: "Deals", href: "/deals"',
  'label: "Events", href: "/events/public"',
  '<Link href="/scout">',
  "CollectionState",
  "CollectionLoadingState",
]) {
  assert(shell.includes(phrase), `Consumer collection shell must include: ${phrase}`);
}

assert(favorites.includes('queryKey: ["/api/favorites/restaurants"]'));
assert(favorites.includes("buildPublicProfilePath"));
assert(favorites.includes('section="saved"'));
assert(!favorites.includes("<Navigation"));
assert(!favorites.includes('href="/search"'));
assert(!favorites.includes("Pro Tip"));

assert(deals.includes('queryKey: ["/api/deals/featured"]'));
assert(deals.includes('queryKey: ["/api/geo-ads"'));
assert(deals.includes("<DealCard"));
assert(deals.includes('section="deals"'));
assert(!deals.includes("<Navigation"));
assert(!deals.includes(">Sort<"));
assert(!deals.includes(">Filter<"));

assert(cityDeals.includes("<ConsumerCollectionShell"));
assert(cityDeals.includes('section="deals"'));
assert(!cityDeals.includes("<BackHeader"));
assert(!cityDeals.includes('href="/search"'));

assert(events.includes('queryKey: ["/api/events/upcoming"]'));
assert(events.includes('section="events"'));
assert(events.includes('href={`/event/${encodeURIComponent(String(event.id))}`}'));
assert(!events.includes("/api/event-coordinator/events"));
assert(!events.includes("hostPriceCents"));
assert(!events.includes("maxTrucks"));
assert(
  eventCoordinator.includes('/api/event-coordinator/events'),
  "Event creation must remain in the existing coordinator workspace.",
);

for (const destination of [
  '"/events/public"',
  '"/event-coordinator/dashboard"',
  '"/truck-discovery"',
]) {
  assert(
    eventsRouter.includes(destination),
    `Role-aware events entry must preserve ${destination}.`,
  );
}

assert(profile.includes('href: "/favorites"'));
assert(profile.includes('title: "Saved"'));

const publicCopy = `${shell}\n${favorites}\n${deals}\n${cityDeals}\n${events}`.toLowerCase();
for (const prohibited of [
  "open scout",
  "scout nearby",
  "keep scouting",
  "back to scout",
]) {
  assert(
    !publicCopy.includes(prohibited),
    `Consumer collection copy must use the exact Scout action, not: ${prohibited}`,
  );
}

console.log("mealscout-consumer-collections.contract: PASS");
