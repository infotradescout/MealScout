import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  merchantPromotionPartners,
  merchantPromotionPolicies,
  promotedOrderCommissions,
  promotionAttributions,
  restaurants,
  users,
} from "@shared/schema";
import {
  PROMOTION_ATTRIBUTION_TTL_MS,
  calculatePromotedOrderCommissionCents,
  isAttributionUsable,
  promotionCandidateAllowed,
} from "@shared/merchantPromotion";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createPromotionAttribution(input: {
  sourceRestaurantId: string;
  targetRestaurantId: string;
  sessionId?: string | null;
}) {
  if (input.sourceRestaurantId === input.targetRestaurantId) return null;
  const [source, policy, partner] = await Promise.all([
    db
      .select({
        id: restaurants.id,
        ownerId: restaurants.ownerId,
        affiliateTag: users.affiliateTag,
      })
      .from(restaurants)
      .leftJoin(users, eq(users.id, restaurants.ownerId))
      .where(
        and(
          eq(restaurants.id, input.sourceRestaurantId),
          eq(restaurants.isActive, true),
        ),
      )
      .limit(1),
    db
      .select()
      .from(merchantPromotionPolicies)
      .where(
        eq(merchantPromotionPolicies.restaurantId, input.sourceRestaurantId),
      )
      .limit(1),
    db
      .select()
      .from(merchantPromotionPartners)
      .where(
        and(
          eq(
            merchantPromotionPartners.sourceRestaurantId,
            input.sourceRestaurantId,
          ),
          eq(
            merchantPromotionPartners.targetRestaurantId,
            input.targetRestaurantId,
          ),
        ),
      )
      .limit(1),
  ]);
  const sourceRow = source[0];
  const policyRow = policy[0];
  const partnerRow = partner[0];
  if (
    !sourceRow ||
    !promotionCandidateAllowed({
      enabled: policyRow?.enabled !== false,
      approvalMode:
        policyRow?.approvalMode === "approved_only"
          ? "approved_only"
          : "automatic",
      partnerStatus:
        partnerRow?.status === "approved" || partnerRow?.status === "excluded"
          ? partnerRow.status
          : null,
    })
  ) {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  await db.insert(promotionAttributions).values({
    tokenHash: hashToken(token),
    sourceRestaurantId: input.sourceRestaurantId,
    targetRestaurantId: input.targetRestaurantId,
    affiliateUserId:
      sourceRow.ownerId && String(sourceRow.affiliateTag || "").trim()
        ? sourceRow.ownerId
        : null,
    sessionId: input.sessionId || null,
    expiresAt: new Date(Date.now() + PROMOTION_ATTRIBUTION_TTL_MS),
  });
  return token;
}

export async function consumePromotionAttribution(input: {
  token: string;
  orderId: string;
  targetRestaurantId: string;
  customerUserId?: string | null;
  eligibleOrderCents: number;
  commissionEligible: boolean;
}) {
  if (!input.token) return null;
  return db.transaction(async (tx: any) => {
    const [attribution] = await tx
      .select()
      .from(promotionAttributions)
      .where(
        and(
          eq(promotionAttributions.tokenHash, hashToken(input.token)),
          isNull(promotionAttributions.convertedAt),
          gt(promotionAttributions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (
      !attribution ||
      !isAttributionUsable({
        ...attribution,
        expectedTargetRestaurantId: input.targetRestaurantId,
      })
    ) {
      return null;
    }

    const [partner] = await tx
      .select()
      .from(merchantPromotionPartners)
      .where(
        and(
          eq(
            merchantPromotionPartners.sourceRestaurantId,
            attribution.sourceRestaurantId,
          ),
          eq(
            merchantPromotionPartners.targetRestaurantId,
            attribution.targetRestaurantId,
          ),
          eq(merchantPromotionPartners.status, "approved"),
        ),
      )
      .limit(1);

    const [converted] = await tx
      .update(promotionAttributions)
      .set({
        orderId: input.orderId,
        customerUserId: input.customerUserId || null,
        convertedAt: new Date(),
      })
      .where(
        and(
          eq(promotionAttributions.id, attribution.id),
          isNull(promotionAttributions.convertedAt),
        ),
      )
      .returning();
    if (!converted) return null;

    const commissionBps =
      input.commissionEligible &&
      partner?.targetApprovedAt &&
      attribution.affiliateUserId
        ? Math.max(0, Number(partner.commissionBps || 0))
        : 0;
    const amountCents = calculatePromotedOrderCommissionCents(
      input.eligibleOrderCents,
      commissionBps,
    );
    if (commissionBps > 0 && amountCents > 0 && attribution.affiliateUserId) {
      await tx.insert(promotedOrderCommissions).values({
        orderId: input.orderId,
        attributionId: attribution.id,
        sourceRestaurantId: attribution.sourceRestaurantId,
        targetRestaurantId: attribution.targetRestaurantId,
        affiliateUserId: attribution.affiliateUserId,
        commissionBps,
        eligibleOrderCents: input.eligibleOrderCents,
        amountCents,
      });
    }
    return converted;
  });
}

export async function updatePromotedOrderCommissionStatus(
  orderId: string,
  orderStatus: "completed" | "cancelled",
) {
  const now = new Date();
  await db
    .update(promotedOrderCommissions)
    .set(
      orderStatus === "completed"
        ? { status: "eligible", eligibleAt: now, updatedAt: now }
        : {
            status: "reversed",
            reversedAt: now,
            reversalReason: "order_cancelled",
            updatedAt: now,
          },
    )
    .where(
      and(
        eq(promotedOrderCommissions.orderId, orderId),
        eq(promotedOrderCommissions.status, "pending"),
      ),
    );
}
