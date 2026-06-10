import { readFileSync } from "node:fs";

const doctrine = readFileSync("MEALSCOUT_UI_DOCTRINE.md", "utf8");
const lifecycleAudit = readFileSync(
  "MEALSCOUT_ACCOUNT_LIFECYCLE_DISCOVERY_AUDIT.md",
  "utf8",
);
const adminAffiliateAudit = readFileSync(
  "MEALSCOUT_ADMIN_USER_AFFILIATE_MANAGEMENT_AUDIT.md",
  "utf8",
);
const affiliateEarnings = readFileSync(
  "client/src/pages/AffiliateEarnings.tsx",
  "utf8",
);
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const publicProfile = readFileSync(
  "client/src/pages/public-profile.tsx",
  "utf8",
);

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) throw new Error(message);
};

[
  "Affiliate is not a MealScout user role.",
  "Affiliate sharing is a universal attribution and campaign capability",
  "User = identity",
  "Role = authority",
  "Intent = current job",
  "Affiliate = attribution/campaign layer",
  "Affiliate sharing",
  "Claim/update",
  "Save/follow",
  "Report issue",
  "Submit evidence",
  "Do not use `role=affiliate` signup or routing.",
  "Every eligible internal link shared by an authenticated user can become an attributed share link.",
  "destination ownership is not required",
  "Destination validity is required",
  "/<safe-internal-path>/<tag>",
  "tracking separate from payout",
].forEach((snippet) =>
  requireIncludes(
    doctrine,
    snippet,
    `Doctrine missing required snippet: ${snippet}`,
  ),
);

[
  "Visitor",
  "Truck Owner",
  "Host",
  "Staff",
  "Admin",
  "Public profile",
  "Share Hub",
  "Owner dashboard",
  "Host dashboard",
  "Admin user card",
  "Scout/discovery",
].forEach((snippet) =>
  requireIncludes(
    doctrine,
    snippet,
    `Role/capability matrix missing: ${snippet}`,
  ),
);

requireIncludes(
  lifecycleAudit,
  "Affiliate is not a standalone account role in MealScout.",
  "Lifecycle audit must document affiliate as attribution/campaign layer.",
);
requireIncludes(
  lifecycleAudit,
  "?intent=affiliate-sharing",
  "Lifecycle audit must allow affiliate intent without role=affiliate.",
);
requireIncludes(
  adminAffiliateAudit,
  "Affiliate is not a standalone user role.",
  "Admin affiliate audit must not model affiliate as a role.",
);
requireIncludes(
  adminAffiliateAudit,
  "Role authority controls permissions; affiliate state controls attribution tools.",
  "Admin affiliate audit must separate role authority from affiliate state.",
);

requireExcludes(
  affiliateEarnings,
  "role=affiliate",
  "Affiliate earnings signup CTA must not route through role=affiliate.",
);
requireIncludes(
  affiliateEarnings,
  "intent=affiliate-sharing",
  "Affiliate earnings signup CTA should express affiliate as intent/capability.",
);

requireIncludes(
  shareHub,
  'fetch("/api/auth/user"',
  "Share Hub must derive sharing from existing authenticated user state.",
);
requireIncludes(
  shareHub,
  "!isAuthenticated || !normalizeShareHubTargetPath(item.href)",
  "Share Hub must gate tools on authentication and safe eligible targets, not custom vanity tag setup.",
);
requireIncludes(
  shareHub,
  "Tracked links are ready. Add a custom share tag later if you want cleaner links.",
  "Share Hub must show that tracked links are ready even when no vanity tag is configured.",
);
requireExcludes(
  shareHub,
  "role=affiliate",
  "Share Hub must not model affiliate as a route or role.",
);

requireIncludes(
  publicProfile,
  "<QuickActionRow profile={data} safeCtas={safeCtas} />",
  "Public profile hierarchy must keep business-critical intent actions visible.",
);
requireIncludes(
  publicProfile,
  "<RestaurantSocial profile={restaurantProfile} safeCtas={safeCtas} />",
  "Public profile must keep secondary sharing/social capabilities accessible.",
);

console.log("mealscout-affiliate-capability-doctrine.contract: PASS");
