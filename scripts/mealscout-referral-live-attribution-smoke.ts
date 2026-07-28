import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type SmokeStatus =
  | "live_referral_smoke_complete"
  | "live_referral_smoke_blocked"
  | "live_referral_smoke_failed";

type CheckEvidence = {
  name: string;
  status: number | null;
  passed: boolean;
  detail?: string;
};

type SmokeEvidence = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: SmokeStatus;
  baseUrl: string;
  origin: string;
  generatedLink?: string;
  legacyCaptureUrl?: string;
  checks: CheckEvidence[];
};

type AdminAffiliateRow = {
  id: string;
  email: string | null;
  affiliateTag: string | null;
  affiliateCloserUserId: string | null;
};

const REQUIRED_ENV = [
  "REFERRAL_LIVE_SMOKE_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_EMAIL",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_PASSWORD",
  "REFERRAL_LIVE_SMOKE_AFFILIATE_TAG",
  "REFERRAL_LIVE_SMOKE_TARGET_EMAIL",
  "REFERRAL_LIVE_SMOKE_TARGET_PASSWORD",
  "REFERRAL_LIVE_SMOKE_ADMIN_EMAIL",
  "REFERRAL_LIVE_SMOKE_ADMIN_PASSWORD",
] as const;

const OPTIONAL_ENV = [
  "REFERRAL_LIVE_SMOKE_ALLOW_ATTRIBUTION_WRITE",
  "REFERRAL_LIVE_SMOKE_SIGNUP_EMAIL",
  "REFERRAL_LIVE_SMOKE_SIGNUP_FIRST_NAME",
  "REFERRAL_LIVE_SMOKE_SIGNUP_LAST_NAME",
  "REFERRAL_LIVE_SMOKE_SIGNUP_PHONE",
  "REFERRAL_LIVE_SMOKE_SIGNUP_PASSWORD",
  "REFERRAL_LIVE_SMOKE_SIGNUP_OTP_CODE",
  "REFERRAL_LIVE_SMOKE_TARGET_PATH",
  "REFERRAL_LIVE_SMOKE_EVIDENCE_DIR",
  "REFERRAL_LIVE_SMOKE_RUN_ID",
] as const;

const ALLOWED_POST_ENDPOINTS = [
  "/api/auth/login",
  "/api/share/generate",
  "/api/auth/customer/register",
] as const;

const FORBIDDEN_MUTATION_METHODS = ["PUT", "PATCH", "DELETE"] as const;

const SENSITIVE_KEY_PATTERN =
  /(password|cookie|token|secret|session|authorization|database_url|api[_-]?key)/i;

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function ensureEnabled(): void {
  if (env("REFERRAL_LIVE_SMOKE_ENABLED") !== "true") {
    throw new Error(
      "Live referral smoke blocked: set REFERRAL_LIVE_SMOKE_ENABLED=true for explicit operator-approved execution.",
    );
  }
}

function requirePreflight(): void {
  ensureEnabled();
  const missing = REQUIRED_ENV.filter((name) => !env(name));
  if (missing.length > 0) {
    throw new Error(
      `Live referral smoke blocked: missing required env vars: ${missing.join(", ")}`,
    );
  }

  if (env("REFERRAL_LIVE_SMOKE_ALLOW_ATTRIBUTION_WRITE") === "true") {
    const signupRequired = [
      "REFERRAL_LIVE_SMOKE_SIGNUP_EMAIL",
      "REFERRAL_LIVE_SMOKE_SIGNUP_FIRST_NAME",
      "REFERRAL_LIVE_SMOKE_SIGNUP_LAST_NAME",
      "REFERRAL_LIVE_SMOKE_SIGNUP_PHONE",
      "REFERRAL_LIVE_SMOKE_SIGNUP_PASSWORD",
    ] as const;
    const missingSignup = signupRequired.filter((name) => !env(name));
    if (missingSignup.length > 0) {
      throw new Error(
        `Live referral smoke blocked: attribution write mode missing signup env vars: ${missingSignup.join(", ")}`,
      );
    }
  }
}

function assertAllowedEndpoint(method: string, endpoint: string): void {
  const upper = method.toUpperCase();
  if (FORBIDDEN_MUTATION_METHODS.includes(upper as any)) {
    throw new Error(`Forbidden live smoke mutation method: ${upper}`);
  }
  if (upper === "POST" && !ALLOWED_POST_ENDPOINTS.includes(endpoint as any)) {
    throw new Error(`Unexpected live smoke POST endpoint: ${endpoint}`);
  }
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(nested);
    }
    return output;
  }
  return value;
}

function getSetCookieParts(res: Response): string[] {
  const getSetCookie = (res.headers as any).getSetCookie;
  const raw =
    typeof getSetCookie === "function"
      ? (getSetCookie.call(res.headers) as string[])
      : res.headers.get("set-cookie")
        ? [String(res.headers.get("set-cookie"))]
        : [];
  return raw
    .map((line) => String(line || "").split(";")[0].trim())
    .filter(Boolean);
}

function mergeCookieHeaders(...cookieSets: Array<string[]>): string {
  const jar = new Map<string, string>();
  for (const set of cookieSets) {
    for (const cookie of set) {
      const idx = cookie.indexOf("=");
      if (idx <= 0) continue;
      jar.set(cookie.slice(0, idx).trim(), cookie.slice(idx + 1).trim());
    }
  }
  return Array.from(jar.entries())
    .map(([key, val]) => `${key}=${val}`)
    .join("; ");
}

async function login(
  baseUrl: string,
  origin: string,
  email: string,
  password: string,
  cookieHeader?: string,
): Promise<{ status: number; cookie: string }> {
  const endpoint = "/api/auth/login";
  assertAllowedEndpoint("POST", endpoint);
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
      Referer: `${origin}/`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
  const cookie = mergeCookieHeaders(getSetCookieParts(res));
  if (!res.ok) {
    throw new Error(`login failed (${email}) with status ${res.status}`);
  }
  if (!cookie) {
    throw new Error(`login succeeded (${email}) but no session cookie returned`);
  }
  return { status: res.status, cookie };
}

async function postJson(
  baseUrl: string,
  origin: string,
  endpoint: string,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  assertAllowedEndpoint("POST", endpoint);
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookie,
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function customerSignup(
  baseUrl: string,
  origin: string,
  cookie: string,
  referralTag: string,
): Promise<{ status: number; body: any }> {
  const endpoint = "/api/auth/customer/register";
  assertAllowedEndpoint("POST", endpoint);
  const payload: Record<string, unknown> = {
    email: env("REFERRAL_LIVE_SMOKE_SIGNUP_EMAIL"),
    firstName: env("REFERRAL_LIVE_SMOKE_SIGNUP_FIRST_NAME"),
    lastName: env("REFERRAL_LIVE_SMOKE_SIGNUP_LAST_NAME"),
    phone: env("REFERRAL_LIVE_SMOKE_SIGNUP_PHONE"),
    password: env("REFERRAL_LIVE_SMOKE_SIGNUP_PASSWORD"),
    referralId: referralTag,
    accountType: "customer",
  };
  const otpCode = env("REFERRAL_LIVE_SMOKE_SIGNUP_OTP_CODE");
  if (otpCode) payload.otpCode = otpCode;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookie,
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function getJson(
  baseUrl: string,
  origin: string,
  endpoint: string,
  cookie: string,
): Promise<{ status: number; body: any }> {
  assertAllowedEndpoint("GET", endpoint);
  const res = await fetch(`${baseUrl}${endpoint}`, {
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

function normalizeShareTargetPath(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "/directory";
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function parseCanonicalGeneratedLink(generatedLink: string, expectedTag: string) {
  const url = new URL(generatedLink);
  const tag = String(url.searchParams.get("ref") || "").trim();
  const basePath = url.pathname;
  if (!tag) {
    throw new Error("Generated referral link is missing canonical query attribution.");
  }

  if (tag.toLowerCase() !== expectedTag.toLowerCase()) {
    throw new Error("Generated referral link does not use the expected affiliate tag.");
  }

  const forbidden = ["role=business", "to=", "%2F", "/ref/"];
  for (const fragment of forbidden) {
    if (generatedLink.includes(fragment)) {
      throw new Error(`Generated referral link contains forbidden fragment: ${fragment}`);
    }
  }

  return {
    url,
    tag,
    basePath,
    targetPathForLegacyCapture: `${basePath}${url.search}${url.hash}`,
  };
}

async function clickLegacyCapture(
  baseUrl: string,
  origin: string,
  tag: string,
  targetPath: string,
): Promise<{
  status: number;
  location: string;
  referralCookieHeader: string;
}> {
  const legacyUrl = `${baseUrl}/ref/${encodeURIComponent(tag)}?to=${encodeURIComponent(targetPath)}`;
  const res = await fetch(legacyUrl, {
    method: "GET",
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Origin: origin,
      Referer: `${origin}/`,
    },
  });

  const status = res.status;
  const location = String(res.headers.get("location") || "").trim();
  const referralCookieHeader = mergeCookieHeaders(getSetCookieParts(res));

  return {
    status,
    location,
    referralCookieHeader,
  };
}

async function fetchAdminAffiliateUsers(
  baseUrl: string,
  origin: string,
  adminCookie: string,
): Promise<{ status: number; rows: AdminAffiliateRow[] }> {
  const result = await getJson(
    baseUrl,
    origin,
    "/api/admin/affiliates/users",
    adminCookie,
  );
  const rows = Array.isArray(result.body) ? (result.body as AdminAffiliateRow[]) : [];
  return { status: result.status, rows };
}

function evidencePath(runId: string): string {
  const evidenceDir =
    env("REFERRAL_LIVE_SMOKE_EVIDENCE_DIR") ||
    "artifacts/production-smoke/referral-live-attribution";
  mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, `${runId}.json`);
}

function pushCheck(evidence: SmokeEvidence, check: CheckEvidence): void {
  evidence.checks.push(check);
}

async function main(): Promise<void> {
  requirePreflight();

  const runId =
    env("REFERRAL_LIVE_SMOKE_RUN_ID") ||
    `referral-live-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const baseUrl = normalizeBaseUrl(env("SMOKE_BASE_URL"));
  const origin = normalizeBaseUrl(env("SMOKE_ORIGIN"));
  const targetPath = normalizeShareTargetPath(env("REFERRAL_LIVE_SMOKE_TARGET_PATH") || "/directory");

  const evidence: SmokeEvidence = {
    runId,
    startedAt: new Date().toISOString(),
    status: "live_referral_smoke_blocked",
    baseUrl,
    origin,
    checks: [],
  };

  try {
    const affiliateLogin = await login(
      baseUrl,
      origin,
      env("REFERRAL_LIVE_SMOKE_AFFILIATE_EMAIL"),
      env("REFERRAL_LIVE_SMOKE_AFFILIATE_PASSWORD"),
    );
    pushCheck(evidence, {
      name: "affiliate login/session",
      status: affiliateLogin.status,
      passed: true,
    });

    const generated = await postJson(
      baseUrl,
      origin,
      "/api/share/generate",
      affiliateLogin.cookie,
      { path: targetPath },
    );
    const generatedLink = String(generated.body?.shareLink || "").trim();
    evidence.generatedLink = generatedLink || undefined;

    const canonical = parseCanonicalGeneratedLink(
      generatedLink,
      env("REFERRAL_LIVE_SMOKE_AFFILIATE_TAG"),
    );
    pushCheck(evidence, {
      name: "canonical referral link generation",
      status: generated.status,
      passed:
        generated.status === 200 &&
        generated.body?.attributionMode === "vanity_tag" &&
        canonical.url.origin === "https://www.mealscout.us",
      detail: `target=${canonical.targetPathForLegacyCapture}`,
    });

    const adminLogin = await login(
      baseUrl,
      origin,
      env("REFERRAL_LIVE_SMOKE_ADMIN_EMAIL"),
      env("REFERRAL_LIVE_SMOKE_ADMIN_PASSWORD"),
    );
    pushCheck(evidence, {
      name: "admin login/session",
      status: adminLogin.status,
      passed: true,
    });

    const adminBefore = await fetchAdminAffiliateUsers(
      baseUrl,
      origin,
      adminLogin.cookie,
    );
    const affiliateRow = adminBefore.rows.find(
      (row) =>
        String(row.affiliateTag || "").trim().toLowerCase() ===
        env("REFERRAL_LIVE_SMOKE_AFFILIATE_TAG").toLowerCase(),
    );
    const targetRowBefore = adminBefore.rows.find(
      (row) =>
        String(row.email || "").trim().toLowerCase() ===
        env("REFERRAL_LIVE_SMOKE_TARGET_EMAIL").toLowerCase(),
    );

    pushCheck(evidence, {
      name: "admin affiliate-user lookup",
      status: adminBefore.status,
      passed:
        adminBefore.status === 200 && Boolean(affiliateRow?.id) && Boolean(targetRowBefore?.id),
      detail: !affiliateRow
        ? "affiliate tag not found in admin user inventory"
        : !targetRowBefore
          ? "target user not found in admin user inventory"
          : undefined,
    });

    if (!affiliateRow?.id || !targetRowBefore?.id) {
      evidence.status = "live_referral_smoke_blocked";
      throw new Error(
        "Live referral smoke blocked: required admin user records missing.",
      );
    }

    const capture = await clickLegacyCapture(
      baseUrl,
      origin,
      canonical.tag,
      canonical.targetPathForLegacyCapture,
    );
    evidence.legacyCaptureUrl = `/ref/${encodeURIComponent(canonical.tag)}?to=${encodeURIComponent(canonical.targetPathForLegacyCapture)}`;

    const captureStatusOk = [301, 302, 303, 307, 308].includes(capture.status);
    const locationHasRef = new URL(capture.location, "https://www.mealscout.us").searchParams.get("ref") === canonical.tag;
    const capturedReferralCookie = /(^|;\s*)referralId=/i.test(capture.referralCookieHeader);
    pushCheck(evidence, {
      name: "legacy redirect click capture",
      status: capture.status,
      passed: captureStatusOk && locationHasRef && capturedReferralCookie,
      detail: capture.location,
    });

    const landingRes = await fetch(`${baseUrl}${capture.location}`, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Cookie: capture.referralCookieHeader,
        Origin: origin,
        Referer: `${origin}/`,
      },
    });
    pushCheck(evidence, {
      name: "landing request with captured referral cookie",
      status: landingRes.status,
      passed: landingRes.status >= 200 && landingRes.status < 500,
    });

    const targetLogin = await login(
      baseUrl,
      origin,
      env("REFERRAL_LIVE_SMOKE_TARGET_EMAIL"),
      env("REFERRAL_LIVE_SMOKE_TARGET_PASSWORD"),
      capture.referralCookieHeader,
    );
    pushCheck(evidence, {
      name: "target login with referral handoff cookie",
      status: targetLogin.status,
      passed: targetLogin.status === 200,
    });

    const targetSessionRead = await getJson(
      baseUrl,
      origin,
      "/api/auth/user",
      targetLogin.cookie,
    );
    pushCheck(evidence, {
      name: "target session established after referral handoff",
      status: targetSessionRead.status,
      passed: targetSessionRead.status === 200,
    });

    const adminAfter = await fetchAdminAffiliateUsers(baseUrl, origin, adminLogin.cookie);
    const targetRowAfter = adminAfter.rows.find(
      (row) => row.id === targetRowBefore.id,
    );
    const preCloser = String(targetRowBefore.affiliateCloserUserId || "").trim();
    const postCloser = String(targetRowAfter?.affiliateCloserUserId || "").trim();
    const allowWrite = env("REFERRAL_LIVE_SMOKE_ALLOW_ATTRIBUTION_WRITE") === "true";

    let persistencePassed = false;
    let persistenceDetail = "";
    let persistenceStatus = adminAfter.status;
    if (preCloser) {
      persistencePassed = preCloser === affiliateRow.id && postCloser === affiliateRow.id;
      persistenceDetail = persistencePassed
        ? "existing attribution confirmed and persisted"
        : `target already attributed to a different affiliate (${preCloser || "none"})`;
    } else if (allowWrite) {
      const signup = await customerSignup(
        baseUrl,
        origin,
        capture.referralCookieHeader,
        canonical.tag,
      );
      const signupAccepted =
        signup.status === 201 ||
        // Existing-account errors are deterministic operators signals.
        signup.status === 409 ||
        signup.status === 400;
      pushCheck(evidence, {
        name: "signup attribution handoff path",
        status: signup.status,
        passed: signupAccepted,
        detail: String(signup.body?.error || signup.body?.message || "").trim() || undefined,
      });

      const adminAfterSignup = await fetchAdminAffiliateUsers(
        baseUrl,
        origin,
        adminLogin.cookie,
      );
      persistenceStatus = adminAfterSignup.status;
      const signupRow = adminAfterSignup.rows.find(
        (row) =>
          String(row.email || "").trim().toLowerCase() ===
          env("REFERRAL_LIVE_SMOKE_SIGNUP_EMAIL").toLowerCase(),
      );

      persistencePassed =
        adminAfterSignup.status === 200 &&
        Boolean(signupRow?.id) &&
        String(signupRow?.affiliateCloserUserId || "").trim() === affiliateRow.id;
      persistenceDetail = persistencePassed
        ? "attribution write confirmed via signup path"
        : "signup path did not produce confirmed affiliate persistence";
    } else {
      persistencePassed = false;
      persistenceDetail =
        "target user is not pre-attributed; set REFERRAL_LIVE_SMOKE_ALLOW_ATTRIBUTION_WRITE=true for explicit write verification";
    }

    pushCheck(evidence, {
      name: "persistence-layer affiliate attribution",
      status: persistenceStatus,
      passed: persistenceStatus === 200 && persistencePassed,
      detail: persistenceDetail,
    });

    const failedChecks = evidence.checks.filter((check) => !check.passed).length;
    evidence.status =
      failedChecks === 0
        ? "live_referral_smoke_complete"
        : allowWrite
          ? "live_referral_smoke_failed"
          : "live_referral_smoke_blocked";
  } catch (error) {
    if (evidence.status === "live_referral_smoke_complete") {
      evidence.status = "live_referral_smoke_failed";
    }
    if (evidence.status === "live_referral_smoke_blocked") {
      pushCheck(evidence, {
        name: "operator gating",
        status: null,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    evidence.completedAt = new Date().toISOString();
    const out = evidencePath(runId);
    writeFileSync(out, `${JSON.stringify(redact(evidence), null, 2)}\n`);
    console.log(`Live referral smoke evidence written: ${out}`);
  }

  if (evidence.status !== "live_referral_smoke_complete") {
    throw new Error(
      `Live referral smoke did not complete: status=${evidence.status}`,
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

export {
  ALLOWED_POST_ENDPOINTS,
  FORBIDDEN_MUTATION_METHODS,
  OPTIONAL_ENV,
  REQUIRED_ENV,
  assertAllowedEndpoint,
  requirePreflight,
};
