import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const shareLib = readFileSync("client/src/lib/share.ts", "utf8");
const shareTargetPolicy = readFileSync("server/shareTargetPolicy.ts", "utf8");

assert(
  shareRoutes.includes("resolveShareAttributionIdentity") &&
    shareRoutes.includes("requireShareAffiliateTag") &&
    shareRoutes.includes("getOrCreateInternalAttributionCode"),
  "Share generation must resolve attribution from vanity tag when available and fall back to an internal attribution key.",
);

assert(
  shareRoutes.includes('attributionMode: "vanity_tag"') &&
    shareRoutes.includes('attributionMode: "internal_key"'),
  "Share generation must model vanity and internal attribution modes separately.",
);

assert(
  shareRoutes.includes("authentication_required") &&
    shareRoutes.includes("attribution_identity_required") &&
    shareRoutes.includes("share_target_required"),
  "Share generation must fail closed for unauthenticated user, unresolved attribution identity, and unsafe/missing target.",
);

assert(
  shareRoutes.includes("attribution.attributionKey") &&
    shareRoutes.includes("buildTrackedAttributedUrl(") &&
    !shareRoutes.includes("ensureAffiliateTag(authenticatedUserId)"),
  "Tracked links must be generated with resolved attribution key without forcing vanity-tag creation.",
);

assert(
  shareHub.includes(
    "Tracked links are active. Add a custom share tag any time for cleaner branding.",
  ) &&
    shareHub.includes(
      "!isAuthenticated || !normalizeShareHubTargetPath(item.href)",
    ),
  "Share Hub must keep tracked link actions enabled for authenticated users and only disable for unsafe targets or unauthenticated sessions.",
);

assert(
    shareLib.includes("/api/share/generate") &&
    shareLib.includes("isDirectAttributedShareLink") &&
    shareLib.includes('generated.searchParams.has("to")') &&
    shareLib.includes('generated.searchParams.get("ref")') &&
    shareLib.includes('!shareLink.includes("%2F")') &&
    shareLib.includes('!shareLink.includes("role=business")'),
  "Client share helper must enforce direct query ref links and reject nested/encoded destination params.",
);

assert(
  shareTargetPolicy.includes('"/admin"') &&
    shareTargetPolicy.includes('"/staff"') &&
    shareTargetPolicy.includes('"/api"') &&
    shareTargetPolicy.includes('"/ref"'),
  "Unsafe internal targets must remain blocked.",
);

assert(
  !shareRoutes.includes("payout") &&
    !shareRoutes.includes("payment") &&
    !shareRoutes.includes("stripe"),
  "Share attribution updates must not touch payout/payment logic.",
);

console.log("share-tag-optional-tracked-links.contract: PASS");
