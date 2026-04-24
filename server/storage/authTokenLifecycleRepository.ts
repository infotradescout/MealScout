import {
  passwordResetTokens,
  phoneVerificationTokens,
  accountSetupTokens,
  emailVerificationTokens,
  type PasswordResetToken,
  type InsertPasswordResetToken,
  type PhoneVerificationToken,
  type InsertPhoneVerificationToken,
  type AccountSetupToken,
  type InsertAccountSetupToken,
  type EmailVerificationToken,
  type InsertEmailVerificationToken,
} from "@shared/schema";
import { db } from "../db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";

export function createAuthTokenLifecycleRepository() {
  return {
    async createPasswordResetToken(
      tokenData: InsertPasswordResetToken,
    ): Promise<PasswordResetToken> {
      const [token] = await db
        .insert(passwordResetTokens)
        .values(tokenData)
        .returning();
      return token;
    },

    async getPasswordResetToken(
      id: string,
    ): Promise<PasswordResetToken | undefined> {
      const [token] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, id));
      return token;
    },

    async getPasswordResetTokenByTokenHash(
      tokenHash: string,
    ): Promise<PasswordResetToken | undefined> {
      const [token] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            gte(passwordResetTokens.expiresAt, new Date()),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      return token;
    },

    async markPasswordResetTokenUsed(id: string): Promise<PasswordResetToken> {
      const [token] = await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, id))
        .returning();
      return token;
    },

    async deleteUserResetTokens(userId: string): Promise<void> {
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId));
    },

    async deleteExpiredResetTokens(): Promise<number> {
      const result = await db
        .delete(passwordResetTokens)
        .where(lte(passwordResetTokens.expiresAt, new Date()));
      return result.rowCount || 0;
    },

    async createPhoneVerificationToken(
      tokenData: InsertPhoneVerificationToken,
    ): Promise<PhoneVerificationToken> {
      const [token] = await db
        .insert(phoneVerificationTokens)
        .values(tokenData)
        .returning();
      return token;
    },

    async getPhoneVerificationTokenByHash(
      phone: string,
      tokenHash: string,
    ): Promise<PhoneVerificationToken | undefined> {
      const [token] = await db
        .select()
        .from(phoneVerificationTokens)
        .where(
          and(
            eq(phoneVerificationTokens.phone, phone),
            eq(phoneVerificationTokens.tokenHash, tokenHash),
            gte(phoneVerificationTokens.expiresAt, new Date()),
            isNull(phoneVerificationTokens.usedAt),
          ),
        );
      return token;
    },

    async markPhoneVerificationTokenUsed(
      id: string,
    ): Promise<PhoneVerificationToken> {
      const [token] = await db
        .update(phoneVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(phoneVerificationTokens.id, id))
        .returning();
      return token;
    },

    async deletePhoneVerificationTokens(phone: string): Promise<void> {
      await db
        .delete(phoneVerificationTokens)
        .where(eq(phoneVerificationTokens.phone, phone));
    },

    async deleteExpiredPhoneVerificationTokens(): Promise<number> {
      const result = await db
        .delete(phoneVerificationTokens)
        .where(lte(phoneVerificationTokens.expiresAt, new Date()));
      return result.rowCount || 0;
    },

    async createAccountSetupToken(
      tokenData: InsertAccountSetupToken,
    ): Promise<AccountSetupToken> {
      const [token] = await db
        .insert(accountSetupTokens)
        .values(tokenData)
        .returning();
      return token;
    },

    async getAccountSetupToken(
      id: string,
    ): Promise<AccountSetupToken | undefined> {
      const [token] = await db
        .select()
        .from(accountSetupTokens)
        .where(eq(accountSetupTokens.id, id));
      return token;
    },

    async getAccountSetupTokenByTokenHash(
      tokenHash: string,
    ): Promise<AccountSetupToken | undefined> {
      const [token] = await db
        .select()
        .from(accountSetupTokens)
        .where(
          and(
            eq(accountSetupTokens.tokenHash, tokenHash),
            gte(accountSetupTokens.expiresAt, new Date()),
            isNull(accountSetupTokens.usedAt),
          ),
        );
      return token;
    },

    async markAccountSetupTokenUsed(id: string): Promise<AccountSetupToken> {
      const [token] = await db
        .update(accountSetupTokens)
        .set({ usedAt: new Date() })
        .where(eq(accountSetupTokens.id, id))
        .returning();
      return token;
    },

    async deleteUserSetupTokens(userId: string): Promise<void> {
      await db
        .delete(accountSetupTokens)
        .where(eq(accountSetupTokens.userId, userId));
    },

    async deleteExpiredSetupTokens(): Promise<number> {
      const result = await db
        .delete(accountSetupTokens)
        .where(lte(accountSetupTokens.expiresAt, new Date()));
      return result.rowCount || 0;
    },

    async createEmailVerificationToken(
      tokenData: InsertEmailVerificationToken,
    ): Promise<EmailVerificationToken> {
      const [token] = await db
        .insert(emailVerificationTokens)
        .values(tokenData)
        .returning();
      return token;
    },

    async getEmailVerificationTokenByTokenHash(
      tokenHash: string,
    ): Promise<EmailVerificationToken | undefined> {
      const [token] = await db
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, tokenHash),
            gte(emailVerificationTokens.expiresAt, new Date()),
            isNull(emailVerificationTokens.usedAt),
          ),
        );
      return token;
    },

    async markEmailVerificationTokenUsed(
      id: string,
    ): Promise<EmailVerificationToken> {
      const [token] = await db
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, id))
        .returning();
      return token;
    },
  };
}