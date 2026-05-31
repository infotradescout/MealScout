import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { menus, menuItems } from "@shared/schema";
import { getBusinessAccessContext } from "./businessTeamAccess";

type PromotionInput = {
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
};

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

const normalizeType = (value: unknown) => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "food_truck" || raw === "food-truck" || raw === "truck") {
    return "food_truck" as const;
  }
  return "restaurant" as const;
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

const ensureRestaurantMenuItems = async (
  restaurantId: string,
  rawMenuItems: unknown,
) => {
  const normalizedItems = normalizeMenuItems(rawMenuItems);
  if (normalizedItems.length === 0) return { insertedCount: 0 };

  const [existingMenu] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)))
    .limit(1);

  const menuId =
    existingMenu?.id ||
    (
      await db
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

  if (!menuId) return { insertedCount: 0 };

  const existingRows = await db
    .select({ name: menuItems.name })
    .from(menuItems)
    .where(eq(menuItems.restaurantId, restaurantId));
  const existingNames = new Set(
    existingRows.map((row: any) => String(row.name || "").trim().toLowerCase()),
  );

  const toInsert = normalizedItems
    .filter((item) => !existingNames.has(item.name.toLowerCase()))
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
    await db.insert(menuItems).values(toInsert as any);
  }

  return { insertedCount: toInsert.length };
};

export async function promoteBusinessSetupToProfile(
  userId: string,
  input?: PromotionInput,
) {
  const user = await storage.getUser(userId);
  if (!user) throw new Error("User not found");

  const draft = readSetupDraftFromUser(user);
  const merged: PromotionInput = {
    businessName: coalesce(input?.businessName, draft.businessName),
    businessType: coalesce(input?.businessType, draft.businessType, user.userType),
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
    throw new Error("Missing required business setup fields");
  }

  const owned = await storage.getRestaurantsByOwner(userId);
  const businessType = normalizeType(merged.businessType);
  let restaurant = (Array.isArray(owned) ? owned[0] : null) as any;
  let created = false;

  if (!restaurant) {
    restaurant = await storage.createRestaurant({
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
    } as any);
    created = true;
  }

  const menuHydration = await ensureRestaurantMenuItems(
    String(restaurant.id),
    merged.menuItems,
  );
  const accessContext = await getBusinessAccessContext(userId);

  return {
    created,
    restaurant,
    accessContext,
    menuInsertedCount: menuHydration.insertedCount,
  };
}
