import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildManualProfileEvidenceFormData,
  normalizeManualProfileAssetIntake,
  type ManualProfileAssetManifest,
} from "./manualProfileAssetIntake";
import { buildProfileAssetEvidence } from "../shared/profileAssetEvidence";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const INTAKE_AT = "2026-07-21T12:00:00.000Z";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const root = mkdtempSync(path.join(os.tmpdir(), "mealscout-manual-intake-"));

function writeIntake(slug: string, manifest: ManualProfileAssetManifest) {
  const profileRoot = path.join(root, "artifacts", "manual-intake", "mealscout", slug);
  const incoming = path.join(profileRoot, "incoming");
  mkdirSync(incoming, { recursive: true });
  const manifestPath = path.join(profileRoot, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { incoming, manifestPath, normalized: path.join(profileRoot, "normalized") };
}

try {
  const manifest: ManualProfileAssetManifest = {
    brand: "mealscout",
    profileSlug: "example-truck",
    existingProfileId: PROFILE_ID,
    ownerUserId: OWNER_ID,
    source: "manual_codex_intake",
    applyMode: "append_only_enrichment",
    profileType: "food_truck",
    files: [
      { inputName: "candidate-logo.png", targetName: "logo.png", assetType: "logo" },
      { inputName: "menu-front.png", targetName: "menu-front.png", assetType: "menu" },
    ],
  };
  const intake = writeIntake(manifest.profileSlug, manifest);
  writeFileSync(path.join(intake.incoming, "candidate-logo.png"), PNG);
  writeFileSync(path.join(intake.incoming, "menu-front.png"), PNG);

  const normalized = normalizeManualProfileAssetIntake({
    projectRoot: root,
    manifestPath: intake.manifestPath,
    intakeAt: INTAKE_AT,
  });
  assert.equal(normalized.projectRoot, root);
  assert.equal(normalized.evidence.length, 2);
  assert.ok(existsSync(path.join(intake.normalized, "logo.png")));
  assert.ok(existsSync(normalized.evidenceManifestPath));
  assert.ok(existsSync(normalized.payloadPath));
  assert.deepEqual(
    normalized.evidence.map((item) => item.source),
    ["manual_codex_intake", "manual_codex_intake"],
  );
  assert.deepEqual(
    normalized.evidence.map((item) => item.reviewStatus),
    ["pending_review", "pending_review"],
  );
  assert.ok(normalized.evidence.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(normalized.evidence.every((item) => item.profileId === PROFILE_ID));
  assert.ok(normalized.evidence.every((item) => item.ownerUserId === OWNER_ID));

  const userUploadEvidence = buildProfileAssetEvidence({
    ...normalized.evidence[0],
    source: "admin_user_upload",
    normalizedPath: "https://cdn.example.test/profile/logo.png",
  });
  assert.deepEqual(
    Object.keys(normalized.evidence[0]).sort(),
    Object.keys(userUploadEvidence).sort(),
    "manual and user-upload evidence must resolve to the same canonical shape",
  );

  const dryRun = buildManualProfileEvidenceFormData(normalized, { mode: "dry_run" });
  assert.deepEqual(Array.from(dryRun.keys()).sort(), ["menuImages", "payload", "profileImages"]);
  const dryRunPayload = JSON.parse(String(dryRun.get("payload")));
  assert.equal(dryRunPayload.mode, "dry_run");
  assert.equal(dryRunPayload.existingProfileId, PROFILE_ID);
  assert.equal(dryRunPayload.expectedOwnerUserId, OWNER_ID);
  assert.equal(dryRunPayload.logoUpload.enabled, false);
  assert.equal(dryRunPayload.approvals.evidencePublication, false);

  const approved = buildManualProfileEvidenceFormData(normalized, {
    mode: "apply",
    approveLogo: true,
    approveEvidencePublication: true,
  });
  assert.deepEqual(Array.from(approved.keys()).sort(), ["logoImage", "menuImages", "payload"]);

  const repeated = normalizeManualProfileAssetIntake({
    projectRoot: root,
    manifestPath: intake.manifestPath,
    intakeAt: INTAKE_AT,
  });
  assert.equal(repeated.evidence[0].sha256, normalized.evidence[0].sha256);

  writeFileSync(path.join(intake.normalized, "logo.png"), Buffer.concat([PNG, Buffer.from([2])]));
  assert.throws(
    () => buildManualProfileEvidenceFormData(normalized, { mode: "dry_run" }),
    /no longer matches evidence manifest/,
  );
  writeFileSync(path.join(intake.normalized, "logo.png"), PNG);

  writeFileSync(path.join(intake.incoming, "candidate-logo.png"), Buffer.concat([PNG, Buffer.from([1])]));
  assert.throws(
    () =>
      normalizeManualProfileAssetIntake({
        projectRoot: root,
        manifestPath: intake.manifestPath,
        intakeAt: INTAKE_AT,
      }),
    /Refusing to overwrite different normalized asset/,
  );

  const missingManifest: ManualProfileAssetManifest = {
    ...manifest,
    profileSlug: "missing-binary",
    files: [{ inputName: "missing.png", targetName: "missing.png", assetType: "profile_media" }],
  };
  const missing = writeIntake(missingManifest.profileSlug, missingManifest);
  assert.throws(
    () =>
      normalizeManualProfileAssetIntake({
        projectRoot: root,
        manifestPath: missing.manifestPath,
        intakeAt: INTAKE_AT,
      }),
    /Missing intake binary/,
  );
  assert.equal(existsSync(missing.normalized), false, "preflight must not leave partial output");

  const traversalManifest = {
    ...manifest,
    profileSlug: "path-traversal",
    files: [{ inputName: "../secret.png", targetName: "secret.png", assetType: "profile_media" }],
  } as ManualProfileAssetManifest;
  const traversal = writeIntake(traversalManifest.profileSlug, traversalManifest);
  assert.throws(
    () =>
      normalizeManualProfileAssetIntake({
        projectRoot: root,
        manifestPath: traversal.manifestPath,
        intakeAt: INTAKE_AT,
      }),
    /plain filename/,
  );

  const routeSource = readFileSync(
    path.resolve(process.cwd(), "server/routes/admin/truckImportAdminRoutes.ts"),
    "utf8",
  );
  for (const required of [
    "existing_profile_not_found",
    "existing_profile_owner_mismatch",
    "buildProfileAssetEvidence",
    "manual_evidence_manifest_mismatch",
    "allowEvidencePublication",
    "if (allowEvidencePublication)",
    "publicApproved: true",
    'deliveryType: queuesOwnerReview',
  ]) {
    assert.ok(routeSource.includes(required), `admin evidence route is missing ${required}`);
  }

  console.log("manual profile asset intake contract: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
