import assert from "node:assert/strict";

import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";
import { reconcileOwnerConfirmedEvidenceQuarantine } from "../server/services/profileEvidenceQuarantine";

const baseUrl = "https://www.mealscout.us";
const quarantinedRawData = {
  unrelatedAudit: { preserved: true },
  evidenceQuarantine: {
    status: "quarantined",
    decisions: {
      contact_phone: { status: "rejected", reason: "awaiting owner" },
      website_link: { status: "rejected", reason: "awaiting owner" },
      social_links: { status: "rejected", reason: "awaiting owner" },
    },
  },
};
const baseRow = {
  id: "owner-reviewed-quarantine",
  name: "Owner Reviewed Truck",
  businessType: "food_truck",
  isFoodTruck: true,
  isActive: true,
  phone: "850-555-0199",
  websiteUrl: "https://owner-reviewed.example/",
  facebookPageUrl: "https://facebook.com/owner-reviewed",
  instagramUrl: "https://instagram.com/unreviewed-sibling",
  xUrl: "https://x.com/unreviewed-sibling",
  rawData: quarantinedRawData,
};

const beforeReview = toPublicRestaurantProfile({ baseUrl, row: baseRow });
assert.equal(beforeReview.phonePublic, null);
assert.equal(beforeReview.websiteUrl, null);
assert.equal(beforeReview.socialLinks.facebookPageUrl, null);

const phoneRawData = reconcileOwnerConfirmedEvidenceQuarantine({
  rawData: quarantinedRawData,
  field: "phone",
  proposalId: "phone-proposal",
  actorUserId: "owner-1",
  decidedAt: "2026-07-22T18:00:00.000Z",
});
assert.ok(phoneRawData);
assert.deepEqual(phoneRawData.unrelatedAudit, { preserved: true });
assert.equal(
  ((phoneRawData.evidenceQuarantine as any).decisions.contact_phone as any)
    .status,
  "accepted",
  "confirming the already-current phone must still resolve its quarantine trust decision",
);
const afterPhoneReview = toPublicRestaurantProfile({
  baseUrl,
  row: { ...baseRow, rawData: phoneRawData },
});
assert.equal(afterPhoneReview.phonePublic, "850-555-0199");
assert.equal(afterPhoneReview.websiteUrl, null);
assert.equal(afterPhoneReview.socialLinks.facebookPageUrl, null);

const websiteRawData = reconcileOwnerConfirmedEvidenceQuarantine({
  rawData: phoneRawData,
  field: "websiteUrl",
  proposalId: "website-proposal",
  actorUserId: "owner-1",
  decidedAt: "2026-07-22T18:01:00.000Z",
});
assert.ok(websiteRawData);
const afterWebsiteReview = toPublicRestaurantProfile({
  baseUrl,
  row: { ...baseRow, rawData: websiteRawData },
});
assert.equal(afterWebsiteReview.phonePublic, "850-555-0199");
assert.equal(
  afterWebsiteReview.websiteUrl,
  "https://owner-reviewed.example/",
);

const facebookRawData = reconcileOwnerConfirmedEvidenceQuarantine({
  rawData: websiteRawData,
  field: "facebookPageUrl",
  proposalId: "facebook-proposal",
  actorUserId: "owner-1",
  decidedAt: "2026-07-22T18:02:00.000Z",
});
assert.ok(facebookRawData);
const afterFacebookReview = toPublicRestaurantProfile({
  baseUrl,
  row: { ...baseRow, rawData: facebookRawData },
});
assert.equal(
  afterFacebookReview.socialLinks.facebookPageUrl,
  "https://facebook.com/owner-reviewed",
);
assert.equal(afterFacebookReview.socialLinks.instagramUrl, null);
assert.equal(afterFacebookReview.socialLinks.xUrl, null);

assert.equal(
  reconcileOwnerConfirmedEvidenceQuarantine({
    rawData: quarantinedRawData,
    field: "description",
    proposalId: "description-proposal",
    actorUserId: "owner-1",
    decidedAt: "2026-07-22T18:03:00.000Z",
  }),
  null,
);

console.log("profile-evidence-public-projection.behavior: PASS");
