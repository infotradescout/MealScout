import type { Request } from "express";
import crypto from "crypto";
import type { User } from "@shared/schema";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { sendEmailVerificationIfNeeded } from "./emailVerification";

type InviteOptions = {
  user: User;
  createdBy?: User | null;
  req: Request;
  setupPath?: string;
};

export async function sendAccountSetupInvite({
  user,
  createdBy,
  req,
  setupPath,
}: InviteOptions): Promise<boolean> {
  const setupToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(setupToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Invalidate prior setup links before issuing a fresh invite.
  await storage.deleteUserSetupTokens(user.id);

  await storage.createAccountSetupToken({
    userId: user.id,
    tokenHash,
    expiresAt,
    createdByUserId: createdBy?.id ?? undefined,
    requestIp: req.ip || undefined,
    userAgent: req.get("User-Agent") || undefined,
  });

  const baseUrl =
    process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const normalizedSetupPath = String(setupPath || "/account-setup")
    .trim()
    .replace(/\s+/g, "");
  const safeSetupPath = normalizedSetupPath.startsWith("/")
    ? normalizedSetupPath
    : `/${normalizedSetupPath}`;
  const setupUrl = `${baseUrl.replace(
    /\/+$/,
    "",
  )}${safeSetupPath}?token=${encodeURIComponent(setupToken)}`;

  const createdByName = createdBy?.firstName
    ? `${createdBy.firstName} ${createdBy.lastName || ""}`.trim()
    : undefined;

  const ok = await emailService.sendAccountSetupEmail(
    user,
    setupUrl,
    createdByName,
  );

  // Always try to deliver an email verification link for invited accounts too.
  // This is best-effort and should never block onboarding.
  sendEmailVerificationIfNeeded(user, req).catch((error) =>
    console.error("[email] Failed to send verification for invite:", error),
  );

  return ok;
}
