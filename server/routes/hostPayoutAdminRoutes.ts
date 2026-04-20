import type { Express } from "express";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "../db";
import { isAdmin, isAuthenticated } from "../unifiedAuth";
import {
  hostEarningsLedger,
  hostPayoutRequests,
  hosts,
  users,
} from "@shared/schema";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const VALID_STATUSES = [
  "all",
  "pending",
  "approved",
  "paid",
  "rejected",
  "cancelled",
] as const;

const parsePayoutFilters = (req: any) => {
  const statusFilterRaw = String(req?.query?.status || "all")
    .trim()
    .toLowerCase();
  const statusFilter = VALID_STATUSES.includes(statusFilterRaw as any)
    ? statusFilterRaw
    : "all";
  const searchTerm = String(req?.query?.q || "").trim();
  const fromDateRaw = String(req?.query?.from || "").trim();
  const toDateRaw = String(req?.query?.to || "").trim();
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromDateRaw)
    ? new Date(`${fromDateRaw}T00:00:00.000Z`)
    : null;
  const toDateExclusive = /^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)
    ? new Date(new Date(`${toDateRaw}T00:00:00.000Z`).getTime() + 86400000)
    : null;

  const filters: any[] = [];
  if (statusFilter !== "all") {
    filters.push(eq(hostPayoutRequests.status, statusFilter));
  }
  if (searchTerm.length > 0) {
    const likePattern = `%${searchTerm}%`;
    filters.push(
      or(
        like(hosts.businessName, likePattern),
        like(users.email, likePattern),
        like(hosts.address, likePattern),
      ),
    );
  }
  if (fromDate) {
    filters.push(gte(hostPayoutRequests.createdAt, fromDate));
  }
  if (toDateExclusive) {
    filters.push(lt(hostPayoutRequests.createdAt, toDateExclusive));
  }

  return {
    statusFilter,
    searchTerm,
    fromDateRaw,
    toDateRaw,
    whereClause:
      filters.length > 0 ? and(...(filters as [any, ...any[]])) : undefined,
  };
};

const sanitizeCSV = (value: any): string => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+@-]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`;
  }
  return `"${str.replace(/"/g, '""')}"`;
};

export function registerHostPayoutAdminRoutes(app: Express) {
  app.get(
    "/api/admin/host-payout-requests",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const pageRaw = Number((req as any)?.query?.page ?? 1);
        const pageSizeRaw = Number((req as any)?.query?.pageSize ?? 20);
        const page = Number.isFinite(pageRaw)
          ? Math.max(1, Math.floor(pageRaw))
          : 1;
        const pageSize = Number.isFinite(pageSizeRaw)
          ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw)))
          : 20;

        const {
          statusFilter,
          searchTerm,
          fromDateRaw,
          toDateRaw,
          whereClause,
        } = parsePayoutFilters(req);

        const [totalsRow] = await db
          .select({
            pending: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'pending' then 1 else 0 end), 0)`,
            approved: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'approved' then 1 else 0 end), 0)`,
            paid: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'paid' then 1 else 0 end), 0)`,
            rejected: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'rejected' then 1 else 0 end), 0)`,
          })
          .from(hostPayoutRequests);

        const countQuery = db
          .select({ count: sql<number>`count(*)` })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id));

        if (whereClause) {
          countQuery.where(whereClause as any);
        }

        const [countRow] = await countQuery;
        const filteredTotal = Number(countRow?.count || 0);

        const rowsQuery = db
          .select({
            id: hostPayoutRequests.id,
            hostId: hostPayoutRequests.hostId,
            userId: hostPayoutRequests.userId,
            amountCents: hostPayoutRequests.amountCents,
            status: hostPayoutRequests.status,
            notes: hostPayoutRequests.notes,
            reviewedByUserId: hostPayoutRequests.reviewedByUserId,
            reviewedByEmail: sql<string>`(select u.email from users u where u.id = ${hostPayoutRequests.reviewedByUserId} limit 1)`,
            reviewedAt: hostPayoutRequests.reviewedAt,
            paidAt: hostPayoutRequests.paidAt,
            createdAt: hostPayoutRequests.createdAt,
            updatedAt: hostPayoutRequests.updatedAt,
            hostBusinessName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
            requesterEmail: users.email,
          })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id))
          .orderBy(desc(hostPayoutRequests.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        if (whereClause) {
          rowsQuery.where(whereClause as any);
        }

        const rows = await rowsQuery;

        res.json({
          ok: true,
          totals: {
            pending: Number(totalsRow?.pending || 0),
            approved: Number(totalsRow?.approved || 0),
            paid: Number(totalsRow?.paid || 0),
            rejected: Number(totalsRow?.rejected || 0),
          },
          rows,
          pagination: {
            page,
            pageSize,
            total: filteredTotal,
            totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)),
            hasNext: page * pageSize < filteredTotal,
            hasPrev: page > 1,
          },
          filters: {
            status: statusFilter,
            q: searchTerm,
            from: fromDateRaw,
            to: toDateRaw,
          },
        });
      } catch (error: any) {
        console.error("Failed to load host payout requests:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to load host payout requests",
        });
      }
    },
  );

  app.patch(
    "/api/admin/host-payout-requests/:requestId",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const requestId = String(req.params.requestId || "").trim();
        const nextStatus = String(req.body?.status || "")
          .trim()
          .toLowerCase();
        const notes =
          typeof req.body?.notes === "string" && req.body.notes.trim()
            ? req.body.notes.trim()
            : null;

        if (!requestId) {
          return res.status(400).json({ message: "Request ID is required" });
        }

        if (
          !["approved", "rejected", "paid", "cancelled"].includes(nextStatus)
        ) {
          return res.status(400).json({
            message:
              "Status must be one of: approved, rejected, paid, cancelled",
          });
        }

        const [existing] = await db
          .select()
          .from(hostPayoutRequests)
          .where(eq(hostPayoutRequests.id, requestId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }

        if (existing.status === "paid") {
          return res.status(400).json({
            message: "Paid requests cannot be modified",
          });
        }

        if (nextStatus === "approved" && existing.status !== "pending") {
          return res.status(400).json({
            message: "Only pending requests can be approved",
          });
        }

        if (nextStatus === "paid" && existing.status !== "approved") {
          return res.status(400).json({
            message: "Only approved requests can be marked paid",
          });
        }

        if (
          nextStatus === "rejected" &&
          !["pending", "approved"].includes(String(existing.status || ""))
        ) {
          return res.status(400).json({
            message: "Only pending or approved requests can be rejected",
          });
        }

        if (
          nextStatus === "cancelled" &&
          !["pending", "approved"].includes(String(existing.status || ""))
        ) {
          return res.status(400).json({
            message: "Only pending or approved requests can be cancelled",
          });
        }

        const now = new Date();
        const [updated] = await db
          .update(hostPayoutRequests)
          .set({
            status: nextStatus,
            notes: notes ?? existing.notes ?? null,
            reviewedByUserId: req.user?.id || null,
            reviewedAt: now,
            paidAt: nextStatus === "paid" ? now : existing.paidAt,
            updatedAt: now,
          })
          .where(eq(hostPayoutRequests.id, requestId))
          .returning();

        if (nextStatus === "paid") {
          // Attempt Stripe Connect transfer if the host has a connected account
          let stripeTransferId: string | null = null;
          let stripeTransferError: string | null = null;
          if (stripe) {
            const [hostRow] = await db
              .select({
                stripeConnectAccountId: hosts.stripeConnectAccountId,
                stripePayoutsEnabled: hosts.stripePayoutsEnabled,
                stripeChargesEnabled: hosts.stripeChargesEnabled,
              })
              .from(hosts)
              .where(eq(hosts.id, existing.hostId))
              .limit(1);

            const connectAccountId = hostRow?.stripeConnectAccountId;
            const payoutsEnabled = Boolean(hostRow?.stripePayoutsEnabled);

            if (connectAccountId && payoutsEnabled) {
              try {
                const transfer = await stripe.transfers.create({
                  amount: Math.abs(Number(existing.amountCents || 0)),
                  currency: "usd",
                  destination: connectAccountId,
                  description: `MealScout host payout — request ${existing.id}`,
                  metadata: {
                    payoutRequestId: existing.id,
                    hostId: existing.hostId,
                    adminUserId: String((req as any).user?.id || ""),
                  },
                });
                stripeTransferId = transfer.id;
                console.log(
                  `[host-payout] Stripe transfer ${transfer.id} created for request ${existing.id} → ${connectAccountId}`,
                );
              } catch (transferErr: unknown) {
                // Log but do not block the status update — admin can retry manually
                stripeTransferError =
                  transferErr instanceof Error
                    ? transferErr.message
                    : String(transferErr);
                console.error(
                  `[host-payout] Stripe transfer failed for request ${existing.id}:`,
                  stripeTransferError,
                );
              }
            } else {
              console.log(
                `[host-payout] Host ${existing.hostId} has no Connect account or payouts not enabled — skipping transfer, manual payout required`,
              );
            }
          }

          await db.insert(hostEarningsLedger).values({
            hostId: existing.hostId,
            bookingId: null,
            stripePaymentIntentId: stripeTransferId,
            entryType: "payout",
            sourceType: "host_payout_request",
            amountCents: -Math.abs(Number(existing.amountCents || 0)),
            description: stripeTransferId
              ? `Host payout via Stripe Connect transfer ${stripeTransferId} (${existing.id})`
              : stripeTransferError
                ? `Host payout processed manually — Stripe transfer failed: ${stripeTransferError} (${existing.id})`
                : `Host payout processed manually — no Connect account (${existing.id})`,
            createdAt: now,
          });

          // Update the payout request with the transfer ID for audit trail
          if (stripeTransferId) {
            await db
              .update(hostPayoutRequests)
              .set({ notes: `stripe_transfer:${stripeTransferId}` })
              .where(eq(hostPayoutRequests.id, existing.id));
          }
        }

        const { getHostEarningsSummary } =
          await import("../hostEarningsService");
        const summary = await getHostEarningsSummary(existing.hostId);

        res.json({ ok: true, request: updated, summary });
      } catch (error: any) {
        console.error("Failed to update host payout request:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to update host payout request",
        });
      }
    },
  );

  app.get(
    "/api/admin/host-payout-requests/export.csv",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const { statusFilter, whereClause } = parsePayoutFilters(req);

        const rowsQuery = db
          .select({
            id: hostPayoutRequests.id,
            hostId: hostPayoutRequests.hostId,
            amountCents: hostPayoutRequests.amountCents,
            status: hostPayoutRequests.status,
            notes: hostPayoutRequests.notes,
            reviewedByUserId: hostPayoutRequests.reviewedByUserId,
            reviewedByEmail: sql<string>`(select u.email from users u where u.id = ${hostPayoutRequests.reviewedByUserId} limit 1)`,
            reviewedAt: hostPayoutRequests.reviewedAt,
            paidAt: hostPayoutRequests.paidAt,
            createdAt: hostPayoutRequests.createdAt,
            updatedAt: hostPayoutRequests.updatedAt,
            hostBusinessName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
            requesterEmail: users.email,
          })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id))
          .orderBy(desc(hostPayoutRequests.createdAt));

        if (whereClause) {
          rowsQuery.where(whereClause as any);
        }

        const rows = await rowsQuery;
        const header =
          "Request ID,Host ID,Host Name,Requester Email,Amount USD,Status,Requested At,Reviewed At,Reviewed By,Paid At,Address,Notes\n";

        const csvRows = rows
          .map((row: (typeof rows)[number]) => {
            const amountUsd = (Number(row.amountCents || 0) / 100).toFixed(2);
            const address = [row.hostAddress, row.hostCity, row.hostState]
              .filter(Boolean)
              .join(", ");

            return [
              sanitizeCSV(row.id),
              sanitizeCSV(row.hostId),
              sanitizeCSV(row.hostBusinessName || ""),
              sanitizeCSV(row.requesterEmail || ""),
              sanitizeCSV(amountUsd),
              sanitizeCSV(row.status || ""),
              sanitizeCSV(
                row.createdAt ? new Date(row.createdAt).toISOString() : "",
              ),
              sanitizeCSV(
                row.reviewedAt ? new Date(row.reviewedAt).toISOString() : "",
              ),
              sanitizeCSV(row.reviewedByEmail || row.reviewedByUserId || ""),
              sanitizeCSV(row.paidAt ? new Date(row.paidAt).toISOString() : ""),
              sanitizeCSV(address),
              sanitizeCSV(row.notes || ""),
            ].join(",");
          })
          .join("\n");

        const dateStamp = new Date().toISOString().slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="host-payout-requests-${encodeURIComponent(statusFilter)}-${dateStamp}.csv"`,
        );
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(header + csvRows);
      } catch (error: any) {
        console.error("Failed to export host payout requests:", error);
        res.status(500).json({
          ok: false,
          message: error?.message || "Failed to export host payout requests",
        });
      }
    },
  );
}
