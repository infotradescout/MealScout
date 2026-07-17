import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
const workspace = readFileSync(
  "client/src/components/business-workspace-shell.tsx",
  "utf8",
);
const auth = readFileSync("client/src/hooks/useAuth.ts", "utf8");

const requiredDashboardSnippets = [
  "const buildOwnerToolHref = (",
  "const buildOwnerSetupHref = (",
  '["setup", "ref", "onboarding", "setupStep", "setupPanel"]',
  'return buildOwnerToolHref("/restaurant-owner-dashboard");',
  'buildOwnerSetupHref("profile")',
  'buildOwnerSetupHref("menu")',
  'buildOwnerSetupHref("profile-media")',
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(
      `Missing deterministic dashboard navigation snippet: ${snippet}`,
    );
  }
}

for (const snippet of [
  'setup: "profile"',
  'setup: "profile-media"',
  'setup: "schedule"',
  'href: buildWorkspaceHref("/restaurant-owner-dashboard", business.id',
]) {
  if (!workspace.includes(snippet)) {
    throw new Error(
      `Missing deterministic workspace navigation snippet: ${snippet}`,
    );
  }
}

const requiredNavigationSnippets = [
  '{ path: "/scout", icon: Compass, label: "Scout" }',
  '{ path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" }',
  '{ path: "/orders", icon: ShoppingCart, label: "Work" }',
  '{ path: "/kitchen", icon: ChefHat, label: "Kitchen" }',
  '{ path: "/share-hub", icon: Share2, label: "Share" }',
  "href={buildOwnerToolHref(item.path)}",
];

for (const snippet of requiredNavigationSnippets) {
  if (!navigation.includes(snippet)) {
    throw new Error(`Missing deterministic global nav snippet: ${snippet}`);
  }
}

const requiredAuthSnippets = ["if (!hardBlockingStep) return;"];

for (const snippet of requiredAuthSnippets) {
  if (!auth.includes(snippet)) {
    throw new Error(`Missing deterministic route-guard snippet: ${snippet}`);
  }
}

if (
  navigation.includes("setup=profile-media") ||
  navigation.includes("ref=user2587")
) {
  throw new Error("Global navigation includes setup/ref contamination");
}

console.log("owner-dashboard-deterministic-navigation.contract: PASS");
