import { and, gte, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../db";
import {
  dealClaims,
  dealViews,
  deals,
  menuItems,
  pickupOrderItems,
  pickupOrders,
  restaurants,
} from "@shared/schema";
import {
  computePrivateBehaviorScoreFromSignals,
  type PrivateBehaviorScore,
} from "./privateBehaviorScoreModel";

export type { PrivateBehaviorScore } from "./privateBehaviorScoreModel";
export { computePrivateBehaviorScoreFromSignals } from "./privateBehaviorScoreModel";

const asNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toRows = <T>(result: unknown): T[] => {
  if (Array.isArray(result)) return result as T[];
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).rows)
  ) {
    return (result as any).rows as T[];
  }
  return [];
};

export async function getPrivateBehaviorScoresForRestaurants(
  restaurantIds: string[],
  now: Date = new Date(),
): Promise<Map<string, PrivateBehaviorScore>> {
  const normalizedIds = Array.from(
    new Set(restaurantIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  if (normalizedIds.length === 0) return new Map();

  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [
    telemetryResult,
    orderResult,
    repeatResult,
    itemVelocityResult,
    dealResult,
    reactionResult,
    restaurantFreshnessRows,
    menuFreshnessRows,
  ] = await Promise.all([
    db.execute(sql<{
      restaurant_id: string;
      menu_views_7d: number;
      menu_views_30d: number;
      map_taps_7d: number;
      map_taps_30d: number;
      detail_views_7d: number;
      detail_views_30d: number;
      business_contact_intents_7d: number;
      business_contact_intents_30d: number;
    }>`
        with mapped as (
          select
            coalesce(
              te.properties->>'restaurantId',
              te.properties->>'truckId',
              te.properties->>'businessId',
              te.properties->>'entityId'
            ) as restaurant_id,
            lower(coalesce(te.event_name, '')) as event_name,
            te.created_at
          from telemetry_events te
          where te.created_at >= ${since90d}
        )
        select
          mapped.restaurant_id,
          count(*) filter (
            where mapped.created_at >= ${since7d}
              and mapped.event_name like '%menu%'
              and (mapped.event_name like '%view%' or mapped.event_name like '%open%' or mapped.event_name like '%tap%' or mapped.event_name like '%click%')
          )::int as menu_views_7d,
          count(*) filter (
            where mapped.created_at >= ${since30d}
              and mapped.event_name like '%menu%'
              and (mapped.event_name like '%view%' or mapped.event_name like '%open%' or mapped.event_name like '%tap%' or mapped.event_name like '%click%')
          )::int as menu_views_30d,
          count(*) filter (
            where mapped.created_at >= ${since7d}
              and mapped.event_name like '%map%'
              and (mapped.event_name like '%tap%' or mapped.event_name like '%click%' or mapped.event_name like '%view%')
          )::int as map_taps_7d,
          count(*) filter (
            where mapped.created_at >= ${since30d}
              and mapped.event_name like '%map%'
              and (mapped.event_name like '%tap%' or mapped.event_name like '%click%' or mapped.event_name like '%view%')
          )::int as map_taps_30d,
          count(*) filter (
            where mapped.created_at >= ${since7d}
              and (
                mapped.event_name like '%detail%'
                or (mapped.event_name like '%restaurant%' and mapped.event_name like '%view%')
              )
          )::int as detail_views_7d,
          count(*) filter (
            where mapped.created_at >= ${since30d}
              and (
                mapped.event_name like '%detail%'
                or (mapped.event_name like '%restaurant%' and mapped.event_name like '%view%')
              )
          )::int as detail_views_30d,
          count(*) filter (
            where mapped.created_at >= ${since7d}
              and (
                mapped.event_name like '%contact%'
                or mapped.event_name like '%message%'
                or mapped.event_name like '%business_conversation%'
              )
          )::int as business_contact_intents_7d,
          count(*) filter (
            where mapped.created_at >= ${since30d}
              and (
                mapped.event_name like '%contact%'
                or mapped.event_name like '%message%'
                or mapped.event_name like '%business_conversation%'
              )
          )::int as business_contact_intents_30d
        from mapped
        where mapped.restaurant_id = any(${normalizedIds}::text[])
        group by mapped.restaurant_id
      `),
    db.execute(sql<{
      restaurant_id: string;
      completed_orders_7d: number;
      completed_orders_30d: number;
    }>`
        select
          po.restaurant_id,
          count(*) filter (
            where po.created_at >= ${since7d}
              and lower(coalesce(po.status, '')) in ('confirmed', 'ready', 'completed')
          )::int as completed_orders_7d,
          count(*) filter (
            where po.created_at >= ${since30d}
              and lower(coalesce(po.status, '')) in ('confirmed', 'ready', 'completed')
          )::int as completed_orders_30d
        from pickup_orders po
        where
          po.restaurant_id = any(${normalizedIds}::text[])
          and po.created_at >= ${since90d}
        group by po.restaurant_id
      `),
    db.execute(sql<{
      restaurant_id: string;
      repeat_customers_90d: number;
    }>`
        with customer_orders as (
          select
            po.restaurant_id,
            po.customer_id,
            count(*)::int as order_count
          from pickup_orders po
          where
            po.restaurant_id = any(${normalizedIds}::text[])
            and po.created_at >= ${since90d}
            and po.customer_id is not null
            and lower(coalesce(po.status, '')) in ('confirmed', 'ready', 'completed')
          group by po.restaurant_id, po.customer_id
        )
        select
          restaurant_id,
          count(*)::int as repeat_customers_90d
        from customer_orders
        where order_count >= 2
        group by restaurant_id
      `),
    db.execute(sql<{
      restaurant_id: string;
      menu_items_sold_7d: number;
      menu_items_sold_30d: number;
    }>`
        select
          po.restaurant_id,
          coalesce(sum(case when po.created_at >= ${since7d} then poi.quantity else 0 end), 0)::int as menu_items_sold_7d,
          coalesce(sum(case when po.created_at >= ${since30d} then poi.quantity else 0 end), 0)::int as menu_items_sold_30d
        from pickup_order_items poi
        inner join pickup_orders po on po.id = poi.order_id
        where
          po.restaurant_id = any(${normalizedIds}::text[])
          and po.created_at >= ${since90d}
          and lower(coalesce(po.status, '')) in ('confirmed', 'ready', 'completed')
        group by po.restaurant_id
      `),
    db.execute(sql<{
      restaurant_id: string;
      deal_views_30d: number;
      deal_claims_used_30d: number;
    }>`
        with view_rows as (
          select
            d.restaurant_id,
            count(*)::int as deal_views_30d
          from deal_views dv
          inner join deals d on d.id = dv.deal_id
          where
            d.restaurant_id = any(${normalizedIds}::text[])
            and dv.viewed_at >= ${since30d}
          group by d.restaurant_id
        ),
        used_claim_rows as (
          select
            d.restaurant_id,
            count(*)::int as deal_claims_used_30d
          from deal_claims dc
          inner join deals d on d.id = dc.deal_id
          where
            d.restaurant_id = any(${normalizedIds}::text[])
            and dc.is_used = true
            and coalesce(dc.used_at, dc.claimed_at) >= ${since30d}
          group by d.restaurant_id
        )
        select
          ids.restaurant_id,
          coalesce(view_rows.deal_views_30d, 0)::int as deal_views_30d,
          coalesce(used_claim_rows.deal_claims_used_30d, 0)::int as deal_claims_used_30d
        from unnest(${normalizedIds}::text[]) as ids(restaurant_id)
        left join view_rows on view_rows.restaurant_id = ids.restaurant_id
        left join used_claim_rows on used_claim_rows.restaurant_id = ids.restaurant_id
      `),
    db.execute(sql<{
      restaurant_id: string;
      dislikes_30d: number;
      likes_30d: number;
    }>`
        select
          rur.restaurant_id,
          count(*) filter (
            where lower(coalesce(rr.reaction_type, '')) in ('dislike', 'disliked', 'downvote', 'thumbs_down', 'negative')
          )::int as dislikes_30d,
          count(*) filter (
            where lower(coalesce(rr.reaction_type, '')) in ('like', 'liked', 'upvote', 'thumbs_up', 'positive')
          )::int as likes_30d
        from recommendation_reactions rr
        inner join restaurant_user_recommendations rur on rur.id = rr.recommendation_id
        where
          rur.restaurant_id = any(${normalizedIds}::text[])
          and rr.created_at >= ${since30d}
        group by rur.restaurant_id
      `),
    db
      .select({
        restaurantId: restaurants.id,
        updatedAt: restaurants.updatedAt,
        lastBroadcastAt: restaurants.lastBroadcastAt,
      })
      .from(restaurants)
      .where(inArray(restaurants.id, normalizedIds)),
    db
      .select({
        restaurantId: menuItems.restaurantId,
        menuUpdatedAt: sql<Date>`max(${menuItems.updatedAt})`.as(
          "menuUpdatedAt",
        ),
      })
      .from(menuItems)
      .where(
        and(
          inArray(menuItems.restaurantId, normalizedIds),
          isNotNull(menuItems.restaurantId),
          gte(menuItems.updatedAt, since90d),
        ),
      )
      .groupBy(menuItems.restaurantId),
  ]);

  const telemetryByRestaurant = new Map(
    toRows<any>(telemetryResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const ordersByRestaurant = new Map(
    toRows<any>(orderResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const repeatsByRestaurant = new Map(
    toRows<any>(repeatResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const itemsByRestaurant = new Map(
    toRows<any>(itemVelocityResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const dealsByRestaurant = new Map(
    toRows<any>(dealResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const reactionsByRestaurant = new Map(
    toRows<any>(reactionResult).map((row) => [
      String(row.restaurant_id || ""),
      row,
    ]),
  );
  const freshnessByRestaurant = new Map(
    restaurantFreshnessRows.map((row: any) => [
      String(row.restaurantId || ""),
      row,
    ]),
  );
  const menuFreshnessByRestaurant = new Map(
    menuFreshnessRows.map((row: any) => [String(row.restaurantId || ""), row]),
  );

  const output = new Map<string, PrivateBehaviorScore>();
  for (const restaurantId of normalizedIds) {
    const telemetry = telemetryByRestaurant.get(restaurantId) || {};
    const orders = ordersByRestaurant.get(restaurantId) || {};
    const repeats = repeatsByRestaurant.get(restaurantId) || {};
    const itemVelocity = itemsByRestaurant.get(restaurantId) || {};
    const dealSignals = dealsByRestaurant.get(restaurantId) || {};
    const reactionSignals = reactionsByRestaurant.get(restaurantId) || {};
    const restaurantFreshness =
      (freshnessByRestaurant.get(restaurantId) || {}) as {
        updatedAt?: Date | null;
        lastBroadcastAt?: Date | null;
      };
    const menuFreshness =
      (menuFreshnessByRestaurant.get(restaurantId) || {}) as {
        menuUpdatedAt?: Date | null;
      };

    const computed = computePrivateBehaviorScoreFromSignals(
      {
        restaurantId,
        menuViews7d: asNumber(telemetry.menu_views_7d),
        menuViews30d: asNumber(telemetry.menu_views_30d),
        mapTaps7d: asNumber(telemetry.map_taps_7d),
        mapTaps30d: asNumber(telemetry.map_taps_30d),
        detailViews7d: asNumber(telemetry.detail_views_7d),
        detailViews30d: asNumber(telemetry.detail_views_30d),
        businessContactIntents7d: asNumber(
          telemetry.business_contact_intents_7d,
        ),
        businessContactIntents30d: asNumber(
          telemetry.business_contact_intents_30d,
        ),
        completedOrders7d: asNumber(orders.completed_orders_7d),
        completedOrders30d: asNumber(orders.completed_orders_30d),
        repeatCustomers90d: asNumber(repeats.repeat_customers_90d),
        menuItemsSold7d: asNumber(itemVelocity.menu_items_sold_7d),
        menuItemsSold30d: asNumber(itemVelocity.menu_items_sold_30d),
        dealViews30d: asNumber(dealSignals.deal_views_30d),
        dealClaimsUsed30d: asNumber(dealSignals.deal_claims_used_30d),
        dislikes30d: asNumber(reactionSignals.dislikes_30d),
        likes30d: asNumber(reactionSignals.likes_30d),
        restaurantUpdatedAt: asDate(restaurantFreshness.updatedAt),
        menuUpdatedAt: asDate(menuFreshness.menuUpdatedAt),
        lastBroadcastAt: asDate(restaurantFreshness.lastBroadcastAt),
      },
      now,
    );

    output.set(restaurantId, computed);
  }

  return output;
}
