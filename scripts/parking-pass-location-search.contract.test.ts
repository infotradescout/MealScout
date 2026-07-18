import assert from "node:assert/strict";
import {
  normalizeParkingPassLocationSearch,
  parkingPassLocationMatches,
} from "../client/src/lib/parkingPassSearch";

assert.equal(
  normalizeParkingPassLocationSearch(" Pensacola,   FL "),
  "pensacola fl",
  "City and state punctuation must not change the search meaning.",
);

assert.equal(
  normalizeParkingPassLocationSearch("Pensacola, Florida"),
  "pensacola fl",
  "Florida and FL must use the same canonical search form.",
);

assert.equal(
  parkingPassLocationMatches("Pensacola, FL", [
    "Pensacola",
    "Florida",
    "123 Main Street",
    "Example Host",
  ]),
  true,
  "An auto-filled Pensacola, FL query must match structured Pensacola Florida data.",
);

assert.equal(
  parkingPassLocationMatches("Pensacola, FL", [
    null,
    null,
    "6881 US 98 E, Pensacola, FL 32506",
    "Address-only Host",
  ]),
  true,
  "Address-only hosts must remain discoverable by city and state.",
);

assert.equal(
  parkingPassLocationMatches("Pensacola, FL", [
    "Crestview",
    "FL",
    "100 Main Street",
    "Other Host",
  ]),
  false,
  "Every query token must match so other Florida cities stay out of Pensacola results.",
);

console.log("parking-pass-location-search.contract: PASS");
