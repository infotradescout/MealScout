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

const fileSize = (relativePath: string): number => {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
};

const readFile = (relativePath: string): string => {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
};

const androidBuildGradle = readFile("android/app/build.gradle");
const androidManifest = readFile("android/app/src/main/AndroidManifest.xml");
const packageJson = readFile("package.json");
const rootGitignore = readFile(".gitignore");
const publicContactSourceFiles = [
  "client/src/pages/about.tsx",
  "client/src/pages/contact.tsx",
  "client/src/pages/data-deletion.tsx",
  "client/src/pages/oauth-setup-guide.tsx",
  "client/src/pages/privacy-policy.tsx",
  "client/src/pages/profile/help.tsx",
  "client/src/pages/terms-of-service.tsx",
  "server/bootstrap/registerStaticPages.ts",
];
const publicContactSource = publicContactSourceFiles
  .map((relativePath) => readFile(relativePath))
  .join("\n");

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
    name: "Capacitor scripts use pinned local CLI",
    ok:
      packageJson.includes('"cap:sync": "cap sync"') &&
      packageJson.includes('"cap:prepare": "npm run build && npm run cap:sync"') &&
      packageJson.includes('"@capacitor/cli": "8.3.0"') &&
      packageJson.includes('"@capacitor/core": "8.3.0"') &&
      packageJson.includes('"@capacitor/android": "8.3.0"') &&
      packageJson.includes('"@capacitor/ios": "8.3.0"') &&
      !packageJson.includes("npx --yes @capacitor/cli"),
    detail: "Expect native scripts and Capacitor packages to use exact repo-pinned versions, not floating npx/range resolution",
  },
  {
    name: "Android native shell disables backup",
    ok:
      androidManifest.includes('android:allowBackup="false"') &&
      !androidManifest.includes('android:allowBackup="true"'),
    detail: "Expect Android app data backups disabled for the session-bearing production shell",
  },
  {
    name: "Android native shell blocks cleartext traffic",
    ok: androidManifest.includes('android:usesCleartextTraffic="false"'),
    detail: "Expect native shell to explicitly reject cleartext HTTP traffic",
  },
  {
    name: "Android keystore files ignored",
    ok: rootGitignore.includes("*.jks") && rootGitignore.includes("*.keystore"),
    detail: "Expect upload keystores to stay out of git",
  },
  {
    name: "Android launcher icon is branded",
    ok: fileSize("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png") > 20_000,
    detail: "Expect native launcher icon to be MealScout branded, not the default Capacitor placeholder",
  },
  {
    name: "Android splash asset is branded",
    ok: fileSize("android/app/src/main/res/drawable/splash.png") > 10_000,
    detail: "Expect native splash image to be MealScout branded, not the default Capacitor placeholder",
  },
  {
    name: "iOS App Store icon is branded",
    ok: fileSize("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png") > 500_000,
    detail: "Expect 1024px iOS app icon to be MealScout branded, not the default Capacitor placeholder",
  },
  {
    name: "iOS splash asset is branded",
    ok: fileSize("ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png") > 500_000,
    detail: "Expect iOS splash image to be MealScout branded, not the default Capacitor placeholder",
  },
  {
    name: "Public contact emails match store domain",
    ok:
      !publicContactSource.includes("mealscout.com") &&
      !publicContactSource.includes("info.mealscout@gmail.com") &&
      publicContactSource.includes("support@mealscout.us") &&
      publicContactSource.includes("privacy@mealscout.us"),
    detail: "Expect public support/legal surfaces to use mealscout.us contact emails",
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
