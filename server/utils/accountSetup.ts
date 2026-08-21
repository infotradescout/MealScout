import type { Request } from "express";
import crypto from "crypto";
import type { User } from "@shared/schema";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { buildSafeAccountSetupPath } from "@shared/safeInternalPath";

type InviteOptions = {
  user: User;
  createdBy?: User | null;
  req: Request;
  setupPath?: string;
  continuationPath?: string | null;
};

export type AccountSetupInviteResult = {
  emailSent: boolean;
  setupUrl: string;
};

export type AccountSetupInviteDependencies = {
  createAccountSetupToken: typeof storage.createAccountSetupToken;
  deleteAccountSetupToken: typeof storage.deleteAccountSetupToken;
  sendAccountSetupEmail: typeof emailService.sendAccountSetupEmail;
};

const defaultDependencies: AccountSetupInviteDependencies = {
  createAccountSetupToken: (token) => storage.createAccountSetupToken(token),
  deleteAccountSetupToken: (tokenId) =>
    storage.deleteAccountSetupToken(tokenId),
  sendAccountSetupEmail: (user, setupUrl, createdByName) =>
    emailService.sendAccountSetupEmail(user, setupUrl, createdByName),
};

export function buildAccountSetupInviteUrl(input: {
  baseUrl: string;
  setupToken: string;
  setupPath?: string | null;
  continuationPath?: string | null;
}) {
  const setupPath = buildSafeAccountSetupPath(input);
  return `${input.baseUrl.replace(/\/+$/, "")}${setupPath}`;
}

export async function sendAccountSetupInvite({
  user,
  createdBy,
  req,
  setupPath,
  continuationPath,
}: InviteOptions,
dependencies: AccountSetupInviteDependencies = defaultDependencies): Promise<AccountSetupInviteResult> {
  const setupToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(setupToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const createdToken = await dependencies.createAccountSetupToken({
    userId: user.id,
    tokenHash,
    expiresAt,
    createdByUserId: createdBy?.id ?? undefined,
    requestIp: req.ip || undefined,
    userAgent: req.get("User-Agent") || undefined,
  });

  const baseUrl =
    process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  const setupUrl = buildAccountSetupInviteUrl({
    baseUrl,
    setupToken,
    setupPath,
    continuationPath,
  });

  const createdByName = createdBy?.firstName
    ? `${createdBy.firstName} ${createdBy.lastName || ""}`.trim()
    : undefined;

  let ok = false;
  try {
    ok = await dependencies.sendAccountSetupEmail(
      user,
      setupUrl,
      createdByName,
    );
  } catch (error) {
    await dependencies.deleteAccountSetupToken(createdToken.id);
    throw error;
  }

  if (!ok) {
    await dependencies.deleteAccountSetupToken(createdToken.id);
  }

  return {
    emailSent: ok,
    setupUrl,
  };
}
