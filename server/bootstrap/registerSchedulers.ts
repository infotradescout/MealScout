/**
 * registerSchedulers.ts
 *
 * Central home for all cron / recurring-job wiring.
 * Extracted from server/routes.ts as part of backend refactor Phase 1.
 *
 * Rule: no Express route registration here — only scheduler setup.
 * Each scheduler imports its own domain service lazily to keep startup fast.
 */

import type { Express } from "express";
import cron from "node-cron";
import { DigestService } from "../digestService";
import { DinerDigestService } from "../dinerDigestService";
import { OnboardingDripService } from "../onboardingDripService";
import { RestaurantActivationService } from "../restaurantActivationService";
import { notifyUnbookedEvents } from "../eventNotificationCron";
import { remindIncompleteParkingPassHosts } from "../parkingPassReminder";
import { runLocationDemandActivationCron } from "../services/locationDemandActivation";
import { runSupplyMarketIntelCron } from "../services/supplyMarketIntel";
import { runHostPartnerLeadDripCron } from "../services/hostPartnerLeadDrip";
import {
  autoPopulateDirectoryForActiveCities,
  runMarketExpansionScoreRecompute,
  runMarketExpansionStateTransition,
} from "../services/marketExpansionAutomation";
import { runSocialQueueProcessor } from "../services/socialQueueProcessor";
import { runMenuAutoRefreshCron } from "../services/menuAutoRefresh";
import { runGoogleBusinessAutoLinkBackfill } from "../services/googleBusinessProfileBackfill";
import { submitIndexNowUrls, getIndexNowConfig } from "../services/indexNow";
import { runVerificationReminderCron } from "../services/verificationReminderService";
import { registerStoryCronJobs } from "../storiesCronJobs";
import { registerFeaturedVideoCronJobs } from "../featuredVideoCron";
import { sendAdminDailyDigest } from "../services/adminDailyDigest";
import { sendOwnerDiscoverabilityAlerts } from "../services/ownerDiscoverabilityAlerts";
import { runOwnerProfileRecoveryCron } from "../services/ownerProfileRecovery";
import { db } from "../db";
import { requestLogs, adminDailyReports, cities, sentimentSignalEvents } from "@shared/schema";
import { and, gte, lt, desc, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMissingColumnError(err: unknown, column: string): boolean {
  const msg = String((err as any)?.message || "");
  return (
    msg.includes(column) &&
    (msg.includes("does not exist") || msg.includes("Unknown column"))
  );
}

const getParkingPassHoldTtlMs = () => {
  const raw = Number(process.env.PARKING_PASS_HOLD_TTL_MINUTES ?? 7);
  const minutes = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 60)) : 7;
  return minutes * 60 * 1000;
};

// ---------------------------------------------------------------------------
// Public registration entry point
// ---------------------------------------------------------------------------

export async function registerSchedulers(app: Express): Promise<void> {
  // Story cleanup and level recalculation
  registerStoryCronJobs(app);

  // Featured video cron endpoint
  await registerFeaturedVideoCronJobs(app);

  // Weekly Digest — Monday 8:00 AM
  cron.schedule("0 8 * * 1", async () => {
    console.log("⏰ Triggering Weekly Digest Cron Job");
    try {
      await DigestService.getInstance().sendWeeklyDigests();
      console.log("✅ Weekly Digest Cron Job Completed");
    } catch (error) {
      console.error("❌ Weekly Digest Cron Job Failed:", error);
    }
  });

  // Admin Daily Digest — every morning at 8:00 AM UTC.
  // Sends an ops summary to ADMIN_EMAIL: new owners, stuck, imports, etc.
  // Disable with ADMIN_DAILY_DIGEST_ENABLED=false.
  if (
    String(process.env.ADMIN_DAILY_DIGEST_ENABLED || "true").toLowerCase() !==
    "false"
  ) {
    cron.schedule("0 8 * * *", async () => {
      console.log("⏰ Triggering Admin Daily Digest");
      try {
        const result = await sendAdminDailyDigest();
        if (result.sent) {
          console.log(
            `✅ Admin Daily Digest sent (${result.snapshot?.newOwners ?? 0} new owners, ${result.snapshot?.totalStuck ?? 0} stuck)`,
          );
        } else {
          console.warn(
            `⚠️ Admin Daily Digest skipped: ${result.reason || "unknown"}`,
          );
        }
      } catch (error) {
        console.error("❌ Admin Daily Digest failed:", error);
      }
    });
  }

  // Launch-week proactive alert: owners stuck and still not discoverable after 6h.
  // Runs hourly and dedupes per owner via telemetry_events so no spam.
  if (
    String(
      process.env.OWNER_DISCOVERABILITY_ALERTS_ENABLED || "true",
    ).toLowerCase() !== "false"
  ) {
    cron.schedule("12 * * * *", async () => {
      console.log("⏰ Triggering Owner Discoverability Alert scan");
      try {
        const result = await sendOwnerDiscoverabilityAlerts();
        if (result.sent) {
          console.log(
            `✅ Owner Discoverability Alert sent (${result.alerted}/${result.considered})`,
          );
        } else {
          console.log(
            `ℹ️ Owner Discoverability Alert skipped: ${result.reason || "unknown"}`,
          );
        }
      } catch (error) {
        console.error("❌ Owner Discoverability Alert failed:", error);
      }
    });
  }

  // Owner recovery: signed-up owners whose public profile still has no useful
  // business/menu data. This catches pre-fix signups and new interrupted flows.
  if (
    String(process.env.OWNER_PROFILE_RECOVERY_ENABLED || "true").toLowerCase() !==
    "false"
  ) {
    const expression =
      process.env.OWNER_PROFILE_RECOVERY_CRON || "*/30 * * * *";
    cron.schedule(expression, async () => {
      console.log("⏰ Triggering Owner Profile Recovery scan");
      try {
        const result = await runOwnerProfileRecoveryCron();
        console.log(
          `[owner-profile-recovery] considered=${result.considered} sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`,
        );
      } catch (error) {
        console.error("❌ Owner Profile Recovery failed:", error);
      }
    });
  }

  // Premium Weekly Summary — Monday 8:30 AM (subscribed trucks)
  cron.schedule("30 8 * * 1", async () => {
    console.log("⏰ Triggering Premium Weekly Summary Cron");
    try {
      const { users, restaurants, restaurantSubscriptions } = await import("@shared/schema");
      const { eq, isNotNull, inArray } = await import("drizzle-orm");
      const { emailService } = await import("../emailService");
      const { telemetryEvents } = await import("@shared/schema");
      // Find all users with an active restaurantSubscriptions row
      const activeSubs = await db
        .selectDistinct({ userId: restaurants.ownerId })
        .from(restaurantSubscriptions)
        .innerJoin(restaurants, eq(restaurantSubscriptions.restaurantId, restaurants.id))
        .where(eq(restaurantSubscriptions.status, "active"));
      const activeUserIds = activeSubs.map((r: { userId: string }) => r.userId);
      if (activeUserIds.length === 0) {
        console.log("[premium-weekly] No active subscribers — skipping");
        return;
      }
      const activeUsers = await db
        .select({ id: users.id, email: users.email, firstName: users.firstName, accountSettings: users.accountSettings })
        .from(users)
        .where(inArray(users.id, activeUserIds));
      const now = new Date();
      const weekNumber = Math.ceil(
        ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7,
      );
      const idempotencyKey = `${now.getFullYear()}-W${weekNumber}`;
      let sentCount = 0;
      let skippedCount = 0;
      for (const user of activeUsers) {
        const email = String(user.email || "").trim();
        if (!email) { skippedCount++; continue; }
        // Respect opt-out
        const settings = user.accountSettings as any;
        if (settings?.notifications?.channels?.email === false ||
            settings?.notifications?.topics?.weeklyDigest === false) {
          skippedCount++; continue;
        }
        // Idempotency check
        const alreadySent = await db.query.telemetryEvents.findFirst({
          where: and(
            eq(telemetryEvents.eventName, "premium_summary_auto_emailed"),
            eq(telemetryEvents.userId, user.id),
            sql`properties->>'week' = ${idempotencyKey}`,
          ),
        });
        if (alreadySent) { skippedCount++; continue; }
        // Build summary inline (same logic as buildPremiumWeeklySummary)
        try {
          const { restaurants: restaurantsTable, truckManualSchedules, truckParkingReports } = await import("@shared/schema");
          const windowStart = new Date(now);
          windowStart.setDate(windowStart.getDate() - 6);
          windowStart.setHours(0, 0, 0, 0);
          const ownedRestaurants = await db
            .select({ id: restaurantsTable.id })
            .from(restaurantsTable)
            .where(eq(restaurantsTable.ownerId, user.id));
          const restaurantIds = ownedRestaurants.map((r: { id: string }) => r.id);
          if (restaurantIds.length === 0) { skippedCount++; continue; }
          const [manualSchedules, parkingReports, liveLocEvents] = await Promise.all([
            db.select({ id: truckManualSchedules.id, date: truckManualSchedules.date, address: truckManualSchedules.address })
              .from(truckManualSchedules)
              .where(and(inArray(truckManualSchedules.truckId, restaurantIds), gte(truckManualSchedules.createdAt, windowStart))),
            db.select({ id: truckParkingReports.id, date: truckParkingReports.date, address: truckParkingReports.address, locationName: truckParkingReports.locationName })
              .from(truckParkingReports)
              .where(and(inArray(truckParkingReports.truckId, restaurantIds), gte(truckParkingReports.createdAt, windowStart))),
            db.select({ id: telemetryEvents.id })
              .from(telemetryEvents)
              .where(and(eq(telemetryEvents.eventName, "premium_live_location_used"), eq(telemetryEvents.userId, user.id), gte(telemetryEvents.createdAt, windowStart))),
          ]);
          const stopKeys = new Set<string>();
          for (const s of manualSchedules) stopKeys.add(`${s.date?.toISOString().split("T")[0]}:${s.address}`);
          for (const r of parkingReports) stopKeys.add(`${r.date?.toISOString().split("T")[0]}:${r.address || r.locationName}`);
          const operatorName = String(user.firstName || "").trim() || "MealScout operator";
          await emailService.sendPremiumWeeklySummaryEmail(email, operatorName, {
            weekStart: windowStart.toLocaleDateString(),
            weekEnd: now.toLocaleDateString(),
            stopsCovered: stopKeys.size,
            liveLocationActivations: liveLocEvents.length,
            manualScheduleUsage: manualSchedules.length,
            parkingReportsCompleted: parkingReports.length,
          });
          await db.insert(telemetryEvents).values({
            eventName: "premium_summary_auto_emailed",
            userId: user.id,
            properties: { week: idempotencyKey, stopsCovered: stopKeys.size },
          });
          sentCount++;
        } catch (userError) {
          console.error(`[premium-weekly] Failed for user ${user.id}:`, userError);
          skippedCount++;
        }
      }
      console.log(`✅ Premium Weekly Summary: sent=${sentCount} skipped=${skippedCount}`);
    } catch (error) {
      console.error("❌ Premium Weekly Summary Cron Failed:", error);
    }
  });

  // Diner Deals Digest — Wednesday 9:00 AM
  cron.schedule("0 9 * * 3", async () => {
    console.log("⏰ Triggering Diner Deals Digest");
    try {
      const stats = await DinerDigestService.getInstance().sendDinerDigests();
      console.log("✅ Diner Deals Digest Completed:", stats);
    } catch (error) {
      console.error("❌ Diner Deals Digest Failed:", error);
    }
  });

  // Post-signup onboarding drip — daily 3:00 AM (Day 3 referral + Day 7 discovery)
  cron.schedule("0 3 * * *", async () => {
    try {
      const stats = await OnboardingDripService.getInstance().run();
      if (stats.day3Sent + stats.day7Sent > 0) {
        console.log("[onboarding-drip] sent:", stats);
      }
    } catch (error) {
      console.error("❌ Onboarding Drip Failed:", error);
    }
  });

  // Restaurant deal-creation nudge — daily 3:30 AM (Day 7 + Day 14 prompts)
  cron.schedule("30 3 * * *", async () => {
    try {
      const stats = await RestaurantActivationService.getInstance().run();
      if (stats.nudge7Sent + stats.nudge14Sent > 0) {
        console.log("[restaurant-activation] sent:", stats);
      }
    } catch (error) {
      console.error("❌ Restaurant Activation Nudge Failed:", error);
    }
  });

  // Verification reminder - daily 3:45 AM. Owners can defer document upload,
  // but get a once-daily email until a verification request is submitted.
  cron.schedule("45 3 * * *", async () => {
    try {
      const stats = await runVerificationReminderCron();
      if (stats.sent > 0) {
        console.log("[verification-reminders] sent:", stats);
      }
    } catch (error) {
      console.error("❌ Verification Reminder Failed:", error);
    }
  });

  // Pensacola food truck onboarding/upsell drip — every 30 min (feature-flagged)
  if (
    String(process.env.PENSACOLA_FOOD_TRUCK_DRIP_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    cron.schedule("*/30 * * * *", async () => {
      try {
        const { runPensacolaFoodTruckDripCron } =
          await import("../services/pensacolaFoodTruckDrip");
        const result = await runPensacolaFoodTruckDripCron();
        if ((result as any)?.sent) {
          console.log("[drip] Pensacola food truck sequence sent:", result);
        }
      } catch (error) {
        console.error("[drip] Pensacola food truck sequence failed:", error);
      }
    });
  }

  // Location demand activation — every 30 min (configurable, on by default)
  if (
    String(process.env.LOCATION_DEMAND_ACTIVATION_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false"
  ) {
    const expression = String(
      process.env.LOCATION_DEMAND_ACTIVATION_CRON || "*/30 * * * *",
    );
    cron.schedule(expression, async () => {
      try {
        const stats = await runLocationDemandActivationCron();
        if (Number((stats as any)?.sent || 0) > 0) {
          console.log("[location-demand-activation] sent", stats);
        }
      } catch (error) {
        console.error("[location-demand-activation] cron failed:", error);
      }
    });
  }

  // Supply market intel refresh — creates localized snapshots + alerts and emits LISA-compatible lane claims.
  if (
    String(process.env.SUPPLY_MARKET_INTEL_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false"
  ) {
    const expression = String(
      process.env.SUPPLY_MARKET_INTEL_CRON || "*/20 * * * *",
    );
    cron.schedule(expression, async () => {
      try {
        const stats = await runSupplyMarketIntelCron();
        if (Number((stats as any)?.alertsCreated || 0) > 0) {
          console.log("[supply-market-intel] alerts generated", stats);
        }
      } catch (error) {
        console.error("[supply-market-intel] cron failed:", error);
      }
    });
  }

  // Pensacola report lead drip — every 30 min (feature-flagged)
  if (
    String(process.env.PENSACOLA_REPORT_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    cron.schedule("*/30 * * * *", async () => {
      try {
        const { runPensacolaReportLeadDripCron } =
          await import("../services/pensacolaReportDrip");
        const result = await runPensacolaReportLeadDripCron();
        if ((result as any)?.sent) {
          console.log("[drip] Pensacola report lead sequence sent:", result);
        }
      } catch (error) {
        console.error("[drip] Pensacola report lead sequence failed:", error);
      }
    });
  }

  // Host partner lead drip — every 30 min (feature-flagged, enabled by default)
  if (
    String(process.env.HOST_PARTNER_DRIP_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false"
  ) {
    cron.schedule("*/30 * * * *", async () => {
      try {
        const result = await runHostPartnerLeadDripCron();
        if ((result as any)?.sent) {
          console.log("[drip] Host partner lead sequence sent:", result);
        }
      } catch (error) {
        console.error("[drip] Host partner lead sequence failed:", error);
      }
    });
  }

  // Parking Pass completion reminders — 1st of each month at 9:00 AM
  cron.schedule("0 9 1 * *", async () => {
    console.log("⏰ Triggering Parking Pass Completion Reminders");
    try {
      const stats = await remindIncompleteParkingPassHosts();
      console.log("✅ Parking Pass Completion Reminders Completed:", stats);
    } catch (error) {
      console.error("❌ Parking Pass Completion Reminders Failed:", error);
    }
  });

  // Social post queue processor — every 10 minutes (enabled by default)
  if (
    String(process.env.SOCIAL_QUEUE_PROCESSOR_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false"
  ) {
    const expression = String(
      process.env.SOCIAL_QUEUE_PROCESSOR_CRON || "*/10 * * * *",
    );
    cron.schedule(expression, async () => {
      try {
        const stats = await runSocialQueueProcessor(
          Number(process.env.SOCIAL_QUEUE_PROCESSOR_BATCH || 25),
        );
        if (stats.attempted > 0) {
          console.log("[social-queue] processed:", stats);
        }
      } catch (error) {
        console.error("[social-queue] processor failed:", error);
      }
    });
  }

  // Notify unbooked events — hourly
  cron.schedule("0 * * * *", async () => {
    try {
      const stats = await notifyUnbookedEvents();
      if ((stats as any)?.sent > 0) {
        console.log("[event-notifications] unbooked events notified:", stats);
      }
    } catch (error) {
      console.error("[event-notifications] failed:", error);
    }
  });

  // Daily request log summary — 6:05 AM
  cron.schedule("5 6 * * *", async () => {
    try {
      const end = new Date();
      end.setMinutes(0, 0, 0);
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

      const [totals] = await db
        .select({
          total: sql<number>`count(*)`,
          uniqueUsers: sql<number>`count(distinct ${requestLogs.userId})`,
          avgDurationMs: sql<number>`avg(${requestLogs.durationMs})`,
        })
        .from(requestLogs)
        .where(
          and(
            gte(requestLogs.createdAt, start),
            lt(requestLogs.createdAt, end),
          ),
        );

      const statusBuckets: Array<{ statusCode: number; count: number }> =
        await db
          .select({
            statusCode: requestLogs.statusCode,
            count: sql<number>`count(*)`,
          })
          .from(requestLogs)
          .where(
            and(
              gte(requestLogs.createdAt, start),
              lt(requestLogs.createdAt, end),
            ),
          )
          .groupBy(requestLogs.statusCode)
          .orderBy(desc(sql`count(*)`));

      let topPaths: Array<{
        path: string;
        count: number;
        avgDurationMs: number;
      }> = [];
      try {
        topPaths = await db
          .select({
            path: requestLogs.path,
            count: sql<number>`count(*)`,
            avgDurationMs: sql<number>`avg(${requestLogs.durationMs})`,
          })
          .from(requestLogs)
          .where(
            and(
              gte(requestLogs.createdAt, start),
              lt(requestLogs.createdAt, end),
            ),
          )
          .groupBy(requestLogs.path)
          .orderBy(desc(sql`count(*)`))
          .limit(25);
      } catch (topPathsError: any) {
        if (isMissingColumnError(topPathsError, "duration_ms")) {
          const rows = await db
            .select({ path: requestLogs.path, count: sql<number>`count(*)` })
            .from(requestLogs)
            .where(
              and(
                gte(requestLogs.createdAt, start),
                lt(requestLogs.createdAt, end),
              ),
            )
            .groupBy(requestLogs.path)
            .orderBy(desc(sql`count(*)`))
            .limit(25);
          topPaths = rows.map((row: any) => ({
            path: row.path,
            count: Number(row.count || 0),
            avgDurationMs: 0,
          }));
        } else {
          throw topPathsError;
        }
      }

      const topErrors: Array<{
        path: string;
        statusCode: number;
        count: number;
      }> = await db
        .select({
          path: requestLogs.path,
          statusCode: requestLogs.statusCode,
          count: sql<number>`count(*)`,
        })
        .from(requestLogs)
        .where(
          and(
            gte(requestLogs.createdAt, start),
            lt(requestLogs.createdAt, end),
            gte(requestLogs.statusCode, 400),
          ),
        )
        .groupBy(requestLogs.path, requestLogs.statusCode)
        .orderBy(desc(sql`count(*)`))
        .limit(25);

      await db.insert(adminDailyReports).values({
        reportDate: start,
        reportType: "request_summary",
        summary: {
          range: { start: start.toISOString(), end: end.toISOString() },
          totals: {
            totalRequests: Number(totals?.total || 0),
            uniqueUsers: Number(totals?.uniqueUsers || 0),
            avgDurationMs: Number(totals?.avgDurationMs || 0),
          },
          statusBuckets: statusBuckets.map((row) => ({
            statusCode: row.statusCode,
            count: Number(row.count || 0),
          })),
          topPaths: topPaths.map((row) => ({
            path: row.path,
            count: Number(row.count || 0),
            avgDurationMs: Number(row.avgDurationMs || 0),
          })),
          topErrors: topErrors.map((row) => ({
            path: row.path,
            statusCode: row.statusCode,
            count: Number(row.count || 0),
          })),
        },
      });
      console.log("✅ Daily Request Log Summary Saved");
    } catch (error) {
      console.error("❌ Daily Request Log Summary Failed:", error);
    }
  });

  // Request log cleanup — every 15 min, purge logs older than 48 h
  cron.schedule("15 * * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await db.delete(requestLogs).where(lt(requestLogs.createdAt, cutoff));
    } catch (error) {
      console.error("❌ Request log cleanup failed:", error);
    }
  });

  const isSentimentSignalEventsAvailable = async () => {
    const result = await db.execute(sql`
      select to_regclass('public.sentiment_signal_events')::text as table_name
    `);
    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    return Boolean(row?.table_name);
  };

  const writeSentimentSnapshot = async (reportType: string, windowDays: number) => {
    if (!(await isSentimentSignalEventsAvailable())) {
      console.warn(`[sentiment-snapshot] skipped ${reportType}: sentiment_signal_events table missing`);
      return;
    }

    const reportDate = new Date();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const [overview] = await db
      .select({
        sampleCount: sql<number>`count(*)`.mapWith(Number),
        avgScore100: sql<number>`coalesce(avg(${sentimentSignalEvents.score100}), 0)`.mapWith(Number),
        avgDelta100: sql<number>`coalesce(avg(${sentimentSignalEvents.deltaScore100}), 0)`.mapWith(Number),
        positiveShare: sql<number>`coalesce(avg(case when ${sentimentSignalEvents.score100} >= 70 then 1 else 0 end), 0)`.mapWith(Number),
      })
      .from(sentimentSignalEvents)
      .where(gte(sentimentSignalEvents.createdAt, since));

    const topCuisineRows = await db.execute(sql<{
      key: string | null;
      sample_count: number;
      avg_delta_100: number;
      avg_score_100: number;
    }>`
      select
        sse.cuisine_type as key,
        count(*)::int as sample_count,
        coalesce(avg(sse.delta_score_100), 0)::float as avg_delta_100,
        coalesce(avg(sse.score_100), 0)::float as avg_score_100
      from sentiment_signal_events sse
      where sse.created_at >= ${since}
        and sse.cuisine_type is not null
      group by 1
      having count(*) >= 4
      order by avg_delta_100 desc, sample_count desc
      limit 12
    `);

    const topAreaRows = await db.execute(sql<{
      city: string | null;
      state: string | null;
      sample_count: number;
      avg_delta_100: number;
      avg_score_100: number;
    }>`
      select
        sse.city,
        sse.state,
        count(*)::int as sample_count,
        coalesce(avg(sse.delta_score_100), 0)::float as avg_delta_100,
        coalesce(avg(sse.score_100), 0)::float as avg_score_100
      from sentiment_signal_events sse
      where sse.created_at >= ${since}
        and sse.city is not null
      group by sse.city, sse.state
      having count(*) >= 4
      order by avg_delta_100 desc, sample_count desc
      limit 12
    `);

    await db.insert(adminDailyReports).values({
      reportDate,
      reportType,
      summary: {
        windowDays,
        generatedAt: reportDate.toISOString(),
        overview: {
          sampleCount: Number(overview?.sampleCount || 0),
          avgScore100: Number(overview?.avgScore100 || 0),
          avgDelta100: Number(overview?.avgDelta100 || 0),
          positiveShare: Number(overview?.positiveShare || 0),
        },
        topByCuisine: (Array.isArray((topCuisineRows as any)?.rows)
          ? (topCuisineRows as any).rows
          : []
        ).map((row: any) => ({
          key: row.key,
          sampleCount: Number(row.sample_count) || 0,
          avgScore100: Number(row.avg_score_100) || 0,
          avgDelta100: Number(row.avg_delta_100) || 0,
        })),
        topByArea: (Array.isArray((topAreaRows as any)?.rows)
          ? (topAreaRows as any).rows
          : []
        ).map((row: any) => ({
          key: [row.city, row.state].filter(Boolean).join(", "),
          sampleCount: Number(row.sample_count) || 0,
          avgScore100: Number(row.avg_score_100) || 0,
          avgDelta100: Number(row.avg_delta_100) || 0,
        })),
      },
    });
  };

  // Sentiment intelligence daily snapshot.
  cron.schedule("20 6 * * *", async () => {
    try {
      await writeSentimentSnapshot("sentiment_snapshot_daily", 30);
      console.log("✅ Sentiment Daily Snapshot Saved");
    } catch (error) {
      console.error("❌ Sentiment Daily Snapshot Failed:", error);
    }
  });

  // Sentiment intelligence weekly snapshot.
  cron.schedule("35 6 * * 1", async () => {
    try {
      await writeSentimentSnapshot("sentiment_snapshot_weekly", 90);
      console.log("✅ Sentiment Weekly Snapshot Saved");
    } catch (error) {
      console.error("❌ Sentiment Weekly Snapshot Failed:", error);
    }
  });

  // Parking Pass booking hold cleanup — every minute
  cron.schedule("* * * * *", async () => {
    try {
      const { eventBookings } = await import("@shared/schema");
      const cutoff = new Date(Date.now() - getParkingPassHoldTtlMs());
      const now = new Date();

      // Cancel any PaymentIntents tied to expired holds
      try {
        const expiredRows: Array<{ paymentIntentId: string | null }> = await db
          .select({ paymentIntentId: (eventBookings as any).paymentIntentId })
          .from(eventBookings)
          .where(
            and(
              (sql as any)`${(eventBookings as any).status} = 'pending'`,
              lt((eventBookings as any).createdAt, cutoff),
            ),
          )
          .limit(50);

        for (const row of expiredRows) {
          if (row.paymentIntentId) {
            try {
              const stripe = (await import("stripe")).default;
              const stripeClient = new stripe(
                process.env.STRIPE_SECRET_KEY || "",
              );
              await stripeClient.paymentIntents.cancel(row.paymentIntentId);
            } catch {
              // Best-effort — don't block cleanup on Stripe errors
            }
          }
        }
      } catch {
        // Best-effort PaymentIntent cancellation
      }

      // Delete expired holds
      await db
        .delete(eventBookings as any)
        .where(
          and(
            (sql as any)`${(eventBookings as any).status} = 'pending'`,
            lt((eventBookings as any).createdAt, cutoff),
          ),
        );
    } catch (error) {
      console.error("❌ Parking Pass hold cleanup failed:", error);
    }
  });

  // IndexNow daily sitemap submission — 4:00 AM (feature-flagged)
  if (
    String(process.env.INDEXNOW_ENABLED || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    cron.schedule("0 4 * * *", async () => {
      try {
        const cfg = getIndexNowConfig();
        if (!cfg.enabled || !cfg.key) return;
        const baseUrl = `https://${cfg.host}`;
        // Build the canonical URL list: home, discovery, city landing pages, deals, events
        const staticUrls = [
          baseUrl,
          `${baseUrl}/ai-summary.json`,
          `${baseUrl}/answers/mealscout`,
          `${baseUrl}/llms.txt`,
          `${baseUrl}/find-food`,
          `${baseUrl}/deals/featured`,
          `${baseUrl}/events`,
          `${baseUrl}/for-restaurants`,
          `${baseUrl}/for-bars`,
          `${baseUrl}/for-events`,
        ];
        // Fetch active city slugs for city landing pages
        const cityRows = await db
          .select({ slug: cities.slug })
          .from(cities)
          .limit(200);
        const cityUrls = cityRows
          .filter((r: { slug: string | null }) => r.slug)
          .map((r: { slug: string | null }) => `${baseUrl}/food-trucks/${encodeURIComponent(r.slug!)}`);

        const allUrls = [...staticUrls, ...cityUrls];
        const result = await submitIndexNowUrls(allUrls);
        console.log(`[indexnow] daily submission: ${result.submitted} URLs, status ${result.status}`);
      } catch (error) {
        console.error("[indexnow] daily cron failed:", error);
      }
    });
  }

  // VAC Pending Review Digest — daily 9:00 AM (only when there are pending reviews)
  cron.schedule("0 9 * * *", async () => {
    try {
      const { securityAuditLog, restaurants, users } = await import("@shared/schema");
      const { eq, and, desc, sql } = await import("drizzle-orm");
      const { emailService } = await import("../emailService");

      // Find unverified businesses with a recent VAC evaluation entry.
      // Deleted users are anonymized as deleted+<id>@mealscout.invalid; keep
      // those out of the operational queue so the digest only shows actionable
      // manual-review cases.
      const pendingRows = await db
        .select({
          restaurantId: restaurants.id,
          restaurantName: restaurants.name,
          ownerEmail: users.email,
          vacScore: securityAuditLog.metadata,
          createdAt: restaurants.createdAt,
        })
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .innerJoin(
          securityAuditLog,
          and(
            eq(securityAuditLog.resourceId, restaurants.id),
            eq(securityAuditLog.action, "vac:evaluate"),
          ),
        )
        .where(
          and(
            eq(restaurants.isVerified, false),
            eq(restaurants.isActive, true),
            sql`coalesce(${users.isDisabled}, false) = false`,
            sql`lower(coalesce(${users.email}, '')) not like 'deleted+%@mealscout.invalid'`,
          ),
        )
        .orderBy(desc(securityAuditLog.timestamp))
        .limit(300);

      const latestRowsByRestaurant = new Map<string, (typeof pendingRows)[number]>();
      for (const row of pendingRows) {
        const key = String(row.restaurantId || "");
        if (key && !latestRowsByRestaurant.has(key)) {
          latestRowsByRestaurant.set(key, row);
        }
      }

      const manualReviewRows = Array.from(latestRowsByRestaurant.values())
        .filter((row: { vacScore: unknown }) => {
          const meta = (row.vacScore as any) || {};
          if (meta.shouldAutoVerify === true) return false;
          if (typeof meta.outcome === "string") return meta.outcome === "manual_review";
          return true;
        })
        .slice(0, 100);

      if (manualReviewRows.length === 0) {
        console.log("[vac-digest] No pending manual reviews — skipping digest");
        return;
      }

      const entries = manualReviewRows.map((row: {
        restaurantId: unknown;
        restaurantName: unknown;
        ownerEmail: unknown;
        vacScore: unknown;
        createdAt: unknown;
      }) => {
        const meta = (row.vacScore as any) || {};
        const score = Number(meta.score ?? 0);
        const threshold = Number(meta.threshold ?? 60);
        const signals = String(meta.signalSummary || meta.signals || "");
        const createdAtValue =
          row.createdAt instanceof Date
            ? row.createdAt
            : typeof row.createdAt === "string" || typeof row.createdAt === "number"
              ? new Date(row.createdAt)
              : null;
        return {
          restaurantId: String(row.restaurantId || ""),
          restaurantName: String(row.restaurantName || "Unknown"),
          ownerEmail: String(row.ownerEmail || ""),
          vacScore: score,
          threshold,
          signals,
          createdAt: createdAtValue ? createdAtValue.toLocaleDateString() : "unknown",
        };
      });

      await emailService.sendVacPendingDigest({
        pendingCount: entries.length,
        entries,
      });
      console.log(`✅ [vac-digest] Sent digest for ${entries.length} pending review(s)`);
    } catch (error) {
      console.error("❌ [vac-digest] Daily digest failed:", error);
    }
  });

  // Market expansion recompute — daily 4:45 AM
  cron.schedule("45 4 * * *", async () => {
    try {
      const result = await runMarketExpansionScoreRecompute({ limitCities: 120 });
      console.log("[market-expansion] Daily recompute complete", result);
    } catch (error) {
      console.error("[market-expansion] Daily recompute failed:", error);
    }
  });

  // Market expansion state transitions — daily 5:00 AM
  cron.schedule("0 5 * * *", async () => {
    try {
      const result = await runMarketExpansionStateTransition({
        limitCities: 80,
        maxActivations: 1,
      });
      console.log("[market-expansion] Daily state transition complete", result);
    } catch (error) {
      console.error("[market-expansion] Daily state transition failed:", error);
    }
  });

  // Market expansion partner directory autopopulate — daily 5:15 AM
  cron.schedule("15 5 * * *", async () => {
    try {
      const result = await autoPopulateDirectoryForActiveCities({
        limitCities: 12,
        limitPerCity: 30,
        minQualityScore: 60,
        includeCommissary: true,
        includeDelivery: true,
        includeTruckCommissary: true,
      });
      console.log("[market-expansion] Daily directory autopopulate complete", result);
    } catch (error) {
      console.error("[market-expansion] Daily directory autopopulate failed:", error);
    }
  });

  // Google business profile enrichment — keeps new public share cards and profiles
  // supplied with listing photos, ratings, phone, website, and hours when Google has them.
  const googleAutoLinkSchedule =
    process.env.GOOGLE_AUTOLINK_CRON || "17 * * * *";
  if (
    String(process.env.GOOGLE_AUTOLINK_CRON_ENABLED || "true").toLowerCase() !==
      "false" &&
    cron.validate(googleAutoLinkSchedule)
  ) {
    cron.schedule(googleAutoLinkSchedule, async () => {
      try {
        const result = await runGoogleBusinessAutoLinkBackfill({
          context: "scheduler",
        });
        console.log("[google-autolink] complete", result);
      } catch (error) {
        console.error("[google-autolink] failed:", error);
      }
    });
  } else if (!cron.validate(googleAutoLinkSchedule)) {
    console.warn(
      `[google-autolink] invalid cron expression "${googleAutoLinkSchedule}" — skipping registration`,
    );
  }

  // Menu auto-refresh — re-scrape stale URL-imported menus.
  // Default 4:30 AM daily; override with MENU_AUTO_REFRESH_CRON.
  const menuRefreshSchedule = process.env.MENU_AUTO_REFRESH_CRON || "30 4 * * *";
  if (cron.validate(menuRefreshSchedule)) {
    cron.schedule(menuRefreshSchedule, async () => {
      try {
        const summary = await runMenuAutoRefreshCron();
        console.log("[menu-auto-refresh] complete", summary);
      } catch (error) {
        console.error("[menu-auto-refresh] failed:", error);
      }
    });
  } else {
    console.warn(
      `[menu-auto-refresh] invalid cron expression "${menuRefreshSchedule}" — skipping registration`,
    );
  }

  console.log("✅ All schedulers registered");
}
