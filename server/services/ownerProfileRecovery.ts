import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import {
  buildOwnerProfileRecoveryPromptCopy,
  renderOwnerProfileRecoveryEmail,
} from "../copy/ownerProfileRecoveryEmail.copy";
import { getPublicBusinessVisibilityChecks } from "../utils/publicBusinessVisibility";
import { telemetryEvents, type User } from "@shared/schema";

const PROFILE_RECOVERY_PATH = "/truck-onboarding?resume=profile-recovery";
type OwnerProfileRecoveryReason =
  | "no_business"
  | "no_menu_items"
  | "complete_public_profile";

const normalizeBaseUrl = (baseUrl: string) =>
  String(baseUrl || process.env.PUBLIC_BASE_URL || "https://www.mealscout.us")
    .trim()
    .replace(/\/+$/, "");

type OwnerProfileRecoveryCandidate = Pick<
  User,
  "id" | "email" | "firstName" | "emailVerified" | "userType"
> & {
  lastName?: string | null;
  createdAt?: Date | string | null;
  restaurantId?: string | null;
  restaurantCount: number;
  menuItemCount: number;
  recoveryReason: OwnerProfileRecoveryReason;
  missingKeys: string[];
  missingLabels: string[];
  href: string;
};

export type OwnerProfileRecoveryPrompt = {
  reason: OwnerProfileRecoveryReason;
  title: string;
  message: string;
  cta: string;
  href: string;
  missingKeys: string[];
  missingLabels: string[];
  restaurantId: string | null;
};

const recoveryLookbackDays = () =>
  Math.max(1, Number(process.env.OWNER_PROFILE_RECOVERY_LOOKBACK_DAYS || 365));

const recoveryThresholdMinutes = () =>
  Math.max(
    1,
    Number(process.env.OWNER_PROFILE_RECOVERY_THRESHOLD_MINUTES || 20),
  );

const recoveryBatchLimit = () =>
  Math.max(
    1,
    Math.min(Number(process.env.OWNER_PROFILE_RECOVERY_BATCH || 40), 200),
  );

const recoveryEmailIntervalHours = () =>
  Math.max(
    1,
    Number(process.env.OWNER_PROFILE_RECOVERY_EMAIL_INTERVAL_HOURS || 24),
  );

const ownerBasePath = (userType?: string | null) =>
  String(userType || "") === "food_truck"
    ? "/truck-onboarding?resume=profile-recovery"
    : "/restaurant-signup?resume=profile-recovery";

const menuBuilderPath = (restaurantId: string) =>
  `/menu-builder/${encodeURIComponent(
    restaurantId,
  )}?src=profile-recovery&next=${encodeURIComponent(
    `/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(
      restaurantId,
    )}&src=profile-recovery&goLive=1`,
  )}`;

const editProfilePath = (restaurantId: string) =>
  `/edit-restaurant/${encodeURIComponent(restaurantId)}?src=profile-recovery`;

const missingLabelMap: Record<string, string> = {
  no_business: "business profile",
  no_menu_items: "menu items",
  missing_name: "business name",
  missing_location: "location",
  missing_category: "cuisine or business type",
  missing_description_or_photo: "description or photo",
  flagged_test_data: "real profile details",
  non_public_profile_source: "public profile source",
  non_public_owner_email: "owner email",
  closed_permanently: "business status",
};

const labelMissingKeys = (keys: string[]) =>
  keys.map((key) => missingLabelMap[key] || key.replace(/_/g, " "));

function buildPromptFromState(
  userType: string | null | undefined,
  state: {
    recoveryReason: OwnerProfileRecoveryReason;
    missingKeys: string[];
    restaurantId?: string | null;
  },
): OwnerProfileRecoveryPrompt {
  const copy = buildOwnerProfileRecoveryPromptCopy({
    userType,
    recoveryReason: state.recoveryReason,
  });
  const href =
    state.recoveryReason === "no_business"
      ? ownerBasePath(userType)
      : state.recoveryReason === "no_menu_items" && state.restaurantId
        ? menuBuilderPath(state.restaurantId)
        : state.restaurantId
          ? editProfilePath(state.restaurantId)
          : ownerBasePath(userType);

  return {
    ...copy,
    href,
    reason: state.recoveryReason,
    missingKeys: state.missingKeys,
    missingLabels: labelMissingKeys(state.missingKeys),
    restaurantId: state.restaurantId || null,
  };
}

const buildVerifyRecoveryUrl = async (
  user: Pick<User, "id">,
  baseUrl: string,
  nextPath = PROFILE_RECOVERY_PATH,
  requestMeta?: { requestIp?: string; userAgent?: string },
) => {
  const base = normalizeBaseUrl(baseUrl);
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await storage.createEmailVerificationToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    requestIp: requestMeta?.requestIp,
    userAgent: requestMeta?.userAgent,
  });
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&next=${encodeURIComponent(nextPath)}`;
};

export async function hasOwnerProfileRecoveryBeenSentRecently(
  userId: string,
  intervalHours = recoveryEmailIntervalHours(),
) {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "owner_profile_recovery_sent"),
      eq(telemetryEvents.userId, userId),
      sql`coalesce(${telemetryEvents.properties}->>'ok', 'false') = 'true'`,
      sql`${telemetryEvents.createdAt} >= now() - (${intervalHours}::int * interval '1 hour')`,
    ),
  });
  return Boolean(existing);
}

export async function findOwnerProfileRecoveryCandidates({
  lookbackDays = recoveryLookbackDays(),
  thresholdMinutes = recoveryThresholdMinutes(),
  limit = recoveryBatchLimit(),
  intervalHours = recoveryEmailIntervalHours(),
  includeAlreadySent = false,
}: {
  lookbackDays?: number;
  thresholdMinutes?: number;
  limit?: number;
  intervalHours?: number;
  includeAlreadySent?: boolean;
} = {}): Promise<OwnerProfileRecoveryCandidate[]> {
  const result = await db.execute(sql<any>`
    select
      u.id,
      u.email,
      u.first_name as "firstName",
      u.last_name as "lastName",
      u.user_type as "userType",
      u.email_verified as "emailVerified",
      u.created_at as "createdAt"
    from users u
    where u.user_type in ('food_truck', 'restaurant_owner')
      and coalesce(u.is_disabled, false) = false
      and u.created_at >= now() - (${lookbackDays}::int * interval '1 day')
      and u.created_at <= now() - (${thresholdMinutes}::int * interval '1 minute')
      and u.email is not null
      and u.email not ilike '%@mealscout.invalid'
      and (
        ${includeAlreadySent}
        or not exists (
          select 1
          from telemetry_events te
          where te.user_id = u.id
            and te.event_name = 'owner_profile_recovery_sent'
            and coalesce(te.properties->>'ok', 'false') = 'true'
            and te.created_at >= now() - (${intervalHours}::int * interval '1 hour')
        )
      )
    order by u.created_at asc
    limit ${limit}
  `);

  const candidates: OwnerProfileRecoveryCandidate[] = [];
  for (const row of result.rows || []) {
    const user = {
      id: String(row.id),
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      userType: row.userType,
      emailVerified: Boolean(row.emailVerified),
      createdAt: row.createdAt,
    };
    const state = await getOwnerProfileRecoveryState(user);
    if (!state) continue;
    candidates.push({
      ...user,
      ...state,
    });
  }

  return candidates;
}

export async function getOwnerProfileRecoveryState(
  user: Pick<User, "id" | "userType">,
): Promise<{
  restaurantId: string | null;
  restaurantCount: number;
  menuItemCount: number;
  recoveryReason: OwnerProfileRecoveryReason;
  missingKeys: string[];
  missingLabels: string[];
  href: string;
} | null> {
  if (!["food_truck", "restaurant_owner"].includes(String(user.userType || ""))) {
    return null;
  }

  const result = await db.execute(sql<any>`
    with primary_restaurant as (
      select r.*
      from restaurants r
      where r.owner_id = ${user.id}
      order by
        case
          when coalesce(r.is_food_truck, false) = true
            or lower(coalesce(r.business_type, '')) = 'food_truck'
          then 0 else 1
        end,
        r.created_at asc
      limit 1
    )
    select
      (select count(*)::int from restaurants r where r.owner_id = ${user.id}) as "restaurantCount",
      pr.id as "restaurantId",
      pr.name,
      pr.address,
      pr.city,
      pr.state,
      pr.cuisine_type as "cuisineType",
      pr.business_type as "businessType",
      pr.description,
      pr.logo_url as "logoUrl",
      pr.cover_image_url as "coverImageUrl",
      pr.facebook_cover_url as "facebookCoverUrl",
      pr.google_photos as "googlePhotos",
      pr.facebook_photos as "facebookPhotos",
      pr.profile_source as "profileSource",
      pr.google_business_status as "googleBusinessStatus",
      count(mi.id)::int as "menuItemCount"
    from primary_restaurant pr
    left join menus m on m.restaurant_id = pr.id
    left join menu_items mi on mi.menu_id = m.id
    group by
      pr.id,
      pr.name,
      pr.address,
      pr.city,
      pr.state,
      pr.cuisine_type,
      pr.business_type,
      pr.description,
      pr.logo_url,
      pr.cover_image_url,
      pr.facebook_cover_url,
      pr.google_photos,
      pr.facebook_photos,
      pr.profile_source,
      pr.google_business_status
  `);

  const row = result.rows?.[0] || {};
  const restaurantCount = Number(row.restaurantCount || 0);
  const restaurantId = row.restaurantId ? String(row.restaurantId) : null;
  const menuItemCount = Number(row.menuItemCount || 0);

  if (restaurantCount === 0 || !restaurantId) {
    const missingKeys = ["no_business"];
    const prompt = buildPromptFromState(user.userType, {
      recoveryReason: "no_business",
      missingKeys,
      restaurantId: null,
    });
    return {
      restaurantId: null,
      restaurantCount,
      menuItemCount,
      recoveryReason: prompt.reason,
      missingKeys,
      missingLabels: prompt.missingLabels,
      href: prompt.href,
    };
  }

  if (menuItemCount === 0) {
    const missingKeys = ["no_menu_items"];
    const prompt = buildPromptFromState(user.userType, {
      recoveryReason: "no_menu_items",
      missingKeys,
      restaurantId,
    });
    return {
      restaurantId,
      restaurantCount,
      menuItemCount,
      recoveryReason: prompt.reason,
      missingKeys,
      missingLabels: prompt.missingLabels,
      href: prompt.href,
    };
  }

  const checks = getPublicBusinessVisibilityChecks(row);
  const profileMissingKeys = Array.from(
    new Set([...checks.blockers, ...checks.warnings]),
  );
  if (profileMissingKeys.length > 0) {
    const prompt = buildPromptFromState(user.userType, {
      recoveryReason: "complete_public_profile",
      missingKeys: profileMissingKeys,
      restaurantId,
    });
    return {
      restaurantId,
      restaurantCount,
      menuItemCount,
      recoveryReason: prompt.reason,
      missingKeys: profileMissingKeys,
      missingLabels: prompt.missingLabels,
      href: prompt.href,
    };
  }

  return null;
}

export async function getOwnerProfileRecoveryPromptForUser(
  user: Pick<User, "id" | "userType">,
): Promise<OwnerProfileRecoveryPrompt | null> {
  const state = await getOwnerProfileRecoveryState(user);
  if (!state) return null;
  return buildPromptFromState(user.userType, state);
}

export async function sendOwnerProfileRecoveryEmail({
  user,
  baseUrl,
  force = false,
  requestMeta,
}: {
  user: Pick<
    User,
    "id" | "email" | "firstName" | "emailVerified" | "userType"
  > & {
    recoveryReason?: OwnerProfileRecoveryReason;
    restaurantCount?: number;
    menuItemCount?: number;
    missingKeys?: string[];
    missingLabels?: string[];
  };
  baseUrl: string;
  force?: boolean;
  requestMeta?: { requestIp?: string; userAgent?: string; adminId?: string };
}) {
  const email = String(user.email || "").trim();
  if (!email) return { ok: false, skipped: "missing_email" as const };
  if (email.toLowerCase().endsWith("@mealscout.invalid")) {
    return { ok: false, skipped: "test_email" as const };
  }
  if (!["food_truck", "restaurant_owner"].includes(String(user.userType || ""))) {
    return { ok: false, skipped: "not_owner" as const };
  }
  if (!force && (await hasOwnerProfileRecoveryBeenSentRecently(user.id))) {
    return { ok: true, skipped: "sent_recently" as const };
  }

  const currentState = user.recoveryReason
    ? null
    : await getOwnerProfileRecoveryState(user);
  if (!user.recoveryReason && !currentState) {
    return { ok: true, skipped: "profile_complete" as const };
  }
  const recoveryDetails = {
    ...user,
    ...(currentState || {}),
  };

  const needsVerification = !user.emailVerified;
  const completionPath = recoveryDetails.href || PROFILE_RECOVERY_PATH;
  const actionUrl = needsVerification
    ? await buildVerifyRecoveryUrl(user, baseUrl, completionPath, requestMeta)
    : `${normalizeBaseUrl(baseUrl)}/login?redirect=${encodeURIComponent(
        completionPath,
      )}`;
  const copy = renderOwnerProfileRecoveryEmail({
    firstName: user.firstName,
    actionUrl,
    needsVerification,
    userType: user.userType,
    recoveryReason: recoveryDetails.recoveryReason,
    missingLabels:
      recoveryDetails.missingLabels ||
      labelMissingKeys(recoveryDetails.missingKeys || []),
  });
  const ok = await emailService.sendBasicEmail(
    email,
    copy.subject,
    copy.html,
    copy.text,
    "account",
  );

  await db.insert(telemetryEvents).values({
    eventName: ok
      ? "owner_profile_recovery_sent"
      : "owner_profile_recovery_failed",
    userId: user.id,
    properties: {
      ok,
      userType: user.userType,
      needsVerification,
      forced: force,
      recoveryReason: recoveryDetails.recoveryReason || null,
      restaurantCount:
        typeof recoveryDetails.restaurantCount === "number"
          ? recoveryDetails.restaurantCount
          : null,
      menuItemCount:
        typeof recoveryDetails.menuItemCount === "number"
          ? recoveryDetails.menuItemCount
          : null,
      missingKeys: recoveryDetails.missingKeys || [],
      adminId: requestMeta?.adminId || null,
    } as any,
  });

  return { ok, skipped: null };
}

export async function runOwnerProfileRecoveryCron({
  baseUrl = process.env.PUBLIC_BASE_URL || "https://www.mealscout.us",
  lookbackDays,
  thresholdMinutes,
  intervalHours,
  limit,
}: {
  baseUrl?: string;
  lookbackDays?: number;
  thresholdMinutes?: number;
  intervalHours?: number;
  limit?: number;
} = {}) {
  const candidates = await findOwnerProfileRecoveryCandidates({
    lookbackDays,
    thresholdMinutes,
    intervalHours,
    limit,
  });
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of candidates) {
    try {
      const result = await sendOwnerProfileRecoveryEmail({
        user,
        baseUrl,
        requestMeta: {
          adminId: "cron:owner-profile-recovery",
        },
      });
      if (result.ok && !result.skipped) sent++;
      if (result.skipped) skipped++;
      if (!result.ok && !result.skipped) errors++;
    } catch (error) {
      errors++;
      console.error("[owner-profile-recovery] failed:", error);
    }
  }

  return {
    ok: errors === 0,
    considered: candidates.length,
    sent,
    skipped,
    errors,
  };
}
