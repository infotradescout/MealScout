import assert from "node:assert/strict";
import { reconcileBusinessIdentity } from "../server/imports/businessIdentityReconciliation";

const canonical = {
  name: "3D Eats & Tea",
  city: "Pensacola",
  state: "FL",
  website: "https://3deats.com",
};

assert.equal(
  reconcileBusinessIdentity(
    { name: "3-D Eats & Tea", city: "Pensacola", state: "FL" },
    canonical,
  ).disposition,
  "canonical_match",
  "punctuation variants must reuse the canonical business",
);

assert.equal(
  reconcileBusinessIdentity(
    { name: "Sweet Love", website: "https://wrong-nail-salon.example" },
    { name: "Wrong Nail Salon", website: "https://wrong-nail-salon.example" },
  ).disposition,
  "review_required",
  "a Google/website identifier cannot override a conflicting business name",
);

assert.equal(
  reconcileBusinessIdentity(
    { name: "Florida Kitchen Island Cuisine", city: "Pensacola", state: "FL" },
    { name: "Florida Kitchen Island Cuisine", city: "Pensacola", state: "FL" },
  ).disposition,
  "canonical_match",
  "exact business and market identity must not create a duplicate",
);

assert.equal(
  reconcileBusinessIdentity(
    { name: "Actually New Truck", city: "Pensacola", state: "FL" },
    canonical,
  ).disposition,
  "new_identity",
);

console.log("business-identity-reconciliation.behavior: PASS");

