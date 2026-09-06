import jwt, { type JwtPayload } from "jsonwebtoken";
import type { User } from "@shared/schema";

const MAX_SUBJECT_LENGTH = 200;
const MAX_ROLE_COUNT = 20;
const MAX_ROLE_LENGTH = 100;
const DEFAULT_MAX_AGE_SECONDS = 300;
const MAX_CONFIGURED_AGE_SECONDS = 900;
const CLOCK_TOLERANCE_SECONDS = 5;

export type TradeScoutSsoConfig = {
  secret: string;
  issuer: string;
  audience: string;
  maxAgeSeconds: number;
};

export type TradeScoutSsoIdentity = {
  tradescoutId: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  userType: User["userType"];
};

type ConfigResult =
  | { ok: true; config: TradeScoutSsoConfig }
  | { ok: false; code: "missing_config" | "weak_secret" };

type VerificationResult =
  | { ok: true; identity: TradeScoutSsoIdentity }
  | {
      ok: false;
      code:
        | "invalid_token"
        | "invalid_claims"
        | "missing_subject"
        | "invalid_lifetime";
    };

const boundedString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
};

const normalizeRoles = (claims: JwtPayload): string[] => {
  const rawRoles = Array.isArray(claims.roles)
    ? claims.roles
    : typeof claims.role === "string"
      ? [claims.role]
      : [];
  return Array.from(
    new Set(
      rawRoles
        .map((role) => boundedString(role, MAX_ROLE_LENGTH))
        .filter((role): role is string => Boolean(role)),
    ),
  ).slice(0, MAX_ROLE_COUNT);
};

export function mapTradeScoutRolesToUserType(
  roles: readonly string[],
): User["userType"] {
  if (roles.includes("mealscout_super_admin")) return "super_admin";
  if (roles.includes("mealscout_duper_admin")) return "duper_admin";
  if (roles.includes("mealscout_admin")) return "admin";
  if (
    roles.includes("mealscout_restaurant_owner") ||
    roles.includes("restaurant_owner") ||
    roles.includes("merchant") ||
    roles.includes("vendor")
  ) {
    return "restaurant_owner";
  }
  return "customer";
}

export function resolveTradeScoutSsoConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfigResult {
  const secret = String(env.TRADESCOUT_JWT_SECRET || "").trim();
  const issuer = String(env.TRADESCOUT_JWT_ISSUER || "").trim();
  const audience = String(env.TRADESCOUT_JWT_AUDIENCE || "").trim();
  if (!secret || !issuer || !audience) return { ok: false, code: "missing_config" };
  if (secret.length < 32) return { ok: false, code: "weak_secret" };

  const configuredAge = Number(env.TRADESCOUT_JWT_MAX_AGE_SECONDS);
  const maxAgeSeconds = Number.isFinite(configuredAge)
    ? Math.min(
        MAX_CONFIGURED_AGE_SECONDS,
        Math.max(60, Math.trunc(configuredAge)),
      )
    : DEFAULT_MAX_AGE_SECONDS;

  return {
    ok: true,
    config: { secret, issuer, audience, maxAgeSeconds },
  };
}

export function verifyTradeScoutSsoToken(
  token: string,
  config: TradeScoutSsoConfig,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerificationResult {
  let claims: JwtPayload;
  try {
    const decoded = jwt.verify(token, config.secret, {
      algorithms: ["HS256"],
      issuer: config.issuer,
      audience: config.audience,
      maxAge: `${config.maxAgeSeconds}s`,
      clockTimestamp: nowSeconds,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { ok: false, code: "invalid_claims" };
    }
    claims = decoded;
  } catch {
    return { ok: false, code: "invalid_token" };
  }

  const tradescoutId = boundedString(claims.sub, MAX_SUBJECT_LENGTH);
  if (
    !tradescoutId ||
    tradescoutId.toLowerCase() === "undefined" ||
    tradescoutId.toLowerCase() === "null"
  ) {
    return { ok: false, code: "missing_subject" };
  }

  if (
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    Number(claims.exp) <= Number(claims.iat) ||
    Number(claims.exp) - Number(claims.iat) >
      config.maxAgeSeconds + CLOCK_TOLERANCE_SECONDS ||
    Number(claims.iat) > nowSeconds + CLOCK_TOLERANCE_SECONDS
  ) {
    return { ok: false, code: "invalid_lifetime" };
  }

  const roles = normalizeRoles(claims);
  const rawEmail = boundedString(claims.email, 320);
  const emailVerified = Boolean(rawEmail && claims.email_verified === true);
  const fullName = boundedString(claims.name, 200);
  const firstName =
    boundedString(claims.given_name ?? claims.firstName, 100) ||
    (fullName ? fullName.split(/\s+/)[0] || null : null);
  const lastName =
    boundedString(claims.family_name ?? claims.lastName, 100) ||
    (fullName ? fullName.split(/\s+/).slice(1).join(" ") || null : null);

  return {
    ok: true,
    identity: {
      tradescoutId,
      email: emailVerified ? rawEmail : null,
      emailVerified,
      firstName,
      lastName,
      roles,
      userType: mapTradeScoutRolesToUserType(roles),
    },
  };
}
