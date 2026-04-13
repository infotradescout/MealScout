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
import { runSocialQueueProcessor } from "../services/socialQueueProcessor";
import { submitIndexNowUrls, getIndexNowConfig } from "../services/indexNow";
import { registerStoryCronJobs } from "../storiesCronJobs";
import { registerFeaturedVideoCronJobs } from "../featuredVideoCron";
import { db } from "../db";
import { requestLogs, adminDailyReports, cities } from "@shared/schema";
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
          `${baseUrl}/find-food`,
          `${baseUrl}/deals/featured`,
          `${baseUrl}/events/public`,
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

  console.log("✅ All schedulers registered");
}
