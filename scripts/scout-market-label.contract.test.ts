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
  scoutPage.includes('md:max-w-[1120px]') &&
    scoutPage.includes('xl:max-w-[1280px]'),
  "Scout layout must widen on desktop/tablet instead of staying trapped in a phone-width column.",
);

assert.ok(
  navigation.includes('const desktopNavPositionClass = isScoutRoute') &&
    navigation.includes('"left-1/2 right-auto -translate-x-1/2"'),
  "Scout desktop nav should anchor with the content instead of floating off to the right.",
);

console.log("scout-market-label.contract: PASS");
