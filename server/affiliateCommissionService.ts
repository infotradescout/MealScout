import { db } from "./db";
import { affiliateCommissionLedger, users } from "@shared/schema";
import { getDefaultAffiliatePercent } from "@shared/affiliatePolicy";
import { and, eq, inArray } from "drizzle-orm";

type CommissionSource =
  | "subscription_payment"
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

  const affiliateIds = [owner.affiliateCloserUserId, owner.affiliateBookerUserId]
    .filter((id): id is string => Boolean(id));
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
    .filter((row) => row.userType !== "admin" && row.userType !== "super_admin")
    .map((row) => ({
      affiliateUserId: row.id,
      percent: Math.max(
        Number(
          percentOverride.get(row.id) ??
            row.affiliatePercent ??
            getDefaultAffiliatePercent(row.userType),
        ),
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

  const existing = await db
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

  const [commission] = await db
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

  try {
    const { createCreditFromCommission } = await import("./creditService");
    await createCreditFromCommission(
      affiliateUserId,
      commission.id,
      amount,
    );
  } catch (error) {
    console.error("[affiliate] Failed to create credit:", error);
  }

  return commission;
}

export async function createAffiliateCommissionsForSubscription(
  userId: string,
  invoiceTotalCents: number,
  invoiceId: string,
) {
  const recipients = await getAffiliateRecipientsForUser(userId);
  if (recipients.length === 0) return [];

  const results = [];
  for (const recipient of recipients) {
    const commission = await createCommissionEntry(
      recipient.affiliateUserId,
      invoiceTotalCents,
      recipient.percent,
      "subscription_payment",
      invoiceId,
    );
    if (commission) results.push(commission);
  }

  return results;
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
