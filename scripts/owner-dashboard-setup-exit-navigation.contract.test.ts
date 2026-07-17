import { readFileSync } from "node:fs";

const page = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const nav = readFileSync("client/src/components/navigation.tsx", "utf8");
const workspace = readFileSync(
  "client/src/components/business-workspace-shell.tsx",
  "utf8",
);

const requiredPageSnippets = [
  'const setupMode = dashboardParams.get("setup");',
  "const buildDashboardHref = () => {",
  'return buildOwnerToolHref("/restaurant-owner-dashboard");',
  "const buildOwnerToolHref = (",
  "const buildOwnerSetupHref = (",
  'data-testid="button-exit-setup-mode"',
  "<Link href={buildDashboardHref()}>",
  "<OwnerProfileWorkspace",
  'setupMode === "profile"',
  'setupMode === "profile-media"',
  '!["schedule", "bookings"].includes(setupMode)',
];

const requiredNonSetupLinks = [
  '<Link href={buildOwnerToolHref("/hiring?tab=owner")}>',
  '<Link href={buildOwnerToolHref("/subscribe")}>',
];

const forbiddenSnippets = [
  'href="/scout?setup=',
  'href="/parking-pass-manage?setup=',
  'href="/orders?setup=',
  'href="/kitchen-display?setup=',
  'href="/share-hub?setup=',
];

for (const snippet of requiredPageSnippets) {
  if (!page.includes(snippet)) {
    throw new Error(`Missing setup exit navigation snippet: ${snippet}`);
  }
}

for (const snippet of [
  'id: "overview"',
  'href: buildWorkspaceHref("/restaurant-owner-dashboard", business.id)',
  'id: "profile"',
  'id: "media"',
]) {
  if (!workspace.includes(snippet)) {
    throw new Error(`Missing direct workspace navigation snippet: ${snippet}`);
  }
}

if (page.includes('data-testid="button-back-to-dashboard-from-setup"')) {
  throw new Error(
    "Direct Profile or Photos workspace still renders a legacy back-to-dashboard setup control",
  );
}

for (const snippet of requiredNonSetupLinks) {
  if (!page.includes(snippet)) {
    throw new Error(`Missing non-setup owner action link: ${snippet}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (page.includes(snippet) || nav.includes(snippet)) {
    throw new Error(`Found forbidden setup-preserving nav snippet: ${snippet}`);
  }
}

console.log("owner-dashboard-setup-exit-navigation.contract: PASS");
