import { readFileSync } from "node:fs";

const adminManagementRoutes = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredSnippets = [
  "select",
  "from users",
  "where lower(email)",
  "Unknown account type",
  "ownerId: insertedUser.id",
  "\"admin_provisioning\"",
  "businessId",
  "businessType",
  "ownerAccessCreated",
  "setupLink",
  "staffBusinessId",
  "staffInviteMode",
  "Staff provisioning requires selected businessId or pending_invite mode.",
];

for (const snippet of requiredSnippets) {
  if (
    !adminManagementRoutes.includes(snippet) &&
    !adminRoutes.includes(snippet) &&
    !adminDashboard.includes(snippet)
  ) {
    throw new Error(`Missing user-business attachment contract snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "User with this email already exists",
];

for (const snippet of forbiddenSnippets) {
  if (adminManagementRoutes.includes(snippet) || adminRoutes.includes(snippet)) {
    throw new Error(`Found forbidden provisioning snippet: ${snippet}`);
  }
}

console.log("admin-provisioning-user-business-attachment.contract: PASS");
