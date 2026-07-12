import { existsSync, readFileSync } from "node:fs";

const workflowPath = "WORKFLOW.md";
const cleanupMapPath = "CLEANUP_MAP.md";

if (!existsSync(workflowPath)) {
  throw new Error("WORKFLOW.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const workflow = readFileSync(workflowPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const combined = `${workflow}\n${cleanupMap}`;

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}.`);
  }
}

[
  "MEALSCOUT_HANDOFF_SPINE.md",
  "CLEANUP_MAP.md",
  "cleanup/stabilization mode",
  "Feature work is frozen",
  "No new product features during cleanup unless explicitly declared as a production safety prerequisite.",
  "npm run gate:production",
  "Commit Discipline",
  "Validation Ladder",
  "What Not To Touch Without Explicit Approval",
].forEach((snippet) => requireIncludes(workflow, snippet, `WORKFLOW.md ${snippet}`));

for (let index = 1; index <= 10; index += 1) {
  requireMatch(cleanupMap, new RegExp(`## C${index} - `), `C${index} ticket`);
}

[
  "C1 - MealScout Handoff Spine",
  "Status: `DONE`",
  "C2 - Restore Cleanup Map Authority",
  "Goal:",
  "Files likely touched:",
  "Allowed changes:",
  "Disallowed changes:",
  "Validation command:",
  "Handoff value:",
  "node scripts/mealscout-cleanup-map-authority.contract.test.ts",
  "npm run gate:production",
].forEach((snippet) => requireIncludes(cleanupMap, snippet, `CLEANUP_MAP.md ${snippet}`));

requireMatch(
  cleanupMap,
  /C2 - Restore Cleanup Map Authority[\s\S]*Status: `(IN PROGRESS|DONE)`/,
  "C2 in progress or done status",
);

const productFeatureLines = combined
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |disallowed|without|frozen|explicit approval)/i.test(line)) {
    throw new Error(`Cleanup docs appear to introduce product feature scope: ${line}`);
  }
}

if (/Status: `IN PROGRESS`[\s\S]*Status: `IN PROGRESS`/i.test(cleanupMap)) {
  throw new Error("Only one cleanup ticket should be IN PROGRESS.");
}

console.log("mealscout-cleanup-map-authority.contract: PASS");
