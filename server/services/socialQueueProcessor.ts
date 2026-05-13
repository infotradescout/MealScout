import { and, asc, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { socialPostQueue } from "@shared/schema";
import {
  markSocialPostResult,
  publishSocialQueueItem,
} from "./socialPublishing";

type QueueStatus = "pending" | "posted" | "failed" | "manual_required";

type QueueCounts = Record<QueueStatus, number>;

const SOCIAL_QUEUE_LOCK_KEY = 20260412;

export async function runSocialQueueProcessor(limit = 25) {
  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
  let lockAcquired = false;

  if (pool) {
    const lockResult = await pool.query(
      "select pg_try_advisory_lock($1) as locked",
      [SOCIAL_QUEUE_LOCK_KEY],
    );
    lockAcquired = Boolean(lockResult.rows?.[0]?.locked);
    if (!lockAcquired) {
      return {
        attempted: 0,
        posted: 0,
        failed: 0,
        manualRequired: 0,
        skipped: true,
      };
    }
  }

  try {
    const rows = await db
      .select()
      .from(socialPostQueue)
      .where(eq(socialPostQueue.status, "pending"))
      .orderBy(asc(socialPostQueue.createdAt))
      .limit(normalizedLimit);

    const stats = {
      attempted: rows.length,
      posted: 0,
      failed: 0,
      manualRequired: 0,
      skipped: false,
    };

    for (const row of rows) {
      try {
        const result = await publishSocialQueueItem(row);
        await markSocialPostResult(row, result);
        if (result.ok) stats.posted += 1;
        else if (result.manualRequired) stats.manualRequired += 1;
        else stats.failed += 1;
      } catch (error) {
        await db
          .update(socialPostQueue)
          .set({
            status: "failed",
            errorMessage:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : "Queue processing failed",
            updatedAt: new Date(),
          })
          .where(eq(socialPostQueue.id, row.id));
        stats.failed += 1;
      }
    }

    return stats;
  } finally {
    if (lockAcquired && pool) {
      await pool
        .query("select pg_advisory_unlock($1)", [SOCIAL_QUEUE_LOCK_KEY])
        .catch((error) => {
          console.error("[social-queue] failed to release advisory lock:", error);
        });
    }
  }
}

export async function getSocialQueueStatus() {
  const countRows = await db
    .select({
      status: socialPostQueue.status,
      count: sql<number>`count(*)`,
    })
    .from(socialPostQueue)
    .groupBy(socialPostQueue.status);

  const counts: QueueCounts = {
    pending: 0,
    posted: 0,
    failed: 0,
    manual_required: 0,
  };

  for (const row of countRows) {
    const status = String(row.status || "") as QueueStatus;
    if (status in counts) {
      counts[status] = Number(row.count || 0);
    }
  }

  const [oldestPending] = await db
    .select({ createdAt: socialPostQueue.createdAt })
    .from(socialPostQueue)
    .where(eq(socialPostQueue.status, "pending"))
    .orderBy(asc(socialPostQueue.createdAt))
    .limit(1);

  const [lastProcessed] = await db
    .select({ updatedAt: socialPostQueue.updatedAt })
    .from(socialPostQueue)
    .where(
      and(
        eq(socialPostQueue.status, "posted"),
        sql`${socialPostQueue.updatedAt} is not null`,
      ),
    )
    .orderBy(sql`${socialPostQueue.updatedAt} desc`)
    .limit(1);

  return {
    counts,
    oldestPendingAt: oldestPending?.createdAt || null,
    lastPostedAt: lastProcessed?.updatedAt || null,
  };
}
