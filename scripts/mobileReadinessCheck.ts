import fs from "node:fs";
import path from "node:path";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const repoRoot = process.cwd();

const readText = (relativePath: string): string | null => {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
};

const hasFile = (relativePath: string): boolean =>
  fs.existsSync(path.join(repoRoot, relativePath));

const checks: CheckResult[] = [];

checks.push({
  name: "Capacitor config scaffold",
  ok: hasFile("capacitor.config.ts"),
  detail: "Expect capacitor.config.ts at repo root",
});

checks.push({
  name: "Capacitor Android native project",
  ok: hasFile("android/app/src/main/AndroidManifest.xml"),
  detail: "Expect Android project scaffold under android/",
});

checks.push({
  name: "Capacitor iOS native project",
  ok: hasFile("ios/App/App.xcodeproj/project.pbxproj"),
  detail: "Expect iOS project scaffold under ios/",
});

checks.push({
  name: "PWA manifest",
  ok: hasFile("client/public/manifest.json"),
  detail: "Expect client/public/manifest.json",
});

checks.push({
  name: "Service worker",
  ok: hasFile("client/public/sw.js"),
  detail: "Expect client/public/sw.js",
});

checks.push({
  name: "Install page exists",
  ok: hasFile("client/src/pages/install.tsx"),
  detail: "Expect client install page for app-install guidance",
});

const appTsx = readText("client/src/App.tsx") ?? "";
checks.push({
  name: "Auth/session loading guard",
  ok: appTsx.includes('authState === "loading"'),
  detail: "Expect canonical auth loading guard in App router",
});

const requiredRoutes = [
  "/install",
  "/map",
  "/deal/:id",
  "/event/:slug",
  "/events",
  "/menu/:restaurantId",
  "/checkout/:restaurantId",
];
for (const route of requiredRoutes) {
  checks.push({
    name: `Route registered: ${route}`,
    ok: appTsx.includes(`path="${route}"`),
    detail: `Expect route ${route} in client/src/App.tsx`,
  });
}

checks.push({
  name: "Public deep-link allowlist includes /install",
  ok: appTsx.includes('"/install"'),
  detail: "Expect /install in public route prefixes",
});

const locationButton = readText("client/src/components/location-button.tsx") ?? "";
checks.push({
  name: "Geolocation runtime support",
  ok: locationButton.includes("navigator.geolocation"),
  detail: "Expect geolocation support in location-button",
});

const notificationsPage = readText("client/src/pages/profile/notifications.tsx") ?? "";
checks.push({
  name: "Push preference surface",
  ok:
    notificationsPage.includes("pushStatus") &&
    notificationsPage.includes("switch-push"),
  detail: "Expect push preference controls in profile notifications",
});

const failures = checks.filter((c) => !c.ok);
for (const check of checks) {
  const symbol = check.ok ? "PASS" : "FAIL";
  console.log(`[${symbol}] ${check.name} - ${check.detail}`);
}

if (failures.length > 0) {
  console.error(`\nMobile readiness check failed (${failures.length} checks).`);
  process.exit(1);
}

console.log(`\nMobile readiness check passed (${checks.length} checks).`);
