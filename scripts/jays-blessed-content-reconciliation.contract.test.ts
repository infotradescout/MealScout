import { existsSync, readFileSync } from "node:fs";

const artifactPath =
  "docs/evidence/live-scout-truck-jays-blessed-content-reconciliation-2026-06-14.json";

type Candidate = {
  ownerApprovalNeeded: boolean;
  ownerApproved: boolean;
};

type Entry = {
  truckName: string;
  currentProductionDisplayName: string;
  productionApplied: boolean;
  ownerApprovalNeeded: boolean;
  contentStatuses: Record<string, string>;
  externalEvidenceCandidates: Candidate[];
  closedScheduleVerification?: {
    closedRowsPreserved: boolean;
    closedRowsHaveDirections: boolean;
    closedRowsHaveCoordinates: boolean;
    sundayClosedNote: string;
  };
};

type Artifact = {
  repo: string;
  workflowMode: string;
  productionMutationAllowed: boolean;
  productionApplied: boolean;
  acceptedBaseline: {
    decision: string;
  };
  preserve: string[];
  entries: Entry[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function entryByName(artifact: Artifact, truckName: string): Entry {
  const entry = artifact.entries.find(
    (candidate) => candidate.truckName === truckName,
  );
  assert(entry, `Missing reconciliation entry for ${truckName}`);
  return entry;
}

assert(existsSync(artifactPath), `Missing artifact: ${artifactPath}`);

const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;

assert(artifact.repo === "MealScout", "Artifact repo must be MealScout");
assert(
  artifact.workflowMode === "review_only",
  "Reconciliation artifact must stay review-only",
);
assert(
  artifact.productionMutationAllowed === false,
  "Reconciliation artifact must not allow production mutation",
);
assert(
  artifact.productionApplied === false,
  "Reconciliation artifact must not claim production apply",
);
assert(
  artifact.acceptedBaseline.decision === "PASS",
  "Accepted Blessed Berry schedule baseline must be recorded as PASS",
);

for (const preserved of [
  "Blessed Berry closedStops are not map/live/upcoming eligible",
  "Jays Southern Cuisine trimmed display name",
]) {
  assert(
    artifact.preserve.includes(preserved),
    `Missing preserved contract: ${preserved}`,
  );
}

const jays = entryByName(artifact, "Jays Southern Cuisine");
assert(
  jays.currentProductionDisplayName === "Jays Southern Cuisine",
  "Jays display name must remain trimmed in the reconciliation packet",
);
assert(
  jays.contentStatuses.identityStatus === "needs_owner_confirmation",
  "Jays identity/social evidence must stay owner-confirmation gated",
);

const blessed = entryByName(artifact, "Blessed Berry Bowls");
assert(
  blessed.contentStatuses.scheduleStatus === "current_week_only",
  "Blessed Berry schedule must remain current-week-only",
);
assert(
  blessed.contentStatuses.socialStatus === "sourced_cleanup_gated",
  "Blessed Berry social cleanup must stay gated",
);
assert(
  blessed.closedScheduleVerification?.closedRowsPreserved === true,
  "Closed Blessed Berry rows must be preserved",
);
assert(
  blessed.closedScheduleVerification?.closedRowsHaveDirections === false,
  "Closed Blessed Berry rows must not have directions",
);
assert(
  blessed.closedScheduleVerification?.closedRowsHaveCoordinates === false,
  "Closed Blessed Berry rows must not have coordinates",
);
assert(
  blessed.closedScheduleVerification?.sundayClosedNote === "Happy Father's Day",
  "Blessed Berry Sunday closed note must be preserved",
);

for (const entry of artifact.entries) {
  assert(
    entry.ownerApprovalNeeded === true,
    `${entry.truckName} must require owner/operator review`,
  );
  assert(
    entry.productionApplied === false,
    `${entry.truckName} must not claim production apply`,
  );
  for (const candidate of entry.externalEvidenceCandidates) {
    assert(
      candidate.ownerApprovalNeeded === true,
      `${entry.truckName} candidate evidence must require owner approval`,
    );
    assert(
      candidate.ownerApproved === false,
      `${entry.truckName} candidate evidence must not be owner-approved`,
    );
  }
}

console.log("jays-blessed-content-reconciliation.contract: PASS");
