import { resolveCoordinatePair } from "@shared/consumerEntity";

import { resolvePublicProfileVisibility } from "./publicProfileUtils";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

const nullableText = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text || null;
};

const nonNegativeInteger = (value: unknown): number => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
};

/**
 * Allowlisted supplier catalog DTO. Owner settings decide whether a street
 * address, exact coordinates, phone, or email may leave the server. Payment
 * capability fields describe buyer-visible checkout choices; Stripe account
 * identity and onboarding state are intentionally never projected.
 */
export function toPublicSupplierListing(row: any): Record<string, unknown> | null {
  if (!row || row.isActive !== true || row.ownerDisabled !== false) return null;
  if (
    !isPublicBusinessVisible({
      name: row.businessName,
      city: row.city,
      state: row.state,
      description: [row.onlinePaymentsNotes, row.deliveryNotes]
        .filter(Boolean)
        .join(" "),
    })
  ) {
    return null;
  }

  const visibility = resolvePublicProfileVisibility(row.publicProfileSettings);
  const coordinates = visibility.showAddress
    ? resolveCoordinatePair(row.latitude, row.longitude)
    : null;

  return {
    id: String(row.id || ""),
    businessName: nullableText(row.businessName) || "MealScout supplier",
    address: visibility.showAddress ? nullableText(row.address) : null,
    city: nullableText(row.city),
    state: nullableText(row.state),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    contactPhone: visibility.showContact ? nullableText(row.contactPhone) : null,
    contactEmail: visibility.showContact ? nullableText(row.contactEmail) : null,
    isActive: true,
    onlinePaymentsEnabled: row.onlinePaymentsEnabled === true,
    onlinePaymentsAllowAch: row.onlinePaymentsAllowAch === true,
    onlinePaymentsAllowCard: row.onlinePaymentsAllowCard === true,
    onlinePaymentsMinOrderCents: nonNegativeInteger(
      row.onlinePaymentsMinOrderCents,
    ),
    onlinePaymentsNotes: nullableText(row.onlinePaymentsNotes),
    offersDelivery: row.offersDelivery === true,
    deliveryRadiusMiles:
      row.offersDelivery === true
        ? nonNegativeInteger(row.deliveryRadiusMiles)
        : null,
    deliveryFeeCents: nonNegativeInteger(row.deliveryFeeCents),
    deliveryMinOrderCents: nonNegativeInteger(row.deliveryMinOrderCents),
    deliveryNotes: nullableText(row.deliveryNotes),
    updatedAt: row.updatedAt || null,
  };
}

export function toPublicSupplierListingArray(
  rows: any[] | null | undefined,
): Record<string, unknown>[] {
  return (Array.isArray(rows) ? rows : [])
    .map(toPublicSupplierListing)
    .filter((row): row is Record<string, unknown> => Boolean(row));
}
