export type ProfileCompletionMissingItemKey =
  | "menu"
  | "photos"
  | "hours"
  | "service-area"
  | "contact"
  | "social"
  | "catering-events"
  | "deal";

export type ProfileCompletionBusinessType =
  | "food_truck"
  | "restaurant"
  | "bar"
  | "other";

export type FixedWeeklyHoursState = "ready" | "missing" | "not_applicable";

export type DatedTruckScheduleState =
  | "here_now"
  | "today"
  | "upcoming"
  | "closed_today"
  | "missing"
  | "not_applicable";

export type ProfileLivePresenceState =
  | "live"
  | "offline"
  | "stale"
  | "unknown"
  | "not_applicable";

export type ProfileMenuApprovalEvidence =
  | "owner_approved"
  | "needs_owner_confirmation"
  | "rejected"
  | "unavailable"
  | "not_required";

export type ProfileMenuState =
  | "approved_current"
  | "present_needs_confirmation"
  | "rejected"
  | "missing";

export type ProfileCompletionRequiredItemKey =
  | "menu"
  | "media"
  | "weekly_hours"
  | "dated_truck_schedule";

export type ProfileCompletionTruthInput = {
  businessType: ProfileCompletionBusinessType;
  fixedWeeklyHours: {
    /** True only after strict schema validation and at least one non-empty day. */
    hasValidHours: boolean;
  };
  datedTruckSchedule: {
    /** A state derived from the canonical public truck operating plan. */
    state: Exclude<DatedTruckScheduleState, "not_applicable">;
    /** An admin review can resolve work without inventing public availability. */
    reviewedUnavailable?: boolean;
  };
  livePresence: {
    /** Live GPS/broadcast evidence is deliberately independent of schedule evidence. */
    state: Exclude<ProfileLivePresenceState, "not_applicable">;
  };
  menu: {
    /** A surface backed by an active menu and at least one available item. */
    hasPublicSurface: boolean;
    approval: ProfileMenuApprovalEvidence;
  };
  media: {
    /** Direct public profile art or a gallery asset explicitly approved for public use. */
    hasPublicApprovedMedia: boolean;
  };
  optionalGrowth?: {
    hasSocial?: boolean;
    hasBookingOrCateringLink?: boolean;
    hasActiveDeal?: boolean;
  };
  publicRoute: {
    /** Mirrors actual route eligibility; content richness must never imply publication. */
    isActive: boolean;
  };
};

export type ProfileCompletionTruth = {
  businessType: ProfileCompletionBusinessType;
  publicRouteState: "published" | "inactive";
  fixedWeeklyHoursState: FixedWeeklyHoursState;
  datedTruckScheduleState: DatedTruckScheduleState;
  datedTruckScheduleWorkflowState:
    | "resolved"
    | "unresolved"
    | "not_applicable";
  livePresenceState: ProfileLivePresenceState;
  menuState: ProfileMenuState;
  mediaState: "ready" | "missing";
  availabilityReady: boolean;
  coreContentComplete: boolean;
  publicProfileReady: boolean;
  missingRequired: ProfileCompletionRequiredItemKey[];
  optionalGrowth: {
    hasSocial: boolean;
    hasBookingOrCateringLink: boolean;
    hasActiveDeal: boolean;
    completedCount: number;
    totalCount: 3;
  };
};

/**
 * Canonical, evidence-in / verdict-out profile completion policy.
 *
 * This function intentionally does not inspect raw restaurant objects. Server code must
 * validate and aggregate evidence first. In particular, a truck's weekly hours,
 * `updatedAt`, review disposition, or live broadcast can never stand in for a dated stop.
 */
export function computeProfileCompletionTruth(
  input: ProfileCompletionTruthInput,
): ProfileCompletionTruth {
  const isTruck = input.businessType === "food_truck";
  const fixedWeeklyHoursState: FixedWeeklyHoursState = isTruck
    ? "not_applicable"
    : input.fixedWeeklyHours.hasValidHours
      ? "ready"
      : "missing";
  const datedTruckScheduleState: DatedTruckScheduleState = isTruck
    ? input.datedTruckSchedule.state
    : "not_applicable";
  const datedTruckScheduleReady =
    isTruck &&
    (["here_now", "today", "upcoming"] as DatedTruckScheduleState[]).includes(
      datedTruckScheduleState,
    );
  const datedTruckScheduleWorkflowState = !isTruck
    ? "not_applicable"
    : datedTruckScheduleReady ||
        datedTruckScheduleState === "closed_today" ||
        input.datedTruckSchedule.reviewedUnavailable === true
      ? "resolved"
      : "unresolved";
  const livePresenceState: ProfileLivePresenceState = isTruck
    ? input.livePresence.state
    : "not_applicable";

  let menuState: ProfileMenuState = "missing";
  if (input.menu.approval === "rejected") {
    menuState = "rejected";
  } else if (input.menu.hasPublicSurface) {
    menuState =
      !isTruck || input.menu.approval === "owner_approved"
        ? "approved_current"
        : "present_needs_confirmation";
  }

  const mediaState = input.media.hasPublicApprovedMedia ? "ready" : "missing";
  const availabilityReady = isTruck
    ? datedTruckScheduleReady
    : fixedWeeklyHoursState === "ready";
  const missingRequired: ProfileCompletionRequiredItemKey[] = [];
  if (menuState !== "approved_current") missingRequired.push("menu");
  if (mediaState !== "ready") missingRequired.push("media");
  if (isTruck) {
    if (!datedTruckScheduleReady) missingRequired.push("dated_truck_schedule");
  } else if (fixedWeeklyHoursState !== "ready") {
    missingRequired.push("weekly_hours");
  }

  const optionalGrowth = {
    hasSocial: input.optionalGrowth?.hasSocial === true,
    hasBookingOrCateringLink:
      input.optionalGrowth?.hasBookingOrCateringLink === true,
    hasActiveDeal: input.optionalGrowth?.hasActiveDeal === true,
  };
  const completedOptionalCount = Object.values(optionalGrowth).filter(Boolean).length;
  const coreContentComplete = missingRequired.length === 0;
  const publicRouteState = input.publicRoute.isActive ? "published" : "inactive";

  return {
    businessType: input.businessType,
    publicRouteState,
    fixedWeeklyHoursState,
    datedTruckScheduleState,
    datedTruckScheduleWorkflowState,
    livePresenceState,
    menuState,
    mediaState,
    availabilityReady,
    coreContentComplete,
    publicProfileReady: coreContentComplete && publicRouteState === "published",
    missingRequired,
    optionalGrowth: {
      ...optionalGrowth,
      completedCount: completedOptionalCount,
      totalCount: 3,
    },
  };
}

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
