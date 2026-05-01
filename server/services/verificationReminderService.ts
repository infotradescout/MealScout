/**
 * Daily verification reminders for owners who deferred document upload.
 *
 * Verification should not block setup momentum, but owners still need a daily
 * nudge until they submit a request or become verified.
 */

import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../db";
import { emailService } from "../emailService";
import { restaurants, telemetryEvents, users, verificationRequests } from "@shared/schema";
import { getVerificationSnooze } from "./verificationSnooze";

type ReminderCandidate = {
  restaurantId: string;
  restaurantName: string | null;
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

async function reminderAlreadySent(
  restaurantId: string,
  key: string,
): Promise<boolean> {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "verification_daily_reminder_sent"),
      sql`${telemetryEvents.properties}->>'restaurantId' = ${restaurantId}`,
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
      restaurantId: candidate.restaurantId,
      restaurantName: candidate.restaurantName,
      dayKey: key,
    },
  });
}

function buildEmail(candidate: ReminderCandidate): {
  subject: string;
  html: string;
  text: string;
} {
  const ownerName = candidate.ownerFirstName || "there";
  const businessName = candidate.restaurantName || "your truck";
  const verifyUrl = `${baseUrl()}/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(
    candidate.restaurantId,
  )}&src=verification-reminder&goLive=1`;

  const subject = `Quick reminder: verify ${businessName}`;
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.55; margin: 0; padding: 0; background: #f9fafb;">
        <div style="max-width: 620px; margin: 0 auto; padding: 24px;">
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 22px;">
            <h2 style="margin: 0 0 12px;">Hi ${ownerName}, verify ${businessName} when you have a document nearby</h2>
            <p style="margin: 0 0 12px;">
              You can keep setting up MealScout without submitting documents immediately. Verification is still needed before we can fully trust and approve the public listing.
            </p>
            <p style="margin: 0 0 18px;">
              A photo or PDF of a permit, business document, or truck ownership proof is enough to start review.
            </p>
            <p style="margin: 24px 0;">
              <a href="${verifyUrl}" style="background: #f97316; color: #ffffff; padding: 12px 18px; border-radius: 6px; text-decoration: none; font-weight: 700;">Submit verification</a>
            </p>
            <p style="margin: 18px 0 0; color: #6b7280; font-size: 13px;">
              We will remind you once per day until a verification request is submitted.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
  const text = `Hi ${ownerName}, verify ${businessName} when you have a document nearby. Submit here: ${verifyUrl}`;

  return { subject, html, text };
}

async function fetchCandidates(): Promise<ReminderCandidate[]> {
  const graceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return db
    .select({
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      ownerId: users.id,
      ownerEmail: users.email,
      ownerFirstName: users.firstName,
      accountSettings: users.accountSettings,
    })
    .from(restaurants)
    .innerJoin(users, eq(restaurants.ownerId, users.id))
    .where(
      and(
        eq(restaurants.isVerified, false),
        or(eq(users.userType, "restaurant_owner"), eq(users.userType, "food_truck")),
        eq(users.emailVerified, true),
        sql`coalesce(${users.isDisabled}, false) = false`,
        sql`${restaurants.createdAt} <= ${graceCutoff}`,
        sql`not exists (
          select 1 from ${verificationRequests} vr
          where vr.restaurant_id = ${restaurants.id}
            and vr.status = 'pending'
        )`,
      ),
    )
    .limit(150);
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
    if (await reminderAlreadySent(candidate.restaurantId, key)) {
      skipped += 1;
      continue;
    }
    const snooze = await getVerificationSnooze(candidate.restaurantId);
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
        `[verification-reminders] failed for ${candidate.restaurantId}:`,
        error,
      );
    }
  }

  console.log(
    `[verification-reminders] Done. Sent=${sent} Skipped=${skipped} Errors=${errors}`,
  );
  return { sent, skipped, errors };
}
