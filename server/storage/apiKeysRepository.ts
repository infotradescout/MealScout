import { apiKeys } from "@shared/schema";
import { db } from "../db";
import { and, eq, gte, isNull, or } from "drizzle-orm";

export function createApiKeysRepository() {
  return {
    async getActiveApiKeys(): Promise<any[]> {
      const keys = await db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.isActive, true),
            or(isNull(apiKeys.expiresAt), gte(apiKeys.expiresAt, new Date())),
          ),
        );
      return keys;
    },

    async updateApiKeyLastUsed(keyId: string): Promise<void> {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyId));
    },
  };
}