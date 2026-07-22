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
const ownerProfileWorkspace = readFileSync(
  "client/src/components/owner-profile-workspace.tsx",
  "utf8",
);

const requiredMediaRouteSnippets = [
  '"/api/upload/restaurant-gallery"',
  "allowedCategories",
  "publicApproved: isTrustedUploader",
  'approvalStatus: galleryEntry.publicApproved ? "approved" : "pending"',
  '"/api/restaurants/:restaurantId/media-gallery/:mediaId"',
  "input.publicApproved !== undefined && input.canModerate",
  "withLockedRestaurantSettings(",
  "publicGalleryImages",
];

for (const snippet of requiredMediaRouteSnippets) {
  if (!mediaRoutes.includes(snippet)) {
    throw new Error(
      `Media upload/approval route contract missing required snippet: ${snippet}`,
    );
  }
}

if (
  !publicMapper.includes("row?.socialAutopostSettings?.publicGalleryImages")
) {
  throw new Error(
    "Public mapper contract missing socialAutopostSettings.publicGalleryImages fallback",
  );
}

if (
  !publicMapper.includes(
    "const publicApproved = Boolean(entry?.publicApproved);",
  )
) {
  throw new Error(
    "Public mapper contract missing strict approved-only media gate",
  );
}

if (!publicMapper.includes("if (!publicApproved) return null;")) {
  throw new Error("Public mapper contract missing unapproved media exclusion");
}

const requiredDashboardSnippets = [
  "publicGalleryImages",
  "<OwnerProfileWorkspace",
];

for (const snippet of requiredDashboardSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(
      `Owner dashboard media manager contract missing required snippet: ${snippet}`,
    );
  }
}

for (const snippet of [
  "Cover photo",
  "Replace logo",
  "Add logo",
  "Food and business photos",
  "Add photo",
  "Approve",
  "Set pending",
  "Visible",
  "Pending",
]) {
  if (!ownerProfileWorkspace.includes(snippet)) {
    throw new Error(
      `Owner photos workspace contract missing required snippet: ${snippet}`,
    );
  }
}

console.log("profile-media-approval.contract: PASS");
