import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredSnippets = [
  "function resolveAdminUserBusinessIdentity(",
  "businessTypeIntent",
  "attachmentState",
  "conflict: businessTypeIntent === \"conflict\"",
  "Identity Resolver",
  "Business intent:",
  "Business attachment:",
  "Onboarding signal:",
  "Conflict detected: account role intent",
  "Select business type intent",
  "data-testid={`button-correct-business-intent-${selectedUser.id}`}",
  "data-testid={`button-mark-customer-only-${selectedUser.id}`}",
  "Create business shell",
  "Select business type intent",
  "<option value=\"\">Select business type intent</option>",
  "Brewery / Taproom",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin identity conflict snippet: ${snippet}`);
  }
}

console.log("admin-user-business-identity-conflict.contract: PASS");
