export type OAuthProvider = "google" | "facebook";

export type OAuthIdentityDecision =
  | { kind: "existing"; userId: string }
  | { kind: "create" }
  | { kind: "link_required"; existingUserId: string }
  | {
      kind: "identity_collision";
      providerUserId: string;
      emailUserId: string;
    };

export type OAuthIdentityFailureCode =
  | "AUTH_ACCOUNT_LINK_REQUIRED"
  | "AUTH_IDENTITY_COLLISION"
  | "AUTH_ACCOUNT_DISABLED";

interface OAuthIdentityEvidence {
  providerUserId?: string | null;
  emailUserId?: string | null;
}

const normalizedId = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * A provider subject is login proof. Provider email is discovery and
 * collision evidence only and cannot attach a provider to an existing row.
 */
export function decideOAuthIdentity(
  evidence: OAuthIdentityEvidence,
): OAuthIdentityDecision {
  const providerUserId = normalizedId(evidence.providerUserId);
  const emailUserId = normalizedId(evidence.emailUserId);

  if (providerUserId) {
    if (emailUserId && emailUserId !== providerUserId) {
      return {
        kind: "identity_collision",
        providerUserId,
        emailUserId,
      };
    }
    return { kind: "existing", userId: providerUserId };
  }

  if (emailUserId) {
    return { kind: "link_required", existingUserId: emailUserId };
  }

  return { kind: "create" };
}

export class OAuthIdentityBoundaryError extends Error {
  constructor(
    public readonly code: OAuthIdentityFailureCode,
    public readonly provider: OAuthProvider,
  ) {
    super(
      code === "AUTH_ACCOUNT_DISABLED"
        ? "This MealScout account is disabled. Use account recovery or contact support; no account was changed."
        : code === "AUTH_ACCOUNT_LINK_REQUIRED"
          ? `An account with this email already exists. Use its current sign-in method; ${provider} was not linked.`
          : `This ${provider} identity conflicts with another account. Use account recovery; no account was changed.`,
    );
    this.name = "OAuthIdentityBoundaryError";
  }
}

export function assertOAuthIdentityCanProceed(
  provider: OAuthProvider,
  decision: OAuthIdentityDecision,
): void {
  if (decision.kind === "link_required") {
    throw new OAuthIdentityBoundaryError(
      "AUTH_ACCOUNT_LINK_REQUIRED",
      provider,
    );
  }
  if (decision.kind === "identity_collision") {
    throw new OAuthIdentityBoundaryError("AUTH_IDENTITY_COLLISION", provider);
  }
}

export function oauthIdentityRedirectCode(info: unknown): string {
  const code =
    info && typeof info === "object" && typeof (info as any).code === "string"
      ? String((info as any).code).trim()
      : "";
  if (code === "AUTH_ACCOUNT_LINK_REQUIRED") {
    return "auth_account_link_required";
  }
  if (code === "AUTH_IDENTITY_COLLISION") {
    return "auth_identity_collision";
  }
  if (code === "AUTH_ACCOUNT_DISABLED") {
    return "auth_account_disabled";
  }
  return "auth_failed";
}
