import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  eventBookings,
  hostEarningsLedger,
  hostPayoutRequests,
} from "@shared/schema";

// Accepts an optional transaction client so callers that need an atomic
// read-check-write (e.g. validating a payout request against the balance
// before inserting it) can run this inside the same locked transaction
// instead of a separate connection that wouldn't see uncommitted rows or
// be serialized by the caller's advisory lock.
export async function getHostEarningsSummary(hostId: string, dbClient: any = db) {
  const [earnedRow] = await dbClient
    .select({
      total: sql<number>`coalesce(sum(${hostEarningsLedger.amountCents}), 0)`,
    })
    .from(hostEarningsLedger)
    .where(
      and(
        eq(hostEarningsLedger.hostId, hostId),
        eq(hostEarningsLedger.entryType, "booking_earned"),
        eq(hostEarningsLedger.settlementTopology, "legacy_platform_hold"),
        eq(hostEarningsLedger.reconciliationState, "eligible_legacy"),
      ),
    );

  const [pendingRow] = await dbClient
    .select({
      total: sql<number>`coalesce(sum(${hostPayoutRequests.amountCents}), 0)`,
    })
    .from(hostPayoutRequests)
    .where(
      and(
        eq(hostPayoutRequests.hostId, hostId),
        eq(hostPayoutRequests.fundingTopology, "legacy_platform_hold"),
        eq(hostPayoutRequests.eligibilityState, "eligible_legacy"),
        inArray(hostPayoutRequests.status, ["pending", "approved", "processing"]),
      ),
    );

  const [paidRow] = await dbClient
    .select({
      total: sql<number>`coalesce(sum(${hostPayoutRequests.amountCents}), 0)`,
    })
    .from(hostPayoutRequests)
    .where(
      and(
        eq(hostPayoutRequests.hostId, hostId),
        eq(hostPayoutRequests.fundingTopology, "legacy_platform_hold"),
        eq(hostPayoutRequests.eligibilityState, "eligible_legacy"),
        inArray(hostPayoutRequests.status, ["paid", "transferred_to_connect"]),
      ),
    );

  const [latestEarning] = await dbClient
    .select({ createdAt: hostEarningsLedger.createdAt })
    .from(hostEarningsLedger)
    .where(
      and(
        eq(hostEarningsLedger.hostId, hostId),
        eq(hostEarningsLedger.settlementTopology, "legacy_platform_hold"),
        eq(hostEarningsLedger.reconciliationState, "eligible_legacy"),
      ),
    )
    .orderBy(sql`${hostEarningsLedger.createdAt} desc`)
    .limit(1);

  const accruedCents = Number(earnedRow?.total || 0);
  const pendingPayoutCents = Number(pendingRow?.total || 0);
  const paidOutCents = Number(paidRow?.total || 0);
  const availableCents = Math.max(0, accruedCents - pendingPayoutCents - paidOutCents);

  return {
    accruedCents,
    pendingPayoutCents,
    paidOutCents,
    availableCents,
    fundingTopology: "legacy_platform_hold" as const,
    destinationChargesIncluded: false as const,
    lastEarningAt: latestEarning?.createdAt || null,
  };
}

export async function recordHostBookingEarnings(
  entries: Array<{
    hostId: string;
    bookingId: string;
    stripePaymentIntentId?: string | null;
    amountCents: number;
    description?: string;
  }>,
) {
  if (!entries.length) return;

  const bookingIds = Array.from(
    new Set(entries.map((entry) => entry.bookingId).filter(Boolean)),
  );
  const legacyRows = bookingIds.length
    ? await db
        .select({ id: eventBookings.id })
        .from(eventBookings)
        .where(
          and(
            inArray(eventBookings.id, bookingIds),
            isNull(eventBookings.purchaseId),
            sql`coalesce(${eventBookings.settlementTopology}, 'legacy_platform_hold') <> 'destination_charge'`,
          ),
        )
    : [];
  const legacyBookingIds = new Set(
    legacyRows.map((row: (typeof legacyRows)[number]) => row.id),
  );
  const rows = entries
    // Canonical destination charges settle to Connect at capture. Adding them
    // to the legacy platform-held ledger would create a second payout claim.
    .filter((entry) => legacyBookingIds.has(entry.bookingId))
    .filter((entry) => entry.hostId && entry.bookingId && entry.amountCents > 0)
    .map((entry) => ({
      hostId: entry.hostId,
      bookingId: entry.bookingId,
      stripePaymentIntentId: entry.stripePaymentIntentId || null,
      entryType: "booking_earned",
      sourceType: "parking_pass_booking",
      settlementTopology: "legacy_platform_hold",
      reconciliationState: "eligible_legacy",
      amountCents: Math.floor(entry.amountCents),
      description: entry.description || "Parking pass booking earnings",
    }));

  if (!rows.length) return;

  await db
    .insert(hostEarningsLedger)
    .values(rows)
    // Migration 074 installs this guarantee as a partial unique index
    // (booking_id IS NOT NULL). PostgreSQL cannot infer that index from a
    // bare column conflict target, so use target-free DO NOTHING and let the
    // database enforce every applicable unique constraint.
    .onConflictDoNothing();
}
