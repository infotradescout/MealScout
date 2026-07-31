import { db } from "./db";
import { affiliateCommissionLedger, users } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

type CommissionSource =
  | "booking_fee_host"
  | "booking_fee_truck";

type AffiliateRecipient = {
  affiliateUserId: string;
  percent: number;
};

async function getAffiliateRecipientsForUser(
  userId: string,
): Promise<AffiliateRecipient[]> {
  const [owner] = await db
    .select({
      affiliateCloserUserId: users.affiliateCloserUserId,
      affiliateBookerUserId: users.affiliateBookerUserId,
      affiliateCloserPercent: users.affiliateCloserPercent,
      affiliateBookerPercent: users.affiliateBookerPercent,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!owner) return [];

  const affiliateIds = [
    owner.affiliateCloserUserId,
    owner.affiliateBookerUserId,
  ].filter((id): id is string => Boolean(id));
  const uniqueIds = Array.from(new Set(affiliateIds));

  if (uniqueIds.length === 0) return [];

  const affiliates = await db
    .select({
      id: users.id,
      userType: users.userType,
      affiliatePercent: users.affiliatePercent,
    })
    .from(users)
    .where(
      uniqueIds.length === 1
        ? eq(users.id, uniqueIds[0])
        : inArray(users.id, uniqueIds),
    );

  type AffiliateRow = {
    id: string;
    userType: string | null;
    affiliatePercent: number | string | null;
  };

  const typedAffiliates = affiliates as AffiliateRow[];
  const map = new Map(typedAffiliates.map((row) => [row.id, row]));

  const percentOverride = new Map<string, number>();
  if (owner.affiliateCloserUserId) {
    const p = Number(owner.affiliateCloserPercent);
    if (Number.isFinite(p) && p >= 0) {
      percentOverride.set(owner.affiliateCloserUserId, p);
    }
  }
  if (owner.affiliateBookerUserId) {
    const p = Number(owner.affiliateBookerPercent);
    if (Number.isFinite(p) && p >= 0) {
      percentOverride.set(owner.affiliateBookerUserId, p);
    }
  }

  return uniqueIds
    .map((id) => map.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter(
      (row) =>
        !["admin", "duper_admin", "super_admin"].includes(
          String(row.userType || ""),
        ),
    )
    .map((row) => ({
      affiliateUserId: row.id,
      percent: Math.max(
        Number(percentOverride.get(row.id) ?? row.affiliatePercent ?? 5),
        0,
      ),
    }))
    .filter((row) => row.percent > 0);
}

async function createCommissionEntry(
  affiliateUserId: string,
  amountCents: number,
  percent: number,
  commissionSource: CommissionSource,
  referenceId: string,
  restaurantId?: string | null,
) {
  const amount = (amountCents / 100) * (percent / 100);
  if (amount <= 0) return null;

  // The read-then-insert idempotency check below has no unique constraint
  // backing it, so two concurrent deliveries of the same Stripe event
  // (Stripe documents at-least-once delivery) could both pass the "not
  // found" check before either insert commits, producing duplicate
  // commissions and duplicate credits. Serialize on the same key the
  // idempotency check uses.
  const commission = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`affiliate_commission:${affiliateUserId}:${commissionSource}:${referenceId}`}))`,
    );

    const existing = await tx
      .select({ id: affiliateCommissionLedger.id })
      .from(affiliateCommissionLedger)
      .where(
        and(
          eq(affiliateCommissionLedger.affiliateUserId, affiliateUserId),
          eq(affiliateCommissionLedger.commissionSource, commissionSource),
          eq(affiliateCommissionLedger.stripeInvoiceId, referenceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) return null;

    const [inserted] = await tx
      .insert(affiliateCommissionLedger)
      .values({
        affiliateUserId,
        restaurantId: restaurantId || null,
        amount: amount.toString(),
        commissionPercent: percent,
        sourceAmountCents: amountCents,
        commissionSource,
        stripeInvoiceId: referenceId,
      })
      .returning();
    return inserted;
  });

  if (!commission) return null;

  try {
    const { createCreditFromCommission } = await import("./creditService");
    await createCreditFromCommission(affiliateUserId, commission.id, amount);
  } catch (error) {
    console.error("[affiliate] Failed to create credit:", error);
  }

  return commission;
}

export async function createAffiliateCommissionsForBooking({
  hostOwnerId,
  truckOwnerId,
  platformFeeCents,
  paymentIntentId,
  truckRestaurantId,
}: {
  hostOwnerId: string;
  truckOwnerId: string;
  platformFeeCents: number;
  paymentIntentId: string;
  truckRestaurantId: string;
}) {
  const results = [];

  const hostRecipients = await getAffiliateRecipientsForUser(hostOwnerId);
  for (const recipient of hostRecipients) {
    const commission = await createCommissionEntry(
      recipient.affiliateUserId,
      platformFeeCents,
      recipient.percent,
      "booking_fee_host",
      paymentIntentId,
      truckRestaurantId,
    );
    if (commission) results.push(commission);
  }

  const truckRecipients = await getAffiliateRecipientsForUser(truckOwnerId);
  for (const recipient of truckRecipients) {
    const commission = await createCommissionEntry(
      recipient.affiliateUserId,
      platformFeeCents,
      recipient.percent,
      "booking_fee_truck",
      paymentIntentId,
      truckRestaurantId,
    );
    if (commission) results.push(commission);
  }

  return results;
}
