import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type SmokeRole = "customer" | "owner" | "staff_admin";

type CheckEvidence = {
  role: SmokeRole;
  name: string;
  method: "GET" | "POST";
  path: string;
  expectedStatus: number | number[];
  status: number | null;
  passed: boolean;
  error?: string;
};

type SmokeEvidence = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  baseUrl: string;
  origin: string;
  enabled: boolean;
  dryMutationPolicy: "no_mutation_except_login";
  redactionApplied: boolean;
  requiredEnvPresent: string[];
  checks: CheckEvidence[];
  summary?: {
    total: number;
    passed: number;
    failed: number;
  };
};

const REQUIRED_ENV = [
  "PROD_AUTH_SMOKE_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "SMOKE_CUSTOMER_EMAIL",
  "SMOKE_CUSTOMER_PASSWORD",
  "SMOKE_OWNER_EMAIL",
  "SMOKE_OWNER_PASSWORD",
  "SMOKE_OWNER_SUBSCRIBED_FIXTURE_ID",
  "SMOKE_OWNER_UNSUBSCRIBED_FIXTURE_ID",
  "SMOKE_ADMIN_EMAIL",
  "SMOKE_ADMIN_PASSWORD",
] as const;

const OPTIONAL_ENV = ["READONLY_DATABASE_URL", "SMOKE_EVIDENCE_DIR", "SMOKE_RUN_ID"] as const;

const SENSITIVE_KEY_PATTERN =
  /(password|cookie|token|secret|session|authorization|database_url|readonly_database_url|stripe|brevo|api[_-]?key)/i;
const SECRET_VALUE_PATTERNS = [
  /connect\.sid=[^;\s"]+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/g,
  /\bwhsec_[A-Za-z0-9]{12,}\b/g,
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
];

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function isEnabled(): boolean {
  return env("PROD_AUTH_SMOKE_ENABLED") === "true";
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function requirePreflight(): void {
  if (!isEnabled()) {
    throw new Error(
      "Authenticated production smoke refused: set PROD_AUTH_SMOKE_ENABLED=true to run.",
    );
  }

  const missing = REQUIRED_ENV.filter((name) => !env(name));
  if (missing.length > 0) {
    throw new Error(
      `Authenticated production smoke refused: missing required env vars: ${missing.join(", ")}`,
    );
  }
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.reduce(
      (next, pattern) => next.replace(pattern, "[REDACTED]"),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(nested);
    }
    return output;
  }

  return value;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return String(redact(message));
}

function getSetCookieHeader(res: Response): string {
  const getSetCookie = (res.headers as any).getSetCookie;
  const rawCookies =
    typeof getSetCookie === "function"
      ? (getSetCookie.call(res.headers) as string[])
      : res.headers.get("set-cookie")
        ? [String(res.headers.get("set-cookie"))]
        : [];
  return rawCookies
    .map((line) => String(line || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function login(baseUrl: string, origin: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`login failed with status ${res.status}`);
  }

  const cookie = getSetCookieHeader(res);
  if (!cookie) {
    throw new Error("login succeeded but no session cookie was returned");
  }

  return cookie;
}

async function getJson(
  baseUrl: string,
  origin: string,
  cookie: string,
  routePath: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      Origin: origin,
      Referer: `${origin}/`,
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function statusMatches(actual: number, expected: number | number[]): boolean {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

async function recordGetCheck(input: {
  evidence: SmokeEvidence;
  role: SmokeRole;
  name: string;
  baseUrl: string;
  origin: string;
  cookie: string;
  path: string;
  expectedStatus: number | number[];
}): Promise<void> {
  try {
    const result = await getJson(input.baseUrl, input.origin, input.cookie, input.path);
    input.evidence.checks.push({
      role: input.role,
      name: input.name,
      method: "GET",
      path: input.path,
      expectedStatus: input.expectedStatus,
      status: result.status,
      passed: statusMatches(result.status, input.expectedStatus),
    });
  } catch (error) {
    input.evidence.checks.push({
      role: input.role,
      name: input.name,
      method: "GET",
      path: input.path,
      expectedStatus: input.expectedStatus,
      status: null,
      passed: false,
      error: safeError(error),
    });
  }
}

async function runRole(input: {
  evidence: SmokeEvidence;
  role: SmokeRole;
  email: string;
  password: string;
  baseUrl: string;
  origin: string;
  checks: Array<{ name: string; path: string; expectedStatus: number | number[] }>;
}): Promise<void> {
  let cookie = "";
  try {
    cookie = await login(input.baseUrl, input.origin, input.email, input.password);
    input.evidence.checks.push({
      role: input.role,
      name: "login/session creation",
      method: "POST",
      path: "/api/auth/login",
      expectedStatus: 200,
      status: 200,
      passed: true,
    });
  } catch (error) {
    input.evidence.checks.push({
      role: input.role,
      name: "login/session creation",
      method: "POST",
      path: "/api/auth/login",
      expectedStatus: 200,
      status: null,
      passed: false,
      error: safeError(error),
    });
    return;
  }

  for (const check of input.checks) {
    await recordGetCheck({
      evidence: input.evidence,
      role: input.role,
      name: check.name,
      baseUrl: input.baseUrl,
      origin: input.origin,
      cookie,
      path: check.path,
      expectedStatus: check.expectedStatus,
    });
  }
}

function evidencePath(runId: string): string {
  const evidenceDir = env("SMOKE_EVIDENCE_DIR") || "artifacts/production-smoke/authenticated";
  mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, `${runId}.json`);
}

async function main(): Promise<void> {
  requirePreflight();

  const runId =
    env("SMOKE_RUN_ID") ||
    `prod-auth-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const baseUrl = normalizeBaseUrl(env("SMOKE_BASE_URL"));
  const origin = normalizeBaseUrl(env("SMOKE_ORIGIN"));
  const evidence: SmokeEvidence = {
    runId,
    startedAt: new Date().toISOString(),
    baseUrl,
    origin,
    enabled: true,
    dryMutationPolicy: "no_mutation_except_login",
    redactionApplied: true,
    requiredEnvPresent: [...REQUIRED_ENV],
    checks: [],
  };

  await runRole({
    evidence,
    role: "customer",
    email: env("SMOKE_CUSTOMER_EMAIL"),
    password: env("SMOKE_CUSTOMER_PASSWORD"),
    baseUrl,
    origin,
    checks: [{ name: "customer session read", path: "/api/auth/user", expectedStatus: 200 }],
  });

  await runRole({
    evidence,
    role: "owner",
    email: env("SMOKE_OWNER_EMAIL"),
    password: env("SMOKE_OWNER_PASSWORD"),
    baseUrl,
    origin,
    checks: [
      { name: "owner session read", path: "/api/auth/user", expectedStatus: 200 },
      { name: "owner restaurants read", path: "/api/restaurants/my", expectedStatus: 200 },
      {
        name: "owner subscribed fixture kitchen queue read",
        path: `/api/owner/kitchen-queue/${encodeURIComponent(env("SMOKE_OWNER_SUBSCRIBED_FIXTURE_ID"))}`,
        expectedStatus: 200,
      },
      {
        name: "owner subscribed fixture order history read",
        path: `/api/owner/orders/${encodeURIComponent(env("SMOKE_OWNER_SUBSCRIBED_FIXTURE_ID"))}`,
        expectedStatus: 200,
      },
      {
        name: "owner unsubscribed fixture kitchen queue negative check",
        path: `/api/owner/kitchen-queue/${encodeURIComponent(env("SMOKE_OWNER_UNSUBSCRIBED_FIXTURE_ID"))}`,
        expectedStatus: 403,
      },
      {
        name: "owner unsubscribed fixture order history negative check",
        path: `/api/owner/orders/${encodeURIComponent(env("SMOKE_OWNER_UNSUBSCRIBED_FIXTURE_ID"))}`,
        expectedStatus: 403,
      },
    ],
  });

  await runRole({
    evidence,
    role: "staff_admin",
    email: env("SMOKE_ADMIN_EMAIL"),
    password: env("SMOKE_ADMIN_PASSWORD"),
    baseUrl,
    origin,
    checks: [
      { name: "staff/admin session read", path: "/api/auth/user", expectedStatus: 200 },
      { name: "staff/admin launch board read", path: "/api/admin/launch-board", expectedStatus: 200 },
    ],
  });

  const failed = evidence.checks.filter((check) => !check.passed).length;
  evidence.completedAt = new Date().toISOString();
  evidence.summary = {
    total: evidence.checks.length,
    passed: evidence.checks.length - failed,
    failed,
  };

  const outputPath = evidencePath(runId);
  writeFileSync(outputPath, `${JSON.stringify(redact(evidence), null, 2)}\n`);
  console.log(
    `Authenticated production smoke evidence written: ${outputPath}; checks=${evidence.checks.length}; failures=${failed}`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Authenticated production smoke refused or failed: ${safeError(error)}`);
  process.exit(1);
});

export { OPTIONAL_ENV, REQUIRED_ENV, redact, requirePreflight };
