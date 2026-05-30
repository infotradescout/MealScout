import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  businessStaffMemberships,
  hosts,
  menuItems,
  restaurants,
  users,
} from "../shared/schema";

const BUSINESS_ROLES = ["food_truck", "restaurant_owner"] as const;

const hasAny = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as any).length > 0;
  return String(value || "").trim().length > 0;
};

async function main() {
  console.log("Role-Aware Onboarding Integrity Audit");
  console.log("====================================");

  const roleCounts = await db
    .select({
      userType: users.userType,
      count: sql<number>`count(*)`,
    })
    .from(users)
    .groupBy(users.userType);

  console.log("\n1) User role distribution");
  for (const row of roleCounts) {
    console.log(`- ${String(row.userType || "unknown")}: ${Number(row.count || 0)}`);
  }

  console.log("\n2) Role data collection surfaces (static)");
  console.log("- customer-signup.tsx collects role-first flow and drafts per account type.");
  console.log("- business onboarding draft keys persist in local storage and accountSettings.");
  console.log("- restaurant signup promotes into canonical restaurants + menus/menu_items.");
  console.log("- host signup creates host profile via /api/hosts.");

  const businessUsers = await db
    .select({
      id: users.id,
      userType: users.userType,
      email: users.email,
      accountSettings: users.accountSettings,
    })
    .from(users)
    .where(inArray(users.userType, [...BUSINESS_ROLES]));

  const ownedRestaurants = await db
    .select({ ownerId: restaurants.ownerId })
    .from(restaurants);
  const memberships = await db
    .select({ userId: businessStaffMemberships.userId })
    .from(businessStaffMemberships)
    .where(eq(businessStaffMemberships.status, "active"));
  const ownerSet = new Set(ownedRestaurants.map((row) => String(row.ownerId)));
  const memberSet = new Set(memberships.map((row) => String(row.userId)));

  const notAttached = businessUsers.filter(
    (user) => !ownerSet.has(String(user.id)) && !memberSet.has(String(user.id)),
  );

  console.log("\n3) Business-role users not attached");
  console.log(`- count: ${notAttached.length}`);
  for (const row of notAttached.slice(0, 15)) {
    console.log(`  - ${row.id} (${row.userType}) ${row.email || ""}`);
  }

  const hostProfiles = await db
    .select({
      id: hosts.id,
      userId: hosts.userId,
      address: hosts.address,
      city: hosts.city,
      spotCount: hosts.spotCount,
    })
    .from(hosts);
  console.log("\n4) Host profile linkage");
  console.log(`- total host profiles: ${hostProfiles.length}`);

  const menuCounts = await db
    .select({
      restaurantId: menuItems.restaurantId,
      count: sql<number>`count(*)`,
    })
    .from(menuItems)
    .groupBy(menuItems.restaurantId);
  console.log("\n5) Canonical menu storage");
  console.log(`- restaurants with menu items: ${menuCounts.length}`);

  const menuDraftWithoutBusiness = notAttached.filter((row) => {
    const settings = row.accountSettings && typeof row.accountSettings === "object"
      ? (row.accountSettings as Record<string, any>)
      : {};
    return (
      hasAny(settings.menuItems) ||
      hasAny(settings.menuDraft) ||
      hasAny(settings.onboarding?.menuItems) ||
      hasAny(settings.onboarding?.menuDraft) ||
      hasAny(settings.restaurantSignup?.menuItems) ||
      hasAny(settings.restaurantSignup?.menuDraft) ||
      hasAny(settings.businessDraft?.menuItems)
    );
  });
  console.log("\n6) Submitted menu-like draft data without linked business");
  console.log(`- count: ${menuDraftWithoutBusiness.length}`);
  for (const row of menuDraftWithoutBusiness.slice(0, 15)) {
    console.log(`  - ${row.id} (${row.userType}) ${row.email || ""}`);
  }

  console.log("\n7) Role correction capability");
  console.log("- self-service endpoint: POST /api/auth/onboarding/role-correction");
  console.log("- admin repair: POST /api/admin/business-users/:userId/create-and-attach");
  console.log("- admin attach existing: POST /api/admin/business-users/:userId/attach-restaurant");

  console.log("\n8) Contract risks detected");
  console.log("- business role can exist with no linked business record.");
  console.log("- menu draft data can exist in accountSettings without promotion.");
  console.log("- host and business profiles are separate linkage domains.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
