import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  businessStaffMemberships,
  restaurants,
  users,
} from "@shared/schema";

export type BusinessPermissionKey =
  | "manageDeals"
  | "manageParkingPass"
  | "viewAnalytics"
  | "manageProfile";

export type BusinessPermissionSet = {
  manageDeals: boolean;
  manageParkingPass: boolean;
  viewAnalytics: boolean;
  manageProfile: boolean;
};

const DEFAULT_PERMISSIONS: BusinessPermissionSet = {
  manageDeals: false,
  manageParkingPass: false,
  viewAnalytics: false,
  manageProfile: false,
};

export const normalizeBusinessPermissions = (
  raw: unknown,
): BusinessPermissionSet => {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  return {
    manageDeals: source.manageDeals === true,
    manageParkingPass: source.manageParkingPass === true,
    viewAnalytics: source.viewAnalytics === true,
    manageProfile: source.manageProfile === true,
  };
};

const mergePermissions = (
  list: BusinessPermissionSet[],
): BusinessPermissionSet => {
  if (!list.length) return { ...DEFAULT_PERMISSIONS };
  return {
    manageDeals: list.some((p) => p.manageDeals),
    manageParkingPass: list.some((p) => p.manageParkingPass),
    viewAnalytics: list.some((p) => p.viewAnalytics),
    manageProfile: list.some((p) => p.manageProfile),
  };
};

export async function isRestaurantOwner(userId: string, restaurantId: string) {
  const [row] = await db
    .select({ ownerId: restaurants.ownerId })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return row?.ownerId === userId;
}

export async function hasBusinessPermissionForRestaurant(
  userId: string,
  restaurantId: string,
  permission: BusinessPermissionKey,
) {
  const owner = await isRestaurantOwner(userId, restaurantId);
  if (owner) return true;

  const [membership] = await db
    .select({ permissions: businessStaffMemberships.permissions })
    .from(businessStaffMemberships)
    .where(
      and(
        eq(businessStaffMemberships.restaurantId, restaurantId),
        eq(businessStaffMemberships.userId, userId),
        eq(businessStaffMemberships.status, "active"),
      ),
    )
    .limit(1);

  const permissions = normalizeBusinessPermissions(membership?.permissions);
  return permissions[permission] === true;
}

export async function getBusinessAccessContext(userId: string) {
  const ownedRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      businessType: restaurants.businessType,
      isFoodTruck: restaurants.isFoodTruck,
      ownerId: restaurants.ownerId,
    })
    .from(restaurants)
    .where(eq(restaurants.ownerId, userId));

  const memberships = await db
    .select({
      id: businessStaffMemberships.id,
      restaurantId: businessStaffMemberships.restaurantId,
      permissions: businessStaffMemberships.permissions,
    })
    .from(businessStaffMemberships)
    .where(
      and(
        eq(businessStaffMemberships.userId, userId),
        eq(businessStaffMemberships.status, "active"),
      ),
    );

  const membershipRestaurantIds = memberships.map((m: { restaurantId: string }) => m.restaurantId);
  const membershipRestaurants = membershipRestaurantIds.length
    ? await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          ownerId: restaurants.ownerId,
        })
        .from(restaurants)
        .where(inArray(restaurants.id, membershipRestaurantIds))
    : [];

  const membershipByRestaurant = new Map<string, BusinessPermissionSet[]>();
  for (const membership of memberships) {
    const list = membershipByRestaurant.get(membership.restaurantId) || [];
    list.push(normalizeBusinessPermissions(membership.permissions));
    membershipByRestaurant.set(membership.restaurantId, list);
  }

  const restaurantsById = new Map<
    string,
    {
      id: string;
      name: string;
      businessType: string | null;
      isFoodTruck: boolean;
      ownerId: string;
      permissions: BusinessPermissionSet;
      isOwner: boolean;
    }
  >();

  for (const row of ownedRestaurants) {
    restaurantsById.set(row.id, {
      id: row.id,
      name: row.name,
      businessType: row.businessType || null,
      isFoodTruck: row.isFoodTruck === true,
      ownerId: row.ownerId,
      permissions: {
        manageDeals: true,
        manageParkingPass: true,
        viewAnalytics: true,
        manageProfile: true,
      },
      isOwner: true,
    });
  }

  for (const row of membershipRestaurants) {
    const permissions = mergePermissions(
      membershipByRestaurant.get(row.id) || [{ ...DEFAULT_PERMISSIONS }],
    );
    const existing = restaurantsById.get(row.id);
    if (existing) {
      existing.permissions = mergePermissions([existing.permissions, permissions]);
      continue;
    }
    restaurantsById.set(row.id, {
      id: row.id,
      name: row.name,
      businessType: row.businessType || null,
      isFoodTruck: row.isFoodTruck === true,
      ownerId: row.ownerId,
      permissions,
      isOwner: false,
    });
  }

  const scopedRestaurants = Array.from(restaurantsById.values());
  const allPermissions = mergePermissions(scopedRestaurants.map((r) => r.permissions));
  const primaryRestaurant =
    scopedRestaurants.find((restaurant) => restaurant.isOwner) ||
    scopedRestaurants[0] ||
    null;
  const linkState =
    scopedRestaurants.length > 0 ? "linked" : "not_attached";

  return {
    restaurants: scopedRestaurants,
    primaryRestaurant,
    linkState,
    guidance:
      linkState === "linked"
        ? null
        : "Connect or claim your business to continue.",
    permissions: allPermissions,
    hasAnyAccess:
      scopedRestaurants.length > 0 &&
      (allPermissions.manageDeals ||
        allPermissions.manageParkingPass ||
        allPermissions.viewAnalytics ||
        allPermissions.manageProfile),
  };
}

export async function getRestaurantOwnerUser(restaurantId: string) {
  const [row] = await db
    .select({
      ownerId: restaurants.ownerId,
      ownerUserType: users.userType,
    })
    .from(restaurants)
    .innerJoin(users, eq(users.id, restaurants.ownerId))
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  return row || null;
}
