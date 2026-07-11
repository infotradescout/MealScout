import { readFileSync } from "node:fs";

const mediaRoutes = readFileSync("server/routes/mediaRoutes.ts", "utf8");
const publicMapper = readFileSync(
  "server/publicProfiles/toPublicRestaurantProfile.ts",
  "utf8",
);
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

const requiredMediaRouteSnippets = [
  '"/api/upload/restaurant-gallery"',
  "allowedCategories",
  "publicApproved: isTrustedUploader",
  "approvalStatus: galleryEntry.publicApproved ? \"approved\" : \"pending\"",
  '"/api/restaurants/:restaurantId/media-gallery/:mediaId"',
  "requestedApproval !== undefined && isStaffOrAdmin",
  "publicGalleryImages",
];

for (const snippet of requiredMediaRouteSnippets) {
  if (!mediaRoutes.includes(snippet)) {
    throw new Error(
      `Media upload/approval route contract missing required snippet: ${snippet}`,
    );
  }
}

if (!publicMapper.includes("row?.socialAutopostSettings?.publicGalleryImages")) {
  throw new Error(
    "Public mapper contract missing socialAutopostSettings.publicGalleryImages fallback",
  );
}

if (!publicMapper.includes("const publicApproved = Boolean(entry?.publicApproved);")) {
  throw new Error("Public mapper contract missing strict approved-only media gate");
}

if (!publicMapper.includes("if (!publicApproved) return null;")) {
  throw new Error("Public mapper contract missing unapproved media exclusion");
}

const requiredDashboardSnippets = [
  "Media manager",
  "Upload logo",
  "Upload cover",
  "Upload gallery image",
  "Approve",
  "Set pending",
  "publicGalleryImages",
];

for (const snippet of requiredDashboardSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(
      `Owner dashboard media manager contract missing required snippet: ${snippet}`,
    );
  }
}

console.log("profile-media-approval.contract: PASS");
