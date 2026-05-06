/**
 * Daily verification reminders for owners who deferred document upload.
 *
 * Verification should not block setup momentum, but owners still need a daily
 * nudge until they submit a request or become verified.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { emailService } from "../emailService";
import {
  businessInsuranceVerifications,
  hosts,
  restaurants,
  telemetryEvents,
  users,
} from "@shared/schema";
import { getVerificationSnooze } from "./verificationSnooze";

type ReminderCandidate = {
  entityType:
    | "restaurant"
    | "food_truck"
    | "caterer"
    | "private_chef"
    | "host";
  entityId: string;
  businessName: string | null;
  ownerId: string;
  ownerEmail: string | null;
  ownerFirstName: string | null;
  accountSettings: unknown;
};

function isEmailEnabled(user: { accountSettings?: unknown }): boolean {
  const settings = user.accountSettings as
    | { notifications?: { channels?: { email?: boolean } } }
    | undefined;
  if (!settings || typeof settings !== "object") return true;
  return settings.notifications?.channels?.email !== false;
}

function baseUrl(): string {
  return String(process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(
    /\/+$/,
    "",
  );
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function friendlyFirstName(value: string | null): string {
  const name = String(value || "").trim();
  if (!name || /^(admin|administrator|staff|support)$/i.test(name)) {
    return "there";
  }
  return name;
}

async function reminderAlreadySent(
  candidate: Pick<ReminderCandidate, "entityId" | "entityType">,
  key: string,
): Promise<boolean> {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "verification_daily_reminder_sent"),
      sql`${telemetryEvents.properties}->>'entityId' = ${candidate.entityId}`,
      sql`${telemetryEvents.properties}->>'entityType' = ${candidate.entityType}`,
      sql`${telemetryEvents.properties}->>'dayKey' = ${key}`,
    ),
  });
  return Boolean(existing);
}

async function markReminderSent(candidate: ReminderCandidate, key: string) {
  await db.insert(telemetryEvents).values({
    eventName: "verification_daily_reminder_sent",
    userId: candidate.ownerId,
    properties: {
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      businessName: candidate.businessName,
      dayKey: key,
    },
  });
}

function buildEmail(candidate: ReminderCandidate): {
  subject: string;
  html: string;
  text: string;
} {
  const ownerName = friendlyFirstName(candidate.ownerFirstName);
  const businessName = candidate.businessName || "your business";
  const safeOwnerName = escapeHtml(ownerName);
  const safeBusinessName = escapeHtml(businessName);
  const verifyUrl =
    candidate.entityType === "host"
      ? `${baseUrl()}/host/dashboard?src=insurance-reminder`
      : `${baseUrl()}/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(
          candidate.entityId,
        )}&src=insurance-reminder&goLive=1`;

  const subject = `A quick setup step for ${businessName}`;
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; margin: 0; padding: 0; background: #f9fafb;">
        <div style="max-width: 620px; margin: 0 auto; padding: 24px;">
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 22px;">
            <h2 style="margin: 0 0 12px;">One quick setup step for ${safeBusinessName}</h2>
            <p style="margin: 0 0 12px;">
              Hi ${safeOwnerName}, thanks for setting up ${safeBusinessName} on MealScout.
            </p>
            <p style="margin: 0 0 12px;">
              When you have a minute, please upload a photo or PDF of your insurance document so we can finish reviewing the listing.
            </p>
            <p style="margin: 0 0 18px;">
              You can keep adding your menu, photos, and details now. This just helps us mark the business as verified.
            </p>
            <p style="margin: 24px 0;">
              <a href="${verifyUrl}" style="background: #f97316; color: #ffffff; padding: 12px 18px; border-radius: 6px; text-decoration: none; font-weight: 700;">Upload document</a>
            </p>
            <p style="margin: 0 0 12px;">
              If replying is easier, send the file here and we will help get it added.
            </p>
            <p style="margin: 18px 0 0; color: #6b7280; font-size: 13px;">
              We keep this light: one reminder per day while this step is open.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
  const text = `Hi ${ownerName},

Thanks for setting up ${businessName} on MealScout. When you have a minute, please upload a photo or PDF of your insurance document so we can finish reviewing the listing.

You can keep adding your menu, photos, and details now. This just helps us mark the business as verified.

Upload here: ${verifyUrl}

If replying is easier, send the file here and we will help get it added.`;

  return { subject, html, text };
}

async function fetchCandidates(): Promise<ReminderCandidate[]> {
  const graceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db.execute(sql<ReminderCandidate>`
    select
      case
        when coalesce(r.is_food_truck, false) = true
          or lower(coalesce(r.business_type, '')) = 'food_truck'
        then 'food_truck'
        when lower(coalesce(r.business_type, '')) = 'caterer'
        then 'caterer'
        when lower(coalesce(r.business_type, '')) = 'private_chef'
        then 'private_chef'
        else 'restaurant'
      end as "entityType",
      r.id as "entityId",
      r.name as "businessName",
      u.id as "ownerId",
      u.email as "ownerEmail",
      u.first_name as "ownerFirstName",
      u.account_settings as "accountSettings"
    from ${restaurants} r
    join ${users} u on u.id = r.owner_id
    where coalesce(r.is_active, true) = true
      and u.email_verified = true
      and coalesce(u.is_disabled, false) = false
      and r.created_at <= ${graceCutoff}
      and not exists (
        select 1
        from ${businessInsuranceVerifications} biv
        where biv.entity_id = r.id
          and biv.entity_type in ('restaurant', 'food_truck', 'caterer', 'private_chef')
          and (
            biv.status = 'pending'
            or (
              biv.status = 'approved'
              and (biv.expires_at is null or biv.expires_at > now())
            )
          )
      )
    union all
    select
      'host' as "entityType",
      h.id as "entityId",
      h.business_name as "businessName",
      u.id as "ownerId",
      u.email as "ownerEmail",
      u.first_name as "ownerFirstName",
      u.account_settings as "accountSettings"
    from ${hosts} h
    join ${users} u on u.id = h.user_id
    where u.email_verified = true
      and coalesce(u.is_disabled, false) = false
      and coalesce(h.created_at, now()) <= ${graceCutoff}
      and not exists (
        select 1
        from ${businessInsuranceVerifications} biv
        where biv.entity_id = h.id
          and biv.entity_type = 'host'
          and (
            biv.status = 'pending'
            or (
              biv.status = 'approved'
              and (biv.expires_at is null or biv.expires_at > now())
            )
          )
      )
    limit 150
  `);

  return Array.isArray((result as any).rows)
    ? ((result as any).rows as ReminderCandidate[])
    : ((result as any) as ReminderCandidate[]);
}

export async function runVerificationReminderCron(): Promise<{
  sent: number;
  skipped: number;
  errors: number;
}> {
  console.log("[verification-reminders] Running daily verification reminders...");
  const key = dayKey();
  const candidates = await fetchCandidates();
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const candidate of candidates) {
    const email = String(candidate.ownerEmail || "").trim();
    if (!email) {
      skipped += 1;
      continue;
    }
    if (!isEmailEnabled({ accountSettings: candidate.accountSettings })) {
      skipped += 1;
      continue;
    }
    if (await reminderAlreadySent(candidate, key)) {
      skipped += 1;
      continue;
    }
    const snooze = await getVerificationSnooze(candidate.entityId);
    if (snooze.snoozed) {
      skipped += 1;
      continue;
    }

    try {
      const message = buildEmail(candidate);
      const ok = await emailService.sendBasicEmail(
        email,
        message.subject,
        message.html,
        message.text,
      );
      if (ok) {
        await markReminderSent(candidate, key);
        sent += 1;
      } else {
        errors += 1;
      }
    } catch (error) {
      errors += 1;
      console.error(
        `[verification-reminders] failed for ${candidate.entityType}:${candidate.entityId}:`,
        error,
      );
    }
  }

  console.log(
    `[verification-reminders] Done. Sent=${sent} Skipped=${skipped} Errors=${errors}`,
  );
  return { sent, skipped, errors };
}
