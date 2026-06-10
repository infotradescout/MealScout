import { readFileSync } from "node:fs";

const routeFile = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const smokeScript = readFileSync(
  "scripts/runManualTruckIntakeSmokePacket.ts",
  "utf8",
);
const runbook = readFileSync("docs/MANUAL_TRUCK_INTAKE_RUNBOOK.md", "utf8");

const routeSafetySnippets = [
  'const mode = requestBody?.mode === "apply" ? "apply" : "dry_run"',
  'if (mode === "apply") {',
  "existingMenuCount > 0 && !allowMenuOverwrite",
  "existing_logo_present",
  "!matchedRestaurant.logoUrl || allowLogoReplace",
  'type: "menu_evidence_review"',
  "reviewQueueItems",
  "menuEvidenceStatus",
  "evidenceStatus",
];

for (const snippet of routeSafetySnippets) {
  if (!routeFile.includes(snippet)) {
    throw new Error(
      `Manual intake smoke contract missing route safety snippet: ${snippet}`,
    );
  }
}

const smokeScriptSnippets = [
  "assertCoreSmokeResult",
  "assertNoSilentOverwriteSignals",
  "Refusing to target production host without --allow-production",
  'mode: "dry_run" | "apply"',
  "if (!apply)",
  "Apply unexpectedly added menu without --menu-overwrite approval",
  "Apply unexpectedly uploaded logo without --logo-overwrite approval",
  "uploadedEvidence",
  "reviewQueueItems",
];

for (const snippet of smokeScriptSnippets) {
  if (!smokeScript.includes(snippet)) {
    throw new Error(
      `Manual intake smoke contract missing runner snippet: ${snippet}`,
    );
  }
}

const runbookSnippets = [
  "## Real Smoke Packet",
  "expected preview result",
  "expected apply result",
  "failure states",
  "rollback/no-overwrite rules",
];

for (const snippet of runbookSnippets) {
  if (!runbook.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(
      `Runbook missing required smoke packet section: ${snippet}`,
    );
  }
}

console.log("manual-truck-intake-smoke-packet.contract: PASS");
