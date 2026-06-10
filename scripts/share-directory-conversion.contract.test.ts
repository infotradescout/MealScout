import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const filePath = path.join(
  process.cwd(),
  "client/src/components/share-hub.tsx",
);
const source = readFileSync(filePath, "utf8");

assert(
  source.includes('fetch("/api/share/generate"'),
  "Share Hub must call /api/share/generate for tracked links",
);

assert(
  !source.includes('href: "/for-restaurants"'),
  "Share Hub must not use dead /for-restaurants route",
);
assert(
  !source.includes('href: "/for-hosts"'),
  "Share Hub must not use dead /for-hosts route",
);
assert(
  !source.includes('href: "/host-location-partner"'),
  "Share Hub must not use dead /host-location-partner route",
);

assert(
  source.includes("normalizeShareHubTargetPath(href)") &&
    source.includes("path,"),
  "Share Hub must normalize and validate a real share target before link generation",
);
assert(
  !source.includes("ref: affiliateTag || undefined"),
  "Tracked share generation must let the server derive attribution from the authenticated user",
);

assert(
  source.includes(
    "Tracked links are ready. Add a custom share tag later if you want cleaner links.",
  ),
  "Share Hub must show ready-state copy and treat custom share tags as optional",
);

assert(
  source.includes(
    "!isAuthenticated || !normalizeShareHubTargetPath(item.href)",
  ),
  "Share Hub share buttons must be enabled for authenticated users and only disabled for unsafe targets or unauthenticated sessions",
);

assert(
  source.includes("!/\\/ref\\/[^/?#]+[?&]to=/.test(shareLink)"),
  "Share Hub must reject generated links that are missing universal referral target attribution",
);
assert(
  source.includes("/\\/ref\\/([^/?#]+)[^#]*[?&]ref=\\1") &&
    source.includes("meal-scout\\.vercel\\.app"),
  "Share Hub must reject legacy /ref/<tag>?ref=<tag> and old Vercel share links",
);

assert(
  !source.includes("return absoluteUrl(href)") &&
    !source.includes("Referral tracking is temporarily unavailable"),
  "Share Hub must not fall back to untracked/untagged share URLs",
);
assert(
  !source.includes("My Referral Link") &&
    !source.includes("href: `/ref/${affiliateTag}`"),
  "Share Hub must not inject generic /ref/<tag> referral-page share items",
);

assert(
  source.includes("Share tracked link"),
  "Share Hub primary CTA should be explicit tracked share action",
);

assert(
  source.includes("generateTrackedShareUrl(item.href)"),
  "Open/Copy actions must generate tracked URL before action",
);

console.log("share-directory-conversion.contract: PASS");
