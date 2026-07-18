import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publicUiFiles = [
  "client/src/components/navigation.tsx",
  "client/src/components/scout/ScoutEmptyState.tsx",
  "client/src/pages/explore-preview-v2.tsx",
  "client/src/pages/public-profile.tsx",
];

const protectedPhraseAllowlist = new Set([
  "Follow the Flavor",
  "Blessed Berry Bowls",
  "Extra toppings",
  "Fresh bowls, smoothies, and fruit-based options.",
  "Pensacola Seafood Festival",
  "Taco Tuesday",
]);

const prohibitedPublicPhrases = [
  "what we know",
  "source evidence",
  "available source evidence",
  "evidence-based profile",
  "profile was built",
  "we're still confirming",
  "we’re still confirming",
  "community-submitted profile",
  "community profile",
  "partial menu evidence",
  "live local taste report",
  "trend engine",
  "the safest nearby mix we have",
  "while local coverage builds",
  "coverage is limited while public profiles are verified",
  "coverage is verified",
  "verified or discoverable food trucks",
  "thin on profile detail",
  "scout • customer discovery",
];

const classifyPhrase = (value: string) => {
  if (protectedPhraseAllowlist.has(value)) return "protected";
  const normalized = value.toLowerCase();
  if (prohibitedPublicPhrases.some((phrase) => normalized.includes(phrase))) {
    return "prohibited";
  }
  return "neutral";
};

for (const phrase of protectedPhraseAllowlist) {
  assert.equal(
    classifyPhrase(phrase),
    "protected",
    `Protected fixture should stay protected: ${phrase}`,
  );
}

for (const file of publicUiFiles) {
  const source = readFileSync(file, "utf8").toLowerCase();
  for (const phrase of prohibitedPublicPhrases) {
    assert(
      !source.includes(phrase),
      `Public UI file ${file} must not include prohibited process copy: ${phrase}`,
    );
  }
}

const publicUiContents = publicUiFiles.map((file) => readFileSync(file, "utf8"));
const followTheFlavorOccurrences = publicUiContents.filter((source) =>
  source.toLowerCase().includes("follow the flavor"),
);
for (const source of followTheFlavorOccurrences) {
  assert(
    source.includes("Follow the Flavor"),
    "If Follow the Flavor appears in public UI, it must remain exact protected copy.",
  );
}

console.log("public-sitewide-copy-cleanup.contract: PASS");
