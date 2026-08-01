import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TruckSchedulePanel } from "../client/src/components/public-profile/TruckSchedulePanel";
import {
  isClaimedTruckProfile,
  shouldShowPublicClaimPrompt,
} from "../client/src/components/public-profile/profileClaimPromptPolicy";

(globalThis as any).React = React;

const claimedTruck = {
  profileType: "truck",
  verifiedProfile: true,
} as const;
const unclaimedTruck = {
  profileType: "truck",
  verifiedProfile: false,
} as const;

assert.equal(
  isClaimedTruckProfile(claimedTruck),
  true,
  "A verified truck must be treated as claimed on its public profile.",
);
assert.equal(
  shouldShowPublicClaimPrompt(claimedTruck),
  false,
  "Claimed trucks must never show ownership or claim prompts.",
);
assert.equal(
  isClaimedTruckProfile(unclaimedTruck),
  false,
  "An unverified truck must remain eligible for the claim flow.",
);
assert.equal(
  shouldShowPublicClaimPrompt(unclaimedTruck),
  true,
  "Unclaimed trucks must keep ownership and claim prompts.",
);

const renderSchedule = (verifiedProfile: boolean) =>
  renderToStaticMarkup(
    React.createElement(TruckSchedulePanel, {
      profile: {
        profileType: "truck",
        verifiedProfile,
        truckSchedule: null,
      } as any,
    }),
  );

const claimedSchedule = renderSchedule(true);
assert(
  claimedSchedule.includes("No schedule posted"),
  "A claimed truck without a schedule must show the honest empty state.",
);
assert(
  !claimedSchedule.includes("Own this truck?") &&
    !claimedSchedule.includes("claim-business"),
  "A claimed truck schedule must not render ownership or claim prompts.",
);

const unclaimedSchedule = renderSchedule(false);
assert(
  unclaimedSchedule.includes("No schedule posted") &&
    unclaimedSchedule.includes("Own this truck?") &&
    unclaimedSchedule.includes("claim-business"),
  "An unclaimed truck must retain both the empty state and claim path.",
);

const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const schedulePanel = readFileSync(
  "client/src/components/public-profile/TruckSchedulePanel.tsx",
  "utf8",
);
const thinProfile = readFileSync(
  "client/src/components/public-profile/ThinProfileState.tsx",
  "utf8",
);
const quarantinedTruckHero = readFileSync(
  "client/src/components/public-profile/TruckHero.tsx",
  "utf8",
);

assert(
  publicProfile.includes(
    "const showPageClaimPrompts = !isClaimedTruckProfile(restaurantProfile);",
  ),
  "Claimed truck profiles must hide page-level claim prompts.",
);
assert.equal(
  (publicProfile.match(/\{showPageClaimPrompts \? \(/g) || []).length,
  2,
  "Both header and footer claim prompts must use the claimed-truck policy.",
);
assert(
  schedulePanel.includes("{shouldShowPublicClaimPrompt(profile) ? ("),
  "The schedule ownership prompt must render only for unclaimed trucks.",
);
assert(
  schedulePanel.includes("{getTruckScheduleEmptyStateLabel()}"),
  "Claimed trucks without a schedule must retain the honest empty state.",
);
assert(
  thinProfile.includes(
    "if (isClaimedTruckProfile(profile)) return null;",
  ),
  "Claimed thin profiles must not render an ownership card.",
);
assert(
  quarantinedTruckHero.includes(
    "{shouldShowPublicClaimPrompt(profile) ? (",
  ),
  "The quarantined truck hero must preserve the rule if it is reused.",
);

console.log("claimed-truck-public-profile-claim-prompts.contract: PASS");
