import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const postVerification = readFileSync(
  "client/src/pages/post-verification.tsx",
  "utf8",
);

assert(
  !unifiedAuth.includes("/api/auth/verification-status"),
  "Email verification state must not be queryable through a public endpoint.",
);
assert(
  !postVerification.includes("/api/auth/verification-status") &&
    postVerification.includes("window.location.href = loginHref"),
  "The post-verification handoff should continue through credentialed login instead of public account lookup.",
);

console.log("verification status privacy contract passed");
