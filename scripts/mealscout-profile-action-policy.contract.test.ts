import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PublicCta } from "../shared/publicProfiles";
import {
  primaryPublicCta,
  rankPublicCtas,
} from "../client/src/components/public-profile/profileActionPolicy";

const cta = (type: PublicCta["type"], href = `/${type}`): PublicCta => ({
  type,
  href,
  label: type,
  safe: true,
});
const candidates = [cta("map"), cta("menu"), cta("order"), cta("phone")];

assert.equal(primaryPublicCta(candidates, "restaurant")?.type, "order");
assert.equal(primaryPublicCta(candidates, "bar")?.type, "order");
assert.equal(primaryPublicCta(candidates, "truck")?.type, "map");
assert.deepEqual(
  rankPublicCtas(candidates, "restaurant").map((item) => item.type),
  ["order", "menu", "map", "phone"],
);
assert.equal(
  primaryPublicCta([{ ...cta("order"), safe: false }, cta("map")], "restaurant")?.type,
  "map",
  "Unsafe actions must never become primary",
);

for (const [path, symbol] of [
  ["client/src/pages/public-profile.tsx", "rankPublicCtas"],
  ["client/src/components/public-profile/MobileActionDock.tsx", "rankPublicCtas"],
  ["client/src/components/public-profile/ThinProfileState.tsx", "primaryPublicCta"],
] as const) {
  const source = readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(source, new RegExp(`import \\{ ${symbol} \\} from .*profileActionPolicy`));
  assert.match(source, new RegExp(`${symbol}\\(`));
}

const publicProfileSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/public-profile.tsx"),
  "utf8",
);
assert.doesNotMatch(
  publicProfileSource,
  /const preferredOrder: PublicCta\["type"\]/,
  "Public profile surfaces must not restore a local CTA priority order",
);
assert.match(
  publicProfileSource,
  /const actions = pickActionCtas\(profile, safeCtas, 16\)/,
  "Quick actions must preserve the canonical ranked CTA order",
);
assert.doesNotMatch(
  publicProfileSource,
  /\["map", "order", "menu", "phone", "external", "social"\]/,
  "Truck actions must not maintain a second hard-coded priority list",
);

assert.equal(
  existsSync(
    resolve(
      process.cwd(),
      "client/src/components/public-profile/ctaTypePriority.ts",
    ),
  ),
  false,
  "The obsolete flat CTA priority must not return",
);

console.log("MealScout public profile action policy contract: PASS");
