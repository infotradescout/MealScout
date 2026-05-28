import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type BatchPayload = Record<string, any> & {
  logoPath?: string;
  logoFilePath?: string;
};

type ApplyResult = {
  businessName: string;
  matchedRestaurantId: string;
  matchedImportListingId: string;
  fieldsApplied: string[];
  fieldsSkipped: string[];
  menuStatus: string;
  scheduleStatus: string;
  logoStatus: string;
  conflicts: any[];
  missingInfo: string[];
  status: string;
  phase: "dry_run" | "apply";
};

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const parseBool = (value: string, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
};

const inputPath = getArg("--input");
const onlyBusiness = getArg("--only");
const baseUrl = getArg("--base-url") || process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5000";
const adminEmail = getArg("--email") || process.env.ADMIN_SMOKE_EMAIL || "";
const adminPassword = getArg("--password") || process.env.ADMIN_SMOKE_PASSWORD || "";
const continueOnReview = parseBool(getArg("--continue-on-review"), false);
const applyMode = hasFlag("--apply");
const dryRunOnly = hasFlag("--dry-run") || !applyMode;

if (!inputPath) {
  throw new Error("Missing required --input path.");
}
if (!adminEmail || !adminPassword) {
  throw new Error("Missing admin credentials. Provide --email/--password or ADMIN_SMOKE_EMAIL/ADMIN_SMOKE_PASSWORD.");
}

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

const getBusinessName = (payload: BatchPayload) =>
  String(
    payload?.business_name ||
      payload?.fillIfBlank?.name ||
      payload?.match?.name ||
      "Unknown business",
  ).trim();

const toFormData = (payload: BatchPayload, mode: "dry_run" | "apply") => {
  const formData = new FormData();
  const cloned: Record<string, any> = { ...payload, mode };
  delete cloned.logoPath;
  delete cloned.logoFilePath;
  formData.append("payload", JSON.stringify(cloned));

  const logoPath = String(payload.logoPath || payload.logoFilePath || "").trim();
  if (logoPath) {
    const absolutePath = path.isAbsolute(logoPath)
      ? logoPath
      : path.resolve(process.cwd(), logoPath);
    const fileBuffer = readFileSync(absolutePath);
    const fileName = path.basename(absolutePath);
    formData.append("image", new Blob([fileBuffer]), fileName);
  }

  return formData;
};

const callApplyEndpoint = async (
  cookie: string,
  payload: BatchPayload,
  mode: "dry_run" | "apply",
) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/profile-evidence/apply`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Accept: "application/json",
    },
    body: toFormData(payload, mode),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${getBusinessName(payload)} ${mode} failed (${response.status}): ${JSON.stringify(data)}`,
    );
  }
  return data;
};

const run = async () => {
  const raw = readFileSync(path.resolve(process.cwd(), inputPath), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Input file must be a JSON array of profile evidence payloads.");
  }

  const allPayloads: BatchPayload[] = parsed;
  const payloads = onlyBusiness
    ? allPayloads.filter((payload) => getBusinessName(payload) === onlyBusiness)
    : allPayloads;

  if (!payloads.length) {
    throw new Error("No payloads to process after filters.");
  }

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
    throw new Error(`Admin login failed (${loginRes.status}): ${JSON.stringify(loginPayload)}`);
  }
  const cookie = parseCookieHeader(loginRes);
  if (!cookie) {
    throw new Error("Admin login did not return a session cookie.");
  }

  const results: ApplyResult[] = [];
  const dryRunByBusiness = new Map<string, any>();

  for (const payload of payloads) {
    const businessName = getBusinessName(payload);
    const dry = await callApplyEndpoint(cookie, payload, "dry_run");
    dryRunByBusiness.set(businessName, dry);
    results.push({
      businessName,
      matchedRestaurantId: String(dry.matchedRestaurantId || ""),
      matchedImportListingId: String(dry.matchedImportListingId || ""),
      fieldsApplied: Array.isArray(dry.fieldsApplied) ? dry.fieldsApplied : [],
      fieldsSkipped: Array.isArray(dry.fieldsSkipped) ? dry.fieldsSkipped : [],
      menuStatus: String(dry.menuStatus || "none"),
      scheduleStatus: String(dry.scheduleStatus || "none"),
      logoStatus: String(dry.logoStatus || "none"),
      conflicts: Array.isArray(dry.conflicts) ? dry.conflicts : [],
      missingInfo: Array.isArray(dry.missingInfo) ? dry.missingInfo : [],
      status: String(dry.status || "dry_run"),
      phase: "dry_run",
    });

    const hasReview =
      String(dry.status || "").toLowerCase() === "needs_review" ||
      (Array.isArray(dry.conflicts) &&
        dry.conflicts.some((conflict: any) =>
          String(conflict?.reason || "").toLowerCase().includes("multiple_strong_matches"),
        ));

    if (hasReview && !continueOnReview) {
      throw new Error(
        `Dry run stopped at "${businessName}" because status=needs_review or multiple matches.`,
      );
    }
  }

  if (!dryRunOnly) {
    for (const payload of payloads) {
      const businessName = getBusinessName(payload);
      const dry = dryRunByBusiness.get(businessName) || {};
      const isNeedsReview = String(dry.status || "").toLowerCase() === "needs_review";
      const hasMultipleMatch = Array.isArray(dry.conflicts)
        ? dry.conflicts.some((conflict: any) =>
            String(conflict?.reason || "").toLowerCase().includes("multiple_strong_matches"),
          )
        : false;
      if (isNeedsReview || hasMultipleMatch) {
        if (!continueOnReview) {
          throw new Error(`Apply stopped at "${businessName}" due to review state.`);
        }
        continue;
      }

      const applied = await callApplyEndpoint(cookie, payload, "apply");
      results.push({
        businessName,
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
        status: String(applied.status || "applied"),
        phase: "apply",
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    mode: dryRunOnly ? "dry_run" : "apply",
    input: path.resolve(process.cwd(), inputPath),
    onlyBusiness: onlyBusiness || null,
    continueOnReview,
    results,
  };

  const outputPath = path.resolve(
    process.cwd(),
    `profile_evidence_batch_report_${Date.now()}.json`,
  );
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");

  console.log(`Processed ${payloads.length} payload(s).`);
  console.log(`Report written: ${outputPath}`);
};

run().catch((error) => {
  console.error("applyProfileEvidenceBatch failed:", error);
  process.exit(1);
});
