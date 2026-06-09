import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { toPublicTruckProfile } from "../server/publicProfiles/toPublicTruckProfile";
import {
  buildTruckProfileLocationEvidence,
  CUSTOMER_FACING_TRUCK_LOCATION_SOURCES,
  isThreeDEatsStaticAdminAddress,
  THREE_D_EATS_STATIC_ADMIN_ADDRESS,
} from "../server/utils/truckLocationSemantics";

const profile = toPublicTruckProfile({
  baseUrl: "https://mealscout.test",
  row: {
    id: "truck-1",
    ownerId: "owner-1",
    name: "3D Eats",
    address: THREE_D_EATS_STATIC_ADMIN_ADDRESS,
    city: "Pensacola",
    state: "FL",
    latitude: "30.37100000",
    longitude: "-87.34100000",
    businessType: "food_truck",
    isFoodTruck: true,
    isActive: true,
    rawData: {
      profileLocations: buildTruckProfileLocationEvidence({
        businessName: "3D Eats",
        address: THREE_D_EATS_STATIC_ADMIN_ADDRESS,
        serviceArea: "Pensacola",
      }),
    },
  },
});

assert.equal(
  isThreeDEatsStaticAdminAddress({
    name: "3D Eats",
    address: THREE_D_EATS_STATIC_ADMIN_ADDRESS,
  }),
  true,
  "3D Eats 6881 US 98 E address must classify as static/admin candidate",
);
assert.equal(
  isThreeDEatsStaticAdminAddress({
    name: "3D Eats & Tea",
    address: THREE_D_EATS_STATIC_ADMIN_ADDRESS,
  }),
  true,
  "3D Eats & Tea 6881 US 98 E address must classify as static/admin candidate",
);
assert.equal(profile.addressPublicLabel, null);
assert.equal(profile.latitude, null);
assert.equal(profile.longitude, null);
assert.equal(
  profile.cta.some((cta) => cta.type === "map" && cta.href),
  false,
  "static/admin truck coordinates must not create public directions CTA",
);

const confirmedProfile = toPublicTruckProfile({
  baseUrl: "https://mealscout.test",
  row: {
    id: "truck-2",
    ownerId: "owner-2",
    name: "Confirmed Truck",
    address: "222 W Main St, Pensacola, FL 32502",
    city: "Pensacola",
    state: "FL",
    latitude: "30.40700000",
    longitude: "-87.21500000",
    businessType: "food_truck",
    isFoodTruck: true,
    isActive: true,
    rawData: {
      profileLocations: {
        addressKind: "operating_location",
        customerFacingLocationSource: "owner_confirmed_operating_location",
      },
    },
  },
});

assert.ok(
  confirmedProfile.addressPublicLabel?.includes("222 W Main St"),
  "approved operating location should expose its public address label",
);
assert.equal(confirmedProfile.latitude, 30.407);
assert.equal(confirmedProfile.longitude, -87.215);

for (const source of [
  "active_schedule_stop",
  "upcoming_scheduled_stop",
  "owner_confirmed_operating_location",
  "event_booking_location",
  "verified_live_location_update",
]) {
  assert.ok(
    CUSTOMER_FACING_TRUCK_LOCATION_SOURCES.includes(source as any),
    `${source} must remain an approved customer-facing truck location source`,
  );
}

const bulkIngest = readFileSync("scripts/mealscout-bulk-truck-ingest.ts", "utf8");
for (const snippet of [
  "buildTruckProfileLocationEvidence",
  "profileLocations",
  "record.address || \"Unknown\"",
]) {
  assert.ok(bulkIngest.includes(snippet), `bulk ingest missing ${snippet}`);
}
assert.ok(
  !bulkIngest.includes("record.address || record.serviceArea || \"Unknown\""),
  "bulk ingest must not promote service area to static street address",
);

const semantics = readFileSync("server/utils/truckLocationSemantics.ts", "utf8");
for (const snippet of [
  "businessAdminAddress",
  "operatingLocation",
  "serviceArea",
  "market",
  "addressPublicByDefault: false",
  "menuPageAddressCandidateOnly: true",
]) {
  assert.ok(semantics.includes(snippet), `location semantics missing ${snippet}`);
}

const parser = readFileSync("server/utils/truckImport.ts", "utf8");
for (const snippet of [
  "businessAdminAddress",
  "operatingLocationAddress",
  "serviceArea",
  "\"menu address\"",
  "\"scheduled stop\"",
  "\"primary market\"",
]) {
  assert.ok(parser.includes(snippet), `truck import parser missing ${snippet}`);
}

const adminRoutes = readFileSync("server/routes/admin/truckImportAdminRoutes.ts", "utf8");
for (const snippet of [
  "buildTruckProfileLocationEvidence",
  "truckLocationAmbiguity",
  "lastTruckLocationClassificationAt",
]) {
  assert.ok(adminRoutes.includes(snippet), `admin import route missing ${snippet}`);
}

console.log("food-truck-location-separation.contract: PASS");
