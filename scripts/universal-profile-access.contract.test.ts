import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const policy = read("shared/profileAccessPolicy.ts");
const api = read("client/src/lib/api.ts");
const premiumTrial = read("server/services/premiumTrial.ts");
const accessPolicy = read("server/routes/accessPolicyDependencies.ts");
const subscriptionRoutes = read("server/routes/subscriptionRoutes.ts");
const menuRoutes = read("server/routes/menuRoutes.ts");
const hostRoutes = read("server/routes/hostRoutes.ts");
const restaurantSignupRoutes = read("server/routes/restaurantSignupRoutes.ts");
const parkingPass = read("client/src/pages/parking-pass.tsx");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

requireIncludes(
  policy,
  "export const UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE = true;",
  "The product-wide free-trial switch must remain explicitly active.",
);
requireIncludes(
  premiumTrial,
  "if (user && UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE) return true;",
  "Existing profiles must be treated as trial-active without stored expiration dates.",
);
requireIncludes(
  accessPolicy,
  'subscriptionTier: "universal_trial"',
  "Analytics access must honor the universal profile trial.",
);
requireIncludes(
  accessPolicy,
  "return { isValid: true, currentCount: 0, maxDeals: 999 };",
  "Deal publishing must honor the universal profile trial.",
);
requireIncludes(
  subscriptionRoutes,
  "universalTrial: true",
  "Subscription status must advertise universal trial access to existing clients.",
);
requireIncludes(
  subscriptionRoutes,
  "hasAccess: UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE || hasPaidAccess",
  "A stale paid subscription must not revoke universal trial access.",
);
requireIncludes(
  subscriptionRoutes,
  "billingStatusUnavailable: true",
  "A billing outage must not revoke universal trial access.",
);
requireIncludes(
  menuRoutes,
  "if (UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE) return true;",
  "Online-ordering readiness must not fail on subscription state during the trial.",
);
requireIncludes(
  api,
  'return normalizedPath.startsWith("/api/");',
  "MealScout account APIs must stay same-origin so the session cookie is present.",
);
requireIncludes(
  hostRoutes,
  "const shouldBypassVerificationGate = isStaffOrAdminUser(req.user);",
  "Parking Pass must preserve the staff and super-admin verification bypass.",
);
requireIncludes(
  restaurantSignupRoutes,
  "!isStaffOrAdminUserType(user.userType)",
  "Business setup must not block a staff or super-admin account on verification.",
);
requireIncludes(
  parkingPass,
  "const hasPremiumTruckTools = canManageParkingPass;",
  "Parking Pass tools must depend on permissions rather than subscription status.",
);
requireIncludes(
  parkingPass,
  "!isAdminOrStaff &&",
  "Parking Pass must not show verification-required UI to a super admin.",
);
requireIncludes(
  parkingPass,
  '? "Admin access"',
  "Parking Pass status must present the verification bypass to a super admin.",
);

for (const clientPath of [
  "client/src/pages/deal-creation.tsx",
  "client/src/pages/event-coordinator-dashboard.tsx",
  "client/src/pages/hiring.tsx",
  "client/src/pages/parking-pass.tsx",
  "client/src/pages/pensacola-spots.tsx",
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "client/src/pages/truck-discovery.tsx",
]) {
  const source = read(clientPath);
  if (source.includes('queryKey: ["/api/subscription/status"]')) {
    throw new Error(`${clientPath} still gates operating tools through subscription status.`);
  }
}

console.log("universal-profile-access.contract: PASS");
