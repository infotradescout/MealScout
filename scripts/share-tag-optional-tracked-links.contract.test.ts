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
    "Tracked links are ready. Add a custom share tag later if you want cleaner links.",
  ) &&
    shareHub.includes(
      "!isAuthenticated || !normalizeShareHubTargetPath(item.href)",
    ),
  "Share Hub must keep tracked link actions enabled for authenticated users and only disable for unsafe targets or unauthenticated sessions.",
);

assert(
  shareLib.includes("/api/share/generate") &&
    shareLib.includes("isCanonicalCustomerSignupShareLink") &&
    shareLib.includes("isCanonicalCustomerSignupPath(path)") &&
    shareLib.includes("/\\/ref\\/[^/?#]+[?&]to=/.test(shareLink)"),
  "Client share helper must accept canonical customer-signup ?ref= links and keep universal /ref/:key?to= validation for other pages.",
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
