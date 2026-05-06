import { db } from "../db";
import { emailService } from "../emailService";
import { addCredit } from "../creditService";
import { emailSequenceSends, restaurants, users } from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { normalizeUsStateAbbr } from "./parkingPassQuality";
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from "../utils/reminderBusinessHours";

const SEQUENCE = "pensacola_food_truck_onboarding_v1";

const dripUserColumns = {
  id: users.id,
  email: users.email,
  firstName: users.firstName,
  userType: users.userType,
  emailVerified: users.emailVerified,
  isDisabled: users.isDisabled,
  createdAt: users.createdAt,
};

const nowIso = () => new Date().toISOString();

function envEnabled(name: string): boolean {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function isPensacolaRestaurant(restaurant: any): boolean {
  const city = String(restaurant?.city || "").trim().toLowerCase();
  const state = normalizeUsStateAbbr(String(restaurant?.state || "").trim());
  return city === "pensacola" && state === "FL";
}

function publicBaseUrl(): string {
  return String(process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(
    /\/+$/,
    "",
  );
}

function subjectForStep(step: number): string {
  switch (step) {
    case 1:
      return "Pensacola spots are waiting — unlock and book on MealScout";
    case 2:
      return "Get Premium for $25/mo (live GPS + schedule + booking calendar)";
    case 3:
      return "How trucks turn guaranteed spots into predictable sales";
    case 4:
      return "You’ve got $10 booking credit — book your first spot";
    default:
      return "MealScout";
  }
}

function htmlForStep(params: {
  step: number;
  firstName?: string | null;
}): string {
  const name = params.firstName || "there";
  const base = publicBaseUrl();
  const spotsUrl = `${base}/pensacola/spots`;
  const subscribeUrl = `${base}/subscribe`;
  const bookingUrl = `${base}/parking-pass`;

  const wrap = (body: string) => `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; margin: 0; padding: 0;">
        <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
          <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff;">
            ${body}
            <p style="margin-top: 24px; color:#6b7280; font-size: 12px;">
              Sent: ${nowIso()} · MealScout
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  switch (params.step) {
    case 1:
      return wrap(`
        <h2 style="margin: 0 0 12px 0;">Hi ${name} — welcome to MealScout</h2>
        <p style="margin: 0 0 12px 0;">
          We’re building the booking layer for food trucks in Pensacola: hosts list guaranteed parking slots and you book like a calendar.
        </p>
        <p style="margin: 0 0 16px 0;">
          Start here: <a href="${spotsUrl}">${spotsUrl}</a>
        </p>
        <p style="margin: 0 0 0 0;">
          Create a free account to unlock exact addresses, availability, and the Book Now button.
        </p>
      `);
    case 2:
      return wrap(`
        <h2 style="margin: 0 0 12px 0;">Premium is $25/month</h2>
        <p style="margin: 0 0 12px 0;">
          Premium is built for trucks that want more predictable locations and more discoverability:
        </p>
        <ul style="margin: 0 0 16px 20px;">
          <li>Live GPS button (instant map presence)</li>
          <li>Editable schedule + booking calendar view</li>
          <li>Priority tools to get booked faster</li>
        </ul>
        <p style="margin: 0 0 0 0;">
          Upgrade here: <a href="${subscribeUrl}">${subscribeUrl}</a>
        </p>
      `);
    case 3:
      return wrap(`
        <h2 style="margin: 0 0 12px 0;">How this helps this week</h2>
        <p style="margin: 0 0 12px 0;">
          The goal isn’t “more leads” — it’s fewer dead nights. When you can lock in guaranteed spots, you stop wasting time hunting locations last-minute.
        </p>
        <p style="margin: 0 0 0 0;">
          Browse Pensacola spots and pick your next night: <a href="${spotsUrl}">${spotsUrl}</a>
        </p>
      `);
    case 4:
      return wrap(`
        <h2 style="margin: 0 0 12px 0;">$10 booking credit added</h2>
        <p style="margin: 0 0 12px 0;">
          We added <strong>$10</strong> in booking credit to your account. Use it on your first booking in Pensacola.
        </p>
        <p style="margin: 0 0 0 0;">
          Book a spot: <a href="${bookingUrl}">${bookingUrl}</a>
        </p>
      `);
    default:
      return wrap(`<p>MealScout</p>`);
  }
}

async function alreadySent(userId: string, step: number): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSequenceSends.id })
    .from(emailSequenceSends)
    .where(
      and(
        eq(emailSequenceSends.userId, userId),
        eq(emailSequenceSends.sequence, SEQUENCE),
        eq(emailSequenceSends.step, step),
      ),
    )
    .limit(1);
  return Boolean(row?.id);
}

async function markSent(userId: string, step: number, metadata?: any) {
  await db
    .insert(emailSequenceSends)
    .values({
      userId,
      sequence: SEQUENCE,
      step,
      metadata: metadata ?? null,
    } as any)
    .onConflictDoNothing();
}

async function sendStepToUser(user: any, step: number) {
  if (!user?.id || !user?.email) return;
  if (!user.emailVerified) return;
  if (user.isDisabled) return;
  if (await alreadySent(user.id, step)) return;

  if (step === 4) {
    // Grant $10 booking credit once (idempotent via send tracking).
    await addCredit(
      user.id,
      10,
      "pensacola_booking_credit",
      `${SEQUENCE}:step4`,
    );
  }

  await emailService.sendBasicEmail(
    user.email,
    subjectForStep(step),
    htmlForStep({ step, firstName: user.firstName }),
  );

  await markSent(user.id, step, { sentBy: "drip", step });
}

export async function maybeTriggerPensacolaFoodTruckDrip(opts: {
  userId: string;
  restaurant: any;
}) {
  if (!envEnabled("PENSACOLA_FOOD_TRUCK_DRIP_ENABLED")) return;
  if (!isPensacolaRestaurant(opts.restaurant)) return;

  const user = await db
    .select(dripUserColumns)
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1)
    .then((rows: any[]) => rows[0]);
  if (!user) return;
  if (String(user.userType || "") !== "food_truck") return;

  await sendStepToUser(user, 1);
}

export async function runPensacolaFoodTruckDripCron() {
  if (!envEnabled("PENSACOLA_FOOD_TRUCK_DRIP_ENABLED")) return { ok: true, sent: 0 };
  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip("Pensacola food truck drip", hours);
    return { ok: true, sent: 0, deferred: true, reason: hours.reason };
  }

  const lookbackDaysRaw = Number(process.env.PENSACOLA_FOOD_TRUCK_DRIP_LOOKBACK_DAYS ?? 30);
  const lookbackDays = Number.isFinite(lookbackDaysRaw)
    ? Math.max(1, Math.min(lookbackDaysRaw, 180))
    : 30;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Candidates: verified food_truck users who own a Pensacola food_truck restaurant.
  const rows = await db
    .select({
      user: dripUserColumns,
      restaurant: restaurants,
      step1SentAt: sql<Date | null>`(
        select min(sent_at) from email_sequence_sends s
        where s.user_id = ${users.id} and s.sequence = ${SEQUENCE} and s.step = 1
      )`,
    })
    .from(users)
    .innerJoin(restaurants, eq(restaurants.ownerId, users.id))
    .where(
      and(
        eq(users.userType, "food_truck"),
        eq(users.emailVerified, true),
        eq(users.isDisabled, false),
        eq(restaurants.businessType, "food_truck"),
        gte(users.createdAt, cutoff),
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(250);

  const MAX_SENDS_PER_RUN = 50;
  let sent = 0;

  const delayByStepDays: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 7 };

  for (const row of rows) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    const user: any = row.user;
    const restaurant: any = row.restaurant;
    if (!isPensacolaRestaurant(restaurant)) continue;

    const step1SentAt = row.step1SentAt ? new Date(row.step1SentAt) : null;

    // If step 1 hasn't been sent, enroll first.
    if (!step1SentAt) {
      await sendStepToUser(user, 1);
      sent += 1;
      continue;
    }

    // Otherwise, send the next due step (at most one per run per user).
    for (const step of [2, 3, 4]) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      if (await alreadySent(user.id, step)) continue;
      const dueAt = new Date(step1SentAt.getTime() + delayByStepDays[step] * 24 * 60 * 60 * 1000);
      if (Date.now() < dueAt.getTime()) continue;
      await sendStepToUser(user, step);
      sent += 1;
      break;
    }
  }

  return { ok: true, sent };
}
