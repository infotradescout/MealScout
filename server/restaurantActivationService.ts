/**
 * restaurantActivationService.ts
 *
 * Prompts restaurant owners to create their first deal if they haven't within 7 days of signup.
 * A second nudge fires at 14 days if they still haven't created a deal.
 *
 * Runs via daily cron around 9:15 AM Central. Idempotency via telemetryEvents.
 * Respects accountSettings.notifications.channels.email opt-out.
 */

import { db } from "./db";
import { users, restaurants, deals, telemetryEvents } from "@shared/schema";
import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { emailService } from "./emailService";

function isEmailEnabled(user: { accountSettings?: unknown }): boolean {
  const s = user.accountSettings as
    | { notifications?: { channels?: { email?: boolean } } }
    | undefined;
  if (!s || typeof s !== "object") return true;
  return s.notifications?.channels?.email !== false;
}

async function alreadySent(userId: string, step: string): Promise<boolean> {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "restaurant_activation_nudge"),
      eq(telemetryEvents.userId, userId),
      sql`properties->>'step' = ${step}`,
    ),
  });
  return Boolean(existing);
}

async function ownerHasAnyDeal(ownerId: string): Promise<boolean> {
  const owned = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.ownerId, ownerId))
    .limit(20);

  if (owned.length === 0) return false;

  for (const r of owned) {
    const [deal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(eq(deals.restaurantId, r.id))
      .limit(1);
    if (deal) return true;
  }
  return false;
}

export class RestaurantActivationService {
  private static instance: RestaurantActivationService;

  private constructor() {}

  static getInstance(): RestaurantActivationService {
    if (!RestaurantActivationService.instance) {
      RestaurantActivationService.instance = new RestaurantActivationService();
    }
    return RestaurantActivationService.instance;
  }

  async run(): Promise<{
    nudge7Sent: number;
    nudge14Sent: number;
    errors: number;
  }> {
    console.log("[RestaurantActivation] Running deal creation nudge...");
    const now = new Date();
    let nudge7Sent = 0;
    let nudge14Sent = 0;
    let errors = 0;

    // Day 7 window: created 7–8 days ago
    const day7Start = new Date(now.getTime() - 8 * 86_400_000);
    const day7End = new Date(now.getTime() - 7 * 86_400_000);

    // Day 14 window: created 14–15 days ago
    const day14Start = new Date(now.getTime() - 15 * 86_400_000);
    const day14End = new Date(now.getTime() - 14 * 86_400_000);

    const candidates = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        userType: users.userType,
        accountSettings: users.accountSettings,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        and(
          or(
            eq(users.userType, "restaurant_owner"),
            eq(users.userType, "caterer"),
            eq(users.userType, "private_chef"),
            eq(users.userType, "food_truck"),
          ),
          gte(users.createdAt, day14Start),
          lte(users.createdAt, day7End),
        ),
      );

    for (const user of candidates) {
      const email = String(user.email || "").trim();
      if (!email) continue;
      if (!isEmailEnabled({ accountSettings: user.accountSettings })) continue;

      const hasDeal = await ownerHasAnyDeal(user.id);
      if (hasDeal) continue; // already activated, skip all nudges

      const createdAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;

      if (createdAt >= day7Start.getTime() && createdAt < day7End.getTime()) {
        if (!(await alreadySent(user.id, "day7_deal"))) {
          try {
            await this.sendDealNudge(email, user.firstName, "day7");
            await db.insert(telemetryEvents).values({
              eventName: "restaurant_activation_nudge",
              userId: user.id,
              properties: { step: "day7_deal" },
            });
            nudge7Sent++;
          } catch (err) {
            console.error(
              `[RestaurantActivation] day7 failed for ${email}:`,
              err,
            );
            errors++;
          }
        }
      }

      if (createdAt >= day14Start.getTime() && createdAt < day14End.getTime()) {
        if (!(await alreadySent(user.id, "day14_deal"))) {
          try {
            await this.sendDealNudge(email, user.firstName, "day14");
            await db.insert(telemetryEvents).values({
              eventName: "restaurant_activation_nudge",
              userId: user.id,
              properties: { step: "day14_deal" },
            });
            nudge14Sent++;
          } catch (err) {
            console.error(
              `[RestaurantActivation] day14 failed for ${email}:`,
              err,
            );
            errors++;
          }
        }
      }
    }

    console.log(
      `[RestaurantActivation] Done. Day7=${nudge7Sent} Day14=${nudge14Sent} Errors=${errors}`,
    );
    return { nudge7Sent, nudge14Sent, errors };
  }

  private async sendDealNudge(
    to: string,
    firstName: string | null,
    step: "day7" | "day14",
  ): Promise<boolean> {
    const name = firstName || "Restaurant Owner";
    const isFollowUp = step === "day14";
    const subject = isFollowUp
      ? "⏰ Last reminder: Add a deal to your MealScout listing"
      : "🎉 Your MealScout listing is live — add your first deal!";

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${subject}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">🍽️ MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">Grow Your Restaurant</div>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#ff6b35;font-size:24px;margin:0 0 16px;">${isFollowUp ? "You're this close 🎯" : "One step left 🚀"}</h2>
      <p>Hey ${name}!</p>
      ${
        isFollowUp
          ? `<p>We noticed you haven't added a deal to your MealScout listing yet. Businesses with active deals get <strong>3-5x more profile views</strong> than those without.</p>
           <p>It takes less than 2 minutes — just set a title, discount amount, and expiry date. That's it.</p>`
          : `<p>Your MealScout business listing is live! The only thing standing between you and new customers is your first deal.</p>
           <p>Deals get discovered through search, map, and weekly customer emails. <strong>Adding one deal is the single highest-leverage thing you can do right now.</strong></p>`
      }
      <div style="background:#fff8f5;border-left:4px solid #ff6b35;padding:20px;margin:20px 0;border-radius:4px;">
        <strong>How to create a deal in 2 minutes:</strong><br>
        1. Log into your dashboard<br>
        2. Click "Add Deal" or go to your restaurant profile<br>
        3. Enter a title (e.g. "10% off tacos Tuesday"), discount, and end date<br>
        4. Hit publish — customers will see it immediately
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="https://www.mealscout.us/restaurant-owner-dashboard" style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">Create My First Deal</a>
      </div>
      <p style="font-size:13px;color:#999;">To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2025 MealScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

    const text = `Hey ${name}! Your MealScout profile is live. Add your first deal in 2 minutes: https://www.mealscout.us/restaurant-owner-dashboard`;
    return emailService.sendBasicEmail(to, subject, html, text);
  }
}

export const restaurantActivationService =
  RestaurantActivationService.getInstance();
