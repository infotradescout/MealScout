import { z } from "zod";

import { isPublicDiscoveryEligibleEntity } from "@shared/publicDiscoveryIntegrity";
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { deriveProfileEvidenceQuarantineVisibility } from "../services/profileEvidenceQuarantine";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

export type ActionApiPublicBusinessEligibilityCandidate = {
  id?: unknown;
  ownerId?: unknown;
  ownerDisabled?: unknown;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  cuisineType?: string | null;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  isActive?: unknown;
  rawData?: unknown;
};

/**
 * Composes the existing public-profile, Scout/search, and evidence-quarantine
 * rules. The eligibility candidate is internal query evidence only; it must
 * never be passed to a response projector.
 */
export function isActionApiPublicBusinessEligible(
  candidate: ActionApiPublicBusinessEligibilityCandidate,
): boolean {
  if (!String(candidate.ownerId || "").trim()) return false;
  if (candidate.ownerDisabled !== false) return false;
  if (
    !isPublicDiscoveryEligibleEntity({
      name: candidate.name,
      isActive: candidate.isActive,
    })
  ) {
    return false;
  }
  if (!isPublicBusinessVisible(candidate)) return false;
  return !deriveProfileEvidenceQuarantineVisibility(candidate).isQuarantined;
}

const nullableText = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

const finiteNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const isoDateTime = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};

const nullableIsoDateTime = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const actionApiPublicDealSchema = z
  .object({
    id: z.string().trim().min(1),
    restaurantId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().nullable(),
    dealType: z.string().trim().min(1),
    discountValue: z.number().finite(),
    imageUrl: z.string().nullable(),
    startDate: z.string().datetime({ offset: true }),
    endDate: z.string().datetime({ offset: true }).nullable(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    availableDuringBusinessHours: z.boolean(),
    isOngoing: z.boolean(),
  })
  .strict();

export const actionApiPublicRestaurantSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    businessType: z.string().nullable(),
    cuisineType: z.string().nullable(),
    description: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    logoUrl: z.string().nullable(),
    coverImageUrl: z.string().nullable(),
    isFoodTruck: z.boolean(),
    isVerified: z.boolean(),
    operatingHoursSummary: z.string().nullable(),
  })
  .strict();

export const actionApiPublicFoodTruckSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    businessType: z.string().nullable(),
    cuisineType: z.string().nullable(),
    description: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    logoUrl: z.string().nullable(),
    coverImageUrl: z.string().nullable(),
    isFoodTruck: z.literal(true),
    isVerified: z.boolean(),
    operatingHoursSummary: z.string().nullable(),
    mobileOnline: z.literal(true),
    currentLatitude: z.number().min(-90).max(90),
    currentLongitude: z.number().min(-180).max(180),
    lastBroadcastAt: z.string().datetime({ offset: true }),
    liveUntilAt: z.string().datetime({ offset: true }).nullable(),
    distance: z.number().nonnegative(),
    distanceMiles: z.number().nonnegative(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    liveBroadcasting: z.literal(true),
    locationSource: z.literal("live"),
  })
  .strict();

export const actionApiParkingPassSpotSchema = z
  .object({
    hostId: z.string().trim().min(1),
    type: z.literal("parking_pass"),
    name: z.string().trim().min(1),
    address: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    pricingCents: z
      .object({
        breakfast: z.number().int().nonnegative(),
        lunch: z.number().int().nonnegative(),
        dinner: z.number().int().nonnegative(),
        daily: z.number().int().nonnegative(),
        weekly: z.number().int().nonnegative(),
        monthly: z.number().int().nonnegative(),
      })
      .strict(),
    maxTrucks: z.number().int().positive(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    paymentsEnabled: z.boolean(),
    distanceKm: z.number().nonnegative(),
  })
  .strict();

export type ActionApiPublicDeal = z.infer<typeof actionApiPublicDealSchema>;
export type ActionApiPublicRestaurant = z.infer<
  typeof actionApiPublicRestaurantSchema
>;
export type ActionApiPublicFoodTruck = z.infer<
  typeof actionApiPublicFoodTruckSchema
>;
export type ActionApiParkingPassSpot = z.infer<
  typeof actionApiParkingPassSpotSchema
>;

export const actionApiPublicDealListResultSchema = z
  .object({
    success: z.literal(true),
    data: z.array(actionApiPublicDealSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const actionApiPublicRestaurantListResultSchema = z
  .object({
    success: z.literal(true),
    data: z.array(actionApiPublicRestaurantSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const actionApiPublicFoodTruckListResultSchema = z
  .object({
    success: z.literal(true),
    data: z.array(actionApiPublicFoodTruckSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const actionApiParkingPassSpotListResultSchema = z
  .object({
    success: z.literal(true),
    data: z.array(actionApiParkingPassSpotSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const actionApiPublicRestaurantDetailResultSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        restaurant: actionApiPublicRestaurantSchema,
        activeDeals: z.array(actionApiPublicDealSchema),
        dealCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const actionApiPublicReadFailureSchema = z
  .object({
    success: z.literal(false),
    error: z.string().trim().min(1),
  })
  .strict();

export const actionApiFindDealsResultSchema = z.union([
  actionApiPublicDealListResultSchema,
  actionApiPublicReadFailureSchema,
]);

export const actionApiFindRestaurantsResultSchema = z.union([
  actionApiPublicRestaurantListResultSchema,
  actionApiPublicReadFailureSchema,
]);

export const actionApiGetFoodTrucksResultSchema = z.union([
  actionApiPublicFoodTruckListResultSchema,
  actionApiPublicReadFailureSchema,
]);

export const actionApiGetParkingPassSpotsResultSchema = z.union([
  actionApiParkingPassSpotListResultSchema,
  actionApiPublicReadFailureSchema,
]);

export const actionApiGetRestaurantDetailsResultSchema = z.union([
  actionApiPublicRestaurantDetailResultSchema,
  actionApiPublicReadFailureSchema,
]);

export const toActionApiPublicInternalFailure = () =>
  actionApiPublicReadFailureSchema.parse({
    success: false,
    error: "Unable to complete public read",
  });

export function toActionApiPublicDeal(row: Record<string, unknown>) {
  return actionApiPublicDealSchema.parse({
    id: String(row.id ?? "").trim(),
    restaurantId: String(row.restaurantId ?? "").trim(),
    title: String(row.title ?? "").trim(),
    description: nullableText(row.description),
    dealType: String(row.dealType ?? "").trim(),
    discountValue: finiteNumber(row.discountValue),
    imageUrl: nullableText(row.imageUrl),
    startDate: isoDateTime(row.startDate),
    endDate: nullableIsoDateTime(row.endDate),
    startTime: nullableText(row.startTime),
    endTime: nullableText(row.endTime),
    availableDuringBusinessHours: Boolean(row.availableDuringBusinessHours),
    isOngoing: Boolean(row.isOngoing),
  });
}

export function toActionApiPublicRestaurant(
  profile: PublicRestaurantProfile,
): ActionApiPublicRestaurant {
  return actionApiPublicRestaurantSchema.parse({
    id: String(profile.id || "").trim(),
    name: String(profile.displayName || "").trim(),
    businessType: nullableText(profile.serviceType),
    cuisineType: nullableText(profile.cuisineTags.join(", ")),
    description: nullableText(profile.description),
    city: nullableText(profile.city),
    state: nullableText(profile.state),
    logoUrl: nullableText(profile.logoUrl),
    coverImageUrl: nullableText(profile.coverImageUrl),
    isFoodTruck: profile.profileType === "truck",
    isVerified: Boolean(profile.verifiedProfile),
    operatingHoursSummary: nullableText(profile.operatingHoursSummary),
  });
}

export function toActionApiPublicFoodTruck(input: {
  profile: PublicRestaurantProfile;
  distanceKm: number;
}): ActionApiPublicFoodTruck {
  const presence = input.profile.truckPresence;
  const location = presence?.location;
  return actionApiPublicFoodTruckSchema.parse({
    id: String(input.profile.id || "").trim(),
    name: String(input.profile.displayName || "").trim(),
    businessType: nullableText(input.profile.serviceType),
    cuisineType: nullableText(input.profile.cuisineTags.join(", ")),
    description: nullableText(input.profile.description),
    city: nullableText(input.profile.city),
    state: nullableText(input.profile.state),
    logoUrl: nullableText(input.profile.logoUrl),
    coverImageUrl: nullableText(input.profile.coverImageUrl),
    isFoodTruck: true,
    isVerified: Boolean(input.profile.verifiedProfile),
    operatingHoursSummary: nullableText(
      input.profile.operatingHoursSummary,
    ),
    mobileOnline: true,
    currentLatitude: finiteNumber(location?.latitude),
    currentLongitude: finiteNumber(location?.longitude),
    lastBroadcastAt: String(location?.capturedAt || ""),
    liveUntilAt: nullableIsoDateTime(presence?.liveUntilAt),
    distance: finiteNumber(input.distanceKm),
    distanceMiles: finiteNumber(input.distanceKm) * 0.621371,
    lat: finiteNumber(location?.latitude),
    lng: finiteNumber(location?.longitude),
    liveBroadcasting: true,
    locationSource: "live",
  });
}

export function toActionApiParkingPassSpot(
  row: Record<string, unknown>,
): ActionApiParkingPassSpot {
  const prices =
    row.pricingCents &&
    typeof row.pricingCents === "object" &&
    !Array.isArray(row.pricingCents)
      ? (row.pricingCents as Record<string, unknown>)
      : {};
  return actionApiParkingPassSpotSchema.parse({
    hostId: String(row.hostId ?? "").trim(),
    type: "parking_pass",
    name: String(row.name ?? "").trim(),
    address: nullableText(row.address),
    city: nullableText(row.city),
    state: nullableText(row.state),
    latitude: finiteNumber(row.latitude),
    longitude: finiteNumber(row.longitude),
    pricingCents: {
      breakfast: finiteNumber(prices.breakfast),
      lunch: finiteNumber(prices.lunch),
      dinner: finiteNumber(prices.dinner),
      daily: finiteNumber(prices.daily),
      weekly: finiteNumber(prices.weekly),
      monthly: finiteNumber(prices.monthly),
    },
    maxTrucks: finiteNumber(row.maxTrucks),
    startTime: nullableText(row.startTime),
    endTime: nullableText(row.endTime),
    nextDate: nullableText(row.nextDate),
    paymentsEnabled: Boolean(row.paymentsEnabled),
    distanceKm: finiteNumber(row.distanceKm),
  });
}

export function toActionApiPublicDealListResult(
  data: ActionApiPublicDeal[],
) {
  return actionApiPublicDealListResultSchema.parse({
    success: true,
    data,
    count: data.length,
  });
}

export function toActionApiPublicRestaurantListResult(
  data: ActionApiPublicRestaurant[],
) {
  return actionApiPublicRestaurantListResultSchema.parse({
    success: true,
    data,
    count: data.length,
  });
}

export function toActionApiPublicFoodTruckListResult(
  data: ActionApiPublicFoodTruck[],
) {
  return actionApiPublicFoodTruckListResultSchema.parse({
    success: true,
    data,
    count: data.length,
  });
}

export function toActionApiParkingPassSpotListResult(
  data: ActionApiParkingPassSpot[],
) {
  return actionApiParkingPassSpotListResultSchema.parse({
    success: true,
    data,
    count: data.length,
  });
}

export function toActionApiPublicRestaurantDetailResult(input: {
  restaurant: ActionApiPublicRestaurant;
  activeDeals: ActionApiPublicDeal[];
}) {
  return actionApiPublicRestaurantDetailResultSchema.parse({
    success: true,
    data: {
      restaurant: input.restaurant,
      activeDeals: input.activeDeals,
      dealCount: input.activeDeals.length,
    },
  });
}
