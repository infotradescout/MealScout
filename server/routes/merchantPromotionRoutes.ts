import type { Express } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated } from "../unifiedAuth";
import { storage } from "../storage";
import {
  merchantPromotionPartners,
  merchantPromotionPolicies,
  promotedOrderCommissions,
  promotionAttributions,
  restaurants,
} from "@shared/schema";
import { createPromotionAttribution } from "../services/merchantPromotionService";

async function assertPromotionAccess(req: any, restaurantId: string) {
  const type = String(req.user?.userType || "");
  if (["admin", "super_admin", "staff"].includes(type)) return;
  if (
    !(await storage.verifyRestaurantOwnership(
      restaurantId,
      req.user.id,
      "manageProfile",
    ))
  ) {
    throw Object.assign(new Error("Not authorized to manage this business"), {
      statusCode: 403,
    });
  }
}

export function registerMerchantPromotionRoutes(app: Express) {
  app.post("/api/public/promotion-attributions", async (req: any, res) => {
    const input = z
      .object({
        sourceRestaurantId: z.string().min(1),
        targetRestaurantId: z.string().min(1),
      })
      .parse(req.body);
    const token = await createPromotionAttribution({
      ...input,
      sessionId: req.sessionID || null,
    });
    return token
      ? res.status(201).json({ token })
      : res.status(409).json({ message: "Promotion is not eligible" });
  });

  app.get(
    "/api/restaurants/:restaurantId/promotion-controls",
    isAuthenticated,
    async (req: any, res) => {
      const { restaurantId } = req.params;
      await assertPromotionAccess(req, restaurantId);
      const [policy, partners, inboundPartners, source] = await Promise.all([
        db
          .select()
          .from(merchantPromotionPolicies)
          .where(eq(merchantPromotionPolicies.restaurantId, restaurantId))
          .limit(1),
        db
          .select({
            targetRestaurantId: merchantPromotionPartners.targetRestaurantId,
            status: merchantPromotionPartners.status,
            commissionBps: merchantPromotionPartners.commissionBps,
            targetApprovedAt: merchantPromotionPartners.targetApprovedAt,
            targetName: restaurants.name,
          })
          .from(merchantPromotionPartners)
          .innerJoin(
            restaurants,
            eq(restaurants.id, merchantPromotionPartners.targetRestaurantId),
          )
          .where(
            eq(merchantPromotionPartners.sourceRestaurantId, restaurantId),
          ),
        db
          .select({
            sourceRestaurantId: merchantPromotionPartners.sourceRestaurantId,
            sourceName: restaurants.name,
            status: merchantPromotionPartners.status,
            commissionBps: merchantPromotionPartners.commissionBps,
            targetApprovedAt: merchantPromotionPartners.targetApprovedAt,
          })
          .from(merchantPromotionPartners)
          .innerJoin(
            restaurants,
            eq(restaurants.id, merchantPromotionPartners.sourceRestaurantId),
          )
          .where(
            and(
              eq(merchantPromotionPartners.targetRestaurantId, restaurantId),
              eq(merchantPromotionPartners.status, "approved"),
            ),
          ),
        db
          .select({ city: restaurants.city, state: restaurants.state })
          .from(restaurants)
          .where(eq(restaurants.id, restaurantId))
          .limit(1),
      ]);
      const market = source[0];
      const candidates = market?.city
        ? await db
            .select({
              id: restaurants.id,
              name: restaurants.name,
              businessType: restaurants.businessType,
            })
            .from(restaurants)
            .where(
              and(
                eq(restaurants.isActive, true),
                sql`${restaurants.id} <> ${restaurantId}`,
                sql`lower(trim(${restaurants.city})) = lower(trim(${market.city}))`,
                market.state
                  ? sql`lower(trim(${restaurants.state})) = lower(trim(${market.state}))`
                  : sql`true`,
              ),
            )
            .limit(100)
        : [];
      res.json({
        policy: policy[0] || {
          restaurantId,
          enabled: true,
          approvalMode: "automatic",
        },
        partners,
        inboundPartners,
        candidates,
      });
    },
  );

  app.patch(
    "/api/restaurants/:restaurantId/promotion-controls",
    isAuthenticated,
    async (req: any, res) => {
      const { restaurantId } = req.params;
      await assertPromotionAccess(req, restaurantId);
      const input = z
        .object({
          enabled: z.boolean(),
          approvalMode: z.enum(["automatic", "approved_only"]),
          partners: z
            .array(
              z.object({
                targetRestaurantId: z.string().min(1),
                status: z.enum(["approved", "excluded"]),
              }),
            )
            .max(250),
          inboundTerms: z
            .array(
              z.object({
                sourceRestaurantId: z.string().min(1),
                commissionBps: z.number().int().min(0).max(10000),
                approved: z.boolean(),
              }),
            )
            .max(250)
            .default([]),
        })
        .parse(req.body);
      await db.transaction(async (tx: any) => {
        await tx
          .insert(merchantPromotionPolicies)
          .values({
            restaurantId,
            enabled: input.enabled,
            approvalMode: input.approvalMode,
            updatedByUserId: req.user.id,
          })
          .onConflictDoUpdate({
            target: merchantPromotionPolicies.restaurantId,
            set: {
              enabled: input.enabled,
              approvalMode: input.approvalMode,
              updatedByUserId: req.user.id,
              updatedAt: new Date(),
            },
          });
        for (const partner of input.partners) {
          await tx
            .insert(merchantPromotionPartners)
            .values({
              sourceRestaurantId: restaurantId,
              targetRestaurantId: partner.targetRestaurantId,
              status: partner.status,
              updatedByUserId: req.user.id,
            })
            .onConflictDoUpdate({
              target: [
                merchantPromotionPartners.sourceRestaurantId,
                merchantPromotionPartners.targetRestaurantId,
              ],
              set: {
                status: partner.status,
                updatedByUserId: req.user.id,
                updatedAt: new Date(),
              },
            });
        }
        for (const terms of input.inboundTerms) {
          await tx
            .update(merchantPromotionPartners)
            .set({
              commissionBps: terms.approved ? terms.commissionBps : 0,
              targetApprovedAt: terms.approved ? new Date() : null,
              updatedByUserId: req.user.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(
                  merchantPromotionPartners.sourceRestaurantId,
                  terms.sourceRestaurantId,
                ),
                eq(
                  merchantPromotionPartners.targetRestaurantId,
                  restaurantId,
                ),
                eq(merchantPromotionPartners.status, "approved"),
              ),
            );
        }
      });
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/restaurants/:restaurantId/promotion-report",
    isAuthenticated,
    async (req: any, res) => {
      const { restaurantId } = req.params;
      await assertPromotionAccess(req, restaurantId);
      const days = String(req.query.window) === "7d" ? 7 : 30;
      const since = new Date(Date.now() - days * 86_400_000);
      const [[funnel], [commissions]] = await Promise.all([
        db
          .select({
            clicks: sql<number>`count(*)`.mapWith(Number),
            orders:
              sql<number>`count(${promotionAttributions.convertedAt})`.mapWith(
                Number,
              ),
          })
          .from(promotionAttributions)
          .where(
            and(
              eq(promotionAttributions.sourceRestaurantId, restaurantId),
              gte(promotionAttributions.clickedAt, since),
            ),
          ),
        db
          .select({
            eligibleOrders: sql<number>`count(*) filter (where ${promotedOrderCommissions.status} in ('eligible', 'paid'))`.mapWith(
              Number,
            ),
            earnedCents: sql<number>`coalesce(sum(${promotedOrderCommissions.amountCents}) filter (where ${promotedOrderCommissions.status} in ('eligible', 'paid')), 0)`.mapWith(
              Number,
            ),
            reversedCents: sql<number>`coalesce(sum(${promotedOrderCommissions.amountCents}) filter (where ${promotedOrderCommissions.status} = 'reversed'), 0)`.mapWith(
              Number,
            ),
          })
          .from(promotedOrderCommissions)
          .where(
            and(
              eq(promotedOrderCommissions.sourceRestaurantId, restaurantId),
              gte(promotedOrderCommissions.createdAt, since),
            ),
          ),
      ]);
      const clicks = Number(funnel?.clicks || 0);
      const orders = Number(funnel?.orders || 0);
      res.json({
        window: `${days}d`,
        clicks,
        attributedOrders: orders,
        conversionRate: clicks ? orders / clicks : 0,
        eligibleOrders: Number(commissions?.eligibleOrders || 0),
        earnedCents: Number(commissions?.earnedCents || 0),
        reversedCents: Number(commissions?.reversedCents || 0),
      });
    },
  );
}
