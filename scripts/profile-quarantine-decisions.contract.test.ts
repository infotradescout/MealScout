import assert from "node:assert/strict";
import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";

const baseUrl = "https://www.mealscout.us";
const baseRow = {
  id: "r-q-1",
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

const quarantinedNoDecision = toPublicRestaurantProfile({
  baseUrl,
  row: {
    ...baseRow,
    rawData: {
      evidenceIngest: {
        extracted: { business_name: "Island Kitchen" },
      },
    },
  },
});

assert.equal(quarantinedNoDecision.phonePublic, null);
assert.equal(quarantinedNoDecision.websiteUrl, null);
assert.equal(quarantinedNoDecision.verifiedProfile, false);

const rejectedPhone = toPublicRestaurantProfile({
  baseUrl,
  row: {
    ...baseRow,
    rawData: {
      evidenceIngest: {
        extracted: { business_name: "Island Kitchen" },
      },
      evidenceQuarantine: {
        decisions: {
          contact_phone: {
            status: "rejected",
            reason: "wrong phone",
          },
        },
      },
    },
  },
});

assert.equal(rejectedPhone.phonePublic, null);

const acceptedPhoneOnly = toPublicRestaurantProfile({
  baseUrl,
  row: {
    ...baseRow,
    rawData: {
      evidenceIngest: {
        extracted: { business_name: "Island Kitchen" },
      },
      evidenceQuarantine: {
        decisions: {
          contact_phone: {
            status: "accepted",
          },
        },
      },
    },
  },
});

assert.equal(acceptedPhoneOnly.phonePublic, "(850) 555-1111");
assert.equal(acceptedPhoneOnly.websiteUrl, null);
assert.equal(acceptedPhoneOnly.addressPublicLabel, null);
assert.equal(acceptedPhoneOnly.verifiedProfile, false);

const acceptedIdentity = toPublicRestaurantProfile({
  baseUrl,
  row: {
    ...baseRow,
    rawData: {
      evidenceIngest: {
        extracted: { business_name: "Island Kitchen" },
      },
      evidenceQuarantine: {
        decisions: {
          identity_verification: {
            status: "accepted",
          },
        },
      },
    },
  },
});

assert.equal(acceptedIdentity.verifiedProfile, true);
assert.equal(acceptedIdentity.websiteUrl, null);

console.log("profile-quarantine-decisions.contract: PASS");

