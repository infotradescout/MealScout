export type PrivateBehaviorScore = {
  restaurantId: string;
  privateBoostScore: number;
  visitIntentScore: number;
  orderVelocityScore: number;
  repeatCustomerScore: number;
  menuItemVelocityScore: number;
  dealConversionScore: number;
  engagementDepthScore: number;
  freshnessActivityScore: number;
  penalties: string[];
  sourceCounts: {
    menuViews?: number;
    mapTaps?: number;
    detailViews?: number;
    pickupOrdersCompleted?: number;
    repeatCustomers?: number;
    dealClaimsUsed?: number;
    businessContactIntents?: number;
    recentLocationUpdates?: number;
  };
};

export type PrivateBehaviorRawSignals = {
  restaurantId: string;
  menuViews7d: number;
  menuViews30d: number;
  mapTaps7d: number;
  mapTaps30d: number;
  detailViews7d: number;
  detailViews30d: number;
  businessContactIntents7d: number;
  businessContactIntents30d: number;
  completedOrders7d: number;
  completedOrders30d: number;
  repeatCustomers90d: number;
  menuItemsSold7d: number;
  menuItemsSold30d: number;
  dealViews30d: number;
  dealClaimsUsed30d: number;
  dislikes30d: number;
  likes30d: number;
  restaurantUpdatedAt?: Date | null;
  menuUpdatedAt?: Date | null;
  lastBroadcastAt?: Date | null;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const asDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (from: Date, to: Date) => {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

export function computePrivateBehaviorScoreFromSignals(
  signals: PrivateBehaviorRawSignals,
  now: Date = new Date(),
): PrivateBehaviorScore {
  const visitIntentScore = clamp(
    signals.menuViews7d * 1.4 +
      signals.mapTaps7d * 2.2 +
      signals.detailViews7d * 1.6 +
      signals.businessContactIntents30d * 3.5 +
      signals.menuViews30d * 0.2 +
      signals.mapTaps30d * 0.25,
    0,
    28,
  );

  const orderVelocityScore = clamp(
    signals.completedOrders7d * 3.5 + signals.completedOrders30d * 0.7,
    0,
    34,
  );

  const repeatCustomerScore = clamp(signals.repeatCustomers90d * 4.5, 0, 22);

  const menuItemVelocityScore = clamp(
    signals.menuItemsSold7d * 1.2 + signals.menuItemsSold30d * 0.35,
    0,
    20,
  );

  const conversionRate =
    signals.dealViews30d > 0
      ? signals.dealClaimsUsed30d / signals.dealViews30d
      : 0;
  const dealConversionScore = clamp(
    signals.dealClaimsUsed30d * 2.5 + conversionRate * 30,
    0,
    18,
  );

  const engagementDepthScore = clamp(
    signals.detailViews30d * 0.55 +
      signals.businessContactIntents30d * 2.2 +
      signals.menuViews30d * 0.12,
    0,
    16,
  );

  let freshnessActivityScore = 0;
  const newestActivity = [
    asDate(signals.restaurantUpdatedAt),
    asDate(signals.menuUpdatedAt),
    asDate(signals.lastBroadcastAt),
  ]
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (newestActivity) {
    const ageDays = Math.max(0, daysBetween(newestActivity, now));
    if (ageDays <= 3) freshnessActivityScore += 12;
    else if (ageDays <= 7) freshnessActivityScore += 8;
    else if (ageDays <= 30) freshnessActivityScore += 4;
    else if (ageDays <= 90) freshnessActivityScore += 1;
  }

  freshnessActivityScore += clamp(signals.completedOrders7d * 0.8, 0, 6);
  freshnessActivityScore += clamp(signals.mapTaps7d * 0.7, 0, 5);
  freshnessActivityScore = clamp(freshnessActivityScore, 0, 22);

  const penalties: string[] = [];
  let penaltyScore = 0;

  const privateActivityVolume =
    signals.menuViews30d +
    signals.mapTaps30d +
    signals.detailViews30d +
    signals.completedOrders30d +
    signals.menuItemsSold30d +
    signals.businessContactIntents30d;

  if (privateActivityVolume <= 2) {
    penalties.push("low_recent_private_activity");
    penaltyScore += 12;
  } else if (privateActivityVolume <= 6) {
    penalties.push("thin_recent_private_activity");
    penaltyScore += 6;
  }

  if (signals.dealViews30d >= 15 && conversionRate < 0.02) {
    penalties.push("weak_deal_conversion");
    penaltyScore += 7;
  }

  if (signals.dislikes30d > signals.likes30d) {
    penalties.push("negative_feedback_drift");
    penaltyScore += clamp((signals.dislikes30d - signals.likes30d) * 1.8, 0, 12);
  }

  const activityDateCandidates = [
    asDate(signals.restaurantUpdatedAt),
    asDate(signals.menuUpdatedAt),
    asDate(signals.lastBroadcastAt),
  ].filter((value): value is Date => Boolean(value));

  if (activityDateCandidates.length > 0) {
    const mostRecent = activityDateCandidates.sort(
      (a, b) => b.getTime() - a.getTime(),
    )[0];
    const staleDays = daysBetween(mostRecent, now);
    if (staleDays > 90) {
      penalties.push("stale_operator_activity");
      penaltyScore += 10;
    }
  }

  const privateBoostScore = clamp(
    Math.round(
      visitIntentScore +
        orderVelocityScore +
        repeatCustomerScore +
        menuItemVelocityScore +
        dealConversionScore +
        engagementDepthScore +
        freshnessActivityScore -
        penaltyScore,
    ),
    -30,
    90,
  );

  return {
    restaurantId: signals.restaurantId,
    privateBoostScore,
    visitIntentScore,
    orderVelocityScore,
    repeatCustomerScore,
    menuItemVelocityScore,
    dealConversionScore,
    engagementDepthScore,
    freshnessActivityScore,
    penalties,
    sourceCounts: {
      menuViews: signals.menuViews30d,
      mapTaps: signals.mapTaps30d,
      detailViews: signals.detailViews30d,
      pickupOrdersCompleted: signals.completedOrders30d,
      repeatCustomers: signals.repeatCustomers90d,
      dealClaimsUsed: signals.dealClaimsUsed30d,
      businessContactIntents: signals.businessContactIntents30d,
      recentLocationUpdates: signals.lastBroadcastAt ? 1 : 0,
    },
  };
}
