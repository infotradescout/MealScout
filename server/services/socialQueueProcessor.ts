import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { socialPostQueue } from "@shared/schema";

type QueueStatus = "pending" | "posted" | "failed" | "manual_required";

type QueueCounts = Record<QueueStatus, number>;

const postToFacebookPage = async (message: string, link?: string | null) => {
  const pageId = process.env.MEALSCOUT_FB_PAGE_ID;
  const pageToken = process.env.MEALSCOUT_FB_PAGE_TOKEN;

  if (!pageId || !pageToken) {
    return {
      ok: false as const,
      error: "Missing Facebook page credentials",
    };
  }

  const body = new URLSearchParams();
  body.set("message", link ? `${message} ${link}` : message);
  body.set("access_token", pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false as const,
      error: data?.error?.message || "Facebook post failed",
    };
  }
  return { ok: true as const, postId: data?.id || null };
};

export async function runSocialQueueProcessor(limit = 25) {
  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
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
  };

  for (const row of rows) {
    try {
      if (row.platform === "facebook") {
        const result = await postToFacebookPage(row.message, row.link);
        const status: QueueStatus = result.ok ? "posted" : "failed";
        await db
          .update(socialPostQueue)
          .set({
            status,
            errorMessage: result.ok ? null : result.error || null,
            updatedAt: new Date(),
          })
          .where(eq(socialPostQueue.id, row.id));

        if (result.ok) {
          stats.posted += 1;
        } else {
          stats.failed += 1;
        }
        continue;
      }

      await db
        .update(socialPostQueue)
        .set({
          status: "manual_required",
          errorMessage:
            `Automatic publishing for platform '${row.platform}' is not configured. ` +
            "Keep this post as a manual publish task.",
          updatedAt: new Date(),
        })
        .where(eq(socialPostQueue.id, row.id));
      stats.manualRequired += 1;
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
