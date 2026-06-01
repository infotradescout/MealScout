import { readFileSync } from "node:fs";

const repoFile = readFileSync("server/storage/restaurantsDealsRepository.ts", "utf8");
const storageFile = readFileSync("server/storage.ts", "utf8");
const adminRoutesFile = readFileSync("server/adminRoutes.ts", "utf8");
const userAdminRoutesFile = readFileSync("server/routes/admin/userAdminRoutes.ts", "utf8");
const restaurantCardFile = readFileSync("client/src/components/restaurant-card.tsx", "utf8");

const requiredSnippets = [
  "const PROTECTED_IDENTITY_FIELDS = new Set([",
  "\"ownerId\"",
  "\"businessType\"",
  "\"isFoodTruck\"",
  "\"isActive\"",
  "\"isVerified\"",
  "function preserveCanonicalBusinessIdentity(",
  "options?: { allowIdentityChange?: boolean }",
  "const safePatch = preserveCanonicalBusinessIdentity(",
  "options?.allowIdentityChange === true",
  "return this.restaurantsDealsRepository.updateRestaurant(id, restaurant, options);",
  "allowIdentityChange: true",
  "restaurant.isFoodTruck ? 'border-orange-200 hover:border-orange-300' : 'border-border'",
];

const forbiddenSnippets = [
  "...restaurant,\n          updatedAt: new Date(),",
];

for (const snippet of requiredSnippets) {
  const found =
    repoFile.includes(snippet) ||
    storageFile.includes(snippet) ||
    adminRoutesFile.includes(snippet) ||
    userAdminRoutesFile.includes(snippet) ||
    restaurantCardFile.includes(snippet);
  if (!found) {
    throw new Error(`Missing canonical-preservation snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (repoFile.includes(snippet)) {
    throw new Error(`Found unsafe direct patch snippet: ${snippet}`);
  }
}

console.log("canonical-business-update-preservation.contract: PASS");

