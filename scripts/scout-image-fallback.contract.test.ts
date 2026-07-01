import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");

assert.ok(
  scoutPage.includes("function ScoutCardMedia(") &&
    scoutPage.includes("onError={() => setImageFailed(true)}"),
  "Scout cards must centralize image failure handling through ScoutCardMedia.",
);

[
  "scout-live-truck-card-image-fallback",
  "scout-nearby-restaurant-card-image-fallback",
  "scout-deal-card-image-fallback",
  "scout-local-menu-item-card-image-fallback",
  "scout-event-card-image-fallback",
  "scout-saved-restaurant-card-image-fallback",
  "scout-truck-card-image-fallback",
].forEach((testId) => {
  assert.ok(
    scoutPage.includes(`fallbackTestId="${testId}"`),
    `Scout rail cards must expose fallback coverage for ${testId}.`,
  );
});

console.log("scout-image-fallback.contract: PASS");
