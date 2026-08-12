import { readFileSync } from "node:fs";

const postVerification = readFileSync("client/src/pages/post-verification.tsx", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");

const requiredPostVerificationSnippets = [
  'app.post("/api/auth/verification-status"',
  "I verified, log in",
  "handleVerifiedContinue",
  'title: "Email not verified yet"',
  "const isBarSetup",
  'label: "Bar setup"',
  '"Personal login", "Bar profile", "AI-prepared setup", "Owner approval"',
  'data-testid="post-verification-owner-ai-handoff"',
  "Sign your favorite AI into MealScout and connect the social",
  "apply and publish only after the actual owner approves that",
  "Food menu (if serves food)",
  "Host food trucks (if enabled)",
  "const redirectBusinessType",
  "window.location.href = loginHref",
];

const forbiddenBarBaseSnippets = [
  '"Personal login", "Business profile", "AI-prepared setup", "Owner approval"',
];

const requiredAuthSnippets = [
  'app.post("/api/auth/verification-status"',
  "const email = emailRaw.trim().toLowerCase()",
  "res.json({ verified: false })",
  "res.json({ verified: user.emailVerified === true })",
];

for (const snippet of requiredPostVerificationSnippets) {
  if (!postVerification.includes(snippet) && !unifiedAuth.includes(snippet)) {
    throw new Error(`Missing post-verification snippet: ${snippet}`);
  }
}

for (const snippet of requiredAuthSnippets) {
  if (!unifiedAuth.includes(snippet)) {
    throw new Error(`Missing unifiedAuth snippet: ${snippet}`);
  }
}

if (!postVerification.includes('if (redirectPath.startsWith("/restaurant-signup"))')) {
  throw new Error("Expected restaurant signup setup branch");
}

if (!postVerification.includes('if (isFoodTruckSetup)')) {
  throw new Error("Expected truck setup branch");
}

if (!postVerification.includes('if (isBarSetup)')) {
  throw new Error("Expected bar setup branch");
}

for (const snippet of forbiddenBarBaseSnippets) {
  const barBranchStart = postVerification.indexOf('if (isBarSetup)');
  const restaurantBranchStart = postVerification.indexOf(
    'if (redirectPath.startsWith("/restaurant-signup"))',
  );
  const barBranch = postVerification.slice(barBranchStart, restaurantBranchStart);
  if (barBranch.includes(snippet)) {
    throw new Error(`Bar setup must not require menu by default: ${snippet}`);
  }
}

console.log("post-verification-bar-onboarding.contract: PASS");
