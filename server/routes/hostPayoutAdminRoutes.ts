import type { Express } from "express";
import { and, desc, eq, gte, like, lt, or, sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "../db";
import { isAdmin, isAuthenticated } from "../unifiedAuth";
import {
  hostPayoutRequests,
  hosts,
  legacyPayoutProviderOperations,
  users,
} from "@shared/schema";
import { requireIdempotencyKey } from "../middleware/idempotency";
import {
  executeLegacyPayoutTransfer,
  getLegacyPayoutProviderOperation,
  LegacyPayoutProviderError,
  serializeLegacyPayoutProviderOperation,
} from "../services/legacyPayoutProviderService";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const VALID_STATUSES = [
  "all",
  "pending",
  "approved",
  "processing",
  "transferred_to_connect",
  "failed",
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
  const adminVisibleLegacyPayout = sql`coalesce(${hostPayoutRequests.fundingTopology}, 'unclassified') <> 'destination_charge'`;
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
            processing: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'processing' then 1 else 0 end), 0)`,
            transferred: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} in ('paid', 'transferred_to_connect') then 1 else 0 end), 0)`,
            failed: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'failed' then 1 else 0 end), 0)`,
            paid: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'paid' then 1 else 0 end), 0)`,
            rejected: sql<number>`coalesce(sum(case when ${hostPayoutRequests.status} = 'rejected' then 1 else 0 end), 0)`,
          })
          .from(hostPayoutRequests)
          .where(adminVisibleLegacyPayout);

        const countQuery = db
          .select({ count: sql<number>`count(*)` })
          .from(hostPayoutRequests)
          .leftJoin(hosts, eq(hostPayoutRequests.hostId, hosts.id))
          .leftJoin(users, eq(hostPayoutRequests.userId, users.id));

        countQuery.where(
          and(adminVisibleLegacyPayout, whereClause as any) as any,
        );

        const [countRow] = await countQuery;
        const filteredTotal = Number(countRow?.count || 0);

        const rowsQuery = db
          .select({
            id: hostPayoutRequests.id,
            hostId: hostPayoutRequests.hostId,
            userId: hostPayoutRequests.userId,
            amountCents: hostPayoutRequests.amountCents,
            status: hostPayoutRequests.status,
            fundingTopology: hostPayoutRequests.fundingTopology,
            eligibilityState: hostPayoutRequests.eligibilityState,
            eligibleAmountSnapshotCents:
              hostPayoutRequests.eligibleAmountSnapshotCents,
            providerTransferId: hostPayoutRequests.providerTransferId,
            providerOperationId: legacyPayoutProviderOperations.id,
            providerOperationRequestId:
              legacyPayoutProviderOperations.requestId,
            providerOperationStatus: legacyPayoutProviderOperations.status,
            providerOperationErrorCode:
              legacyPayoutProviderOperations.providerErrorCode,
            providerOperationErrorMessage:
              legacyPayoutProviderOperations.providerErrorMessage,
            providerOperationIdempotencyExpiresAt:
              legacyPayoutProviderOperations.idempotencyExpiresAt,
            quarantineReason: hostPayoutRequests.quarantineReason,
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
          .leftJoin(
            legacyPayoutProviderOperations,
            eq(
              legacyPayoutProviderOperations.payoutRequestId,
              hostPayoutRequests.id,
            ),
          )
          .orderBy(desc(hostPayoutRequests.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

        rowsQuery.where(
          and(adminVisibleLegacyPayout, whereClause as any) as any,
        );

        const rows = await rowsQuery;

        res.json({
          ok: true,
          totals: {
            pending: Number(totalsRow?.pending || 0),
            approved: Number(totalsRow?.approved || 0),
            processing: Number(totalsRow?.processing || 0),
            transferred: Number(totalsRow?.transferred || 0),
            failed: Number(totalsRow?.failed || 0),
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
    requireIdempotencyKey({ scope: "admin_legacy_host_payout" }),
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

        if (nextStatus === "paid") {
          try {
            const result = await executeLegacyPayoutTransfer({
              payoutRequestId: requestId,
              actorUserId: String(req.user?.id || "").trim(),
              requestId: String(req.headers["idempotency-key"] || "").trim(),
              stripe,
            });
            const { getHostEarningsSummary } =
              await import("../hostEarningsService");
            const summary = await getHostEarningsSummary(result.request.hostId);
            return res.json({
              ok: true,
              request: result.request,
              operation: serializeLegacyPayoutProviderOperation(
                result.operation,
              ),
              summary,
            });
          } catch (error: any) {
            if (error instanceof LegacyPayoutProviderError) {
              const operation = await getLegacyPayoutProviderOperation(requestId);
              return res
                .status(
                  operation && operation.status === "action_required"
                    ? 202
                    : error.statusCode,
                )
                .json({
                  ok: false,
                  message: error.message,
                  code: error.code,
                  details: error.details,
                  operation: operation
                    ? serializeLegacyPayoutProviderOperation(operation)
                    : null,
                });
            }
            throw error;
          }
        }

        const [existing] = await db
          .select()
          .from(hostPayoutRequests)
          .where(eq(hostPayoutRequests.id, requestId))
          .limit(1);

        if (!existing) {
          return res.status(404).json({ message: "Payout request not found" });
        }

        if (["paid", "transferred_to_connect"].includes(existing.status)) {
          return res.status(400).json({
            message: "Transferred requests cannot be modified",
          });
        }

        if (nextStatus === "approved" && existing.status !== "pending") {
          return res.status(400).json({
            message: "Only pending requests can be approved",
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
        const updated =
          nextStatus === "approved"
            ? await db.transaction(async (tx: any) => {
                await tx.execute(
                  sql`SELECT pg_advisory_xact_lock(hashtext(${`host_payout:${existing.hostId}`}))`,
                );
                const [locked] = await tx
                  .select()
                  .from(hostPayoutRequests)
                  .where(eq(hostPayoutRequests.id, requestId))
                  .limit(1)
                  .for("update");
                if (!locked || locked.status !== "pending") {
                  throw Object.assign(
                    new Error("Only a current pending request can be approved."),
                    { statusCode: 409 },
                  );
                }
                if (locked.fundingTopology === "destination_charge") {
                  throw Object.assign(
                    new Error(
                      "Destination-charge funds settle directly to Connect and cannot be approved as a legacy payout.",
                    ),
                    { statusCode: 409 },
                  );
                }
                const { getHostEarningsSummary } =
                  await import("../hostEarningsService");
                const summary = await getHostEarningsSummary(
                  locked.hostId,
                  tx,
                );
                const ownCommitted =
                  locked.fundingTopology === "legacy_platform_hold" &&
                  locked.eligibilityState === "eligible_legacy"
                    ? locked.amountCents
                    : 0;
                const eligibleCapacity =
                  summary.availableCents + ownCommitted;
                if (
                  locked.amountCents <= 0 ||
                  locked.amountCents > eligibleCapacity
                ) {
                  throw Object.assign(
                    new Error(
                      "Current eligible legacy platform-held funds do not cover this request.",
                    ),
                    { statusCode: 409 },
                  );
                }
                const [approved] = await tx
                  .update(hostPayoutRequests)
                  .set({
                    status: "approved",
                    fundingTopology: "legacy_platform_hold",
                    eligibilityState: "eligible_legacy",
                    eligibleAmountSnapshotCents: eligibleCapacity,
                    quarantineReason: null,
                    notes: notes ?? locked.notes ?? null,
                    reviewedByUserId: req.user?.id || null,
                    reviewedAt: now,
                    paidAt: locked.paidAt,
                    updatedAt: now,
                  })
                  .where(eq(hostPayoutRequests.id, requestId))
                  .returning();
                return approved;
              })
            : (
                await db
                  .update(hostPayoutRequests)
                  .set({
                    status: nextStatus,
                    notes: notes ?? existing.notes ?? null,
                    reviewedByUserId: req.user?.id || null,
                    reviewedAt: now,
                    paidAt: existing.paidAt,
                    updatedAt: now,
                  })
                  .where(eq(hostPayoutRequests.id, requestId))
                  .returning()
              )[0];

        const { getHostEarningsSummary } =
          await import("../hostEarningsService");
        const summary = await getHostEarningsSummary(existing.hostId);

        res.json({ ok: true, request: updated, summary });
      } catch (error: any) {
        console.error("Failed to update host payout request:", error);
        res.status(Number(error?.statusCode) || 500).json({
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
            fundingTopology: hostPayoutRequests.fundingTopology,
            eligibilityState: hostPayoutRequests.eligibilityState,
            eligibleAmountSnapshotCents:
              hostPayoutRequests.eligibleAmountSnapshotCents,
            providerTransferId: hostPayoutRequests.providerTransferId,
            quarantineReason: hostPayoutRequests.quarantineReason,
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

        rowsQuery.where(
          and(adminVisibleLegacyPayout, whereClause as any) as any,
        );

        const rows = await rowsQuery;
        const header =
          "Request ID,Host ID,Host Name,Requester Email,Amount USD,Status,Funding Topology,Eligibility State,Eligible Snapshot USD,Provider Transfer ID,Quarantine Reason,Requested At,Reviewed At,Reviewed By,Paid At,Address,Notes\n";

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
              sanitizeCSV(row.fundingTopology || "unclassified"),
              sanitizeCSV(row.eligibilityState || "requires_revalidation"),
              sanitizeCSV(
                (Number(row.eligibleAmountSnapshotCents || 0) / 100).toFixed(2),
              ),
              sanitizeCSV(row.providerTransferId || ""),
              sanitizeCSV(row.quarantineReason || ""),
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
