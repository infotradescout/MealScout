import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  menus,
  menuItems,
  restaurants,
  truckImportListings,
  users,
} from "@shared/schema";
import {
  resolveStoredFoodBusinessType,
  toCanonicalFoodBusinessType,
  type FoodBusinessType,
} from "@shared/businessTypes";
import { getBusinessAccessContext } from "./businessTeamAccess";
import { buildTruckProfileLocationEvidence } from "../utils/truckLocationSemantics";
import { applyRestaurantCreationPolicy } from "./restaurantCreationPolicy";
import {
  acquireFoodTruckIdentityLock,
  buildFoodTruckIdentity,
  normalizeFoodTruckIdentityText,
  normalizedFoodTruckImportIdentityPredicate,
  normalizedFoodTruckRestaurantIdentityPredicate,
} from "./foodTruckIdentity";

export type PromotionPlaceEvidence = {
  placeId?: string | null;
  formattedAddress?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export type PromotionInput = {
  onboardingAttemptId?: string | null;
  targetRestaurantId?: string | null;
  businessName?: string | null;
  businessType?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  cuisineType?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookPageUrl?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  menuItems?: unknown;
  placeEvidence?: PromotionPlaceEvidence | null;
};

export type BusinessPromotionDependencies = {
  getUser: (userId: string) => Promise<any>;
  getRestaurant: (restaurantId: string) => Promise<any>;
  createRestaurantWithMenu: (
    restaurant: Record<string, unknown>,
    rawMenuItems: unknown,
  ) => Promise<{ restaurant: any; insertedCount: number; created: boolean }>;
  hydrateMenuItems: (
    restaurantId: string,
    rawMenuItems: unknown,
  ) => Promise<{ insertedCount: number }>;
  getAccessContext: (userId: string) => Promise<any>;
};

export class BusinessPromotionError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BusinessPromotionError";
  }
}

const toCents = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric * 100);
};

const normalizeMenuItems = (raw: unknown) => {
  const source = Array.isArray(raw) ? raw : [];
  return source
    .map((item: any, index: number) => {
      const name = String(item?.name || item?.item_name || "").trim();
      if (!name) return null;
      return {
        name,
        description: String(item?.description || "").trim() || null,
        priceCents: Number.isFinite(Number(item?.priceCents))
          ? Math.max(0, Math.round(Number(item.priceCents)))
          : toCents(item?.price ?? item?.priceLabel ?? ""),
        sortOrder: index,
      };
    })
    .filter(Boolean) as Array<{
    name: string;
    description: string | null;
    priceCents: number;
    sortOrder: number;
  }>;
};

export const resolvePromotionBusinessType = (
  value: unknown,
  userType?: unknown,
): FoodBusinessType => {
  const supplied = String(value || "").trim();
  if (supplied) {
    const canonical = toCanonicalFoodBusinessType(supplied);
    if (!canonical) {
      throw new BusinessPromotionError("Unsupported food business type", 400);
    }
    return canonical;
  }

  const role = String(userType || "")
    .trim()
    .toLowerCase();
  if (role === "food_truck") return "food_truck";
  if (role === "bar_owner") return "bar";
  return "restaurant";
};

const normalizePlaceEvidence = (value: PromotionPlaceEvidence | null | undefined) => {
  if (!value || typeof value !== "object") return null;
  const placeId = String(value.placeId || "").trim() || null;
  const formattedAddress = String(value.formattedAddress || "").trim() || null;
  const latitudeRaw = String(value.latitude ?? "").trim();
  const longitudeRaw = String(value.longitude ?? "").trim();
  const latitude = latitudeRaw ? Number(latitudeRaw) : null;
  const longitude = longitudeRaw ? Number(longitudeRaw) : null;
  const validCoordinates =
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  if (!placeId && !formattedAddress && !validCoordinates) return null;
  return {
    source: "client_place_prefill",
    placeId,
    formattedAddress,
    latitude: validCoordinates ? latitude : null,
    longitude: validCoordinates ? longitude : null,
    publicLocationApproved: false,
    capturedAt: new Date().toISOString(),
  };
};

const readSetupDraftFromUser = (user: any): PromotionInput => {
  const accountSettings =
    user?.accountSettings && typeof user.accountSettings === "object"
      ? (user.accountSettings as Record<string, any>)
      : {};
  const onboarding = accountSettings.onboarding || {};
  const signup = accountSettings.restaurantSignup || {};
  const businessDraft = accountSettings.businessDraft || {};
  return {
    businessName:
      accountSettings.businessName ||
      onboarding.businessName ||
      signup.businessName ||
      businessDraft.businessName ||
      null,
    businessType:
      accountSettings.businessType ||
      onboarding.businessType ||
      signup.businessType ||
      businessDraft.businessType ||
      null,
    phone:
      accountSettings.businessPhone ||
      onboarding.phone ||
      signup.phone ||
      businessDraft.phone ||
      user?.phone ||
      null,
    address: onboarding.address || signup.address || businessDraft.address || null,
    city: onboarding.city || signup.city || businessDraft.city || null,
    state: onboarding.state || signup.state || businessDraft.state || null,
    cuisineType:
      onboarding.cuisineType || signup.cuisineType || businessDraft.cuisineType || null,
    description:
      onboarding.description || signup.description || businessDraft.description || null,
    websiteUrl:
      onboarding.websiteUrl || signup.websiteUrl || businessDraft.websiteUrl || null,
    instagramUrl:
      onboarding.instagramUrl || signup.instagramUrl || businessDraft.instagramUrl || null,
    facebookPageUrl:
      onboarding.facebookPageUrl ||
      signup.facebookPageUrl ||
      businessDraft.facebookPageUrl ||
      null,
    logoUrl: onboarding.logoUrl || signup.logoUrl || businessDraft.logoUrl || null,
    coverImageUrl:
      onboarding.coverImageUrl || signup.coverImageUrl || businessDraft.coverImageUrl || null,
    menuItems:
      accountSettings.menuItems ||
      accountSettings.menuDraft ||
      onboarding.menuItems ||
      onboarding.menuDraft ||
      signup.menuItems ||
      signup.menuDraft ||
      businessDraft.menuItems ||
      [],
  };
};

const coalesce = (...values: Array<unknown>) => {
  for (const value of values) {
    const str = typeof value === "string" ? value.trim() : value;
    if (str) return str as any;
  }
  return null;
};

const targetMatchesSetupIdentity = (
  restaurant: any,
  setup: PromotionInput,
) =>
  [
    [restaurant?.name, setup.businessName],
    [restaurant?.address, setup.address],
    [restaurant?.city, setup.city],
    [restaurant?.state, setup.state],
  ].every(
    ([current, proposed]) =>
      normalizeFoodTruckIdentityText(current) ===
      normalizeFoodTruckIdentityText(proposed),
  );

const ensureRestaurantMenuItems = async (
  restaurantId: string,
  rawMenuItems: unknown,
  queryRunner: any = db,
) => {
  const normalizedItems = normalizeMenuItems(rawMenuItems);
  if (normalizedItems.length === 0) return { insertedCount: 0 };

  await queryRunner.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`onboarding_menu:${restaurantId}`}))`,
  );

  const [existingMenu] = await queryRunner
    .select({ id: menus.id })
    .from(menus)
    .where(
      and(
        eq(menus.restaurantId, restaurantId),
        eq(menus.serviceType, "all"),
        eq(menus.isActive, true),
      ),
    )
    .orderBy(asc(menus.createdAt), asc(menus.id))
    .limit(1);

  const menuId =
    existingMenu?.id ||
    (
      await queryRunner
        .insert(menus)
        .values({
          restaurantId,
          name: "Menu",
          serviceType: "all",
          isActive: true,
          importSource: "onboarding",
        })
        .returning({ id: menus.id })
    )[0]?.id;

  if (!menuId) {
    throw new Error("Unable to create the onboarding menu");
  }

  const existingRows = await queryRunner
    .select({ name: menuItems.name })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.restaurantId, restaurantId),
        eq(menuItems.menuId, menuId),
      ),
    );
  const existingNames = new Set(
    existingRows.map((row: any) => String(row.name || "").trim().toLowerCase()),
  );

  const toInsert = normalizedItems
    .filter((item) => {
      const key = item.name.toLowerCase();
      if (existingNames.has(key)) return false;
      existingNames.add(key);
      return true;
    })
    .map((item) => ({
      menuId,
      restaurantId,
      name: item.name,
      description: item.description,
      priceCents: item.priceCents,
      sortOrder: item.sortOrder,
      isAvailable: true,
      itemType: "food",
    }));

  if (toInsert.length > 0) {
    await queryRunner.insert(menuItems).values(toInsert as any);
  }

  return { insertedCount: toInsert.length };
};

const defaultDependencies: BusinessPromotionDependencies = {
  getUser: (userId) => storage.getUser(userId),
  getRestaurant: (restaurantId) => storage.getRestaurant(restaurantId),
  createRestaurantWithMenu: async (restaurant, rawMenuItems) => {
    const result = await db.transaction(async (tx: any) => {
      const requestedId = String(restaurant.id || "").trim() || null;
      const ownerId = String(restaurant.ownerId || "").trim();
      const isFoodTruck =
        String(restaurant.businessType || "").trim().toLowerCase() ===
        "food_truck";

      if (isFoodTruck) {
        const identity = buildFoodTruckIdentity({
          name: restaurant.name,
          address: restaurant.address,
        });
        if (!identity) {
          throw new BusinessPromotionError(
            "Food truck name and address must include searchable characters",
            400,
          );
        }
        await acquireFoodTruckIdentityLock(tx, identity);

        const [registryDuplicate] = await tx
          .select({ id: truckImportListings.id })
          .from(truckImportListings)
          .where(
            and(
              inArray(truckImportListings.status, [
                "unclaimed",
                "claim_processing",
                "claim_requested",
                "claimed",
              ] as any),
              normalizedFoodTruckImportIdentityPredicate(identity, {
                name: truckImportListings.name,
                address: truckImportListings.address,
              }),
            ),
          )
          .limit(1);
        if (registryDuplicate) {
          throw new BusinessPromotionError(
            "This food truck already has a registry listing. Find and claim it instead of creating a duplicate profile.",
            409,
            "food_truck_identity_exists",
          );
        }

        const [nativeDuplicate] = await tx
          .select({ id: restaurants.id, ownerId: restaurants.ownerId })
          .from(restaurants)
          .where(
            normalizedFoodTruckRestaurantIdentityPredicate(identity),
          )
          .limit(1);
        const isSameIdempotentAttempt =
          nativeDuplicate &&
          requestedId &&
          String(nativeDuplicate.id) === requestedId &&
          String(nativeDuplicate.ownerId) === ownerId;
        if (nativeDuplicate && !isSameIdempotentAttempt) {
          throw new BusinessPromotionError(
            "A food truck profile already exists for this name and address.",
            409,
            "food_truck_identity_exists",
          );
        }
      }

      const insert = tx
        .insert(restaurants)
        .values(applyRestaurantCreationPolicy(restaurant));
      const [createdRestaurant] = requestedId
        ? await insert.onConflictDoNothing({ target: restaurants.id }).returning()
        : await insert.returning();
      let resolvedRestaurant = createdRestaurant;
      if (!createdRestaurant && requestedId) {
        const [existingRestaurant] = await tx
          .select()
          .from(restaurants)
          .where(eq(restaurants.id, requestedId))
          .limit(1);
        if (!existingRestaurant) {
          throw new Error("Unable to recover the onboarding business profile");
        }
        if (
          String(existingRestaurant.ownerId || "") !==
          ownerId
        ) {
          throw new BusinessPromotionError(
            "Onboarding attempt belongs to a different owner",
            409,
          );
        }
        resolvedRestaurant = existingRestaurant;
      }
      if (!resolvedRestaurant) {
        throw new Error("Unable to create the business profile");
      }
      const menu = createdRestaurant
        ? await ensureRestaurantMenuItems(
            String(resolvedRestaurant.id),
            rawMenuItems,
            tx,
          )
        : { insertedCount: 0 };

      if (isFoodTruck) {
        const [owner] = await tx
          .select({ userType: users.userType })
          .from(users)
          .where(eq(users.id, ownerId))
          .limit(1);
        if (!owner) {
          throw new BusinessPromotionError("User not found", 404);
        }
        if (["customer", "restaurant_owner"].includes(String(owner.userType))) {
          const [promotedOwner] = await tx
            .update(users)
            .set({ userType: "food_truck", updatedAt: new Date() })
            .where(eq(users.id, ownerId))
            .returning({ id: users.id });
          if (!promotedOwner) {
            throw new Error("Unable to promote the food truck owner role");
          }
        }
      }

      return {
        restaurant: resolvedRestaurant,
        insertedCount: menu.insertedCount,
        created: Boolean(createdRestaurant),
      };
    });
    try {
      if (result.restaurant?.city) {
        await storage.ensureCityExists(
          String(result.restaurant.city),
          result.restaurant.state ? String(result.restaurant.state) : null,
        );
      }
    } catch (error) {
      console.warn("ensureCityExists failed for onboarding business", error);
    }
    return result;
  },
  hydrateMenuItems: (restaurantId, rawMenuItems) =>
    db.transaction((tx: any) =>
      ensureRestaurantMenuItems(restaurantId, rawMenuItems, tx),
    ),
  getAccessContext: (userId) => getBusinessAccessContext(userId),
};

export async function promoteBusinessSetupToProfile(
  userId: string,
  input?: PromotionInput,
  dependencies: BusinessPromotionDependencies = defaultDependencies,
) {
  const user = await dependencies.getUser(userId);
  if (!user) throw new BusinessPromotionError("User not found", 404);

  const draft = readSetupDraftFromUser(user);
  const merged: PromotionInput = {
    businessName: coalesce(input?.businessName, draft.businessName),
    businessType: coalesce(input?.businessType, draft.businessType),
    address: coalesce(input?.address, draft.address),
    city: coalesce(input?.city, draft.city),
    state: coalesce(input?.state, draft.state),
    phone: coalesce(input?.phone, draft.phone, user.phone),
    cuisineType: coalesce(input?.cuisineType, draft.cuisineType, "Various"),
    description: coalesce(input?.description, draft.description),
    websiteUrl: coalesce(input?.websiteUrl, draft.websiteUrl),
    instagramUrl: coalesce(input?.instagramUrl, draft.instagramUrl),
    facebookPageUrl: coalesce(input?.facebookPageUrl, draft.facebookPageUrl),
    logoUrl: coalesce(input?.logoUrl, draft.logoUrl),
    coverImageUrl: coalesce(input?.coverImageUrl, draft.coverImageUrl),
    menuItems:
      (Array.isArray(input?.menuItems) && input?.menuItems) || draft.menuItems || [],
  };

  if (!merged.businessName || !merged.address || !merged.city || !merged.state) {
    throw new BusinessPromotionError("Missing required business setup fields", 400);
  }

  const businessType = resolvePromotionBusinessType(
    merged.businessType,
    user.userType,
  );
  const targetRestaurantId = String(input?.targetRestaurantId || "").trim();
  let restaurant: any = null;
  let created = false;
  let menuInsertedCount = 0;
  let menuHandled = false;

  if (targetRestaurantId) {
    restaurant = await dependencies.getRestaurant(targetRestaurantId);
    if (!restaurant || String(restaurant.ownerId || "") !== userId) {
      throw new BusinessPromotionError(
        "Target business does not belong to this owner",
        409,
      );
    }
    const targetBusinessType = resolveStoredFoodBusinessType(restaurant);
    if (
      !targetBusinessType ||
      targetBusinessType !== businessType
    ) {
      throw new BusinessPromotionError(
        "Target business identity does not match this setup",
        409,
      );
    }
    if (!targetMatchesSetupIdentity(restaurant, merged)) {
      throw new BusinessPromotionError(
        "Target business identity does not match this setup",
        409,
      );
    }
  } else {
    const onboardingPlaceEvidence = normalizePlaceEvidence(input?.placeEvidence);
    const profileLocations =
      businessType === "food_truck"
        ? buildTruckProfileLocationEvidence({
            businessName: String(merged.businessName),
            address: String(merged.address),
            serviceArea: [merged.city, merged.state]
              .map((value) => String(value || "").trim())
              .filter(Boolean)
              .join(", "),
            source: onboardingPlaceEvidence
              ? "client_place_prefill"
              : "owner_onboarding",
          })
        : null;
    const rawData =
      onboardingPlaceEvidence || profileLocations
        ? {
            ...(onboardingPlaceEvidence ? { onboardingPlaceEvidence } : {}),
            ...(profileLocations ? { profileLocations } : {}),
          }
        : null;
    const creation = await dependencies.createRestaurantWithMenu({
      ...(input?.onboardingAttemptId
        ? { id: String(input.onboardingAttemptId) }
        : {}),
      ownerId: userId,
      name: String(merged.businessName),
      address: String(merged.address),
      city: String(merged.city),
      state: String(merged.state),
      phone: merged.phone ? String(merged.phone) : null,
      cuisineType: String(merged.cuisineType || "Various"),
      description: merged.description ? String(merged.description) : null,
      websiteUrl: merged.websiteUrl ? String(merged.websiteUrl) : null,
      instagramUrl: merged.instagramUrl ? String(merged.instagramUrl) : null,
      facebookPageUrl: merged.facebookPageUrl ? String(merged.facebookPageUrl) : null,
      logoUrl: merged.logoUrl ? String(merged.logoUrl) : null,
      coverImageUrl: merged.coverImageUrl ? String(merged.coverImageUrl) : null,
      businessType,
      isFoodTruck: businessType === "food_truck",
      isActive: true,
      rawData,
    } as any, merged.menuItems);
    restaurant = creation.restaurant;
    menuInsertedCount = creation.insertedCount;
    created = creation.created;
    menuHandled = true;
  }

  if (!menuHandled) {
    const menuHydration = await dependencies.hydrateMenuItems(
      String(restaurant.id),
      merged.menuItems,
    );
    menuInsertedCount = menuHydration.insertedCount;
  }
  let accessContext: any = null;
  try {
    accessContext = await dependencies.getAccessContext(userId);
  } catch (error) {
    console.warn("Unable to refresh business access after onboarding", error);
  }

  return {
    created,
    restaurant,
    accessContext,
    menuInsertedCount,
  };
}
