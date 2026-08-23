import { Router } from "express";
import { randomUUID } from "node:crypto";
import { storage } from "../storage";
import { ensurePremiumTrialForUserId } from "../services/premiumTrial";
import { db } from "../db";
import { z } from "zod";
import Stripe from "stripe";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  deals,
  eventBookings,
  events,
  hosts,
  insertMenuCategorySchema,
  insertMenuItemSchema,
  insertMenuSchema,
  menuCategories,
  menuItems,
  menus,
  restaurants,
  truckManualSchedules,
  users,
} from "@shared/schema";
import { listParkingPassOccurrences } from "../services/parkingPassVirtual";
import {
  isHostProfileMapEligible,
  isParkingPassPublicReady,
} from "../services/parkingPassQuality";
import { ensureParkingPassEventRow } from "../services/parkingPassVirtual";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import { utcDateFromDateKey } from "../services/dateKeys";
import { resolveStoredFoodBusinessType } from "@shared/businessTypes";
import {
  debitCredit,
  getUserCreditBalance,
  InsufficientCreditBalanceError,
} from "../creditService";
import {
  ACTION_API_PUBLIC_READ_ACTIONS,
  ACTION_API_WRITE_CONTAINMENT_CODE,
  isActionApiPublicRead,
  isKnownActionApiAction,
} from "../security/actionApiContainment";
import {
  actionApiFindDealsResultSchema,
  actionApiFindRestaurantsResultSchema,
  actionApiGetFoodTrucksResultSchema,
  actionApiGetParkingPassSpotsResultSchema,
  actionApiGetRestaurantDetailsResultSchema,
  actionApiPublicReadFailureSchema,
  isActionApiPublicBusinessEligible,
  toActionApiParkingPassSpotListResult,
  toActionApiParkingPassSpot,
  toActionApiPublicDeal,
  toActionApiPublicDealListResult,
  toActionApiPublicFoodTruck,
  toActionApiPublicFoodTruckListResult,
  toActionApiPublicRestaurant,
  toActionApiPublicRestaurantDetailResult,
  toActionApiPublicInternalFailure,
  toActionApiPublicRestaurantListResult,
} from "../publicProfiles/actionApiPublicReadProjection";
import {
  assertPublicResponseSafe,
  toPublicRestaurantProfile,
  toPublicTruckProfile,
} from "../publicProfiles";
import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
} from "@shared/consumerEntity";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { resolvePublicHostProximityCoordinates } from "../services/publicHostProximityProjection";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const UNAVAILABLE_ACTIONS = new Set([
  "GET_COUNTY_TRANSPARENCY",
  "GET_COUNTY_LEDGER",
  "GET_COUNTY_VAULT",
]);

const asBoolean = (value: unknown) =>
  value === true || String(value).trim().toLowerCase() === "true";

const toNullableTrimmedText = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

type ActionApiReadDatabase = {
  transaction<T>(
    callback: (transaction: any) => Promise<T>,
    config?: {
      isolationLevel?: "repeatable read";
      accessMode?: "read only";
    },
  ): Promise<T>;
};

type ActionApiParkingPassOccurrenceProvider =
  typeof listParkingPassOccurrences;

export type ActionApiRouterDependencies = {
  database: ActionApiReadDatabase;
  listParkingPassOccurrences: ActionApiParkingPassOccurrenceProvider;
  loadPublicProfileVisibilityByUserIds: (
    userIds: string[],
  ) => Promise<
    Map<
      string,
      { showAddress: boolean; showContact: boolean; ownerEnabled: boolean }
    >
  >;
  now: () => Date;
};

const ACTION_API_READ_TRANSACTION = {
  isolationLevel: "repeatable read" as const,
  accessMode: "read only" as const,
};

const PUBLIC_SCAN_BATCH_SIZE = 100;

const normalizePublicPagination = (input: {
  limit?: number;
  offset?: number;
}) => {
  const requestedLimit = Number(input.limit);
  const requestedOffset = Number(input.offset);
  return {
    limit: Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100))
      : 20,
    offset: Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0,
  };
};

const resolveActionApiPublicBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVICE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

// rawData and contact identity anchors are deliberately confined to this
// eligibility preflight. They are required by the canonical evidence-
// quarantine verdict and must never enter a response projection.
const ACTION_API_BUSINESS_ELIGIBILITY_SELECT = {
  id: restaurants.id,
  ownerId: restaurants.ownerId,
  ownerDisabled: users.isDisabled,
  name: restaurants.name,
  address: restaurants.address,
  phone: restaurants.phone,
  websiteUrl: restaurants.websiteUrl,
  cuisineType: restaurants.cuisineType,
  description: restaurants.description,
  city: restaurants.city,
  state: restaurants.state,
  isActive: restaurants.isActive,
  rawData: restaurants.rawData,
};

// Public response queries select only fields admitted by the Action API DTO.
const ACTION_API_PUBLIC_RESTAURANT_SELECT = {
  id: restaurants.id,
  name: restaurants.name,
  businessType: restaurants.businessType,
  cuisineType: restaurants.cuisineType,
  isFoodTruck: restaurants.isFoodTruck,
  operatingHours: restaurants.operatingHours,
  isActive: restaurants.isActive,
  isVerified: restaurants.isVerified,
  logoUrl: restaurants.logoUrl,
  coverImageUrl: restaurants.coverImageUrl,
  city: restaurants.city,
  state: restaurants.state,
  description: restaurants.description,
};

const ACTION_API_PUBLIC_DEAL_SELECT = {
  id: deals.id,
  restaurantId: deals.restaurantId,
  title: deals.title,
  description: deals.description,
  dealType: deals.dealType,
  discountValue: deals.discountValue,
  imageUrl: deals.imageUrl,
  startDate: deals.startDate,
  endDate: deals.endDate,
  startTime: deals.startTime,
  endTime: deals.endTime,
  availableDuringBusinessHours: deals.availableDuringBusinessHours,
  isOngoing: deals.isOngoing,
};

const ACTION_API_PUBLIC_TRUCK_SELECT = {
  id: restaurants.id,
  name: restaurants.name,
  businessType: restaurants.businessType,
  cuisineType: restaurants.cuisineType,
  operatingHours: restaurants.operatingHours,
  isActive: restaurants.isActive,
  isVerified: restaurants.isVerified,
  logoUrl: restaurants.logoUrl,
  coverImageUrl: restaurants.coverImageUrl,
  city: restaurants.city,
  state: restaurants.state,
  description: restaurants.description,
  isFoodTruck: restaurants.isFoodTruck,
  mobileOnline: restaurants.mobileOnline,
  currentLatitude: restaurants.currentLatitude,
  currentLongitude: restaurants.currentLongitude,
  lastBroadcastAt: restaurants.lastBroadcastAt,
  liveUntilAt: restaurants.liveUntilAt,
};

// ==================== ACTION HANDLERS ====================

/**
 * Search deals by location, category, or text
 */
async function findDeals(params: {
  location?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}, dependencies: ActionApiRouterDependencies) {
  try {
    const { limit, offset } = normalizePublicPagination(params);
    const now = dependencies.now();

    const conditions: any[] = [
      eq(deals.isActive, true),
      lte(deals.startDate, now),
      or(isNull(deals.endDate), gte(deals.endDate, now)),
      eq(restaurants.isActive, true),
    ];

    if (params.search) {
      conditions.push(ilike(deals.title, `%${params.search}%`));
    }

    if (params.location) {
      const location = `%${params.location}%`;
      conditions.push(
        or(
          ilike(restaurants.city, location),
          ilike(restaurants.state, location),
        ),
      );
    }

    return await dependencies.database.transaction(async (transaction) => {
      const eligibleDealIds: string[] = [];
      let eligibleSeen = 0;
      let candidateOffset = 0;

      while (eligibleDealIds.length < limit) {
        const candidates: any[] = await transaction
          .select({
            dealId: deals.id,
            restaurant: ACTION_API_BUSINESS_ELIGIBILITY_SELECT,
          })
          .from(deals)
          .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(and(...conditions))
          .orderBy(desc(deals.updatedAt), desc(deals.id))
          .limit(PUBLIC_SCAN_BATCH_SIZE)
          .offset(candidateOffset);

        for (const row of candidates) {
          if (!isActionApiPublicBusinessEligible(row.restaurant)) continue;
          if (eligibleSeen < offset) {
            eligibleSeen += 1;
            continue;
          }
          const id = String(row.dealId || "").trim();
          if (id) eligibleDealIds.push(id);
          if (eligibleDealIds.length >= limit) break;
        }

        candidateOffset += candidates.length;
        if (
          candidates.length < PUBLIC_SCAN_BATCH_SIZE ||
          eligibleDealIds.length >= limit
        ) {
          break;
        }
      }

      if (eligibleDealIds.length === 0) {
        return toActionApiPublicDealListResult([]);
      }

      const publicRows: any[] = await transaction
        .select(ACTION_API_PUBLIC_DEAL_SELECT)
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            inArray(deals.id, eligibleDealIds),
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
            eq(restaurants.isActive, true),
            eq(users.isDisabled, false),
          ),
        );
      const publicById = new Map(
        publicRows.map((row) => [String(row.id), row]),
      );
      const results = eligibleDealIds
        .map((id) => publicById.get(id))
        .filter(Boolean)
        .map((row) =>
          toActionApiPublicDeal(row as unknown as Record<string, unknown>),
        );

      return toActionApiPublicDealListResult(results);
    }, ACTION_API_READ_TRANSACTION);
  } catch {
    return toActionApiPublicInternalFailure();
  }
}

/**
 * Search restaurants by name, location, or cuisine
 */
async function findRestaurants(params: {
  search?: string;
  location?: string;
  cuisine?: string;
  limit?: number;
  offset?: number;
}, dependencies: ActionApiRouterDependencies) {
  try {
    const { limit, offset } = normalizePublicPagination(params);

    const conditions: any[] = [eq(restaurants.isActive, true)];

    if (params.search) {
      conditions.push(
        ilike(restaurants.name, `%${params.search}%`)
      );
    }

    if (params.location) {
      conditions.push(
        or(
          ilike(restaurants.city, `%${params.location}%`),
          ilike(restaurants.state, `%${params.location}%`),
        ),
      );
    }

    if (params.cuisine) {
      conditions.push(ilike(restaurants.cuisineType, `%${params.cuisine}%`));
    }

    return await dependencies.database.transaction(async (transaction) => {
      const eligibleRestaurantIds: string[] = [];
      let eligibleSeen = 0;
      let candidateOffset = 0;

      while (eligibleRestaurantIds.length < limit) {
        const candidates: any[] = await transaction
          .select(ACTION_API_BUSINESS_ELIGIBILITY_SELECT)
          .from(restaurants)
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(and(...conditions))
          .orderBy(asc(restaurants.name), asc(restaurants.id))
          .limit(PUBLIC_SCAN_BATCH_SIZE)
          .offset(candidateOffset);

        for (const row of candidates) {
          if (!isActionApiPublicBusinessEligible(row)) continue;
          if (eligibleSeen < offset) {
            eligibleSeen += 1;
            continue;
          }
          const id = String(row.id || "").trim();
          if (id) eligibleRestaurantIds.push(id);
          if (eligibleRestaurantIds.length >= limit) break;
        }

        candidateOffset += candidates.length;
        if (
          candidates.length < PUBLIC_SCAN_BATCH_SIZE ||
          eligibleRestaurantIds.length >= limit
        ) {
          break;
        }
      }

      if (eligibleRestaurantIds.length === 0) {
        return toActionApiPublicRestaurantListResult([]);
      }

      const publicRows: any[] = await transaction
        .select(ACTION_API_PUBLIC_RESTAURANT_SELECT)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            inArray(restaurants.id, eligibleRestaurantIds),
            eq(restaurants.isActive, true),
            eq(users.isDisabled, false),
          ),
        );
      const publicById = new Map(
        publicRows.map((row) => [String(row.id), row]),
      );
      const baseUrl = resolveActionApiPublicBaseUrl();
      const results = eligibleRestaurantIds
        .map((id) => publicById.get(id))
        .filter(Boolean)
        .map((row) =>
          toActionApiPublicRestaurant(
            toPublicRestaurantProfile({
              row,
              baseUrl,
              showAddress: false,
              showContact: false,
            }),
          ),
        );

      return toActionApiPublicRestaurantListResult(results);
    }, ACTION_API_READ_TRANSACTION);
  } catch {
    return toActionApiPublicInternalFailure();
  }
}

/**
 * Create a new restaurant (restaurant owner action)
 */
async function createRestaurant(params: {
  userId: string;
  name: string;
  address: string;
  cuisineType?: string;
  description?: string;
  phoneNumber?: string;
  websiteUrl?: string;
}) {
  try {
    if (!params.userId || !params.name || !params.address) {
      return {
        success: false,
        error: "Missing required fields: userId, name, address",
      };
    }

    const result = await storage.createRestaurant({
      ownerId: params.userId,
      name: params.name,
      address: params.address,
      cuisineType: params.cuisineType,
      phoneNumber: params.phoneNumber,
      websiteUrl: params.websiteUrl,
      isActive: true,
      latitude: "0",
      longitude: "0",
    } as any);

    try {
      await ensurePremiumTrialForUserId(params.userId);
    } catch (e) {
      console.warn("ensurePremiumTrialForUserId failed after action createRestaurant:", e);
    }

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update restaurant data (restaurant owner action)
 */
async function updateRestaurant(params: {
  restaurantId: string;
  userId: string;
  updates: Record<string, any>;
}) {
  try {
    if (!params.restaurantId || !params.userId) {
      return {
        success: false,
        error: "Missing required fields: restaurantId, userId",
      };
    }

    // Verify ownership
    const restaurant = await storage.getRestaurant(params.restaurantId);
    if (!restaurant || restaurant.ownerId !== params.userId) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updated = await storage.updateRestaurant(
      params.restaurantId,
      params.updates
    );

    return {
      success: true,
      data: updated,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update profile basics for a restaurant (owner action)
 */
async function updateRestaurantProfile(params: {
  userId: string;
  restaurantId: string;
  updates: Record<string, any>;
}) {
  try {
    if (!params.userId || !params.restaurantId) {
      return {
        success: false,
        error: "Missing required fields: userId, restaurantId",
      };
    }

    const restaurant = await storage.getRestaurant(params.restaurantId);
    if (!restaurant) {
      return {
        success: false,
        error: "Restaurant not found",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.restaurantId,
      params.userId,
      "manageProfile",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const incoming = params.updates || {};
    if (Object.keys(incoming).length === 0) {
      return {
        success: false,
        error: "Missing required field: updates",
      };
    }

    const baseUpdates: Record<string, unknown> = {};
    [
      "name",
      "description",
      "cuisineType",
      "address",
      "city",
      "state",
      "phone",
      "websiteUrl",
      "facebookPageUrl",
      "instagramUrl",
      "xUrl",
      "menuUrl",
      "logoUrl",
      "coverImageUrl",
      "onlineOrderingUrl",
      "deliveryUrl",
      "doordashUrl",
      "uberEatsUrl",
      "toastUrl",
      "squareUrl",
      "chowNowUrl",
      "grubhubUrl",
      "cateringInquiryUrl",
      "truckBookingInquiryUrl",
    ].forEach((field) => {
      if (incoming[field] !== undefined) {
        baseUpdates[field] = toNullableTrimmedText(incoming[field]);
      }
    });

    if (Object.keys(baseUpdates).length === 0) {
      return {
        success: false,
        error: "No valid profile fields provided",
      };
    }

    const updated = await storage.updateRestaurant(params.restaurantId, baseUpdates);

    return {
      success: true,
      data: {
        restaurant: updated,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update restaurant location
 */
async function updateRestaurantLocation(params: {
  userId: string;
  restaurantId: string;
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  mobileOnline?: boolean;
}) {
  try {
    if (!params.userId || !params.restaurantId) {
      return {
        success: false,
        error: "Missing required fields: userId, restaurantId",
      };
    }

    const latitude = Number(params.latitude);
    const longitude = Number(params.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        success: false,
        error: "Invalid location coordinates",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.restaurantId,
      params.userId,
      "manageProfile",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updated = await storage.updateRestaurantLocation(params.restaurantId, {
      latitude,
      longitude,
      city: params.city === undefined || params.city === null ? undefined : String(params.city).trim() || undefined,
      state: params.state === undefined || params.state === null ? undefined : String(params.state).trim() || undefined,
      mobileOnline:
        params.mobileOnline === undefined
          ? undefined
          : asBoolean(params.mobileOnline),
    });

    return {
      success: true,
      data: {
        restaurant: updated,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update restaurant operating hours
 */
async function updateRestaurantOperatingHours(params: {
  userId: string;
  restaurantId: string;
  operatingHours: Record<string, any>;
}) {
  try {
    if (!params.userId || !params.restaurantId || !params.operatingHours) {
      return {
        success: false,
        error: "Missing required fields: userId, restaurantId, operatingHours",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.restaurantId,
      params.userId,
      "manageProfile",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updated = await storage.setRestaurantOperatingHours(
      params.restaurantId,
      params.operatingHours,
    );

    return {
      success: true,
      data: {
        restaurant: updated,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * List all menus for a restaurant
 */
async function listMenus(params: { userId: string; restaurantId: string }) {
  try {
    if (!params.userId || !params.restaurantId) {
      return {
        success: false,
        error: "Missing required fields: userId, restaurantId",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.restaurantId,
      params.userId,
      "manageProfile",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const rows = await db
      .select()
      .from(menus)
      .where(eq(menus.restaurantId, params.restaurantId))
      .orderBy(asc(menus.serviceType));

    return {
      success: true,
      data: rows,
      count: rows.length,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Create a menu
 */
async function createMenu(params: {
  userId: string;
  restaurantId: string;
  name?: string;
  serviceType?: string;
  availableFrom?: string;
  availableTo?: string;
  availableDays?: string[];
  isActive?: boolean;
  acceptsCash?: boolean;
  hidePlatformFee?: boolean;
  importSource?: string;
}) {
  try {
    if (!params.userId || !params.restaurantId) {
      return {
        success: false,
        error: "Missing required fields: userId, restaurantId",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.restaurantId,
      params.userId,
      "manageProfile",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const parsed = insertMenuSchema.parse({
      restaurantId: params.restaurantId,
      name: params.name,
      serviceType: params.serviceType,
      availableFrom: toNullableTrimmedText(params.availableFrom),
      availableTo: toNullableTrimmedText(params.availableTo),
      availableDays: params.availableDays,
      isActive: params.isActive,
      acceptsCash: params.acceptsCash,
      hidePlatformFee: params.hidePlatformFee,
      importSource: toNullableTrimmedText(params.importSource),
    });

    const [menu] = await db.insert(menus).values(parsed as any).returning();

    return {
      success: true,
      data: { menu },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Update a menu
 */
async function updateMenu(params: { userId: string; menuId: string; updates: Record<string, any> }) {
  try {
    if (!params.userId || !params.menuId) {
      return {
        success: false,
        error: "Missing required fields: userId, menuId",
      };
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, params.menuId));
    if (!menu) {
      return { success: false, error: "Menu not found" };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      menu.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updates = insertMenuSchema
      .partial()
      .omit({ restaurantId: true })
      .parse(params.updates || {});
    const normalized = {
      ...updates,
      availableFrom: toNullableTrimmedText((updates as any).availableFrom),
      availableTo: toNullableTrimmedText((updates as any).availableTo),
    };

    const [updated] = await db
      .update(menus)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(menus.id, params.menuId))
      .returning();

    return {
      success: true,
      data: { menu: updated },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Delete (deactivate) a menu
 */
async function deleteMenu(params: { userId: string; menuId: string }) {
  try {
    if (!params.userId || !params.menuId) {
      return {
        success: false,
        error: "Missing required fields: userId, menuId",
      };
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, params.menuId));
    if (!menu) {
      return {
        success: false,
        error: "Menu not found",
      };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      menu.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const [updated] = await db
      .update(menus)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(menus.id, params.menuId))
      .returning();

    return {
      success: true,
      data: { menu: updated },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Create a menu category
 */
async function createMenuCategory(params: {
  userId: string;
  menuId: string;
  name: string;
  description?: string;
  sortOrder?: number;
}) {
  try {
    if (!params.userId || !params.menuId) {
      return {
        success: false,
        error: "Missing required fields: userId, menuId",
      };
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, params.menuId));
    if (!menu) {
      return { success: false, error: "Menu not found" };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      menu.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const parsed = insertMenuCategorySchema.parse({
      ...params,
      restaurantId: menu.restaurantId,
      description: toNullableTrimmedText(params.description),
    });

    const [category] = await db
      .insert(menuCategories)
      .values(parsed as any)
      .returning();

    return {
      success: true,
      data: { category },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Update a menu category
 */
async function updateMenuCategory(params: {
  userId: string;
  categoryId: string;
  updates: Record<string, any>;
}) {
  try {
    if (!params.userId || !params.categoryId) {
      return {
        success: false,
        error: "Missing required fields: userId, categoryId",
      };
    }

    const [category] = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, params.categoryId));
    if (!category) {
      return { success: false, error: "Category not found" };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      category.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updateSchema = insertMenuCategorySchema.partial().omit({
      menuId: true,
      restaurantId: true,
    });
    const updates = updateSchema.parse(params.updates || {});
    const normalized = {
      ...updates,
      description:
        (updates as any).description !== undefined
          ? toNullableTrimmedText((updates as any).description)
          : (updates as any).description,
    };

    const [updated] = await db
      .update(menuCategories)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(menuCategories.id, params.categoryId))
      .returning();

    return { success: true, data: { category: updated } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete (deactivate) a menu category
 */
async function deleteMenuCategory(params: {
  userId: string;
  categoryId: string;
}) {
  try {
    if (!params.userId || !params.categoryId) {
      return {
        success: false,
        error: "Missing required fields: userId, categoryId",
      };
    }
    const [category] = await db
      .select()
      .from(menuCategories)
      .where(eq(menuCategories.id, params.categoryId));
    if (!category) {
      return { success: false, error: "Category not found" };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      category.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const [updated] = await db
      .update(menuCategories)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(menuCategories.id, params.categoryId))
      .returning();

    return {
      success: true,
      data: { category: updated },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Create a menu item
 */
async function createMenuItem(params: {
  userId: string;
  menuId: string;
  restaurantId?: string;
  name: string;
  priceCents: number;
  itemType?: string;
  categoryId?: string;
  description?: string;
  isAvailable?: boolean;
  sortOrder?: number;
}) {
  try {
    if (!params.userId || !params.menuId) {
      return {
        success: false,
        error: "Missing required fields: userId, menuId",
      };
    }

    const [menu] = await db.select().from(menus).where(eq(menus.id, params.menuId));
    if (!menu) return { success: false, error: "Menu not found" };

    const canManage = await storage.verifyRestaurantOwnership(
      menu.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const parsed = insertMenuItemSchema.parse({
      ...params,
      restaurantId: menu.restaurantId,
      categoryId: toNullableTrimmedText(params.categoryId),
      description: toNullableTrimmedText((params as any).description),
    });

    const [item] = await db.insert(menuItems).values(parsed as any).returning();
    return {
      success: true,
      data: { item },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Update menu item
 */
async function updateMenuItem(params: {
  userId: string;
  itemId: string;
  updates: Record<string, any>;
}) {
  try {
    if (!params.userId || !params.itemId) {
      return {
        success: false,
        error: "Missing required fields: userId, itemId",
      };
    }
    const [item] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, params.itemId));
    if (!item) return { success: false, error: "Menu item not found" };

    const canManage = await storage.verifyRestaurantOwnership(
      item.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const updateSchema = insertMenuItemSchema.partial().omit({
      menuId: true,
      restaurantId: true,
    });
    const updates = updateSchema.parse(params.updates || {});
    const normalized = {
      ...updates,
      description:
        (updates as any).description !== undefined
          ? toNullableTrimmedText((updates as any).description)
          : (updates as any).description,
      allergens:
        Array.isArray((updates as any).allergens) ? (updates as any).allergens : undefined,
      dietaryTags:
        Array.isArray((updates as any).dietaryTags)
          ? (updates as any).dietaryTags
          : undefined,
    };

    const [updated] = await db
      .update(menuItems)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(menuItems.id, params.itemId))
      .returning();

    return { success: true, data: { item: updated } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete (deactivate) a menu item
 */
async function deleteMenuItem(params: { userId: string; itemId: string }) {
  try {
    if (!params.userId || !params.itemId) {
      return {
        success: false,
        error: "Missing required fields: userId, itemId",
      };
    }
    const [item] = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, params.itemId));
    if (!item) {
      return { success: false, error: "Menu item not found" };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      item.restaurantId,
      params.userId,
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this restaurant",
      };
    }

    const [updated] = await db
      .update(menuItems)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(menuItems.id, params.itemId))
      .returning();

    return { success: true, data: { item: updated } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Get manual parking schedule entries for a truck
 */
async function getManualSchedules(params: { userId: string; truckId: string }) {
  try {
    if (!params.userId || !params.truckId) {
      return {
        success: false,
        error: "Missing required fields: userId, truckId",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.truckId,
      params.userId,
      "manageParkingPass",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this truck",
      };
    }

    const entries = await storage.getTruckManualSchedules(params.truckId);

    return {
      success: true,
      data: entries,
      count: entries.length,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Create or update a manual parking schedule entry for a truck
 */
async function upsertManualSchedule(params: {
  userId: string;
  truckId: string;
  scheduleId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  address?: string;
  locationName?: string;
  city?: string;
  state?: string;
  notes?: string;
  isPublic?: boolean;
}) {
  try {
    if (!params.userId || !params.truckId) {
      return {
        success: false,
        error: "Missing required fields: userId, truckId",
      };
    }

    const canManage = await storage.verifyRestaurantOwnership(
      params.truckId,
      params.userId,
      "manageParkingPass",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this truck",
      };
    }

    const truck = await storage.getRestaurant(params.truckId);
    if (!truck) {
      return {
        success: false,
        error: "Truck not found",
      };
    }

    if (resolveStoredFoodBusinessType(truck) !== "food_truck") {
      return {
        success: false,
        error: "Schedules are available only for food trucks",
      };
    }

    if (!params.scheduleId) {
      if (!params.date || !params.startTime || !params.endTime || !params.address) {
        return {
          success: false,
          error: "Missing required fields for create: date, startTime, endTime, address",
        };
      }
      const timeZone = resolveCityTimeZoneSync({
        city: String(params.city || truck.city || "").trim(),
        state: String(params.state || truck.state || "").trim(),
      });
      const interval = buildSlotDateTimes({
        timeZone,
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
      });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || !interval) {
        return {
          success: false,
          error: "Invalid schedule date or time",
        };
      }

      const created = await storage.createTruckManualSchedule({
        truckId: params.truckId,
        date: utcDateFromDateKey(params.date),
        startTime: params.startTime,
        endTime: params.endTime,
        locationName: toNullableTrimmedText(params.locationName),
        address: toNullableTrimmedText(params.address),
        city: toNullableTrimmedText(params.city),
        state: toNullableTrimmedText(params.state),
        notes: toNullableTrimmedText(params.notes),
        isPublic: params.isPublic ?? true,
        status: "confirmed",
        timezone: timeZone,
        sourceType: "owner_manual",
        sourceConfidence: "confirmed",
        ownerSubmittedEquivalent: true,
        expiresAt: interval.endUtc,
        lastConfirmedAt: new Date(),
      } as any);

      return {
        success: true,
        data: { schedule: created },
      };
    }

    const [existing] = await db
      .select()
      .from(truckManualSchedules)
      .where(eq(truckManualSchedules.id, params.scheduleId));
    if (!existing) {
      return {
        success: false,
        error: "Schedule not found",
      };
    }
    if (existing.truckId !== params.truckId) {
      return {
        success: false,
        error: "Schedule does not belong to this truck",
      };
    }

    const updates: Record<string, any> = {
      updatedAt: new Date(),
      lastConfirmedAt: new Date(),
    };
    if (params.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(params.date))) {
        return { success: false, error: "Invalid date format for date" };
      }
      updates.date = utcDateFromDateKey(params.date);
    }
    if (params.startTime !== undefined) updates.startTime = toNullableTrimmedText(params.startTime);
    if (params.endTime !== undefined) updates.endTime = toNullableTrimmedText(params.endTime);
    if (params.locationName !== undefined) updates.locationName = toNullableTrimmedText(params.locationName);
    if (params.address !== undefined) updates.address = toNullableTrimmedText(params.address);
    if (params.city !== undefined) updates.city = toNullableTrimmedText(params.city);
    if (params.state !== undefined) updates.state = toNullableTrimmedText(params.state);
    if (params.notes !== undefined) updates.notes = toNullableTrimmedText(params.notes);
    if (params.isPublic !== undefined) updates.isPublic = asBoolean(params.isPublic);
    if (params.city !== undefined || params.state !== undefined) {
      updates.timezone = resolveCityTimeZoneSync({
        city: String(params.city || existing.city || "").trim(),
        state: String(params.state || existing.state || "").trim(),
      });
    }

    const [updated] = await db
      .update(truckManualSchedules)
      .set(updates)
      .where(eq(truckManualSchedules.id, params.scheduleId))
      .returning();

    return { success: true, data: { schedule: updated } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete a manual schedule entry
 */
async function deleteManualSchedule(params: {
  userId: string;
  truckId: string;
  scheduleId: string;
}) {
  try {
    if (!params.userId || !params.truckId || !params.scheduleId) {
      return {
        success: false,
        error: "Missing required fields: userId, truckId, scheduleId",
      };
    }
    const canManage = await storage.verifyRestaurantOwnership(
      params.truckId,
      params.userId,
      "manageParkingPass",
    );
    if (!canManage) {
      return {
        success: false,
        error: "Unauthorized: You do not own this truck",
      };
    }

    await storage.deleteTruckManualSchedule(params.scheduleId, params.truckId);

    return {
      success: true,
      data: { message: "Schedule entry deleted" },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Book a parking pass spot and create a payment intent
 */
async function bookParkingSpot(params: {
  userId: string;
  truckId: string;
  eventId?: string;
  passId?: string;
  spotId?: string;
}) {
  try {
    const eventId = String(
      params.eventId || params.passId || params.spotId || "",
    ).trim();
    if (!params.userId || !params.truckId || !eventId) {
      return {
        success: false,
        error: "Missing required fields: userId, truckId, eventId/spotId",
      };
    }

    const ownsTruck = await storage.verifyRestaurantOwnership(
      params.truckId,
      params.userId,
      "manageParkingPass",
    );
    if (!ownsTruck) {
      return {
        success: false,
        error: "Unauthorized: You do not own that truck",
      };
    }

    let event = await storage.getEvent(eventId);
    if (!event) {
      event = await ensureParkingPassEventRow({ passId: eventId, requireFuture: true });
    }
    if (!event) {
      return {
        success: false,
        error: "Parking pass not found",
      };
    }

    if (event.eventType !== "parking_pass") {
      return {
        success: false,
        error: "Paid checkout is only available for Parking Pass bookings",
      };
    }
    if (!event.requiresPayment) {
      return {
        success: false,
        error:
          "This event does not require payment — use the booking intent flow instead",
      };
    }
    if (event.status !== "open") {
      return {
        success: false,
        error: "Event is not available for booking",
      };
    }
    if (new Date(event.date) < new Date()) {
      return {
        success: false,
        error: "Event has already passed",
      };
    }

    const hostRows = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, event.hostId))
      .limit(1);
    const host = hostRows[0];
    if (!host) {
      return {
        success: false,
        error: "Host not found",
      };
    }
    if (!stripe) {
      return {
        success: false,
        httpStatus: 503,
        error: "Payments not configured on server",
      };
    }

    const hostPriceCents = Number(event.hostPriceCents || 0);
    const PLATFORM_FEE = 1000;
    const totalCents = hostPriceCents + PLATFORM_FEE;
    const hostStripeAccountId =
      host.stripeConnectAccountId &&
      host.stripeChargesEnabled &&
      host.stripePayoutsEnabled &&
      host.stripeOnboardingCompleted
        ? host.stripeConnectAccountId
        : null;

    const booking = await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`parking_pass_event:${event.id}`}))`,
      );

      const [lockedEvent] = await tx
        .select({ maxTrucks: events.maxTrucks, status: events.status })
        .from(events)
        .where(eq(events.id, event.id))
        .limit(1);
      if (!lockedEvent || lockedEvent.status !== "open") {
        throw Object.assign(new Error("Event is not available for booking"), {
          statusCode: 409,
        });
      }

      const [existing] = await tx
        .select({ id: eventBookings.id, status: eventBookings.status })
        .from(eventBookings)
        .where(
          and(eq(eventBookings.eventId, event.id), eq(eventBookings.truckId, params.truckId)),
        )
        .limit(1);
      if (existing?.status === "confirmed") {
        throw Object.assign(new Error("This spot is already booked"), {
          statusCode: 409,
        });
      }
      if (existing?.status === "pending") {
        throw Object.assign(new Error("A pending booking already exists"), {
          statusCode: 409,
        });
      }
      if (existing?.status === "cancelled" || existing?.status === "refunded") {
        throw Object.assign(
          new Error(
            "This booking was previously closed. Refresh the listing and try again.",
          ),
          {
            statusCode: 409,
          },
        );
      }

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(eventBookings)
        .where(
          and(
            eq(eventBookings.eventId, event.id),
            inArray(eventBookings.status, ["pending", "confirmed"]),
          ),
        );
      const reservedCount = Number(countRow?.count || 0);
      if (reservedCount >= Number(lockedEvent.maxTrucks || 0)) {
        throw Object.assign(new Error("Event is fully booked"), { statusCode: 409 });
      }

      const [createdBooking] = await tx
        .insert(eventBookings)
        .values({
          eventId: event.id,
          truckId: params.truckId,
          hostId: event.hostId,
          hostPriceCents,
          platformFeeCents: PLATFORM_FEE,
          totalCents,
          status: "pending",
          stripeApplicationFeeAmount: hostStripeAccountId ? PLATFORM_FEE : null,
          stripeTransferDestination: hostStripeAccountId,
        })
        .returning();
      return createdBooking;
    });

    let paymentIntent: Stripe.PaymentIntent;
    try {
      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: totalCents,
        currency: "usd",
        metadata: {
          bookingId: booking.id,
          eventId: event.id,
          hostId: event.hostId,
          truckId: params.truckId,
          userId: params.userId,
          hostPriceCents: String(hostPriceCents),
          platformFeeCents: String(PLATFORM_FEE),
          totalCents: String(totalCents),
          hostPaymentMode: hostStripeAccountId ? "destination_charge" : "platform_hold",
        },
      };
      if (hostStripeAccountId) {
        intentParams.application_fee_amount = PLATFORM_FEE;
        intentParams.transfer_data = {
          destination: hostStripeAccountId,
        };
      }
      paymentIntent = await stripe.paymentIntents.create(intentParams);
    } catch (stripeError: any) {
      await db
        .update(eventBookings)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationReason: "payment_pending_manual_review: Payment setup failed",
          stripePaymentStatus: "payment_pending",
          updatedAt: new Date(),
        })
        .where(eq(eventBookings.id, booking.id));
      return {
        success: false,
        httpStatus: 202,
        data: {
          paymentPending: true,
          bookingId: booking.id,
          message: "Your spot request was received. We'll send payment instructions.",
        },
      };
    }

    await db
      .update(eventBookings)
      .set({
        stripePaymentIntentId: paymentIntent.id,
        updatedAt: new Date(),
      })
      .where(eq(eventBookings.id, booking.id));

    return {
      success: true,
      data: {
        bookingId: booking.id,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        hostPaymentsReady: !!hostStripeAccountId,
        totalCents,
        breakdown: {
          hostPrice: hostPriceCents,
          platformFee: PLATFORM_FEE,
        },
      },
    };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode);
    if (Number.isFinite(statusCode) && statusCode >= 400) {
      return {
        success: false,
        httpStatus: statusCode,
        error: String(error?.message || "Could not create booking"),
      };
    }
    if (error?.code === "23505") {
      return {
        success: false,
        httpStatus: 409,
        error: "A booking already exists for this truck and event",
      };
    }
    return {
      success: false,
      error: error.message || "Failed to create booking",
    };
  }
}

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : null;
};

const haversineDistanceKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Get live food truck locations
 */
async function getFoodTruckLocations(params: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
}, dependencies: ActionApiRouterDependencies) {
  try {
    if (
      params.latitude === undefined ||
      params.longitude === undefined
    ) {
      return {
        success: false,
        error: "Missing required fields: latitude, longitude",
      };
    }

    const latitude = Number(params.latitude);
    const longitude = Number(params.longitude);
    const radius = Math.min(Number(params.radiusKm ?? 5), 50);

    if (
      Number.isNaN(latitude) ||
      Number.isNaN(longitude) ||
      Number.isNaN(radius)
    ) {
      return {
        success: false,
        error: "Invalid coordinates or radius",
      };
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return {
        success: false,
        error: "Invalid coordinates range",
      };
    }

    const staleMinutesRaw = Number(process.env.LIVE_TRUCK_STALE_MINUTES);
    const freshnessMs = Number.isFinite(staleMinutesRaw)
      ? Math.min(240, Math.max(5, staleMinutesRaw)) * 60_000
      : DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS;
    const now = dependencies.now();
    const center = { lat: latitude, lng: longitude };
    return await dependencies.database.transaction(async (transaction) => {
      const candidateRows: any[] = await transaction
        .select({
          restaurant: ACTION_API_BUSINESS_ELIGIBILITY_SELECT,
          mobileOnline: restaurants.mobileOnline,
          currentLatitude: restaurants.currentLatitude,
          currentLongitude: restaurants.currentLongitude,
          lastBroadcastAt: restaurants.lastBroadcastAt,
          liveUntilAt: restaurants.liveUntilAt,
        })
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.isFoodTruck, true),
            eq(restaurants.mobileOnline, true),
            eq(restaurants.isActive, true),
            sql`${restaurants.currentLatitude} IS NOT NULL`,
            sql`${restaurants.currentLongitude} IS NOT NULL`,
          ),
        );

      const eligibleTrucks = candidateRows
        .filter((row) => isActionApiPublicBusinessEligible(row.restaurant))
        .map((row) => {
          const presence = deriveTruckPresence(
            {
              mobileOnline: row.mobileOnline,
              currentLatitude: row.currentLatitude,
              currentLongitude: row.currentLongitude,
              lastBroadcastAt: row.lastBroadcastAt,
              liveUntilAt: row.liveUntilAt,
              locationSource: "owner_gps",
            },
            { now, freshnessMs },
          );
          if (presence.broadcastState !== "live" || !presence.location) {
            return null;
          }
          const distanceKm = haversineDistanceKm(center, {
            lat: presence.location.latitude,
            lng: presence.location.longitude,
          });
          if (!Number.isFinite(distanceKm) || distanceKm > radius) return null;
          return {
            id: String(row.restaurant.id || "").trim(),
            distanceKm,
            presence,
          };
        })
        .filter(
          (
            row,
          ): row is {
            id: string;
            distanceKm: number;
            presence: ReturnType<typeof deriveTruckPresence>;
          } => Boolean(row?.id),
        )
        .sort(
          (a, b) =>
            a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
        );

      if (eligibleTrucks.length === 0) {
        return toActionApiPublicFoodTruckListResult([]);
      }

      const eligibleTruckIds = eligibleTrucks.map((row) => row.id);
      const publicRows: any[] = await transaction
        .select(ACTION_API_PUBLIC_TRUCK_SELECT)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            inArray(restaurants.id, eligibleTruckIds),
            eq(restaurants.isFoodTruck, true),
            eq(restaurants.mobileOnline, true),
            eq(restaurants.isActive, true),
            eq(users.isDisabled, false),
          ),
        );
      const publicById = new Map(
        publicRows.map((row) => [String(row.id), row]),
      );
      const eligibleById = new Map(
        eligibleTrucks.map((row) => [row.id, row]),
      );
      const baseUrl = resolveActionApiPublicBaseUrl();
      const trucks = eligibleTruckIds
        .map((id) => publicById.get(id))
        .filter(Boolean)
        .map((row) => {
          const eligible = eligibleById.get(String(row!.id))!;
          const profile = toPublicTruckProfile({
            row,
            baseUrl,
            showAddress: false,
            showContact: false,
          });
          return toActionApiPublicFoodTruck({
            profile: { ...profile, truckPresence: eligible.presence },
            distanceKm: eligible.distanceKm,
          });
        });

      return toActionApiPublicFoodTruckListResult(trucks);
    }, ACTION_API_READ_TRANSACTION);
  } catch {
    return toActionApiPublicInternalFailure();
  }
}

/**
 * Get public-ready Parking Pass spots near a location
 */
async function getParkingPassSpots(params: {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  horizonDays?: number;
}, dependencies: ActionApiRouterDependencies) {
  try {
    if (params.latitude === undefined || params.longitude === undefined) {
      return {
        success: false,
        error: "Missing required fields: latitude, longitude",
      };
    }

    const latitude = Number(params.latitude);
    const longitude = Number(params.longitude);
    const radius = Math.min(Number(params.radiusKm ?? 12), 80);
    const horizonDays = Math.max(1, Math.min(Number(params.horizonDays ?? 30), 90));

    if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(radius)) {
      return {
        success: false,
        error: "Invalid coordinates or radius",
      };
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return {
        success: false,
        error: "Invalid coordinates range",
      };
    }

    const center = { lat: latitude, lng: longitude };
    const { occurrences } = await dependencies.listParkingPassOccurrences({
      start: dependencies.now(),
      horizonDays,
      includeDraft: false,
    });
    const hostOwnerIds = Array.from(
      new Set(
        (occurrences as any[])
          .map((event) => String(event?.host?.userId || "").trim())
          .filter(Boolean),
      ),
    );
    const hostVisibilityByOwnerId =
      await dependencies.loadPublicProfileVisibilityByUserIds(hostOwnerIds);

    const byHostId = new Map<
      string,
      ReturnType<typeof toActionApiParkingPassSpot>
    >();

    for (const event of occurrences as any[]) {
      if (!isParkingPassPublicReady(event)) continue;

      const host = event?.host ?? null;
      const hostId = String(host?.id || "").trim();
      const hostOwnerId = String(host?.userId || "").trim();
      const hostVisibility = hostVisibilityByOwnerId.get(hostOwnerId);
      if (
        !hostId ||
        !hostOwnerId ||
        !hostVisibility?.ownerEnabled ||
        !hostVisibility.showAddress
      ) {
        continue;
      }

      if (
        !isHostProfileMapEligible({
          businessName: host?.businessName || event?.host?.businessName,
          address: host?.address || event?.hostAddress || event?.address,
          city: host?.city || event?.hostCity || event?.city,
          state: host?.state || event?.hostState || event?.state,
        })
      ) {
        continue;
      }

      const hostCoordinates = resolvePublicHostProximityCoordinates({
        latitude: host?.latitude,
        longitude: host?.longitude,
        showAddress: hostVisibility.showAddress,
      });
      if (!hostCoordinates) continue;
      const lat = hostCoordinates.latitude;
      const lng = hostCoordinates.longitude;

      const distanceKm = haversineDistanceKm(center, { lat, lng });
      if (!Number.isFinite(distanceKm) || distanceKm > radius) continue;

      const existing = byHostId.get(hostId);
      if (existing && existing.distanceKm <= distanceKm) continue;

      byHostId.set(
        hostId,
        toActionApiParkingPassSpot({
          hostId,
          type: "parking_pass",
          name: host?.businessName || "Parking Pass spot",
          address: host?.address || null,
          city: host?.city || null,
          state: host?.state || null,
          latitude: lat,
          longitude: lng,
          pricingCents: {
            breakfast: Number(event?.breakfastPriceCents ?? 0) || 0,
            lunch: Number(event?.lunchPriceCents ?? 0) || 0,
            dinner: Number(event?.dinnerPriceCents ?? 0) || 0,
            daily: Number(event?.dailyPriceCents ?? 0) || 0,
            weekly: Number(event?.weeklyPriceCents ?? 0) || 0,
            monthly: Number(event?.monthlyPriceCents ?? 0) || 0,
          },
          maxTrucks: Number(event?.maxTrucks ?? 1) || 1,
          startTime: String(event?.startTime || "").trim() || null,
          endTime: String(event?.endTime || "").trim() || null,
          nextDate: event?.date
            ? new Date(event.date).toISOString().slice(0, 10)
            : null,
          paymentsEnabled: Boolean(event?.paymentsEnabled),
          distanceKm,
        }),
      );
    }

    const spots = Array.from(byHostId.values())
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 200);

    return toActionApiParkingPassSpotListResult(spots);
  } catch {
    return toActionApiPublicInternalFailure();
  }
}

/**
 * Redeem credits (user action)
 */
async function redeemCredits(params: {
  userId: string;
  amount: number;
  dealId?: string;
  reason?: string;
}) {
  try {
    if (!params.userId || !params.amount || params.amount <= 0) {
      return {
        success: false,
        error: "Missing or invalid required fields: userId, amount (must be > 0)",
      };
    }

    // Get user to verify they exist
    const user = await storage.getUser(params.userId);
    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    const entry = await debitCredit(
      params.userId,
      params.amount,
      "tradescout_redemption",
      params.dealId || `tradescout_action:${randomUUID()}`,
      "tradescout_action",
    );

    return {
      success: true,
      data: {
        amountRedeemed: params.amount,
        ledgerEntryId: entry.id,
        message: "Credits redeemed successfully",
      },
    };
  } catch (error: any) {
    if (error instanceof InsufficientCreditBalanceError) {
      return {
        success: false,
        error: error.message,
        available: error.available,
        requested: error.requested,
      };
    }
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get user's credit balance
 */
async function getCreditBalance(params: { userId: string }) {
  try {
    if (!params.userId) {
      return {
        success: false,
        error: "Missing required field: userId",
      };
    }

    const user = await storage.getUser(params.userId);
    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    const balance = await getUserCreditBalance(params.userId);

    return {
      success: true,
      data: {
        userId: params.userId,
        balance: Math.max(0, balance),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get restaurant details
 */
async function getRestaurantDetails(
  params: { restaurantId: string },
  dependencies: ActionApiRouterDependencies,
) {
  try {
    if (!params.restaurantId) {
      return {
        success: false,
        error: "Missing required field: restaurantId",
      };
    }

    const now = dependencies.now();
    return await dependencies.database.transaction(async (transaction) => {
      const [eligibilityCandidate] = await transaction
        .select(ACTION_API_BUSINESS_ELIGIBILITY_SELECT)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.id, params.restaurantId),
            eq(restaurants.isActive, true),
            eq(users.isDisabled, false),
          ),
        )
        .limit(1);
      if (
        !eligibilityCandidate ||
        !isActionApiPublicBusinessEligible(eligibilityCandidate)
      ) {
        return {
          success: false as const,
          error: "Restaurant not found",
        };
      }

      const [publicRestaurantRow] = await transaction
        .select(ACTION_API_PUBLIC_RESTAURANT_SELECT)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.id, params.restaurantId),
            eq(restaurants.isActive, true),
            eq(users.isDisabled, false),
          ),
        )
        .limit(1);
      if (!publicRestaurantRow) {
        return {
          success: false as const,
          error: "Restaurant not found",
        };
      }

      const restaurantDealRows: any[] = await transaction
        .select(ACTION_API_PUBLIC_DEAL_SELECT)
        .from(deals)
        .where(
          and(
            eq(deals.restaurantId, params.restaurantId),
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
          ),
        )
        .orderBy(desc(deals.updatedAt), desc(deals.id));
      const restaurantDeals = restaurantDealRows.map((row) =>
        toActionApiPublicDeal(row as unknown as Record<string, unknown>),
      );
      const restaurant = toActionApiPublicRestaurant(
        toPublicRestaurantProfile({
          row: publicRestaurantRow,
          baseUrl: resolveActionApiPublicBaseUrl(),
          showAddress: false,
          showContact: false,
        }),
      );

      return toActionApiPublicRestaurantDetailResult({
        restaurant,
        activeDeals: restaurantDeals,
      });
    }, ACTION_API_READ_TRANSACTION);
  } catch {
    return toActionApiPublicInternalFailure();
  }
}

/**
 * Submit community builder application
 */
async function submitBuilderApplication(params: {
  userId: string;
  countyName: string;
  motivation?: string;
  experience?: string;
}) {
  try {
    if (!params.userId || !params.countyName) {
      return {
        success: false,
        error: "Missing required fields: userId, countyName",
      };
    }

    const user = await storage.getUser(params.userId);
    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    return {
      success: true,
      data: {
        userId: params.userId,
        countyName: params.countyName,
        status: "submitted",
        message: "Community builder application submitted. Check back soon!",
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// ==================== MAIN ACTION ROUTER ====================

export function createActionApiRouter(
  overrides: Partial<ActionApiRouterDependencies> = {},
) {
  const dependencies: ActionApiRouterDependencies = {
    database: overrides.database ?? db,
    listParkingPassOccurrences:
      overrides.listParkingPassOccurrences ?? listParkingPassOccurrences,
    loadPublicProfileVisibilityByUserIds:
      overrides.loadPublicProfileVisibilityByUserIds ??
      (async (userIds) => {
        if (userIds.length === 0) return new Map();
        const rows = await db
          .select({
            id: users.id,
            isDisabled: users.isDisabled,
            publicProfileSettings: users.publicProfileSettings,
          })
          .from(users)
          .where(inArray(users.id, userIds));
        return new Map(
          rows.map((row: any) => {
            const visibility = resolvePublicProfileVisibility(
              row.publicProfileSettings,
            );
            const ownerEnabled = row.isDisabled === false;
            return [
              String(row.id),
              {
                showAddress: ownerEnabled && visibility.showAddress,
                showContact: ownerEnabled && visibility.showContact,
                ownerEnabled,
              },
            ];
          }),
        );
      }),
    now: overrides.now ?? (() => new Date()),
  };
  const router = Router();

  router.post("/", async (req, res) => {
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({
      error: "Missing required field: action",
    });
  }

  if (UNAVAILABLE_ACTIONS.has(action)) {
    return res.status(501).json({
      success: false,
      code: "ACTION_NOT_IMPLEMENTED",
      action,
      error: "This action is not implemented",
    });
  }

  if (!isKnownActionApiAction(action)) {
    return res.status(400).json({
      success: false,
      error: `Unknown action: ${action}`,
      supportedActions: ACTION_API_PUBLIC_READ_ACTIONS,
    });
  }

  if (!isActionApiPublicRead(action)) {
    return res.status(403).json({
      success: false,
      code: ACTION_API_WRITE_CONTAINMENT_CODE,
      action,
      error:
        "This integration credential is limited to public discovery reads. User-scoped actions require a trusted MealScout principal or recorded delegation.",
      supportedActions: ACTION_API_PUBLIC_READ_ACTIONS,
    });
  }

  try {
    let result: any;

    switch (action) {
      case "FIND_DEALS":
        result = actionApiFindDealsResultSchema.parse(
          await findDeals(params || {}, dependencies),
        );
        break;
      case "FIND_RESTAURANTS":
        result = actionApiFindRestaurantsResultSchema.parse(
          await findRestaurants(params || {}, dependencies),
        );
        break;
      case "GET_RESTAURANT_DETAILS":
        result = actionApiGetRestaurantDetailsResultSchema.parse(
          await getRestaurantDetails(params || {}, dependencies),
        );
        break;
      case "CREATE_RESTAURANT":
        result = await createRestaurant(params || {});
        break;
      case "UPDATE_RESTAURANT":
        result = await updateRestaurant(params || {});
        break;
      case "UPDATE_RESTAURANT_PROFILE":
        result = await updateRestaurantProfile(params || {});
        break;
      case "UPDATE_RESTAURANT_LOCATION":
        result = await updateRestaurantLocation(params || {});
        break;
      case "UPDATE_RESTAURANT_OPERATING_HOURS":
        result = await updateRestaurantOperatingHours(params || {});
        break;
      case "GET_FOOD_TRUCKS":
        result = actionApiGetFoodTrucksResultSchema.parse(
          await getFoodTruckLocations(params || {}, dependencies),
        );
        break;
      case "GET_PARKING_PASS_SPOTS":
        result = actionApiGetParkingPassSpotsResultSchema.parse(
          await getParkingPassSpots(params || {}, dependencies),
        );
        break;
      case "LIST_MENUS":
        result = await listMenus(params || {});
        break;
      case "CREATE_MENU":
        result = await createMenu(params || {});
        break;
      case "UPDATE_MENU":
        result = await updateMenu(params || {});
        break;
      case "DELETE_MENU":
        result = await deleteMenu(params || {});
        break;
      case "CREATE_MENU_CATEGORY":
        result = await createMenuCategory(params || {});
        break;
      case "UPDATE_MENU_CATEGORY":
        result = await updateMenuCategory(params || {});
        break;
      case "DELETE_MENU_CATEGORY":
        result = await deleteMenuCategory(params || {});
        break;
      case "CREATE_MENU_ITEM":
        result = await createMenuItem(params || {});
        break;
      case "UPDATE_MENU_ITEM":
        result = await updateMenuItem(params || {});
        break;
      case "DELETE_MENU_ITEM":
        result = await deleteMenuItem(params || {});
        break;
      case "GET_MANUAL_SCHEDULES":
        result = await getManualSchedules(params || {});
        break;
      case "UPSERT_MANUAL_SCHEDULE":
        result = await upsertManualSchedule(params || {});
        break;
      case "DELETE_MANUAL_SCHEDULE":
        result = await deleteManualSchedule(params || {});
        break;
      case "BOOK_PARKING_SPOT":
        result = await bookParkingSpot(params || {});
        break;
      case "REDEEM_CREDITS":
        result = await redeemCredits(params || {});
        break;
      case "GET_CREDITS_BALANCE":
        result = await getCreditBalance(params || {});
        break;
      case "SUBMIT_BUILDER_APPLICATION":
        result = await submitBuilderApplication(params || {});
        break;
      default:
        return res.status(400).json({
          success: false,
          error: `Unknown action: ${action}`,
          supportedActions: ACTION_API_PUBLIC_READ_ACTIONS,
        });
    }

    return res.json(assertPublicResponseSafe(result));
  } catch (err: any) {
    console.error(`Error in action ${action}:`, err);
    return res.status(500).json(
      actionApiPublicReadFailureSchema.parse({
        success: false,
        error: "Unable to complete public read",
      }),
    );
  }
  });

  return router;
}

const router = createActionApiRouter();
export default router;
