import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");
const navComponent = readFileSync("client/src/components/navigation.tsx", "utf8");

// This test's original numeric-constant formula (GLOBAL_NAV_HEIGHT = 58,
// etc., string-concatenated calc() expressions) was superseded by a CSS
// custom property system (--scout-safe-bottom, --scout-nav-height, etc.)
// -- same structural idea, later iteration. Check the current system.
const requiredScoutSnippets = [
  '"--scout-nav-height": "58px",',
  '"--scout-chip-height": "50px",',
  '"--scout-search-height": "46px",',
  '"--scout-dock-gap": "12px",',
  "const scoutDockBottom =",
  "calc(var(--scout-safe-bottom) + var(--scout-nav-height) + var(--scout-dock-gap))",
  "const feedBottomClearance =",
  "calc(var(--scout-nav-height) + var(--scout-dock-gap) + var(--scout-bottom-dock-height) + 28px)",
  'className="fixed inset-x-0 z-[1000] pointer-events-none"',
];

const forbiddenScoutSnippets = [
  "MOBILE_SAFE_BOTTOM",
  "GLOBAL_NAV_OVERHANG",
  "SCOUT_DOCK_FRAME_HEIGHT",
  "scoutBottomStackBase",
  '"--scout-bottom-stack-base"',
  '"--scout-bottom-stack-clearance"',
  'className="fixed inset-x-0 z-[1200] pointer-events-none"',
];

const requiredNavSnippets = [
  "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]",
];

// isScoutRoute itself is legitimate now -- it drives
// disableScoutHelpBubbles (help bubble triggers are disabled outright on
// scout routes), an unrelated, confirmed-valid feature. What this test
// actually guards against is the old *bug*: isScoutRoute repositioning
// overlay bottom offsets via a ternary, which would reintroduce the
// original nav/search collision.
const forbiddenNavSnippets = [
  "bottom: isScoutRoute",
  "11.5rem",
];

for (const snippet of requiredScoutSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing scout nav/search regression snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenScoutSnippets) {
  if (scoutPage.includes(snippet)) {
    throw new Error(`Found forbidden scout nav/search drift snippet: ${snippet}`);
  }
}

for (const snippet of requiredNavSnippets) {
  if (!navComponent.includes(snippet)) {
    throw new Error(`Missing navigation baseline snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenNavSnippets) {
  if (navComponent.includes(snippet)) {
    throw new Error(`Found forbidden navigation drift snippet: ${snippet}`);
  }
}

console.log("scout-nav-search-regression.contract: PASS");
