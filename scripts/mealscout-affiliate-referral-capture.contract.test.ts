import { existsSync, readFileSync } from "node:fs";

const auditPath = "MEALSCOUT_AFFILIATE_REFERRAL_CAPTURE_AUDIT.md";

if (!existsSync(auditPath)) {
  throw new Error("MEALSCOUT_AFFILIATE_REFERRAL_CAPTURE_AUDIT.md must exist.");
}

const audit = readFileSync(auditPath, "utf8");
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const app = readFileSync("client/src/App.tsx", "utf8");
const customerSignup = readFileSync("client/src/pages/customer-signup.tsx", "utf8");
const login = readFileSync("client/src/pages/login.tsx", "utf8");
const share = readFileSync("client/src/lib/share.ts", "utf8");
const api = readFileSync("client/src/lib/api.ts", "utf8");
const serverIndex = readFileSync("server/index.ts", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const authAudit = readFileSync("MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md", "utf8");
const combined = `${audit}\n${useAuth}\n${app}\n${customerSignup}\n${login}\n${share}\n${api}\n${serverIndex}\n${unifiedAuth}\n${authAudit}`;

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

[
  "/scout?ref=<tag>` is a valid public route",
  "Guest `?ref=<tag>` values must be captured and preserved",
  "Guest referral refs must not be cleared merely because `/api/auth/user` returns 401 or `user` is undefined",
  "Internal `admin`, `duper_admin`, and `super_admin` accounts must not be affiliate-assigned through a public `ref`",
  "`ref` is referral metadata only",
  "Protected account endpoints such as `/api/affiliate/tag` and `/api/business-access/me` must wait for confirmed auth",
].forEach((snippet) => requireIncludes(audit, snippet, `audit ${snippet}`));

[
  "export function getStoredAffiliateRef",
  "affiliate_ref",
  "setAffiliateRef",
].forEach((snippet) => requireIncludes(share, snippet, `share helper ${snippet}`));

[
  "function captureUrlAffiliateRef",
  'urlParams.get("ref")',
  "isLikelyCleanAffiliateTagSegment(ref)",
  "setAffiliateRef(ref)",
  "if (!user) return;",
  "isInternalAdmin",
  'setAffiliateRef(null)',
  "const affiliateTag = String(user?.affiliateTag || \"\").trim();",
  "isLikelyCleanAffiliateTagSegment(affiliateTag)",
].forEach((snippet) => requireIncludes(useAuth, snippet, `useAuth ref guard ${snippet}`));

const userUndefinedClearPattern =
  /if\s*\(!user\)[\s\S]{0,80}setAffiliateRef\(null\)/;
if (userUndefinedClearPattern.test(useAuth)) {
  throw new Error("Guest referral ref must not be cleared when user is undefined.");
}

const unguardedSetAffiliateRefNull = useAuth
  .split(/\r?\n/)
  .map((line, index) => ({ line, lineNumber: index + 1 }))
  .filter(({ line }) => line.includes("setAffiliateRef(null)"))
  .filter(({ line }) => !/isInternalAdmin|admin/i.test(line));
for (const occurrence of unguardedSetAffiliateRefNull) {
  const nearby = useAuth
    .split(/\r?\n/)
    .slice(Math.max(0, occurrence.lineNumber - 5), occurrence.lineNumber + 2)
    .join("\n");
  if (!nearby.includes("isInternalAdmin")) {
    if (
      !nearby.includes("isLikelyCleanAffiliateTagSegment(affiliateTag)")
    ) {
      throw new Error(`setAffiliateRef(null) must stay limited to internal admin cleanup or invalid clean-tag cleanup, found near line ${occurrence.lineNumber}.`);
    }
  }
}

const oauthFailureSections = [
  useAuth.slice(useAuth.indexOf("if (!result.data)"), useAuth.indexOf("setOauthConfirmationPending(false);", useAuth.indexOf("if (!result.data)") + 1)),
  useAuth.slice(useAuth.indexOf(".catch(() =>"), useAuth.indexOf("setLocation(\"/login?error=session_not_completed\")", useAuth.indexOf(".catch(() =>"))),
];
for (const section of oauthFailureSections) {
  if (section.includes("setAffiliateRef(null)")) {
    throw new Error("OAuth/session recovery must not clear guest referral ref.");
  }
}

if (!app.includes('<Route path="/scout" component={ScoutPageV2} />')) {
  throw new Error("/scout route must exist and remain public-route valid with query params.");
}

if (!app.includes('"/scout"')) {
  throw new Error("/scout must remain inventoried as a public route.");
}

[
  "getReferralId",
  "getStoredAffiliateRef()",
  "preserveReferralHref",
  "url.searchParams.set(\"ref\", ref)",
  "referralId: getReferralId()",
].forEach((snippet) => requireIncludes(customerSignup, snippet, `customer signup referral preservation ${snippet}`));

[
  "getStoredAffiliateRef",
  "setAffiliateRef",
  "url.searchParams.set(\"ref\", storedRef)",
  "buildAuthPath(\"/api/auth/google/customer\")",
  "buildAuthPath(\"/api/auth/facebook?userType=customer\")",
].forEach((snippet) => requireIncludes(login, snippet, `login referral preservation ${snippet}`));

[ 
  "Capture affiliate `?ref=` on *all* requests",
  "req.query?.ref",
  "resolvedBusiness.status !== \"unique\"",
  'res.cookie("referralId"',
].forEach((snippet) => requireIncludes(serverIndex, snippet, `server referral capture ${snippet}`));

[
  "async function applyAffiliateReferral",
  "if (isAdminUserType(user.userType)) return;",
  "req.body?.referralId",
  "req.cookies?.referralId",
  "resolveAffiliateUserId(ref)",
].forEach((snippet) => requireIncludes(unifiedAuth, snippet, `server affiliate guard ${snippet}`));

[
  'return normalizedPath.startsWith("/api/");',
  "if (isMealScoutHost && isMealScoutSameOriginPath(path))",
].forEach((snippet) => requireIncludes(api, snippet, `api same-origin account guard ${snippet}`));

[
  "Protected account endpoints such as `/api/affiliate/tag` and `/api/business-access/me` must wait for confirmed auth",
  "OAuth success query params are hints only; `/api/auth/user` is the only confirmed signed-in state",
].forEach((snippet) => requireIncludes(authAudit, snippet, `auth audit protected endpoint ${snippet}`));

[
  "new role",
  "new diner role",
  "payout logic",
  "fake affiliate tags",
  "new product feature",
].forEach((forbidden) => {
  const offenders = combined
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(forbidden.toLowerCase()))
    .filter((line) => !/(no |not |do not|must not|without|disallowed)/i.test(line));
  if (offenders.length) {
    throw new Error(`Affiliate referral capture appears to introduce forbidden scope: ${offenders[0]}`);
  }
});

console.log("mealscout-affiliate-referral-capture.contract: PASS");
