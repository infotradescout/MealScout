import { readFileSync } from "node:fs";

const operatingPlan = readFileSync(
  "server/services/truckOperatingPlan.ts",
  "utf8",
);
const completionEvidence = readFileSync(
  "server/services/profileCompletionEvidence.ts",
  "utf8",
);
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

for (const snippet of [
  "loadTruckOperatingPlanRowsByRestaurantIds",
  "buildPublicTruckOperatingPlans",
  "truckManualSchedules",
  "eventBookings",
  "sourceKind: \"booking\"",
]) {
  if (!operatingPlan.includes(snippet)) {
    throw new Error(`Canonical truck operating plan is missing: ${snippet}`);
  }
}

for (const snippet of [
  "deriveDatedTruckScheduleState",
  "buildPublicTruckOperatingPlans",
  '["here_now", "today", "upcoming"]',
  "datedTruckScheduleReady",
]) {
  const source = `${completionEvidence}\n${readFileSync(
    "shared/profileCompletionStatus.ts",
    "utf8",
  )}`;
  if (!source.includes(snippet)) {
    throw new Error(`Canonical completion evidence is missing: ${snippet}`);
  }
}

for (const snippet of [
  ".profileCompletionTruth as ProfileCompletionTruth | null",
  "completionTruth?.availabilityReady === true",
  "Dated truck stops missing",
  "Weekly business hours missing",
]) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner availability UI is missing: ${snippet}`);
  }
}

for (const forbidden of [
  "hasValidTruckOperatingWindow",
  "scheduleUpdatedRecently",
  "hasValidTruckScheduleWindow",
  "collectTruckScheduleEntries",
]) {
  if (ownerDashboard.includes(forbidden)) {
    throw new Error(`Owner UI must not reconstruct schedule truth: ${forbidden}`);
  }
}

console.log("truck-schedule-operating-windows.contract: PASS");
