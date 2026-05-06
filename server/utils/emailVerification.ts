import type { Request } from "express";
import crypto from "crypto";
import type { User } from "@shared/schema";
import { storage } from "../storage";
import { emailService, isEmailConfigured } from "../emailService";

type SendVerificationResult =
  | { sent: true }
  | {
      sent: false;
      skippedReason:
        | "missing_email"
        | "already_verified"
        | "provider_not_configured"
        | "send_failed";
    };

const normalizeEmailBaseUrl = (rawValue: unknown): string | null => {
  const candidates = String(rawValue || "")
    .split(/[,\n;]/)
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    const withProtocol = /^https?:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;
    try {
      const parsed = new URL(withProtocol);
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      const port = parsed.port ? `:${parsed.port}` : "";
      return `${parsed.protocol}//${parsed.hostname}${port}`;
    } catch {
      // Try the next configured candidate.
    }
  }

  return null;
};

export const resolveEmailVerificationBaseUrl = (req?: Request): string => {
  const reqHost = req?.get?.("host");
  const reqProtocol = req?.protocol || "https";
  return (
    normalizeEmailBaseUrl(process.env.PUBLIC_BASE_URL) ||
    normalizeEmailBaseUrl(process.env.CLIENT_ORIGIN) ||
    normalizeEmailBaseUrl(reqHost ? `${reqProtocol}://${reqHost}` : "") ||
    "http://localhost:5000"
  ).replace(/\/+$/, "");
};

const safeVerificationNextPath = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  if (raw.includes("://") || raw.startsWith("/\\")) return "";
  if (/^\/api\/auth\//i.test(raw)) return "";
  return raw;
};

export async function createEmailVerificationUrl(
  user: User,
  req: Request,
  options: { next?: unknown } = {},
): Promise<string | null> {
  if (!user.email) return null;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await storage.createEmailVerificationToken({
    userId: user.id,
    tokenHash,
    expiresAt,
    requestIp: req.ip || undefined,
    userAgent: req.get("User-Agent") || undefined,
  });

  const verifyUrl = new URL(
    `${resolveEmailVerificationBaseUrl(req)}/api/auth/verify-email`,
  );
  verifyUrl.searchParams.set("token", token);

  const next = safeVerificationNextPath(options.next);
  if (next) verifyUrl.searchParams.set("next", next);

  return verifyUrl.toString();
}

export async function sendEmailVerificationIfNeeded(
  user: User,
  req: Request,
  options: { next?: unknown } = {},
): Promise<SendVerificationResult> {
  if (!user.email) {
    return { sent: false, skippedReason: "missing_email" };
  }
  if (user.emailVerified) {
    return { sent: false, skippedReason: "already_verified" };
  }
  if (!isEmailConfigured()) {
    return { sent: false, skippedReason: "provider_not_configured" };
  }

  const verifyUrl = await createEmailVerificationUrl(user, req, options);
  if (!verifyUrl) return { sent: false, skippedReason: "missing_email" };

  const ok = await emailService.sendEmailVerificationEmail(user, verifyUrl);
  return ok ? { sent: true } : { sent: false, skippedReason: "send_failed" };
}
