import assert from "node:assert/strict";

async function main() {
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  const operations = await import("../server/routes/restaurantOperationsRoutes");
  const media = await import("../server/routes/mediaRoutes");

  const queuedLedger = {
    schemaVersion: 2,
    ownerReview: {
      proposals: [{ id: "proposal-1", field: "websiteUrl", status: "pending" }],
      decisions: [],
    },
    sourceIdentity: { internalUrl: "https://private.example/evidence" },
  };
  const initialSettings = {
    evidenceApply: queuedLedger,
    platforms: { facebook: false, instagram: true },
    triggers: { schedule: false },
    promptBeforePost: true,
    publicActionLinks: { onlineOrderingUrl: "https://orders.example/old" },
    publicGalleryImages: [
      { id: "approved", publicApproved: true, category: "food" },
      { id: "pending", publicApproved: false, category: "menu" },
    ],
    internalOnly: { moderationNotes: "not an owner response field" },
  };

  const withNewActionLink = operations.mergeOwnerProfileActionLinks(
    initialSettings,
    { onlineOrderingUrl: "https://orders.example/new" },
  );
  assert.deepEqual(withNewActionLink.evidenceApply, queuedLedger);
  assert.equal(
    withNewActionLink.publicActionLinks.onlineOrderingUrl,
    "https://orders.example/new",
  );

  const decidedLedger = {
    ...queuedLedger,
    ownerReview: {
      ...queuedLedger.ownerReview,
      decisions: [{ proposalId: "proposal-1", action: "confirm" }],
    },
  };
  const afterDecision = { ...withNewActionLink, evidenceApply: decidedLedger };
  const withSocialChange = operations.mergeOwnerSocialSettings(afterDecision, {
    platforms: { facebook: true },
    triggers: { live: true },
    promptBeforePost: false,
  });
  assert.deepEqual(withSocialChange.evidenceApply, decidedLedger);
  assert.deepEqual(withSocialChange.platforms, {
    facebook: true,
    instagram: true,
  });
  assert.deepEqual(withSocialChange.triggers, { schedule: false, live: true });

  const withMedia = media.appendRestaurantGalleryEntry(withSocialChange, {
    id: "new-media",
    publicApproved: false,
    category: "truck",
  });
  assert.deepEqual(withMedia.evidenceApply, decidedLedger);
  assert.equal(withMedia.publicGalleryImages.length, 3);

  const mediaUpdate = media.updateRestaurantGalleryEntry({
    settingsValue: withMedia,
    mediaId: "new-media",
    category: "storefront",
    publicApproved: true,
    canModerate: true,
    verifiedAt: "2026-07-22T12:00:00.000Z",
  });
  assert.equal(mediaUpdate.status, "updated");
  assert.deepEqual(mediaUpdate.settings.evidenceApply, decidedLedger);
  assert.deepEqual(
    mediaUpdate.settings.publicGalleryImages.find(
      (entry: any) => entry.id === "new-media",
    ),
    {
      id: "new-media",
      publicApproved: true,
      category: "storefront",
      lastVerifiedAt: "2026-07-22T12:00:00.000Z",
    },
  );

  const ownerResponse = operations.sanitizeOwnerWorkspaceRestaurant(
    {
      id: "restaurant-1",
      name: "Truthful Truck",
      rawData: { importEvidence: "private" },
      socialAutopostSettings: mediaUpdate.settings,
    },
    { includePendingMedia: true },
  );
  assert.equal("rawData" in ownerResponse, false);
  assert.equal("evidenceApply" in ownerResponse.socialAutopostSettings, false);
  assert.equal("internalOnly" in ownerResponse.socialAutopostSettings, false);
  assert.equal(ownerResponse.socialAutopostSettings.publicGalleryImages.length, 3);
  assert.deepEqual(ownerResponse.socialAutopostSettings.publicActionLinks, {
    onlineOrderingUrl: "https://orders.example/new",
  });

  const readOnlyResponse = operations.sanitizeOwnerWorkspaceRestaurant({
    id: "restaurant-1",
    rawData: { hidden: true },
    socialAutopostSettings: mediaUpdate.settings,
  });
  assert.deepEqual(
    readOnlyResponse.socialAutopostSettings.publicGalleryImages.map(
      (entry: any) => entry.id,
    ),
    ["approved", "new-media"],
  );

  const legacyApproval = {
    id: "restaurant-1",
    isFoodTruck: true,
    rawData: {
      ownerMenuApproval: { status: "approved", ownerApproved: true },
    },
  };
  assert.equal(
    operations.buildOwnerMenuApprovalState(
      legacyApproval,
      2,
      "current-menu-revision",
    ).status,
    "needs_owner_confirmation",
  );
  const exactApproval = {
    ...legacyApproval,
    rawData: {
      ownerMenuApproval: {
        status: "approved",
        ownerApproved: true,
        approvedMenuRevision: "current-menu-revision",
      },
    },
  };
  assert.equal(
    operations.buildOwnerMenuApprovalState(
      exactApproval,
      2,
      "current-menu-revision",
    ).status,
    "owner_approved",
  );
  const adminVerifiedApproval = {
    ...legacyApproval,
    rawData: {
      ownerMenuApproval: {
        status: "admin_verified",
        ownerApproved: true,
        adminApproved: true,
        approvedMenuRevision: "current-menu-revision",
      },
    },
  };
  const adminVerifiedState = operations.buildOwnerMenuApprovalState(
    adminVerifiedApproval,
    2,
    "current-menu-revision",
  );
  assert.equal(adminVerifiedState.status, "admin_verified");
  assert.equal(adminVerifiedState.label, "MealScout-verified menu");
  assert.equal(adminVerifiedState.ownerApproved, false);
  assert.equal(adminVerifiedState.adminVerified, true);
  assert.equal(adminVerifiedState.ownerApprovalRequired, false);
  const changedMenuApproval = operations.buildOwnerMenuApprovalState(
    exactApproval,
    2,
    "changed-menu-revision",
  );
  assert.equal(changedMenuApproval.status, "needs_owner_confirmation");
  assert.equal(changedMenuApproval.approvalStale, true);

  const contradictoryRejectedApproval = operations.buildOwnerMenuApprovalState(
    {
      ...exactApproval,
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          ownerApproved: true,
          approvedMenuRevision: "current-menu-revision",
          rejectedMenuRevision: "current-menu-revision",
        },
      },
    },
    2,
    "current-menu-revision",
  );
  assert.equal(contradictoryRejectedApproval.status, "rejected");
  assert.equal(contradictoryRejectedApproval.ownerApproved, false);
  assert.equal(contradictoryRejectedApproval.ownerApprovalRequired, false);

  const changedAfterRejection = operations.buildOwnerMenuApprovalState(
    {
      ...exactApproval,
      rawData: {
        ownerMenuApproval: {
          status: "rejected",
          rejectedMenuRevision: "old-menu-revision",
        },
      },
    },
    2,
    "current-menu-revision",
  );
  assert.equal(changedAfterRejection.status, "needs_owner_confirmation");
  assert.equal(changedAfterRejection.canApproveCurrentMenu, true);
  assert.equal(changedAfterRejection.ownerApprovalRequired, true);

  const fallbackOnlyApproval = operations.buildOwnerMenuApprovalState(
    {
      id: "restaurant-1",
      isFoodTruck: true,
      menuUrl: "https://menu.example/fallback.pdf",
      rawData: {},
    },
    0,
    null,
  );
  assert.equal(fallbackOnlyApproval.canApproveCurrentMenu, false);
  assert.equal(fallbackOnlyApproval.ownerApprovalRequired, false);
  assert.equal(
    fallbackOnlyApproval.approvalBlockedReason,
    "structured_menu_required",
  );

  const events: string[] = [];
  let lockedRow = {
    id: "restaurant-1",
    socialAutopostSettings: withSocialChange,
  };
  const tx = {
    execute: async () => {
      events.push("advisory-lock");
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async (mode: string) => {
              events.push(`row-${mode}`);
              return [lockedRow];
            },
          }),
        }),
      }),
    }),
  };
  const database = {
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      events.push("transaction");
      return callback(tx);
    },
  };
  const mutateLocked = media.createLockedRestaurantSettingsMutation(database);

  // This is the state that a decision committed after an earlier route read.
  // The mutation must receive this fresh locked row, not the captured snapshot.
  lockedRow = {
    ...lockedRow,
    socialAutopostSettings: {
      ...lockedRow.socialAutopostSettings,
      evidenceApply: decidedLedger,
    },
  };
  const lockedResult = await mutateLocked(
    "restaurant-1",
    async (_transaction, freshRestaurant) =>
      media.appendRestaurantGalleryEntry(
        freshRestaurant.socialAutopostSettings,
        { id: "after-lock", publicApproved: true },
      ),
  );
  assert.deepEqual(events, ["transaction", "advisory-lock", "row-update"]);
  assert.deepEqual((lockedResult as any).evidenceApply, decidedLedger);
  assert.equal((lockedResult as any).publicGalleryImages.at(-1).id, "after-lock");

  console.log("owner-settings-boundary-concurrency.behavior: PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
