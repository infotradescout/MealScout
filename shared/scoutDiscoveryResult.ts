import { toCanonicalFoodBusinessType, type FoodBusinessType } from "./businessTypes";

export type ScoutDiscoveryResultKind =
  | "business"
  | "food_truck"
  | "dish"
  | "deal"
  | "event";

export type ScoutDiscoveryScope = "nearby" | "network";

export type ScoutDiscoverySource =
  | "local_inventory"
  | "live_presence"
  | "menu"
  | "deal"
  | "event"
  | "trending"
  | "network_search";

export type ScoutDiscoveryLocation = {
  city: string | null;
  state: string | null;
  distanceMiles: number | null;
  scope: ScoutDiscoveryScope;
  label: string | null;
};

export type ScoutDiscoveryRelevance = {
  score: number;
  matchedTerms: string[];
};

export type ScoutDiscoveryActivity = {
  score: number;
  reasons: string[];
};

export type ScoutDiscoveryResult<T = unknown> = {
  key: string;
  entityId: string;
  businessKey: string | null;
  kind: ScoutDiscoveryResultKind;
  businessType: FoodBusinessType | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  imageUrl: string | null;
  href: string | null;
  location: ScoutDiscoveryLocation;
  relevance: ScoutDiscoveryRelevance;
  activity: ScoutDiscoveryActivity;
  source: ScoutDiscoverySource;
  raw: T;
};

export type ScoutDiscoveryAdapterOptions<T> = {
  kind: ScoutDiscoveryResultKind;
  scope: ScoutDiscoveryScope;
  source: ScoutDiscoverySource;
  queryTerms?: string[];
  href?: string | null | ((row: T) => string | null);
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  source: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(
  source: Record<string, unknown>,
  fields: string[],
): number | null {
  for (const field of fields) {
    const parsed = Number(source[field]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function slugKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resultIdentity(
  source: Record<string, unknown>,
  kind: ScoutDiscoveryResultKind,
): { entityId: string; businessKey: string | null; key: string } {
  const entityId =
    readString(source, ["id", "entityId", "menuItemId", "dealId", "eventId"]) ||
    slugKey(
      readString(source, ["name", "title", "businessName", "restaurantName"]),
    ) ||
    "unknown";
  const businessId = readString(source, [
    "businessId",
    "restaurantId",
    "truckId",
    "profileId",
  ]);
  const businessKey =
    kind === "business" || kind === "food_truck"
      ? `business:${businessId || entityId}`
      : businessId
        ? `business:${businessId}`
        : null;
  return {
    entityId,
    businessKey,
    key: `${kind}:${entityId}`,
  };
}

function activityFor(source: Record<string, unknown>): ScoutDiscoveryActivity {
  const reasons: string[] = [];
  const homeRankingScore = readNumber(source, ["homeRankingScore"]) || 0;
  const community =
    readNumber(source, [
      "communityActivityCount",
      "recommendationCount",
      "videoRecommendationCount",
    ]) || 0;
  const favorites = readNumber(source, ["favoriteCount", "followCount"]) || 0;
  const deals =
    readNumber(source, ["activeDealCount", "activeDealsCount"]) || 0;
  const trend = readNumber(source, ["trendScore", "discoveryScore"]) || 0;

  if (community > 0) reasons.push("community");
  if (favorites > 0) reasons.push("saved");
  if (deals > 0) reasons.push("deal");
  if (trend > 0) reasons.push("trending");

  return {
    score:
      homeRankingScore * 10 +
      community * 5 +
      favorites * 3 +
      deals * 4 +
      trend,
    reasons,
  };
}

function relevanceFor(
  source: Record<string, unknown>,
  queryTerms: string[],
): ScoutDiscoveryRelevance {
  const normalizedTerms = Array.from(
    new Set(
      queryTerms
        .map((term) => String(term || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (normalizedTerms.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const title = String(
    readString(source, ["name", "title", "businessName", "restaurantName"]) ||
      "",
  ).toLowerCase();
  const haystack = [
    title,
    readString(source, ["description"]),
    readString(source, ["cuisineType"]),
    readString(source, ["businessType"]),
    readString(source, ["city"]),
    readString(source, ["state"]),
    ...(Array.isArray(source.tags) ? source.tags : []),
    ...(Array.isArray(source.dietaryTags) ? source.dietaryTags : []),
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  const matchedTerms = normalizedTerms.filter((term) =>
    haystack.includes(term),
  );
  const exactTitle = matchedTerms.some((term) => title === term);
  const titleStarts = matchedTerms.some((term) => title.startsWith(term));
  return {
    matchedTerms,
    score:
      matchedTerms.length * 25 +
      (exactTitle ? 50 : 0) +
      (!exactTitle && titleStarts ? 20 : 0),
  };
}

export function toScoutDiscoveryResult<T>(
  raw: T,
  options: ScoutDiscoveryAdapterOptions<T>,
): ScoutDiscoveryResult<T> {
  const source = recordOf(raw);
  const identity = resultIdentity(source, options.kind);
  const title =
    readString(source, ["name", "title", "businessName", "restaurantName"]) ||
    "MealScout result";
  const city = readString(source, ["city", "restaurantCity", "hostCity"]);
  const state = readString(source, ["state", "restaurantState", "hostState"]);
  const miles = readNumber(source, ["distanceMiles"]);
  const distanceKm = readNumber(source, ["distance"]);
  const distanceMiles =
    miles !== null ? miles : distanceKm !== null ? distanceKm * 0.621371 : null;
  const locationLabel = [city, state].filter(Boolean).join(", ") || null;
  const rawBusinessType =
    readString(source, ["businessType", "profileType", "entityType"]) ||
    (options.kind === "food_truck" ? "food_truck" : null);
  const href =
    typeof options.href === "function"
      ? options.href(raw)
      : options.href || null;

  return {
    ...identity,
    kind: options.kind,
    businessType: toCanonicalFoodBusinessType(rawBusinessType),
    title,
    subtitle: readString(source, ["cuisineType", "statusLabel"]),
    description: readString(source, ["description", "notice"]),
    imageUrl: readString(source, [
      "coverImageUrl",
      "heroImageUrl",
      "imageUrl",
      "logoUrl",
      "restaurantCoverImageUrl",
      "restaurantLogoUrl",
    ]),
    href,
    location: {
      city,
      state,
      distanceMiles,
      scope: options.scope,
      label: locationLabel,
    },
    relevance: relevanceFor(source, options.queryTerms || []),
    activity: activityFor(source),
    source: options.source,
    raw,
  };
}

export function rankScoutDiscoveryResults<T>(
  results: ScoutDiscoveryResult<T>[],
): ScoutDiscoveryResult<T>[] {
  return [...results].sort((a, b) => {
    if (a.location.scope !== b.location.scope) {
      return a.location.scope === "nearby" ? -1 : 1;
    }
    if (a.relevance.score !== b.relevance.score) {
      return b.relevance.score - a.relevance.score;
    }
    if (a.activity.score !== b.activity.score) {
      return b.activity.score - a.activity.score;
    }
    return a.title.localeCompare(b.title);
  });
}

export function dedupeScoutDiscoveryResults<T>(
  results: ScoutDiscoveryResult<T>[],
): ScoutDiscoveryResult<T>[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const dedupeKey =
      result.kind === "business" || result.kind === "food_truck"
        ? result.businessKey || result.key
        : result.key;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

export function selectScoutDiscoveryResults<T>(
  rows: T[],
  options: ScoutDiscoveryAdapterOptions<T> & { limit?: number },
): ScoutDiscoveryResult<T>[] {
  return dedupeScoutDiscoveryResults(
    rankScoutDiscoveryResults(
      rows.map((row) => toScoutDiscoveryResult(row, options)),
    ),
  ).slice(0, options.limit ?? rows.length);
}
