import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildProfileAssetEvidence,
  PROFILE_ASSET_TYPES,
  profileEvidenceUploadField,
  type ProfileAssetEvidence,
  type ProfileAssetType,
} from "../shared/profileAssetEvidence";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type ManualAssetEntry = {
  inputName: string;
  targetName: string;
  assetType: ProfileAssetType;
};

export type ManualProfileAssetManifest = {
  brand: "mealscout";
  profileSlug: string;
  existingProfileId: string;
  ownerUserId?: string | null;
  source: "manual_codex_intake";
  applyMode: "append_only_enrichment";
  profileType?: "food_truck" | "restaurant" | "bar" | "caterer" | "private_chef";
  files: ManualAssetEntry[];
};

export type NormalizedManualProfileAssetPackage = {
  projectRoot: string;
  manifestPath: string;
  incomingDirectory: string;
  normalizedDirectory: string;
  evidenceManifestPath: string;
  payloadPath: string;
  evidence: ProfileAssetEvidence[];
  payload: Record<string, unknown>;
};

const isPathInside = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const assertPlainFilename = (value: unknown, label: string) => {
  const fileName = String(value || "").trim();
  if (!fileName || path.basename(fileName) !== fileName || /[\\/]/.test(fileName)) {
    throw new Error(`${label} must be a plain filename without path segments`);
  }
  return fileName;
};

const detectImageMimeType = (buffer: Buffer) => {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif";
  }
  throw new Error("Only PNG, JPEG, WebP, and GIF image binaries are supported");
};

const expectedExtensions: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
};

const validateManifest = (value: unknown): ManualProfileAssetManifest => {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object");
  const manifest = value as ManualProfileAssetManifest;
  if (manifest.brand !== "mealscout") throw new Error("brand must be mealscout");
  if (!SAFE_SEGMENT_PATTERN.test(String(manifest.profileSlug || ""))) {
    throw new Error("profileSlug must be a lowercase kebab-case segment");
  }
  if (!UUID_PATTERN.test(String(manifest.existingProfileId || ""))) {
    throw new Error("existingProfileId must be a UUID for an existing profile");
  }
  if (manifest.ownerUserId && !UUID_PATTERN.test(String(manifest.ownerUserId))) {
    throw new Error("ownerUserId must be a UUID when provided");
  }
  if (manifest.source !== "manual_codex_intake") {
    throw new Error("source must be manual_codex_intake");
  }
  if (manifest.applyMode !== "append_only_enrichment") {
    throw new Error("applyMode must be append_only_enrichment");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("files must contain at least one asset");
  }
  if (manifest.files.length > 80) throw new Error("files exceeds the 80 asset limit");

  const targetNames = new Set<string>();
  for (const [index, entry] of manifest.files.entries()) {
    entry.inputName = assertPlainFilename(entry.inputName, `files[${index}].inputName`);
    entry.targetName = assertPlainFilename(entry.targetName, `files[${index}].targetName`);
    if (!(PROFILE_ASSET_TYPES as readonly string[]).includes(entry.assetType)) {
      throw new Error(`files[${index}].assetType is unsupported`);
    }
    const targetKey = entry.targetName.toLowerCase();
    if (targetNames.has(targetKey)) throw new Error(`Duplicate targetName: ${entry.targetName}`);
    targetNames.add(targetKey);
  }
  return manifest;
};

const relativeForManifest = (projectRoot: string, absolutePath: string) =>
  path.relative(projectRoot, absolutePath).split(path.sep).join("/");

export function normalizeManualProfileAssetIntake(options: {
  manifestPath: string;
  projectRoot?: string;
  intakeAt?: string;
}): NormalizedManualProfileAssetPackage {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const manifestPath = path.resolve(projectRoot, options.manifestPath);
  if (!isPathInside(projectRoot, manifestPath)) {
    throw new Error("Manifest path must stay inside the project root");
  }
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const profileRoot = path.resolve(
    projectRoot,
    "artifacts",
    "manual-intake",
    manifest.brand,
    manifest.profileSlug,
  );
  if (!isPathInside(profileRoot, manifestPath)) {
    throw new Error(
      `Manifest must live under artifacts/manual-intake/${manifest.brand}/${manifest.profileSlug}`,
    );
  }

  const incomingDirectory = path.join(profileRoot, "incoming");
  const normalizedDirectory = path.join(profileRoot, "normalized");
  if (!existsSync(incomingDirectory) || !statSync(incomingDirectory).isDirectory()) {
    throw new Error(`Incoming directory not found: ${incomingDirectory}`);
  }
  const intakeDate = new Date(options.intakeAt || Date.now());
  if (Number.isNaN(intakeDate.getTime())) throw new Error("intakeAt must be a valid timestamp");
  const intakeAt = intakeDate.toISOString();

  const preflight = manifest.files.map((entry) => {
    const inputPath = path.join(incomingDirectory, entry.inputName);
    if (!existsSync(inputPath)) throw new Error(`Missing intake binary: ${entry.inputName}`);
    if (lstatSync(inputPath).isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed: ${entry.inputName}`);
    }
    const realInputPath = realpathSync(inputPath);
    if (!isPathInside(realpathSync(incomingDirectory), realInputPath)) {
      throw new Error(`Intake binary escapes incoming directory: ${entry.inputName}`);
    }
    const stats = statSync(realInputPath);
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error(`Intake binary must be a non-empty regular file: ${entry.inputName}`);
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error(`Intake binary exceeds 5MB: ${entry.inputName}`);
    }
    const buffer = readFileSync(realInputPath);
    const mimeType = detectImageMimeType(buffer);
    const targetExtension = path.extname(entry.targetName).toLowerCase();
    if (!expectedExtensions[mimeType].includes(targetExtension)) {
      throw new Error(
        `${entry.targetName} extension does not match detected ${mimeType} content`,
      );
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const targetPath = path.join(normalizedDirectory, entry.targetName);
    if (existsSync(targetPath)) {
      const existingHash = createHash("sha256")
        .update(readFileSync(targetPath))
        .digest("hex");
      if (existingHash !== sha256) {
        throw new Error(`Refusing to overwrite different normalized asset: ${entry.targetName}`);
      }
    }
    return { entry, realInputPath, targetPath, mimeType, sizeBytes: stats.size, sha256 };
  });

  mkdirSync(normalizedDirectory, { recursive: true });
  for (const item of preflight) {
    if (!existsSync(item.targetPath)) copyFileSync(item.realInputPath, item.targetPath);
  }

  const evidence = preflight.map((item) =>
    buildProfileAssetEvidence({
      source: "manual_codex_intake",
      originalFilename: item.entry.inputName,
      normalizedFilename: item.entry.targetName,
      normalizedPath: relativeForManifest(projectRoot, item.targetPath),
      sha256: item.sha256,
      assetType: item.entry.assetType,
      profileSlug: manifest.profileSlug,
      profileId: manifest.existingProfileId,
      ownerUserId: manifest.ownerUserId || null,
      intakeAt,
      applyMode: "append_only_enrichment",
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      reviewStatus: "pending_review",
    }),
  );

  const payload = {
    mode: "dry_run",
    profileType: manifest.profileType || "food_truck",
    existingProfileId: manifest.existingProfileId,
    expectedOwnerUserId: manifest.ownerUserId || null,
    profileSlug: manifest.profileSlug,
    match: { profileId: manifest.existingProfileId },
    fillIfBlank: {},
    sourceNotes: ["Manual asset intake; append-only and review-gated."],
    rawSource: {
      source: manifest.source,
      manifestPath: relativeForManifest(projectRoot, manifestPath),
    },
    evidence,
    approvals: {
      menuOverwrite: false,
      logoOverwrite: false,
      evidencePublication: false,
    },
    logoUpload: { enabled: false },
  };

  const evidenceManifestPath = path.join(normalizedDirectory, "evidence-manifest.json");
  const payloadPath = path.join(normalizedDirectory, "profile-evidence-payload.json");
  writeFileSync(
    evidenceManifestPath,
    `${JSON.stringify({ manifestVersion: 1, generatedAt: intakeAt, evidence }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  return {
    projectRoot,
    manifestPath,
    incomingDirectory,
    normalizedDirectory,
    evidenceManifestPath,
    payloadPath,
    evidence,
    payload,
  };
}

export function buildManualProfileEvidenceFormData(
  normalizedPackage: NormalizedManualProfileAssetPackage,
  options: {
    mode: "dry_run" | "apply";
    approveLogo?: boolean;
    approveMenuOverwrite?: boolean;
    approveEvidencePublication?: boolean;
  },
) {
  const evidence = normalizedPackage.evidence;
  const payload = {
    ...normalizedPackage.payload,
    mode: options.mode,
    approvals: {
      menuOverwrite: Boolean(options.approveMenuOverwrite),
      logoOverwrite: Boolean(options.approveLogo),
      evidencePublication: Boolean(options.approveEvidencePublication),
    },
    logoUpload: { enabled: Boolean(options.approveLogo) },
  };
  const formData = new FormData();
  formData.append("payload", JSON.stringify(payload));
  for (const asset of evidence) {
    const absolutePath = path.resolve(normalizedPackage.projectRoot, asset.normalizedPath);
    const buffer = readFileSync(absolutePath);
    const currentHash = createHash("sha256").update(buffer).digest("hex");
    if (currentHash !== asset.sha256 || buffer.length !== asset.sizeBytes) {
      throw new Error(`Normalized asset no longer matches evidence manifest: ${asset.normalizedFilename}`);
    }
    formData.append(
      profileEvidenceUploadField(asset.assetType, {
        approveLogo: Boolean(options.approveLogo),
      }),
      new Blob([buffer], { type: asset.mimeType }),
      asset.normalizedFilename,
    );
  }
  return formData;
}

const getArg = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? "" : String(process.argv[index + 1] || "").trim();
};
const hasFlag = (flag: string) => process.argv.includes(flag);

const parseCookieHeader = (response: Response) => {
  const getSetCookie = (response.headers as any).getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? (getSetCookie.call(response.headers) as string[])
      : response.headers.get("set-cookie")
        ? [String(response.headers.get("set-cookie"))]
        : [];
  return cookies
    .map((entry) => entry.split(";")[0])
    .filter(Boolean)
    .join("; ");
};

async function submitPackage(
  normalizedPackage: NormalizedManualProfileAssetPackage,
  options: {
    baseUrl: string;
    email: string;
    password: string;
    mode: "dry_run" | "apply";
    approveLogo: boolean;
    approveMenuOverwrite: boolean;
    approveEvidencePublication: boolean;
    allowProduction: boolean;
  },
) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const host = new URL(baseUrl).hostname.toLowerCase();
  const isProduction = host === "www.mealscout.us" || host === "mealscout.onrender.com";
  if (isProduction && !options.allowProduction) {
    throw new Error("Refusing to target production without --allow-production");
  }
  if (!options.email || !options.password) {
    throw new Error("Admin credentials are required for submission");
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: options.email, password: options.password }),
  });
  const loginPayload = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error(`Login failed (${login.status}): ${JSON.stringify(loginPayload)}`);
  const cookie = parseCookieHeader(login);
  if (!cookie) throw new Error("Login succeeded but no session cookie was returned");

  const response = await fetch(`${baseUrl}/api/admin/profile-evidence/apply`, {
    method: "POST",
    headers: { Cookie: cookie, Accept: "application/json" },
    body: buildManualProfileEvidenceFormData(normalizedPackage, options),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Profile evidence submission failed (${response.status}): ${JSON.stringify(result)}`);
  }
  return result;
}

async function main() {
  const manifestPath = getArg("--manifest");
  if (!manifestPath) throw new Error("Missing required --manifest path");
  const normalizedPackage = normalizeManualProfileAssetIntake({ manifestPath });
  const submitApply = hasFlag("--submit-apply");
  const submitDryRun = hasFlag("--submit-dry-run");
  if (submitApply && submitDryRun) {
    throw new Error("Choose only one of --submit-apply or --submit-dry-run");
  }

  let submission: unknown = null;
  if (submitApply || submitDryRun) {
    submission = await submitPackage(normalizedPackage, {
      baseUrl: getArg("--base-url") || process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5000",
      email: getArg("--email") || process.env.ADMIN_SMOKE_EMAIL || "",
      password: getArg("--password") || process.env.ADMIN_SMOKE_PASSWORD || "",
      mode: submitApply ? "apply" : "dry_run",
      approveLogo: hasFlag("--approve-logo"),
      approveMenuOverwrite: hasFlag("--approve-menu-overwrite"),
      approveEvidencePublication: hasFlag("--approve-evidence-publication"),
      allowProduction: hasFlag("--allow-production"),
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        normalizedDirectory: normalizedPackage.normalizedDirectory,
        evidenceManifestPath: normalizedPackage.evidenceManifestPath,
        payloadPath: normalizedPackage.payloadPath,
        assets: normalizedPackage.evidence.length,
        submission,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("manualProfileAssetIntake failed:", error);
    process.exit(1);
  });
}
