import assert from "node:assert/strict";

import {
  isMenuItemCategoryOrderable,
  isMenuItemInventoryOrderable,
  isPickupOrderItemAvailableForExistingReservation,
  isRestaurantOrderingAuthorityReady,
  isRestaurantProfileOwnerReady,
  isTruckStopOrderableForPickup,
  isRestaurantOpenNow,
  isRestaurantMenuAvailableNow,
  isRestaurantPayoutReady,
  resolveFixedRestaurantPickupAddress,
  resolveRestaurantPaymentMethods,
} from "../server/services/restaurantOrderingEligibility";
import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";
import {
  buildPublicDirectionsUrl,
  resolvePublicCoordinatePair,
} from "../server/publicProfiles/publicProfileUtils";
import { toPublicRestaurantListing } from "../server/publicProfiles/toPublicRestaurantListing";
import {
  buildRestaurantOrderingAuthorityRevocation,
  buildRestaurantOwnerTransferReset,
  isPickupOrderBlockingRestaurantOwnerTransfer,
} from "../server/services/restaurantOrderingAuthorityReset";
import { isPickupInventoryReservationRestorable } from "../server/services/pickupInventoryService";
import { resolveRestaurantOwnershipInviteAction } from "../server/services/restaurantOwnerTransferSafety";

assert.deepEqual(buildRestaurantOrderingAuthorityRevocation(), {
  orderingApprovedAt: null,
  orderingApprovedByUserId: null,
  orderingApprovalEvidenceUrl: null,
  orderingApprovalReviewNote: null,
  pickupAcknowledgementMinutes: null,
});
assert.deepEqual(buildRestaurantOwnerTransferReset(), {
  orderingApprovedAt: null,
  orderingApprovedByUserId: null,
  orderingApprovalEvidenceUrl: null,
  orderingApprovalReviewNote: null,
  pickupAcknowledgementMinutes: null,
  stripeConnectAccountId: null,
  stripeConnectStatus: "pending",
  stripeOnboardingCompleted: false,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
});
assert.equal(
  resolveRestaurantOwnershipInviteAction({
    currentOwnerId: "merchant-owner",
    importSystemUserId: "import-owner",
    inviteUserId: "merchant-owner",
  }),
  "idempotent",
  "Re-sending an invite to the same owner must not disable or reset the merchant",
);
assert.equal(
  resolveRestaurantOwnershipInviteAction({
    currentOwnerId: "import-owner",
    importSystemUserId: "import-owner",
    inviteUserId: "merchant-owner",
  }),
  "transfer",
);
assert.equal(
  resolveRestaurantOwnershipInviteAction({
    currentOwnerId: "different-owner",
    importSystemUserId: "import-owner",
    inviteUserId: "merchant-owner",
  }),
  "conflict",
);
for (const status of [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "payment_disputed",
  "cancellation_pending",
  "unknown_future_status",
]) {
  assert.equal(
    isPickupOrderBlockingRestaurantOwnerTransfer(status),
    true,
    `${status} must block an ownership handoff`,
  );
}
for (const status of ["completed", "cancelled"]) {
  assert.equal(
    isPickupOrderBlockingRestaurantOwnerTransfer(status),
    false,
    `${status} is terminal for an ownership handoff`,
  );
}
assert.equal(
  isPickupInventoryReservationRestorable({
    merchantAcknowledgedAt: null,
    readyAt: null,
  }),
  true,
  "A cancelled reservation may return to stock before preparation begins",
);
assert.equal(
  isPickupInventoryReservationRestorable({
    merchantAcknowledgedAt: new Date("2026-08-23T12:05:00.000Z"),
  }),
  false,
  "Starting preparation consumes the reservation even if the order is later cancelled",
);
assert.equal(
  isPickupInventoryReservationRestorable({
    merchantAcknowledgedAt: null,
    readyAt: new Date("2026-08-23T12:15:00.000Z"),
  }),
  false,
  "Legacy ready-state evidence must fail stock restoration closed",
);

assert.equal(isMenuItemCategoryOrderable({ categoryId: null }), true);
assert.equal(
  isMenuItemCategoryOrderable({
    categoryId: "category-active",
    categoryActive: true,
  }),
  true,
);
assert.equal(
  isMenuItemCategoryOrderable({
    categoryId: "category-hidden",
    categoryActive: false,
  }),
  false,
  "An item hidden with its inactive category must never remain orderable",
);
assert.equal(
  isMenuItemCategoryOrderable({
    categoryId: "category-missing",
    categoryActive: null,
  }),
  false,
  "A broken category reference must fail ordering closed",
);
assert.equal(isMenuItemInventoryOrderable({ trackInventory: false }), true);
assert.equal(
  isMenuItemInventoryOrderable({ trackInventory: true, inventoryQty: 1 }),
  true,
);
for (const inventoryQty of [null, 0, -1, 1.5]) {
  assert.equal(
    isMenuItemInventoryOrderable({ trackInventory: true, inventoryQty }),
    false,
    `Tracked inventory ${String(inventoryQty)} must fail ordering closed`,
  );
}
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({ isAvailable: true }),
  true,
);
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({
    isAvailable: true,
    trackInventory: true,
    inventoryQty: null,
  }),
  false,
  "Missing tracked inventory cannot become orderable availability",
);
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({
    isAvailable: true,
    trackInventory: true,
    inventoryQty: 0,
  }),
  false,
  "Inconsistent zero tracked inventory must fail closed",
);
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({
    isAvailable: false,
    trackInventory: true,
    inventoryQty: 0,
    inventoryAutoUnavailable: true,
    inventoryReservedQuantity: 1,
  }),
  true,
  "A valid card order may settle after reserving the last tracked unit",
);
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({
    isAvailable: false,
    trackInventory: true,
    inventoryQty: 0,
    inventoryAutoUnavailable: true,
    inventoryReservedQuantity: 0,
  }),
  false,
  "An item switched from untracked to zero stock cannot borrow another order's reservation exception",
);
assert.equal(
  isPickupOrderItemAvailableForExistingReservation({
    isAvailable: false,
    trackInventory: true,
    inventoryQty: 0,
    inventoryAutoUnavailable: false,
  }),
  false,
  "An owner-disabled item must still fail settlement closed",
);
assert.equal(
  isRestaurantProfileOwnerReady({
    ownerId: "owner-real",
    ownerEmail: "merchant@example.com",
    isVerified: true,
  }),
  true,
);
assert.equal(
  isRestaurantProfileOwnerReady({
    ownerId: "owner-import",
    ownerEmail: "system-import@mealscout.us",
    isVerified: true,
  }),
  false,
  "A data-verified import is not a merchant-claimed ordering profile",
);

const approvedOrderingAuthority = {
  ownerId: "owner-real",
  ownerEmail: "merchant@example.com",
  ownerEmailVerified: true,
  ownerIsDisabled: false,
  isVerified: true,
  orderingApprovedAt: "2026-08-23T12:00:00.000Z",
  orderingApprovedByUserId: "admin-1",
};
assert.equal(
  isRestaurantOrderingAuthorityReady(approvedOrderingAuthority),
  true,
);
for (const [field, value] of [
  ["ownerEmailVerified", false],
  ["ownerIsDisabled", true],
  ["isVerified", false],
  ["orderingApprovedAt", null],
  ["orderingApprovedByUserId", null],
] as const) {
  assert.equal(
    isRestaurantOrderingAuthorityReady({
      ...approvedOrderingAuthority,
      [field]: value,
    }),
    false,
    `${field} must fail ordering authority closed`,
  );
}
assert.equal(
  isRestaurantOrderingAuthorityReady({
    ...approvedOrderingAuthority,
    ownerEmail: "system-import@mealscout.us",
  }),
  false,
  "A system import owner cannot receive ordering authority",
);
assert.equal(
  isTruckStopOrderableForPickup({
    status: "here_now",
    addressPublicLabel: "101 Main St, Pensacola, FL",
    directionsUrl:
      "https://maps.google.com/?q=101%20Main%20St%2C%20Pensacola%2C%20FL",
  }),
  true,
);
assert.equal(
  isTruckStopOrderableForPickup({
    status: "here_now",
    addressPublicLabel: "Pensacola, FL",
    directionsUrl: null,
  }),
  false,
  "A locality label without an actionable stop cannot enable truck pickup",
);
assert.equal(
  isTruckStopOrderableForPickup({
    status: "here_now",
    locationName: "Private stop",
    directionsUrl: null,
  }),
  false,
  "A hidden-address stop cannot enable pickup",
);

const fullyConnected = {
  stripeConnectAccountId: "acct_ready",
  stripeOnboardingCompleted: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
};

assert.equal(isRestaurantPayoutReady(fullyConnected), true);
for (const missing of [
  "stripeConnectAccountId",
  "stripeOnboardingCompleted",
  "stripeChargesEnabled",
  "stripePayoutsEnabled",
] as const) {
  assert.equal(
    isRestaurantPayoutReady({ ...fullyConnected, [missing]: null }),
    false,
    `${missing} must fail card payout readiness closed`,
  );
}

assert.deepEqual(
  resolveRestaurantPaymentMethods({
    acceptsCash: false,
    platformStripeConfigured: true,
    ...fullyConnected,
  }),
  { card: true, cash: false, payoutReady: true },
);
assert.deepEqual(
  resolveRestaurantPaymentMethods({
    acceptsCash: true,
    platformStripeConfigured: false,
  }),
  { card: false, cash: true, payoutReady: false },
  "Cash ordering must not pretend that card settlement is ready",
);
assert.equal(
  resolveRestaurantPaymentMethods({
    acceptsCash: false,
    platformStripeConfigured: false,
    ...fullyConnected,
  }).card,
  false,
  "A connected merchant cannot take cards when platform Stripe is unavailable",
);

const publicPickupRestaurant = {
  name: "Pickup Cafe",
  address: "101 Main St",
  city: "Pensacola",
  state: "FL",
};
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: publicPickupRestaurant,
    ownerPublicProfileSettings: { showAddress: true },
  }),
  "101 Main St, Pensacola, FL",
);
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: { address: "Main Street", city: "", state: "FL" },
    ownerPublicProfileSettings: { showAddress: true },
  }),
  null,
  "A street without a city is not an exact pickup destination",
);
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: { address: "101 Main St", city: "Pensacola", state: "" },
    ownerPublicProfileSettings: { showAddress: true },
  }),
  null,
  "A street without a state is not an exact pickup destination",
);
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: publicPickupRestaurant,
    ownerPublicProfileSettings: { showAddress: false },
  }),
  null,
  "A private profile address must not become a checkout pickup address",
);
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: {
      ...publicPickupRestaurant,
      rawData: {
        evidenceQuarantine: { active: true },
      },
    },
    ownerPublicProfileSettings: { showAddress: true },
  }),
  null,
  "A quarantined address must fail closed until accepted",
);
assert.equal(
  resolveFixedRestaurantPickupAddress({
    restaurant: {
      ...publicPickupRestaurant,
      rawData: {
        evidenceQuarantine: {
          active: true,
          decisions: { contact_address: { status: "accepted" } },
        },
      },
    },
    ownerPublicProfileSettings: { showAddress: true },
  }),
  "101 Main St, Pensacola, FL",
  "An explicitly accepted quarantined address may be published for pickup",
);

const overnightSundayMenu = {
  availableDays: ["sun"],
  availableFrom: "22:00",
  availableTo: "02:00",
};
const overnightSundayHours = {
  sun: [{ open: "22:00", close: "02:00" }],
};
assert.equal(
  isRestaurantOpenNow(
    { ...overnightSundayHours, mon: [] },
    "America/Chicago",
    new Date("2026-08-09T06:00:00.000Z"),
  ),
  false,
  "Sunday 1 AM is not inside a Sunday window that starts Sunday at 10 PM",
);
assert.equal(
  isRestaurantOpenNow(
    overnightSundayHours,
    "America/Chicago",
    new Date("2026-08-10T06:00:00.000Z"),
  ),
  true,
  "Monday 1 AM remains inside Sunday's overnight window",
);
assert.equal(
  isRestaurantOpenNow(
    { ...overnightSundayHours, mon: [] },
    "America/Chicago",
    new Date("2026-08-10T07:00:00.000Z"),
  ),
  false,
  "The exact closing minute is outside the half-open ordering window",
);
assert.equal(
  isRestaurantMenuAvailableNow(
    overnightSundayMenu,
    "UTC",
    new Date("2026-08-23T23:00:00.000Z"),
  ),
  true,
);
assert.equal(
  isRestaurantMenuAvailableNow(
    overnightSundayMenu,
    "UTC",
    new Date("2026-08-24T01:00:00.000Z"),
  ),
  true,
  "An overnight menu remains available after midnight on the prior service day",
);
assert.equal(
  isRestaurantMenuAvailableNow(
    overnightSundayMenu,
    "UTC",
    new Date("2026-08-24T02:00:00.000Z"),
  ),
  false,
  "Menu ordering closes at the advertised closing minute",
);
assert.equal(
  isRestaurantMenuAvailableNow(
    overnightSundayMenu,
    "UTC",
    new Date("2026-08-24T03:00:00.000Z"),
  ),
  false,
);
assert.equal(
  isRestaurantMenuAvailableNow(
    { ...overnightSundayMenu, availableFrom: "99:00" },
    "UTC",
    new Date("2026-08-23T23:00:00.000Z"),
  ),
  false,
  "Malformed ordering times must fail closed",
);

assert.equal(resolvePublicCoordinatePair(0, 0), null);
assert.equal(resolvePublicCoordinatePair(null, -87.2169), null);
assert.equal(resolvePublicCoordinatePair("", "-87.2169"), null);
assert.equal(resolvePublicCoordinatePair(true, -87.2169), null);
assert.deepEqual(resolvePublicCoordinatePair("30.4213", "-87.2169"), {
  latitude: 30.4213,
  longitude: -87.2169,
});

const publicListing = toPublicRestaurantListing(
  {
    id: "listing-1",
    name: "Listing Cafe",
    businessType: "restaurant",
    address: "101 Main St",
    city: "Pensacola",
    state: "FL",
    phone: "850-555-0100",
    websiteUrl: "https://example.com",
    latitude: "30.4213",
    longitude: "-87.2169",
    currentLatitude: true,
    currentLongitude: -87.2,
  },
  { showAddress: true, showContact: true },
);
assert.equal(publicListing.address, "101 Main St");
assert.equal(publicListing.phone, "850-555-0100");
assert.equal(publicListing.latitude, 30.4213);
assert.equal(publicListing.longitude, -87.2169);
assert.equal(publicListing.currentLatitude, null);
assert.equal(publicListing.currentLongitude, null);

const verifiedWithoutOrderingApproval = {
  id: "verified-browse-only",
  name: "Verified Browse Only Cafe",
  businessType: "restaurant",
  isVerified: true,
  orderingApprovedAt: null,
  orderingApprovedByUserId: null,
};
assert.equal(
  toPublicRestaurantListing(verifiedWithoutOrderingApproval).isVerified,
  true,
  "Evidence verification must remain public without ordering approval",
);
assert.equal(
  toPublicRestaurantProfile({
    row: verifiedWithoutOrderingApproval,
    baseUrl: "https://www.mealscout.us",
    profileType: "restaurant",
  }).verifiedProfile,
  true,
);

const staleOrderingApprovalAfterVerificationRevoked = {
  ...verifiedWithoutOrderingApproval,
  id: "unverified-stale-ordering-approval",
  isVerified: false,
  orderingApprovedAt: "2026-08-23T12:00:00.000Z",
  orderingApprovedByUserId: "admin-1",
};
assert.equal(
  toPublicRestaurantListing(staleOrderingApprovalAfterVerificationRevoked)
    .isVerified,
  false,
  "Stale ordering approval must not manufacture a verification badge",
);
assert.equal(
  toPublicRestaurantProfile({
    row: staleOrderingApprovalAfterVerificationRevoked,
    baseUrl: "https://www.mealscout.us",
    profileType: "restaurant",
  }).verifiedProfile,
  false,
);

const quarantinedVerifiedProfile = {
  ...verifiedWithoutOrderingApproval,
  id: "quarantined-verified-profile",
  address: "101 Hidden St",
  phone: "850-555-0199",
  websiteUrl: "https://quarantined.example.com",
  rawData: { evidenceQuarantine: { active: true } },
};
const quarantinedVerifiedListing = toPublicRestaurantListing(
  quarantinedVerifiedProfile,
  { showAddress: true, showContact: true },
);
assert.equal(quarantinedVerifiedListing.isVerified, false);
assert.equal(quarantinedVerifiedListing.address, null);
assert.equal(quarantinedVerifiedListing.phone, null);
assert.equal(quarantinedVerifiedListing.websiteUrl, null);
assert.equal(
  toPublicRestaurantProfile({
    row: quarantinedVerifiedProfile,
    baseUrl: "https://www.mealscout.us",
    profileType: "restaurant",
    showAddress: true,
    showContact: true,
  }).verifiedProfile,
  false,
  "Quarantined verification cannot remain public on any restaurant projector",
);

const privateListing = toPublicRestaurantListing(
  {
    id: "listing-private",
    name: "Private Cafe",
    businessType: "restaurant",
    address: "101 Main St",
    phone: "850-555-0100",
    websiteUrl: "https://example.com",
    latitude: 30.4213,
    longitude: -87.2169,
  },
  { showAddress: false, showContact: false },
);
assert.equal(privateListing.address, null);
assert.equal(privateListing.phone, null);
assert.equal(privateListing.websiteUrl, null);
assert.equal(privateListing.latitude, null);
assert.equal(privateListing.longitude, null);
assert.equal(
  buildPublicDirectionsUrl({ latitude: 0, longitude: 0 }),
  null,
  "The 0,0 sentinel must never create public directions",
);
assert.equal(
  buildPublicDirectionsUrl({
    latitude: 0,
    longitude: 0,
    addressPublicLabel: "101 Main St, Pensacola, FL",
  }),
  "https://maps.google.com/?q=101%20Main%20St%2C%20Pensacola%2C%20FL",
);

const zeroCoordinateRestaurant = toPublicRestaurantProfile({
  row: {
    id: "zero-coordinate-restaurant",
    name: "Address First Cafe",
    address: "101 Main St",
    city: "Pensacola",
    state: "FL",
    latitude: 0,
    longitude: 0,
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "restaurant",
});
assert.equal(zeroCoordinateRestaurant.latitude, null);
assert.equal(zeroCoordinateRestaurant.longitude, null);
assert.equal(
  zeroCoordinateRestaurant.cta.find((action) => action.type === "map")?.href,
  "https://maps.google.com/?q=101%20Main%20St%2C%20Pensacola%2C%20FL",
);

const cityOnlyRestaurant = toPublicRestaurantProfile({
  row: {
    id: "city-only-restaurant",
    name: "City Only Cafe",
    city: "Pensacola",
    state: "FL",
    latitude: 0,
    longitude: 0,
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "restaurant",
});
assert.equal(
  cityOnlyRestaurant.cta.some((action) => action.type === "map"),
  false,
  "A city label is not a customer pickup destination",
);

const disabledNativeOrdering = toPublicRestaurantProfile({
  row: {
    id: "disabled-native-ordering",
    name: "Browse Only Cafe",
    ownerId: "owner-1",
    isVerified: true,
    ordering: { path: "/menu/disabled-native-ordering", enabled: false },
    fulfillment: {
      pickup: { enabled: false },
      delivery: { enabled: false },
    },
  },
  baseUrl: "https://www.mealscout.us",
  profileType: "restaurant",
});
assert.equal(disabledNativeOrdering.ordering.path, null);
assert.equal(
  disabledNativeOrdering.cta.some((action) => action.label === "Order online"),
  false,
  "A browseable menu path must not become an order CTA while ordering is disabled",
);

console.log("MealScout ordering eligibility behavior: PASS");
