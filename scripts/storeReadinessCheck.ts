import fs from "node:fs";
import path from "node:path";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const repoRoot = process.cwd();

const hasFile = (relativePath: string): boolean =>
  fs.existsSync(path.join(repoRoot, relativePath));

const readFile = (relativePath: string): string => {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
};

const androidBuildGradle = readFile("android/app/build.gradle");
const rootGitignore = readFile(".gitignore");

const checks: CheckResult[] = [
  {
    name: "Store checklist doc",
    ok: hasFile("docs/mobile/PHASE6_MOBILE_TRACK.md"),
    detail: "Expect docs/mobile/PHASE6_MOBILE_TRACK.md",
  },
  {
    name: "App Store metadata template",
    ok: hasFile("docs/mobile/store/APP_STORE_METADATA.md"),
    detail: "Expect docs/mobile/store/APP_STORE_METADATA.md",
  },
  {
    name: "Play Store metadata template",
    ok: hasFile("docs/mobile/store/PLAY_STORE_METADATA.md"),
    detail: "Expect docs/mobile/store/PLAY_STORE_METADATA.md",
  },
  {
    name: "Store asset checklist",
    ok: hasFile("docs/mobile/store/STORE_ASSETS_CHECKLIST.md"),
    detail: "Expect docs/mobile/store/STORE_ASSETS_CHECKLIST.md",
  },
  {
    name: "Android scaffold exists",
    ok: hasFile("android/app/src/main/AndroidManifest.xml"),
    detail: "Expect android scaffold before release packaging",
  },
  {
    name: "iOS scaffold exists",
    ok: hasFile("ios/App/App.xcodeproj/project.pbxproj"),
    detail: "Expect ios scaffold before TestFlight submission",
  },
  {
    name: "Privacy policy route page",
    ok: hasFile("client/src/pages/privacy-policy.tsx"),
    detail: "Expect in-app privacy policy page",
  },
  {
    name: "Android release signing guard",
    ok:
      androidBuildGradle.includes("MEALSCOUT_ANDROID_UPLOAD_STORE_FILE") &&
      androidBuildGradle.includes("MEALSCOUT_ANDROID_UPLOAD_STORE_PASSWORD") &&
      androidBuildGradle.includes("MEALSCOUT_ANDROID_UPLOAD_KEY_ALIAS") &&
      androidBuildGradle.includes("MEALSCOUT_ANDROID_UPLOAD_KEY_PASSWORD") &&
      androidBuildGradle.includes("Android release signing is not configured"),
    detail: "Expect release bundle tasks to require upload-key signing configuration",
  },
  {
    name: "Android keystore files ignored",
    ok: rootGitignore.includes("*.jks") && rootGitignore.includes("*.keystore"),
    detail: "Expect upload keystores to stay out of git",
  },
];

const strictMetadata = String(process.env.STRICT_STORE_METADATA || "").toLowerCase() === "true";
if (strictMetadata) {
  const metadataFiles = [
    "docs/mobile/store/APP_STORE_METADATA.md",
    "docs/mobile/store/PLAY_STORE_METADATA.md",
  ];
  for (const relativePath of metadataFiles) {
    const fullPath = path.join(repoRoot, relativePath);
    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
    checks.push({
      name: `No TODO placeholders: ${relativePath}`,
      ok: !content.includes("TODO"),
      detail: "Expect listing metadata to be finalized in strict mode",
    });
  }
}

const failures = checks.filter((c) => !c.ok);
for (const check of checks) {
  const symbol = check.ok ? "PASS" : "FAIL";
  console.log(`[${symbol}] ${check.name} - ${check.detail}`);
}

if (failures.length > 0) {
  console.error(`\nStore readiness check failed (${failures.length} checks).`);
  process.exit(1);
}

console.log(`\nStore readiness check passed (${checks.length} checks).`);
