import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const profileWorkspace = readFileSync(
  "client/src/components/owner-profile-workspace.tsx",
  "utf8",
);
const workspaceShell = readFileSync(
  "client/src/components/business-workspace-shell.tsx",
  "utf8",
);

const requiredDashboardSnippets = [
  'setupMode === "menu"',
  "MealScout menu builder",
  "Open menu builder",
  "Manage booked stops",
  "Weekly service hours",
  "Go live",
  "Stop sharing",
  "<OwnerProfileWorkspace",
];

const requiredProfileWorkspaceSnippets = [
  'mode === "media"',
  "What customers see",
  "Business identity",
  "Website, ordering, and inquiry links",
  "Social links",
  "Online ordering",
  "DoorDash",
  "Uber Eats",
  "Toast",
  "Square",
  "Photos",
  "Food and business photos",
  "Uploads save immediately",
];

const requiredShellSnippets = [
  'label: "Public profile"',
  'label: "Photos"',
  "label: availabilityLabel",
  '? "Schedule & live"',
];

const forbiddenSnippets = ["setLocation(`/menu-builder?"];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing owner setup workspace snippet: ${snippet}`);
  }
}

for (const snippet of requiredProfileWorkspaceSnippets) {
  if (!profileWorkspace.includes(snippet)) {
    throw new Error(`Missing profile or photos workspace snippet: ${snippet}`);
  }
}

for (const snippet of requiredShellSnippets) {
  if (!workspaceShell.includes(snippet)) {
    throw new Error(`Missing business workspace shell snippet: ${snippet}`);
  }
}

for (const legacyCopy of [
  "Profile basics workspace",
  "Media workspace",
  "Save profile basics",
  "Open schedule/live tools",
]) {
  if (profileWorkspace.includes(legacyCopy)) {
    throw new Error(
      `Profile workspace still includes legacy setup copy: ${legacyCopy}`,
    );
  }
}

for (const snippet of forbiddenSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(`Found forbidden setup behavior snippet: ${snippet}`);
  }
}

console.log("owner-setup-workspace-required-tools.contract: PASS");
