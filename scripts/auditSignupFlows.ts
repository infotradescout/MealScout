import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

type Check = {
  name: string;
  run: () => void;
};

const checks: Check[] = [
  {
    name: "Diner email signup endpoint exists",
    run: () => {
      const source = read("server/unifiedAuth.ts");
      assert.match(source, /app\.post\("\/api\/auth\/customer\/register"/);
      assert.match(source, /"customer"/);
      assert.match(source, /requiresEmailVerification:\s*true/);
    },
  },
  {
    name: "Business signup supports restaurant, bar, and food truck roles",
    run: () => {
      const source = read("server/unifiedAuth.ts");
      assert.match(source, /app\.post\("\/api\/auth\/restaurant\/register"/);
      assert.match(source, /"restaurant",\s*"bar",\s*"food_truck"/);
      assert.match(source, /normalizedBusinessType === "food_truck"\s*\?\s*"food_truck"\s*:\s*"restaurant_owner"/);
    },
  },
  {
    name: "Event organizer email signup endpoint creates event_coordinator users",
    run: () => {
      const source = read("server/unifiedAuth.ts");
      assert.match(source, /app\.post\("\/api\/auth\/event-coordinator\/register"/);
      assert.match(source, /"event_coordinator"/);
      assert.match(source, /"event coordinator"/);
    },
  },
  {
    name: "Supplier email signup endpoint exists",
    run: () => {
      const source = read("server/unifiedAuth.ts");
      assert.match(source, /app\.post\("\/api\/auth\/supplier\/register"/);
      assert.match(source, /"supplier"/);
    },
  },
  {
    name: "Customer signup UI routes account types to role-specific endpoints",
    run: () => {
      const source = read("client/src/pages/customer-signup.tsx");
      assert.match(source, /\/api\/auth\/customer\/register/);
      assert.match(source, /\/api\/auth\/restaurant\/register/);
      assert.match(source, /\/api\/auth\/event-coordinator\/register/);
      assert.match(source, /\/api\/auth\/supplier\/register/);
      assert.match(source, /setBusinessSubType\("bar"\)/);
      assert.match(source, /businessType:\s*businessSubType/);
    },
  },
  {
    name: "Restaurant onboarding accepts bar deep links",
    run: () => {
      const source = read("client/src/pages/restaurant-signup.tsx");
      assert.match(source, /businessType === "bar"/);
      assert.match(source, /z\.enum\(\["restaurant", "bar", "food_truck"\]/);
    },
  },
  {
    name: "Host first action promotes customers to host role",
    run: () => {
      const source = read("server/routes/hosts/profileRoutes.ts");
      assert.match(source, /updateUserType\(userId, "host"\)/);
      assert.match(source, /ensureDraftParkingPassForHost/);
    },
  },
  {
    name: "Event request flow promotes customer accounts to event_coordinator",
    run: () => {
      const source = read("server/routes/eventRoutes.ts");
      assert.match(source, /updateUserType\(\s*req\.user\.id,\s*"event_coordinator"/);
      assert.match(source, /event_coordinator_request_created/);
    },
  },
];

let failed = 0;

for (const check of checks) {
  try {
    check.run();
    console.log(`[PASS] ${check.name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`[FAIL] ${check.name}: ${error?.message || error}`);
  }
}

if (failed > 0) {
  console.error(`Signup flow audit failed: ${failed}`);
  process.exit(1);
}

console.log("Signup flow audit passed.");
