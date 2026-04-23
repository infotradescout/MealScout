import type { Express } from "express";
import { eq, and, or, sql, desc, isNull } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import {
  users,
  restaurants,
  hosts,
  eventBookings,
  affiliateShareEvents,
  affiliateCommissionLedger,
  affiliateWithdrawals,
  creditLedger,
} from "@shared/schema";
import { setAffiliateTag } from "../../affiliateTagService";

type RequireAdminUser = (req: any, res: any) => boolean;

export function registerAffiliateAdminRoutes(
  app: Express,
  deps: {
    requireAdminUser: RequireAdminUser;
  },
) {
  const { requireAdminUser } = deps;

  app.get(
    "/api/admin/affiliates/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const allUsers = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            userType: users.userType,
            affiliateTag: users.affiliateTag,
            affiliatePercent: users.affiliatePercent,
            affiliateCloserUserId: users.affiliateCloserUserId,
            affiliateBookerUserId: users.affiliateBookerUserId,
            stripeSubscriptionId: users.stripeSubscriptionId,
          })
          .from(users)
          .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)))
          .orderBy(users.createdAt);

        const shareCounts = await db
          .select({
            affiliateUserId: affiliateShareEvents.affiliateUserId,
            count: sql<number>`count(*)`,
          })
          .from(affiliateShareEvents)
          .groupBy(affiliateShareEvents.affiliateUserId);

        type ShareCountRow = {
          affiliateUserId: string | null;
          count: number | string | null;
        };
        const shareCountMap = new Map(
          (shareCounts as ShareCountRow[]).map((row) => [
            row.affiliateUserId,
            Number(row.count ?? 0),
          ]),
        );

        const commissionSums = await db
          .select({
            affiliateUserId: affiliateCommissionLedger.affiliateUserId,
            earnedCents: sql<number>`coalesce(sum(${affiliateCommissionLedger.amount}), 0)`,
            revenueCents: sql<number>`coalesce(sum(${affiliateCommissionLedger.sourceAmountCents}), 0)`,
            subscriptionRevenueCents: sql<number>`coalesce(sum(case when ${affiliateCommissionLedger.commissionSource} = 'subscription_payment' then ${affiliateCommissionLedger.sourceAmountCents} else 0 end), 0)`,
            bookingRevenueCents: sql<number>`coalesce(sum(case when ${affiliateCommissionLedger.commissionSource} in ('booking_fee_host', 'booking_fee_truck') then ${affiliateCommissionLedger.sourceAmountCents} else 0 end), 0)`,
          })
          .from(affiliateCommissionLedger)
          .groupBy(affiliateCommissionLedger.affiliateUserId);

        type CommissionSumRow = {
          affiliateUserId: string | null;
          earnedCents: number | string | null;
          revenueCents: number | string | null;
          subscriptionRevenueCents: number | string | null;
          bookingRevenueCents: number | string | null;
        };
        const commissionMap = new Map(
          (commissionSums as CommissionSumRow[]).map((row) => [
            row.affiliateUserId,
            row,
          ]),
        );

        const referralRows = await db
          .select({
            id: users.id,
            affiliateCloserUserId: users.affiliateCloserUserId,
            affiliateBookerUserId: users.affiliateBookerUserId,
            stripeSubscriptionId: users.stripeSubscriptionId,
          })
          .from(users)
          .where(
            and(
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              or(
                sql`${users.affiliateCloserUserId} is not null`,
                sql`${users.affiliateBookerUserId} is not null`,
              ),
            ),
          );

        const truckOwnerRows = await db
          .select({ ownerId: restaurants.ownerId })
          .from(eventBookings)
          .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id));

        const hostOwnerRows = await db
          .select({ ownerId: hosts.userId })
          .from(eventBookings)
          .innerJoin(hosts, eq(eventBookings.hostId, hosts.id));

        const bookingOwnerIds = new Set<string>();
        for (const row of truckOwnerRows) {
          if (row.ownerId) bookingOwnerIds.add(row.ownerId);
        }
        for (const row of hostOwnerRows) {
          if (row.ownerId) bookingOwnerIds.add(row.ownerId);
        }

        const referredMap = new Map<string, Set<string>>();
        const paidMap = new Map<string, Set<string>>();
        for (const row of referralRows) {
          const referrerIds = [
            row.affiliateCloserUserId,
            row.affiliateBookerUserId,
          ].filter((value): value is string => Boolean(value));
          if (referrerIds.length === 0) continue;

          for (const referrerId of referrerIds) {
            if (!referredMap.has(referrerId)) {
              referredMap.set(referrerId, new Set());
            }
            referredMap.get(referrerId)?.add(row.id);

            const isPaid =
              Boolean(row.stripeSubscriptionId) || bookingOwnerIds.has(row.id);
            if (isPaid) {
              if (!paidMap.has(referrerId)) {
                paidMap.set(referrerId, new Set());
              }
              paidMap.get(referrerId)?.add(row.id);
            }
          }
        }

        const payload = allUsers.map((user: (typeof allUsers)[number]) => {
          const commissions = commissionMap.get(user.id as string);
          const referred = referredMap.get(user.id);
          const paid = paidMap.get(user.id);

          return {
            ...user,
            linksShared: shareCountMap.get(user.id) ?? 0,
            peopleReferred: referred?.size ?? 0,
            paidReferrals: paid?.size ?? 0,
            affiliateEarningsCents: Number(commissions?.earnedCents ?? 0),
            mealScoutRevenueCents: Number(commissions?.revenueCents ?? 0),
            subscriptionRevenueCents: Number(
              commissions?.subscriptionRevenueCents ?? 0,
            ),
            bookingRevenueCents: Number(commissions?.bookingRevenueCents ?? 0),
          };
        });

        res.json(payload);
      } catch (error: any) {
        console.error("Error fetching affiliate users:", error);
        res.status(500).json({ message: "Failed to fetch affiliate users" });
      }
    },
  );

  app.patch(
    "/api/admin/affiliates/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const targetUserId = req.params.id;
        const {
          affiliatePercent,
          affiliateTag,
          affiliateCloserUserId,
          affiliateBookerUserId,
        } = req.body || {};

        const updates: any = {};
        if (affiliatePercent !== undefined) {
          const parsed = Number(affiliatePercent);
          if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
            return res
              .status(400)
              .json({ message: "affiliatePercent must be 0-100" });
          }
          updates.affiliatePercent = parsed;
        }

        if (affiliateCloserUserId !== undefined) {
          const closerId =
            affiliateCloserUserId === null || affiliateCloserUserId === ""
              ? null
              : String(affiliateCloserUserId);
          updates.affiliateCloserUserId = closerId;
        }

        if (affiliateBookerUserId !== undefined) {
          const bookerId =
            affiliateBookerUserId === null || affiliateBookerUserId === ""
              ? null
              : String(affiliateBookerUserId);
          updates.affiliateBookerUserId = bookerId;
        }

        if (affiliateTag !== undefined) {
          const rawTag = String(affiliateTag || "").trim();
          if (!rawTag) {
            updates.affiliateTag = null;
          } else {
            try {
              await setAffiliateTag(targetUserId, rawTag);
            } catch (error: any) {
              const message = String(error?.message || "Invalid affiliate tag");
              if (message.toLowerCase().includes("already taken")) {
                return res.status(409).json({ message });
              }
              return res.status(400).json({ message });
            }
          }
        }

        if (Object.keys(updates).length === 0) {
          return res
            .status(400)
            .json({ message: "No affiliate fields to update" });
        }

        updates.updatedAt = new Date();

        const [updated] = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, targetUserId))
          .returning();

        if (!updated) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({
          id: updated.id,
          affiliateTag: updated.affiliateTag,
          affiliatePercent: updated.affiliatePercent,
          affiliateCloserUserId: updated.affiliateCloserUserId,
          affiliateBookerUserId: updated.affiliateBookerUserId,
        });
      } catch (error: any) {
        console.error("Error updating affiliate settings:", error);
        res
          .status(500)
          .json({ message: "Failed to update affiliate settings" });
      }
    },
  );

  app.get(
    "/api/admin/affiliate-payouts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const status =
          typeof req.query?.status === "string" ? req.query.status : null;
        const baseQuery = db
          .select({
            id: affiliateWithdrawals.id,
            userId: affiliateWithdrawals.userId,
            amount: affiliateWithdrawals.amount,
            method: affiliateWithdrawals.method,
            status: affiliateWithdrawals.status,
            methodDetails: affiliateWithdrawals.methodDetails,
            creditLedgerId: affiliateWithdrawals.creditLedgerId,
            requestedAt: affiliateWithdrawals.requestedAt,
            processedAt: affiliateWithdrawals.processedAt,
            approvedAt: affiliateWithdrawals.approvedAt,
            approvedBy: affiliateWithdrawals.approvedBy,
            paidAt: affiliateWithdrawals.paidAt,
            rejectedAt: affiliateWithdrawals.rejectedAt,
            notes: affiliateWithdrawals.notes,
            userEmail: users.email,
            userFirstName: users.firstName,
            userLastName: users.lastName,
          })
          .from(affiliateWithdrawals)
          .innerJoin(users, eq(affiliateWithdrawals.userId, users.id));

        const rows = status
          ? await baseQuery
              .where(eq(affiliateWithdrawals.status, status))
              .orderBy(desc(affiliateWithdrawals.requestedAt))
          : await baseQuery.orderBy(desc(affiliateWithdrawals.requestedAt));

        res.json(rows);
      } catch (error: any) {
        console.error("Error fetching affiliate payouts:", error);
        res.status(500).json({ message: "Failed to fetch payout requests" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status !== "pending") {
          return res.status(409).json({ message: "Payout is not pending" });
        }

        const [updated] = await db
          .update(affiliateWithdrawals)
          .set({
            status: "approved",
            approvedAt: new Date(),
            approvedBy: req.user.id,
          })
          .where(eq(affiliateWithdrawals.id, payoutId))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error approving affiliate payout:", error);
        res.status(500).json({ message: "Failed to approve payout" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/mark-paid",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status === "paid") {
          return res
            .status(409)
            .json({ message: "Payout already marked paid" });
        }
        if (existing.status === "rejected") {
          return res.status(409).json({ message: "Payout was rejected" });
        }

        const [updated] = await db
          .update(affiliateWithdrawals)
          .set({
            status: "paid",
            paidAt: new Date(),
            processedAt: new Date(),
          })
          .where(eq(affiliateWithdrawals.id, payoutId))
          .returning();

        if (existing.creditLedgerId) {
          await db
            .update(creditLedger)
            .set({
              redeemedFor: "cash_payout",
              redeemedAt: new Date(),
            })
            .where(eq(creditLedger.id, existing.creditLedgerId));
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error marking affiliate payout paid:", error);
        res.status(500).json({ message: "Failed to mark payout paid" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate-payouts/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const payoutId = req.params.id;
        const reason =
          typeof req.body?.reason === "string" ? req.body.reason : null;
        const [existing] = await db
          .select()
          .from(affiliateWithdrawals)
          .where(eq(affiliateWithdrawals.id, payoutId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }
        if (existing.status === "paid") {
          return res.status(409).json({ message: "Payout already paid" });
        }
        if (existing.status === "rejected") {
          return res.status(409).json({ message: "Payout already rejected" });
        }

        const amountNum = parseFloat(existing.amount?.toString() || "0");

        await db.transaction(async (tx: any) => {
          await tx
            .update(affiliateWithdrawals)
            .set({
              status: "rejected",
              rejectedAt: new Date(),
              notes: reason || existing.notes,
            })
            .where(eq(affiliateWithdrawals.id, payoutId));

          const reversalExists = (
            await tx
              .select({ id: creditLedger.id })
              .from(creditLedger)
              .where(
                and(
                  eq(creditLedger.userId, existing.userId),
                  eq(creditLedger.sourceType, "cash_payout_reversal"),
                  eq(creditLedger.sourceId, payoutId),
                ),
              )
              .limit(1)
          )[0];

          if (!reversalExists && amountNum > 0) {
            await tx.insert(creditLedger).values({
              userId: existing.userId,
              amount: amountNum.toString(),
              sourceType: "cash_payout_reversal",
              sourceId: payoutId,
            });
          }

          if (existing.creditLedgerId) {
            await tx
              .update(creditLedger)
              .set({ redeemedFor: "cash_payout_rejected" })
              .where(eq(creditLedger.id, existing.creditLedgerId));
          }
        });

        res.json({ success: true });
      } catch (error: any) {
        console.error("Error rejecting affiliate payout:", error);
        res.status(500).json({ message: "Failed to reject payout" });
      }
    },
  );
}
