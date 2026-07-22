import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
).replace(/\r\n/g, "\n");

function requireAll(source: string, snippets: string[], label: string) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${label} is missing required behavior: ${snippet}`);
    }
  }
}

function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
  fromIndex = 0,
) {
  const start = source.indexOf(startMarker, fromIndex);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`${label} could not be located`);
  }
  return source.slice(start, end + endMarker.length);
}

function requireExactIds(
  section: string,
  expectedIds: string[],
  label: string,
) {
  const actualIds = Array.from(section.matchAll(/\bid: "([^"]+)"/g)).map(
    (match) => match[1],
  );
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      `${label} denominator changed: expected ${expectedIds.join(", ")}; received ${actualIds.join(", ")}`,
    );
  }
}

requireAll(
  ownerDashboard,
  [
    'import type { ProfileCompletionTruth } from "@shared/profileCompletionStatus"',
    ".profileCompletionTruth as ProfileCompletionTruth | null",
    'topCompletionTruth?.menuState === "approved_current"',
    'topCompletionTruth?.mediaState === "ready"',
    "topCompletionTruth?.availabilityReady === true",
    'topCompletionTruth?.publicRouteState === "published"',
    'data-testid="canonical-profile-completion-checklist"',
    'id: "menu"',
    'id: "media"',
    'id: "availability"',
    'id: "publication"',
    'completionTruth?.menuState === "approved_current"',
    'completionTruth?.mediaState === "ready"',
    "completionTruth?.availabilityReady === true",
    'completionTruth?.publicRouteState === "published"',
    'currentIsTruckBusiness ? { truck: "1" } : undefined',
    '"Dated truck stops missing"',
    'data-testid="truck-live-presence-information"',
    "does not affect profile completion.",
  ],
  "canonical owner completion UI",
);

const truthReads = ownerDashboard.match(
  /\.profileCompletionTruth as ProfileCompletionTruth \| null/g,
) || [];
if (truthReads.length < 3) {
  throw new Error(
    "Every owner completion surface must read the server-supplied canonical truth.",
  );
}

const topChecks = sliceBetween(
  ownerDashboard,
  "const topCompletionChecks = [",
  "];",
  "top completion checks",
);
const topVerdicts = topChecks.match(/topCompletionTruth\?\./g) || [];
if (topVerdicts.length !== 4) {
  throw new Error("Top completion percentage must have exactly four verdicts.");
}

const completionItems = sliceBetween(
  ownerDashboard,
  "const completionItems = [",
  "];",
  "profile value completion items",
);
requireExactIds(
  completionItems,
  ["menu", "photos", "hours", "publication"],
  "Profile value completion",
);

const canonicalChecklistMarker =
  "{/* Canonical business onboarding checklist */}";
const canonicalChecklistStart = ownerDashboard.indexOf(
  canonicalChecklistMarker,
);
if (canonicalChecklistStart < 0) {
  throw new Error("Canonical business onboarding checklist is missing.");
}
const canonicalChecklist = sliceBetween(
  ownerDashboard,
  "const checklistItems = [",
  "] as const;",
  "canonical business onboarding checklist",
  canonicalChecklistStart,
);
requireExactIds(
  canonicalChecklist,
  ["menu", "media", "availability", "publication"],
  "Business onboarding completion",
);

for (const [label, section] of [
  ["top completion", topChecks],
  ["profile value completion", completionItems],
  ["business onboarding completion", canonicalChecklist],
] as const) {
  for (const forbidden of [
    "optionalGrowth",
    "hasSocial",
    "hasDeal",
    "hasEvents",
    "isVerified",
    "livePresenceState",
    "mobileOnline",
    "reviewedUnavailable",
    "updatedAt",
    "operatingHours",
  ]) {
    if (section.includes(forbidden)) {
      throw new Error(`${label} must not score optional/stale input: ${forbidden}`);
    }
  }
}

for (const staleShortcut of [
  "computeProfileCompletionStatus",
  "scheduleUpdatedRecently",
  "hasValidTruckScheduleWindow",
  "hasValidTruckOperatingWindow",
  "collectTruckScheduleEntries",
  "parseTimeToMinutes",
  "resolveNextDateForDay",
  "operatingUpdatedAtCandidate",
  "scheduleFreshnessDays",
  "hasOperatingTimeRequirement",
  'label: "Schedule this week"',
]) {
  if (ownerDashboard.includes(staleShortcut)) {
    throw new Error(`Owner completion still trusts stale shortcut: ${staleShortcut}`);
  }
}

console.log("owner-dashboard-type-aware-completion.contract: PASS");
