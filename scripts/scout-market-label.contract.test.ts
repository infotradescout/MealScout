import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");

assert.ok(
  scoutPage.includes('fallbackLabel: "Your market"'),
  "Scout market label fallback must avoid vague Saved market copy.",
);

assert.ok(
  !scoutPage.includes('"Saved market"'),
  'Scout page must not ship the vague "Saved market" label.',
);

assert.ok(
  scoutPage.includes('const scoutMarketEyebrow =') &&
    scoutPage.includes('"Food around Pensacola"'),
  "Scout first fold must expose the active Pensacola launch market label.",
);

assert.ok(
  scoutPage.includes('popular_dishes') &&
    scoutPage.includes('"More Dishes Nearby"'),
  "Scout should soften duplicate Popular Dishes labeling when the hero already uses that source.",
);

assert.ok(
  scoutPage.includes("scout-discovery-page relative z-10 w-full") &&
    !scoutPage.includes("md:max-w-[1120px]"),
  "Scout must keep its primary Google map full-bleed instead of trapping it in a card-width column.",
);

assert.ok(
  navigation.includes(
    "fixed inset-x-0 top-0 z-[1100] hidden border-b border-[color:var(--border-subtle)]",
  ) &&
    navigation.includes('${isBusinessWorkspaceRoute ? "" : "lg:block"}') &&
    navigation.includes("max-w-7xl"),
  "Scout desktop navigation must use the shared full-width application header.",
);

console.log("scout-market-label.contract: PASS");
