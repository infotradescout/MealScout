import { normalizePublicUrl } from "../publicProfiles/publicProfileUtils";

const publicDealFields = (deal: any) => ({
  id: deal?.id,
  restaurantId: deal?.restaurantId,
  title: deal?.title,
  description: deal?.description,
  dealType: deal?.dealType,
  discountValue: deal?.discountValue,
  minOrderAmount: deal?.minOrderAmount ?? null,
  imageUrl: normalizePublicUrl(deal?.imageUrl, { allowInternalPath: true }),
  startDate: deal?.startDate ?? null,
  endDate: deal?.endDate ?? null,
  startTime: deal?.startTime ?? null,
  endTime: deal?.endTime ?? null,
  availableDuringBusinessHours:
    deal?.availableDuringBusinessHours === true,
  isOngoing: deal?.isOngoing === true,
  totalUsesLimit: deal?.totalUsesLimit ?? null,
  perCustomerLimit: deal?.perCustomerLimit ?? null,
  currentUses: deal?.currentUses ?? 0,
  isActive: deal?.isActive !== false,
  isAiGenerated: deal?.isAiGenerated === true,
  createdAt: deal?.createdAt ?? null,
  updatedAt: deal?.updatedAt ?? null,
});

export function projectPublicDealRow(
  deal: any,
  publicRestaurant: Record<string, any>,
  distanceKm: number | null = null,
) {
  return {
    ...publicDealFields(deal),
    facebookPageUrl: publicRestaurant.facebookPageUrl
      ? normalizePublicUrl(deal?.facebookPageUrl)
      : null,
    restaurant: publicRestaurant,
    ...(distanceKm !== null
      ? { distance: Number(distanceKm.toFixed(2)) }
      : {}),
  };
}
