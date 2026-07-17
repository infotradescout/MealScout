/**
 * PHASE R1: Restaurant Credit Redemption Service
 * 
 * Handles:
 * 1. Recording credit redemptions at restaurants
 * 2. Deducting credits from user ledger
 * 3. Creating immutable redemption records
 * 4. Managing dispute windows (7-day reversal period)
 */

import { db } from './db';
import { restaurantCreditRedemptions, creditLedger, restaurants, users } from '@shared/schema';
import { desc, eq, sql, sum } from 'drizzle-orm';

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly available: number,
    public readonly requested: number,
  ) {
    super("Insufficient user credits");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Process credit redemption at a restaurant
 * 
 * Called when restaurant accepts credit payment from user
 * 
 * Creates TWO ledger entries:
 * 1. restaurantCreditRedemptions (liability for restaurant)
 * 2. creditLedger (debit from user's balance)
 */
export async function redeemCreditAtRestaurant(
  restaurantId: string,
  userId: string,
  creditAmount: number,
  orderReference?: string,
  notes?: string,
): Promise<{
  redemption: any;
  creditEntry: any;
}> {
  try {
    const normalizedCreditAmount = Math.round(creditAmount * 100) / 100;
    const { redemption, creditEntry, disputeUntilDate } = await db.transaction(
      async (tx: any) => {
        // Serialize all balance-changing work for this user. The redemption and
        // debit then commit together, so two operators cannot spend the same
        // credits concurrently or leave a redemption without its ledger entry.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`credit_balance:${userId}`}))`,
        );

        const [restaurant] = await tx
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1);
        if (!restaurant) {
          throw new Error("Restaurant not found");
        }

        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          throw new Error("User not found");
        }

        const [userCredits] = await tx
          .select({ total: sum(creditLedger.amount) })
          .from(creditLedger)
          .where(eq(creditLedger.userId, userId));
        const balance = userCredits?.total
          ? Number.parseFloat(userCredits.total.toString())
          : 0;
        const balanceInCents = Math.round(balance * 100);
        const requestedInCents = Math.round(normalizedCreditAmount * 100);
        if (balanceInCents < requestedInCents) {
          throw new InsufficientCreditsError(
            balanceInCents / 100,
            requestedInCents / 100,
          );
        }

        const disputeUntilDate = new Date();
        disputeUntilDate.setDate(disputeUntilDate.getDate() + 7);

        const [redemption] = await tx
          .insert(restaurantCreditRedemptions)
          .values({
            restaurantId,
            userId,
            creditAmount: normalizedCreditAmount.toFixed(2),
            orderReference: orderReference || undefined,
            notes: notes || undefined,
            disputeUntil: disputeUntilDate,
          })
          .returning();

        const [creditEntry] = await tx
          .insert(creditLedger)
          .values({
            userId,
            amount: (-normalizedCreditAmount).toFixed(2),
            sourceType: "redemption",
            sourceId: redemption.id,
            redeemedAt: new Date(),
            redeemedFor: "restaurant",
          })
          .returning();

        return { redemption, creditEntry, disputeUntilDate };
      },
    );

    console.log('[Phase R1] Credit redeemed at restaurant:', {
      redemptionId: redemption.id,
      restaurantId,
      userId,
      amount: normalizedCreditAmount,
      disputeUntil: disputeUntilDate,
    });

    return {
      redemption,
      creditEntry,
    };
  } catch (error) {
    console.error('[redemptionService] Error redeeming credit:', error);
    throw error;
  }
}

/**
 * Get all redemptions for a restaurant
 * 
 * Used by restaurant dashboard to show pending payments
 */
export async function getRestaurantRedemptions(
  restaurantId: string,
  status?: 'pending' | 'queued' | 'paid',
) {
  try {
    const redemptions = await db
      .select()
      .from(restaurantCreditRedemptions)
      .where(eq(restaurantCreditRedemptions.restaurantId, restaurantId));

    return status ? redemptions.filter((item: any) => item.settlementStatus === status) : redemptions;
  } catch (error) {
    console.error('[redemptionService] Error getting redemptions:', error);
    throw error;
  }
}

/**
 * Get restaurant credit summary
 * 
 * Returns pending credits, queued for settlement, and already paid
 */
export async function getRestaurantCreditSummary(restaurantId: string) {
  try {
    const redemptions = await db
      .select()
      .from(restaurantCreditRedemptions)
      .where(eq(restaurantCreditRedemptions.restaurantId, restaurantId));

    const pending = redemptions
      .filter((r: any) => r.settlementStatus === 'pending')
      .reduce((sum: number, r: any) => sum + parseFloat(r.creditAmount.toString()), 0);

    const queued = redemptions
      .filter((r: any) => r.settlementStatus === 'queued')
      .reduce((sum: number, r: any) => sum + parseFloat(r.creditAmount.toString()), 0);

    const paid = redemptions
      .filter((r: any) => r.settlementStatus === 'paid')
      .reduce((sum: number, r: any) => sum + parseFloat(r.creditAmount.toString()), 0);

    return {
      pendingCredits: pending,
      queuedForSettlement: queued,
      alreadyPaid: paid,
      totalRedemptions: pending + queued + paid,
      transactionCount: redemptions.length,
    };
  } catch (error) {
    console.error('[redemptionService] Error getting credit summary:', error);
    throw error;
  }
}

/**
 * Get redemption history with user details
 * 
 * Used for restaurant transaction history view
 */
export async function getRedemptionHistory(
  restaurantId: string,
  limit: number = 50,
  offset: number = 0,
) {
  try {
    const redemptions = await db
      .select()
      .from(restaurantCreditRedemptions)
      .where(eq(restaurantCreditRedemptions.restaurantId, restaurantId))
      .orderBy(desc(restaurantCreditRedemptions.redeemedAt))
      .limit(limit)
      .offset(offset);

    // Fetch user details for each redemption
    const withUsers = await Promise.all(
      redemptions.map(async (r: any) => {
        const user = (await db
          .select()
          .from(users)
          .where(eq(users.id, r.userId))
          .limit(1))[0];
        return {
          ...r,
          user,
        };
      }),
    );

    return withUsers;
  } catch (error) {
    console.error('[redemptionService] Error getting history:', error);
    throw error;
  }
}

export async function getRedemptionRestaurantId(
  redemptionId: string,
): Promise<string | null> {
  const [redemption] = await db
    .select({ restaurantId: restaurantCreditRedemptions.restaurantId })
    .from(restaurantCreditRedemptions)
    .where(eq(restaurantCreditRedemptions.id, redemptionId))
    .limit(1);
  return redemption?.restaurantId || null;
}

/**
 * Flag redemption for dispute (7-day window)
 * 
 * Restaurant can flag if fraudulent, duplicate, or mistaken
 */
export async function flagRedemptionForDispute(
  redemptionId: string,
  reason: string,
) {
  try {
    const redemption = (await db
      .select()
      .from(restaurantCreditRedemptions)
      .where(eq(restaurantCreditRedemptions.id, redemptionId))
      .limit(1))[0];

    if (!redemption) {
      throw new Error('Redemption not found');
    }

    // Check if still within dispute window
    if (!redemption.disputeUntil || new Date() > new Date(redemption.disputeUntil)) {
      throw new Error('Dispute window expired (7 days). Contact admin for override.');
    }

    // For MVP: just log the dispute flag
    // In full version: create dispute record and hold settlement
    console.log('[Phase R1] Redemption flagged for dispute:', {
      redemptionId,
      reason,
      restaurantId: redemption.restaurantId,
    });

    return {
      success: true,
      message: 'Dispute flagged. Admin will review within 24 hours.',
      redemptionId,
    };
  } catch (error) {
    console.error('[redemptionService] Error flagging dispute:', error);
    throw error;
  }
}

export default {
  redeemCreditAtRestaurant,
  getRestaurantRedemptions,
  getRestaurantCreditSummary,
  getRedemptionHistory,
  flagRedemptionForDispute,
  getRedemptionRestaurantId,
};
