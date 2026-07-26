import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS = "168";
process.env.PUBLIC_SLOT_TTL_HOURS = "72";
process.env.PUBLIC_SLOT_GRACE_MINUTES = "30";

const { assembleTruckOperatingPlan } = await import(
  "../server/services/truckOperatingPlan"
);
const {
  assembleProfileCompletionEvidence,
  hasValidNonEmptyOperatingHours,
  isSafePublicMediaUrl,
} = await import("../server/services/profileCompletionEvidence");
const {
  createStructuredMenuRevision,
  isMenuItemOwnedByRestaurantActiveMenu,
} = await import(
  "../server/services/menuRevision"
);
const { toPublicRestaurantProfile } = await import(
  "../server/publicProfiles/toPublicRestaurantProfile"
);

const now = new Date("2026-07-22T16:00:00.000Z");
const MENU_REVISION = "a".repeat(64);
const weeklyHours = {
  mon: [{ open: "09:00", close: "17:00" }],
};

const validPlan = assembleTruckOperatingPlan({
  now,
  rows: [
    {
      sourceKind: "manual",
      stopId: "manual-valid",
      date: "2026-07-22",
      startTime: "10:00",
      endTime: "14:00",
      sourceStatus: "scheduled",
      isPublic: true,
      liveFeedEligible: true,
      locationName: "Truth Plaza",
      address: "1 Truth Plaza",
      city: "Pensacola",
      state: "FL",
      timezone: "America/Chicago",
      lastConfirmedAt: new Date("2026-07-22T15:30:00.000Z"),
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      ownerSubmittedEquivalent: true,
      sourceConfidence: "confirmed",
      mapEligible: true,
    },
  ],
});

const invalidPlan = assembleTruckOperatingPlan({
  now,
  rows: [
    {
      sourceKind: "manual",
      stopId: "manual-invalid",
      date: "2026-07-22",
      startTime: "10:00",
      endTime: "14:00",
      sourceStatus: "scheduled",
      isPublic: true,
      liveFeedEligible: true,
      locationName: "Unconfirmed Plaza",
      city: "Pensacola",
      state: "FL",
      timezone: "America/Chicago",
      lastConfirmedAt: null,
      expiresAt: new Date("2026-07-30T00:00:00.000Z"),
      ownerSubmittedEquivalent: true,
      sourceConfidence: "confirmed",
    },
  ],
});

const truck = (overrides: Record<string, unknown> = {}) => ({
  id: "truck-1",
  businessType: "food_truck",
  isFoodTruck: true,
  isActive: true,
  operatingHours: weeklyHours,
  mobileOnline: false,
  logoUrl: "https://cdn.example/truck-logo.png",
  rawData: {
    ownerMenuApproval: {
      status: "approved",
      ownerApproved: true,
      approvedMenuRevision: MENU_REVISION,
      reviewedAt: "2026-07-21T12:00:00.000Z",
    },
  },
  socialAutopostSettings: {},
  ...overrides,
});

const completeTruckEvidence = (overrides: Record<string, unknown> = {}) =>
  assembleProfileCompletionEvidence({
    restaurant: truck(),
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
    ...overrides,
  });

assert.equal(isSafePublicMediaUrl("https://cdn.example/logo.png"), true);
assert.equal(isSafePublicMediaUrl("garbage"), false);
assert.equal(isSafePublicMediaUrl("javascript:alert(1)"), false);
assert.equal(isSafePublicMediaUrl("/placeholder.png"), false);

{
  const invalidMedia = assembleProfileCompletionEvidence({
    restaurant: truck({
      logoUrl: "garbage",
      coverImageUrl: "javascript:alert(1)",
      socialAutopostSettings: {
        publicGalleryImages: [
          { publicApproved: true, url: "/placeholder.png" },
        ],
      },
    }),
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(invalidMedia.truth.mediaState, "missing");
  assert.equal(invalidMedia.truth.coreContentComplete, false);
}

// Media hidden by the public quarantine policy cannot satisfy completion truth.
{
  const quarantinedRestaurant = truck({
    logoUrl: "https://cdn.example/quarantined-logo.png",
    coverImageUrl: "https://cdn.example/quarantined-cover.png",
    rawData: {
      ownerMenuApproval: {
        status: "approved",
        ownerApproved: true,
        approvedMenuRevision: MENU_REVISION,
      },
      evidenceQuarantine: {
        status: "quarantined",
        decisions: {},
      },
    },
    socialAutopostSettings: {
      publicGalleryImages: [
        {
          url: "https://cdn.example/quarantined-gallery.png",
          publicApproved: true,
        },
      ],
    },
  });
  const quarantinedEvidence = assembleProfileCompletionEvidence({
    restaurant: quarantinedRestaurant,
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  const quarantinedPublicProfile = toPublicRestaurantProfile({
    row: quarantinedRestaurant,
    baseUrl: "https://www.mealscout.us",
  });
  assert.equal(quarantinedPublicProfile.logoUrl, null);
  assert.equal(quarantinedPublicProfile.coverImageUrl, null);
  assert.equal(quarantinedPublicProfile.galleryImages.length, 0);
  assert.equal(quarantinedEvidence.truth.mediaState, "missing");
  assert.equal(quarantinedEvidence.truth.coreContentComplete, false);

  const acceptedLogoRestaurant = {
    ...quarantinedRestaurant,
    rawData: {
      ...(quarantinedRestaurant.rawData as Record<string, unknown>),
      evidenceQuarantine: {
        status: "quarantined",
        decisions: { media_logo: { status: "accepted" } },
      },
    },
  };
  const acceptedLogoEvidence = assembleProfileCompletionEvidence({
    restaurant: acceptedLogoRestaurant,
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  const acceptedLogoPublicProfile = toPublicRestaurantProfile({
    row: acceptedLogoRestaurant,
    baseUrl: "https://www.mealscout.us",
  });
  assert.equal(
    acceptedLogoPublicProfile.logoUrl,
    "https://cdn.example/quarantined-logo.png",
  );
  assert.equal(acceptedLogoEvidence.truth.mediaState, "ready");
  assert.equal(acceptedLogoEvidence.truth.coreContentComplete, true);
}

// Fixed weekly hours are not a dated food-truck stop.
{
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck(),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: null,
    now,
  });
  assert.equal(evidence.truth.fixedWeeklyHoursState, "not_applicable");
  assert.equal(evidence.truth.datedTruckScheduleState, "missing");
  assert.equal(evidence.truth.availabilityReady, false);
  assert.equal(evidence.truth.coreContentComplete, false);
}

// A recent generic profile edit is not operating-plan evidence.
{
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck({ updatedAt: new Date("2026-07-22T15:59:59.000Z") }),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: null,
    now,
  });
  assert.equal(evidence.truth.datedTruckScheduleState, "missing");
  assert.ok(evidence.truth.missingRequired.includes("dated_truck_schedule"));
}

// Even a trustworthy live broadcast remains separate from future dated coverage.
{
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck({
      mobileOnline: true,
      currentLatitude: "30.42",
      currentLongitude: "-87.21",
      lastBroadcastAt: new Date("2026-07-22T15:45:00.000Z"),
      liveUntilAt: new Date("2026-07-22T18:00:00.000Z"),
    }),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: null,
    now,
  });
  assert.equal(evidence.truth.livePresenceState, "live");
  assert.equal(evidence.truth.datedTruckScheduleState, "missing");
  assert.equal(evidence.truth.availabilityReady, false);
}

// Reviewed-unavailable resolves admin work, but does not invent a public schedule.
{
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck({
      socialAutopostSettings: {
        completionReview: { scheduleReviewedUnavailable: true },
      },
    }),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: null,
    now,
  });
  assert.equal(evidence.truth.datedTruckScheduleWorkflowState, "resolved");
  assert.equal(evidence.truth.datedTruckScheduleState, "missing");
  assert.equal(evidence.truth.coreContentComplete, false);
}

// Only the canonical public operating-plan verdict makes the dated schedule ready.
{
  const valid = completeTruckEvidence();
  assert.equal(valid.truth.datedTruckScheduleState, "here_now");
  assert.equal(valid.truth.availabilityReady, true);
  assert.equal(valid.truth.coreContentComplete, true);

  const invalid = assembleProfileCompletionEvidence({
    restaurant: truck(),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: invalidPlan,
    now,
  });
  assert.equal(invalidPlan.status, "unknown");
  assert.equal(invalid.truth.datedTruckScheduleState, "missing");
  assert.equal(invalid.truth.coreContentComplete, false);
}

// A closed-only notice resolves the workflow without inventing customer availability.
{
  const closedPlan = assembleTruckOperatingPlan({
    now,
    rows: [
      {
        sourceKind: "manual",
        stopId: "manual-closed",
        date: "2026-07-22",
        sourceStatus: "closed",
        isPublic: true,
        timezone: "America/Chicago",
        lastConfirmedAt: new Date("2026-07-22T15:30:00.000Z"),
      },
    ],
  });
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck(),
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: closedPlan,
    now,
  });
  assert.equal(evidence.truth.datedTruckScheduleState, "closed_today");
  assert.equal(evidence.truth.datedTruckScheduleWorkflowState, "resolved");
  assert.equal(evidence.truth.availabilityReady, false);
  assert.equal(evidence.truth.coreContentComplete, false);
}

// A future closed-day notice remains visible evidence, but cannot resolve today.
{
  const localBoundaryNow = new Date("2026-07-23T02:30:00.000Z");
  const futureClosedPlan = assembleTruckOperatingPlan({
    now: localBoundaryNow,
    rows: [
      {
        sourceKind: "manual",
        stopId: "manual-closed-tomorrow",
        date: "2026-07-23",
        sourceStatus: "closed",
        isPublic: true,
        timezone: "America/Chicago",
        lastConfirmedAt: new Date("2026-07-23T02:00:00.000Z"),
      },
    ],
  });
  const futureClosureEvidence = assembleProfileCompletionEvidence({
    restaurant: truck(),
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: futureClosedPlan,
    now: localBoundaryNow,
  });
  assert.equal(futureClosedPlan.status, "unknown");
  assert.equal(futureClosedPlan.closedStops.length, 1);
  assert.equal(
    futureClosureEvidence.truth.datedTruckScheduleState,
    "missing",
  );
  assert.equal(
    futureClosureEvidence.truth.datedTruckScheduleWorkflowState,
    "unresolved",
  );
}

// Truck menus require both an active/available public surface and owner approval.
{
  const approved = completeTruckEvidence();
  assert.equal(approved.truth.menuState, "approved_current");

  const changedAfterApproval = assembleProfileCompletionEvidence({
    restaurant: truck(),
    menuRevisionEvidence: {
      revision: "b".repeat(64),
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(
    changedAfterApproval.truth.menuState,
    "present_needs_confirmation",
  );
  assert.equal(changedAfterApproval.truth.coreContentComplete, false);

  const unapproved = assembleProfileCompletionEvidence({
    restaurant: truck({ rawData: {} }),
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(unapproved.truth.menuState, "present_needs_confirmation");
  assert.equal(unapproved.truth.coreContentComplete, false);

  const rejected = assembleProfileCompletionEvidence({
    restaurant: truck({
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          ownerApproved: true,
          approvedMenuRevision: MENU_REVISION,
          rejectedMenuRevision: MENU_REVISION,
        },
      },
    }),
    menuRevisionEvidence: {
      revision: MENU_REVISION,
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(rejected.truth.menuState, "rejected");
  assert.equal(rejected.truth.coreContentComplete, false);

  const phantomApproval = assembleProfileCompletionEvidence({
    restaurant: truck(),
    activeAvailableMenuItemCount: 0,
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(phantomApproval.truth.menuState, "missing");
}

// A contradictory legacy rejection always wins over stale approval flags and
// hides every public menu surface.
{
  const rejectedPublicProfile = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-rejected-menu",
      name: "Rejected Menu Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: MENU_REVISION,
      menuRevisionCoversRenderedMenu: true,
      menuSections: [
        {
          name: "Menu",
          items: [{ name: "Taco", priceCents: 900 }],
        },
      ],
      menuVariants: [],
      featuredMenuItems: [{ name: "Taco", priceCents: 900 }],
      menuUrl: "https://menu.example/rejected",
      menuImageUrl: "https://menu.example/rejected.jpg",
      menuPdfUrl: "https://menu.example/rejected.pdf",
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          ownerApproved: true,
          approvedMenuRevision: MENU_REVISION,
          rejectedMenuRevision: MENU_REVISION,
        },
      },
    },
  });
  assert.equal(rejectedPublicProfile.menuApproval.status, "rejected");
  assert.equal(rejectedPublicProfile.menuApproval.ownerApproved, false);
  assert.deepEqual(rejectedPublicProfile.menuSections, []);
  assert.deepEqual(rejectedPublicProfile.featuredMenuItems, []);
  assert.equal(rejectedPublicProfile.menuUrl, null);
  assert.equal(rejectedPublicProfile.menuImageUrl, null);
  assert.equal(rejectedPublicProfile.menuPdfUrl, null);

  const changedAfterRejection = assembleProfileCompletionEvidence({
    restaurant: truck({
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          rejectedMenuRevision: MENU_REVISION,
        },
      },
    }),
    menuRevisionEvidence: {
      revision: "b".repeat(64),
      publicItemCount: 1,
    },
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(
    changedAfterRejection.truth.menuState,
    "present_needs_confirmation",
  );
  const rebuiltPublicMenu = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-rebuilt-menu",
      name: "Rebuilt Menu Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: "b".repeat(64),
      menuRevisionCoversRenderedMenu: true,
      menuSections: [
        { name: "New menu", items: [{ name: "New taco", priceCents: 1100 }] },
      ],
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          rejectedMenuRevision: MENU_REVISION,
        },
      },
    },
  });
  assert.equal(
    rebuiltPublicMenu.menuApproval.status,
    "needs_owner_confirmation",
  );
  assert.equal(rebuiltPublicMenu.menuSections.length, 1);
}

// Only the exact structured payload can carry the global owner-approved label;
// unrevisioned external image/PDF surfaces stay out of that trusted state.
{
  const approvedStructuredProfile = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-approved-menu",
      name: "Approved Menu Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: MENU_REVISION,
      menuRevisionCoversRenderedMenu: true,
      menuSections: [
        { name: "Menu", items: [{ name: "Taco", priceCents: 900 }] },
      ],
      menuVariants: [],
      menuUrl: "https://menu.example/revision-bound",
      menuImageUrl: "https://menu.example/unrevisioned.jpg",
      menuPdfUrl: "https://menu.example/unrevisioned.pdf",
      rawData: {
        ownerMenuApproval: {
          status: "approved",
          ownerApproved: true,
          approvedMenuRevision: MENU_REVISION,
        },
      },
    },
  });
  assert.equal(approvedStructuredProfile.menuApproval.status, "owner_approved");
  assert.equal(
    approvedStructuredProfile.menuUrl,
    "https://menu.example/revision-bound",
  );
  assert.equal(approvedStructuredProfile.menuImageUrl, null);
  assert.equal(approvedStructuredProfile.menuPdfUrl, null);

  const adminVerifiedStructuredProfile = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-admin-verified-menu",
      name: "Admin Verified Menu Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: MENU_REVISION,
      menuRevisionCoversRenderedMenu: true,
      menuSections: [
        { name: "Menu", items: [{ name: "Taco", priceCents: 900 }] },
      ],
      menuVariants: [],
      menuUrl: "https://menu.example/admin-verified",
      rawData: {
        ownerMenuApproval: {
          status: "admin_verified",
          ownerApproved: false,
          adminApproved: true,
          approvedMenuRevision: MENU_REVISION,
          approvedMenuRevisionAlgorithm: "structured-menu-sha256-v1",
          sourceAttribution: {
            sourceType: "mealscout_sourced",
            scope: "inserted_menu_items",
            sourceRevision: MENU_REVISION,
            sourceRevisionAlgorithm: "structured-menu-sha256-v1",
            sourcedItemCount: 1,
            ownerAuthored: false,
            evidenceArtifact: "docs/evidence/example-menu.json",
            evidenceSha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      },
    },
  });
  assert.equal(
    adminVerifiedStructuredProfile.menuApproval.status,
    "admin_verified",
  );
  assert.equal(
    adminVerifiedStructuredProfile.menuApproval.label,
    "MealScout-verified menu",
  );
  assert.equal(adminVerifiedStructuredProfile.menuApproval.ownerApproved, false);
  assert.equal(adminVerifiedStructuredProfile.menuApproval.adminVerified, true);
  assert.deepEqual(
    adminVerifiedStructuredProfile.menuApproval.sourceAttribution,
    {
      sourceType: "mealscout_sourced",
      scope: "inserted_menu_items",
      label: "1 menu item sourced by MealScout",
      sourcedItemCount: 1,
    },
  );
  assert.equal(
    adminVerifiedStructuredProfile.menuUrl,
    "https://menu.example/admin-verified",
  );

  const changedUnboundExternal = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-unbound-menu",
      name: "Unbound Menu Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: MENU_REVISION,
      menuSections: [
        { name: "Menu", items: [{ name: "Taco", priceCents: 900 }] },
      ],
      menuUrl: "https://menu.example/changed-after-approval",
      rawData: {
        ownerMenuApproval: {
          status: "approved",
          ownerApproved: true,
          approvedMenuRevision: MENU_REVISION,
        },
      },
    },
  });
  assert.equal(
    changedUnboundExternal.menuApproval.status,
    "needs_owner_confirmation",
  );

  const staleSourceAttributionProfile = toPublicRestaurantProfile({
    baseUrl: "https://www.mealscout.us",
    row: {
      id: "truck-stale-source-attribution",
      name: "Stale Source Attribution Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      isActive: true,
      menuRevision: MENU_REVISION,
      menuRevisionCoversRenderedMenu: true,
      menuSections: [
        { name: "Menu", items: [{ name: "Taco", priceCents: 900 }] },
      ],
      rawData: {
        ownerMenuApproval: {
          status: "admin_verified",
          ownerApproved: false,
          adminApproved: true,
          approvedMenuRevision: MENU_REVISION,
          approvedMenuRevisionAlgorithm: "structured-menu-sha256-v1",
          sourceAttribution: {
            sourceType: "mealscout_sourced",
            scope: "inserted_menu_items",
            sourceRevision: "older-menu-revision",
            sourceRevisionAlgorithm: "structured-menu-sha256-v1",
            sourcedItemCount: 1,
            ownerAuthored: false,
            evidenceArtifact: "docs/evidence/example-menu.json",
            evidenceSha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        },
      },
    },
  });
  assert.equal(
    staleSourceAttributionProfile.menuApproval.sourceAttribution,
    null,
  );
}

// Structured-menu revisions are deterministic and change with public content.
{
  const baseRows = {
    menus: [
      {
        id: "menu-1",
        restaurantId: "truck-1",
        name: "Menu",
        importUrl: "https://menu.example/a",
      },
    ],
    categories: [{ id: "category-1", menuId: "menu-1", name: "Mains" }],
    items: [
      {
        id: "item-1",
        restaurantId: "truck-1",
        menuId: "menu-1",
        name: "Taco",
        priceCents: 900,
      },
    ],
    variants: [],
    modifiers: [],
  };
  const first = createStructuredMenuRevision(baseRows);
  const reordered = createStructuredMenuRevision({
    ...baseRows,
    menus: [
      {
        name: "Menu",
        restaurantId: "truck-1",
        id: "menu-1",
        importUrl: "https://menu.example/a",
      },
    ],
  });
  const changed = createStructuredMenuRevision({
    ...baseRows,
    items: [{ ...baseRows.items[0], priceCents: 1000 }],
  });
  const changedMenuUrl = createStructuredMenuRevision({
    ...baseRows,
    menus: [
      {
        ...baseRows.menus[0],
        importUrl: "https://menu.example/b",
      },
    ],
  });
  assert.match(String(first.revision), /^[a-f0-9]{64}$/);
  assert.equal(reordered.revision, first.revision);
  assert.notEqual(
    changed.revision,
    first.revision,
    "fetched content B must carry revision B rather than approval revision A",
  );
  assert.notEqual(
    changedMenuUrl.revision,
    first.revision,
    "changing the rendered menu import URL must invalidate owner approval",
  );
  assert.equal(
    createStructuredMenuRevision({ ...baseRows, items: [] }).revision,
    null,
  );
  assert.equal(
    isMenuItemOwnedByRestaurantActiveMenu(
      {
        id: "cross-linked-item",
        restaurantId: "truck-b",
        menuId: "menu-a",
      },
      "truck-b",
      new Set(["menu-b"]),
    ),
    false,
    "an item carrying restaurant B but linked to menu A must not hash or render for B",
  );
}

// Publication and content completeness are orthogonal.
{
  const activeThin = assembleProfileCompletionEvidence({
    restaurant: truck({ logoUrl: null, rawData: {} }),
    activeAvailableMenuItemCount: 0,
    truckOperatingPlan: null,
    now,
  });
  assert.equal(activeThin.truth.publicRouteState, "published");
  assert.equal(activeThin.truth.coreContentComplete, false);
  assert.equal(activeThin.truth.publicProfileReady, false);

  const inactiveRich = completeTruckEvidence({
    restaurant: truck({ isActive: false }),
  });
  assert.equal(inactiveRich.truth.publicRouteState, "inactive");
  assert.equal(inactiveRich.truth.coreContentComplete, true);
  assert.equal(inactiveRich.truth.publicProfileReady, false);
}

// Optional growth never compensates for any required miss.
{
  const evidence = assembleProfileCompletionEvidence({
    restaurant: truck({
      logoUrl: null,
      facebookPageUrl: "https://facebook.example/truck",
      socialAutopostSettings: {
        publicActionLinks: {
          truckBookingInquiryUrl: "https://booking.example/truck",
        },
      },
    }),
    activeAvailableMenuItemCount: 1,
    activeDealCount: 1,
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(evidence.truth.optionalGrowth.completedCount, 3);
  assert.equal(evidence.truth.mediaState, "missing");
  assert.equal(evidence.truth.coreContentComplete, false);
}

// Restaurants use strict non-empty weekly hours and never inherit truck schedule state.
{
  assert.equal(hasValidNonEmptyOperatingHours(weeklyHours), true);
  assert.equal(hasValidNonEmptyOperatingHours({}), false);
  assert.equal(
    hasValidNonEmptyOperatingHours({
      mon: [{ open: "09:00", close: "09:00" }],
    }),
    false,
  );
  const restaurant = assembleProfileCompletionEvidence({
    restaurant: {
      id: "restaurant-1",
      businessType: "restaurant",
      isActive: true,
      operatingHours: weeklyHours,
      coverImageUrl: "https://cdn.example/cover.png",
    },
    activeAvailableMenuItemCount: 1,
    truckOperatingPlan: validPlan,
    now,
  });
  assert.equal(restaurant.truth.fixedWeeklyHoursState, "ready");
  assert.equal(restaurant.truth.datedTruckScheduleState, "not_applicable");
  assert.equal(restaurant.truth.livePresenceState, "not_applicable");
  assert.equal(restaurant.truth.coreContentComplete, true);
}

console.log("profile-completion-truth.behavior: PASS");
