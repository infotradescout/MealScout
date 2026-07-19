import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const googleMap = readFileSync(
  "client/src/components/maps/google-map-surface.tsx",
  "utf8",
);
const fallbackMap = readFileSync(
  "client/src/components/maps/themed-scout-map-v2.tsx",
  "utf8",
);

for (const snippet of [
  "getDecisionMarker",
  "selectedMarkerId",
  "selectSpatialDecision",
  "compactDecisionMarkers",
  'data-testid="scout-spatial-decision-rail"',
  'aria-label="Food shown on the map"',
  "data-spatial-marker-id",
  "onFocus={() => onSelect(marker)}",
  'if (item.kind === "Menu") return "View menu"',
  'if (item.kind === "Truck") return "Follow truck"',
  'return "Open profile"',
]) {
  assert(scout.includes(snippet), `Scout spatial surface must include: ${snippet}`);
}

assert(
  !scout.includes('setSheetState("fullMap");\n      handleMarkerTap(marker);'),
  "A compact pin tap must select its decision without forcing a mode change.",
);

for (const source of [googleMap, fallbackMap]) {
  assert(
    source.includes("selectedMarkerId"),
    "Every active Scout map provider must receive canonical selection.",
  );
}

assert(
  googleMap.includes('isSelected ? "selected" : "idle"') &&
    googleMap.includes("zIndex: isSelected ? 1000"),
  "Google markers must visibly elevate the selected food result.",
);
assert(
  googleMap.includes("buildGlowDotElement(marker, isSelected)") &&
    googleMap.includes("ms-google-marker--selected"),
  "Google AdvancedMarker content must render the same selected treatment.",
);
assert(
  scout.includes('if (sheetState === "fullMap") return;') &&
    scout.includes(
      "!spatialDecisionItems.some(\n        ({ marker }) => marker.id === selectedMarkerId",
    ),
  "Collapsing the map must reset contextual pins to a visible compact decision.",
);
assert(
  fallbackMap.includes("msm-map-pin--selected") &&
    fallbackMap.includes("prefers-reduced-motion: reduce"),
  "Fallback markers must have an active treatment that respects reduced motion.",
);

const spatialRailSource = scout.slice(
  scout.indexOf("function SpatialDecisionRail"),
  scout.indexOf("function SceneMixedFeed"),
);
for (const misleading of ["Order now", "Ready for pickup", "Parking Pass available"]) {
  assert(
    !spatialRailSource.includes(misleading),
    `Spatial decisions must not fabricate unsupported action/status: ${misleading}`,
  );
}

console.log("scout-spatial-decision-surface.contract: PASS");
