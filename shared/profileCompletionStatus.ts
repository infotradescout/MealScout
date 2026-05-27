export type ProfileCompletionMissingItemKey =
  | "menu"
  | "photos"
  | "hours"
  | "service-area"
  | "contact"
  | "social"
  | "catering-events"
  | "deal";

type AnyRecord = Record<string, any>;

function getActionLinks(entity: AnyRecord): AnyRecord {
  if (
    entity?.socialAutopostSettings &&
    typeof entity.socialAutopostSettings === "object" &&
    typeof entity.socialAutopostSettings.publicActionLinks === "object"
  ) {
    return entity.socialAutopostSettings.publicActionLinks as AnyRecord;
  }
  return {};
}

export function computeProfileCompletionStatus(
  entity: AnyRecord,
  options?: { hasActiveDeal?: boolean },
): Record<ProfileCompletionMissingItemKey, boolean> {
  const actionLinks = getActionLinks(entity || {});
  const hasMenu = Boolean(
    entity?.menuUrl ||
      entity?.menuPdfUrl ||
      entity?.menuImageUrl ||
      Number(entity?.menuItemCount || 0) > 0 ||
      Number(entity?.publicMenuItemCount || 0) > 0,
  );
  const hasPhotos = Boolean(entity?.imageUrl || entity?.logoUrl || entity?.coverImageUrl);
  const hasHours = Boolean(
    entity?.operatingHours || entity?.businessHours || entity?.hours || entity?.schedulePublished,
  );
  const hasServiceArea = Boolean(entity?.address || entity?.city);
  const hasContact = Boolean(
    entity?.phone ||
      entity?.contactPhone ||
      entity?.websiteUrl ||
      entity?.onlineOrderingUrl ||
      actionLinks.onlineOrderingUrl ||
      actionLinks.deliveryUrl,
  );
  const hasSocial = Boolean(entity?.facebookPageUrl || entity?.instagramUrl);
  const hasCateringEvents = Boolean(
    entity?.cateringInquiryUrl ||
      entity?.truckBookingInquiryUrl ||
      actionLinks.cateringInquiryUrl ||
      actionLinks.truckBookingInquiryUrl ||
      Number(entity?.upcomingPublicEventCount || 0) > 0 ||
      Number(entity?.upcomingEventCount || 0) > 0,
  );
  const hasDeal =
    options?.hasActiveDeal ??
    Boolean(
      Number(entity?.activeDeals || 0) > 0 ||
        Number(entity?.activeDealsCount || 0) > 0 ||
        Boolean(entity?.hasActiveDeals),
    );

  return {
    menu: hasMenu,
    photos: hasPhotos,
    hours: hasHours,
    "service-area": hasServiceArea,
    contact: hasContact,
    social: hasSocial,
    "catering-events": hasCateringEvents,
    deal: hasDeal,
  };
}

