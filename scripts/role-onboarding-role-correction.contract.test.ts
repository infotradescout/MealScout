import { readFileSync } from "node:fs";

const authRoutes = readFileSync("server/routes/authAccountRoutes.ts", "utf8");
const auditScript = readFileSync("scripts/role-onboarding-integrity-audit.ts", "utf8");

const requiredRouteSnippets = [
  'app.post("/api/auth/onboarding/role-correction", isAuthenticated, async (req: any, res) => {',
  "targetRole: z.enum([",
  "const nextDraft = {",
  "await storage.updateUserType(userId, parsed.targetRole);",
  "const continuation = await resolveUserContinuation({",
];

for (const snippet of requiredRouteSnippets) {
  if (!authRoutes.includes(snippet)) {
    throw new Error(`Missing role-correction route snippet: ${snippet}`);
  }
}

const requiredAuditSnippets = [
  "Role-Aware Onboarding Integrity Audit",
  "Business-role users not attached",
  "Submitted menu-like draft data without linked business",
];

for (const snippet of requiredAuditSnippets) {
  if (!auditScript.includes(snippet)) {
    throw new Error(`Missing audit coverage snippet: ${snippet}`);
  }
}

console.log("role-onboarding-role-correction.contract: PASS");
