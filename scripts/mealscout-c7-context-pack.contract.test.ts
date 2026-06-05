import { existsSync, readFileSync } from "node:fs";

const contextPath = "MEALSCOUT_C7_OWNER_DASHBOARD_CONTEXT.md";
const contractPath = "scripts/mealscout-c7-context-pack.contract.test.ts";

const requiredFiles = [
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "client/src/pages/parking-pass.tsx",
  "client/src/pages/menu-builder.tsx",
  "client/src/pages/online-menu.tsx",
  "client/src/pages/dashboard-router.tsx",
  "client/src/components/dashboard-switcher.tsx",
  "client/src/hooks/useAuth.ts",
  "server/routes/restaurantOperationsRoutes.ts",
  "server/routes/restaurantCoreRoutes.ts",
  "server/routes/menuRoutes.ts",
  "server/routes/restaurantSignupRoutes.ts",
  "server/services/loginContinuation.ts",
  "MEALSCOUT_HANDOFF_SPINE.md",
  "MEALSCOUT_ROUTE_MAP.md",
  "MEALSCOUT_ADMIN_DASHBOARD_DECOMPOSITION_MAP.md",
  "CLEANUP_MAP.md",
];

if (!existsSync(contextPath)) {
  throw new Error("MEALSCOUT_C7_OWNER_DASHBOARD_CONTEXT.md must exist.");
}

const context = readFileSync(contextPath, "utf8");
const contract = readFileSync(contractPath, "utf8");
const headerPattern =
  /================================================================================\r?\nFILE: (.+?)\r?\n================================================================================/g;
const headers = [...context.matchAll(headerPattern)].map((match) => match[1]);

if (headers.length !== requiredFiles.length) {
  throw new Error(`Expected ${requiredFiles.length} file headers, found ${headers.length}.`);
}

for (let index = 0; index < requiredFiles.length; index += 1) {
  if (headers[index] !== requiredFiles[index]) {
    throw new Error(
      `Context file header ${index + 1} must be ${requiredFiles[index]}, found ${
        headers[index] ?? "missing"
      }.`,
    );
  }
}

const unexpectedHeaders = headers.filter((header) => !requiredFiles.includes(header));
if (unexpectedHeaders.length > 0) {
  throw new Error(`Unexpected file headers found: ${unexpectedHeaders.join(", ")}`);
}

function sectionFor(file: string) {
  const header = `================================================================================\nFILE: ${file}\n================================================================================`;
  const normalized = context.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(header);
  if (start === -1) {
    throw new Error(`Missing section header for ${file}.`);
  }
  const contentStart = start + header.length;
  const nextHeader = normalized.indexOf(
    "================================================================================\nFILE: ",
    contentStart,
  );
  return normalized.slice(contentStart, nextHeader === -1 ? undefined : nextHeader);
}

for (const file of requiredFiles) {
  const section = sectionFor(file);
  if (!existsSync(file)) {
    if (!section.includes("FILE NOT FOUND IN CURRENT CHECKOUT")) {
      throw new Error(`Missing file ${file} must be marked FILE NOT FOUND IN CURRENT CHECKOUT.`);
    }
  }
}

if (!sectionFor("client/src/pages/restaurant-owner-dashboard.tsx").includes("RestaurantOwnerDashboard")) {
  throw new Error("Context document must include restaurant-owner-dashboard.tsx contents.");
}

if (!sectionFor("client/src/pages/parking-pass.tsx").includes("ParkingPassPage")) {
  throw new Error("Context document must include parking-pass.tsx contents.");
}

if (!sectionFor("CLEANUP_MAP.md").includes("MealScout Cleanup Map")) {
  throw new Error("Context document must include CLEANUP_MAP.md contents.");
}

const forbiddenWriteCalls = [
  ["write", "FileSync"].join(""),
  ["append", "FileSync"].join(""),
  ["rm", "Sync"].join(""),
  ["unlink", "Sync"].join(""),
];

if (!contract.includes("readFileSync") || forbiddenWriteCalls.some((call) => contract.includes(call))) {
  throw new Error("Context pack contract must remain read-only and not require runtime app changes.");
}

const contextWithoutRawSources = context
  .split(/\r?\n/)
  .filter((line) => line.startsWith("FILE: ") || line === "FILE NOT FOUND IN CURRENT CHECKOUT")
  .join("\n");

if (
  /(new product feature|new route|new role|new payment|new payout|fake contractor|fake analytics|placeholder record)/i.test(
    contextWithoutRawSources,
  )
) {
  throw new Error("Context pack metadata must not introduce product feature scope or fake data.");
}

console.log("mealscout-c7-context-pack.contract: PASS");
