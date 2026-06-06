import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { __testables } from "./import-merlin-profile-seeds";

const { normalizeSeed, validateSeed, mergeSeedRawData } = __testables;

type CanaryDecision = {
  row: number;
  name: string;
  action: "accepted" | "quarantined" | "rejected" | "duplicate_suppressed";
  reason: string;
};

const baseRow = {
  brand_lane: "MEALSCOUT",
  target_profile_type: "food_truck",
  seeded_from_evidence: true,
  profile_origin: "evidence_seed",
  import_decision: "clean",
  onboarding_source: "screenshot_seed",
  claim_status: "unclaimed",
  email_verified: false,
  insurance_verified: false,
  owner_user_id: null,
  invited_user_id: null,
  city: "Pensacola",
  state: "FL",
  phone: "850-555-0101",
};

const rows = [
  {
    ...baseRow,
    target_profile_id: "canary-truck-001",
    profile_name: "Canary Pupusa Truck",
    profile_email: "canary-pupusa@example.org",
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-001",
    profile_name: "Canary Pupusa Truck Duplicate",
    profile_email: "canary-pupusa-duplicate@example.org",
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-002",
    profile_name: "Canary Admin Unattributed",
    profile_email: "canary-admin@example.org",
    source_actor: "admin_unattributed",
    affiliate_user_id: null,
    affiliate_tag: null,
    referral_code: null,
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-003",
    profile_name: "Canary Blocked Truck",
    profile_email: "canary-blocked@example.org",
    import_decision: "blocked",
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-004",
    profile_name: "Canary Review Truck",
    profile_email: "canary-review@example.org",
    import_decision: "review_required",
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-005",
    profile_name: "Canary Unsafe Origin",
    profile_email: "canary-origin@example.org",
    profile_origin: "auto_onboarded",
  },
  {
    ...baseRow,
    target_profile_id: "canary-truck-006",
    profile_name: "Canary Bad Affiliate",
    profile_email: "canary-affiliate@example.org",
    source_actor: "admin_unattributed",
    affiliate_user_id: "affiliate-should-not-attach",
  },
];

const getCommit = () =>
  execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

const assertSafeAcceptedMetadata = (rawData: any) => {
  const seed = rawData?.merlinSeed || {};
  if (seed.profile_origin !== "evidence_seed") throw new Error("profile_origin escalation");
  if (seed.seeded_from_evidence !== true) throw new Error("seeded_from_evidence drift");
  if (seed.claim_status !== "unclaimed") throw new Error("claim escalation");
  if (seed.email_verified !== false) throw new Error("email verification escalation");
  if (seed.insurance_verified !== false) throw new Error("insurance verification escalation");
  if (seed.owner_user_id !== null) throw new Error("owner escalation");
  if (seed.invited_user_id !== null) throw new Error("invited user escalation");
  if (seed.affiliate_user_id !== null || seed.affiliate_tag !== null || seed.referral_code !== null) {
    throw new Error("affiliate attribution escalation");
  }
};

const seenKeys = new Set<string>();
const decisions: CanaryDecision[] = [];
const quarantineReasons: Record<string, number> = {};
let claimEscalations = 0;
let verificationEscalations = 0;
let ownerEscalations = 0;
let affiliateEscalations = 0;

rows.forEach((row, index) => {
  const normalized = normalizeSeed(row);
  const rowNumber = index + 1;
  const duplicateKey =
    String(row.target_profile_id || "").trim() ||
    `${normalized.name.toLowerCase()}|${normalized.city.toLowerCase()}|${normalized.state.toLowerCase()}`;

  if (seenKeys.has(duplicateKey)) {
    decisions.push({
      row: rowNumber,
      name: normalized.name,
      action: "duplicate_suppressed",
      reason: "duplicate_target_profile_id",
    });
    return;
  }
  seenKeys.add(duplicateKey);

  const validation = validateSeed(normalized);
  if (!validation.ok) {
    const action = validation.reason === "review_required" ? "quarantined" : "rejected";
    decisions.push({
      row: rowNumber,
      name: normalized.name || "(missing)",
      action,
      reason: validation.reason,
    });
    if (action === "quarantined") {
      quarantineReasons[validation.reason] = (quarantineReasons[validation.reason] || 0) + 1;
    }
    return;
  }

  const rawData = mergeSeedRawData({}, normalized);
  assertSafeAcceptedMetadata(rawData);
  const merlinSeed = (rawData as any).merlinSeed;
  claimEscalations += merlinSeed.claim_status === "unclaimed" ? 0 : 1;
  verificationEscalations +=
    merlinSeed.email_verified === false && merlinSeed.insurance_verified === false ? 0 : 1;
  ownerEscalations += merlinSeed.owner_user_id === null && merlinSeed.invited_user_id === null ? 0 : 1;
  affiliateEscalations +=
    merlinSeed.affiliate_user_id === null &&
    merlinSeed.affiliate_tag === null &&
    merlinSeed.referral_code === null
      ? 0
      : 1;

  decisions.push({
    row: rowNumber,
    name: normalized.name,
    action: "accepted",
    reason: "safe_evidence_seed",
  });
});

const result = {
  repo: "infotradescout/MealScout",
  commit: getCommit(),
  short_sha: getCommit().slice(0, 8),
  change: "Merlin import canary",
  source: "Merlin evidence_seed export",
  data_direction: "Merlin -> MealScout only",
  canary_result: {
    rows_received: rows.length,
    rows_accepted: decisions.filter((d) => d.action === "accepted").length,
    rows_quarantined: decisions.filter((d) => d.action === "quarantined").length,
    rows_rejected: decisions.filter((d) => d.action === "rejected").length,
    duplicates_suppressed: decisions.filter((d) => d.action === "duplicate_suppressed").length,
    claim_escalations: claimEscalations,
    verification_escalations: verificationEscalations,
    owner_escalations: ownerEscalations,
    affiliate_escalations: affiliateEscalations,
  },
  quarantine_reasons: quarantineReasons,
  decisions,
  write_scope: "local synthetic canary; no MealScout -> Merlin writes; no production batch import",
};

if (
  result.canary_result.claim_escalations !== 0 ||
  result.canary_result.verification_escalations !== 0 ||
  result.canary_result.owner_escalations !== 0 ||
  result.canary_result.affiliate_escalations !== 0
) {
  throw new Error("Canary detected escalation");
}

const artifactsDir = path.resolve(process.cwd(), "artifacts");
mkdirSync(artifactsDir, { recursive: true });
const jsonPath = path.join(artifactsDir, "mealscout-merlin-import-canary.json");
const mdPath = path.join(artifactsDir, "mealscout-merlin-import-canary.md");

writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(
  mdPath,
  [
    "# MealScout Merlin Import Canary",
    "",
    `repo: ${result.repo}`,
    `commit: ${result.commit}`,
    `short_sha: ${result.short_sha}`,
    `source: ${result.source}`,
    `data_direction: ${result.data_direction}`,
    "",
    "## Result",
    "",
    `rows_received: ${result.canary_result.rows_received}`,
    `rows_accepted: ${result.canary_result.rows_accepted}`,
    `rows_quarantined: ${result.canary_result.rows_quarantined}`,
    `rows_rejected: ${result.canary_result.rows_rejected}`,
    `duplicates_suppressed: ${result.canary_result.duplicates_suppressed}`,
    `claim_escalations: ${result.canary_result.claim_escalations}`,
    `verification_escalations: ${result.canary_result.verification_escalations}`,
    `owner_escalations: ${result.canary_result.owner_escalations}`,
    `affiliate_escalations: ${result.canary_result.affiliate_escalations}`,
    "",
    "## Quarantine Reasons",
    "",
    JSON.stringify(result.quarantine_reasons, null, 2),
    "",
    "## Decisions",
    "",
    ...result.decisions.map((d) => `- row=${d.row} action=${d.action} reason=${d.reason} name=${d.name}`),
    "",
  ].join("\n"),
  "utf8",
);

console.log(JSON.stringify(result, null, 2));
