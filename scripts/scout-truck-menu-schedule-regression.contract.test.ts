import { readFileSync } from "node:fs";
import { isTruckDiscoverableForScout } from "../server/utils/truckListingEligibility";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const locationRoutes = readFileSync("server/routes/locationUtilityRoutes.ts", "utf8");
const restaurantOps = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const scoutSurface = readFileSync("server/services/scoutSurfaceService.ts", "utf8");

const incompleteTruck = {
  id: "truck-without-menu-or-schedule",
  name: "Incomplete but real truck",
  isFoodTruck: true,
  businessType: "food_truck",
  isActive: true,
};

if (!isTruckDiscoverableForScout(incompleteTruck)) {
  throw new Error("Trucks without menu or schedule must remain Scout-discoverable.");
}

if (!locationRoutes.includes("return isTruck || menuEligibleIds.has")) {
  throw new Error("Subscribed restaurant discovery must not menu-filter food trucks.");
}

if (!restaurantOps.includes("const menuEligibleTrucks = payloadTrucks.map")) {
  throw new Error("Live truck discovery must annotate menu state without filtering trucks.");
}

if (scoutSurface.includes("return isTruckDiscoverableForScout(row);")) {
  throw new Error("Scout surface must not use menu/schedule as a truck discovery gate.");
}

for (const snippet of [
  "\"Menu: none found\"",
  "Menu: none found.",
  "Schedule: none found.",
]) {
  if (!scoutPage.includes(snippet) && !publicProfile.includes(snippet)) {
    throw new Error(`Missing none-found public placeholder: ${snippet}`);
  }
}

console.log("scout-truck-menu-schedule-regression.contract: PASS");
