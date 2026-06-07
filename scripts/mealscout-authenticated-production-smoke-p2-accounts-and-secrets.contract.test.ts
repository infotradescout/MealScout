import { existsSync, readFileSync } from "node:fs";

const p2Path = "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P2_ACCOUNTS_AND_SECRETS.md";
const checklistPath = "docs/PROD_ROLLOUT_CHECKLIST.md";

if (!existsSync(p2Path)) {
  throw new Error(`Missing P2 authenticated production smoke artifact: ${p2Path}`);
}

const read = (path: string) => readFileSync(path, "utf8");
const p2 = read(p2Path);
const rolloutChecklist = read(checklistPath);

function requireIncludes(source: string, snippet: string, label: string) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing P2 snippet (${label}): ${snippet}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing P2 pattern: ${label}`);
  }
}

[
  "# MealScout Authenticated Production Smoke P2 Accounts And Secrets",
  "Status: `BLOCKED_PENDING_EXTERNAL_CONFIGURATION`",
  "## Approved Customer Smoke Account Requirements",
  "## Approved Owner Smoke Account Requirements",
  "## Approved Admin Or Staff Smoke Account Requirements",
  "## Required Production Env And Secret Names",
  "## Credential Storage Rules",
  "## Cookie And Login Secret Strategy",
  "## DB Read-Only Verification Path",
  "## Pass Criteria To Unblock Authenticated Production Smoke",
  "## Fail Criteria",
  "## Gate Decision",
].forEach((snippet) => requireIncludes(p2, snippet, `required section ${snippet}`));

[
  "Dedicated customer smoke account.",
  "Dedicated owner smoke account.",
  "Dedicated admin or staff smoke account.",
  "Production base URLs for public and API surfaces.",
  "Cookie/login strategy for each authenticated role.",
  "Read-only database verification path.",
].forEach((snippet) => requireIncludes(p2, snippet, `scope output ${snippet}`));

[
  "CUSTOMER_SMOKE_EMAIL",
  "CUSTOMER_SMOKE_PASSWORD",
  "CUSTOMER_SMOKE_COOKIE",
  "CUSTOMER_SMOKE_USER_ID",
  "CUSTOMER_SMOKE_AUTH_STRATEGY",
  "OWNER_SMOKE_EMAIL",
  "OWNER_SMOKE_PASSWORD",
  "OWNER_SMOKE_COOKIE",
  "OWNER_SMOKE_USER_ID",
  "OWNER_SMOKE_AUTH_STRATEGY",
  "OWNER_SMOKE_BUSINESS_ID",
  "OWNER_SMOKE_RESTAURANT_ID",
  "OWNER_SMOKE_SUBSCRIBED_RESTAURANT_ID",
  "OWNER_SMOKE_UNSUBSCRIBED_RESTAURANT_ID",
  "ORDERING_OWNER_EMAIL",
  "ORDERING_OWNER_PASSWORD",
  "ORDERING_OWNER_COOKIE",
  "ORDERING_SUBSCRIBED_RESTAURANT_ID",
  "ORDERING_UNSUBSCRIBED_RESTAURANT_ID",
  "ADMIN_SMOKE_EMAIL",
  "ADMIN_SMOKE_PASSWORD",
  "ADMIN_SMOKE_COOKIE",
  "ADMIN_SMOKE_USER_ID",
  "ADMIN_SMOKE_ROLE",
  "SMOKE_PUBLIC_BASE_URL",
  "SMOKE_API_BASE_URL",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "ADMIN_SMOKE_BASE_URL",
  "ADMIN_SMOKE_ORIGIN",
  "DATABASE_URL",
  "SESSION_SECRET",
  "PUBLIC_BASE_URL",
  "SITEMAP_SITE_URL",
  "CLIENT_ORIGIN",
  "PROD_GATE_PUBLIC_BASE_URL",
  "PROD_GATE_API_BASE_URL",
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BREVO_API_KEY",
  "PROD_READONLY_DATABASE_URL",
  "PROD_DB_READONLY_ROLE",
  "PROD_DB_READONLY_SSLMODE",
  "PROD_DB_VERIFY_MAX_ROWS",
  "EMAIL_NOTIFICATIONS_MODE",
  "SMS_NOTIFICATIONS_MODE",
  "SOCIAL_AUTOPUBLISH_ENABLED",
  "DRIP_CAMPAIGNS_ENABLED",
  "SCHEDULER_ENABLED",
  "MEALSCOUT_BYPASS_STRIPE",
  "MEALSCOUT_TEST_MODE",
].forEach((snippet) => requireIncludes(p2, snippet, `env/secret name ${snippet}`));

[
  "Render environment variables.",
  "Local shell environment variables.",
  "Approved password manager records.",
  "Markdown documents.",
  "JSON fixtures.",
  "Screenshots or image evidence.",
  ".env",
  ".env.local",
  ".env.production",
  "cookies files",
  "HAR files",
  "Passwords.",
  "Session cookies.",
  "JWTs.",
  "API tokens.",
  "Stripe secret keys.",
  "Database connection strings.",
].forEach((snippet) => requireIncludes(p2, snippet, `credential storage rule ${snippet}`));

[
  "Cookie strategy",
  "Login strategy",
  "Smoke runner redacts all credential-bearing env vars in output.",
  "Cookies expire or are rotated after the smoke window.",
  "Verification user must not have insert, update, delete, truncate, alter, drop, create, or execute privileges",
  "Queries must be select-only and bounded.",
  "No live authenticated production smoke has been run or claimed by P2.",
].forEach((snippet) => requireIncludes(p2, snippet, `safety requirement ${snippet}`));

requireMatch(
  p2,
  /Decision: `BLOCKED`[\s\S]*Authenticated production smoke must not run until operators confirm every P2 pass criterion outside the repo/,
  "blocked P2 gate decision",
);

requireIncludes(
  rolloutChecklist,
  "MEALSCOUT_AUTHENTICATED_PRODUCTION_SMOKE_P2_ACCOUNTS_AND_SECRETS.md",
  "rollout checklist P2 artifact",
);
requireIncludes(
  rolloutChecklist,
  "Authenticated production smoke is blocked",
  "rollout checklist still blocks authenticated smoke",
);
[
  "Customer smoke account defined outside repo.",
  "Owner smoke account and smoke business/profile fixture ids defined outside repo.",
  "Admin/staff smoke account defined outside repo.",
  "Production public/API base URLs defined outside repo.",
  "Cookie/login secret strategy defined outside repo.",
  "Read-only production DB verification path defined outside repo.",
  "No credentials, cookies, passwords, tokens, database URLs, or production secrets committed.",
].forEach((snippet) => requireIncludes(rolloutChecklist, snippet, `rollout P2 item ${snippet}`));

const scannedSources = [
  [p2Path, p2],
  [checklistPath, rolloutChecklist],
] as const;

const forbiddenCredentialPatterns: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key"],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, "Stripe secret-like key"],
  [/\bwhsec_[A-Za-z0-9]{16,}\b/, "Stripe webhook secret-like key"],
  [/\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/, "JWT-like token"],
  [/\b(?:connect\.sid|session|cookie)\s*=\s*[^`\s<>{}]+/i, "cookie assignment"],
  [/\bpassword\s*[:=]\s*(?!`?[A-Z0-9_]+`?)(?!<)[^\s`]{8,}/i, "password literal"],
  [/\btoken\s*[:=]\s*(?!`?[A-Z0-9_]+`?)(?!<)[^\s`]{12,}/i, "token literal"],
  [/postgres(?:ql)?:\/\/[^`\s<>{}]+/i, "Postgres connection string"],
  [/mysql:\/\/[^`\s<>{}]+/i, "MySQL connection string"],
  [/mongodb(?:\+srv)?:\/\/[^`\s<>{}]+/i, "MongoDB connection string"],
  [/https:\/\/api\.brevo\.com\/v3\/smtp\/email\?[A-Za-z0-9_=/-]+/i, "provider URL with query secret"],
];

for (const [path, source] of scannedSources) {
  for (const [pattern, label] of forbiddenCredentialPatterns) {
    if (pattern.test(source)) {
      throw new Error(`Potential committed credential in ${path}: ${label}`);
    }
  }
}

console.log("mealscout-authenticated-production-smoke-p2-accounts-and-secrets.contract: PASS");
