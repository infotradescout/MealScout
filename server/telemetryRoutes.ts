import { Router } from "express";
import { db } from "./db";
import {
  telemetryEvents,
  events,
  eventInterests,
  eventSeries,
  hosts,
  users,
} from "@shared/schema";
import { eq, and, gte, sql, desc, inArray } from "drizzle-orm";
import { isAdmin } from "./unifiedAuth";

const router = Router();

// Helper to get date ranges
const getRange = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const UX_RECOVERY_EVENT_NAMES = [
  "search_did_you_mean_clicked",
  "search_location_request_primary",
  "search_location_request_quick",
  "search_location_request_empty",
  "search_location_request_sticky",
  "search_open_map_quick",
  "search_open_map_empty",
  "search_open_map_sticky",
  "search_featured_empty",
  "home_location_request_quick",
  "home_location_request_sticky",
  "home_open_map_quick",
  "home_open_map_sticky",
  "home_open_featured_quick",
  "map_cluster_preview_opened",
  "map_cluster_zoom_in_clicked",
] as const;

const PREMIUM_OPS_EVENT_NAMES = [
  "premium_summary_viewed",
  "premium_summary_emailed",
  "premium_live_location_used",
  "premium_manual_schedule_used",
] as const;

const TRACTION_FUNNEL_EVENT_NAMES = [
  "funnel_landing_view",
  "funnel_primary_cta_click",
  "funnel_signup_started",
  "funnel_signup_submitted",
  "funnel_signup_completed",
  "funnel_activation_started",
] as const;

const IMPORT_SYSTEM_EMAIL =
  process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us";

/**
 * GET /api/admin/telemetry/velocity
 * Interest creation velocity (last 7/30/90 days)
 */
router.get("/velocity", isAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = getRange(days);

    const velocity = await db
      .select({
        date: sql<string>`DATE(created_at)`,
        count: sql<number>`count(*)`,
      })
      .from(eventInterests)
      .where(gte(eventInterests.createdAt, startDate))
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`);

    res.json(velocity);
  } catch (error) {
    console.error("Error fetching telemetry velocity:", error);
    res.status(500).json({ error: "Failed to fetch velocity data" });
  }
});

/**
 * GET /api/admin/telemetry/premium-ops
 * Premium operator adoption metrics for weekly summary and usage events
 */
router.get("/premium-ops", isAdmin, async (req, res) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days as string) || 30, 1),
      90,
    );
    const startDate = getRange(days);

    const [totalsRows, dailyRows] = await Promise.all([
      db
        .select({
          eventName: telemetryEvents.eventName,
          count: sql<number>`count(*)`,
          uniqueUsers: sql<number>`count(distinct user_id)`,
        })
        .from(telemetryEvents)
        .where(
          and(
            gte(telemetryEvents.createdAt, startDate),
            inArray(telemetryEvents.eventName, [...PREMIUM_OPS_EVENT_NAMES]),
          ),
        )
        .groupBy(telemetryEvents.eventName),
      db
        .select({
          date: sql<string>`DATE(${telemetryEvents.createdAt})`,
          eventName: telemetryEvents.eventName,
          count: sql<number>`count(*)`,
        })
        .from(telemetryEvents)
        .where(
          and(
            gte(telemetryEvents.createdAt, startDate),
            inArray(telemetryEvents.eventName, [...PREMIUM_OPS_EVENT_NAMES]),
          ),
        )
        .groupBy(
          sql`DATE(${telemetryEvents.createdAt})`,
          telemetryEvents.eventName,
        )
        .orderBy(sql`DATE(${telemetryEvents.createdAt})`),
    ]);

    const totalsByEvent = Object.fromEntries(
      totalsRows.map(
        (row: { eventName: string; count: number; uniqueUsers: number }) => [
          row.eventName,
          {
            count: Number(row.count || 0),
            uniqueUsers: Number(row.uniqueUsers || 0),
          },
        ],
      ),
    );

    const byDate = new Map<
      string,
      {
        date: string;
        premium_summary_viewed: number;
        premium_summary_emailed: number;
        premium_live_location_used: number;
        premium_manual_schedule_used: number;
      }
    >();

    for (const row of dailyRows) {
      const date = String(row.date);
      const existing = byDate.get(date) || {
        date,
        premium_summary_viewed: 0,
        premium_summary_emailed: 0,
        premium_live_location_used: 0,
        premium_manual_schedule_used: 0,
      };

      const count = Number(row.count || 0);
      if (row.eventName === "premium_summary_viewed") {
        existing.premium_summary_viewed = count;
      } else if (row.eventName === "premium_summary_emailed") {
        existing.premium_summary_emailed = count;
      } else if (row.eventName === "premium_live_location_used") {
        existing.premium_live_location_used = count;
      } else if (row.eventName === "premium_manual_schedule_used") {
        existing.premium_manual_schedule_used = count;
      }

      byDate.set(date, existing);
    }

    const history = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    res.json({
      days,
      totals: {
        summaryViewed: totalsByEvent.premium_summary_viewed?.count || 0,
        summaryViewedUniqueUsers:
          totalsByEvent.premium_summary_viewed?.uniqueUsers || 0,
        summaryEmailed: totalsByEvent.premium_summary_emailed?.count || 0,
        summaryEmailedUniqueUsers:
          totalsByEvent.premium_summary_emailed?.uniqueUsers || 0,
        liveLocationUsed: totalsByEvent.premium_live_location_used?.count || 0,
        liveLocationUsedUniqueUsers:
          totalsByEvent.premium_live_location_used?.uniqueUsers || 0,
        manualScheduleUsed:
          totalsByEvent.premium_manual_schedule_used?.count || 0,
        manualScheduleUsedUniqueUsers:
          totalsByEvent.premium_manual_schedule_used?.uniqueUsers || 0,
      },
      history,
    });
  } catch (error) {
    console.error("Error fetching premium ops telemetry:", error);
    res.status(500).json({ error: "Failed to fetch premium ops telemetry" });
  }
});

/**
 * GET /api/admin/telemetry/fill-rates
 * Fill rate distribution and over-capacity events
 */
router.get("/fill-rates", isAdmin, async (req, res) => {
  try {
    // Get all events with their interests
    const allEvents = await db.query.events.findMany({
      with: {
        interests: true,
      },
    });

    const fillRates: number[] = [];
    let overCapacityCount = 0;
    let totalEvents = 0;

    for (const event of allEvents) {
      const acceptedCount = event.interests.filter(
        (i: any) => i.status === "accepted",
      ).length;
      const max = event.maxTrucks || 1; // Avoid division by zero

      if (max > 0) {
        const rate = Math.min(acceptedCount / max, 1.5); // Cap at 150% for viz
        fillRates.push(rate);
        totalEvents++;

        if (acceptedCount >= max) {
          overCapacityCount++;
        }
      }
    }

    // Create histogram buckets (0-10%, 10-20%, ..., 100%+)
    const buckets = new Array(11).fill(0);
    fillRates.forEach((rate) => {
      const index = Math.min(Math.floor(rate * 10), 10);
      buckets[index]++;
    });

    res.json({
      buckets: buckets.map((count, i) => ({
        range: i === 10 ? "100%+" : `${i * 10}-${(i + 1) * 10}%`,
        count,
      })),
      overCapacityPercentage:
        totalEvents > 0 ? (overCapacityCount / totalEvents) * 100 : 0,
      totalEvents,
    });
  } catch (error) {
    console.error("Error fetching fill rates:", error);
    res.status(500).json({ error: "Failed to fetch fill rate data" });
  }
});

/**
 * GET /api/admin/telemetry/decision-time
 * Time from interest creation to decision (accepted/declined)
 */
router.get("/decision-time", isAdmin, async (req, res) => {
  try {
    // We need to join eventInterests with telemetryEvents or infer from updated_at if available
    // Since schema doesn't have 'decidedAt', we might need to rely on telemetry if available,
    // or use createdAt vs updatedAt for interests that are not pending.
    // For v1, let's use telemetry_events if we have 'interest_accepted'/'interest_declined' events,
    // OR just use the difference between interest.createdAt and interest.updatedAt for non-pending interests.

    // Using interest table timestamps as a proxy for now (assuming updatedAt is when decision happened)
    const decisions = await db
      .select({
        created: eventInterests.createdAt,
        // We don't have a separate decidedAt, so we assume updatedAt is the decision time for non-pending
        decided: sql<Date>`CASE WHEN status != 'pending' THEN created_at ELSE NULL END`, // Wait, schema has no updatedAt for interests?
      })
      .from(eventInterests)
      .where(sql`status != 'pending'`);

    // Wait, let's check schema for eventInterests
    // It only has createdAt. It does NOT have updatedAt.
    // We must rely on telemetry_events for this, or we can't calculate it accurately yet.
    // Let's check telemetry_events for 'interest_accepted' and 'interest_declined'.

    const decisionEvents = await db
      .select({
        eventName: telemetryEvents.eventName,
        createdAt: telemetryEvents.createdAt,
        properties: telemetryEvents.properties,
      })
      .from(telemetryEvents)
      .where(
        and(
          sql`event_name IN ('interest_accepted', 'interest_declined')`,
          gte(telemetryEvents.createdAt, getRange(90)),
        ),
      );

    // This requires us to match these events back to the creation time of the interest.
    // If telemetry doesn't have the creation time, we might be stuck.
    // Alternative: For v1, if we can't calculate it accurately, we return a placeholder or
    // we add 'updatedAt' to eventInterests in a future migration.

    // CHECK: Does telemetry event have 'interestId'?
    // If so, we can fetch the interest creation time.

    // For now, let's return a "Not Available" state or simplified metric if data is missing.

    res.json({
      medianHours: 0,
      p75Hours: 0,
      note: "Requires 'updatedAt' on event_interests or correlation with creation logs.",
    });
  } catch (error) {
    console.error("Error fetching decision time:", error);
    res.status(500).json({ error: "Failed to fetch decision time data" });
  }
});

/**
 * GET /api/admin/telemetry/digest-coverage
 * Weekly digests sent vs eligible hosts
 */
router.get("/digest-coverage", isAdmin, async (req, res) => {
  try {
    // 1. Get digest sent counts by week from telemetry
    const sentCounts = await db
      .select({
        week: sql<string>`properties->>'week'`,
        count: sql<number>`count(*)`,
      })
      .from(telemetryEvents)
      .where(eq(telemetryEvents.eventName, "weekly_digest_sent"))
      .groupBy(sql`properties->>'week'`)
      .orderBy(desc(sql`properties->>'week'`))
      .limit(12); // Last 12 weeks

    // 2. Get currently eligible hosts (host has email + has not opted out of weekly digest emails)
    const eligibleHosts = await db
      .select({ count: sql<number>`count(*)` })
      .from(hosts)
      .innerJoin(users, eq(users.id, hosts.userId))
      .where(
        sql`coalesce(nullif(${users.email}, ''), '') <> ''
            and coalesce((${users.accountSettings}->'notifications'->'channels'->>'email')::boolean, true) = true
            and coalesce((${users.accountSettings}->'notifications'->'topics'->>'weeklyDigest')::boolean, true) = true`,
      );
    const eligibleCount = Number(eligibleHosts?.[0]?.count || 0);

    res.json({
      history: sentCounts.map((row: any) => ({
        week: row.week,
        sent: Number(row.count),
        eligible: Number(eligibleCount), // simplified: assuming constant host count for history
        coverage:
          eligibleCount > 0
            ? Math.round((Number(row.count) / Number(eligibleCount)) * 100)
            : 0,
      })),
    });
  } catch (error) {
    console.error("Error fetching digest coverage:", error);
    res.status(500).json({ error: "Failed to fetch digest coverage" });
  }
});

/**
 * GET /api/admin/telemetry/ux-recovery
 * Aggregated UX recovery funnel events for recent windows
 */
router.get("/ux-recovery", isAdmin, async (req, res) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days as string) || 7, 1),
      90,
    );
    const startDate = getRange(days);

    const rows = await db
      .select({
        eventName: telemetryEvents.eventName,
        count: sql<number>`count(*)`,
        uniqueUsers: sql<number>`count(distinct user_id)`,
      })
      .from(telemetryEvents)
      .where(
        and(
          gte(telemetryEvents.createdAt, startDate),
          inArray(telemetryEvents.eventName, [...UX_RECOVERY_EVENT_NAMES]),
        ),
      )
      .groupBy(telemetryEvents.eventName)
      .orderBy(desc(sql`count(*)`));

    const byEventName = Object.fromEntries(
      rows.map(
        (row: { eventName: string; count: number; uniqueUsers: number }) => [
          row.eventName,
          {
            count: Number(row.count || 0),
            uniqueUsers: Number(row.uniqueUsers || 0),
          },
        ],
      ),
    );

    const events = UX_RECOVERY_EVENT_NAMES.map((name) => ({
      eventName: name,
      count: byEventName[name]?.count || 0,
      uniqueUsers: byEventName[name]?.uniqueUsers || 0,
    }));

    const totals = events.reduce(
      (acc, item) => {
        acc.totalEvents += item.count;
        acc.totalUniqueUsers += item.uniqueUsers;
        return acc;
      },
      { totalEvents: 0, totalUniqueUsers: 0 },
    );

    res.json({
      days,
      totals,
      events,
      topEvents: [...events].sort((a, b) => b.count - a.count).slice(0, 8),
    });
  } catch (error) {
    console.error("Error fetching ux recovery telemetry:", error);
    res.status(500).json({ error: "Failed to fetch ux recovery telemetry" });
  }
});

/**
 * GET /api/admin/telemetry/open-call-series
 * Open-call series operator metrics:
 * - Fill rate for upcoming occurrences
 * - Acceptance throughput (accepted/declined decisions)
 * - Cancellation impact (occurrences cancelled + trucks notified)
 */
router.get("/open-call-series", isAdmin, async (req, res) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days as string) || 30, 1),
      90,
    );
    const decisionsSince = getRange(days);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingWindowDays = Math.min(
      Math.max(parseInt(req.query.upcomingDays as string) || 30, 7),
      90,
    );
    const upcomingUntil = new Date(today);
    upcomingUntil.setDate(upcomingUntil.getDate() + upcomingWindowDays);

    const [
      publishedSeriesRows,
      upcomingCapacityRows,
      upcomingAcceptedRows,
      throughputRows,
      cancellationRows,
      seriesBreakdownRows,
    ] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(eventSeries)
        .where(
          and(
            inArray(eventSeries.seriesType, ["event", "open_call"]),
            eq(eventSeries.status, "published"),
          ),
        ),
      db.execute(sql`
        select
          count(*)::int as events_count,
          coalesce(sum(e.max_trucks), 0)::int as capacity_total
        from events e
        inner join event_series s on s.id = e.series_id
        where s.series_type in ('event', 'open_call')
          and e.date >= ${today}
          and e.date < ${upcomingUntil}
          and e.status in ('open', 'booked')
      `),
      db.execute(sql`
        select count(*)::int as accepted_total
        from event_interests i
        inner join events e on e.id = i.event_id
        inner join event_series s on s.id = e.series_id
        where i.status = 'accepted'
          and s.series_type in ('event', 'open_call')
          and e.date >= ${today}
          and e.date < ${upcomingUntil}
          and e.status in ('open', 'booked')
      `),
      db.execute(sql`
        select
          t.event_name as event_name,
          count(*)::int as count
        from telemetry_events t
        inner join events e on (t.properties->>'eventId') = e.id
        where t.event_name in ('interest_accepted', 'interest_declined')
          and t.created_at >= ${decisionsSince}
          and e.series_id is not null
        group by t.event_name
      `),
      db.execute(sql`
        select
          count(*)::int as series_cancelled,
          coalesce(sum(coalesce(nullif(t.properties->>'futureOccurrencesCancelled', ''), '0')::int), 0)::int as occurrences_cancelled,
          coalesce(sum(coalesce(nullif(t.properties->>'trucksNotified', ''), '0')::int), 0)::int as trucks_impacted
        from telemetry_events t
        where t.event_name = 'series_cancelled'
          and t.created_at >= ${decisionsSince}
      `),
      db.execute(sql`
        select
          s.id as series_id,
          s.name as series_name,
          count(distinct e.id)::int as event_count,
          coalesce(sum(e.max_trucks), 0)::int as capacity_total,
          count(i.id) filter (where i.status = 'accepted')::int as accepted_total
        from event_series s
        inner join events e on e.series_id = s.id
        left join event_interests i on i.event_id = e.id
        where s.series_type in ('event', 'open_call')
          and e.date >= ${today}
          and e.date < ${upcomingUntil}
          and e.status in ('open', 'booked')
        group by s.id, s.name
        order by accepted_total desc, capacity_total desc
        limit 12
      `),
    ]);

    const publishedSeriesCount = Number(
      (publishedSeriesRows?.[0] as any)?.count || 0,
    );

    const upcomingCapacityRow = Array.isArray(
      (upcomingCapacityRows as any)?.rows,
    )
      ? (upcomingCapacityRows as any).rows[0]
      : Array.isArray(upcomingCapacityRows)
        ? (upcomingCapacityRows as any)[0]
        : null;

    const upcomingAcceptedRow = Array.isArray(
      (upcomingAcceptedRows as any)?.rows,
    )
      ? (upcomingAcceptedRows as any).rows[0]
      : Array.isArray(upcomingAcceptedRows)
        ? (upcomingAcceptedRows as any)[0]
        : null;

    const throughputSource = Array.isArray((throughputRows as any)?.rows)
      ? (throughputRows as any).rows
      : Array.isArray(throughputRows)
        ? throughputRows
        : [];

    const cancellationRow = Array.isArray((cancellationRows as any)?.rows)
      ? (cancellationRows as any).rows[0]
      : Array.isArray(cancellationRows)
        ? (cancellationRows as any)[0]
        : null;

    const seriesRows = Array.isArray((seriesBreakdownRows as any)?.rows)
      ? (seriesBreakdownRows as any).rows
      : Array.isArray(seriesBreakdownRows)
        ? seriesBreakdownRows
        : [];

    const upcomingEventsCount = Number(upcomingCapacityRow?.events_count || 0);
    const upcomingCapacityTotal = Number(
      upcomingCapacityRow?.capacity_total || 0,
    );
    const upcomingAcceptedTotal = Number(
      upcomingAcceptedRow?.accepted_total || 0,
    );
    const fillRatePct =
      upcomingCapacityTotal > 0
        ? Number(
            ((upcomingAcceptedTotal / upcomingCapacityTotal) * 100).toFixed(2),
          )
        : 0;

    const throughputByName = new Map<string, number>(
      throughputSource.map((row: any) => [
        String(row.event_name || ""),
        Number(row.count || 0),
      ]),
    );

    const acceptedDecisions = throughputByName.get("interest_accepted") || 0;
    const declinedDecisions = throughputByName.get("interest_declined") || 0;
    const throughputTotal = acceptedDecisions + declinedDecisions;
    const acceptanceRatePct =
      throughputTotal > 0
        ? Number(((acceptedDecisions / throughputTotal) * 100).toFixed(2))
        : 0;

    res.json({
      days,
      upcomingWindowDays,
      totals: {
        publishedSeries: publishedSeriesCount,
        upcomingOccurrences: upcomingEventsCount,
        upcomingCapacity: upcomingCapacityTotal,
        acceptedUpcoming: upcomingAcceptedTotal,
        fillRatePct,
        acceptedDecisions,
        declinedDecisions,
        acceptanceRatePct,
        seriesCancelled: Number(cancellationRow?.series_cancelled || 0),
        occurrencesCancelled: Number(
          cancellationRow?.occurrences_cancelled || 0,
        ),
        trucksImpacted: Number(cancellationRow?.trucks_impacted || 0),
      },
      topSeries: (seriesRows as any[]).map((row: any) => {
        const accepted = Number(row.accepted_total || 0);
        const capacity = Number(row.capacity_total || 0);
        const rowFillRate =
          capacity > 0 ? Number(((accepted / capacity) * 100).toFixed(2)) : 0;
        return {
          seriesId: String(row.series_id || ""),
          seriesName: String(row.series_name || "Untitled series"),
          eventCount: Number(row.event_count || 0),
          capacityTotal: capacity,
          acceptedTotal: accepted,
          fillRatePct: rowFillRate,
        };
      }),
    });
  } catch (error) {
    console.error("Error fetching open-call series telemetry:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch open-call series telemetry" });
  }
});

/**
 * GET /api/admin/telemetry/funnel
 * Traction sprint funnel from landing traffic to activation start.
 */
router.get("/funnel", isAdmin, async (req, res) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days as string) || 30, 1),
      90,
    );
    const startDate = getRange(days);

    const [totalsRows, accountTypeRows] = await Promise.all([
      db
        .select({
          eventName: telemetryEvents.eventName,
          count: sql<number>`count(*)`,
          uniqueUsers: sql<number>`count(distinct user_id)`,
          uniqueActors: sql<number>`count(distinct coalesce(${telemetryEvents.userId}::text, nullif(${telemetryEvents.properties}->>'anonSessionId', '')))`,
        })
        .from(telemetryEvents)
        .where(
          and(
            gte(telemetryEvents.createdAt, startDate),
            inArray(telemetryEvents.eventName, [
              ...TRACTION_FUNNEL_EVENT_NAMES,
            ]),
          ),
        )
        .groupBy(telemetryEvents.eventName),
      db
        .select({
          accountType: sql<string>`coalesce(${telemetryEvents.properties}->>'accountType', 'unknown')`,
          count: sql<number>`count(*)`,
        })
        .from(telemetryEvents)
        .where(
          and(
            gte(telemetryEvents.createdAt, startDate),
            inArray(telemetryEvents.eventName, [
              "funnel_signup_started",
              "funnel_signup_submitted",
              "funnel_signup_completed",
              "funnel_activation_started",
            ]),
          ),
        )
        .groupBy(
          sql`coalesce(${telemetryEvents.properties}->>'accountType', 'unknown')`,
        ),
    ]);

    const totalsByEvent = Object.fromEntries(
      totalsRows.map(
        (row: {
          eventName: string;
          count: number;
          uniqueUsers: number;
          uniqueActors: number;
        }) => [
          row.eventName,
          {
            count: Number(row.count || 0),
            uniqueUsers: Number(row.uniqueUsers || 0),
            uniqueActors: Number(row.uniqueActors || 0),
          },
        ],
      ),
    );

    const stepCounts = {
      landingView: totalsByEvent.funnel_landing_view?.count || 0,
      primaryCtaClick: totalsByEvent.funnel_primary_cta_click?.count || 0,
      signupStarted: totalsByEvent.funnel_signup_started?.count || 0,
      signupSubmitted: totalsByEvent.funnel_signup_submitted?.count || 0,
      signupCompleted: totalsByEvent.funnel_signup_completed?.count || 0,
      activationStarted: totalsByEvent.funnel_activation_started?.count || 0,
    };

    const rate = (numerator: number, denominator: number) => {
      if (!denominator || denominator <= 0) return 0;
      return Number(((numerator / denominator) * 100).toFixed(2));
    };

    res.json({
      days,
      steps: stepCounts,
      rates: {
        ctrLandingToCta: rate(
          stepCounts.primaryCtaClick,
          stepCounts.landingView,
        ),
        ctaToSignupStart: rate(
          stepCounts.signupStarted,
          stepCounts.primaryCtaClick,
        ),
        signupStartToSubmit: rate(
          stepCounts.signupSubmitted,
          stepCounts.signupStarted,
        ),
        submitToCompleted: rate(
          stepCounts.signupCompleted,
          stepCounts.signupSubmitted,
        ),
        completedToActivation: rate(
          stepCounts.activationStarted,
          stepCounts.signupCompleted,
        ),
      },
      actorCounts: {
        landingView: totalsByEvent.funnel_landing_view?.uniqueActors || 0,
        primaryCtaClick:
          totalsByEvent.funnel_primary_cta_click?.uniqueActors || 0,
        signupStarted: totalsByEvent.funnel_signup_started?.uniqueActors || 0,
        signupSubmitted:
          totalsByEvent.funnel_signup_submitted?.uniqueActors || 0,
        signupCompleted:
          totalsByEvent.funnel_signup_completed?.uniqueActors || 0,
        activationStarted:
          totalsByEvent.funnel_activation_started?.uniqueActors || 0,
      },
      byAccountType: (accountTypeRows as any[]).map((row: any) => ({
        accountType: String(row.accountType || "unknown"),
        count: Number(row.count || 0),
      })),
    });
  } catch (error) {
    console.error("Error fetching traction funnel telemetry:", error);
    res.status(500).json({ error: "Failed to fetch funnel telemetry" });
  }
});

/**
 * GET /api/admin/telemetry/heartbeat
 * Core-table growth heartbeat that does not rely on front-end event tracking.
 */
router.get("/heartbeat", isAdmin, async (req, res) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days as string) || 30, 1),
      90,
    );
    const startDate = getRange(days);
    const sevenDayStart = getRange(7);
    const thirtyDayStart = getRange(30);
    const now = new Date();
    const fourteenDaysOut = new Date(now);
    fourteenDaysOut.setDate(fourteenDaysOut.getDate() + 14);
    const importSystemEmail = String(IMPORT_SYSTEM_EMAIL || "")
      .trim()
      .toLowerCase();

    const [
      userCountsRows,
      newUsersByTypeRows,
      restaurantRows,
      eventRows,
      interestRows,
      valueRows,
    ] = await Promise.all([
      db.execute(sql`
          select
            count(*)::int as total_users,
            count(*) filter (
              where coalesce(is_disabled, false) = false
              and user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                email_verified = true
                or google_id is not null
                or facebook_id is not null
                or tradescout_id is not null
                or (password_hash is not null and coalesce(must_reset_password, false) = false)
              )
            )::int as total_activated_users,
            count(*) filter (
              where created_at >= ${startDate}
              and coalesce(is_disabled, false) = false
              and user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                email_verified = true
                or google_id is not null
                or facebook_id is not null
                or tradescout_id is not null
                or (password_hash is not null and coalesce(must_reset_password, false) = false)
              )
            )::int as new_activated_users_window,
            count(*) filter (
              where created_at >= ${sevenDayStart}
              and coalesce(is_disabled, false) = false
              and user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                email_verified = true
                or google_id is not null
                or facebook_id is not null
                or tradescout_id is not null
                or (password_hash is not null and coalesce(must_reset_password, false) = false)
              )
            )::int as new_activated_users_7d,
            count(*) filter (
              where created_at >= ${thirtyDayStart}
              and coalesce(is_disabled, false) = false
              and user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                email_verified = true
                or google_id is not null
                or facebook_id is not null
                or tradescout_id is not null
                or (password_hash is not null and coalesce(must_reset_password, false) = false)
              )
            )::int as new_activated_users_30d,
            count(*) filter (
              where user_type in ('restaurant_owner', 'food_truck', 'host', 'event_coordinator', 'supplier')
            )::int as total_supply_side_users
          from users
        `),
      db
        .select({
          userType: users.userType,
          count: sql<number>`count(*)`,
        })
        .from(users)
        .where(
          and(
            gte(users.createdAt, startDate),
            sql`coalesce(${users.isDisabled}, false) = false`,
            sql`${users.userType} not in ('admin', 'duper_admin', 'super_admin', 'staff')`,
            sql`(
                ${users.emailVerified} = true
                or ${users.googleId} is not null
                or ${users.facebookId} is not null
                or ${users.tradescoutId} is not null
                or (${users.passwordHash} is not null and coalesce(${users.mustResetPassword}, false) = false)
              )`,
          ),
        )
        .groupBy(users.userType),
      db.execute(sql`
          select
            count(*)::int as total_restaurants,
            count(*) filter (where is_food_truck = true)::int as total_food_trucks,
            count(*) filter (
              where r.is_food_truck = true
              and lower(coalesce(owner.email, '')) = ${importSystemEmail}
            )::int as imported_claimable_truck_profiles,
            count(*) filter (
              where r.is_food_truck = true
              and lower(coalesce(owner.email, '')) <> ${importSystemEmail}
              and coalesce(owner.is_disabled, false) = false
              and owner.user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                owner.email_verified = true
                or owner.google_id is not null
                or owner.facebook_id is not null
                or owner.tradescout_id is not null
                or (owner.password_hash is not null and coalesce(owner.must_reset_password, false) = false)
              )
            )::int as total_real_food_trucks,
            count(*) filter (
              where r.is_food_truck = true
              and r.created_at >= ${thirtyDayStart}
              and lower(coalesce(owner.email, '')) <> ${importSystemEmail}
              and coalesce(owner.is_disabled, false) = false
              and owner.user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                owner.email_verified = true
                or owner.google_id is not null
                or owner.facebook_id is not null
                or owner.tradescout_id is not null
                or (owner.password_hash is not null and coalesce(owner.must_reset_password, false) = false)
              )
            )::int as new_real_food_trucks_30d,
            count(*) filter (
              where r.is_food_truck = true
              and r.is_verified = true
              and lower(coalesce(owner.email, '')) <> ${importSystemEmail}
              and coalesce(owner.is_disabled, false) = false
              and owner.user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                owner.email_verified = true
                or owner.google_id is not null
                or owner.facebook_id is not null
                or owner.tradescout_id is not null
                or (owner.password_hash is not null and coalesce(owner.must_reset_password, false) = false)
              )
            )::int as verified_real_food_trucks,
            count(*) filter (
              where r.is_food_truck = true
              and r.mobile_online = true
              and lower(coalesce(owner.email, '')) <> ${importSystemEmail}
              and coalesce(owner.is_disabled, false) = false
              and owner.user_type not in ('admin', 'duper_admin', 'super_admin', 'staff')
              and (
                owner.email_verified = true
                or owner.google_id is not null
                or owner.facebook_id is not null
                or owner.tradescout_id is not null
                or (owner.password_hash is not null and coalesce(owner.must_reset_password, false) = false)
              )
            )::int as real_trucks_currently_online
          from restaurants r
          left join users owner on owner.id = r.owner_id
        `),
      db.execute(sql`
          select
            count(*) filter (where date >= ${now} and date <= ${fourteenDaysOut} and status in ('open', 'booked'))::int as events_upcoming_14d,
            count(*) filter (where created_at >= ${thirtyDayStart})::int as events_created_30d,
            count(distinct host_id) filter (where date >= ${startDate})::int as active_hosts_window
          from events
        `),
      db.execute(sql`
          select
            count(*) filter (where created_at >= ${thirtyDayStart})::int as interests_30d,
            count(*) filter (where created_at >= ${thirtyDayStart} and status = 'accepted')::int as interests_accepted_30d,
            count(distinct truck_id) filter (where created_at >= ${startDate})::int as active_trucks_window
          from event_interests
        `),
      db.execute(sql`
          select
            count(*) filter (
              where is_active = true
              and start_date <= ${now}
              and (end_date is null or end_date >= ${now})
            )::int as active_deals_now,
            count(*) filter (where created_at >= ${thirtyDayStart})::int as deals_created_30d,
            (select count(*)::int from deal_claims where claimed_at >= ${thirtyDayStart}) as deal_claims_30d,
            (select count(*)::int from location_requests where created_at >= ${thirtyDayStart}) as location_requests_30d,
            (select count(*)::int from pensacola_report_leads where created_at >= ${thirtyDayStart}) as pensacola_leads_30d,
            (select count(*)::int from host_partner_leads where created_at >= ${thirtyDayStart}) as host_partner_leads_30d
          from deals
        `),
    ]);

    const userCounts = userCountsRows.rows[0] as any;
    const restaurantCounts = restaurantRows.rows[0] as any;
    const eventCounts = eventRows.rows[0] as any;
    const interestCounts = interestRows.rows[0] as any;
    const valueCounts = valueRows.rows[0] as any;

    const interests30d = Number(interestCounts?.interests_30d || 0);
    const interestsAccepted30d = Number(
      interestCounts?.interests_accepted_30d || 0,
    );
    const acceptanceRatePct =
      interests30d > 0
        ? Number(((interestsAccepted30d / interests30d) * 100).toFixed(1))
        : 0;

    res.json({
      days,
      generatedAt: new Date().toISOString(),
      users: {
        totalUsers: Number(userCounts?.total_users || 0),
        totalActivatedUsers: Number(userCounts?.total_activated_users || 0),
        totalSupplySideUsers: Number(userCounts?.total_supply_side_users || 0),
        newUsersWindow: Number(userCounts?.new_activated_users_window || 0),
        newUsers7d: Number(userCounts?.new_activated_users_7d || 0),
        newUsers30d: Number(userCounts?.new_activated_users_30d || 0),
        newUsersByTypeWindow: (
          newUsersByTypeRows as Array<{
            userType: string | null;
            count: number;
          }>
        ).map((row) => ({
          userType: String(row.userType || "unknown"),
          count: Number(row.count || 0),
        })),
      },
      marketplace: {
        totalRestaurants: Number(restaurantCounts?.total_restaurants || 0),
        totalFoodTrucks: Number(restaurantCounts?.total_food_trucks || 0),
        totalRealFoodTrucks: Number(
          restaurantCounts?.total_real_food_trucks || 0,
        ),
        importedClaimableTruckProfiles: Number(
          restaurantCounts?.imported_claimable_truck_profiles || 0,
        ),
        newFoodTrucks30d: Number(
          restaurantCounts?.new_real_food_trucks_30d || 0,
        ),
        verifiedFoodTrucks: Number(
          restaurantCounts?.verified_real_food_trucks || 0,
        ),
        trucksCurrentlyOnline: Number(
          restaurantCounts?.real_trucks_currently_online || 0,
        ),
        activeTrucksWindow: Number(interestCounts?.active_trucks_window || 0),
        activeHostsWindow: Number(eventCounts?.active_hosts_window || 0),
        eventsUpcoming14d: Number(eventCounts?.events_upcoming_14d || 0),
        eventsCreated30d: Number(eventCounts?.events_created_30d || 0),
        interests30d,
        interestsAccepted30d,
        acceptanceRatePct,
      },
      value: {
        activeDealsNow: Number(valueCounts?.active_deals_now || 0),
        dealsCreated30d: Number(valueCounts?.deals_created_30d || 0),
        dealClaims30d: Number(valueCounts?.deal_claims_30d || 0),
        locationRequests30d: Number(valueCounts?.location_requests_30d || 0),
        pensacolaLeads30d: Number(valueCounts?.pensacola_leads_30d || 0),
        hostPartnerLeads30d: Number(valueCounts?.host_partner_leads_30d || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching telemetry heartbeat:", error);
    res.status(500).json({ error: "Failed to fetch heartbeat telemetry" });
  }
});

export default router;
