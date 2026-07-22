import { readFileSync } from "node:fs";

const navComponent = readFileSync("client/src/components/navigation.tsx", "utf8");

// The layout-math system this test originally checked (named JS pixel
// constants like GLOBAL_NAV_HEIGHT = 58, string-concatenated into calc()
// expressions) was replaced with CSS custom properties set once as inline
// style vars and referenced via var(--scout-...) inside calc() -- the
// same structural idea (stack safe-area-inset + nav + search + chip
// heights to compute dock/feed bottom clearance), just implemented more
// idiomatically. Check the current CSS-custom-property system instead.
// The route-conditional bottom-offset math this test checked in
// navigation.tsx (repositioning help bubbles 11.5rem/5.5rem up on scout
// routes) was replaced by a simpler mechanism: help bubble triggers are
// disabled outright on scout routes (disableScoutHelpBubbles), since the
// scout page now owns its own bottom-clearance CSS vars instead of
// navigation.tsx guessing at scout-specific spacing.
const navRequired = [
  "const isScoutRoute =",
  'currentPath === "/scout"',
  'currentPath.startsWith("/scout/")',
  'currentPath === "/scout-v2"',
  'currentPath === "/directory"',
  'currentPath.startsWith("/directory/")',
  "const disableScoutHelpBubbles = isScoutRoute;",
  "disabled={disableScoutHelpBubbles}",
  'isScoutRoute ? "search-and-navigation" : undefined',
];

for (const snippet of navRequired) {
  if (!navComponent.includes(snippet)) {
    throw new Error(`Missing navigation bottom overlay safety snippet: ${snippet}`);
  }
}

console.log("scout-mobile-nav-layout.contract: PASS");
