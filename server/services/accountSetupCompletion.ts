import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { accountSetupTokens, users, type User } from "@shared/schema";
import { db } from "../db";

export const ACCOUNT_SETUP_ALREADY_COMPLETED_CODE =
  "account_setup_already_completed";

export class AccountSetupAlreadyCompletedError extends Error {
  readonly statusCode = 409;
  readonly code = ACCOUNT_SETUP_ALREADY_COMPLETED_CODE;

  constructor() {
    super("This account setup link is no longer available.");
    this.name = "AccountSetupAlreadyCompletedError";
  }
}

type CompleteAccountSetupInput = {
  tokenHash: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string;
  now?: Date;
};

const setupTokenIsActive = (tokenHash: string, now: Date) =>
  and(
    eq(accountSetupTokens.tokenHash, tokenHash),
    gte(accountSetupTokens.expiresAt, now),
    isNull(accountSetupTokens.usedAt),
  );

/**
 * Completes one invited account exactly once. The token lookup that discovers
 * the user is deliberately non-locking; every competing token for that user
 * then takes the user-row lock before revalidating its own token. This gives
 * all tokens one lock order and keeps losing requests from overwriting fields.
 */
export async function completeAccountSetupTransaction(
  input: CompleteAccountSetupInput,
): Promise<User> {
  const discoveryTime = input.now || new Date();

  return db.transaction(async (tx: any) => {
    const [candidateToken] = await tx
      .select({ userId: accountSetupTokens.userId })
      .from(accountSetupTokens)
      .where(setupTokenIsActive(input.tokenHash, discoveryTime))
      .limit(1);

    if (!candidateToken?.userId) {
      throw new AccountSetupAlreadyCompletedError();
    }

    // Different setup tokens for the same account must acquire this row first.
    await tx.execute(
      sql`select ${users.id} from ${users} where ${users.id} = ${candidateToken.userId} for update`,
    );

    const revalidationTime = input.now || new Date();
    const [lockedUser] = await tx
      .select()
      .from(users)
      .where(eq(users.id, candidateToken.userId))
      .limit(1);
    const [revalidatedToken] = await tx
      .select({ id: accountSetupTokens.id })
      .from(accountSetupTokens)
      .where(
        and(
          setupTokenIsActive(input.tokenHash, revalidationTime),
          eq(accountSetupTokens.userId, candidateToken.userId),
        ),
      )
      .limit(1);

    if (!lockedUser || lockedUser.passwordHash || !revalidatedToken) {
      throw new AccountSetupAlreadyCompletedError();
    }

    const [updatedUser] = await tx
      .update(users)
      .set({
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        emailVerified: true,
        updatedAt: revalidationTime,
      })
      .where(
        and(
          eq(users.id, candidateToken.userId),
          isNull(users.passwordHash),
        ),
      )
      .returning();

    if (!updatedUser) {
      throw new AccountSetupAlreadyCompletedError();
    }

    // Only the compare-and-set winner reaches this deletion. All previously
    // delivered setup links become unusable together after successful setup.
    await tx
      .delete(accountSetupTokens)
      .where(eq(accountSetupTokens.userId, candidateToken.userId));

    return updatedUser as User;
  });
}
