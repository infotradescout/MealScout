/**
 * registerRecurringJobs.ts
 *
 * Registers recurring, non-request background jobs that start with the server.
 * Extracted from server/index.ts as part of backend refactor Phase 1.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { runOpsDataCleanup } from "../opsCleanup";
import { runMarketplaceHealthAudit } from "../marketplaceHealth";

export function registerRecurringJobs(): void {
  const enableSessionCleanup =
    process.env.SESSION_CLEANUP_ENABLED !== "false";
  if (enableSessionCleanup) {
    const cleanupIntervalMs = 6 * 60 * 60 * 1000; // 6 hours
    const runSessionCleanup = async () => {
      try {
        await db.execute(sql`delete from sessions where expire < now()`);
        console.log("✅ Session cleanup completed");
      } catch (error) {
        console.warn(
          "⚠️  Session cleanup failed (non-blocking):",
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    setTimeout(() => {
      void runSessionCleanup();
      setInterval(runSessionCleanup, cleanupIntervalMs);
    }, 30_000);
  }

  const enableOpsCleanup = process.env.OPS_CLEANUP_ENABLED !== "false";
  if (enableOpsCleanup) {
    const cleanupIntervalRaw = Number(
      process.env.OPS_CLEANUP_INTERVAL_MINUTES || 30,
    );
    const cleanupIntervalMinutes = Number.isFinite(cleanupIntervalRaw)
      ? Math.max(5, Math.floor(cleanupIntervalRaw))
      : 30;
    const cleanupIntervalMs = cleanupIntervalMinutes * 60 * 1000;
    const runCleanup = async () => {
      const result = await runOpsDataCleanup();
      if (!result.ok) {
        console.warn(
          "⚠️  Ops cleanup failed (non-blocking):",
          result.error || "unknown_error",
        );
        return;
      }
      console.log(
        `✅ Ops cleanup completed (idempotency=${result.idempotencyDeleted}, rateLimit=${result.rateLimitDeleted}, reportTokens=${(result as any).reportTokensDeleted ?? 0})`,
      );
    };

    setTimeout(() => {
      void runCleanup();
      setInterval(runCleanup, cleanupIntervalMs);
    }, 45_000);
  }

  const enableMarketplaceHealthAudit =
    process.env.MARKETPLACE_HEALTH_AUDIT_ENABLED !== "false";
  if (enableMarketplaceHealthAudit) {
    const intervalMinutesRaw = Number(
      process.env.MARKETPLACE_HEALTH_AUDIT_INTERVAL_MINUTES || 60,
    );
    const intervalMinutes = Number.isFinite(intervalMinutesRaw)
      ? Math.max(10, Math.floor(intervalMinutesRaw))
      : 60;
    const intervalMs = intervalMinutes * 60 * 1000;
    const runAudit = async () => {
      const result = await runMarketplaceHealthAudit();
      if (!result.ok) {
        console.warn(
          "⚠️ Marketplace health audit warning:",
          (result as any).error || result,
        );
        return;
      }
      const r: any = result;
      console.log(
        `[marketplace-health] ok total=${r.demandCounts?.total ?? 0} collecting=${r.demandCounts?.collecting ?? 0} threshold_met=${r.demandCounts?.threshold_met ?? 0} claimed=${r.demandCounts?.claimed ?? 0} fulfilled=${r.demandCounts?.fulfilled ?? 0}`,
      );
      if (
        Number(r.stuckThreshold || 0) > 0 ||
        Number(r.staleCollecting || 0) > 0 ||
        Number(r.stalePending || 0) > 0
      ) {
        console.warn(
          `[marketplace-health] stuck_threshold=${r.stuckThreshold} stale_collecting=${r.staleCollecting} stale_pending_bookings=${r.stalePending}`,
        );
      }
    };

    setTimeout(() => {
      void runAudit();
      setInterval(runAudit, intervalMs);
    }, 60_000);
  }

  // Perform database validation after server startup - non-blocking
  setTimeout(async () => {
    try {
      const schemaCheck = await db.execute(sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'phone'
      `);

      if (schemaCheck.rows.length === 0) {
        console.error(
          "❌ CRITICAL: phone column missing from users table!",
        );
        console.error(
          "Database URL:",
          process.env.DATABASE_URL?.split("@")[0] + "@...",
        );
        if (process.env.NODE_ENV === "production") {
          console.warn(
            "⚠️  Server will continue running despite database schema issues",
          );
        }
      } else {
        console.log("✅ Schema validation: phone column exists");
      }
    } catch (error) {
      console.error(
        "❌ Schema validation failed:",
        error instanceof Error ? error.message : String(error),
      );
      console.warn(
        "⚠️  Server will continue running despite database validation failure",
      );
    }
  }, 1000);
}