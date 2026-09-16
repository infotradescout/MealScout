import { db } from "./db";
import { sql } from "drizzle-orm";

type CleanupCounts = {
  idempotencyDeleted: number;
  rateLimitDeleted: number;
  reportTokensDeleted: number;
};

type CleanupSnapshot = CleanupCounts & {
  ok: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const state: CleanupSnapshot = {
  ok: true,
  idempotencyDeleted: 0,
  rateLimitDeleted: 0,
  reportTokensDeleted: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.floor(raw));
}

export function getOpsCleanupSnapshot(): CleanupSnapshot {
  return { ...state };
}

export async function runOpsDataCleanup(): Promise<CleanupSnapshot> {
  const idempotencyGraceHours = readPositiveIntEnv(
    "IDEMPOTENCY_RETENTION_HOURS_AFTER_EXPIRY",
    24,
  );
  const rateLimitRetentionHours = readPositiveIntEnv(
    "RATE_LIMIT_COUNTER_RETENTION_HOURS",
    48,
  );
  const reportTokenGraceHours = readPositiveIntEnv(
    "REPORT_DOWNLOAD_TOKEN_RETENTION_HOURS_AFTER_EXPIRY",
    24,
  );

  const startedAt = new Date();
  state.startedAt = startedAt.toISOString();
  state.error = null;

  try {
    // Keep Parking Pass request tombstones: an expired response is not permission
    // to execute its financial operation again. Remove sensitive replay bodies.
    await db.execute(sql`
      UPDATE idempotency_keys SET response_body = NULL, status_code = NULL,
        state = 'expired', updated_at = now()
      WHERE split_part(scope, ':', 1) = 'parking_pass_booking'
        AND expires_at < now() AND state <> 'expired';
    `);
    const idempotencyResult: any = await db.execute(sql`
      WITH deleted AS (
        DELETE FROM idempotency_keys
        WHERE expires_at < (now() - (${idempotencyGraceHours}::int * interval '1 hour'))
          AND split_part(scope, ':', 1) <> 'parking_pass_booking'
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted;
    `);
    const rateLimitResult: any = await db.execute(sql`
      WITH deleted AS (
        DELETE FROM rate_limit_counters
        WHERE updated_at < (now() - (${rateLimitRetentionHours}::int * interval '1 hour'))
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted;
    `);

    const reportTokenResult: any = await db.execute(sql`
      WITH deleted AS (
        DELETE FROM report_download_tokens
        WHERE expires_at < (now() - (${reportTokenGraceHours}::int * interval '1 hour'))
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted;
    `);

    const idempotencyDeleted = Number(idempotencyResult?.rows?.[0]?.count || 0);
    const rateLimitDeleted = Number(rateLimitResult?.rows?.[0]?.count || 0);
    const reportTokensDeleted = Number(reportTokenResult?.rows?.[0]?.count || 0);

    state.ok = true;
    state.idempotencyDeleted = idempotencyDeleted;
    state.rateLimitDeleted = rateLimitDeleted;
    state.reportTokensDeleted = reportTokensDeleted;
    state.finishedAt = new Date().toISOString();
    state.error = null;
    return getOpsCleanupSnapshot();
  } catch (error: any) {
    state.ok = false;
    state.idempotencyDeleted = 0;
    state.rateLimitDeleted = 0;
    state.reportTokensDeleted = 0;
    state.finishedAt = new Date().toISOString();
    state.error = String(error?.message || error || "cleanup_failed");
    return getOpsCleanupSnapshot();
  }
}
