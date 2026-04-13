import fs from "node:fs";
import path from "node:path";

const targetPath = path.join(
  process.cwd(),
  "server",
  "routes",
  "pickupOrderRoutes.ts",
);

function assertContains(content: string, pattern: RegExp, message: string) {
  if (!pattern.test(content)) {
    throw new Error(message);
  }
}

function run() {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing target file: ${targetPath}`);
  }

  const content = fs.readFileSync(targetPath, "utf8");

  // Guard 1: helper must accept optional restaurant scope.
  assertContains(
    content,
    /async\s+function\s+assertHasOrderingSubscription\s*\([\s\S]*?restaurantId\?:\s*string[\s\S]*?\)/m,
    "assertHasOrderingSubscription must accept restaurantId?: string",
  );

  // Guard 2: helper must filter owner restaurants by the provided restaurantId.
  assertContains(
    content,
    /const\s+restaurantIds\s*=\s*restaurantId[\s\S]*?restaurants_\.filter\(\(r\)\s*=>\s*r\.id\s*===\s*restaurantId\)[\s\S]*?:\s*restaurants_\.map\(\(r\)\s*=>\s*r\.id\)/m,
    "Subscription helper must scope restaurantIds to the provided restaurantId",
  );

  // Guard 3: critical endpoints must pass restaurantId into the helper.
  assertContains(
    content,
    /assertHasOrderingSubscription\(req\.user\.id,\s*restaurantId\)/m,
    "Owner list endpoints must pass restaurantId to assertHasOrderingSubscription",
  );

  assertContains(
    content,
    /assertHasOrderingSubscription\(req\.user\.id,\s*order\.restaurantId\)/m,
    "Owner status update endpoint must pass order.restaurantId to assertHasOrderingSubscription",
  );

  assertContains(
    content,
    /assertHasOrderingSubscription\(restaurant\.ownerId,\s*restaurant\.id\)/m,
    "Customer order creation must verify subscription against restaurant.id",
  );

  console.log(
    "[ordering-scope-test] PASS: restaurant-scoped ordering gate is enforced",
  );
}

try {
  run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ordering-scope-test] FAIL: ${message}`);
  process.exit(1);
}
