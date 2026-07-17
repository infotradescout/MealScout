import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const locationHook = readFileSync(
  "client/src/hooks/useEffectiveLocationContext.ts",
  "utf8",
);

const requiredScoutSnippets = [
  "Local food coverage is still growing, so the closest real place",
  "stays first.",
  "Browse food",
  "Try a craving, category, or another map area.",
  'data-testid="scout-thin-market-state"',
  'data-testid="scout-compact-card-image-fallback"',
  "useEffectiveLocationContext(",
  "Boolean(user?.id) && !authEffectiveLocationContext",
  'savedLocation?.source === "super_admin_default"',
  'marketKey: "pensacola-fl"',
];

for (const snippet of requiredScoutSnippets) {
  assert(
    scoutPage.includes(snippet),
    `Scout first-fold rescue must include: ${snippet}`,
  );
}

const prohibitedScoutSnippets = [
  "local food signals",
  "widen the board",
  "No nearby food yet",
  "Search nearby food or move the map",
];

for (const snippet of prohibitedScoutSnippets) {
  assert(
    !scoutPage.includes(snippet),
    `Scout first-fold rescue must remove vague copy: ${snippet}`,
  );
}

assert(
  locationHook.includes("export function useEffectiveLocationContext(enabled = true)"),
  "Effective location hook must support conditional enablement for guest-safe surfaces.",
);

assert(
  locationHook.includes("enabled,"),
  "Effective location hook must pass enabled through to useQuery.",
);

console.log("scout-mobile-first-fold-rescue.contract: PASS");
