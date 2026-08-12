import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOwnerAiHref } from "../shared/ownerAiNavigation";

const read = (path: string) => readFileSync(path, "utf8");

assert.equal(
  buildOwnerAiHref({
    restaurantId: "restaurant 1",
    source: "onboarding",
    focus: "menu",
    menuSource: "https://example.com/menu?a=1",
    draftId: "draft 1",
  }),
  "/owner-ai?restaurantId=restaurant+1&src=onboarding&focus=menu&menuSource=https%3A%2F%2Fexample.com%2Fmenu%3Fa%3D1&ownerAiDraft=draft+1",
);
assert.equal(buildOwnerAiHref(), "/owner-ai");

const continuation = read("server/services/loginContinuation.ts");
const signup = read("client/src/pages/restaurant-signup.tsx");
const accountSetup = read("client/src/pages/account-setup.tsx");
const postVerification = read("client/src/pages/post-verification.tsx");
const profileSetup = read("client/src/pages/profile-setup.tsx");
const profileHub = read("client/src/pages/profile.tsx");
const settings = read("client/src/pages/profile/settings.tsx");
const profileEditor = read("client/src/components/owner-profile-workspace.tsx");
const ownerDashboard = read("client/src/pages/restaurant-owner-dashboard.tsx");
const ownerAi = read("client/src/pages/owner-ai-actions.tsx");
const auth = read("client/src/hooks/useAuth.ts");

for (const focus of ["profile", "media", "menu", "schedule"]) {
  assert.match(
    continuation,
    new RegExp(`source: "onboarding",\\s+focus: "${focus}"`),
    `Login continuation must preserve the ${focus} setup focus in AI Control`,
  );
}
assert.match(
  continuation,
  /nextRequiredStep = "verification";[\s\S]*continuationPath = "\/restaurant-owner-dashboard\?setup=verification";/,
  "Identity and business-document verification must remain a separate manual step",
);

assert.equal(
  signup.match(/setLocation\(ownerAiSetupHref\)/g)?.length,
  2,
  "Both submitted and deferred verification handoffs must enter the same AI setup surface",
);
for (const snippet of [
  'source: "onboarding"',
  'menuSource: menuSourceUrl',
  'data-testid="owner-ai-onboarding-handoff"',
  "Sign your favorite free or paid AI into MealScout",
  "AI can apply and publish only after",
  "explicitly approves that exact revision in the AI chat",
]) {
  assert.ok(
    signup.includes(snippet) || read("client/src/copy/hostOnboarding.copy.ts").includes(snippet),
    `Restaurant onboarding is missing: ${snippet}`,
  );
}

for (const [name, source, snippets] of [
  [
    "account setup",
    accountSetup,
    [
      'data-testid="account-setup-owner-ai-introduction"',
      "any free or paid AI",
      "signing into MealScout",
      "approves the exact revision",
    ],
  ],
  [
    "post-verification handoff",
    postVerification,
    [
      'data-testid="post-verification-owner-ai-handoff"',
      "AI-prepared setup",
      "Owner approval",
      "Sign your favorite AI into MealScout",
    ],
  ],
  [
    "public profile onboarding",
    profileSetup,
    [
      "Use the AI you already have",
      "Any free or paid AI can prepare your profile",
      "the owner can consent in that chat",
      "approve, apply, and publish it through MealScout",
    ],
  ],
  [
    "user profile hub",
    profileHub,
    [
      'title: "AI Control"',
      'source: "profile"',
      "AI connections, notifications",
    ],
  ],
  [
    "account settings",
    settings,
    [
      '<TabsTrigger value="ai"',
      'data-testid="settings-owner-ai-entry"',
      'source: "settings"',
      "Only the actual owner can authorize an AI connection",
      "AI can then",
      "approve and publish that exact revision",
      "Owner approves in chat",
      "Connection readiness",
    ],
  ],
  [
    "business profile editor",
    profileEditor,
    [
      'data-testid="owner-profile-ai-entry"',
      "Update this profile with any AI",
      "approve the exact revision in the AI chat",
    ],
  ],
  [
    "owner completion checklist",
    ownerDashboard,
    [
      'data-testid="owner-ai-completion-entry"',
      'source: "completion"',
      "Finish with AI",
      "ownsSelectedBusiness",
    ],
  ],
  [
    "AI onboarding destination",
    ownerAi,
    [
      'data-testid="owner-ai-onboarding-entry"',
      "Use any AI",
      "Use manual tools",
      "untrusted evidence",
      "Nothing changes or publishes until",
    ],
  ],
] as const) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${name} is missing: ${snippet}`);
  }
}

assert.match(
  auth,
  /user\?\.businessOnboardingRequired[\s\S]*pathname\.startsWith\("\/owner-ai"\)/,
  "AI Control must still send an owner without an attached business through business onboarding",
);
assert.match(
  settings,
  /isScopedBusinessOwner\([\s\S]*ownsCurrentBusiness[\s\S]*Open AI Control/,
  "Settings must expose key management only through actual scoped ownership",
);
assert.match(
  ownerDashboard,
  /ownsSelectedBusiness[\s\S]*source: "profile-editor"/,
  "Business profile AI entry must remain actual-owner scoped",
);

for (const source of [
  signup,
  accountSetup,
  postVerification,
  profileSetup,
  profileHub,
  settings,
  profileEditor,
  ownerDashboard,
  ownerAi,
]) {
  assert.doesNotMatch(source, /AI (?:will|can) auto.?approve/i);
  assert.doesNotMatch(source, /publish(?:es)? immediately/i);
}

assert.match(
  settings,
  /explicitly approve it[\s\S]*Manually copied legacy keys remain[\s\S]*draft-only/,
  "Settings must distinguish consented OAuth execution from legacy draft-only keys",
);
assert.match(
  ownerAi,
  /You approve in chat[\s\S]*AI calls MealScout[\s\S]*linked socials publish/,
  "AI Control must show that the AI executes the consented approval and publish call",
);

console.log("mealscout-owner-ai-lifecycle-entry.contract: PASS");
