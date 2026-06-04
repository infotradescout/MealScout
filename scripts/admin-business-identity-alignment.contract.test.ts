import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminUsersRoute = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);

const requiredDashboardSnippets = [
  "const toIdentityRole = (userType?: string | null) => {",
  "role:{toIdentityRole(user.userType)}",
  "attachment:",
  "business:{String(user.businessType || \"unknown\")}",
  "email:{user.emailVerified ? \"verified\" : \"unverified\"}",
  "user.businessIsVerified ? \"verified\" : \"pending\"",
  "adminApproved:",
  "<option value=\"restaurant_owner\">Restaurant Owner</option>",
  "<option value=\"food_truck\">Food Truck</option>",
  "<option value=\"duper_admin\">Duper Admin</option>",
  "data-testid={`button-create-business-shell-${user.id}`}",
  "value={String(user.businessType || \"restaurant\")}",
  "updateUserBusinessType.mutate({",
  "businessTypeOptions.map((option) => (",
];

const requiredRouteSnippets = [
  "restaurantId: restaurantByOwner.get(u.id)?.id || null,",
  "businessType: restaurantByOwner.get(u.id)?.businessType || null,",
  "businessIsVerified: restaurantByOwner.get(u.id)?.isVerified ?? null,",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin business identity UI snippet: ${snippet}`);
  }
}

for (const snippet of requiredRouteSnippets) {
  if (!adminUsersRoute.includes(snippet)) {
    throw new Error(`Missing admin business identity route snippet: ${snippet}`);
  }
}

console.log("admin-business-identity-alignment.contract: PASS");
