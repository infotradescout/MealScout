import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(
  "scripts/mealscout-valid-ref-production-smoke.ts",
  "utf8",
);
const rolloutChecklist = readFileSync("docs/PROD_ROLLOUT_CHECKLIST.md", "utf8");

assert(
  runner.includes('"valid_ref_acceptance_blocked"') &&
    runner.includes('"valid_ref_acceptance_complete"') &&
    runner.includes('"fail_closed_production_pass"'),
  "Valid-ref runner must distinguish fail-closed pass, blocked, and complete statuses.",
);

assert(
  runner.includes("function isDefaultLookingAffiliateTag") &&
    runner.includes("/^user\\d{4}$/i") &&
    runner.includes("default-looking userNNNN tag is not acceptable"),
  "Valid-ref runner must refuse default-looking userNNNN affiliate tags.",
);

assert(
  runner.includes("function isValidPublicShareTarget") &&
    runner.includes('pathname === "/"') &&
    runner.includes('pathname.startsWith("/ref/")') &&
    runner.includes('pathname.startsWith("/admin")') &&
    runner.includes('pathname.startsWith("/staff")') &&
    runner.includes('pathname.startsWith("/p/")'),
  "Valid-ref runner must require a real public share target and reject root/ref/internal targets.",
);

assert(
  runner.includes('"/api/affiliate/tag"') &&
    runner.includes('"/api/affiliate/generate-link"') &&
    runner.includes("FORBIDDEN_ENDPOINTS") &&
    runner.includes("Forbidden valid-ref smoke endpoint"),
  "Valid-ref runner must explicitly forbid state-creating affiliate endpoints.",
);

assert(
  runner.includes("const ALLOWED_POST_ENDPOINTS =") &&
    runner.includes('"/api/auth/login"') &&
    runner.includes('"/api/share/generate"') &&
    runner.includes("assertAllowedEndpoint") &&
    runner.includes("Unexpected valid-ref smoke mutation method"),
  "Valid-ref runner must limit mutation methods/endpoints during final smoke.",
);

assert(
  !runner.includes("fetch(`${baseUrl}/api/affiliate/tag") &&
    !runner.includes("fetch(`${baseUrl}/api/affiliate/generate-link") &&
    !runner.includes("VALID_REF_SMOKE_AFFILIATE_ROLE"),
  "Valid-ref runner must not call affiliate tag creation/link endpoints or model affiliate as a role.",
);

assert(
  runner.includes('shareLink.startsWith("https://www.mealscout.us/")') &&
    runner.includes('generatedUrl.pathname.split("/").filter(Boolean)') &&
    runner.includes("generatedBasePath === expectedBasePath") &&
    runner.includes(
      "generatedTag.trim().toLowerCase() === expectedTag.toLowerCase()",
    ) &&
    runner.includes('generatedUrl.searchParams.has("to")') &&
    runner.includes('generatedUrl.searchParams.has("ref")') &&
    runner.includes('shareLink.includes("%2F")') &&
    runner.includes('shareLink.includes("?ref=")') &&
    runner.includes(
      "!/^https:\\/\\/meal-scout\\.vercel\\.app\\//i.test(shareLink)",
    ) &&
    runner.includes("!/\\/ref\\//i.test(shareLink)"),
  "Valid-ref runner must require canonical host and direct clean path-segment ref links without nested destination params.",
);

assert(
  rolloutChecklist.includes(
    "Full valid-ref production acceptance is blocked",
  ) &&
    rolloutChecklist.includes("non-default affiliate tag") &&
    rolloutChecklist.includes("eligible public internal share target") &&
    rolloutChecklist.includes("destination ownership is not required") &&
    rolloutChecklist.includes("Do not call `/api/affiliate/tag`") &&
    rolloutChecklist.includes("fail_closed_production_pass") &&
    rolloutChecklist.includes("valid_ref_acceptance_blocked") &&
    rolloutChecklist.includes("valid_ref_acceptance_complete"),
  "Rollout checklist must document the final valid-ref fixture gate and status language.",
);

console.log("mealscout-valid-ref-production-smoke.contract: PASS");
