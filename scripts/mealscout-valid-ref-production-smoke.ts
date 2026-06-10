import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

type FinalStatus =
  | "fail_closed_production_pass"
  | "valid_ref_acceptance_blocked"
  | "valid_ref_acceptance_complete";

type SmokeEvidence = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: FinalStatus;
  baseUrl: string;
  origin: string;
  publicTargetPath: string | null;
  generatedLink?: string;
  checks: Array<{
    name: string;
    status: number | null;
    passed: boolean;
    detail?: string;
  }>;
};

const REQUIRED_ENV = [
  "VALID_REF_SMOKE_ENABLED",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "VALID_REF_SMOKE_EMAIL",
  "VALID_REF_SMOKE_PASSWORD",
  "VALID_REF_SMOKE_AFFILIATE_TAG",
  "VALID_REF_SMOKE_PUBLIC_TARGET_PATH",
] as const;

const FORBIDDEN_ENDPOINTS = [
  "/api/affiliate/tag",
  "/api/affiliate/generate-link",
] as const;

const ALLOWED_POST_ENDPOINTS = [
  "/api/auth/login",
  "/api/share/generate",
] as const;

const SENSITIVE_KEY_PATTERN =
  /(password|cookie|token|secret|session|authorization)/i;

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function isDefaultLookingAffiliateTag(tag: string): boolean {
  return /^user\d{4}$/i.test(String(tag || "").trim());
}

function normalizePublicTargetPath(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  let value = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      value = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }

  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}

function isValidPublicShareTarget(input: string): boolean {
  const value = normalizePublicTargetPath(input);
  if (!value) return false;
  const pathname = value.split(/[?#]/, 1)[0].toLowerCase();
  if (
    pathname === "/" ||
    pathname === "/ref" ||
    pathname.startsWith("/ref/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/staff")
  ) {
    return false;
  }
  return (
    pathname.startsWith("/p/") ||
    pathname.startsWith("/scout") ||
    pathname.startsWith("/restaurant/") ||
    pathname.startsWith("/truck/") ||
    pathname.startsWith("/location/")
  );
}

function assertAllowedEndpoint(method: string, endpoint: string): void {
  const upperMethod = method.toUpperCase();
  if (FORBIDDEN_ENDPOINTS.some((forbidden) => endpoint.startsWith(forbidden))) {
    throw new Error(`Forbidden valid-ref smoke endpoint: ${endpoint}`);
  }
  if (
    upperMethod === "POST" &&
    !ALLOWED_POST_ENDPOINTS.includes(endpoint as any)
  ) {
    throw new Error(`Unexpected valid-ref smoke POST endpoint: ${endpoint}`);
  }
  if (["PUT", "PATCH", "DELETE"].includes(upperMethod)) {
    throw new Error(
      `Unexpected valid-ref smoke mutation method: ${upperMethod}`,
    );
  }
}

function requirePreflight(): void {
  if (env("VALID_REF_SMOKE_ENABLED") !== "true") {
    throw new Error(
      "Valid-ref production smoke blocked: set VALID_REF_SMOKE_ENABLED=true only after fixture approval.",
    );
  }

  const missing = REQUIRED_ENV.filter((name) => !env(name));
  if (missing.length > 0) {
    throw new Error(
      `Valid-ref production smoke blocked: missing ${missing.join(", ")}`,
    );
  }

  const tag = env("VALID_REF_SMOKE_AFFILIATE_TAG");
  if (isDefaultLookingAffiliateTag(tag)) {
    throw new Error(
      "Valid-ref production smoke blocked: default-looking userNNNN tag is not acceptable.",
    );
  }

  if (!isValidPublicShareTarget(env("VALID_REF_SMOKE_PUBLIC_TARGET_PATH"))) {
    throw new Error(
      "Valid-ref production smoke blocked: real public share target is required.",
    );
  }
}

function redact(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redact(nested);
    }
    return output;
  }
  return value;
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
    .map((line) =>
      String(line || "")
        .split(";")[0]
        .trim(),
    )
    .filter(Boolean)
    .join("; ");
}

async function login(baseUrl: string, origin: string): Promise<string> {
  const endpoint = "/api/auth/login";
  assertAllowedEndpoint("POST", endpoint);
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify({
      email: env("VALID_REF_SMOKE_EMAIL"),
      password: env("VALID_REF_SMOKE_PASSWORD"),
    }),
  });
  if (!res.ok) throw new Error(`login failed with status ${res.status}`);
  const cookie = getSetCookieHeader(res);
  if (!cookie)
    throw new Error("login succeeded but no session cookie was returned");
  return cookie;
}

async function getJson(
  baseUrl: string,
  origin: string,
  cookie: string,
  endpoint: string,
) {
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

async function generateShareLink(
  baseUrl: string,
  origin: string,
  cookie: string,
) {
  const endpoint = "/api/share/generate";
  assertAllowedEndpoint("POST", endpoint);
  const targetPath = normalizePublicTargetPath(
    env("VALID_REF_SMOKE_PUBLIC_TARGET_PATH"),
  );
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookie,
      Origin: origin,
      Referer: `${origin}/`,
    },
    body: JSON.stringify({
      path: targetPath,
      ref: env("VALID_REF_SMOKE_AFFILIATE_TAG"),
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function evidencePath(runId: string): string {
  const evidenceDir =
    env("VALID_REF_SMOKE_EVIDENCE_DIR") ||
    "artifacts/production-smoke/valid-ref";
  mkdirSync(evidenceDir, { recursive: true });
  return path.join(evidenceDir, `${runId}.json`);
}

async function main(): Promise<void> {
  requirePreflight();

  const runId =
    env("VALID_REF_SMOKE_RUN_ID") ||
    `valid-ref-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const baseUrl = normalizeBaseUrl(env("SMOKE_BASE_URL"));
  const origin = normalizeBaseUrl(env("SMOKE_ORIGIN"));
  const publicTargetPath = normalizePublicTargetPath(
    env("VALID_REF_SMOKE_PUBLIC_TARGET_PATH"),
  );
  const evidence: SmokeEvidence = {
    runId,
    startedAt: new Date().toISOString(),
    status: "valid_ref_acceptance_blocked",
    baseUrl,
    origin,
    publicTargetPath,
    checks: [],
  };

  try {
    const cookie = await login(baseUrl, origin);
    evidence.checks.push({
      name: "login/session creation",
      status: 200,
      passed: true,
    });

    const userRead = await getJson(baseUrl, origin, cookie, "/api/auth/user");
    const user =
      userRead.body && typeof userRead.body === "object"
        ? (userRead.body as any)
        : {};
    const actualTag = String(user.affiliateTag || "").trim();
    const expectedTag = env("VALID_REF_SMOKE_AFFILIATE_TAG");
    const tagMatches =
      actualTag === expectedTag && !isDefaultLookingAffiliateTag(actualTag);
    evidence.checks.push({
      name: "approved non-default affiliate tag",
      status: userRead.status,
      passed: userRead.status === 200 && tagMatches,
      detail: tagMatches
        ? "tag confirmed"
        : "tag missing, mismatched, or default-looking",
    });

    if (!tagMatches || !publicTargetPath) {
      evidence.status = "valid_ref_acceptance_blocked";
    } else {
      const generated = await generateShareLink(baseUrl, origin, cookie);
      const body = generated.body as any;
      const shareLink = String(body?.shareLink || "").trim();
      evidence.generatedLink = shareLink || undefined;
      const passed =
        generated.status === 200 &&
        shareLink.startsWith("https://www.mealscout.us/") &&
        shareLink.includes(publicTargetPath.split(/[?#]/, 1)[0]) &&
        shareLink.includes(`ref=${encodeURIComponent(expectedTag)}`) &&
        !/\/ref\/([^/?#]+)[^#]*[?&]ref=\1(?:&|#|$)/i.test(shareLink) &&
        !/^https:\/\/meal-scout\.vercel\.app\//i.test(shareLink);
      evidence.checks.push({
        name: "canonical valid-ref share link",
        status: generated.status,
        passed,
        detail: passed
          ? "canonical target with ref confirmed"
          : "generated link failed canonical checks",
      });
      evidence.status = passed
        ? "valid_ref_acceptance_complete"
        : "valid_ref_acceptance_blocked";
    }
  } finally {
    evidence.completedAt = new Date().toISOString();
    writeFileSync(
      evidencePath(runId),
      `${JSON.stringify(redact(evidence), null, 2)}\n`,
    );
  }

  if (evidence.status !== "valid_ref_acceptance_complete") {
    throw new Error(
      "Valid-ref production smoke blocked or failed; full acceptance is not complete.",
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
  FORBIDDEN_ENDPOINTS,
  REQUIRED_ENV,
  assertAllowedEndpoint,
  isDefaultLookingAffiliateTag,
  isValidPublicShareTarget,
  normalizePublicTargetPath,
  requirePreflight,
};
