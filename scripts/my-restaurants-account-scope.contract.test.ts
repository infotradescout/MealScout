import { readFileSync } from "node:fs";

const source = readFileSync(
  "server/routes/restaurantOperationsRoutes.ts",
  "utf8",
).replace(/\r\n/g, "\n");

const routeStart = source.indexOf('"/api/restaurants/my-restaurants"');
const nextRoute = source.indexOf('app.patch(', routeStart);

if (routeStart < 0 || nextRoute < 0) {
  throw new Error("Could not isolate the my-restaurants route.");
}

const route = source.slice(routeStart, nextRoute);

if (route.includes("storage.getAllRestaurants()")) {
  throw new Error(
    "my-restaurants must never serialize the full restaurant inventory, including for admins.",
  );
}

for (const required of [
  "storage.getRestaurantsByOwner(req.user.id)",
  "getBusinessAccessContext(req.user.id)",
  "attachVerificationState(restaurantsByOwner as any[])",
]) {
  if (!route.includes(required)) {
    throw new Error(`Missing account-scoped my-restaurants behavior: ${required}`);
  }
}

console.log("my-restaurants-account-scope.contract: PASS");
