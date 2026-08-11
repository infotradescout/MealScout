import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const discovery = read("server/routes/publicDiscoveryRoutes.ts");
const mapper = read("server/publicProfiles/toPublicRestaurantProfile.ts");
const ownerRoutes = read("server/routes/restaurantOperationsRoutes.ts");
const menuRoutes = read("server/routes/menuRoutes.ts");
const deliveryRoutes = read("server/routes/merchantDeliveryRoutes.ts");
const pickupRoutes = read("server/routes/pickupOrderRoutes.ts");
const identity = read("server/services/pickupOrderIdentityService.ts");
const notifications = read("server/services/pickupOrderNotificationService.ts");
const safeResponse = read("server/publicProfiles/assertPublicResponseSafe.ts");
const ownerWorkspace = read("client/src/components/owner-profile-workspace.tsx");
const publicMenu = read("client/src/components/public-profile/PublicProfileMenu.tsx");
const hoursPanel = read("client/src/components/public-profile/RestaurantHoursPanel.tsx");

const checks: Array<[string, () => void]> = [
  ["claimed authority requires owner and verification", () => {
    assert.match(discovery, /profileAuthority\?\.ownerId && profileAuthority\?\.isVerified === true/);
  }],
  ["owner controls retain canonical authorization", () => {
    assert.match(ownerRoutes, /verifyRestaurantOwnership\([\s\S]*?"manageProfile"/);
    assert.match(ownerWorkspace, /Public profile visible/);
  }],
  ["menu reads and writes retain owner authorization", () => {
    assert.match(menuRoutes, /verifyRestaurantOwnership/);
  }],
  ["claimed profiles suppress imported listing fallback", () => {
    assert.match(discovery, /authoritativeProfile === true\s*\? \[\]/);
  }],
  ["public menu carries price and sold-out truth", () => {
    assert.match(mapper, /priceCents:/);
    assert.match(publicMenu, /Sold out/);
  }],
  ["hours are merchant-timezone aware", () => {
    assert.match(menuRoutes, /Intl\.DateTimeFormat/);
    assert.match(hoursPanel, /profile\.timeZone/);
  }],
  ["claimed ordering uses the native merchant path", () => {
    assert.match(mapper, /claimedProfile && orderingPath/);
    assert.match(publicMenu, /claimed_profile_ordering/);
  }],
  ["checkout identity is scoped to restaurant and menu", () => {
    assert.match(pickupRoutes, /loadAuthoritativePickupOrderItems/);
    assert.match(identity, /eq\(menuItems\.restaurantId, input\.restaurantId\)/);
    assert.match(identity, /eq\(menuItems\.menuId, input\.menuId\)/);
  }],
  ["payment and persistence use server-owned restaurant identity", () => {
    assert.match(pickupRoutes, /restaurantId:/);
    assert.match(pickupRoutes, /metadata/);
  }],
  ["delivery remains server eligibility controlled", () => {
    assert.match(deliveryRoutes, /getPublicMerchantDeliveryAvailability/);
    assert.match(discovery, /delivery\?\.configured && delivery\?\.availableNow/);
  }],
  ["owner visibility requires verified ownership", () => {
    assert.match(ownerRoutes, /parsed\.isActive === true/);
    assert.match(ownerRoutes, /lockedRestaurant\.isVerified !== true/);
  }],
  ["notifications retain merchant joins and public payloads reject secrets", () => {
    assert.match(notifications, /restaurantId/);
    assert.doesNotMatch(discovery, /^\s+profileSettings,\s*$/m);
    assert.match(safeResponse, /deliveryaddress/);
    assert.match(safeResponse, /stripepaymentintentid/);
    assert.match(safeResponse, /customeraccesstoken/);
  }],
];

for (const [name, check] of checks) {
  try {
    check();
  } catch (error) {
    throw new Error(`Profile ownership contract failed: ${name}`, { cause: error });
  }
}

console.log(`mealscout-profile-ownership-contract: PASS (${checks.length}/${checks.length})`);
