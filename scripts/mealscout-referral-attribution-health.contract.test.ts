import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTrackedAttributedPath,
  buildTrackedAttributedUrl,
} from "../server/shareTargetPolicy";

const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const sharePolicy = readFileSync("server/shareTargetPolicy.ts", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");
const useAuthSource = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const customerSignupSource = readFileSync(
  "client/src/pages/customer-signup.tsx",
  "utf8",
);
const loginSource = readFileSync("client/src/pages/login.tsx", "utf8");
const serverIndex = readFileSync("server/index.ts", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const referralRedirect = readFileSync(
  "client/src/pages/referral-redirect.tsx",
  "utf8",
);

function requireIncludes(source: string, snippet: string, label: string) {
  assert(source.includes(snippet), `Missing ${label}: ${snippet}`);
}

// 1) Generate referral
[
  'app.post("/api/share/generate", async (req: any, res) =>',
  "normalizeInternalShareTarget(path)",
  "isEligibleInternalShareTarget(sharePath)",
  "buildTrackedAttributedUrl(",
  "attributionMode",
].forEach((snippet) =>
  requireIncludes(shareRoutes, snippet, "share generation step"),
);

[
  "sanitizeTrackedTargetPath",
  "parsed.searchParams.delete(\"to\")",
  "parsed.searchParams.delete(\"ref\")",
  "buildDirectAttributedPath",
].forEach((snippet) =>
  requireIncludes(sharePolicy, snippet, "canonical attribution builder"),
);

// 2) Simulate click / landing capture
[
  "Capture affiliate `?ref=` on *all* requests before the SPA/static handlers run.",
  "const ref = typeof req.query?.ref === \"string\" ? req.query.ref.trim() : \"\";",
  'res.cookie("referralId", ref, {',
].forEach((snippet) =>
  requireIncludes(serverIndex, snippet, "server referral capture middleware"),
);

[
  "function captureUrlAffiliateRef()",
  'urlParams.get("ref")',
  "extractPathAffiliateRef(window.location.pathname || \"\")",
  "if (ref) setAffiliateRef(ref)",
].forEach((snippet) =>
  requireIncludes(useAuthSource, snippet, "client landing capture"),
);

// 3) Signup attribution
[
  "const getReferralId = () =>",
  "getStoredAffiliateRef()",
  "referralId: getReferralId()",
].forEach((snippet) =>
  requireIncludes(customerSignupSource, snippet, "signup attribution handoff"),
);

[
  "getStoredAffiliateRef",
  "url.searchParams.set(\"ref\", storedRef)",
].forEach((snippet) =>
  requireIncludes(loginSource, snippet, "login attribution continuity"),
);

// 4) Account creation + login persistence
[
  "async function applyAffiliateReferral(req: any, user: User)",
  "if (isAdminUserType(user.userType)) return;",
  "typeof req.body?.referralId === \"string\"",
  "typeof req.cookies?.referralId === \"string\"",
  "const affiliateUserId = await resolveAffiliateUserId(ref);",
  "affiliateCloserUserId: affiliateUserId",
].forEach((snippet) =>
  requireIncludes(unifiedAuth, snippet, "server attribution persistence"),
);

[
  "setAffiliateRef(user.affiliateTag || user.id)",
  "if (!user) return;",
].forEach((snippet) =>
  requireIncludes(useAuthSource, snippet, "post-login attribution persistence"),
);

// Compatibility layers stay available while canonical generation remains clean.
[
  '<Route path="/customer-signup/:refTag" component={CustomerSignup} />',
  '<Route path="/claim-truck/:refTag" component={ClaimTruckPage} />',
  '<Route path="/directory/:refTag" component={ScoutPage} />',
  '<Route path="/ref/:tag" component={ReferralRedirect} />',
].forEach((snippet) =>
  requireIncludes(appSource, snippet, "compatibility routing"),
);

[
  "normalizeReferralTarget",
  "url.searchParams.set(\"ref\", tag)",
  "setLocation(`${url.pathname}${url.search}${url.hash}`)",
].forEach((snippet) =>
  requireIncludes(referralRedirect, snippet, "legacy redirect compatibility"),
);

// Guard against regression back to nested wrappers in generated links.
const generated = [
  buildTrackedAttributedPath("health-tag", "/customer-signup?role=business"),
  buildTrackedAttributedPath("health-tag", "/claim-truck"),
  buildTrackedAttributedPath("health-tag", "/directory"),
  buildTrackedAttributedUrl("https://www.mealscout.us", "health-tag", "/directory"),
].join("\n");
for (const forbidden of ["role=business", "to=", "%2F", "/ref/"]) {
  assert.equal(
    generated.includes(forbidden),
    false,
    `Generated attribution helpers must reject forbidden output fragment: ${forbidden}`,
  );
}

console.log("mealscout-referral-attribution-health.contract: PASS");
