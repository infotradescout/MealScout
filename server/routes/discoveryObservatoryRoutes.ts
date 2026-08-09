import type { Express } from "express";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { requestLogs } from "@shared/schema";
import {
  DISCOVERY_PLATFORM,
  buildDiscoveryFunnel,
  buildLivingDiscoveryQueries,
  buildMealScoutFreshnessCoverage,
  emptyMealScoutFreshnessEvidence,
  findFreshnessFailures,
  isSafeDiscoveryQuery,
  normalizeDiscoveryRecord,
  rankMealScoutExperiments,
  validateDiscoveryEvidence,
  type ActiveBusinessSupply,
  type ActiveEventSupply,
  type ActiveMenuItemSupply,
  type ActiveScheduleSupply,
  type ActiveSupplySnapshot,
  type DiscoveryEvidenceRecord,
  type InternalSearchEvidence,
} from "@shared/discoveryObservatory";

import { db } from "../db";
import { isAdmin } from "../unifiedAuth";
import { evaluatePublicRestaurantIndexability } from "../seo/publicRestaurantIndexability";
import {
  DISCOVERY_OBSERVATORY_SURFACE,
  assignDiscoveryExperiment,
  externalObservationRecordId,
  persistDiscoveryEvidenceOnce,
  persistExperimentDecision,
  requestLogToDiscoveryEvidence,
} from "../services/discoveryObservatory";

type EvidenceAvailability = {
  source: string;
  state: "available" | "unknown" | "unavailable";
  detail: string;
};

const rowsOf = (result: any): any[] =>
  Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];

const asIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const asCount = (value: unknown): number => {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
};

const asBooleanOrNull = (value: unknown): boolean | null => {
  if (value === true || value === "true" || value === "t") return true;
  if (value === false || value === "false" || value === "f") return false;
  return null;
};

function countRepeated(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .filter((row) => row.count > 1)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function buildPageEvidence(records: DiscoveryEvidenceRecord[]) {
  const byPage = new Map<
    string,
    { page: string; impressions: Set<string>; actions: Set<string> }
  >();
  for (const record of records) {
    const page = record.displayedPage || record.entryPage;
    if (!page) continue;
    const row = byPage.get(page) || {
      page,
      impressions: new Set<string>(),
      actions: new Set<string>(),
    };
    const distinctKey = record.anonymousJourneyId || record.id;
    if (record.stage === "entry") row.impressions.add(distinctKey);
    if (record.stage === "action") row.actions.add(distinctKey);
    byPage.set(page, row);
  }
  return Array.from(byPage.values())
    .map((row) => ({
      page: row.page,
      impressions: row.impressions.size,
      actions: row.actions.size,
    }))
    .sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
}

function buildEntrySources(records: DiscoveryEvidenceRecord[]) {
  const sources = new Map<string, Set<string>>();
  for (const record of records.filter((row) => row.stage === "entry")) {
    const source = record.discoverySource || "unknown";
    const journeys = sources.get(source) || new Set<string>();
    journeys.add(record.anonymousJourneyId || record.id);
    sources.set(source, journeys);
  }
  return Array.from(sources, ([source, journeys]) => ({
    source,
    distinctEntries: journeys.size,
  })).sort(
    (a, b) => b.distinctEntries - a.distinctEntries || a.source.localeCompare(b.source),
  );
}

const externalObservationSchema = z
  .object({
    discoverySource: z.string().trim().min(1).max(80),
    observationResult: z.enum([
      "observed",
      "not_observed",
      "unknown",
      "unavailable",
    ]),
    searchSurface: z.string().trim().min(1).max(120),
    queryEvidenceState: z.enum(["known", "unknown", "unavailable"]),
    query: z.string().trim().min(2).max(160).optional().nullable(),
    locationContext: z.string().trim().max(160).optional().nullable(),
    deviceContext: z.string().trim().max(80).optional().nullable(),
    observedAt: z.string().trim().min(10).max(80),
    observationPrecision: z.enum(["instant", "day"]),
    displayedPage: z.string().trim().max(500).optional().nullable(),
    publicEntity: z
      .object({
        type: z.enum(["truck", "restaurant", "event", "menu", "host", "unknown"]),
        id: z.string().trim().max(120).optional().nullable(),
        name: z.string().trim().max(200).optional().nullable(),
      })
      .default({ type: "unknown", id: null, name: null }),
    sourceFreshness: z.object({
      state: z.enum(["current", "stale", "unknown", "unavailable"]),
      checkedAt: z.string().trim().min(10).max(80).optional().nullable(),
      checkedAtPrecision: z.enum(["instant", "day"]).optional().nullable(),
      basis: z.string().trim().min(1).max(300),
    }),
    competitors: z.array(z.string().trim().min(1).max(160)).max(25).default([]),
    outsideSources: z.array(z.string().trim().min(1).max(160)).max(25).default([]),
    evidenceBoundary: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const hasQuery = Boolean(value.query?.trim());
    if (value.queryEvidenceState === "known") {
      if (!hasQuery || !isSafeDiscoveryQuery(value.query)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["query"],
          message: "Known query evidence requires a safe, nonempty query.",
        });
      }
    } else if (hasQuery) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["query"],
        message: "Unknown or unavailable query evidence must use a null query.",
      });
    }
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    const isValidDay = (candidate: string) => {
      if (!dateOnly.test(candidate)) return false;
      const parsed = new Date(`${candidate}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === candidate
      );
    };
    if (
      (value.observationPrecision === "day" &&
        !isValidDay(value.observedAt)) ||
      (value.observationPrecision === "instant" &&
        Number.isNaN(new Date(value.observedAt).getTime()))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observedAt"],
        message: "Observation time must match its declared precision.",
      });
    }
    const checkedAt = value.sourceFreshness.checkedAt;
    const checkedPrecision = value.sourceFreshness.checkedAtPrecision;
    if (
      ["current", "stale"].includes(value.sourceFreshness.state) &&
      (!checkedAt || !checkedPrecision)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFreshness", "checkedAt"],
        message: "Current or stale source evidence requires an as-of value.",
      });
    }
    if (
      checkedAt &&
      ((checkedPrecision === "day" && !isValidDay(checkedAt)) ||
        (checkedPrecision === "instant" &&
          Number.isNaN(new Date(checkedAt).getTime())) ||
        !checkedPrecision)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFreshness", "checkedAt"],
        message: "Source as-of value must match its declared precision.",
      });
    }
  });

const experimentDecisionSchema = z
  .object({
    decision: z.enum(["hold", "approved", "rejected"]),
    decisionAuthority: z.literal("owner_review"),
    idempotencyKey: z.string().trim().min(8).max(120),
    rationale: z.string().trim().min(3).max(300),
  })
  .strict();

const experimentAssignmentSchema = z
  .object({
    anonymousJourneyId: z.string().trim().min(8).max(120),
    variant: z.enum(["control", "treatment"]),
    controlledChangeKey: z.string().trim().min(3).max(120),
  })
  .strict();

export function registerDiscoveryObservatoryRoutes(app: Express) {
  app.post(
    "/api/admin/discovery-observatory/observations",
    isAdmin,
    async (req: any, res) => {
      const parsed = externalObservationSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid independent observation",
          errors: parsed.error.flatten(),
        });
      }
      const isFutureObservation =
        parsed.data.observationPrecision === "day"
          ? parsed.data.observedAt > new Date().toISOString().slice(0, 10)
          : new Date(parsed.data.observedAt).getTime() > Date.now() + 60_000;
      if (isFutureObservation) {
        return res.status(400).json({ message: "Observation time cannot be in the future" });
      }
      const sourceCheckedAt = parsed.data.sourceFreshness.checkedAt;
      const sourceCheckedInFuture = sourceCheckedAt
        ? parsed.data.sourceFreshness.checkedAtPrecision === "day"
          ? sourceCheckedAt > new Date().toISOString().slice(0, 10)
          : new Date(sourceCheckedAt).getTime() > Date.now() + 60_000
        : false;
      if (sourceCheckedInFuture) {
        return res.status(400).json({
          message: "Source freshness as-of time cannot be in the future",
        });
      }
      const source = parsed.data.discoverySource.toLowerCase();
      if (["internal", "internal_search", "mealscout"].includes(source)) {
        return res.status(400).json({
          message: "Observation must describe an independently observed outside surface",
        });
      }

      const normalizedObservation = normalizeDiscoveryRecord({
        id: "observation-fingerprint-pending",
        platform: DISCOVERY_PLATFORM,
        stage: "observation",
        observationResult: parsed.data.observationResult,
        discoverySource: parsed.data.discoverySource,
        searchSurface: parsed.data.searchSurface,
        query: parsed.data.query || null,
        queryEvidenceState: parsed.data.queryEvidenceState,
        locationContext: parsed.data.locationContext || null,
        deviceContext: parsed.data.deviceContext || null,
        observedAt: parsed.data.observedAt,
        observationPrecision: parsed.data.observationPrecision,
        displayedPage: parsed.data.displayedPage || null,
        entryPage: null,
        publicEntity: {
          type: parsed.data.publicEntity.type,
          id: parsed.data.publicEntity.id || null,
          name: parsed.data.publicEntity.name || null,
        },
        anonymousJourneyId: null,
        intendedAction: null,
        completedAction: null,
        merchantReceiptStatus: null,
        merchantReceiptEvidenceRef: null,
        merchantReceiptVerifiedAt: null,
        finalOutcome: null,
        experimentId: null,
        experimentAssignedAt: null,
        experimentDecision: null,
        experimentVariant: null,
        controlledChangeKey: null,
        linkStrength: "unknown_unavailable",
        sourceFreshness: {
          state: parsed.data.sourceFreshness.state,
          checkedAt: parsed.data.sourceFreshness.checkedAt || null,
          checkedAtPrecision:
            parsed.data.sourceFreshness.checkedAtPrecision || null,
          basis: parsed.data.sourceFreshness.basis,
        },
        freshness: emptyMealScoutFreshnessEvidence(),
        competitors: parsed.data.competitors,
        outsideSources: parsed.data.outsideSources,
        resultCount: null,
        evidenceBoundary: parsed.data.evidenceBoundary,
      });
      const record = normalizeDiscoveryRecord({
        ...normalizedObservation,
        id: externalObservationRecordId(normalizedObservation),
      });
      const persisted = await persistDiscoveryEvidenceOnce(record);
      return res.status(persisted.inserted ? 201 : 200).json({
        observation: persisted.record,
        replayed: !persisted.inserted,
      });
    },
  );

  app.post(
    "/api/admin/discovery-observatory/experiments/:experimentId/decision",
    isAdmin,
    async (req: any, res) => {
      const parsed = experimentDecisionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid owner-review decision",
          errors: parsed.error.flatten(),
        });
      }
      try {
        const decision = await persistExperimentDecision({
          experimentId: String(req.params.experimentId || ""),
          decision: parsed.data.decision,
          idempotencyKey: parsed.data.idempotencyKey,
          rationale: parsed.data.rationale,
        });
        return res.status(200).json({
          decision,
          automaticPublication: false,
        });
      } catch (error) {
        return res.status(409).json({
          message: String((error as any)?.message || "Decision was not recorded"),
        });
      }
    },
  );

  app.post(
    "/api/admin/discovery-observatory/experiments/:experimentId/assignments",
    isAdmin,
    async (req: any, res) => {
      const parsed = experimentAssignmentSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Invalid experiment assignment",
          errors: parsed.error.flatten(),
        });
      }
      try {
        const assignment = await assignDiscoveryExperiment({
          experimentId: String(req.params.experimentId || ""),
          anonymousJourneyId: parsed.data.anonymousJourneyId,
          variant: parsed.data.variant,
          controlledChangeKey: parsed.data.controlledChangeKey,
        });
        return res.status(200).json({
          assignment,
          automaticPublication: false,
        });
      } catch (error) {
        return res.status(409).json({
          message: String((error as any)?.message || "Assignment was not recorded"),
        });
      }
    },
  );

  app.get(
    "/api/admin/discovery-observatory",
    isAdmin,
    async (req, res) => {
      const windowDaysRaw = Number(req.query.windowDays ?? 30);
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(90, Math.trunc(windowDaysRaw)))
        : 30;
      const now = new Date();
      const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
      const availability: EvidenceAvailability[] = [
        {
          source: "Google Search Console",
          state: "unavailable",
          detail: "No authorized Search Console adapter is present in this repository.",
        },
        {
          source: "Bing Webmaster Tools",
          state: "unavailable",
          detail: "No authorized Bing Webmaster adapter is present in this repository.",
        },
        {
          source: "Referral and server evidence",
          state: "available",
          detail: "MealScout request, profile, and discovery events are read from the existing request-log spine.",
        },
        {
          source: "Internal search",
          state: "available",
          detail: "Safe search queries and server-computed result counts are observed without storing private messages.",
        },
        {
          source: "Production build identity",
          state: "unavailable",
          detail: "/api/health reports health but exposes no commit or build marker, so production equality with origin/main cannot be established.",
        },
      ];

      const unavailable: Array<{ source: string; detail: string }> = [];
      const safely = async <T>(source: string, fallback: T, load: () => Promise<T>) => {
        try {
          return await load();
        } catch (error) {
          unavailable.push({
            source,
            detail: String((error as any)?.message || "Evidence source unavailable").slice(0, 240),
          });
          return fallback;
        }
      };

      const [logRows, businessRows, scheduleRows, eventRows, menuItemRows, unclaimedRows] =
        await Promise.all([
          safely<any[]>("request_logs", [], async () =>
            db
              .select()
              .from(requestLogs)
              .where(
                and(
                  inArray(requestLogs.surface, [
                    DISCOVERY_OBSERVATORY_SURFACE,
                    "public_profile",
                    "public_discovery",
                  ]),
                  or(
                    gte(requestLogs.createdAt, since),
                    and(
                      eq(requestLogs.surface, DISCOVERY_OBSERVATORY_SURFACE),
                      eq(requestLogs.eventType, "discovery_experiment"),
                    ),
                  ),
                ),
              )
              .orderBy(desc(requestLogs.createdAt))
              .limit(5000),
          ),
          safely<any[]>("active_business_supply", [], async () =>
            rowsOf(
              await db.execute(sql`
                select
                  r.id,
                  r.owner_id as "ownerId",
                  u.email as "ownerEmail",
                  r.name,
                  r.address,
                  r.business_type as "businessType",
                  r.is_food_truck as "isFoodTruck",
                  r.city,
                  r.state,
                  r.cuisine_type as "cuisineType",
                  r.description,
                  r.raw_data as "rawData",
                  r.phone,
                  r.website_url as "websiteUrl",
                  r.operating_hours as "operatingHours",
                  r.updated_at as "updatedAt",
                  r.last_broadcast_at as "lastBroadcastAt",
                  r.live_until_at as "liveUntilAt",
                  count(distinct m.id) filter (where m.is_active = true)::int as "activeMenuCount",
                  count(distinct mi.id) filter (where m.is_active = true and mi.is_available = true)::int as "availableItemCount",
                  count(distinct mi.id) filter (where m.is_active = true and mi.track_inventory = true and coalesce(mi.inventory_qty, 0) <= 0)::int as "soldOutItemCount",
                  count(distinct mi.id) filter (where m.is_active = true and mi.track_inventory = true)::int as "inventoryTrackedItemCount",
                  count(distinct mi.id) filter (where m.is_active = true and mi.is_available = true and mi.price_cents is not null)::int as "pricedAvailableItemCount",
                  max(mi.updated_at) as "menuUpdatedAt",
                  bool_or(mds.enabled) as "merchantDeliveryEnabled"
                from restaurants r
                inner join users u on u.id = r.owner_id
                left join menus m on m.restaurant_id = r.id
                left join menu_items mi on mi.restaurant_id = r.id and mi.menu_id = m.id
                left join merchant_delivery_settings mds on mds.restaurant_id = r.id
                where r.is_active = true
                group by r.id, u.email
                order by r.updated_at desc nulls last, r.name asc
                limit 500
              `),
            ),
          ),
          safely<any[]>("active_schedule_supply", [], async () =>
            rowsOf(
              await db.execute(sql`
                select
                  s.id,
                  s.truck_id as "truckId",
                  r.name as "truckName",
                  s.date,
                  s.start_time as "startTime",
                  s.end_time as "endTime",
                  s.location_name as "locationName",
                  s.city,
                  s.state,
                  s.status,
                  s.is_public as "isPublic",
                  s.last_confirmed_at as "lastConfirmedAt",
                  s.updated_at as "updatedAt"
                from truck_manual_schedules s
                inner join restaurants r on r.id = s.truck_id and r.is_active = true
                inner join users u on u.id = r.owner_id
                where s.is_public = true
                  and lower(coalesce(s.status, 'open')) in ('open', 'confirmed', 'scheduled', 'booked', 'filled')
                  and (s.live_feed_eligible = true or s.live_feed_eligible is null)
                  and (s.expires_at is null or s.expires_at >= ${now})
                  and s.last_confirmed_at is not null
                  and s.date >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
                  and s.date < ${new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)}
                order by s.date asc
                limit 500
              `),
            ),
          ),
          safely<any[]>("active_event_supply", [], async () =>
            rowsOf(
              await db.execute(sql`
                select
                  e.id,
                  coalesce(nullif(trim(e.name), ''), h.business_name, 'Event') as name,
                  e.date,
                  h.city,
                  h.state,
                  h.business_name as "hostName",
                  e.status,
                  e.updated_at as "updatedAt"
                from events e
                inner join hosts h on h.id = e.host_id
                inner join event_bookings eb
                  on eb.event_id = e.id
                  and eb.status = 'confirmed'
                  and eb.booking_confirmed_at is not null
                where e.date >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
                  and e.date < ${new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)}
                  and coalesce(e.requires_payment, false) = false
                  and lower(coalesce(e.status, 'open')) in ('open', 'booked', 'filled')
                group by e.id, h.id
                order by e.date asc
                limit 500
              `),
            ),
          ),
          safely<any[]>("active_menu_item_supply", [], async () =>
            rowsOf(
              await db.execute(sql`
                select
                  mi.id,
                  mi.restaurant_id as "restaurantId",
                  r.name as "restaurantName",
                  mi.name,
                  r.city,
                  r.state,
                  mi.is_available as "isAvailable",
                  mi.updated_at as "updatedAt"
                from menu_items mi
                inner join menus m on m.id = mi.menu_id and m.is_active = true
                inner join restaurants r on r.id = mi.restaurant_id and r.is_active = true
                inner join users u on u.id = r.owner_id
                where mi.is_available = true
                order by mi.updated_at desc nulls last, mi.name asc
                limit 500
              `),
            ),
          ),
          safely<any[]>("unclaimed_demand", [], async () =>
            rowsOf(
              await db.execute(sql`
                select
                  til.id,
                  til.name,
                  count(distinct coalesce(rl.anonymous_actor_id, rl.session_id, rl.id))::int as demand
                from truck_import_listings til
                inner join request_logs rl on rl.entity_id = til.id
                where til.status = 'unclaimed'
                  and rl.created_at >= ${since}
                  and rl.event_type in ('profile_view', 'profile_action', 'conversion_intent')
                group by til.id, til.name
                having count(*) > 0
                order by demand desc
                limit 100
              `),
            ),
          ),
        ]);

      const publicBusinessIds = new Set<string>();
      const businesses: ActiveBusinessSupply[] = [];
      for (const row of businessRows) {
        const indexability = evaluatePublicRestaurantIndexability({
          name: row.name,
          isActive: true,
          ownerId: row.ownerId,
          ownerEmail: row.ownerEmail,
          address: row.address,
          cuisineType: row.cuisineType,
          description: row.description,
          city: row.city,
          state: row.state,
          rawData: row.rawData,
          phone: row.phone,
          websiteUrl: row.websiteUrl,
        });
        if (!indexability.indexable) continue;
        publicBusinessIds.add(String(row.id));
        businesses.push({
          id: String(row.id),
          name: String(row.name || "").trim(),
          businessType: String(row.businessType || "restaurant"),
          isFoodTruck: Boolean(row.isFoodTruck),
          city: row.city ? String(row.city) : null,
          state: row.state ? String(row.state) : null,
          cuisineType: row.cuisineType ? String(row.cuisineType) : null,
          operatingHoursKnown:
            row.operatingHours != null &&
            typeof row.operatingHours === "object" &&
            Object.keys(row.operatingHours).length > 0,
          updatedAt: asIso(row.updatedAt),
          lastBroadcastAt: asIso(row.lastBroadcastAt),
          liveUntilAt: asIso(row.liveUntilAt),
          activeMenuCount: asCount(row.activeMenuCount),
          availableItemCount: asCount(row.availableItemCount),
          soldOutItemCount: asCount(row.soldOutItemCount),
          inventoryTrackedItemCount: asCount(row.inventoryTrackedItemCount),
          pricedAvailableItemCount: asCount(row.pricedAvailableItemCount),
          menuUpdatedAt: asIso(row.menuUpdatedAt),
          merchantDeliveryEnabled: asBooleanOrNull(row.merchantDeliveryEnabled),
        });
      }

      const schedules: ActiveScheduleSupply[] = scheduleRows
        .filter((row) => publicBusinessIds.has(String(row.truckId)))
        .map((row) => ({
          id: String(row.id),
          truckId: String(row.truckId),
          truckName: String(row.truckName || "Food truck"),
          date: asIso(row.date) || String(row.date || ""),
          startTime: row.startTime ? String(row.startTime) : null,
          endTime: row.endTime ? String(row.endTime) : null,
          locationName: row.locationName ? String(row.locationName) : null,
          city: row.city ? String(row.city) : null,
          state: row.state ? String(row.state) : null,
          status: row.status ? String(row.status) : null,
          isPublic: asBooleanOrNull(row.isPublic) !== false,
          lastConfirmedAt: asIso(row.lastConfirmedAt),
          updatedAt: asIso(row.updatedAt),
        }));
      const events: ActiveEventSupply[] = eventRows.map((row) => ({
        id: String(row.id),
        name: String(row.name || "Event"),
        date: asIso(row.date) || String(row.date || ""),
        city: row.city ? String(row.city) : null,
        state: row.state ? String(row.state) : null,
        hostName: row.hostName ? String(row.hostName) : null,
        status: row.status ? String(row.status) : null,
        updatedAt: asIso(row.updatedAt),
      }));
      const menuItems: ActiveMenuItemSupply[] = menuItemRows
        .filter((row) => publicBusinessIds.has(String(row.restaurantId)))
        .map((row) => ({
          id: String(row.id),
          restaurantId: String(row.restaurantId),
          restaurantName: String(row.restaurantName || "Restaurant"),
          name: String(row.name || "Menu item"),
          city: row.city ? String(row.city) : null,
          state: row.state ? String(row.state) : null,
          isAvailable: asBooleanOrNull(row.isAvailable) === true,
          updatedAt: asIso(row.updatedAt),
        }));

      const records = logRows
        .map(requestLogToDiscoveryEvidence)
        .filter((row): row is DiscoveryEvidenceRecord => Boolean(row));
      const internalSearches: InternalSearchEvidence[] = records
        .filter(
          (record) =>
            record.discoverySource === "internal_search" &&
            record.intendedAction === "internal_search" &&
            record.query,
        )
        .map((record) => ({
          id: record.id,
          query: String(record.query),
          source: "internal_search",
          resultCount: record.resultCount,
          observedAt: record.observedAt,
        }));
      const snapshot: ActiveSupplySnapshot = {
        businesses,
        schedules,
        events,
        menuItems,
        internalSearches,
      };

      const funnel = buildDiscoveryFunnel(records);
      const integrity = validateDiscoveryEvidence(records, now);
      const queryCollection = buildLivingDiscoveryQueries(snapshot, now);
      const freshnessFailures = findFreshnessFailures(snapshot, now);
      const pages = buildPageEvidence(records);
      const impressionOnlyPages = pages.filter(
        (page) => page.impressions > 0 && page.actions === 0,
      );
      const experiments = rankMealScoutExperiments({
        funnel,
        freshnessFailures,
        queryCollection,
        impressionOnlyPageCount: impressionOnlyPages.length,
        activeSupplyCount:
          businesses.length + schedules.length + events.length + menuItems.length,
        zeroResultSearchCount: internalSearches.filter(
          (search) => search.resultCount === 0,
        ).length,
      }).map((proposal) => {
        const decisionHistory = records
          .filter(
            (record) =>
              record.stage === "experiment" &&
              record.intendedAction === "experiment_decision" &&
              record.experimentId === proposal.id,
          )
          .sort(
            (a, b) =>
              new Date(b.observedAt).getTime() -
                new Date(a.observedAt).getTime() ||
              b.id.localeCompare(a.id),
          );
        const decision = decisionHistory[0];
        const assignments = new Set(
          records
            .filter(
              (record) =>
                record.stage === "experiment" &&
                record.intendedAction === "experiment_assignment" &&
                record.experimentId === proposal.id &&
                record.anonymousJourneyId,
            )
            .map((record) => record.anonymousJourneyId),
        );
        return {
          ...proposal,
          decision: decision?.experimentDecision || proposal.defaultDecision,
          decisionObservedAt: decision?.observedAt || null,
          decisionHistory: decisionHistory.map((record) => ({
            id: record.id,
            decision: record.experimentDecision,
            observedAt: record.observedAt,
            evidenceBoundary: record.evidenceBoundary,
          })),
          distinctAssignments: assignments.size,
        };
      });
      const outsideObservations = records.filter((record) => record.stage === "observation");
      const observedOutsideResults = outsideObservations.filter(
        (record) => record.observationResult === "observed",
      );

      return res.json({
        platform: DISCOVERY_PLATFORM,
        generatedAt: now.toISOString(),
        windowDays,
        definitions: {
          observation: "An outside surface result independently recorded.",
          entry: "An actual MealScout landing.",
          action: "A deliberate customer attempt.",
          outcome: "Merchant receipt or completion state, never inferred from an action.",
          experiment: "A predeclared assignment with one controlled change.",
          linkStrengths: {
            direct_server_observed: "The server directly recorded the fact.",
            client_correlated_unverified: "Client events share a journey but are not independently verified.",
            unknown_unavailable: "The evidence cannot connect the facts.",
          },
        },
        denominators: {
          entryToAction: "Distinct journeys with an entry.",
          actionToMerchantReceipt: "Distinct journeys with a deliberate action.",
          actionToCompletedOutcome: "Distinct journeys with a deliberate action; unknown outcomes remain in this denominator.",
        },
        retention: {
          requestedWindowDays: windowDays,
          generalOperationalEvidenceHours: 48,
          sanitizedObservatoryEvidenceDays: 180,
          evidenceBoundary:
            "General request/profile rows still expire after 48 hours. A longer requested window can include only strictly sanitized observatory rows beyond that point.",
        },
        funnel,
        sourcesProducingEntries: buildEntrySources(records),
        queryCollection,
        observedQueries: outsideObservations
          .map((record) => ({
            query: record.query,
            queryEvidenceState: record.queryEvidenceState,
            result: record.observationResult,
            source: record.discoverySource,
            surface: record.searchSurface,
            locationContext: record.locationContext,
            deviceContext: record.deviceContext,
            observedAt: record.observedAt,
            observationPrecision: record.observationPrecision,
          })),
        pagesAppearingOrCited: observedOutsideResults
          .filter((record) => record.displayedPage)
          .map((record) => ({
            page: record.displayedPage,
            source: record.discoverySource,
            surface: record.searchSurface,
            observedAt: record.observedAt,
            observationPrecision: record.observationPrecision,
            observationResult: record.observationResult,
            queryEvidenceState: record.queryEvidenceState,
            linkStrength: record.linkStrength,
          })),
        repeatedCompetitors: countRepeated(
          observedOutsideResults.flatMap((record) => record.competitors),
        ),
        repeatedOutsideSources: countRepeated(
          observedOutsideResults.flatMap((record) => record.outsideSources),
        ),
        outsideObservationDetails: outsideObservations.map((record) => ({
          id: record.id,
          source: record.discoverySource,
          surface: record.searchSurface,
          observationResult: record.observationResult,
          query: record.query,
          queryEvidenceState: record.queryEvidenceState,
          displayedPage: record.displayedPage,
          competitors: record.competitors,
          outsideSources: record.outsideSources,
          observedAt: record.observedAt,
          observationPrecision: record.observationPrecision,
          evidenceBoundary: record.evidenceBoundary,
        })),
        pagesWithImpressionsButNoActions: impressionOnlyPages,
        unclaimedEntitiesReceivingDemand: {
          items: unclaimedRows.map((row) => ({
            entityId: String(row.id),
            name: String(row.name || "Unclaimed entity"),
            distinctDemand: asCount(row.demand),
          })),
          unknown:
            unavailable.some((row) => row.source === "unclaimed_demand") ||
            unclaimedRows.length === 0,
          evidenceBoundary:
            "Only demand directly linked to an unclaimed import entity is counted; unmatched demand remains unknown.",
        },
        internalZeroResultSearches: internalSearches.filter(
          (search) => search.resultCount === 0,
        ),
        freshness: {
          coverage: buildMealScoutFreshnessCoverage(snapshot),
          failures: freshnessFailures,
          unknownsRemainInCoverage: true,
        },
        activeSupply: {
          businesses: businesses.length,
          publicSchedules: schedules.length,
          upcomingEvents: events.length,
          availableMenuItems: menuItems.length,
        },
        experiments,
        integrity: {
          ...integrity,
          noJoinMultiplication:
            "Funnel and page rates use sets of record or journey IDs; supply SQL counts distinct entity IDs.",
        },
        evidenceAvailability: availability,
        unavailableEvidence: unavailable,
        explicitUnknowns: [
          "A landing page never supplies or implies a search query.",
          "External citation-to-entry causation is unknown unless independently connected.",
          "Google Search Console and Bing Webmaster evidence are unavailable in this repository.",
          "Merchant notification is not inferred from a click; follow receipt means only that the durable merchant-visible relationship exists.",
        ],
        recentEvidence: records.slice(0, 250),
      });
    },
  );
}
