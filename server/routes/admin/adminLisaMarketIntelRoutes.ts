import crypto from "crypto";
import type { Express } from "express";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
  deals,
  geoAdEvents,
  geoLocationPings,
  locationRequests,
  requestLogs,
  restaurants,
  searchQueryEvents,
  truckInterests,
  videoStories,
} from "@shared/schema";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import { getSupplyMarketDataLanes } from "../../services/supplyMarketIntel";

export type RegisterAdminLisaMarketIntelRoutesDeps = {
  buildCanonicalEntities: (limit: number) => Promise<any[]>;
  botSignatureLabel: (userAgent?: string | null) => string | null;
  isMonitoringAgent: (userAgent?: string | null) => boolean;
  isHighValueObservedPath: (pathValue?: string | null) => boolean;
  classifyObservedEventType: (pathValue: string) => string;
  inferObservedSurface: (pathValue: string) => string;
  toCountDeltaLine: (
    label: string,
    currentCount: number,
    previousCount: number,
  ) => string;
  formatDealValueLabel: (
    dealType?: string | null,
    discountValue?: string | number | null,
    minOrderAmount?: string | number | null,
  ) => string;
  requestLogLegacySelect: Record<string, any>;
};

export function registerAdminLisaMarketIntelRoutes(
  app: Express,
  deps: RegisterAdminLisaMarketIntelRoutesDeps,
) {
  const {
    buildCanonicalEntities,
    botSignatureLabel,
    isMonitoringAgent,
    isHighValueObservedPath,
    classifyObservedEventType,
    inferObservedSurface,
    toCountDeltaLine,
    formatDealValueLabel,
    requestLogLegacySelect,
  } = deps;

  app.get(
    "/api/admin/lisa/market-intel",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const now = new Date();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const since48h = new Date(Date.now() - 48 * 24 * 60 * 60 * 1000);

        const [
          topQueriesRows,
          cityDemandRows,
          cuisineRows,
          videoRows,
          geoAdTotals,
          geoPingTotals,
          entities,
          recentRequests,
          recentQueryRows,
          previousQueryRows,
          recentStoryCountRows,
          previousStoryCountRows,
          recentLocationCountRows,
          previousLocationCountRows,
          recentDealCreateCountRows,
          previousDealCreateCountRows,
          activeDealRows,
          supplyMarketLaneFeed,
        ] = await Promise.all([
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since30d))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              businessName: locationRequests.businessName,
              address: locationRequests.address,
              locationType: locationRequests.locationType,
              requestCount: sql<number>`count(*)`.mapWith(Number),
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(Number),
            })
            .from(locationRequests)
            .leftJoin(
              truckInterests,
              eq(truckInterests.locationRequestId, locationRequests.id),
            )
            .where(gte(locationRequests.createdAt, since30d))
            .groupBy(
              locationRequests.businessName,
              locationRequests.address,
              locationRequests.locationType,
            )
            .orderBy(desc(sql`count(*)`), desc(sql`count(${truckInterests.id})`))
            .limit(10),
          db
            .select({
              cuisineType: restaurants.cuisineType,
              restaurantCount: sql<number>`count(*)`.mapWith(Number),
              avgRankingScore: sql<number>`avg(${restaurants.rankingScore})`.mapWith(Number),
            })
            .from(restaurants)
            .where(gte(restaurants.createdAt, new Date("2020-01-01")))
            .groupBy(restaurants.cuisineType)
            .orderBy(desc(sql`count(*)`))
            .limit(10)
            .catch(async () =>
              db
                .select({
                  cuisineType: restaurants.cuisineType,
                  restaurantCount: sql<number>`count(*)`.mapWith(Number),
                  avgRankingScore: sql<number>`avg(${restaurants.rankingScore})`.mapWith(Number),
                })
                .from(restaurants)
                .groupBy(restaurants.cuisineType)
                .orderBy(desc(sql`count(*)`))
                .limit(10),
            ),
          db
            .select({
              id: videoStories.id,
              title: videoStories.title,
              restaurantId: videoStories.restaurantId,
              viewCount: videoStories.viewCount,
              impressionCount: videoStories.impressionCount,
              createdAt: videoStories.createdAt,
            })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since30d))
            .orderBy(desc(videoStories.impressionCount), desc(videoStories.viewCount))
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(Number),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(Number),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(Number),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since30d))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since24h))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(25),
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(
              and(
                gte(searchQueryEvents.createdAt, since48h),
                lt(searchQueryEvents.createdAt, since24h),
              ),
            )
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(25),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(videoStories)
            .where(
              and(
                gte(videoStories.createdAt, since48h),
                lt(videoStories.createdAt, since24h),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(locationRequests)
            .where(gte(locationRequests.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(locationRequests)
            .where(
              and(
                gte(locationRequests.createdAt, since48h),
                lt(locationRequests.createdAt, since24h),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(deals)
            .where(gte(deals.createdAt, since24h)),
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(deals)
            .where(and(gte(deals.createdAt, since48h), lt(deals.createdAt, since24h))),
          db
            .select({
              dealId: deals.id,
              restaurantId: restaurants.id,
              restaurantName: restaurants.name,
              cuisineType: restaurants.cuisineType,
              city: restaurants.city,
              state: restaurants.state,
              title: deals.title,
              dealType: deals.dealType,
              discountValue: deals.discountValue,
              minOrderAmount: deals.minOrderAmount,
              endDate: deals.endDate,
              isOngoing: deals.isOngoing,
              createdAt: deals.createdAt,
            })
            .from(deals)
            .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
            .where(
              and(
                eq(deals.isActive, true),
                or(
                  eq(deals.isOngoing, true),
                  isNull(deals.endDate),
                  gte(deals.endDate, now),
                ),
              ),
            )
            .orderBy(desc(deals.createdAt))
            .limit(80),
          getSupplyMarketDataLanes({ sinceHours: 48, limit: 300 }),
        ]);

        const typedRecentQueryRows = recentQueryRows as Array<{
          query: string | null;
          count: number;
        }>;
        const typedPreviousQueryRows = previousQueryRows as Array<{
          query: string | null;
          count: number;
        }>;
        const typedActiveDealRows = activeDealRows as Array<{
          dealId: string;
          restaurantId: string;
          restaurantName: string;
          cuisineType: string | null;
          city: string | null;
          state: string | null;
          title: string;
          dealType: string;
          discountValue: string | number;
          minOrderAmount: string | number | null;
          endDate: Date | null;
          isOngoing: boolean | null;
          createdAt: Date | null;
        }>;

        const recentQueryMap = new Map(
          typedRecentQueryRows.map((row) => [
            String(row.query || "").toLowerCase(),
            Number(row.count || 0),
          ]),
        );
        const previousQueryMap = new Map(
          typedPreviousQueryRows.map((row) => [
            String(row.query || "").toLowerCase(),
            Number(row.count || 0),
          ]),
        );

        const trendWatch = Array.from(
          new Set([
            ...typedRecentQueryRows.map((row) =>
              String(row.query || "").toLowerCase(),
            ),
            ...typedPreviousQueryRows.map((row) =>
              String(row.query || "").toLowerCase(),
            ),
          ]),
        )
          .map((key: string) => {
            const recentMatch =
              typedRecentQueryRows.find(
                (row) => String(row.query || "").toLowerCase() === key,
              ) ?? null;
            const currentCount = Number(recentQueryMap.get(key) ?? 0);
            const previousCount = Number(previousQueryMap.get(key) ?? 0);
            const delta = currentCount - previousCount;
            return {
              id: `trend:${key}`,
              label: recentMatch?.query || key || "food trend",
              currentCount,
              previousCount,
              delta,
              direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
              momentum:
                delta >= 3
                  ? "surging"
                  : delta > 0
                    ? "rising"
                    : currentCount > 0 && previousCount === 0
                      ? "new"
                      : "steady",
              summary:
                delta > 0
                  ? `"${recentMatch?.query || key}" is climbing with ${currentCount} recent searches, up ${delta} from the previous day.`
                  : delta < 0
                    ? `"${recentMatch?.query || key}" cooled slightly to ${currentCount} recent searches, down ${Math.abs(delta)} from the previous day.`
                    : `"${recentMatch?.query || key}" is holding steady at ${currentCount} recent searches.`,
              next:
                delta > 0
                  ? `Build or refresh pages, deals, and content around "${recentMatch?.query || key}" while interest is rising.`
                  : `Keep coverage for "${recentMatch?.query || key}" fresh so MealScout can hold the topic if demand rebounds.`,
            };
          })
          .filter((item) => item.currentCount > 0)
          .sort((a, b) => {
            if (b.delta !== a.delta) return b.delta - a.delta;
            return b.currentCount - a.currentCount;
          })
          .slice(0, 8);

        const bestValueDeals = typedActiveDealRows
          .map((item) => {
            const discountValue = Number(item.discountValue || 0);
            const minOrderAmount = Number(item.minOrderAmount || 0);
            const valueScore =
              String(item.dealType || "").toLowerCase() === "fixed"
                ? (discountValue / Math.max(minOrderAmount || 25, 25)) * 100
                : discountValue;
            return {
              id: item.dealId,
              restaurantId: item.restaurantId,
              restaurantName: item.restaurantName,
              cuisineType: item.cuisineType,
              city: item.city,
              state: item.state,
              title: item.title,
              dealType: item.dealType,
              discountValue,
              minOrderAmount,
              endDate: item.endDate,
              isOngoing: item.isOngoing,
              createdAt: item.createdAt,
              valueScore: Number(valueScore.toFixed(1)),
              priceSignal: formatDealValueLabel(
                item.dealType,
                item.discountValue,
                item.minOrderAmount,
              ),
            };
          })
          .sort((a, b) => {
            if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
            return a.minOrderAmount - b.minOrderAmount;
          })
          .slice(0, 8);

        const cuisineValueMap = typedActiveDealRows.reduce<
          Map<
            string,
            {
              cuisineType: string;
              dealCount: number;
              totalValueScore: number;
              totalMinOrder: number;
            }
          >
        >((acc, item) => {
          const cuisine = String(item.cuisineType || "Unknown");
          const discountValue = Number(item.discountValue || 0);
          const minOrderAmount = Number(item.minOrderAmount || 0);
          const normalizedDiscount =
            String(item.dealType || "").toLowerCase() === "fixed"
              ? (discountValue / Math.max(minOrderAmount || 25, 25)) * 100
              : discountValue;
          const current = acc.get(cuisine) || {
            cuisineType: cuisine,
            dealCount: 0,
            totalValueScore: 0,
            totalMinOrder: 0,
          };
          current.dealCount += 1;
          current.totalValueScore += normalizedDiscount;
          current.totalMinOrder += minOrderAmount;
          acc.set(cuisine, current);
          return acc;
        }, new Map());
        const cuisineValue = Array.from(cuisineValueMap.values())
          .map((value) => ({
            cuisineType: value.cuisineType,
            dealCount: value.dealCount,
            avgValueScore:
              value.dealCount > 0
                ? Number((value.totalValueScore / value.dealCount).toFixed(1))
                : 0,
            avgMinOrder:
              value.dealCount > 0
                ? Number((value.totalMinOrder / value.dealCount).toFixed(1))
                : 0,
          }))
          .sort((a, b) => {
            if (b.avgValueScore !== a.avgValueScore) {
              return b.avgValueScore - a.avgValueScore;
            }
            return b.dealCount - a.dealCount;
          })
          .slice(0, 6);

        const acquisitionTargets = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              return Boolean(botSignatureLabel(request.userAgent)) && path.includes(entity.entityId);
            }).length;

            const advertiserScore =
              (entity.entityType === "restaurant" ? 3 : 1) +
              (entity.machineReadiness === "blocked" ? 3 : entity.machineReadiness === "developing" ? 1 : 0) +
              (entity.quality === "thin" ? 3 : entity.quality === "growing" ? 1 : 0) +
              Math.min(5, crawlerHits);

            return {
              id: entity.id,
              entityId: entity.entityId,
              title: entity.title,
              entityType: entity.entityType,
              canonicalPath: entity.canonicalPath,
              location: entity.location,
              machineReadiness: entity.machineReadiness,
              quality: entity.quality,
              crawlerHits,
              advertiserScore,
              reasons: [
                ...entity.knowledgeGaps.slice(0, 2),
                ...entity.opportunities.slice(0, 2),
              ],
            };
          })
          .sort((a, b) => b.advertiserScore - a.advertiserScore)
          .slice(0, 8);

        const humanRequestRows = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isHumanByType = actorType ? actorType === "human" : !botSignatureLabel(request.userAgent);
          const isHumanBySource = sourceType ? sourceType === "human" : true;
          return (
            createdAt >= since24h.getTime() &&
            !isMonitoringAgent(request.userAgent) &&
            isHumanByType &&
            isHumanBySource
          );
        });

        const recent15m = new Date(Date.now() - 15 * 60 * 1000);
        const recent1h = new Date(Date.now() - 60 * 60 * 1000);
        const profilePathMatcher = /^\/restaurant\/([^/?#]+)/i;
        const intentPathMatcher =
          /(call|phone|website|favorite|save|direction|book|checkout|claim|order|event-signup|subscribe)/i;

        const buildVisitorKey = (request: any) =>
          String(
            request.sessionId ||
              request.anonymousActorId ||
              request.userId ||
              `${String(request.ip || "unknown").trim()}|${String(request.userAgent || "")
                .toLowerCase()
                .slice(0, 120)}`,
          );

        const restaurantTitleById = new Map<string, string>();
        for (const entity of entities as any[]) {
          if (String(entity.entityType || "") !== "restaurant") continue;
          if (!entity.entityId) continue;
          restaurantTitleById.set(String(entity.entityId), String(entity.title || "Restaurant"));
        }

        const profileInterestByRestaurant = new Map<
          string,
          {
            views: number;
            visitors: Set<string>;
            repeatVisitors: Set<string>;
            latestSeenAt: string | null;
          }
        >();
        const profileIntentByRestaurant = new Map<string, number>();
        const visitorProfileCounts = new Map<string, number>();

        for (const request of humanRequestRows) {
          const createdAt = new Date(request.createdAt).getTime();
          const pathValue = String(request.path || "");
          const match = pathValue.match(profilePathMatcher);
          if (!match?.[1]) continue;
          const restaurantId = String(match[1]).trim();
          if (!restaurantId) continue;

          const visitorKey = buildVisitorKey(request);
          const profileKey = `${restaurantId}|${visitorKey}`;
          visitorProfileCounts.set(profileKey, (visitorProfileCounts.get(profileKey) || 0) + 1);

          const bucket = profileInterestByRestaurant.get(restaurantId) || {
            views: 0,
            visitors: new Set<string>(),
            repeatVisitors: new Set<string>(),
            latestSeenAt: null,
          };
          bucket.views += 1;
          bucket.visitors.add(visitorKey);
          const occurredIso = new Date(createdAt).toISOString();
          if (!bucket.latestSeenAt || occurredIso > bucket.latestSeenAt) {
            bucket.latestSeenAt = occurredIso;
          }
          profileInterestByRestaurant.set(restaurantId, bucket);

          if (intentPathMatcher.test(pathValue)) {
            profileIntentByRestaurant.set(
              restaurantId,
              (profileIntentByRestaurant.get(restaurantId) || 0) + 1,
            );
          }

          if (createdAt >= recent1h.getTime() && visitorProfileCounts.get(profileKey)! >= 2) {
            bucket.repeatVisitors.add(visitorKey);
          }
        }

        const topViewedBusinesses = Array.from(profileInterestByRestaurant.entries())
          .map(([restaurantId, data]) => ({
            restaurantId,
            title:
              restaurantTitleById.get(restaurantId) || `Restaurant ${restaurantId.slice(0, 8)}`,
            views: data.views,
            uniqueVisitors: data.visitors.size,
            repeatVisitors: data.repeatVisitors.size,
            intentActions: Number(profileIntentByRestaurant.get(restaurantId) || 0),
            latestSeenAt: data.latestSeenAt,
          }))
          .sort((a, b) => {
            if (b.views !== a.views) return b.views - a.views;
            return b.repeatVisitors - a.repeatVisitors;
          })
          .slice(0, 8);

        const humanSessionsNow = new Set(
          humanRequestRows
            .filter((request: any) => new Date(request.createdAt).getTime() >= recent15m.getTime())
            .map((request: any) => buildVisitorKey(request)),
        ).size;

        const intentActionsNow = humanRequestRows.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          if (createdAt < recent15m.getTime()) return false;
          return intentPathMatcher.test(String(request.path || ""));
        }).length;

        const repeatedBusinessInterestNow = topViewedBusinesses.reduce(
          (sum, item) => sum + Number(item.repeatVisitors || 0),
          0,
        );

        const machineDiscoveryNow = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isMachineByType = actorType ? actorType === "bot" || actorType === "llm_bot" : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since24h.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path)
          );
        }).length;

        const frictionCases = topViewedBusinesses
          .filter((item) => item.views >= 3 && item.intentActions === 0)
          .map((item) => ({
            id: `friction:${item.restaurantId}`,
            restaurantId: item.restaurantId,
            title: item.title,
            views: item.views,
            uniqueVisitors: item.uniqueVisitors,
            intentActions: item.intentActions,
            latestSeenAt: item.latestSeenAt,
          }))
          .slice(0, 8);
        const frictionCasesNow = frictionCases.length;

        const humanTruthSignalScore =
          humanSessionsNow + intentActionsNow + repeatedBusinessInterestNow + frictionCasesNow;
        const machineSupportScore = machineDiscoveryNow;
        const hasRecommendationDensity =
          humanTruthSignalScore >= 10 &&
          topViewedBusinesses.length >= 2 &&
          humanSessionsNow >= 2 &&
          (intentActionsNow >= 2 || repeatedBusinessInterestNow >= 2);

        const signalContract = {
          mode: hasRecommendationDensity ? "recommendations" : "truth_only",
          reason: hasRecommendationDensity
            ? "Human first-party signal density is high enough for ranked recommendations."
            : "Not enough recent human first-party signal to rank recommendation cards safely.",
          thresholds: {
            minHumanTruthSignalScore: 10,
            minTopViewedBusinesses: 2,
            minHumanSessionsNow: 2,
            minIntentOrRepeat: 2,
          },
          observed: {
            humanTruthSignalScore,
            machineSupportScore,
            topViewedBusinesses: topViewedBusinesses.length,
            humanSessionsNow,
            intentActionsNow,
            repeatedBusinessInterestNow,
            frictionCasesNow,
          },
        } as const;

        const recentObservedEvents = recentRequests
          .slice()
          .sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .slice(0, 80)
          .map((request: any) => {
            const pathValue = String(request.path || "");
            const actorType = String(request.actorType || "").trim().toLowerCase() ||
              (botSignatureLabel(request.userAgent) ? "bot" : "human");
            const restaurantMatch = pathValue.match(/^\/restaurant\/([^/?#]+)/i);
            const eventType = String(request.eventType || "").trim() || classifyObservedEventType(pathValue);
            const surface = String(request.surface || "").trim() || inferObservedSurface(pathValue);
            const identitySeed = String(request.userId || request.ip || "anonymous");
            const deviceSeed = String(request.userAgent || "").slice(0, 160);
            const anonymousActorId = crypto
              .createHash("sha256")
              .update(`${identitySeed}|${deviceSeed}`)
              .digest("hex")
              .slice(0, 20);
            const sessionId =
              String(request.sessionId || "").trim() ||
              (request.userId ? `user:${String(request.userId)}` : `anon:${anonymousActorId}`);
            const sourceType =
              String(request.sourceType || "").trim() ||
              (actorType === "human" ? "human" : "crawler");
            return {
              eventId: String(request.id || ""),
              occurredAt: new Date(request.createdAt).toISOString(),
              ingestedAt: new Date(request.createdAt).toISOString(),
              sessionId,
              anonymousActorId: String(request.anonymousActorId || anonymousActorId),
              actorType,
              eventType,
              entityId: request.entityId || (restaurantMatch?.[1] ? String(restaurantMatch[1]) : null),
              entityType: request.entityType || (restaurantMatch?.[1] ? "restaurant" : null),
              route: pathValue,
              surface,
              category: null,
              state: null,
              county: null,
              city: null,
              sourceType,
              metadata: {
                method: String(request.method || ""),
                statusCode: Number(request.statusCode || 0),
                durationMs: Number(request.durationMs || 0),
              },
            };
          });

        const recentTruthFeed = [
          ...topViewedBusinesses.slice(0, 3).map((item) => ({
            id: `truth:profile:${item.restaurantId}`,
            family: "page_demand",
            summary: `${item.title} drew ${item.views} profile views (${item.uniqueVisitors} visitors) in the last 24h.`,
            evidence: `${item.repeatVisitors} repeat visitors; ${item.intentActions} intent actions.`,
            actionHint:
              item.intentActions === 0
                ? "Improve profile clarity and call-to-action blocks."
                : "Sustain with fresh offers and keep profile details current.",
            occurredAt: item.latestSeenAt || now.toISOString(),
          })),
          ...frictionCases.slice(0, 2).map((item) => ({
            id: `truth:friction:${item.restaurantId}`,
            family: "conversion_friction",
            summary: `${item.title} has ${item.views} views with no intent actions.`,
            evidence: `${item.uniqueVisitors} unique visitors in the current window.`,
            actionHint: "Tighten value proposition, menu details, and outbound click paths.",
            occurredAt: item.latestSeenAt || now.toISOString(),
          })),
          ...acquisitionTargets
            .filter((item) => Number(item.crawlerHits || 0) > 0)
            .slice(0, 2)
            .map((item) => {
              const latestMachineHit = recentRequests
                .filter((request: any) => {
                  const createdAt = new Date(request.createdAt).getTime();
                  const actorType = String(request.actorType || "").trim().toLowerCase();
                  const sourceType = String(request.sourceType || "").trim().toLowerCase();
                  const isMachineByType = actorType
                    ? actorType === "bot" || actorType === "llm_bot"
                    : Boolean(botSignatureLabel(request.userAgent));
                  const isMachineBySource = sourceType
                    ? sourceType === "crawler" || sourceType === "llm_crawler"
                    : true;
                  if (createdAt < since24h.getTime()) return false;
                  if (!isMachineByType || !isMachineBySource) return false;
                  if (!isHighValueObservedPath(request.path)) return false;
                  return String(request.path || "").includes(String(item.entityId || ""));
                })
                .sort(
                  (a: any, b: any) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                )[0];
              return {
                id: `truth:machine:${item.id}`,
                family: "machine_discovery",
                summary: `${item.title} received ${item.crawlerHits} machine discovery hits in the last 24h.`,
                evidence: `Quality=${item.quality}; readiness=${item.machineReadiness}.`,
                actionHint: "Upgrade public page quality before pushing broader distribution.",
                occurredAt: latestMachineHit
                  ? new Date(latestMachineHit.createdAt).toISOString()
                  : now.toISOString(),
              };
            }),
        ].slice(0, 8);

        const recentHighValueMachineHits = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isMachineByType = actorType
            ? actorType === "bot" || actorType === "llm_bot"
            : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since24h.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path) &&
            !isMonitoringAgent(request.userAgent)
          );
        }).length;
        const previousHighValueMachineHits = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isMachineByType = actorType
            ? actorType === "bot" || actorType === "llm_bot"
            : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since48h.getTime() &&
            createdAt < since24h.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path) &&
            !isMonitoringAgent(request.userAgent)
          );
        }).length;

        const recentStoryCount = recentStoryCountRows[0]?.count ?? 0;
        const previousStoryCount = previousStoryCountRows[0]?.count ?? 0;
        const recentLocationCount = recentLocationCountRows[0]?.count ?? 0;
        const previousLocationCount = previousLocationCountRows[0]?.count ?? 0;
        const recentDealCreateCount = recentDealCreateCountRows[0]?.count ?? 0;
        const previousDealCreateCount = previousDealCreateCountRows[0]?.count ?? 0;
        const recentSearchCount = typedRecentQueryRows.reduce(
          (sum, row) => sum + Number(row.count || 0),
          0,
        );
        const previousSearchCount = typedPreviousQueryRows.reduce(
          (sum, row) => sum + Number(row.count || 0),
          0,
        );
        const topTrend = trendWatch[0] || null;
        const changeItems = [
          {
            id: "search-demand",
            title: "Search demand",
            summary: toCountDeltaLine(
              "Food and restaurant search demand",
              recentSearchCount,
              previousSearchCount,
            ),
            delta: recentSearchCount - previousSearchCount,
            next:
              topTrend?.label
                ? `Double down on "${topTrend.label}" while it is drawing the strongest visible food demand.`
                : "Strengthen the strongest food topics with better landing pages and fresh content.",
          },
          {
            id: "fresh-content",
            title: "Fresh content",
            summary: toCountDeltaLine(
              "New story creation",
              recentStoryCount,
              previousStoryCount,
            ),
            delta: recentStoryCount - previousStoryCount,
            next:
              "Push the strongest new stories into sponsor, search, and discovery surfaces before they go stale.",
          },
          {
            id: "deal-supply",
            title: "Deal supply",
            summary: toCountDeltaLine(
              "New deal creation",
              recentDealCreateCount,
              previousDealCreateCount,
            ),
            delta: recentDealCreateCount - previousDealCreateCount,
            next:
              "Use new deals to feed Price Scout, promotion slots, and machine-readable local value pages.",
          },
          {
            id: "machine-attention",
            title: "Machine discovery",
            summary: toCountDeltaLine(
              "High-value machine discovery",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
            delta: recentHighValueMachineHits - previousHighValueMachineHits,
            next:
              "Refresh the public pages machines are finding so MealScout becomes the easiest source to cite.",
          },
          {
            id: "location-demand",
            title: "Location demand",
            summary: toCountDeltaLine(
              "Fresh location demand",
              recentLocationCount,
              previousLocationCount,
            ),
            delta: recentLocationCount - previousLocationCount,
            next:
              "Turn active locations into city pages, ad packages, and truck recruitment targets.",
          },
        ].sort((a, b) => b.delta - a.delta);

        const geoAds = geoAdTotals[0] || { impressions: 0, clicks: 0 };
        const geoPings = geoPingTotals[0] || { totalPings: 0, uniqueVisitors: 0 };
        const topQuery = topTrend?.label || topQueriesRows[0]?.query || "local food trucks";
        const topLocation = cityDemandRows[0]
          ? cityDemandRows[0].businessName ||
            cityDemandRows[0].address ||
            cityDemandRows[0].locationType ||
            "high-demand location"
          : "high-demand location";
        const topCuisine =
          cuisineValue[0]?.cuisineType || cuisineRows[0]?.cuisineType || "food truck";
        const topAcquisition = acquisitionTargets[0]?.title || "priority asset";
        const topPriceDeal = bestValueDeals[0];
        const supplyLaneSpotlight = (Array.isArray((supplyMarketLaneFeed as any)?.lanes)
          ? (supplyMarketLaneFeed as any).lanes
          : []
        )
          .filter((lane: any) => lane && lane.itemKey && lane.signalType)
          .slice(0, 8)
          .map((lane: any) => ({
            lane: String(lane.lane || ""),
            signalType: String(lane.signalType || ""),
            itemKey: String(lane.itemKey || ""),
            itemName: String(lane.itemName || lane.itemKey || "Unknown item"),
            areaKey: String(lane.areaKey || "global"),
            valuePrimary:
              lane.valuePrimary === null || lane.valuePrimary === undefined
                ? null
                : Number(lane.valuePrimary),
            valueSecondary:
              lane.valueSecondary === null || lane.valueSecondary === undefined
                ? null
                : Number(lane.valueSecondary),
            source: String(lane.source || "market"),
            createdAt: lane.createdAt,
          }));

        const supplyLaneCounts =
          (supplyMarketLaneFeed as any)?.laneCounts || ({} as Record<string, number>);
        const supplySnapshotCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_snapshot:item"] || 0,
        );
        const supplyAlertCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_alert:item"] || 0,
        );
        const supplyWatchCount = Number(
          supplyLaneCounts["mealscout:supply_market:price_watch:item"] || 0,
        );
        const brief = {
          headline: `MealScout demand is clustering around ${topQuery} and ${topCuisine} value right now.`,
          audienceAngle: `Promote around ${topLocation} where location demand and truck interest are forming.`,
          inventoryAngle: `${videoRows.length} recent recommendation stories, ${geoPings.totalPings} foot-traffic pings, and ${bestValueDeals.length} live value offers create ad packaging potential.`,
          acquisitionAngle: `${topAcquisition} is still a candidate to strengthen before monetization packaging.`,
          recommendedPackage: [
            `Sponsor search and discovery around "${topQuery}"`,
            `Bundle geo ads with ${topCuisine} trend momentum`,
            `Use ${topLocation} as a localized campaign wedge`,
          ],
        };

        const safeBrief = hasRecommendationDensity
          ? brief
          : {
              headline: "Recommendation layer is paused while first-party signal density is still low.",
              audienceAngle:
                "Track truth counters and repeated business interest before ranking promotion opportunities.",
              inventoryAngle: `Observed human truth score ${humanTruthSignalScore} (needs ${signalContract.thresholds.minHumanTruthSignalScore}) across ${topViewedBusinesses.length} top-viewed businesses; machine support score is ${machineSupportScore}.`,
              acquisitionAngle: signalContract.reason,
              recommendedPackage: [] as string[],
            };

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          signalContract,
          recentObservedEvents,
          truthCounters: {
            humanSessionsNow,
            intentActionsNow,
            repeatedBusinessInterestNow,
            machineDiscoveryNow,
            frictionCasesNow,
          },
          recentTruthFeed,
          topViewedBusinesses,
          frictionCases,
          brief: safeBrief,
          changeSinceYesterday: {
            summary:
              changeItems[0]?.summary ||
              "MealScout does not yet have enough daily movement to call a clear change.",
            items: changeItems.slice(0, 5),
          },
          dailyBriefChanges: {
            promotion: toCountDeltaLine(
              "Fresh content momentum",
              recentStoryCount,
              previousStoryCount,
            ),
            demand:
              topTrend?.summary ||
              toCountDeltaLine(
                "Food search demand",
                recentSearchCount,
                previousSearchCount,
              ),
            acquisition: toCountDeltaLine(
              "Machine attention on public MealScout pages",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
            machineAttention: toCountDeltaLine(
              "High-value machine discovery",
              recentHighValueMachineHits,
              previousHighValueMachineHits,
            ),
          },
          trendWatch,
          priceScout: {
            summary: topPriceDeal
              ? `${topPriceDeal.restaurantName} currently leads Price Scout with ${topPriceDeal.priceSignal}. Supply lanes report ${Number((supplyMarketLaneFeed as any)?.total || 0)} recent records (${supplySnapshotCount} snapshots, ${supplyAlertCount} alerts).`
              : `Price Scout does not have enough active deals yet, but supply lanes report ${Number((supplyMarketLaneFeed as any)?.total || 0)} recent records (${supplySnapshotCount} snapshots, ${supplyAlertCount} alerts).`,
            bestDeals: bestValueDeals,
            cuisineValue,
            supplyLaneSummary: {
              totalRecentRecords: Number((supplyMarketLaneFeed as any)?.total || 0),
              snapshotCount: supplySnapshotCount,
              alertCount: supplyAlertCount,
              watchCount: supplyWatchCount,
              laneCounts: supplyLaneCounts,
              spotlight: supplyLaneSpotlight,
            },
          },
          supplyMarketIntel: {
            summary:
              supplyMarketLaneFeed.total > 0
                ? `Supply market lanes active with ${supplyMarketLaneFeed.total} recent records.`
                : "Supply market lanes have no recent records yet.",
            laneCounts: supplyMarketLaneFeed.laneCounts,
            lanes: supplyMarketLaneFeed.lanes.slice(0, 60),
          },
          advertiserSignals: {
            topQueries: topQueriesRows,
            cityDemand: cityDemandRows,
            cuisineDemand: cuisineRows,
            geoAds: {
              impressions: geoAds.impressions,
              clicks: geoAds.clicks,
              ctr:
                geoAds.impressions > 0 ? geoAds.clicks / geoAds.impressions : 0,
            },
            footTraffic: geoPings,
          },
          contentMomentum: hasRecommendationDensity ? videoRows : [],
          acquisitionTargets: hasRecommendationDensity ? acquisitionTargets : [],
        });
      } catch (error) {
        console.error("Error fetching LISA market intel:", error);
        res.status(500).json({ message: "Failed to fetch market intel" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/market-intel/export",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const exportType = String(req.query.type || "advertiser_brief").trim();
        const format = String(req.query.format || "markdown").trim();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
          topQueriesRows,
          cityDemandRows,
          cuisineRows,
          videoRows,
          geoAdTotals,
          geoPingTotals,
          entities,
          recentRequests,
        ] = await Promise.all([
          db
            .select({
              query: searchQueryEvents.query,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(searchQueryEvents)
            .where(gte(searchQueryEvents.createdAt, since30d))
            .groupBy(searchQueryEvents.query)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              businessName: locationRequests.businessName,
              address: locationRequests.address,
              locationType: locationRequests.locationType,
              requestCount: sql<number>`count(*)`.mapWith(Number),
              interestCount: sql<number>`count(${truckInterests.id})`.mapWith(Number),
            })
            .from(locationRequests)
            .leftJoin(
              truckInterests,
              eq(truckInterests.locationRequestId, locationRequests.id),
            )
            .where(gte(locationRequests.createdAt, since30d))
            .groupBy(
              locationRequests.businessName,
              locationRequests.address,
              locationRequests.locationType,
            )
            .orderBy(desc(sql`count(*)`), desc(sql`count(${truckInterests.id})`))
            .limit(10),
          db
            .select({
              cuisineType: restaurants.cuisineType,
              restaurantCount: sql<number>`count(*)`.mapWith(Number),
            })
            .from(restaurants)
            .groupBy(restaurants.cuisineType)
            .orderBy(desc(sql`count(*)`))
            .limit(10),
          db
            .select({
              id: videoStories.id,
              title: videoStories.title,
              restaurantId: videoStories.restaurantId,
              viewCount: videoStories.viewCount,
              impressionCount: videoStories.impressionCount,
              createdAt: videoStories.createdAt,
            })
            .from(videoStories)
            .where(gte(videoStories.createdAt, since30d))
            .orderBy(desc(videoStories.impressionCount), desc(videoStories.viewCount))
            .limit(8),
          db
            .select({
              impressions:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'impression')`.mapWith(Number),
              clicks:
                sql<number>`count(*) filter (where ${geoAdEvents.eventType} = 'click')`.mapWith(Number),
            })
            .from(geoAdEvents)
            .where(gte(geoAdEvents.createdAt, since30d)),
          db
            .select({
              totalPings: sql<number>`count(*)`.mapWith(Number),
              uniqueVisitors:
                sql<number>`count(distinct coalesce(${geoLocationPings.visitorId}, ${geoLocationPings.userId}))`.mapWith(Number),
            })
            .from(geoLocationPings)
            .where(gte(geoLocationPings.createdAt, since7d)),
          buildCanonicalEntities(30),
          db
            .select(requestLogLegacySelect)
            .from(requestLogs)
            .where(gte(requestLogs.createdAt, since30d))
            .orderBy(desc(requestLogs.createdAt))
            .limit(4000),
        ]);

        const acquisitionTargets = entities
          .map((entity) => {
            const crawlerHits = recentRequests.filter((request: any) => {
              const path = String(request.path || "");
              const actorType = String(request.actorType || "").trim().toLowerCase();
              const sourceType = String(request.sourceType || "").trim().toLowerCase();
              const isMachineByType = actorType
                ? actorType === "bot" || actorType === "llm_bot"
                : Boolean(botSignatureLabel(request.userAgent));
              const isMachineBySource = sourceType
                ? sourceType === "crawler" || sourceType === "llm_crawler"
                : true;
              return (
                isMachineByType &&
                isMachineBySource &&
                path.includes(entity.entityId)
              );
            }).length;

            const advertiserScore =
              (entity.entityType === "restaurant" ? 3 : 1) +
              (entity.machineReadiness === "blocked"
                ? 3
                : entity.machineReadiness === "developing"
                  ? 1
                  : 0) +
              (entity.quality === "thin" ? 3 : entity.quality === "growing" ? 1 : 0) +
              Math.min(5, crawlerHits);

            return {
              id: entity.id,
              title: entity.title,
              entityType: entity.entityType,
              canonicalPath: entity.canonicalPath,
              location: entity.location,
              machineReadiness: entity.machineReadiness,
              quality: entity.quality,
              crawlerHits,
              advertiserScore,
              reasons: [
                ...entity.knowledgeGaps.slice(0, 2),
                ...entity.opportunities.slice(0, 2),
              ],
            };
          })
          .sort((a, b) => b.advertiserScore - a.advertiserScore)
          .slice(0, 8);

        const geoAds = geoAdTotals[0] || { impressions: 0, clicks: 0 };
        const geoPings = geoPingTotals[0] || { totalPings: 0, uniqueVisitors: 0 };
        const topQuery = topQueriesRows[0]?.query || "local food trucks";
        const topLocation =
          cityDemandRows[0]?.businessName ||
          cityDemandRows[0]?.address ||
          cityDemandRows[0]?.locationType ||
          "high-demand location";
        const topCuisine = cuisineRows[0]?.cuisineType || "food truck";

        const searchDemandCount = topQueriesRows.reduce(
          (sum: number, row: any) => sum + Number(row.count || 0),
          0,
        );
        const locationDemandCount = cityDemandRows.reduce(
          (sum: number, row: any) => sum + Number(row.requestCount || 0),
          0,
        );
        const machineDiscoveryCount = recentRequests.filter((request: any) => {
          const createdAt = new Date(request.createdAt).getTime();
          const actorType = String(request.actorType || "").trim().toLowerCase();
          const sourceType = String(request.sourceType || "").trim().toLowerCase();
          const isMachineByType = actorType
            ? actorType === "bot" || actorType === "llm_bot"
            : Boolean(botSignatureLabel(request.userAgent));
          const isMachineBySource = sourceType
            ? sourceType === "crawler" || sourceType === "llm_crawler"
            : true;
          return (
            createdAt >= since7d.getTime() &&
            isMachineByType &&
            isMachineBySource &&
            isHighValueObservedPath(request.path)
          );
        }).length;
        const exportHumanTruthSignalScore =
          Math.min(searchDemandCount, 10) +
          Math.min(locationDemandCount, 10) +
          Math.min(videoRows.length, 5);
        const exportMachineSupportScore = Math.min(machineDiscoveryCount, 5);
        const hasExportRecommendationDensity =
          exportHumanTruthSignalScore >= 10 &&
          (locationDemandCount >= 3 || searchDemandCount >= 5);

        const exportPayload = {
          type: exportType,
          generatedAt: new Date().toISOString(),
          signalContract: {
            mode: hasExportRecommendationDensity ? "recommendations" : "truth_only",
            reason: hasExportRecommendationDensity
              ? "First-party signal density is high enough for export recommendations."
              : "Not enough recent first-party signal to export recommendation packages safely.",
            observed: {
              exportHumanTruthSignalScore,
              exportMachineSupportScore,
              searchDemandCount,
              locationDemandCount,
              machineDiscoveryCount,
              contentMomentumCount: videoRows.length,
            },
          },
          advertiserBrief: {
            headline: hasExportRecommendationDensity
              ? `MealScout demand is clustering around ${topQuery} and ${topCuisine} inventory.`
              : "Recommendation exports paused while first-party signal density is low.",
            audienceAngle: hasExportRecommendationDensity
              ? `Promote around ${topLocation} where location demand and truck interest are forming.`
              : "Use truth counters and recent event evidence until enough density is present.",
            inventoryAngle: hasExportRecommendationDensity
              ? `${videoRows.length} recent stories, ${geoAds.impressions} geo-ad impressions, and ${geoPings.totalPings} foot-traffic pings create sponsor inventory.`
              : `Observed human truth score ${exportHumanTruthSignalScore} in the latest export window; machine support score ${exportMachineSupportScore}.`,
            recommendations: hasExportRecommendationDensity
              ? [
                  `Sponsor search and discovery around "${topQuery}"`,
                  `Build a localized package around ${topLocation}`,
                  `Bundle ${topCuisine} content with geo-distribution inventory`,
                ]
              : [],
          },
          acquisitionWatchlist: hasExportRecommendationDensity ? acquisitionTargets : [],
          sponsorPackage: {
            geoAds,
            footTraffic: geoPings,
            topQueries: topQueriesRows.slice(0, 5),
            topLocations: cityDemandRows.slice(0, 5),
            topCuisines: cuisineRows.slice(0, 5),
            contentMomentum: videoRows.slice(0, 5),
          },
        };

        if (format === "json") {
          return res.json({ ok: true, ...exportPayload });
        }

        const markdown = [
          `# MealScout ${exportType.replace(/_/g, " ")}`,
          ``,
          `Generated: ${exportPayload.generatedAt}`,
          ``,
          `## Advertiser Brief`,
          exportPayload.advertiserBrief.headline,
          ``,
          `- Audience angle: ${exportPayload.advertiserBrief.audienceAngle}`,
          `- Inventory angle: ${exportPayload.advertiserBrief.inventoryAngle}`,
          ...exportPayload.advertiserBrief.recommendations.map(
            (item) => `- ${item}`,
          ),
          ``,
          `## Acquisition Watchlist`,
          ...exportPayload.acquisitionWatchlist.map(
            (item) =>
              `- ${item.title} (${item.entityType}) | score ${item.advertiserScore} | crawler hits ${item.crawlerHits} | ${item.reasons.join(", ")}`,
          ),
          ``,
          `## Sponsor Package`,
          `- Geo ads: ${geoAds.impressions} impressions / ${geoAds.clicks} clicks`,
          `- Foot traffic: ${geoPings.totalPings} pings / ${geoPings.uniqueVisitors} unique visitors`,
          ...topQueriesRows.slice(0, 5).map(
            (item: any) => `- Query demand: ${item.query} (${item.count})`,
          ),
        ].join("\n");

        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="mealscout-${exportType}.md"`,
        );
        res.send(markdown);
      } catch (error) {
        console.error("Error exporting market intel package:", error);
        res.status(500).json({ message: "Failed to export market intel package" });
      }
    },
  );
}
