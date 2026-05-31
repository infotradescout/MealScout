import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const filePath = path.join(process.cwd(), "client/src/components/share-hub.tsx");
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
  source.includes("path: href"),
  "Tracked share generation must send source path",
);
assert(
  source.includes("ref: affiliateTag || undefined"),
  "Tracked share generation must preserve affiliate/ref context",
);

assert(
  source.includes(
    "Referral tracking is temporarily unavailable. You can still share this page, but attribution may not be attached.",
  ),
  "Share Hub must show visible affiliate-tracking fallback copy",
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

