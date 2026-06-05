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
const serverIndex = readFileSync("server/index.ts", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const combined = `${audit}\n${useAuth}\n${app}\n${customerSignup}\n${login}\n${share}\n${serverIndex}\n${unifiedAuth}`;

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
].forEach((snippet) => requireIncludes(audit, snippet, `audit ${snippet}`));

[
  "export function getStoredAffiliateRef",
  "affiliate_ref",
  "setAffiliateRef",
].forEach((snippet) => requireIncludes(share, snippet, `share helper ${snippet}`));

[
  "function captureUrlAffiliateRef",
  'urlParams.get("ref")',
  "if (ref) setAffiliateRef(ref)",
  "if (!user) return;",
  "isInternalAdmin",
  'setAffiliateRef(null)',
  "user?.affiliateTag || user?.id",
].forEach((snippet) => requireIncludes(useAuth, snippet, `useAuth ref guard ${snippet}`));

const userUndefinedClearPattern =
  /if\s*\(!user\)[\s\S]{0,80}setAffiliateRef\(null\)/;
if (userUndefinedClearPattern.test(useAuth)) {
  throw new Error("Guest referral ref must not be cleared when user is undefined.");
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

if (!app.includes('<Route path="/scout" component={ScoutPage} />')) {
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
  "protected account endpoints",
  "/api/affiliate/tag",
  "/api/business-access/me",
].forEach((snippet) => requireIncludes("protected account endpoints /api/affiliate/tag /api/business-access/me", snippet));

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
