import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredRouteSnippets = [
  '"/api/admin/launch-board"',
  "isStaffOrAdmin",
  "profilesTotal",
  "claimableProfiles",
  "claimedProfiles",
  "profilesWithMenu",
  "profilesWithSchedule",
  "profilesWithContact",
  "profilesWithPhotoLogo",
  "activeFoodTrucks",
  "activeHosts",
  "parkingPassListings",
  "bookingStarts",
  "bookingConfirmations",
  "publicProfileViews",
  "publicProfileActions",
  "affiliateLinkOpens",
];

for (const snippet of requiredRouteSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Launch board route missing required snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  'value="launch-board"',
  "One-Market Launch Board",
  'queryKey: ["/api/admin/launch-board", launchBoardCity]',
  "Select market city",
  "Profiles Total",
  "Claimable Profiles",
  "Booking Confirmations",
  "Affiliate Link Opens",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Admin dashboard missing launch board snippet: ${snippet}`);
  }
}

console.log("mealscout-one-market-launch-board.contract: PASS");
