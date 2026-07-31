import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) throw new Error(message);
};

const policy = read("shared/profileAccessPolicy.ts");
const premiumTrial = read("server/services/premiumTrial.ts");
const accessPolicy = read("server/routes/accessPolicyDependencies.ts");
const subscriptionRoutes = read("server/routes/subscriptionRoutes.ts");
const pickupOrders = read("server/routes/pickupOrderRoutes.ts");
const menuRoutes = read("server/routes/menuRoutes.ts");
const storiesRoutes = read("server/storiesRoutes.ts");
const featuredVideoCron = read("server/featuredVideoCron.ts");
const stripeWebhookRoutes = read("server/routes/stripeWebhookRoutes.ts");
const parkingPass = read("client/src/pages/parking-pass.tsx");
const profileAccessPage = read("client/src/pages/subscribe.tsx");
const adminDashboard = read("client/src/pages/admin-dashboard.tsx");
const adminUserRoutes = read("server/routes/admin/userAdminRoutes.ts");
const adminCoreOpsRoutes = read("server/routes/admin/adminCoreOpsRoutes.ts");
const affiliateCommissionService = read("server/affiliateCommissionService.ts");
const legacyRetirement = read("scripts/retireLegacyProfileSubscriptions.ts");
const restaurantsDealsRepository = read(
  "server/storage/restaurantsDealsRepository.ts",
);
const schedulers = read("server/bootstrap/registerSchedulers.ts");

for (const [snippet, message] of [
  ['label: "Free trial"', "The profile product must remain labeled as a free trial."],
  ["expires: false", "The free trial must not expire."],
  ["cardRequired: false", "The free trial must not require a card."],
  ["convertsToPaid: false", "The free trial must not convert to a paid plan."],
  [
    "monthlySubscriptionEnabled: false",
    "Monthly profile subscriptions must remain disabled.",
  ],
] as const) {
  requireIncludes(policy, snippet, message);
}

requireIncludes(
  premiumTrial,
  'return Boolean(user && PROFILE_ACCESS_POLICY.status === "active");',
  "Existing accounts must receive non-expiring profile access without stored trial dates.",
);
requireExcludes(
  premiumTrial,
  "trialEndsAt",
  "Runtime profile access must not depend on a trial expiration date.",
);

requireIncludes(
  accessPolicy,
  'subscriptionTier: "profile_free_trial"',
  "Analytics must identify the canonical profile free trial.",
);
requireExcludes(
  accessPolicy,
  "stripe.subscriptions.retrieve",
  "Profile tools must not call Stripe to decide access.",
);
requireIncludes(
  accessPolicy,
  "const user = await storage.getUser(key);",
  "Profile access must still require a real, enabled owner account.",
);
requireExcludes(
  accessPolicy,
  "const hasAccess = true;",
  "Profile access must not republish content for missing or disabled owners.",
);

for (const snippet of [
  "subscriptionRequired: false",
  "cardRequired: false",
  "convertsToPaid: false",
  "monthlyBilling: false",
  "trialEndsAt: null",
]) {
  requireIncludes(
    subscriptionRoutes,
    snippet,
    `Compatibility status is missing ${snippet}.`,
  );
}
requireExcludes(
  subscriptionRoutes,
  "stripe.subscriptions.create",
  "A compatibility route must never create a recurring subscription.",
);
requireExcludes(
  subscriptionRoutes,
  "PRICE_MONTHLY",
  "Monthly Stripe price configuration must not drive profile access.",
);
requireIncludes(
  subscriptionRoutes,
  "await stripe.subscriptions.cancel(legacySubscriptionId);",
  "Owners must be able to stop a remaining legacy recurring charge.",
);

requireExcludes(
  pickupOrders,
  "assertHasOrderingSubscription",
  "Ordering must not be gated by a monthly profile subscription.",
);
requireIncludes(
  pickupOrders,
  "PICKUP_ORDER_MEALSCOUT_FEE_CENTS",
  "The separate per-order fee path must remain intact.",
);
requireExcludes(
  menuRoutes,
  "restaurantSubscriptions",
  "Ordering readiness must not inspect profile-subscription rows.",
);
requireIncludes(
  menuRoutes,
  'id: "profile_owner"',
  "Ordering readiness may still require an accountable profile owner.",
);

requireExcludes(
  storiesRoutes,
  "restaurantSubscriptions",
  "Video posting must not read or write subscription tiers.",
);
requireIncludes(
  storiesRoutes,
  "Complete profiles include video posting.",
  "Video posting must be governed by profile ownership and safety limits.",
);
requireExcludes(
  featuredVideoCron,
  "restaurantSubscriptions",
  "Featured-video rotation must not select profiles by subscription tier.",
);

requireExcludes(
  stripeWebhookRoutes,
  ".update(deals)",
  "A legacy subscription event must never deactivate a profile's deals.",
);

requireExcludes(
  parkingPass,
  'queryKey: ["/api/subscription/status"]',
  "Parking Pass tools must not query subscription status.",
);
requireIncludes(
  parkingPass,
  "const hasProfileTruckTools = canManageParkingPass;",
  "Parking Pass tools must depend on business permissions, not billing.",
);

for (const snippet of [
  "Free trial active",
  "No expiration",
  "No card required",
  "No monthly bill",
  "button-open-complete-profile",
]) {
  requireIncludes(
    profileAccessPage,
    snippet,
    `The profile-access page is missing ${snippet}.`,
  );
}
for (const forbidden of [
  "@stripe/react-stripe-js",
  "loadStripe",
  "/api/create-subscription",
  "PaymentElement",
]) {
  requireExcludes(
    profileAccessPage,
    forbidden,
    `The profile-access page still exposes retired checkout code: ${forbidden}.`,
  );
}

requireExcludes(
  adminDashboard,
  "button-send-subscription-",
  "Admin must not offer monthly subscription links.",
);
requireIncludes(
  adminUserRoutes,
  "Monthly subscriptions are retired.",
  "The retired admin subscription-link endpoint must fail safely.",
);
requireIncludes(
  adminCoreOpsRoutes,
  "Recurring profile subscriptions are retired.",
  "The retired Stripe subscription-sync endpoint must fail safely.",
);
requireExcludes(
  adminCoreOpsRoutes,
  "stripe.subscriptions.list",
  "Admin must not restore legacy recurring subscriptions from Stripe.",
);
requireExcludes(
  affiliateCommissionService,
  "createAffiliateCommissionsForSubscription",
  "New affiliate commissions must not derive from a profile subscription.",
);
requireExcludes(
  restaurantsDealsRepository,
  "subscriptionBillingInterval",
  "Discovery must not contain a dormant monthly-subscription filter.",
);
requireIncludes(
  schedulers,
  "eq(users.isDisabled, false)",
  "Profile activity summaries must exclude disabled owners.",
);

requireIncludes(
  legacyRetirement,
  'const apply = process.argv.includes("--apply");',
  "Legacy-billing cleanup must default to a reviewable dry run.",
);
requireIncludes(
  legacyRetirement,
  "stripe!.subscriptions.cancel(subscriptionId)",
  "Legacy-billing cleanup must stop remaining recurring charges.",
);
requireExcludes(
  legacyRetirement,
  "deals",
  "Legacy-billing cleanup must not change public profile content.",
);

const publicCopyPaths = [
  "client/src/content/role-landing.ts",
  "client/src/copy/hostOnboarding.copy.ts",
  "client/src/pages/faq.tsx",
  "client/src/pages/how-it-works.tsx",
  "client/src/pages/hiring.tsx",
  "client/src/pages/privacy-policy.tsx",
  "client/src/pages/terms-of-service.tsx",
  "server/bootstrap/registerStaticPages.ts",
  "server/services/pensacolaFoodTruckDrip.ts",
  "server/services/pensacolaReportDrip.ts",
  "server/services/pensacolaReportPdf.ts",
];
const forbiddenPublicClaims = [
  "$25/month",
  "$25/mo",
  "30-day premium trial",
  "Premium subscription required",
  "Upgrade anytime to premium",
];
for (const path of publicCopyPaths) {
  const source = read(path);
  for (const claim of forbiddenPublicClaims) {
    requireExcludes(
      source,
      claim,
      `${path} still contains retired monthly-gate copy: ${claim}`,
    );
  }
}

console.log("universal-profile-access.contract: PASS");
