import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type SmokePacketInput = {
  profileType:
    | "food_truck"
    | "restaurant"
    | "bar"
    | "caterer"
    | "private_chef"
    | "unknown";
  match: Record<string, unknown>;
  fillIfBlank: Record<string, unknown>;
  descriptionOnlyIfBlank?: string;
  menuItems?: any[];
  scheduleItems?: any[];
  sourceNotes?: string[];
  missingInfo?: string[];
  evidenceFieldProposals?: Array<Record<string, unknown>>;
  approvals?: {
    menuOverwrite?: boolean;
    logoOverwrite?: boolean;
  };
};

type FileArgs = {
  logoImage: string;
  profileImages: string[];
  menuImages: string[];
  hoursImages: string[];
  contactImages: string[];
};

const getArg = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
};

const hasFlag = (flag: string) => process.argv.includes(flag);

const parseCsvPaths = (value: string) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const toAbsolute = (value: string) =>
  path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);

const requirePath = (label: string, value: string) => {
  if (!value) {
    throw new Error(`Missing required ${label}.`);
  }
  const absolute = toAbsolute(value);
  if (!existsSync(absolute)) {
    throw new Error(`File does not exist for ${label}: ${absolute}`);
  }
  return absolute;
};

const requirePathList = (label: string, values: string[]) => {
  if (!values.length) {
    throw new Error(`Missing required ${label}. Provide at least one file.`);
  }
  return values.map((value, index) => requirePath(`${label}[${index}]`, value));
};

const parseJson = <T>(inputPath: string): T => {
  const absolutePath = toAbsolute(inputPath);
  const content = readFileSync(absolutePath, "utf8");
  return JSON.parse(content) as T;
};

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

const buildPayload = (
  packet: SmokePacketInput,
  mode: "dry_run" | "apply",
  approvalsOverride?: { menuOverwrite?: boolean; logoOverwrite?: boolean },
) => ({
  mode,
  profileType: packet.profileType || "food_truck",
  match: packet.match || {},
  fillIfBlank: packet.fillIfBlank || {},
  descriptionOnlyIfBlank: String(packet.descriptionOnlyIfBlank || "").trim(),
  menuItems: Array.isArray(packet.menuItems) ? packet.menuItems : [],
  scheduleItems: Array.isArray(packet.scheduleItems)
    ? packet.scheduleItems
    : [],
  sourceNotes: Array.isArray(packet.sourceNotes) ? packet.sourceNotes : [],
  missingInfo: Array.isArray(packet.missingInfo) ? packet.missingInfo : [],
  evidenceFieldProposals: Array.isArray(packet.evidenceFieldProposals)
    ? packet.evidenceFieldProposals
    : [],
  approvals: {
    menuOverwrite: Boolean(
      approvalsOverride?.menuOverwrite ?? packet.approvals?.menuOverwrite,
    ),
    logoOverwrite: Boolean(
      approvalsOverride?.logoOverwrite ?? packet.approvals?.logoOverwrite,
    ),
  },
  logoUpload: {
    enabled: true,
    fileField: "logoImage",
  },
});

const addFileToForm = (
  formData: FormData,
  key: string,
  absolutePath: string,
) => {
  const fileName = path.basename(absolutePath);
  const fileBuffer = readFileSync(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const mimeType =
    extension === ".png"
      ? "image/png"
      : extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : "application/octet-stream";
  formData.append(key, new Blob([fileBuffer], { type: mimeType }), fileName);
};

const buildFormData = (
  packet: SmokePacketInput,
  fileArgs: FileArgs,
  mode: "dry_run" | "apply",
  approvalsOverride?: { menuOverwrite?: boolean; logoOverwrite?: boolean },
) => {
  const formData = new FormData();
  formData.append(
    "payload",
    JSON.stringify(buildPayload(packet, mode, approvalsOverride)),
  );

  addFileToForm(formData, "logoImage", fileArgs.logoImage);
  fileArgs.profileImages.forEach((filePath) =>
    addFileToForm(formData, "profileImages", filePath),
  );
  fileArgs.menuImages.forEach((filePath) =>
    addFileToForm(formData, "menuImages", filePath),
  );
  fileArgs.hoursImages.forEach((filePath) =>
    addFileToForm(formData, "hoursImages", filePath),
  );
  fileArgs.contactImages.forEach((filePath) =>
    addFileToForm(formData, "contactImages", filePath),
  );

  return formData;
};

const assertCoreSmokeResult = (result: any, mode: "dry_run" | "apply") => {
  if (
    String(result?.status || "") !== (mode === "apply" ? "applied" : "dry_run")
  ) {
    throw new Error(
      `Unexpected status for ${mode}: ${String(result?.status || "")}`,
    );
  }

  const hasUploadedEvidenceArray = Array.isArray(result?.uploadedEvidence);
  if (!hasUploadedEvidenceArray) {
    throw new Error(`${mode} result is missing uploadedEvidence array.`);
  }

  if (typeof result?.evidenceStatus !== "string") {
    throw new Error(`${mode} result is missing evidenceStatus.`);
  }

  if (typeof result?.menuEvidenceStatus !== "string") {
    throw new Error(`${mode} result is missing menuEvidenceStatus.`);
  }

  if (!Array.isArray(result?.reviewQueueItems)) {
    throw new Error(`${mode} result is missing reviewQueueItems array.`);
  }
};

const assertNoSilentOverwriteSignals = (
  result: any,
  mode: "dry_run" | "apply",
) => {
  const menuStatus = String(result?.menuStatus || "");
  const logoStatus = String(result?.logoStatus || "");

  if (mode === "dry_run") {
    if (menuStatus === "added") {
      throw new Error("Dry-run unexpectedly reports menuStatus=added.");
    }
    if (logoStatus === "uploaded") {
      throw new Error("Dry-run unexpectedly reports logoStatus=uploaded.");
    }
  }

  const reviewQueue = Array.isArray(result?.reviewQueueItems)
    ? result.reviewQueueItems
    : [];
  const hasMenuReviewQueueItem = reviewQueue.some(
    (item: any) =>
      String(item?.type || "") === "menu_evidence_review" ||
      String(item?.type || "") === "menu_conflict",
  );

  if (!hasMenuReviewQueueItem && menuStatus === "queued_review") {
    throw new Error(
      "Menu is queued for review but no menu review queue item was returned.",
    );
  }
};

const run = async () => {
  const packetPath =
    getArg("--packet") ||
    "artifacts/mealscout-onboarding/3d-eats-and-tea/profile-enrichment.json";
  const baseUrl =
    getArg("--base-url") ||
    process.env.ADMIN_SMOKE_BASE_URL ||
    "http://127.0.0.1:5000";
  const baseOrigin = new URL(baseUrl).origin;
  const adminEmail = getArg("--email") || process.env.ADMIN_SMOKE_EMAIL || "";
  const adminPassword =
    getArg("--password") || process.env.ADMIN_SMOKE_PASSWORD || "";

  const apply = hasFlag("--apply");
  const menuOverwrite = hasFlag("--menu-overwrite");
  const logoOverwrite = hasFlag("--logo-overwrite");
  const allowProduction = hasFlag("--allow-production");

  const baseUrlHost = (() => {
    try {
      return new URL(baseUrl).host.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (!allowProduction && /mealscout\.us$/i.test(baseUrlHost)) {
    throw new Error(
      "Refusing to target production host without --allow-production.",
    );
  }

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Missing admin credentials. Provide --email/--password or ADMIN_SMOKE_EMAIL/ADMIN_SMOKE_PASSWORD.",
    );
  }

  const fileArgs: FileArgs = {
    logoImage: requirePath("--logo", getArg("--logo")),
    profileImages: requirePathList(
      "--profile-images",
      parseCsvPaths(getArg("--profile-images")),
    ),
    menuImages: requirePathList(
      "--menu-images",
      parseCsvPaths(getArg("--menu-images")),
    ),
    hoursImages: requirePathList(
      "--hours-images",
      parseCsvPaths(getArg("--hours-images")),
    ),
    contactImages: requirePathList(
      "--contact-images",
      parseCsvPaths(getArg("--contact-images")),
    ),
  };

  const packet = parseJson<SmokePacketInput>(packetPath);

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
  const loginData = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok) {
    throw new Error(
      `Admin login failed (${loginRes.status}): ${JSON.stringify(loginData)}`,
    );
  }
  const cookie = parseCookieHeader(loginRes);
  if (!cookie) {
    throw new Error(
      "Admin login succeeded but no session cookie was returned.",
    );
  }

  const callApplyEndpoint = async (
    mode: "dry_run" | "apply",
    approvalsOverride?: { menuOverwrite?: boolean; logoOverwrite?: boolean },
  ) => {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/admin/profile-evidence/apply`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
          Origin: baseOrigin,
          Referer: `${baseOrigin}/`,
        },
        body: buildFormData(packet, fileArgs, mode, approvalsOverride),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `${mode} failed (${response.status}): ${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };

  const dryRunResult = await callApplyEndpoint("dry_run", {
    menuOverwrite: false,
    logoOverwrite: false,
  });

  assertCoreSmokeResult(dryRunResult, "dry_run");
  assertNoSilentOverwriteSignals(dryRunResult, "dry_run");

  console.log("[manual-intake-smoke] dry-run passed");
  console.log(
    JSON.stringify(
      {
        status: dryRunResult.status,
        matchedRestaurantId: dryRunResult.matchedRestaurantId || null,
        matchedImportListingId: dryRunResult.matchedImportListingId || null,
        menuStatus: dryRunResult.menuStatus,
        logoStatus: dryRunResult.logoStatus,
        evidenceStatus: dryRunResult.evidenceStatus,
        menuEvidenceStatus: dryRunResult.menuEvidenceStatus,
        reviewQueueItems: Array.isArray(dryRunResult.reviewQueueItems)
          ? dryRunResult.reviewQueueItems.length
          : 0,
        uploadedEvidence: Array.isArray(dryRunResult.uploadedEvidence)
          ? dryRunResult.uploadedEvidence.length
          : 0,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(
      "[manual-intake-smoke] apply step skipped (default). Use --apply to execute apply validation.",
    );
    return;
  }

  const applyResult = await callApplyEndpoint("apply", {
    menuOverwrite,
    logoOverwrite,
  });

  assertCoreSmokeResult(applyResult, "apply");
  assertNoSilentOverwriteSignals(applyResult, "apply");

  if (!menuOverwrite && String(applyResult?.menuStatus || "") === "added") {
    throw new Error(
      "Apply unexpectedly added menu without --menu-overwrite approval.",
    );
  }

  if (!logoOverwrite && String(applyResult?.logoStatus || "") === "uploaded") {
    throw new Error(
      "Apply unexpectedly uploaded logo without --logo-overwrite approval.",
    );
  }

  console.log("[manual-intake-smoke] apply passed");
  console.log(
    JSON.stringify(
      {
        status: applyResult.status,
        menuStatus: applyResult.menuStatus,
        logoStatus: applyResult.logoStatus,
        evidenceStatus: applyResult.evidenceStatus,
        menuEvidenceStatus: applyResult.menuEvidenceStatus,
        reviewQueueItems: Array.isArray(applyResult.reviewQueueItems)
          ? applyResult.reviewQueueItems.length
          : 0,
        uploadedEvidence: Array.isArray(applyResult.uploadedEvidence)
          ? applyResult.uploadedEvidence.length
          : 0,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("manual intake smoke packet failed:", error);
  process.exit(1);
});
