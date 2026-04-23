// VAC-lite: Auto-verify restaurant signup (real signals only)
// Uses verifiable DNS, email domain, and consistency checks to determine verification eligibility

import type { User } from "@shared/schema";
import {
  restaurantFavorites,
  restaurantFollows,
  restaurantUserRecommendations,
  restaurants,
  videoStories,
} from "@shared/schema";
import { db } from "./db";
import { logAudit } from "./auditLogger";
import type { Request } from "express";
import { computeExternalReviewAdjustment } from "./services/externalReviewScoring";
import { eq, sql } from "drizzle-orm";

function vacNormalizePhone(input: unknown): string {
  return String(input || "").replace(/\D/g, "").slice(-10);
}

function vacSafeLower(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

function vacGetEmailDomain(email: string): string {
  const e = vacSafeLower(email);
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return "";
  return e.slice(at + 1);
}

function vacGetHostnameFromUrl(url: unknown): string {
  try {
    if (!url) return "";
    let u = String(url).trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const host = new URL(u).hostname || "";
    return host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

async function vacHasMx(domain: string): Promise<boolean> {
  try {
    if (!domain) return false;
    const { resolveMx } = await import("dns/promises");
    const records = await resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

async function vacHasDns(domain: string): Promise<boolean> {
  try {
    if (!domain) return false;
    const dns = await import("dns/promises");

    // Try resolveAny first (broad), then A/AAAA as fallback
    try {
      if (typeof dns.resolveAny === "function") {
        const any = await dns.resolveAny(domain);
        if (Array.isArray(any) && any.length > 0) return true;
      }
    } catch {}

    try {
      if (typeof dns.resolve4 === "function") {
        const a = await dns.resolve4(domain);
        if (Array.isArray(a) && a.length > 0) return true;
      }
    } catch {}

    try {
      if (typeof dns.resolve6 === "function") {
        const aaaa = await dns.resolve6(domain);
        if (Array.isArray(aaaa) && aaaa.length > 0) return true;
      }
    } catch {}

    return false;
  } catch {
    return false;
  }
}

function vacIsFreeEmailDomain(domain: string): boolean {
  const d = (domain || "").toLowerCase();
  return [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "aol.com",
    "proton.me",
    "protonmail.com"
  ].includes(d);
}

interface VacRestaurantInput {
  id?: string;
  phone?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookPageUrl?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  address?: string;
  externalReviewRating?: number | null;
  externalReviewSourceCount?: number | null;
  manualTrustScoreAdjustment?: number | null;
}

interface VacEvaluationResult {
  version: string;
  score: number;
  baseScore: number;
  threshold: number;
  shouldAutoVerify: boolean;
  signals: {
    emailDomain: string | null;
    websiteHost: string | null;
    emailDomainHasMx: boolean;
    websiteDomainResolves: boolean;
    emailMatchesWebsite: boolean;
    hasSocial: boolean;
    hasGeo: boolean;
    hasAddress: boolean;
    phoneMatches: boolean;
    freeEmailDomain: boolean;
    externalReviewRating: number | null;
    externalReviewAdjustment: number;
    externalReviewSourceCount: number;
    manualTrustScoreAdjustment: number;
    liveBoost: number;
    liveBoostPercentile: number | null;
    goldenPlateBonus: number;
  };
}

async function vacComputeLiveBoost(
  restaurantId: string,
): Promise<{
  liveBoost: number;
  percentile: number | null;
}> {
  if (!restaurantId) return { liveBoost: 0, percentile: null };

  try {
    const rows = await db.execute(sql<{
      id: string;
      raw_activity: number;
    }>`
      with
      fav as (
        select restaurant_id, count(*)::int as c
        from ${restaurantFavorites}
        group by restaurant_id
      ),
      fol as (
        select restaurant_id, count(*)::int as c
        from ${restaurantFollows}
        group by restaurant_id
      ),
      rec as (
        select restaurant_id, count(*)::int as c
        from ${restaurantUserRecommendations}
        group by restaurant_id
      ),
      vid as (
        select restaurant_id, count(*)::int as c
        from ${videoStories}
        where status = 'ready' and deleted_at is null and restaurant_id is not null
        group by restaurant_id
      )
      select
        r.id,
        (
          coalesce(fav.c, 0) +
          coalesce(fol.c, 0) +
          coalesce(rec.c, 0) +
          coalesce(vid.c, 0)
        )::int as raw_activity
      from ${restaurants} r
      left join fav on fav.restaurant_id = r.id
      left join fol on fol.restaurant_id = r.id
      left join rec on rec.restaurant_id = r.id
      left join vid on vid.restaurant_id = r.id
      where coalesce(r.is_active, true) = true
    `);

    const cohort = Array.isArray((rows as any)?.rows) ? (rows as any).rows : [];
    if (!cohort.length) return { liveBoost: 1, percentile: 0 };

    const target = cohort.find((row: any) => String(row.id) === restaurantId);
    if (!target) return { liveBoost: 1, percentile: 0 };

    const targetActivity = Number(target.raw_activity || 0);
    const values: number[] = cohort.map((row: any) =>
      Number(row.raw_activity || 0),
    );
    const n = values.length;
    const less = values.filter((v: number) => v < targetActivity).length;
    const equal = values.filter((v: number) => v === targetActivity).length;
    const percentile = n > 0 ? (less + 0.5 * equal) / n : 0;
    const liveBoost = Math.max(1, Math.min(10, Math.round(percentile * 9) + 1));

    return { liveBoost, percentile };
  } catch {
    return { liveBoost: 1, percentile: 0 };
  }
}

async function vacComputeGoldenPlateBonus(restaurantId: string): Promise<number> {
  if (!restaurantId) return 0;
  try {
    const [row] = await db
      .select({
        hasGoldenPlate: restaurants.hasGoldenPlate,
        goldenPlateEarnedAt: restaurants.goldenPlateEarnedAt,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!row?.hasGoldenPlate || !row.goldenPlateEarnedAt) return 0;
    const earnedAt = new Date(row.goldenPlateEarnedAt);
    if (!Number.isFinite(earnedAt.getTime())) return 0;
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const isWithinYear = Date.now() - earnedAt.getTime() <= oneYearMs;
    return isWithinYear ? 50 : 0;
  } catch {
    return 0;
  }
}

function vacGetStoredExternalReviewRating(
  user: User | null,
  restaurantId: string,
): number | null {
  try {
    const accountSettings =
      user?.accountSettings && typeof user.accountSettings === "object"
        ? (user.accountSettings as any)
        : null;
    const value =
      accountSettings?.externalReviews?.byRestaurant?.[restaurantId]
        ?.averageRating;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.min(5, parsed));
  } catch {
    return null;
  }
}

function vacGetStoredManualAdjustment(
  user: User | null,
  restaurantId: string,
): number {
  try {
    const accountSettings =
      user?.accountSettings && typeof user.accountSettings === "object"
        ? (user.accountSettings as any)
        : null;
    const value =
      accountSettings?.vacOverrides?.byRestaurant?.[restaurantId]
        ?.manualTrustScoreAdjustment;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(-50, Math.min(50, Math.round(parsed)));
  } catch {
    return 0;
  }
}

/**
 * VAC-lite evaluator for restaurant signups.
 * - Uses ONLY real, checkable signals (DNS + consistency + completeness).
 * - Never throws (safe for signup path).
 */
export async function vacEvaluateRestaurantSignup({
  user,
  restaurant,
  req
}: {
  user: User | null;
  restaurant: VacRestaurantInput;
  req?: Request;
}): Promise<VacEvaluationResult> {
  // Default threshold of 60 allows trucks with a resolving website + business email MX
  // + social media + geo + address to auto-verify without requiring phone match or
  // email-domain match (which most real food trucks won't have). Override with
  // VAC_AUTO_VERIFY_THRESHOLD env var if needed.
  const threshold = Number(process.env.VAC_AUTO_VERIFY_THRESHOLD || "60");

  const email = user?.email || "";
  const restaurantId = String(restaurant?.id || "").trim();
  const userPhone10 = vacNormalizePhone(user?.phone || undefined);
  const restaurantPhone10 = vacNormalizePhone(restaurant?.phone || undefined);

  const emailDomain = vacGetEmailDomain(email);
  const websiteHost = vacGetHostnameFromUrl(restaurant?.websiteUrl);

  // Real checks
  const emailDomainHasMx = await vacHasMx(emailDomain);
  const websiteDomainResolves = await vacHasDns(websiteHost);

  const emailMatchesWebsite =
    !!emailDomain &&
    !!websiteHost &&
    (emailDomain === websiteHost ||
      emailDomain.endsWith("." + websiteHost) ||
      websiteHost.endsWith("." + emailDomain));

  const hasSocial =
    !!(restaurant?.instagramUrl && String(restaurant.instagramUrl).trim()) ||
    !!(restaurant?.facebookPageUrl && String(restaurant.facebookPageUrl).trim());

  const hasGeo =
    restaurant?.latitude != null &&
    restaurant?.longitude != null &&
    String(restaurant.latitude).trim() !== "" &&
    String(restaurant.longitude).trim() !== "";

  const hasAddress = !!(restaurant?.address && String(restaurant.address).trim().length >= 8);

  const phoneMatches =
    userPhone10.length === 10 &&
    restaurantPhone10.length === 10 &&
    userPhone10 === restaurantPhone10;

  // Score model (bounded, transparent)
  let score = 0;

  if (emailDomainHasMx) score += 15;
  if (websiteDomainResolves) score += 20;
  if (emailMatchesWebsite) score += 15;

  if (hasSocial) score += 10;
  if (hasGeo) score += 10;
  if (hasAddress) score += 5;
  if (phoneMatches) score += 10;

  // Small penalty: free email without a matching business domain
  if (vacIsFreeEmailDomain(emailDomain) && !emailMatchesWebsite) score -= 10;
  const externalReviewRating =
    restaurant?.externalReviewRating != null
      ? Number(restaurant.externalReviewRating)
      : restaurantId
        ? vacGetStoredExternalReviewRating(user, restaurantId)
        : null;
  const externalReviewAdjustment =
    externalReviewRating != null && Number.isFinite(externalReviewRating)
      ? computeExternalReviewAdjustment(externalReviewRating)
      : 0;
  const externalReviewSourceCount = Math.max(
    0,
    Number(restaurant?.externalReviewSourceCount || 0),
  );
  const manualTrustScoreAdjustment =
    restaurant?.manualTrustScoreAdjustment != null
      ? Math.max(-50, Math.min(50, Math.round(Number(restaurant.manualTrustScoreAdjustment))))
      : restaurantId
        ? vacGetStoredManualAdjustment(user, restaurantId)
        : 0;
  score += externalReviewAdjustment;
  score += manualTrustScoreAdjustment;

  if (score < 0) score = 0;
  const baseScore = Math.min(100, score);
  const { liveBoost, percentile } = await vacComputeLiveBoost(restaurantId);
  const goldenPlateBonus = await vacComputeGoldenPlateBonus(restaurantId);
  score = baseScore + liveBoost + goldenPlateBonus;

  const result: VacEvaluationResult = {
    version: "vac-lite-v1",
    score,
    baseScore,
    threshold,
    shouldAutoVerify: score >= threshold,
    signals: {
      emailDomain: emailDomain || null,
      websiteHost: websiteHost || null,
      emailDomainHasMx,
      websiteDomainResolves,
      emailMatchesWebsite,
      hasSocial,
      hasGeo,
      hasAddress,
      phoneMatches,
      freeEmailDomain: vacIsFreeEmailDomain(emailDomain),
      externalReviewRating:
        externalReviewRating != null && Number.isFinite(externalReviewRating)
          ? Math.round(externalReviewRating * 100) / 100
          : null,
      externalReviewAdjustment,
      externalReviewSourceCount,
      manualTrustScoreAdjustment,
      liveBoost,
      liveBoostPercentile:
        percentile != null ? Math.round(percentile * 1000) / 1000 : null,
      goldenPlateBonus,
    }
  };

  // Audit (do not block signup if audit fails)
  try {
    await logAudit(
      user?.id || "",
      "vac:evaluate",
      "restaurant",
      restaurantId || "",
      req?.ip,
      req?.headers?.["user-agent"],
      result
    );
  } catch {}

  return result;
}
