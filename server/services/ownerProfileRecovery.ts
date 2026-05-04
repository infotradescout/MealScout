import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { renderOwnerProfileRecoveryEmail } from "../copy/ownerProfileRecoveryEmail.copy";
import { telemetryEvents, type User } from "@shared/schema";

const PROFILE_RECOVERY_PATH = "/truck-onboarding?resume=profile-recovery";

const normalizeBaseUrl = (baseUrl: string) =>
  String(baseUrl || process.env.PUBLIC_BASE_URL || "https://www.mealscout.us")
    .trim()
    .replace(/\/+$/, "");

const buildLoginRecoveryUrl = (baseUrl: string) => {
  const base = normalizeBaseUrl(baseUrl);
  return `${base}/login?redirect=${encodeURIComponent(PROFILE_RECOVERY_PATH)}`;
};

type OwnerProfileRecoveryCandidate = Pick<
  User,
  "id" | "email" | "firstName" | "emailVerified" | "userType"
> & {
  lastName?: string | null;
  createdAt?: Date | string | null;
  restaurantCount: number;
  menuItemCount: number;
  recoveryReason: "no_business" | "no_menu_items";
};

const recoveryLookbackDays = () =>
  Math.max(1, Number(process.env.OWNER_PROFILE_RECOVERY_LOOKBACK_DAYS || 14));

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

const buildVerifyRecoveryUrl = async (
  user: Pick<User, "id">,
  baseUrl: string,
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
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&next=${encodeURIComponent(PROFILE_RECOVERY_PATH)}`;
};

export async function hasOwnerProfileRecoveryBeenSent(userId: string) {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "owner_profile_recovery_sent"),
      eq(telemetryEvents.userId, userId),
      sql`coalesce(${telemetryEvents.properties}->>'ok', 'false') = 'true'`,
    ),
  });
  return Boolean(existing);
}

export async function findOwnerProfileRecoveryCandidates({
  lookbackDays = recoveryLookbackDays(),
  thresholdMinutes = recoveryThresholdMinutes(),
  limit = recoveryBatchLimit(),
  includeAlreadySent = false,
}: {
  lookbackDays?: number;
  thresholdMinutes?: number;
  limit?: number;
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
      u.created_at as "createdAt",
      count(distinct r.id)::int as "restaurantCount",
      count(mi.id)::int as "menuItemCount",
      case
        when count(distinct r.id) = 0 then 'no_business'
        else 'no_menu_items'
      end as "recoveryReason"
    from users u
    left join restaurants r on r.owner_id = u.id
    left join menus m on m.restaurant_id = r.id
    left join menu_items mi on mi.menu_id = m.id
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
        )
      )
    group by u.id
    having count(distinct r.id) = 0 or count(mi.id) = 0
    order by u.created_at asc
    limit ${limit}
  `);

  return (result.rows || []).map((row: any) => ({
    id: String(row.id),
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    userType: row.userType,
    emailVerified: Boolean(row.emailVerified),
    createdAt: row.createdAt,
    restaurantCount: Number(row.restaurantCount || 0),
    menuItemCount: Number(row.menuItemCount || 0),
    recoveryReason:
      row.recoveryReason === "no_business" ? "no_business" : "no_menu_items",
  }));
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
    recoveryReason?: "no_business" | "no_menu_items";
    restaurantCount?: number;
    menuItemCount?: number;
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
  if (!force && (await hasOwnerProfileRecoveryBeenSent(user.id))) {
    return { ok: true, skipped: "already_sent" as const };
  }

  const needsVerification = !user.emailVerified;
  const actionUrl = needsVerification
    ? await buildVerifyRecoveryUrl(user, baseUrl, requestMeta)
    : buildLoginRecoveryUrl(baseUrl);
  const copy = renderOwnerProfileRecoveryEmail({
    firstName: user.firstName,
    actionUrl,
    needsVerification,
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
      recoveryReason: user.recoveryReason || null,
      restaurantCount:
        typeof user.restaurantCount === "number" ? user.restaurantCount : null,
      menuItemCount:
        typeof user.menuItemCount === "number" ? user.menuItemCount : null,
      adminId: requestMeta?.adminId || null,
    } as any,
  });

  return { ok, skipped: null };
}

export async function runOwnerProfileRecoveryCron({
  baseUrl = process.env.PUBLIC_BASE_URL || "https://www.mealscout.us",
  lookbackDays,
  thresholdMinutes,
  limit,
}: {
  baseUrl?: string;
  lookbackDays?: number;
  thresholdMinutes?: number;
  limit?: number;
} = {}) {
  const candidates = await findOwnerProfileRecoveryCandidates({
    lookbackDays,
    thresholdMinutes,
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
