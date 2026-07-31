import { readFileSync } from "node:fs";

const source = readFileSync(
  "server/routes/pickupOrderRoutes.ts",
  "utf8",
).replace(/\r\n/g, "\n");

const requireIncludes = (snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

const requireExcludes = (snippet: string, message: string) => {
  if (source.includes(snippet)) throw new Error(message);
};

requireIncludes(
  "await assertCanManageRestaurantOrders(user, restaurantId);",
  "Owner order tools must retain business ownership and permission checks.",
);
requireExcludes(
  "assertHasOrderingSubscription",
  "Owner or customer ordering must not depend on a profile subscription.",
);
requireExcludes(
  "ordering_subscription_denied",
  "Ordering must not emit retired subscription-denial telemetry.",
);
requireExcludes(
  "$25/mo",
  "Ordering must not advertise a retired monthly plan.",
);

console.log("ordering-profile-access.contract: PASS");
