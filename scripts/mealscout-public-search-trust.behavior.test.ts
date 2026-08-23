import assert from "node:assert/strict";

import {
  buildPublicRestaurantSearchSuggestions,
  filterProjectedPublicNearbyRestaurantRows,
  filterProjectedRestaurantSearchRows,
  rankPublicRestaurantSearchRows,
} from "../server/services/publicRestaurantSearchProjection";
import { toPublicRestaurantListing } from "../server/publicProfiles/toPublicRestaurantListing";
import { projectPublicLocalMenuItemRow } from "../server/services/publicLocalMenuItemProjection";
import { resolvePublicHostProximityCoordinates } from "../server/services/publicHostProximityProjection";
import { projectPublicDealRow } from "../server/services/publicDealRowProjection";

const ownerVisibility = new Map([
  ["owner-public", { showAddress: true, showContact: true }],
  ["owner-private", { showAddress: false, showContact: false }],
]);

const quarantined = {
  id: "quarantined-search-result",
  ownerId: "owner-public",
  name: "Quarantine Cafe",
  cuisineType: "Cafe",
  address: "919 Secret Evidence Street",
  city: "Pensacola",
  state: "FL",
  description: "Neighborhood breakfast",
  logoUrl: "https://cdn.example.invalid/quarantine-logo.jpg",
  coverImageUrl: "https://cdn.example.invalid/quarantine-cover.jpg",
  businessType: "restaurant",
  isFoodTruck: false,
  isActive: true,
  isVerified: true,
  homeRankingScore: 10_000,
  rawData: { evidenceQuarantine: { active: true } },
  latitude: "30.42130000",
  longitude: "-87.21690000",
};

const [quarantinedResult] = rankPublicRestaurantSearchRows(
  [quarantined],
  "quarantine",
  ownerVisibility,
);
assert.ok(quarantinedResult);
assert.equal(quarantinedResult.isVerified, false);
assert.equal(quarantinedResult.address, null);
assert.equal(quarantinedResult.logoUrl, null);
assert.equal(quarantinedResult.coverImageUrl, null);
const quarantinedListing = toPublicRestaurantListing(
  quarantined,
  ownerVisibility.get("owner-public")!,
);
assert.equal(quarantinedListing.latitude, null);
assert.equal(quarantinedListing.longitude, null);
assert.equal(
  rankPublicRestaurantSearchRows(
    [quarantined],
    "secret evidence street",
    ownerVisibility,
  ).length,
  0,
  "A quarantined address cannot match or rank a public restaurant result",
);

const privateAddress = {
  ...quarantined,
  id: "private-address-search-result",
  ownerId: "owner-private",
  name: "Private Address Cafe",
  address: "717 Hidden Owner Lane",
  isVerified: true,
  rawData: null,
};
const [privateResult] = rankPublicRestaurantSearchRows(
  [privateAddress],
  "private address cafe",
  ownerVisibility,
);
assert.ok(privateResult);
assert.equal(privateResult.address, null);
assert.equal(privateResult.isVerified, true);
const privateListing = toPublicRestaurantListing(
  privateAddress,
  ownerVisibility.get("owner-private")!,
);
assert.equal(
  filterProjectedRestaurantSearchRows([privateListing], {
    query: "hidden owner lane",
  }).length,
  0,
  "The restaurant search endpoint cannot match a hidden address after projection",
);
assert.equal(
  filterProjectedRestaurantSearchRows([privateListing], {
    query: "private address cafe",
    userLat: 30.4213,
    userLng: -87.2169,
    radiusKm: 5,
  }).length,
  0,
  "A hidden coordinate cannot affect proximity membership",
);
assert.equal(
  filterProjectedRestaurantSearchRows([privateListing], {
    query: "private address cafe",
    userLat: 0,
    userLng: 0,
    radiusKm: 5,
  }).length,
  0,
  "A masked null coordinate must not coerce to the real 0,0 coordinate",
);
assert.equal(
  filterProjectedPublicNearbyRestaurantRows([privateListing], {
    userLat: 30.4213,
    userLng: -87.2169,
    radiusKm: 5,
  }).length,
  0,
  "Every public nearby lane must exclude owner-private coordinates before membership",
);
assert.equal(
  filterProjectedPublicNearbyRestaurantRows([quarantinedListing], {
    userLat: 30.4213,
    userLng: -87.2169,
    radiusKm: 5,
  }).length,
  0,
  "Every public nearby lane must exclude quarantined coordinates before membership",
);
const publicNearbyListing = toPublicRestaurantListing(
  {
    ...privateAddress,
    id: "public-nearby",
    ownerId: "owner-public",
    name: "Public Nearby Cafe",
    phone: "850-555-0100",
  },
  ownerVisibility.get("owner-public")!,
);
assert.equal(
  filterProjectedPublicNearbyRestaurantRows([publicNearbyListing], {
    userLat: 30.4213,
    userLng: -87.2169,
    radiusKm: 5,
  }).length,
  1,
  "A canonically public coordinate remains eligible for nearby discovery",
);
assert.equal(
  resolvePublicHostProximityCoordinates({
    latitude: 30.4213,
    longitude: -87.2169,
    publicProfileSettings: { showAddress: false },
  }),
  null,
  "A private host address cannot participate in event or Parking Pass proximity",
);
assert.deepEqual(
  resolvePublicHostProximityCoordinates({
    latitude: 30.4213,
    longitude: -87.2169,
    publicProfileSettings: { showAddress: true },
  }),
  { latitude: 30.4213, longitude: -87.2169 },
);
const privateDeal = projectPublicDealRow(
  {
    id: "deal-private-location",
    restaurantId: privateAddress.id,
    title: "Private-location special",
    description: "Public deal copy",
    dealType: "percentage",
    discountValue: "10.00",
    imageUrl: "/deal.jpg",
    restaurantData: { address: privateAddress.address },
    secretSettlementNote: "never-public",
  },
  privateListing,
);
assert.equal(privateDeal.restaurant.address, null);
assert.equal(privateDeal.restaurant.phone, null);
assert.equal(privateDeal.restaurant.latitude, null);
assert.equal(privateDeal.restaurant.longitude, null);
assert.equal("restaurantData" in privateDeal, false);
assert.equal("secretSettlementNote" in privateDeal, false);
assert.equal("distance" in privateDeal, false);
assert.equal(
  buildPublicRestaurantSearchSuggestions(
    [quarantined],
    "secret evidence",
    ownerVisibility,
  ).length,
  0,
  "Typeahead cannot reveal a quarantined address fragment",
);
const quarantinedSuggestions = buildPublicRestaurantSearchSuggestions(
  [quarantined],
  "quarantine",
  ownerVisibility,
);
assert.equal(quarantinedSuggestions.length, 1);
assert.equal(quarantinedSuggestions[0].subtitle, "Cafe");
assert.equal(
  buildPublicRestaurantSearchSuggestions(
    [privateAddress],
    "hidden owner lane",
    ownerVisibility,
  ).length,
  0,
  "Typeahead cannot reveal an owner-private address fragment",
);

const projectedPrivateDish = projectPublicLocalMenuItemRow(
  {
    id: "dish-private-location",
    name: "Breakfast plate",
    description: "Eggs and toast",
    priceCents: 1200,
    itemType: "food",
    imageUrl: null,
    dietaryTags: [],
    updatedAt: new Date("2026-08-23T12:00:00.000Z"),
    restaurantId: privateAddress.id,
    restaurantOwnerId: privateAddress.ownerId,
    restaurantName: privateAddress.name,
    restaurantAddress: privateAddress.address,
    restaurantCity: privateAddress.city,
    restaurantState: privateAddress.state,
    restaurantLogoUrl: privateAddress.logoUrl,
    restaurantCoverImageUrl: privateAddress.coverImageUrl,
    cuisineType: privateAddress.cuisineType,
    restaurantLatitude: privateAddress.latitude,
    restaurantLongitude: privateAddress.longitude,
    restaurantIsActive: true,
    restaurantIsVerified: true,
    restaurantRawData: null,
    isFoodTruck: false,
    businessType: "restaurant",
    rankingScore: 9999,
  },
  ownerVisibility.get("owner-private")!,
);
assert.ok(projectedPrivateDish);
assert.equal(projectedPrivateDish.publicRow.restaurantLatitude, null);
assert.equal(projectedPrivateDish.publicRow.restaurantLongitude, null);
assert.equal(projectedPrivateDish.publicRow.restaurantLogoUrl, privateAddress.logoUrl);
assert.equal("rankingScore" in projectedPrivateDish.publicRow, false);
assert.equal("restaurantOwnerId" in projectedPrivateDish.publicRow, false);
assert.equal("restaurantRawData" in projectedPrivateDish.publicRow, false);

const projectedQuarantinedDish = projectPublicLocalMenuItemRow(
  {
    id: "dish-quarantined-location",
    name: "Secret sandwich",
    restaurantId: quarantined.id,
    restaurantOwnerId: quarantined.ownerId,
    restaurantName: quarantined.name,
    restaurantAddress: quarantined.address,
    restaurantCity: quarantined.city,
    restaurantState: quarantined.state,
    restaurantLogoUrl: quarantined.logoUrl,
    restaurantCoverImageUrl: quarantined.coverImageUrl,
    cuisineType: quarantined.cuisineType,
    restaurantLatitude: quarantined.latitude,
    restaurantLongitude: quarantined.longitude,
    restaurantIsActive: true,
    restaurantIsVerified: true,
    restaurantRawData: quarantined.rawData,
    isFoodTruck: false,
    businessType: "restaurant",
  },
  ownerVisibility.get("owner-public")!,
);
assert.ok(projectedQuarantinedDish);
assert.equal(projectedQuarantinedDish.publicRow.restaurantLatitude, null);
assert.equal(projectedQuarantinedDish.publicRow.restaurantLongitude, null);
assert.equal(projectedQuarantinedDish.publicRow.restaurantLogoUrl, null);
assert.equal(projectedQuarantinedDish.publicRow.restaurantCoverImageUrl, null);

console.log("MealScout public search trust projection: PASS");
