import assert from "node:assert/strict";

async function main() {
  process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
  const {
    createLockedAdminBusinessCompletionMutation,
    mergeAdminBusinessCompletionSettings,
  } = await import("../server/routes/adminManagementRoutes");

  const stalePreRead = {
    evidenceApply: {
      ownerReview: {
        proposals: [{ id: "proposal-1", status: "pending" }],
        decisions: [],
      },
    },
    publicActionLinks: { deliveryUrl: "https://delivery.example/old" },
  };
  const freshDecision = {
    proposals: [{ id: "proposal-1", status: "confirmed" }],
    decisions: [{ proposalId: "proposal-1", action: "confirm" }],
  };
  const freshLockedSettings = {
    ...stalePreRead,
    evidenceApply: {
      ...stalePreRead.evidenceApply,
      ownerReview: freshDecision,
      batchId: "batch-after-stale-read",
    },
    platforms: { facebook: true },
    completionReview: { identityReviewed: true },
    publicGalleryImages: [
      { id: "existing-media", url: "https://cdn.example/existing.jpg" },
    ],
  };

  const events: string[] = [];
  const lockedRestaurant = {
    id: "business-1",
    socialAutopostSettings: freshLockedSettings,
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
              return [lockedRestaurant];
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
  const mutateLocked = createLockedAdminBusinessCompletionMutation(database);
  const result = await mutateLocked(
    "business-1",
    async (_transaction, freshRestaurant) =>
      mergeAdminBusinessCompletionSettings({
        settingsValue: freshRestaurant.socialAutopostSettings,
        publicActionLinks: {
          onlineOrderingUrl: " https://orders.example/new ",
        },
        reviewed: {
          photosReviewedUnavailable: true,
        },
        galleryImageUrl: " https://cdn.example/new.jpg ",
        galleryImageApproved: false,
        verifiedAt: "2026-07-22T18:00:00.000Z",
      }),
  );

  assert.deepEqual(events, ["transaction", "advisory-lock", "row-update"]);
  assert.ok(result);
  assert.deepEqual((result as any).evidenceApply.ownerReview, freshDecision);
  assert.notDeepEqual(
    (result as any).evidenceApply.ownerReview,
    stalePreRead.evidenceApply.ownerReview,
  );
  assert.equal((result as any).evidenceApply.batchId, "batch-after-stale-read");
  assert.deepEqual((result as any).platforms, { facebook: true });
  assert.deepEqual((result as any).publicActionLinks, {
    deliveryUrl: "https://delivery.example/old",
    onlineOrderingUrl: "https://orders.example/new",
  });
  assert.deepEqual((result as any).completionReview, {
    identityReviewed: true,
    photosReviewedUnavailable: true,
  });
  assert.deepEqual((result as any).publicGalleryImages, [
    { id: "existing-media", url: "https://cdn.example/existing.jpg" },
    {
      url: "https://cdn.example/new.jpg",
      source: "gallery",
      publicApproved: false,
      lastVerifiedAt: "2026-07-22T18:00:00.000Z",
    },
  ]);

  console.log("admin-business-completion-settings.behavior: PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
