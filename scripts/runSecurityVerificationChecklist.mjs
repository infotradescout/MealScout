#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const truthy = (value) =>
  ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const readTextFileOrNull = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const runRepoHygieneChecks = () => {
  const failures = [];

  const trackedTmpServer = spawnSync("git", ["ls-files", ".tmp-server"], {
    shell: process.platform === "win32",
    encoding: "utf8",
  });

  if (trackedTmpServer.status === 0 && String(trackedTmpServer.stdout || "").trim()) {
    failures.push("Git is tracking `.tmp-server/**` (build artifacts must not be committed).");
  }

  const gitignore = readTextFileOrNull(".gitignore") || "";
  if (!gitignore.includes(".tmp-server/")) {
    failures.push("`.gitignore` is missing an ignore rule for `.tmp-server/`.");
  }

  const prodExample = readTextFileOrNull(".env.production.example");
  if (prodExample) {
    const lines = prodExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    const dbLine = lines.find((line) => line.startsWith("DATABASE_URL="));
    if (dbLine) {
      const value = dbLine.slice("DATABASE_URL=".length).trim();
      const looksPlaceholder =
        value.includes("<") || value.includes("USER:PASSWORD@HOST");
      if (!looksPlaceholder) {
        failures.push(
          "`.env.production.example` contains a non-placeholder `DATABASE_URL` value.",
        );
      }
    }

    const tokenLine = lines.find((line) => line.startsWith("TRADESCOUT_API_TOKEN="));
    if (tokenLine) {
      const value = tokenLine.slice("TRADESCOUT_API_TOKEN=".length).trim();
      const looksPlaceholder = value.startsWith("<") || value.startsWith("your_");
      if (!looksPlaceholder) {
        failures.push(
          "`.env.production.example` contains a non-placeholder `TRADESCOUT_API_TOKEN` value.",
        );
      }
    }
  }

  return failures;
};

const allChecks = [
  {
    id: "rbacGuardrails",
    title: "Staff RBAC non-mutating guardrails",
    command: "npm",
    args: ["run", "test:staff-rbac-guardrails"],
    blockOnMissingEnv: false,
  },
  {
    id: "incidents",
    title: "Incident tri-channel checklist",
    command: "npm",
    args: ["run", "checklist:incidents"],
    blockOnMissingEnv: true,
  },
  {
    id: "rbac",
    title: "Staff RBAC runtime verification",
    command: "npm",
    args: ["run", "test:staff-rbac"],
    blockOnMissingEnv: true,
  },
];

const skipRbac = truthy(process.env.CHECKLIST_SKIP_RBAC);
const requireSms = truthy(process.env.CHECKLIST_REQUIRE_SMS);
const requireSlack = truthy(process.env.CHECKLIST_REQUIRE_SLACK);
const requireRuntime = truthy(process.env.CHECKLIST_REQUIRE_RUNTIME);
const requireIncidents =
  requireRuntime || requireSms || requireSlack || truthy(process.env.CHECKLIST_REQUIRE_INCIDENTS);
const requireRbacCookies =
  requireRuntime || truthy(process.env.CHECKLIST_REQUIRE_RBAC_COOKIES);

const checks = allChecks.filter((check) => !(skipRbac && check.id === "rbac"));

const requiredEnvByCheck = {
  rbacGuardrails: [],
  incidents: [
    "BREVO_API_KEY",
    "INCIDENT_EMAIL_RECIPIENTS",
    "INCIDENT_SIGNATURE_SECRET",
    ...(requireSms ? ["INCIDENT_SMS_RECIPIENTS"] : []),
    ...(requireSlack ? ["SLACK_WEBHOOK_URL"] : []),
  ],
  rbac: ["RBAC_COOKIE_CUSTOMER", "RBAC_COOKIE_STAFF", "RBAC_COOKIE_ADMIN"],
};

const optionalEnvByCheck = {
  rbacGuardrails: [],
  incidents: [
    ...(requireSms ? [] : ["INCIDENT_SMS_RECIPIENTS"]),
    ...(requireSlack ? [] : ["SLACK_WEBHOOK_URL"]),
  ],
  rbac: ["RBAC_BASE_URL"],
};

const getMissing = (names) =>
  names.filter((name) => {
    const value = process.env[name];
    return !value || String(value).trim().length === 0;
  });

const missingByCheck = Object.fromEntries(
  checks.map((check) => [check.id, getMissing(requiredEnvByCheck[check.id] || [])]),
);

const printEnvSummary = () => {
  console.log("Environment readiness snapshot:");

  for (const check of checks) {
    const optional = optionalEnvByCheck[check.id] || [];
    const missing = missingByCheck[check.id] || [];
    const missingOptional = getMissing(optional);

    if (!missing.length) {
      console.log(`- ${check.title}: OK env ready`);
      if (missingOptional.length) {
        console.log(
          `  - Optional not set: ${missingOptional.join(", ")} (defaults apply)`,
        );
      }
      continue;
    }

    console.log(`- ${check.title}: MISSING env (${missing.length})`);
    for (const name of missing) {
      console.log(`  - ${name}`);
    }
  }
};

const getRerunCommand = () => {
  if (skipRbac && requireSms && requireSlack) {
    return "cross-env CHECKLIST_SKIP_RBAC=true CHECKLIST_REQUIRE_SMS=true CHECKLIST_REQUIRE_SLACK=true npm run checklist:security";
  }
  if (skipRbac) {
    return "npm run checklist:security:prod";
  }
  if (requireSms && requireSlack) {
    return "npm run checklist:security:strict";
  }
  if (requireRuntime) {
    return "cross-env CHECKLIST_REQUIRE_RUNTIME=true npm run checklist:security";
  }
  if (requireIncidents) {
    return "cross-env CHECKLIST_REQUIRE_INCIDENTS=true npm run checklist:security";
  }
  if (requireRbacCookies) {
    return "cross-env CHECKLIST_REQUIRE_RBAC_COOKIES=true npm run checklist:security";
  }
  if (requireSms || requireSlack) {
    const env = [];
    if (requireSms) env.push("CHECKLIST_REQUIRE_SMS=true");
    if (requireSlack) env.push("CHECKLIST_REQUIRE_SLACK=true");
    return `cross-env ${env.join(" ")} npm run checklist:security`;
  }
  return "npm run checklist:security";
};

const runCheck = (check) => {
  const missing = missingByCheck[check.id] || [];

  if (check.id === "incidents" && missing.length && !requireIncidents) {
    console.log(`\n> ${check.title}`);
    console.log("  Skipped because incident runtime env is not present in this shell.");
    console.log("  Set CHECKLIST_REQUIRE_INCIDENTS=true or CHECKLIST_REQUIRE_RUNTIME=true to enforce.");
    return {
      ...check,
      passed: true,
      skipped: true,
      skipReason: "missing optional incident runtime env",
      exitCode: 0,
    };
  }

  if (check.id === "rbac" && missing.length && !requireRbacCookies) {
    console.log(`\n> ${check.title}`);
    console.log("  Skipped because RBAC browser session cookies are not present in this shell.");
    console.log("  Set CHECKLIST_REQUIRE_RBAC_COOKIES=true or CHECKLIST_REQUIRE_RUNTIME=true to enforce.");
    return {
      ...check,
      passed: true,
      skipped: true,
      skipReason: "missing optional RBAC runtime cookies",
      exitCode: 0,
    };
  }

  if (check.blockOnMissingEnv && missing.length) {
    console.log(`\n> ${check.title}`);
    console.log("  Blocked by missing required env:");
    for (const name of missing) {
      console.log(`  - ${name}`);
    }
    return {
      ...check,
      passed: false,
      blocked: true,
      exitCode: 1,
    };
  }

  console.log(`\n> ${check.title}`);
  console.log(`  $ ${check.command} ${check.args.join(" ")}`);

  const result = spawnSync(check.command, check.args, {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: process.env,
  });

  const passed = result.status === 0;
  console.log(`  ${passed ? "PASS" : "FAIL"}`);

  return {
    ...check,
    passed,
    exitCode: result.status ?? 1,
  };
};

const main = () => {
  console.log("=".repeat(66));
  console.log("MealScout Security Verification Checklist");
  console.log("=".repeat(66));

  const repoFailures = runRepoHygieneChecks();
  if (repoFailures.length) {
    console.log("\nRepo hygiene failures:");
    for (const failure of repoFailures) {
      console.log(`- ${failure}`);
    }
    console.log("\nFAIL Security verification checklist failed (repo hygiene).");
    process.exit(1);
  }

  if (skipRbac) {
    console.log("RBAC check is skipped via CHECKLIST_SKIP_RBAC.");
  }
  if (!requireIncidents) {
    console.log("Incident runtime checklist is optional in this shell (set CHECKLIST_REQUIRE_INCIDENTS=true to enforce).");
  }
  if (!requireRbacCookies && !skipRbac) {
    console.log("RBAC runtime cookie smoke is optional in this shell (set CHECKLIST_REQUIRE_RBAC_COOKIES=true to enforce).");
  }
  if (!requireSms) {
    console.log("Incident SMS env is optional (set CHECKLIST_REQUIRE_SMS=true to enforce).");
  }
  if (!requireSlack) {
    console.log("Incident Slack env is optional (set CHECKLIST_REQUIRE_SLACK=true to enforce).");
  }

  printEnvSummary();

  const results = checks.map(runCheck);

  console.log("\n" + "=".repeat(66));
  console.log("Checklist Summary");
  console.log("=".repeat(66));

  const hasFailure = results.some((result) => !result.passed);
  for (const result of results) {
    const status = result.skipped
      ? `SKIPPED (${result.skipReason || "not required"})`
      : result.blocked
        ? "BLOCKED (missing env)"
        : result.passed
          ? "PASS"
          : "FAIL";
    console.log(`- ${result.title}: ${status}`);
  }

  if (!hasFailure) {
    console.log("\nOK Security verification checklist passed.");
    process.exit(0);
  }

  console.log("\nFAIL Security verification checklist failed.");
  console.log(`  Populate missing env/secrets, then rerun: ${getRerunCommand()}`);
  process.exit(1);
};

main();
