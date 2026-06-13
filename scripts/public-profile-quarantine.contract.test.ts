import assert from "node:assert/strict";
import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";

const baseRow = {
  id: "r1",
  name: "The Florida Kitchen - Island Cuisine",
  businessType: "food_truck",
  isFoodTruck: true,
  address: "123 Main St",
  city: "Pensacola",
  state: "FL",
  phone: "(850) 555-1111",
  websiteUrl: "https://floridakitchen.example",
  instagramUrl: "https://instagram.com/floridakitchen",
  facebookPageUrl: "https://facebook.com/floridakitchen",
  coverImageUrl: "https://cdn.example/cover.jpg",
  logoUrl: "https://cdn.example/logo.jpg",
  isVerified: true,
};

const quarantined = toPublicRestaurantProfile({
  baseUrl: "https://www.mealscout.us",
  row: {
    ...baseRow,
    rawData: {
      evidenceIngest: {
        extracted: {
          business_name: "Island Kitchen",
        },
      },
    },
  },
});

assert.equal(quarantined.verifiedProfile, false);
assert.equal(quarantined.phonePublic, null);
assert.equal(quarantined.addressPublicLabel, null);
assert.equal(quarantined.websiteUrl, null);
assert.equal(quarantined.logoUrl, null);
assert.equal(quarantined.coverImageUrl, null);
assert.equal(quarantined.socialLinks.instagramUrl, null);
assert.equal(quarantined.socialLinks.facebookPageUrl, null);

const mapsCta = quarantined.cta.find((cta) => cta.type === "map");
assert.equal(Boolean(mapsCta), false);

const phoneCta = quarantined.cta.find((cta) => cta.type === "phone");
assert.equal(Boolean(phoneCta), false);

const explicitTrusted = toPublicRestaurantProfile({
  baseUrl: "https://www.mealscout.us",
  row: {
    ...baseRow,
    rawData: {
      evidenceQuarantine: {
        status: "quarantined",
        allowPublicTrustFields: true,
      },
      profileLocations: {
        addressKind: "operating_location",
        customerFacingLocationSource: "owner_confirmed_operating_location",
      },
    },
  },
});

assert.equal(explicitTrusted.verifiedProfile, true);
assert.equal(explicitTrusted.phonePublic, "(850) 555-1111");
assert.equal(explicitTrusted.addressPublicLabel, "123 Main St, Pensacola, FL");

console.log("public-profile-quarantine.contract: PASS");
