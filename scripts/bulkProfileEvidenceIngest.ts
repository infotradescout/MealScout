import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type IngestRecord = {
  business_name?: string;
  profileType?: string;
  match?: Record<string, any>;
  fillIfBlank?: Record<string, any>;
  descriptionOnlyIfBlank?: string;
  menuItems?: any[];
  scheduleItems?: any[];
  sourceNotes?: string[];
  source_urls?: string[];
  source_files?: string[];
  missingInfo?: string[];
  confidence?: string;
  logoPath?: string;
  logoFilePath?: string;
  [key: string]: any;
};

type Classification =
  | "update_existing"
  | "create_draft"
  | "needs_review"
  | "reject";

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};
const hasFlag = (flag: string) => process.argv.includes(flag);

const inputPath = getArg("--input");
const baseUrl =
  getArg("--base-url") || process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5000";
const baseOrigin = new URL(baseUrl).origin;
const adminEmail = getArg("--email") || process.env.ADMIN_SMOKE_EMAIL || "";
const adminPassword =
  getArg("--password") || process.env.ADMIN_SMOKE_PASSWORD || "";
const applySafe = hasFlag("--apply-safe");
const onlyBusiness = getArg("--only");
const sourceFolderId = getArg("--source-folder-id") || process.env.INTAKE_SOURCE_FOLDER_ID || "";

if (!inputPath) throw new Error("Missing required --input ./batch.json");
if (!adminEmail || !adminPassword) {
  throw new Error(
    "Missing admin credentials. Set ADMIN_SMOKE_EMAIL/ADMIN_SMOKE_PASSWORD or pass --email/--password.",
  );
}

// normalize every record
const normalize = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();
const normalizePhone = (value: unknown) =>
  String(value || "").replace(/[^\d]/g, "");

const parseCookieHeader = (res: Response): string => {
  const getSetCookie = (res.headers as any).getSetCookie;
  if (typeof getSetCookie === "function") {
    const cookies = getSetCookie.call(res.headers) as string[];
    return cookies
      .map((entry) => String(entry || "").split(";")[0])
      .filter(Boolean)
      .join("; ");
  }
  const fallback = res.headers.get("set-cookie");
  return fallback ? String(fallback).split(";")[0] : "";
};

const businessNameOf = (record: IngestRecord) =>
  String(
    record.business_name ||
      record.fillIfBlank?.name ||
      record.match?.name ||
      "Unknown business",
  ).trim();

const getSourceFileId = (record: IngestRecord) =>
  String(
    record.sourceFileId ||
      record.source_file_id ||
      record.fileId ||
      record.rawSource?.fileId ||
      "",
  ).trim();

const getSourceFileName = (record: IngestRecord) =>
  String(
    record.sourceFileName ||
      record.source_file_name ||
      record.fileName ||
      record.rawSource?.fileName ||
      "",
  ).trim();

const toPayload = (record: IngestRecord, mode: "dry_run" | "apply") => ({
  mode,
  profileType: record.profileType || record.type || "unknown",
  match: record.match || {},
  fillIfBlank: record.fillIfBlank || {},
  descriptionOnlyIfBlank: String(record.descriptionOnlyIfBlank || "").trim(),
  menuItems: Array.isArray(record.menuItems) ? record.menuItems : [],
  scheduleItems: Array.isArray(record.scheduleItems) ? record.scheduleItems : [],
  sourceNotes: Array.isArray(record.sourceNotes) ? record.sourceNotes : [],
  missingInfo: Array.isArray(record.missingInfo) ? record.missingInfo : [],
  logoUpload: {
    enabled: true,
    fileField: "image",
  },
});

const buildFormData = (record: IngestRecord, mode: "dry_run" | "apply") => {
  const formData = new FormData();
  formData.append("payload", JSON.stringify(toPayload(record, mode)));

  const logoPath = String(record.logoPath || record.logoFilePath || "").trim();
  if (logoPath) {
    const absolutePath = path.isAbsolute(logoPath)
      ? logoPath
      : path.resolve(process.cwd(), logoPath);
    const fileBuffer = readFileSync(absolutePath);
    formData.append("image", new Blob([fileBuffer]), path.basename(absolutePath));
  }
  return formData;
};

// no name-only duplicates: require strong identifier before auto classification/apply
const hasStrongIdentifier = (record: IngestRecord) => {
  const match = record.match || {};
  const fill = record.fillIfBlank || {};
  return Boolean(
    normalizePhone(match.phone || fill.phone) ||
      normalize(match.email || fill.email) ||
      normalize(match.website || fill.website || fill.websiteUrl) ||
      normalize(match.facebook || fill.facebook || fill.facebookPageUrl) ||
      normalize(match.instagram || fill.instagram || fill.instagramUrl) ||
      (normalize(match.name || fill.name) &&
        normalize(match.city || fill.city) &&
        normalize(match.state || fill.state)),
  );
};

const classifyDryRun = (record: IngestRecord, dry: any): Classification => {
  if (!hasStrongIdentifier(record)) return "reject";
  if (String(dry.status || "").toLowerCase() === "needs_review")
    return "needs_review";
  if (Array.isArray(dry.conflicts) && dry.conflicts.length > 0)
    return "needs_review";
  if (dry.createdDraftId) return "create_draft";
  if (dry.matchedRestaurantId || dry.matchedImportListingId) return "update_existing";
  return "needs_review";
};

const computePublishGate = (record: IngestRecord, dry: any) => {
  const match = record.match || {};
  const fill = record.fillIfBlank || {};
  const debug = (dry?.debug || {}) as any;
  const name = String(fill.name || match.name || record.business_name || "").trim();
  const city = String(fill.city || match.city || "").trim();
  const state = String(fill.state || match.state || "").trim();
  const cuisine = String(fill.category || fill.cuisineType || match.category || "").trim();
  const phone = normalizePhone(fill.phone || match.phone);
  const email = normalize(fill.email || match.email);
  const menuItems = Array.isArray(record.menuItems) ? record.menuItems : [];
  const hasMenuItem = menuItems.length > 0 || Boolean(debug?.menuSignals?.hasMenuItems);
  const menuDeferred = Boolean(
    record?.rawSource?.evidenceIngest?.extracted?.menuDeferred ||
      record?.menuDeferred ||
      record?.fillIfBlank?.menuDeferred,
  );
  const publishBlockedReasons: string[] = [];
  if (!name) publishBlockedReasons.push("missing_name");
  if (!city && !state) publishBlockedReasons.push("missing_city_or_state");
  if (!cuisine) publishBlockedReasons.push("missing_cuisine");
  if (!phone && !email) publishBlockedReasons.push("missing_phone_or_email");
  if (!hasMenuItem && !menuDeferred) publishBlockedReasons.push("missing_menu_or_menuDeferred");
  const publishEligible = publishBlockedReasons.length === 0;
  return { publishEligible, publishBlockedReasons, menuDeferred };
};

const run = async () => {
  const startedAt = new Date().toISOString();
  const runId = `intake_${Date.now()}`;
  const raw = readFileSync(path.resolve(process.cwd(), inputPath), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Input must be a JSON array.");
  }

  const allRecords: IngestRecord[] = parsed;
  const records = onlyBusiness
    ? allRecords.filter((record) => businessNameOf(record) === onlyBusiness)
    : allRecords;
  if (!records.length) throw new Error("No records to process.");

  const loginRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: baseOrigin,
      Referer: `${baseOrigin}/`,
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginPayload = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok) {
    throw new Error(
      `Login failed (${loginRes.status}): ${JSON.stringify(loginPayload)}`,
    );
  }
  const cookie = parseCookieHeader(loginRes);
  if (!cookie) throw new Error("Login succeeded but no cookie returned.");

  const callApply = async (record: IngestRecord, mode: "dry_run" | "apply") => {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/admin/profile-evidence/apply`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          Origin: baseOrigin,
          Referer: `${baseOrigin}/`,
        },
        body: buildFormData(record, mode),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `${businessNameOf(record)} ${mode} failed (${res.status}): ${JSON.stringify(data)}`,
      );
    }
    return data;
  };

  const reportRows: any[] = [];
  const reviewQueue: any[] = [];
  const conflictsReport: any[] = [];
  const missingInfoReport: any[] = [];

  let createdCount = 0;
  let updatedCount = 0;
  let skippedDuplicateCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  let menuDeferredCount = 0;
  let publishBlockedCount = 0;
  let publishEligibleCount = 0;
  let existingProfilesMatched = 0;
  let draftsCreated = 0;
  let updatesQueued = 0;
  let weakMatchesNeedingReview = 0;
  let duplicateCandidatesAvoided = 0;
  const errors: Array<{ sourceFileName: string; error: string }> = [];

  for (const record of records) {
    const businessName = businessNameOf(record);
    const dry = await callApply(record, "dry_run");
    const classification = classifyDryRun(record, dry);

    const sourceEvidenceLinks = [
      ...(Array.isArray(record.source_urls) ? record.source_urls : []),
      ...(Array.isArray(record.source_files) ? record.source_files : []),
    ];

    const publishGate = computePublishGate(record, dry);
    if (publishGate.menuDeferred) menuDeferredCount += 1;
    if (publishGate.publishEligible) publishEligibleCount += 1;
    else publishBlockedCount += 1;
    const debug = (dry?.debug || {}) as any;
    const matchedBy = Array.isArray(dry?.matchedBy)
      ? dry.matchedBy
      : Array.isArray(debug?.matchedBy)
        ? debug.matchedBy
        : [];
    const matchStrength = String(dry?.matchStrength || debug?.matchStrength || "none");
    const classificationReasons = Array.isArray(debug?.classificationReasons)
      ? debug.classificationReasons
      : [];
    const whyUnknown = Array.isArray(debug?.whyUnknown) ? debug.whyUnknown : [];
    const baseRow = {
      sourceFileId: getSourceFileId(record),
      sourceFileName: getSourceFileName(record),
      businessName,
      classification,
      classificationReasons,
      status: String(dry.status || "dry_run"),
      existingTruckId: String(dry.existingTruckId || debug?.existingTruckId || ""),
      matchStrength,
      matchedBy,
      matchedRestaurantId: String(dry.matchedRestaurantId || ""),
      matchedImportListingId: String(dry.matchedImportListingId || ""),
      draftId: String(dry.createdDraftId || ""),
      fieldsApplied: Array.isArray(dry.fieldsApplied) ? dry.fieldsApplied : [],
      fieldsSkipped: Array.isArray(dry.fieldsSkipped) ? dry.fieldsSkipped : [],
      menuStatus: String(dry.menuStatus || "none"),
      scheduleStatus: String(dry.scheduleStatus || "none"),
      logoStatus: String(dry.logoStatus || "none"),
      conflicts: Array.isArray(dry.conflicts) ? dry.conflicts : [],
      missingFields: Array.isArray(debug?.missingFields)
        ? debug.missingFields
        : Array.isArray(dry.missingInfo)
          ? dry.missingInfo
          : [],
      publishEligible: publishGate.publishEligible,
      publishBlockedReasons: publishGate.publishBlockedReasons,
      whyUnknown,
      ocrConfidence: Number(debug?.ocrConfidence || 0),
      sourceEvidenceLinks,
      phase: "dry_run",
    };
    if (baseRow.existingTruckId) existingProfilesMatched += 1;
    if (baseRow.draftId) draftsCreated += 1;
    if (classification === "update_existing") updatesQueued += 1;
    if (classification === "needs_review" && matchStrength === "weak") {
      weakMatchesNeedingReview += 1;
      duplicateCandidatesAvoided += 1;
    }

    if (classification === "reject") {
      rejectedCount += 1;
      reportRows.push(baseRow);
      missingInfoReport.push({
        businessName,
        missingInfo: baseRow.missingFields,
      });
      continue;
    }

    if (classification === "needs_review") {
      needsReviewCount += 1;
      reviewQueue.push(baseRow);
      reportRows.push(baseRow);
      if (baseRow.conflicts.length) {
        conflictsReport.push({
          businessName,
          conflicts: baseRow.conflicts,
        });
      }
      if (baseRow.missingFields.length) {
        missingInfoReport.push({
          businessName,
          missingInfo: baseRow.missingFields,
        });
      }
      continue;
    }

    if (!applySafe) {
      reportRows.push(baseRow);
      continue;
    }

    const applied = await callApply(record, "apply");
    const appliedRow = {
      ...baseRow,
      status: String(applied.status || "applied"),
      existingTruckId: String(applied.existingTruckId || baseRow.existingTruckId || ""),
      matchStrength: String(applied.matchStrength || baseRow.matchStrength || "none"),
      matchedBy: Array.isArray(applied.matchedBy) ? applied.matchedBy : baseRow.matchedBy,
      matchedRestaurantId: String(applied.matchedRestaurantId || ""),
      matchedImportListingId: String(applied.matchedImportListingId || ""),
      draftId: String(applied.createdDraftId || baseRow.draftId || ""),
      fieldsApplied: Array.isArray(applied.fieldsApplied)
        ? applied.fieldsApplied
        : [],
      fieldsSkipped: Array.isArray(applied.fieldsSkipped)
        ? applied.fieldsSkipped
        : [],
      menuStatus: String(applied.menuStatus || "none"),
      scheduleStatus: String(applied.scheduleStatus || "none"),
      logoStatus: String(applied.logoStatus || "none"),
      conflicts: Array.isArray(applied.conflicts) ? applied.conflicts : [],
      missingFields: Array.isArray(applied?.debug?.missingFields)
        ? applied.debug.missingFields
        : Array.isArray(applied.missingInfo)
          ? applied.missingInfo
          : baseRow.missingFields,
      publishEligible: baseRow.publishEligible,
      publishBlockedReasons: baseRow.publishBlockedReasons,
      whyUnknown: Array.isArray(applied?.debug?.whyUnknown)
        ? applied.debug.whyUnknown
        : baseRow.whyUnknown,
      ocrConfidence: Number(applied?.debug?.ocrConfidence || baseRow.ocrConfidence || 0),
      phase: "apply",
    };

    reportRows.push(appliedRow);
    if (classification === "create_draft") createdCount += 1;
    if (classification === "update_existing") updatedCount += 1;
    if (appliedRow.status === "needs_review") needsReviewCount += 1;

    if (appliedRow.conflicts.length) {
      conflictsReport.push({
        businessName,
        conflicts: appliedRow.conflicts,
      });
    }
    if (appliedRow.missingFields.length) {
      missingInfoReport.push({
        businessName,
        missingInfo: appliedRow.missingFields,
      });
    }
  }

  // We treat items not applied due to review/reject as skipped for bulk stats.
  skippedDuplicateCount = reportRows.filter(
    (row) => row.classification === "needs_review" || row.classification === "reject",
  ).length;

  const completedAt = new Date().toISOString();
  const report = {
    runId,
    startedAt,
    completedAt,
    sourceFolderId: sourceFolderId || null,
    generatedAt: completedAt,
    inputPath: path.resolve(process.cwd(), inputPath),
    applySafe,
    totals: {
      totalFiles: records.length,
      processedFiles: reportRows.length,
      unknownFiles: reportRows.filter((row) => row.classification === "reject").length,
      draftsCreated,
      existingProfilesMatched,
      updatesQueued,
      weakMatchesNeedingReview,
      menuDeferredCount,
      publishBlockedCount,
      publishEligibleCount,
      duplicateCandidatesAvoided,
      createdCount,
      updatedCount,
      skippedDuplicateCount,
      needsReviewCount,
      rejectedCount,
      processedCount: records.length,
    },
    errors,
    reviewQueue,
    conflictsReport,
    missingInfoReport,
    rows: reportRows,
  };

  const outputPath = path.resolve(
    process.cwd(),
    `bulk_profile_evidence_report_${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals: report.totals,
        outputPath,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("bulkProfileEvidenceIngest failed:", error);
  process.exit(1);
});
