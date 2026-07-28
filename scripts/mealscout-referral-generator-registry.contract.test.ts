import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTrackedAttributedPath,
  buildTrackedAttributedUrl,
} from "../server/shareTargetPolicy";

const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const profilePage = readFileSync("client/src/pages/profile.tsx", "utf8");
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminAffiliateManagement = readFileSync(
  "client/src/pages/AdminAffiliateManagement.tsx",
  "utf8",
);
const sharePolicy = readFileSync("server/shareTargetPolicy.ts", "utf8");
const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const shareLib = readFileSync("client/src/lib/share.ts", "utf8");

type RegistryEntry = {
  label: string;
  source: string;
  requiredSnippets: string[];
};

const registry: RegistryEntry[] = [
  {
    label: "Share Hub",
    source: shareHub,
    requiredSnippets: [
      "fetch(\"/api/share/generate\"",
      "sanitizeTargetPathForTrackedLink",
      "isDirectAttributedShareLink",
    ],
  },
  {
    label: "Profile",
    source: profilePage,
    requiredSnippets: [
      "`${window.location.origin}/directory?ref=${encodeURIComponent(",
      "handleCopyAffiliateLink",
    ],
  },
  {
    label: "Admin Dashboard",
    source: adminDashboard,
    requiredSnippets: [
      "const buildCanonicalAffiliateLink = (",
      'url.searchParams.set("ref", tag);',
      'url.searchParams.delete("to");',
    ],
  },
  {
    label: "Admin Affiliate Management",
    source: adminAffiliateManagement,
    requiredSnippets: [
      "return `${origin}/directory?ref=${encodedTag}`;",
      "const getAffiliateLink = (tag: string | null) =>",
    ],
  },
  {
    label: "Canonical Builders",
    source: `${sharePolicy}\n${shareRoutes}\n${shareLib}`,
    requiredSnippets: [
      "export function buildTrackedAttributedPath(",
      "return buildDirectAttributedPath(affiliateTag, normalizedTarget);",
      "buildTrackedAttributedUrl(",
      "app.post(\"/api/share/generate\"",
      "shareLink = buildTrackedAttributedUrl(",
      "getAffiliateShareUrl",
    ],
  },
];

for (const entry of registry) {
  for (const snippet of entry.requiredSnippets) {
    assert(
      entry.source.includes(snippet),
      `${entry.label} generator registry entry is missing expected snippet: ${snippet}`,
    );
  }
}

const generatedCandidates = [
  buildTrackedAttributedPath("registry-tag", "/customer-signup?role=business"),
  buildTrackedAttributedPath("registry-tag", "/claim-truck"),
  buildTrackedAttributedPath("registry-tag", "/directory"),
  buildTrackedAttributedUrl(
    "https://www.mealscout.us",
    "registry-tag",
    "/directory",
  ),
].join("\n");

for (const fragment of ["role=business", "to=", "%2F", "/ref/"]) {
  assert.equal(
    generatedCandidates.includes(fragment),
    false,
    `Generator registry forbids generated output drift: ${fragment}`,
  );
}

console.log("mealscout-referral-generator-registry.contract: PASS");
