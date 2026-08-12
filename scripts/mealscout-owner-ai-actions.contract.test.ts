import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.NODE_ENV = "development";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const {
  OWNER_AI_PACKET_JSON_SCHEMA,
  ownerAiActionPacketSchema,
  ownerAiDraftRequestSchema,
} = await import("../shared/ownerAiActions");
const {
  buildOwnerAiSocialDrafts,
  buildOwnerAiSocialCardSvg,
  normalizeOwnerAiPlan,
  ownerAiApprovalUrl,
  mergeOwnerAiProfileActionLinks,
  buildOwnerAiMediaPreviewDescriptors,
} = await import("../server/services/ownerAiActions");
const { isBlockedIp } = await import("../server/utils/websiteProfileImport");
const { fetchPinnedPublicImage } = await import(
  "../server/utils/pinnedPublicImageFetch"
);

assert.equal(isBlockedIp("127.0.0.1"), true);
assert.equal(isBlockedIp("10.10.10.10"), true);
assert.equal(isBlockedIp("64.29.17.65"), false);
assert.equal(isBlockedIp("185.199.111.133"), false);
assert.equal(isBlockedIp("::1"), true);
assert.equal(isBlockedIp("::ffff:127.0.0.1"), true);
assert.equal(isBlockedIp("2606:50c0:8000::154"), false);

await assert.rejects(
  fetchPinnedPublicImage("http://127.0.0.1/private.png", {
    maxBytes: 1024,
    timeoutMs: 1000,
    maxRedirects: 0,
    allowedContentTypes: new Set(["image/png"]),
    accept: "image/png",
    userAgent: "MealScoutContractTest/1.0",
  }),
  /reachable|public|image/i,
);

const basePacket = {
  schemaVersion: "1.0" as const,
  intent: "Update Friday service and prepare owner-approved social posts",
  schedules: [
    {
      kind: "event_stop" as const,
      eventName: "Friday Market",
      date: "2026-08-14",
      startTime: "17:00",
      endTime: "21:00",
      locationName: "Downtown Market",
      city: "Pensacola",
      state: "FL",
    },
  ],
  social: {
    enabled: true,
    platforms: ["facebook", "instagram", "x"] as const,
    headline: "Friday Market",
  },
};

assert.equal(ownerAiActionPacketSchema.safeParse(basePacket).success, true);
assert.equal(
  ownerAiActionPacketSchema.safeParse({
    ...basePacket,
    social: {
      enabled: true,
      platforms: ["facebook", "facebook"],
    },
  }).success,
  false,
);
assert.equal(OWNER_AI_PACKET_JSON_SCHEMA.$defs.profile.additionalProperties, false);
assert.equal(
  OWNER_AI_PACKET_JSON_SCHEMA.$defs.menuItem.properties.priceCents.maximum,
  10_000_000,
);
assert.equal(
  OWNER_AI_PACKET_JSON_SCHEMA.properties.packet.properties.social.$ref,
  "#/$defs/social",
);

const remoteImageWithoutRights = ownerAiActionPacketSchema.safeParse({
  ...basePacket,
  profile: { logoUrl: "https://example.com/logo.png" },
});
assert.equal(remoteImageWithoutRights.success, false);
assert.match(
  JSON.stringify(
    remoteImageWithoutRights.success ? [] : remoteImageWithoutRights.error.issues,
  ),
  /rights and usage affirmation/i,
);

const remoteImageWithRights = ownerAiActionPacketSchema.parse({
  ...basePacket,
  mediaRights: {
    affirmed: true,
    affirmation:
      "The restaurant owner confirms they own or have permission to use every supplied remote image.",
  },
  profile: { logoUrl: "https://example.com/logo.png" },
});
assert.equal(remoteImageWithRights.mediaRights?.affirmed, true);
assert.match(
  JSON.stringify(normalizeOwnerAiPlan(remoteImageWithRights)),
  /owner_affirmation_required_at_approval/,
);
assert.deepEqual(
  normalizeOwnerAiPlan(
    ownerAiActionPacketSchema.parse({
      schemaVersion: "1.0",
      intent: "Show every exact value",
      profile: { description: "Exact owner-approved description" },
      hours: { mon: [{ open: "09:00", close: "17:00" }] },
    }),
  ).map((entry) => entry.proposed),
  [
    { description: "Exact owner-approved description" },
    {
      mon: [{ open: "09:00", close: "17:00" }],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    },
  ],
);

const actionLinkPacket = ownerAiActionPacketSchema.parse({
  schemaVersion: "1.0",
  intent: "Update every public customer action link",
  profile: {
    menuUrl: "https://example.com/menu",
    onlineOrderingUrl: "https://example.com/order",
    deliveryUrl: "https://example.com/delivery",
    doordashUrl: "https://doordash.com/store/example",
    uberEatsUrl: "https://ubereats.com/store/example",
    toastUrl: "https://order.toasttab.com/example",
    squareUrl: "https://squareup.com/store/example",
    chowNowUrl: "https://chownow.com/order/example",
    grubhubUrl: "https://grubhub.com/restaurant/example",
    cateringInquiryUrl: "https://example.com/catering",
    truckBookingInquiryUrl: "https://example.com/book-truck",
  },
});
assert.equal(
  actionLinkPacket.profile?.truckBookingInquiryUrl,
  "https://example.com/book-truck",
);
const mergedSettings = mergeOwnerAiProfileActionLinks(
  {
    publicGalleryImages: [{ id: "gallery-1" }],
    platforms: { facebook: true },
    publicActionLinks: { deliveryUrl: "https://old.example/delivery" },
  },
  {
    menuUrl: "https://example.com/menu",
    onlineOrderingUrl: "https://example.com/order",
  },
);
assert.deepEqual(mergedSettings.publicGalleryImages, [{ id: "gallery-1" }]);
assert.deepEqual(mergedSettings.platforms, { facebook: true });
assert.equal(
  mergedSettings.publicActionLinks.deliveryUrl,
  "https://old.example/delivery",
);
assert.equal(
  mergedSettings.publicActionLinks.onlineOrderingUrl,
  "https://example.com/order",
);

const request = ownerAiDraftRequestSchema.parse({ packet: basePacket });
assert.equal(request.packet.intent, basePacket.intent);

const socialDrafts = buildOwnerAiSocialDrafts({
  draftId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
  restaurantName: "Test Kitchen",
  packet: request.packet,
});
assert.deepEqual(
  socialDrafts.map((draft) => draft.platform),
  ["facebook", "instagram", "x"],
);
for (const draft of socialDrafts) {
  assert.ok(draft.generatedMessage.length > 10);
  assert.ok(draft.selectedMessage.length > 10);
  assert.match(draft.generatedSvg, /^<svg/);
  assert.match(draft.previewUrl, /\/social-preview\/.+\.svg$/);
}
const facebookDraft = socialDrafts.find((draft) => draft.platform === "facebook")!;
assert.equal(
  facebookDraft.attemptedPayloadText,
  `${facebookDraft.selectedMessage} ${facebookDraft.link}`,
);
const fidelityDrafts = buildOwnerAiSocialDrafts({
  draftId: "33333333-3333-4333-8333-333333333333",
  restaurantId: "44444444-4444-4444-8444-444444444444",
  restaurantName: "Long Copy Kitchen",
  packet: ownerAiActionPacketSchema.parse({
    schemaVersion: "1.0",
    intent: "Prepare long social copy",
    social: {
      enabled: true,
      platforms: ["instagram", "x"],
      link: "https://www.mealscout.us/restaurant/44444444-4444-4444-8444-444444444444",
      posts: {
        instagram: { message: "I".repeat(5000) },
        x: { message: "X".repeat(5000) },
      },
    },
  }),
});
const instagramFidelity = fidelityDrafts.find((draft) => draft.platform === "instagram")!;
const xFidelity = fidelityDrafts.find((draft) => draft.platform === "x")!;
assert.equal(instagramFidelity.attemptedPayloadText.length, 2200);
assert.equal(xFidelity.attemptedPayloadText.length, 280);
assert.equal(instagramFidelity.aiSuppliedMessage?.length, 5000);
assert.equal(xFidelity.aiSuppliedMessage?.length, 5000);

const suppliedImagePacket = ownerAiActionPacketSchema.parse({
  schemaVersion: "1.0",
  intent: "Preview supplied owner media without browser hotlinks",
  mediaRights: {
    affirmed: true,
    affirmation:
      "The restaurant owner confirms they own or have permission to use every supplied remote image.",
  },
  profile: {
    logoUrl: "https://assets.example.com/logo.png",
    coverImageUrl: "https://assets.example.com/cover.jpg",
    gallery: [{ url: "https://assets.example.com/gallery.webp" }],
  },
  social: {
    enabled: true,
    platforms: ["instagram"],
    imageUrl: "https://assets.example.com/social.jpg",
  },
});
const suppliedSocialDraft = buildOwnerAiSocialDrafts({
  draftId: "55555555-5555-4555-8555-555555555555",
  restaurantId: "66666666-6666-4666-8666-666666666666",
  restaurantName: "Preview Kitchen",
  packet: suppliedImagePacket,
})[0];
assert.match(suppliedSocialDraft.previewUrl, /media-preview\/social-instagram$/);
assert.match(
  suppliedSocialDraft.fallbackPreviewUrl,
  /social-preview\/instagram\.svg$/,
);
assert.notEqual(
  suppliedSocialDraft.previewUrl,
  suppliedSocialDraft.suppliedImageUrl,
);
const mediaDescriptors = buildOwnerAiMediaPreviewDescriptors(
  "55555555-5555-4555-8555-555555555555",
  suppliedImagePacket,
);
assert.deepEqual(
  mediaDescriptors.map((entry) => entry.assetKey),
  ["profile-logo", "profile-cover", "gallery-0", "social-instagram"],
);
assert.ok(mediaDescriptors.every((entry) => entry.rightsAffirmed === true));
assert.ok(
  mediaDescriptors.every(
    (entry) =>
      !String(entry.previewUrl).includes("assets.example.com") &&
      String(entry.previewUrl).includes("/media-preview/"),
  ),
);
assert.match(
  buildOwnerAiSocialCardSvg({
    restaurantName: "A & B",
    headline: "Tacos <today>",
    subheadline: "Owner approved",
    platform: "instagram",
  }),
  /A &amp; B/,
);
assert.doesNotMatch(socialDrafts[0].generatedSvg, /approval required/i);
assert.match(socialDrafts[0].generatedSvg, /Find us on MealScout/);
assert.equal(
  ownerAiApprovalUrl(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ),
  "https://www.mealscout.us/owner-ai?restaurantId=22222222-2222-4222-8222-222222222222&ownerAiDraft=11111111-1111-4111-8111-111111111111",
);

const routes = read("server/routes/ownerAiActionRoutes.ts");
const service = read("server/services/ownerAiActions.ts");
const imageUpload = read("server/imageUpload.ts");
const pinnedImageFetch = read("server/utils/pinnedPublicImageFetch.ts");
const socialPublishing = read("server/services/socialPublishing.ts");
const migration = read("migrations/123_owner_ai_action_drafts.sql");
const routeRegistry = read("server/routes.ts");
const serverIndex = read("server/index.ts");
const restaurantOperations = read("server/routes/restaurantOperationsRoutes.ts");

assert.match(routes, /connectorAuth\("owner_ai:context"\)/);
assert.match(routes, /connectorAuth\("owner_ai:drafts:create"\)/);
assert.match(routes, /connectorAuth\("owner_ai:drafts:read"\)/);
assert.match(routes, /getOwnerAiDraftForConnector/);
assert.match(routes, /scope: "owner-ai:connector-context"/);
assert.match(routes, /scope: "owner-ai:connector-draft-create"/);
assert.match(routes, /scope: "owner-ai:connector-draft-status"/);
assert.match(
  routes,
  /req\.ownerAiConnector\?\.apiKeyId/,
  "connector limits must be keyed by the authenticated connector API key",
);
assert.match(
  routes,
  /connectorAuth\("owner_ai:context"\),\s*connectorContextLimiter/,
);
assert.match(
  routes,
  /connectorAuth\("owner_ai:drafts:create"\),\s*connectorDraftCreateLimiter/,
);
assert.match(
  routes,
  /connectorAuth\("owner_ai:drafts:read"\),\s*connectorDraftStatusLimiter/,
);
assert.match(routes, /connectorIdempotencyKey\(req\)/);
const contextOpenApi = routes.slice(
  routes.indexOf('"/api/owner-ai/connector/context"'),
  routes.indexOf('"/api/owner-ai/connector/drafts"'),
);
const createDraftOpenApi = routes.slice(
  routes.indexOf('"/api/owner-ai/connector/drafts"'),
  routes.indexOf('"/api/owner-ai/connector/drafts/{draftId}"'),
);
assert.doesNotMatch(contextOpenApi, /Idempotency-Key/);
assert.match(createDraftOpenApi, /Idempotency-Key/);
assert.doesNotMatch(
  routes,
  /\/api\/owner-ai\/connector\/[^"\n]*(approve|apply|publish)/i,
);
assert.match(routes, /"\/api\/owner-ai\/drafts\/:draftId\/approve"[\s\S]*isAuthenticated/);
assert.match(routes, /contextOffsets\(req\)/);
assert.match(
  routes,
  /"\/api\/owner-ai\/drafts\/:draftId\/media-preview\/:assetKey"[\s\S]*isAuthenticated/,
);
assert.match(routes, /X-Content-Type-Options/);
assert.match(routeRegistry, /registerOwnerAiActionRoutes\(app\)/);
assert.match(
  serverIndex,
  /const ownerAiServerToServerPaths = new Set\(\[[\s\S]*"\/api\/owner-ai\/connector\/drafts"[\s\S]*ownerAiServerToServerPaths\.has\(pathValue\)/,
);

assert.match(service, /eq\(apiKeys\.purpose, "owner_ai_connector"\)/);
assert.match(service, /eq\(restaurants\.ownerId, candidate\.userId\)/);
assert.match(
  service,
  /eq\(ownerAiActionDrafts\.connectorApiKeyId, principal\.apiKeyId\)/,
);
assert.match(service, /mergeOwnerAiProfileActionLinks/);
assert.match(service, /resolveOwnerAiDraftMediaSource/);
assert.match(service, /fetchOwnerAiRemoteImagePreview/);
for (const key of [
  "menuUrl",
  "onlineOrderingUrl",
  "deliveryUrl",
  "doordashUrl",
  "uberEatsUrl",
  "toastUrl",
  "squareUrl",
  "chowNowUrl",
  "grubhubUrl",
  "cateringInquiryUrl",
  "truckBookingInquiryUrl",
]) {
  assert.match(service, new RegExp(`"${key}"`));
}
assert.match(service, /bcrypt\.hash\(rawToken, 12\)/);
assert.match(service, /IDEMPOTENCY_KEY_REQUIRED/);
assert.match(service, /IDEMPOTENCY_KEY_REUSED/);
assert.match(service, /onConflictDoNothing\(\)/);
assert.match(service, /currentPageSize = 250/);
assert.match(service, /historyLimit = 25/);
assert.match(service, /menuPageSize = 25/);
assert.match(service, /menuCategoryPageSize = 500/);
assert.match(service, /menuItemPageSize = 1000/);
assert.match(service, /status: "approved"/);
assert.match(service, /status: "publishing"/);
assert.match(service, /\{ forUpdate: true \}/);
assert.match(
  service,
  /eq\(ownerAiActionDrafts\.status, "draft"\)[\s\S]*DRAFT_NOT_CANCELLABLE/,
);
assert.match(service, /prior publish attempt was interrupted/i);
assert.match(service, /buildOwnerAiMediaManifest/);
assert.match(service, /MEDIA_CHANGED/);
assert.match(service, /socialPublishLeaseId: leaseId/);
assert.match(service, /socialPublishLeaseExpiresAt/);
assert.doesNotMatch(
  service,
  /connected X publisher does not yet attach approved images/i,
);
assert.match(socialPublishing, /https:\/\/api\.x\.com\/2\/media\/upload/);
assert.match(socialPublishing, /media_ids: \[mediaId\]/);
assert.match(socialPublishing, /fetchPinnedPublicImage/);
assert.match(socialPublishing, /providerFetch/);
assert.match(socialPublishing, /AbortSignal\.timeout\(timeoutMs\)/);
assert.match(socialPublishing, /preventing a possible duplicate/);
assert.match(socialPublishing, /ensureXPublishingConnection/);
assert.match(socialPublishing, /grant_type: "refresh_token"/);
assert.match(restaurantOperations, /media\.write/);
assert.ok(
  service.indexOf("db.transaction") <
    service.indexOf("processApprovedSocialIntents(input.draftId)"),
  "social publishing must be invoked after the canonical transaction",
);
assert.doesNotMatch(service, /\.delete\s*\(/);

assert.match(imageUpload, /format: "png"/);
assert.match(imageUpload, /Generated social card was not returned as a public PNG/);
assert.match(imageUpload, /OWNER_AI_PREVIEW_MAX_BYTES/);
assert.match(imageUpload, /fetchPinnedPublicImage/);
assert.match(pinnedImageFetch, /resolvePublicHostname/);
assert.match(pinnedImageFetch, /hostname: address/);
assert.match(pinnedImageFetch, /servername:/);
assert.match(pinnedImageFetch, /byteLength > options\.maxBytes/);
assert.doesNotMatch(
  imageUpload,
  /OWNER_AI_PREVIEW_TYPES[\s\S]*image\/svg\+xml/,
);
assert.match(migration, /owner_ai_action_drafts/);
assert.match(migration, /media_manifest/);
assert.match(migration, /social_publish_lease_id/);
assert.match(migration, /uq_owner_ai_drafts_connector_idempotency/);
assert.match(migration, /uq_social_post_queue_owner_ai_draft_platform/);
assert.match(migration, /owner_ai_action_draft_id/);

const oldActionDiff = read("server/routes/actionRoutes.ts");
assert.match(oldActionDiff, /ACTION_API_WRITE_CONTAINMENT_CODE/);

console.log("MealScout owner AI actions contract: PASS");
