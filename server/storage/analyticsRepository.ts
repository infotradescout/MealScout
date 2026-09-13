import {
  deals,
  dealViews,
  dealClaims,
  users,
  restaurantFavorites,
  restaurantRecommendations,
  type DealView,
  type InsertDealView,
  type DealClaim,
  type RestaurantRecommendation,
} from "@shared/schema";
import { db as applicationDb } from "../db";
import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";

export function createAnalyticsRepository(db: typeof applicationDb = applicationDb) {
  return {
    async recordDealView(view: InsertDealView): Promise<DealView> {
      const [newView] = await db.insert(dealViews).values(view).returning();
      return newView;
    },

    async getDealViewsCount(
      dealId: string,
      dateRange?: { start: Date; end: Date },
    ): Promise<number> {
      const conditions = [eq(dealViews.dealId, dealId)];

      if (dateRange) {
        conditions.push(gte(dealViews.viewedAt, dateRange.start));
        conditions.push(lte(dealViews.viewedAt, dateRange.end));
      }

      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(dealViews)
        .where(and(...conditions));

      return result.count;
    },

    async hasRecentDealView(
      dealId: string,
      userId?: string,
      sessionId?: string,
      timeWindowMs: number = 3600000,
    ): Promise<boolean> {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      const conditions = [
        eq(dealViews.dealId, dealId),
        gte(dealViews.viewedAt, cutoffTime),
      ];

      if (userId) {
        conditions.push(eq(dealViews.userId, userId));
      } else if (sessionId) {
        conditions.push(eq(dealViews.sessionId, sessionId));
      } else {
        return false;
      }

      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(dealViews)
        .where(and(...conditions))
        .limit(1);

      return result.count > 0;
    },

    async markClaimAsUsed(
      claimId: string,
      orderAmount?: number | null,
    ): Promise<DealClaim | null> {
      const [claim] = await db
        .update(dealClaims)
        .set({
          isUsed: true,
          usedAt: new Date(),
          orderAmount: orderAmount == null ? null : orderAmount.toString(),
        })
        .where(and(eq(dealClaims.id, claimId), eq(dealClaims.isUsed, false)))
        .returning();
      return claim || null;
    },

    async getRestaurantAnalyticsSummary(
      restaurantId: string,
      dateRange?: { start: Date; end: Date },
    ) {
      const dealIds = await db
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.restaurantId, restaurantId));

      const dealIdArray = dealIds.map((d: any) => d.id);

      if (dealIdArray.length === 0) {
        return {
          totalViews: 0,
          totalClaims: 0,
          totalRevenue: 0,
          conversionRate: 0,
          topDeals: [],
        };
      }

      const viewConditions = [inArray(dealViews.dealId, dealIdArray)];
      const claimConditions = [inArray(dealClaims.dealId, dealIdArray)];

      if (dateRange) {
        viewConditions.push(gte(dealViews.viewedAt, dateRange.start));
        viewConditions.push(lte(dealViews.viewedAt, dateRange.end));
        claimConditions.push(gte(sql`coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt})`, dateRange.start));
        claimConditions.push(lte(sql`coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt})`, dateRange.end));
      }

      const [viewsResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(dealViews)
        .where(and(...viewConditions));

      const [claimsResult] = await db
        .select({
          count: sql<number>`count(*)`,
          revenue: sql<number>`coalesce(sum(cast(order_amount as decimal)), 0)`,
        })
        .from(dealClaims)
        .where(and(...claimConditions, eq(dealClaims.isUsed, true)));

      const totalViews = viewsResult.count || 0;
      const totalClaims = claimsResult.count || 0;
      const totalRevenue = claimsResult.revenue || 0;
      const conversionRate =
        totalViews > 0 ? (totalClaims / totalViews) * 100 : 0;

      const viewTotals = db.select({
        dealId: dealViews.dealId,
        views: sql<number>`count(*)`.as("views"),
      }).from(dealViews).where(and(...viewConditions)).groupBy(dealViews.dealId).as("view_totals");
      const claimTotals = db.select({
        dealId: dealClaims.dealId,
        claims: sql<number>`count(*)`.as("claims"),
        revenue: sql<number>`coalesce(sum(cast(${dealClaims.orderAmount} as decimal)), 0)`.as("revenue"),
      }).from(dealClaims).where(and(...claimConditions, eq(dealClaims.isUsed, true)))
        .groupBy(dealClaims.dealId).as("claim_totals");
      const topDeals = await db.select({
        dealId: deals.id,
        title: deals.title,
        views: sql<number>`coalesce(${viewTotals.views}, 0)`.mapWith(Number),
        claims: sql<number>`coalesce(${claimTotals.claims}, 0)`.mapWith(Number),
        revenue: sql<number>`coalesce(${claimTotals.revenue}, 0)`.mapWith(Number),
      }).from(deals)
        .leftJoin(viewTotals, eq(deals.id, viewTotals.dealId))
        .leftJoin(claimTotals, eq(deals.id, claimTotals.dealId))
        .where(eq(deals.restaurantId, restaurantId))
        .orderBy(desc(sql`coalesce(${viewTotals.views}, 0)`), deals.id).limit(5);

      return {
        totalViews,
        totalClaims,
        totalRevenue,
        conversionRate,
        topDeals,
      };
    },

    async getRestaurantAnalyticsTimeseries(
      restaurantId: string,
      dateRange: { start: Date; end: Date },
      interval: "day" | "week",
    ) {
      const dealIds = await db
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.restaurantId, restaurantId));

      const dealIdArray = dealIds.map((d: any) => d.id);

      if (dealIdArray.length === 0) {
        return [];
      }

      const dateFormat = interval === "day" ? "YYYY-MM-DD" : 'IYYY-"W"IW';
      // Aggregate independent view and redemption events, including days with
      // redemptions but no views. Never join two unaggregated fact tables.
      const result = await db.execute(sql`
        select activity.date, sum(activity.views)::int as views,
          sum(activity.claims)::int as claims, sum(activity.revenue)::numeric as revenue
        from (
          select to_char(${dealViews.viewedAt}, ${dateFormat}) as date,
            count(*) as views, 0 as claims, 0::numeric as revenue
          from ${dealViews}
          where ${inArray(dealViews.dealId, dealIdArray)}
            and ${gte(dealViews.viewedAt, dateRange.start)}
            and ${lte(dealViews.viewedAt, dateRange.end)}
          group by date
          union all
          select to_char(coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}), ${dateFormat}) as date,
            0 as views, count(*) as claims,
            coalesce(sum(cast(${dealClaims.orderAmount} as decimal)), 0) as revenue
          from ${dealClaims}
          where ${inArray(dealClaims.dealId, dealIdArray)} and ${eq(dealClaims.isUsed, true)}
            and coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}) >= ${dateRange.start}
            and coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}) <= ${dateRange.end}
          group by date
        ) activity group by activity.date order by activity.date
      `);
      return result.rows.map((row: any) => ({
        date: row.date, views: Number(row.views), claims: Number(row.claims), revenue: Number(row.revenue),
      }));
    },

    async getRestaurantCustomerInsights(
      restaurantId: string,
      dateRange?: { start: Date; end: Date },
    ) {
      const dealIds = await db
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.restaurantId, restaurantId));

      const dealIdArray = dealIds.map((d: any) => d.id);

      if (dealIdArray.length === 0) {
        return {
          repeatCustomers: 0,
          averageOrderValue: 0,
          peakHours: [],
          demographics: {
            ageGroups: [],
            genderBreakdown: [],
          },
        };
      }

      const conditions = [
        inArray(dealClaims.dealId, dealIdArray),
        eq(dealClaims.isUsed, true),
      ];

      if (dateRange) {
        conditions.push(gte(dealClaims.usedAt, dateRange.start));
        conditions.push(lte(dealClaims.usedAt, dateRange.end));
      }

      const [repeatResult] = await db.select({
        count: sql<number>`count(distinct user_id) filter (where claim_count > 1)`,
      }).from(sql`(
          select user_id, count(*) as claim_count
          from ${dealClaims}
          where ${and(...conditions)}
          group by user_id
        ) as user_claims`);

      const [avgResult] = await db
        .select({
          avg: sql<number>`avg(cast(order_amount as decimal))`,
        })
        .from(dealClaims)
        .where(and(...conditions));

      const peakHours = await db
        .select({
          hour: sql<number>`extract(hour from used_at)`,
          count: sql<number>`count(*)`,
        })
        .from(dealClaims)
        .where(and(...conditions))
        .groupBy(sql`extract(hour from used_at)`)
        .orderBy(desc(sql`count(*)`))
        .limit(5);

      const ageGroups = await db
        .select({
          range: sql<string>`
            case
              when extract(year from now()) - birth_year < 25 then '18-24'
              when extract(year from now()) - birth_year < 35 then '25-34'
              when extract(year from now()) - birth_year < 45 then '35-44'
              when extract(year from now()) - birth_year < 55 then '45-54'
              when extract(year from now()) - birth_year >= 55 then '55+'
              else 'Unknown'
            end
          `,
          count: sql<number>`count(distinct ${users.id})`,
        })
        .from(dealClaims)
        .innerJoin(users, eq(dealClaims.userId, users.id))
        .where(and(...conditions)).groupBy(sql`
          case
            when extract(year from now()) - birth_year < 25 then '18-24'
            when extract(year from now()) - birth_year < 35 then '25-34'
            when extract(year from now()) - birth_year < 45 then '35-44'
            when extract(year from now()) - birth_year < 55 then '45-54'
            when extract(year from now()) - birth_year >= 55 then '55+'
            else 'Unknown'
          end
        `);

      const genderBreakdown = await db
        .select({
          gender: sql<string>`coalesce(gender, 'Unknown')`,
          count: sql<number>`count(distinct ${users.id})`,
        })
        .from(dealClaims)
        .innerJoin(users, eq(dealClaims.userId, users.id))
        .where(and(...conditions))
        .groupBy(users.gender);

      return {
        repeatCustomers: repeatResult.count || 0,
        averageOrderValue: avgResult.avg || 0,
        peakHours,
        demographics: {
          ageGroups,
          genderBreakdown,
        },
      };
    },

    async getRestaurantAnalyticsExport(
      restaurantId: string,
      dateRange: { start: Date; end: Date },
    ) {
      const result = await db.execute(sql`
        select ${deals.title} as "dealTitle", activity.date,
          sum(activity.views)::int as views, sum(activity.claims)::int as claims,
          sum(activity.revenue)::numeric as revenue
        from (
          select ${dealViews.dealId} as deal_id,
            to_char(${dealViews.viewedAt}, 'YYYY-MM-DD') as date,
            count(*) as views, 0 as claims, 0::numeric as revenue
          from ${dealViews}
          where ${gte(dealViews.viewedAt, dateRange.start)} and ${lte(dealViews.viewedAt, dateRange.end)}
          group by ${dealViews.dealId}, date
          union all
          select ${dealClaims.dealId} as deal_id,
            to_char(coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}), 'YYYY-MM-DD') as date,
            0 as views, count(*) as claims,
            coalesce(sum(cast(${dealClaims.orderAmount} as decimal)), 0) as revenue
          from ${dealClaims} where ${eq(dealClaims.isUsed, true)}
            and coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}) >= ${dateRange.start}
            and coalesce(${dealClaims.usedAt}, ${dealClaims.claimedAt}) <= ${dateRange.end}
          group by ${dealClaims.dealId}, date
        ) activity inner join ${deals} on ${deals.id} = activity.deal_id
        where ${eq(deals.restaurantId, restaurantId)}
        group by ${deals.id}, ${deals.title}, activity.date
        order by ${deals.title}, ${deals.id}, activity.date
      `);
      return result.rows.map((row: any) => ({
        dealTitle: row.dealTitle, date: row.date,
        views: Number(row.views), claims: Number(row.claims), revenue: Number(row.revenue),
      }));
    },

    async getRestaurantFavoritesAnalytics(
      restaurantId: string,
      dateRange?: { start: Date; end: Date },
    ) {
      let favorites;
      if (dateRange) {
        favorites = await db
          .select({
            id: restaurantFavorites.id,
            favoritedAt: restaurantFavorites.favoritedAt,
            userId: restaurantFavorites.userId,
          })
          .from(restaurantFavorites)
          .where(
            and(
              eq(restaurantFavorites.restaurantId, restaurantId),
              gte(restaurantFavorites.favoritedAt, dateRange.start),
              lte(restaurantFavorites.favoritedAt, dateRange.end),
            ),
          );
      } else {
        favorites = await db
          .select({
            id: restaurantFavorites.id,
            favoritedAt: restaurantFavorites.favoritedAt,
            userId: restaurantFavorites.userId,
          })
          .from(restaurantFavorites)
          .where(eq(restaurantFavorites.restaurantId, restaurantId));
      }

      const favoritesTrend = await db
        .select({
          date: sql<string>`DATE(${restaurantFavorites.favoritedAt})`,
          count: sql<number>`COUNT(*)`,
        })
        .from(restaurantFavorites)
        .where(
          dateRange
            ? and(
                eq(restaurantFavorites.restaurantId, restaurantId),
                gte(restaurantFavorites.favoritedAt, dateRange.start),
                lte(restaurantFavorites.favoritedAt, dateRange.end),
              )
            : eq(restaurantFavorites.restaurantId, restaurantId),
        )
        .groupBy(sql`DATE(${restaurantFavorites.favoritedAt})`)
        .orderBy(sql`DATE(${restaurantFavorites.favoritedAt})`);

      return {
        totalFavorites: favorites.length,
        favoritesTrend,
        recentFavorites: favorites
          .slice(0, 10)
          .map((f: { userId: string; favoritedAt: Date | null }) => ({
            userId: f.userId,
            favoritedAt: f.favoritedAt || new Date(),
          })),
      };
    },

    async trackRestaurantRecommendation(recommendation: {
      restaurantId: string;
      userId?: string;
      sessionId: string;
      recommendationType: "homepage" | "search" | "nearby" | "personalized";
      recommendationContext?: string;
    }): Promise<RestaurantRecommendation> {
      const [result] = await db
        .insert(restaurantRecommendations)
        .values(recommendation)
        .returning();
      return result;
    },

    async markRecommendationClicked(recommendationId: string): Promise<void> {
      await db
        .update(restaurantRecommendations)
        .set({
          isClicked: true,
          clickedAt: new Date(),
        })
        .where(eq(restaurantRecommendations.id, recommendationId));
    },

    async getRestaurantRecommendationsAnalytics(
      restaurantId: string,
      dateRange?: { start: Date; end: Date },
    ) {
      let recommendations;
      if (dateRange) {
        recommendations = await db
          .select({
            id: restaurantRecommendations.id,
            recommendationType: restaurantRecommendations.recommendationType,
            isClicked: restaurantRecommendations.isClicked,
            showedAt: restaurantRecommendations.showedAt,
            clickedAt: restaurantRecommendations.clickedAt,
          })
          .from(restaurantRecommendations)
          .where(
            and(
              eq(restaurantRecommendations.restaurantId, restaurantId),
              gte(restaurantRecommendations.showedAt, dateRange.start),
              lte(restaurantRecommendations.showedAt, dateRange.end),
            ),
          );
      } else {
        recommendations = await db
          .select({
            id: restaurantRecommendations.id,
            recommendationType: restaurantRecommendations.recommendationType,
            isClicked: restaurantRecommendations.isClicked,
            showedAt: restaurantRecommendations.showedAt,
            clickedAt: restaurantRecommendations.clickedAt,
          })
          .from(restaurantRecommendations)
          .where(eq(restaurantRecommendations.restaurantId, restaurantId));
      }

      const totalClicks = recommendations.filter(
        (r: { isClicked: boolean | null }) => r.isClicked === true,
      ).length;
      const clickThroughRate =
        recommendations.length > 0
          ? (totalClicks / recommendations.length) * 100
          : 0;

      const recommendationsByType = recommendations.reduce(
        (
          acc: Array<{ type: string; count: number; clicks: number }>,
          rec: { recommendationType: string; isClicked: boolean | null },
        ) => {
          const existing = acc.find(
            (item: { type: string }) => item.type === rec.recommendationType,
          );
          if (existing) {
            existing.count++;
            if (rec.isClicked === true) existing.clicks++;
          } else {
            acc.push({
              type: rec.recommendationType,
              count: 1,
              clicks: rec.isClicked === true ? 1 : 0,
            });
          }
          return acc;
        },
        [] as Array<{ type: string; count: number; clicks: number }>,
      );

      const recommendationsTrend = await db
        .select({
          date: sql<string>`DATE(${restaurantRecommendations.showedAt})`,
          count: sql<number>`COUNT(*)`,
          clicks: sql<number>`SUM(CASE WHEN ${restaurantRecommendations.isClicked} = true THEN 1 ELSE 0 END)`,
        })
        .from(restaurantRecommendations)
        .where(
          dateRange
            ? and(
                eq(restaurantRecommendations.restaurantId, restaurantId),
                gte(restaurantRecommendations.showedAt, dateRange.start),
                lte(restaurantRecommendations.showedAt, dateRange.end),
              )
            : eq(restaurantRecommendations.restaurantId, restaurantId),
        )
        .groupBy(sql`DATE(${restaurantRecommendations.showedAt})`)
        .orderBy(sql`DATE(${restaurantRecommendations.showedAt})`);

      return {
        totalRecommendations: recommendations.length,
        totalClicks,
        clickThroughRate: Math.round(clickThroughRate * 100) / 100,
        recommendationsByType,
        recommendationsTrend,
      };
    },
  };
}

export type AnalyticsRepository = ReturnType<typeof createAnalyticsRepository>;
