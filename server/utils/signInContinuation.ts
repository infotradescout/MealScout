import type { Request } from "express";
import type { User } from "@shared/schema";

import { normalizeSafeInternalPath } from "@shared/safeInternalPath";
import { emailService } from "../emailService";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function buildSignInContinuationUrl(input: {
  req: Request;
  continuationPath: unknown;
}): string | null {
  const safeContinuation = normalizeSafeInternalPath(input.continuationPath);
  if (!safeContinuation) return null;

  const inferredBaseUrl = input.req.get("host")
    ? `${input.req.protocol}://${input.req.get("host")}`
    : "http://localhost:5000";
  const baseUrl = (process.env.PUBLIC_BASE_URL || inferredBaseUrl).replace(
    /\/+$/,
    "",
  );
  return `${baseUrl}/login?redirect=${encodeURIComponent(safeContinuation)}`;
}

export async function sendSignInContinuationEmail(
  user: User,
  req: Request,
  continuationPath: string,
): Promise<boolean> {
  if (!user.email) return false;
  const signInUrl = buildSignInContinuationUrl({ req, continuationPath });
  if (!signInUrl) return false;
  const safeUrl = escapeHtml(signInUrl);

  return emailService.sendBasicEmail(
    user.email,
    "Continue your food truck claim on MealScout",
    `<p>Your MealScout account is ready. Sign in to continue the food truck claim you selected.</p><p><a href="${safeUrl}">Sign in and continue</a></p><p>${safeUrl}</p>`,
    `Sign in to continue your food truck claim: ${signInUrl}`,
    "account",
  );
}
