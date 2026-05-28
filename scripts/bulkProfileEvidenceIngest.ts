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
const adminEmail = getArg("--email") || process.env.ADMIN_SMOKE_EMAIL || "";
const adminPassword =
  getArg("--password") || process.env.ADMIN_SMOKE_PASSWORD || "";
const applySafe = hasFlag("--apply-safe");
const onlyBusiness = getArg("--only");

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

const run = async () => {
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

  for (const record of records) {
    const businessName = businessNameOf(record);
    const dry = await callApply(record, "dry_run");
    const classification = classifyDryRun(record, dry);

    const sourceEvidenceLinks = [
      ...(Array.isArray(record.source_urls) ? record.source_urls : []),
      ...(Array.isArray(record.source_files) ? record.source_files : []),
    ];

    const baseRow = {
      businessName,
      classification,
      status: String(dry.status || "dry_run"),
      matchedRestaurantId: String(dry.matchedRestaurantId || ""),
      matchedImportListingId: String(dry.matchedImportListingId || ""),
      fieldsApplied: Array.isArray(dry.fieldsApplied) ? dry.fieldsApplied : [],
      fieldsSkipped: Array.isArray(dry.fieldsSkipped) ? dry.fieldsSkipped : [],
      menuStatus: String(dry.menuStatus || "none"),
      scheduleStatus: String(dry.scheduleStatus || "none"),
      logoStatus: String(dry.logoStatus || "none"),
      conflicts: Array.isArray(dry.conflicts) ? dry.conflicts : [],
      missingInfo: Array.isArray(dry.missingInfo) ? dry.missingInfo : [],
      sourceEvidenceLinks,
      phase: "dry_run",
    };

    if (classification === "reject") {
      rejectedCount += 1;
      reportRows.push(baseRow);
      missingInfoReport.push({
        businessName,
        missingInfo: baseRow.missingInfo,
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
      if (baseRow.missingInfo.length) {
        missingInfoReport.push({
          businessName,
          missingInfo: baseRow.missingInfo,
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
      matchedRestaurantId: String(applied.matchedRestaurantId || ""),
      matchedImportListingId: String(applied.matchedImportListingId || ""),
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
      missingInfo: Array.isArray(applied.missingInfo) ? applied.missingInfo : [],
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
    if (appliedRow.missingInfo.length) {
      missingInfoReport.push({
        businessName,
        missingInfo: appliedRow.missingInfo,
      });
    }
  }

  // We treat items not applied due to review/reject as skipped for bulk stats.
  skippedDuplicateCount = reportRows.filter(
    (row) => row.classification === "needs_review" || row.classification === "reject",
  ).length;

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath: path.resolve(process.cwd(), inputPath),
    applySafe,
    totals: {
      createdCount,
      updatedCount,
      skippedDuplicateCount,
      needsReviewCount,
      rejectedCount,
      processedCount: records.length,
    },
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
