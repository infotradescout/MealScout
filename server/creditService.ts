/**
 * PHASE 4: Credit System Service
 * 
 * Manages user credits (never stores balance directly)
 * Balance is calculated from every immutable positive and negative ledger
 * entry for the user. `redeemedAt` records when a debit occurred; excluding
 * those rows would make spent credits remain available.
 */

import { db } from './db';
import { creditLedger, affiliateCommissionLedger } from '@shared/schema';
import { eq, sum, and, inArray, lt, sql } from 'drizzle-orm';

export class InsufficientCreditBalanceError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super("Insufficient credit balance");
    this.name = "InsufficientCreditBalanceError";
  }
}

export class CreditDebitReferenceConflictError extends Error {
  constructor() {
    super("Credit debit reference was already used for a different amount");
    this.name = "CreditDebitReferenceConflictError";
  }
}

type DebitCreditOptions = {
  /**
   * Use only after an external payment system has already granted the user
   * monetary value. The ledger must record that exact value even when another
   * concurrent debit consumed the last available credit first.
   */
  externalValueAlreadyCommitted?: boolean;
};

/**
 * Get user's available credit balance
 * 
 * Sums all credits and debits for a user.
 */
export async function getUserCreditBalance(userId: string): Promise<number> {
  try {
    const result = await db
      .select({ total: sum(creditLedger.amount) })
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId));

    const balance = result[0]?.total ? parseFloat(result[0].total.toString()) : 0;
    return balance;
  } catch (error) {
    console.error('[creditService] Error getting user credit balance:', error);
    throw error;
  }
}

/**
 * Add credits to a user's account
 * 
 * Called when:
 * - Commission is earned (Phase 3)
 * - Admin adjusts credits
 * - Referral bonuses
 */
export async function addCredit(
  userId: string,
  amount: number,
  sourceType: string,
  sourceId: string,
) {
  try {
    const credit = await db.insert(creditLedger).values({
      userId,
      amount: amount.toString(),
      sourceType,
      sourceId,
    }).returning();

    console.log('[Phase 4] Credit added:', {
      userId,
      amount,
      sourceType,
      sourceId,
    });

    return credit[0];
  } catch (error) {
    console.error('[creditService] Error adding credit:', error);
    throw error;
  }
}

export async function debitCredit(
  userId: string,
  amount: number,
  sourceType: string,
  sourceId: string,
  redeemedFor?: string,
  options: DebitCreditOptions = {},
) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Debit amount must be positive");
  }

  try {
    const normalizedAmount = Math.round(amount * 100) / 100;
    const requestedCents = Math.round(normalizedAmount * 100);
    if (requestedCents <= 0) {
      throw new Error("Debit amount must be at least one cent");
    }
    const credit = await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`credit_balance:${userId}`}))`,
      );

      if (sourceId) {
        const [existing] = await tx
          .select()
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.userId, userId),
              eq(creditLedger.sourceType, sourceType),
              eq(creditLedger.sourceId, sourceId),
              lt(creditLedger.amount, "0"),
            ),
          )
          .limit(1);
        if (existing) {
          const existingCents = Math.abs(
            Math.round(Number.parseFloat(existing.amount.toString()) * 100),
          );
          if (existingCents !== requestedCents) {
            throw new CreditDebitReferenceConflictError();
          }
          return existing;
        }
      }

      const [balanceRow] = await tx
        .select({ total: sum(creditLedger.amount) })
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId));
      const balance = balanceRow?.total
        ? Number.parseFloat(balanceRow.total.toString())
        : 0;
      const availableCents = Math.round(balance * 100);
      if (
        !options.externalValueAlreadyCommitted &&
        availableCents < requestedCents
      ) {
        throw new InsufficientCreditBalanceError(
          availableCents / 100,
          requestedCents / 100,
        );
      }

      const [created] = await tx
        .insert(creditLedger)
        .values({
          userId,
          amount: (-normalizedAmount).toFixed(2),
          sourceType,
          sourceId,
          redeemedAt: new Date(),
          redeemedFor: redeemedFor || null,
        })
        .returning();
      return created;
    });

    console.log("[Phase 4] Credit debited:", {
      userId,
      amount: normalizedAmount,
      sourceType,
      sourceId,
      redeemedFor,
    });

    return credit;
  } catch (error) {
    console.error("[creditService] Error debiting credit:", error);
    throw error;
  }
}

/**
 * Mark credits as redeemed
 * 
 * Called when user redeems credits for:
 * - Cash payout
 * - Store credit with restaurant
 * - Donations etc
 */
export async function redeemCredits(
  creditIds: string[],
  redeemedFor: string,
) {
  try {
    const updated = await db
      .update(creditLedger)
      .set({
        redeemedAt: new Date(),
        redeemedFor,
      })
      .where(creditIds.length === 1 ? eq(creditLedger.id, creditIds[0]) : inArray(creditLedger.id, creditIds))
      .returning();

    console.log('[Phase 4] Credits redeemed:', {
      count: updated.length,
      redeemedFor,
    });

    return updated;
  } catch (error) {
    console.error('[creditService] Error redeeming credits:', error);
    throw error;
  }
}

/**
 * Get credit history for a user
 */
export async function getUserCreditHistory(userId: string, limit: number = 50) {
  try {
    const history = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(creditLedger.createdAt)
      .limit(limit);

    return history;
  } catch (error) {
    console.error('[creditService] Error getting credit history:', error);
    throw error;
  }
}

/**
 * PHASE 3 + 4 Integration: Create credit entry from commission
 * 
 * When a commission is earned, automatically create a credit entry
 */
export async function createCreditFromCommission(
  affiliateUserId: string,
  commissionId: string,
  amount: number,
) {
  try {
    return await addCredit(
      affiliateUserId,
      amount,
      'commission',
      commissionId,
    );
  } catch (error) {
    console.error('[creditService] Error creating credit from commission:', error);
    throw error;
  }
}

/**
 * Calculate and apply all pending commissions as credits
 * 
 * Called periodically (e.g., daily or on-demand)
 */
export async function processPendingCommissionsToCredits() {
  try {
    // Get all non-redeemed commissions from affiliate_commission_ledger
    const pendingCommissions = await db.select().from(affiliateCommissionLedger);

    let processed = 0;
    for (const commission of pendingCommissions) {
      // Check if credit already exists for this commission
      const existingCredit = (await db
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.sourceType, 'commission'), eq(creditLedger.sourceId, commission.id)))
        .limit(1))[0];

      if (!existingCredit) {
        await createCreditFromCommission(
          commission.affiliateUserId,
          commission.id,
          parseFloat(commission.amount.toString()),
        );
        processed++;
      }
    }

    console.log('[creditService] Processed pending commissions to credits:', {
      processed,
    });

    return processed;
  } catch (error) {
    console.error('[creditService] Error processing pending commissions:', error);
    throw error;
  }
}

export default {
  getUserCreditBalance,
  addCredit,
  debitCredit,
  redeemCredits,
  getUserCreditHistory,
  createCreditFromCommission,
  processPendingCommissionsToCredits,
};
