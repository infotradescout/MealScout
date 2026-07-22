import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  deals,
  operatingHoursSchema,
  restaurants,
} from "@shared/schema";
import { resolveStoredFoodBusinessType } from "@shared/businessTypes";
import {
  computeProfileCompletionTruth,
  type DatedTruckScheduleState,
  type ProfileCompletionBusinessType,
  type ProfileCompletionTruth,
  type ProfileCompletionTruthInput,
  type ProfileMenuApprovalEvidence,
} from "@shared/profileCompletionStatus";
import type { PublicTruckScheduleSummary } from "@shared/publicProfiles";
import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
} from "@shared/consumerEntity";
import { db } from "../db";
import {
  buildPublicTruckOperatingPlans,
  type TruckOperatingProfileData,
} from "./truckOperatingPlan";
import {
  loadMenuRevisionEvidenceBatch,
  type MenuRevisionEvidence,
} from "./menuRevision";

type UnknownRecord = Record<string, unknown>;

export type ProfileCompletionRestaurantRecord = {
  id: unknown;
  businessType?: unknown;
  isFoodTruck?: unknown;
  isActive?: unknown;
  operatingHours?: unknown;
  mobileOnline?: boolean | null;
  currentLatitude?: unknown;
  currentLongitude?: unknown;
  lastBroadcastAt?: Date | string | null;
  liveUntilAt?: Date | string | null;
  logoUrl?: unknown;
  coverImageUrl?: unknown;
  facebookPageUrl?: unknown;
  instagramUrl?: unknown;
  socialAutopostSettings?: unknown;
  rawData?: unknown;
  /** Accepted for compatibility but deliberately never used as availability evidence. */
  updatedAt?: unknown;
};

export type ProfileCompletionEvidence = ProfileCompletionTruthInput & {
  restaurantId: string;
  menuRevision: string | null;
  truckOperatingPlan: PublicTruckScheduleSummary | null;
  truth: ProfileCompletionTruth;
};

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const hasText = (value: unknown) => String(value || "").trim().length > 0;

export const isSafePublicMediaUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw) || raw.length > 1000) return false;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host.includes(".") ||
      host.includes(":") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
};

export function hasValidNonEmptyOperatingHours(value: unknown): boolean {
  const parsed = operatingHoursSchema.safeParse(value);
  return (
    parsed.success &&
    Object.values(parsed.data).some(
      (slots) => Array.isArray(slots) && slots.length > 0,
    )
  );
}

export function deriveDatedTruckScheduleState(
  plan: PublicTruckScheduleSummary | null | undefined,
): Exclude<DatedTruckScheduleState, "not_applicable"> {
  if (!plan) return "missing";
  if (plan.currentStop?.status === "here_now") return "here_now";
  if (plan.todayStop) return "today";
  if (plan.nextStop || plan.upcomingStops.length > 0) return "upcoming";
  if (plan.status === "closed" && (plan.closedStops?.length || 0) > 0) {
    return "closed_today";
  }
  return "missing";
}

const resolveCompletionBusinessType = (
  restaurant: ProfileCompletionRestaurantRecord,
): ProfileCompletionBusinessType => {
  const resolved = resolveStoredFoodBusinessType({
    businessType: restaurant.businessType,
    isFoodTruck: restaurant.isFoodTruck,
  });
  return resolved === "food_truck" ||
    resolved === "restaurant" ||
    resolved === "bar"
    ? resolved
    : "other";
};

const resolveMenuApproval = (
  restaurant: ProfileCompletionRestaurantRecord,
  hasPublicSurface: boolean,
  businessType: ProfileCompletionBusinessType,
  currentMenuRevision: string | null,
): ProfileMenuApprovalEvidence => {
  if (businessType !== "food_truck") return "not_required";
  const rawData = asRecord(restaurant.rawData);
  const approval = asRecord(rawData.ownerMenuApproval);
  const status = String(approval.status || "").trim().toLowerCase();
  const rejectedMenuRevision = String(
    approval.rejectedMenuRevision || "",
  ).trim();
  const rejectedCurrentRevision =
    (status === "rejected" || status === "not_current") &&
    (currentMenuRevision
      ? rejectedMenuRevision === currentMenuRevision
      : !rejectedMenuRevision);
  if (rejectedCurrentRevision) return "rejected";
  const approvedMenuRevision = String(
    approval.approvedMenuRevision || "",
  ).trim();
  if (
    currentMenuRevision &&
    approvedMenuRevision === currentMenuRevision &&
    (status === "approved" || approval.ownerApproved === true)
  ) {
    return "owner_approved";
  }
  return hasPublicSurface ? "needs_owner_confirmation" : "unavailable";
};

const hasPublicApprovedMedia = (
  restaurant: ProfileCompletionRestaurantRecord,
) => {
  if (
    isSafePublicMediaUrl(restaurant.logoUrl) ||
    isSafePublicMediaUrl(restaurant.coverImageUrl)
  ) {
    return true;
  }
  const settings = asRecord(restaurant.socialAutopostSettings);
  const gallery = Array.isArray(settings.publicGalleryImages)
    ? settings.publicGalleryImages
    : [];
  return gallery.some((entry) => {
    const media = asRecord(entry);
    return (
      media.publicApproved === true &&
      isSafePublicMediaUrl(media.url || media.imageUrl)
    );
  });
};

const getCompletionReview = (restaurant: ProfileCompletionRestaurantRecord) => {
  const settings = asRecord(restaurant.socialAutopostSettings);
  return asRecord(settings.completionReview);
};

const getPublicActionLinks = (restaurant: ProfileCompletionRestaurantRecord) => {
  const settings = asRecord(restaurant.socialAutopostSettings);
  return asRecord(settings.publicActionLinks);
};

export function assembleProfileCompletionEvidence(input: {
  restaurant: ProfileCompletionRestaurantRecord;
  activeAvailableMenuItemCount?: number;
  menuRevisionEvidence?: MenuRevisionEvidence;
  activeDealCount?: number;
  truckOperatingPlan?: PublicTruckScheduleSummary | null;
  now?: Date;
}): ProfileCompletionEvidence {
  const restaurantId = String(input.restaurant.id || "").trim();
  const businessType = resolveCompletionBusinessType(input.restaurant);
  const isTruck = businessType === "food_truck";
  const menuRevisionEvidence = input.menuRevisionEvidence || {
    revision: null,
    publicItemCount: Math.max(
      0,
      Number(input.activeAvailableMenuItemCount || 0),
    ),
  };
  const hasPublicMenuSurface =
    menuRevisionEvidence.publicItemCount > 0;
  const completionReview = getCompletionReview(input.restaurant);
  const actionLinks = getPublicActionLinks(input.restaurant);
  const presence = deriveTruckPresence(
    {
      mobileOnline: input.restaurant.mobileOnline,
      currentLatitude: input.restaurant.currentLatitude,
      currentLongitude: input.restaurant.currentLongitude,
      lastBroadcastAt: input.restaurant.lastBroadcastAt,
      liveUntilAt: input.restaurant.liveUntilAt,
    },
    {
      now: input.now,
      freshnessMs: DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
    },
  );
  const truthInput: ProfileCompletionTruthInput = {
    businessType,
    fixedWeeklyHours: {
      hasValidHours: hasValidNonEmptyOperatingHours(
        input.restaurant.operatingHours,
      ),
    },
    datedTruckSchedule: {
      state: isTruck
        ? deriveDatedTruckScheduleState(input.truckOperatingPlan)
        : "missing",
      reviewedUnavailable:
        completionReview.scheduleReviewedUnavailable === true,
    },
    livePresence: {
      state: presence.broadcastState,
    },
    menu: {
      hasPublicSurface: hasPublicMenuSurface,
      approval: resolveMenuApproval(
        input.restaurant,
        hasPublicMenuSurface,
        businessType,
        menuRevisionEvidence.revision,
      ),
    },
    media: {
      hasPublicApprovedMedia: hasPublicApprovedMedia(input.restaurant),
    },
    optionalGrowth: {
      hasSocial:
        hasText(input.restaurant.facebookPageUrl) ||
        hasText(input.restaurant.instagramUrl),
      hasBookingOrCateringLink:
        hasText(actionLinks.cateringInquiryUrl) ||
        hasText(actionLinks.truckBookingInquiryUrl),
      hasActiveDeal: Math.max(0, Number(input.activeDealCount || 0)) > 0,
    },
    publicRoute: {
      isActive: input.restaurant.isActive === true,
    },
  };

  return {
    restaurantId,
    ...truthInput,
    menuRevision: menuRevisionEvidence.revision,
    truckOperatingPlan: isTruck ? input.truckOperatingPlan || null : null,
    truth: computeProfileCompletionTruth(truthInput),
  };
}

const normalizeRestaurantIds = (restaurantIds: string[]) =>
  Array.from(
    new Set(
      restaurantIds
        .map((restaurantId) => String(restaurantId || "").trim())
        .filter(Boolean),
    ),
  );

export async function loadProfileCompletionEvidenceBatch(
  restaurantIds: string[],
  options?: { now?: Date },
): Promise<Map<string, ProfileCompletionEvidence>> {
  const normalizedIds = normalizeRestaurantIds(restaurantIds);
  if (normalizedIds.length === 0) return new Map();
  const now = options?.now || new Date();

  const [restaurantRows, menuRevisionEvidenceByRestaurant, activeDealRows] =
    await Promise.all([
    db.select().from(restaurants).where(inArray(restaurants.id, normalizedIds)),
    loadMenuRevisionEvidenceBatch(normalizedIds),
    db
      .select({ restaurantId: deals.restaurantId })
      .from(deals)
      .where(
        and(
          inArray(deals.restaurantId, normalizedIds),
          eq(deals.isActive, true),
          lte(deals.startDate, now),
          or(isNull(deals.endDate), gte(deals.endDate, now)),
        ),
      ),
  ]);
  const activeDealCounts = new Map<string, number>();
  for (const row of activeDealRows as Array<{ restaurantId: unknown }>) {
    const restaurantId = String(row.restaurantId || "").trim();
    activeDealCounts.set(
      restaurantId,
      (activeDealCounts.get(restaurantId) || 0) + 1,
    );
  }

  const typedRestaurantRows = restaurantRows as ProfileCompletionRestaurantRecord[];
  const truckIds = typedRestaurantRows
    .filter(
      (restaurant) => resolveCompletionBusinessType(restaurant) === "food_truck",
    )
    .map((restaurant) => String(restaurant.id || "").trim())
    .filter(Boolean);
  const truckPlans = await buildPublicTruckOperatingPlans(truckIds, { now });

  return new Map(
    typedRestaurantRows.map((restaurant) => {
      const restaurantId = String(restaurant.id || "").trim();
      const operatingData: TruckOperatingProfileData | undefined =
        truckPlans.get(restaurantId);
      const evidence = assembleProfileCompletionEvidence({
        restaurant,
        menuRevisionEvidence: menuRevisionEvidenceByRestaurant.get(
          restaurantId,
        ),
        activeDealCount: activeDealCounts.get(restaurantId) || 0,
        truckOperatingPlan: operatingData?.truckSchedule || null,
        now,
      });
      return [restaurantId, evidence] as const;
    }),
  );
}

export async function loadProfileCompletionEvidence(
  restaurantId: string,
  options?: { now?: Date },
): Promise<ProfileCompletionEvidence | null> {
  const normalizedId = String(restaurantId || "").trim();
  if (!normalizedId) return null;
  const evidence = await loadProfileCompletionEvidenceBatch([normalizedId], options);
  return evidence.get(normalizedId) || null;
}
