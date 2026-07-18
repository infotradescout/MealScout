import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  computeHostProfileQualityFlags,
  getParkingPassBlockingQualityFlags,
  isHostProfileMapEligible,
  isParkingPassPublicReady,
} from "../server/services/parkingPassQuality";

const uniqueBoutique = {
  businessName: "The Unique Boutique",
  address: "101 S Jefferson St",
  city: "Pensacola",
  state: "FL",
};

assert.equal(
  computeHostProfileQualityFlags(uniqueBoutique).includes(
    "suspicious_business_name",
  ),
  false,
  "Normal multi-word business names must not be mistaken for gibberish.",
);
assert.equal(
  isHostProfileMapEligible(uniqueBoutique),
  true,
  "A real host with a usable identity and address must remain map-eligible.",
);

const priorStripeSecret = process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;

const pricedHost = {
  host: {
    address: "101 S Jefferson St",
    city: "Pensacola",
    state: "FL",
    latitude: null,
    longitude: null,
    spotCount: 1,
  },
  startTime: "11:00",
  endTime: "14:00",
  maxTrucks: 1,
  lunchPriceCents: 4500,
};

assert.deepEqual(
  getParkingPassBlockingQualityFlags(pricedHost),
  [],
  "Local Stripe configuration and best-effort coordinates must not hide priced inventory.",
);
assert.equal(
  isParkingPassPublicReady(pricedHost),
  true,
  "Public readiness must follow one canonical address-and-price rule.",
);

if (priorStripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
else process.env.STRIPE_SECRET_KEY = priorStripeSecret;

const integritySource = readFileSync(
  "server/services/parkingPassIntegrity.ts",
  "utf8",
);
const eventRouteSource = readFileSync("server/routes/eventRoutes.ts", "utf8");
const pageSource = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const hostRouteSource = readFileSync("server/routes/hostRoutes.ts", "utf8");
const hostEventRouteSource = readFileSync(
  "server/routes/hosts/eventsRoutes.ts",
  "utf8",
);

assert.match(
  integritySource,
  /const publicReady = isParkingPassPublicReady\(listing as any\)/,
  "Integrity repair must use the same publication rule as the public feed.",
);
assert.match(
  eventRouteSource,
  /sql`\$\{users\.isDisabled\} is not true`/,
  "Public Parking Pass inventory must exclude disabled host accounts.",
);
assert.match(
  eventRouteSource,
  /getParkingPassBlockingQualityFlags\(event\)/,
  "Admin trace must report the canonical blocking flags, not diagnostic-only flags.",
);
assert.match(
  pageSource,
  /apiUrl\(isAdminOrStaff \? "\/api\/admin\/hosts" : "\/api\/hosts"\)/,
  "Admin must load the full active host inventory rather than owner-only hosts.",
);
assert.match(
  pageSource,
  /it must never silently\s*\n\s*\/\/ remove valid inventory/,
  "Location search must rank inventory without hiding valid host locations.",
);
assert.match(
  pageSource,
  /const adminSetupPins = useMemo/,
  "Real incomplete hosts must remain visible to admin as setup pins.",
);
assert.match(
  pageSource,
  /host locations · \{locationGroups\.length\} bookable/,
  "The map controls must expose total, bookable, and incomplete host truth.",
);
assert.match(
  hostRouteSource,
  /const canManageHost = \(user: any, host: any\)/,
  "Host profile management must share the super-admin bypass.",
);
assert.match(
  hostEventRouteSource,
  /const canManageHost = \(user: any, host: any\)/,
  "Parking availability management must share the super-admin bypass.",
);

console.log("parking-pass-canonical-readiness.contract: PASS");
