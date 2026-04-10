/**
 * dinerDigestService.ts
 *
 * Sends a weekly "deals & activity near you" digest to customer-type users
 * who have a default address on file. Runs Wednesday 9 AM via registerSchedulers.
 *
 * Idempotency: one send per user per ISO week, tracked in telemetryEvents.
 * Opt-out: respects accountSettings.notifications.{channels.email, topics.weeklyDigest}.
 */

import { db } from "./db";
import {
  users,
  userAddresses,
  deals,
  restaurants,
  telemetryEvents,
} from "@shared/schema";
import { and, eq, gte, isNull, lte, or, ilike, sql } from "drizzle-orm";
import { emailService } from "./emailService";

type NotifPrefs = {
  notifications?: {
    channels?: { email?: boolean };
    topics?: { weeklyDigest?: boolean };
  };
};

type DealRow = {
  id: string;
  title: string;
  discountValue: string | null;
  restaurantName: string;
  cuisineType: string | null;
  dealPath: string;
};

function isDigestEnabledForUser(user: { accountSettings?: unknown }): boolean {
  const settings = user.accountSettings as NotifPrefs | undefined;
  if (!settings || typeof settings !== "object") return true;
  if (settings.notifications?.channels?.email === false) return false;
  if (settings.notifications?.topics?.weeklyDigest === false) return false;
  return true;
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function toSlug(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class DinerDigestService {
  private static instance: DinerDigestService;

  private constructor() {}

  public static getInstance(): DinerDigestService {
    if (!DinerDigestService.instance) {
      DinerDigestService.instance = new DinerDigestService();
    }
    return DinerDigestService.instance;
  }

  async sendDinerDigests(): Promise<{
    sent: number;
    skipped: number;
    errors: number;
  }> {
    console.log("[DinerDigest] Starting diner digest generation...");

    const now = new Date();
    const weekNumber = getWeekNumber(now);
    const idempotencyKey = `${now.getFullYear()}-W${weekNumber}`;

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    try {
      // Fetch all customer-type users who have a default address
      const rows = await db
        .select({
          userId: users.id,
          email: users.email,
          firstName: users.firstName,
          accountSettings: users.accountSettings,
          city: userAddresses.city,
          state: userAddresses.state,
          latitude: userAddresses.latitude,
          longitude: userAddresses.longitude,
        })
        .from(users)
        .innerJoin(
          userAddresses,
          and(
            eq(userAddresses.userId, users.id),
            eq(userAddresses.isDefault, true),
          ),
        )
        .where(eq(users.userType, "customer"));

      for (const row of rows) {
        const email = String(row.email || "").trim();
        if (!email) {
          skipped++;
          continue;
        }

        if (!isDigestEnabledForUser({ accountSettings: row.accountSettings })) {
          skipped++;
          continue;
        }

        // Idempotency check
        const alreadySent = await db.query.telemetryEvents.findFirst({
          where: and(
            eq(telemetryEvents.eventName, "diner_digest_sent"),
            eq(telemetryEvents.userId, row.userId),
            sql`properties->>'week' = ${idempotencyKey}`,
          ),
        });
        if (alreadySent) {
          skipped++;
          continue;
        }

        // Find active deals in user's city
        const cityLike = `%${String(row.city || "").trim()}%`;
        const nearbyDeals: DealRow[] = await this.getDealsForCity(
          cityLike,
          row.city,
        );

        // Skip if no deals to report — don't spam empty emails
        if (nearbyDeals.length === 0) {
          skipped++;
          continue;
        }

        try {
          await this.sendDinerDigestEmail(email, {
            firstName: row.firstName,
            cityLabel: row.state
              ? `${row.city}, ${row.state}`
              : (row.city ?? "your area"),
            deals: nearbyDeals,
          });

          await db.insert(telemetryEvents).values({
            eventName: "diner_digest_sent",
            userId: row.userId,
            properties: {
              week: idempotencyKey,
              city: row.city,
              dealCount: nearbyDeals.length,
            },
          });

          sent++;
        } catch (err) {
          console.error(`[DinerDigest] Failed to send to ${email}:`, err);
          errors++;
        }
      }
    } catch (err) {
      console.error("[DinerDigest] Fatal error:", err);
    }

    console.log(
      `[DinerDigest] Done. Sent=${sent} Skipped=${skipped} Errors=${errors}`,
    );
    return { sent, skipped, errors };
  }

  private async getDealsForCity(
    cityLike: string,
    city: string | null,
  ): Promise<DealRow[]> {
    if (!city?.trim()) return [];
    const now = new Date();
    try {
      const rows = await db
        .select({
          id: deals.id,
          title: deals.title,
          discountValue: deals.discountValue,
          restaurantName: restaurants.name,
          cuisineType: restaurants.cuisineType,
          restaurantId: restaurants.id,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(
          and(
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
            or(
              ilike(restaurants.city, cityLike),
              ilike(restaurants.address, cityLike),
            ),
          ),
        )
        .limit(6);

      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        discountValue: r.discountValue,
        restaurantName: r.restaurantName,
        cuisineType: r.cuisineType ?? null,
        dealPath: `/deal/${encodeURIComponent(`${toSlug(r.title) || r.id}--${r.id}`)}`,
      }));
    } catch {
      return [];
    }
  }

  private async sendDinerDigestEmail(
    to: string,
    opts: {
      firstName: string | null;
      cityLabel: string;
      deals: DealRow[];
    },
  ): Promise<boolean> {
    const { firstName, cityLabel, deals: dealList } = opts;
    const name = firstName || "Food Explorer";

    const dealRows = dealList
      .map(
        (d) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
            <a href="https://www.mealscout.us${d.dealPath}" style="color: #ff6b35; font-weight: 600; text-decoration: none;">${d.title}</a><br>
            <span style="font-size: 13px; color: #666;">${d.restaurantName}${d.cuisineType ? ` · ${d.cuisineType}` : ""}</span>
          </td>
          ${d.discountValue ? `<td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: right; white-space: nowrap; font-weight: 600; color: #16a34a;">${d.discountValue}</td>` : "<td></td>"}
        </tr>`,
      )
      .join("");

    const content = `
      <h2>This Week's Deals Near You 🍽️</h2>
      <p>Hey ${name}!</p>
      <p>Here are the active deals we found in <strong>${cityLabel}</strong> this week. Claim them free with your MealScout account — no printing needed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr>
            <th style="text-align: left; padding-bottom: 8px; color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">Deal</th>
            <th style="text-align: right; padding-bottom: 8px; color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">Savings</th>
          </tr>
        </thead>
        <tbody>${dealRows}</tbody>
      </table>
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://www.mealscout.us/search?q=${encodeURIComponent(cityLabel + " food truck deals")}" class="cta-button" style="background: linear-gradient(135deg, #ff6b35 0%, #f7931e 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600;">
          See All Deals in ${cityLabel}
        </a>
      </div>
      <p style="font-size: 13px; color: #999;">You're getting this because you have a MealScout account with a saved address in ${cityLabel}. To unsubscribe, update your notification settings in your profile.</p>
    `;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>This Week's Deals Near You in ${cityLabel}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">🍽️ MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">Discover Amazing Food Deals</div>
    </div>
    <div style="padding:40px;">
      ${content}
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2025 MealScout. All rights reserved.</p>
      <p style="margin:8px 0 0;">To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
  </div>
</body>
</html>`;
    const text = `Hey ${name}! Here are this week's deals in ${cityLabel}:\n\n${dealList.map((d) => `• ${d.title} at ${d.restaurantName}${d.discountValue ? ` (${d.discountValue})` : ""} — https://www.mealscout.us${d.dealPath}`).join("\n")}\n\nSee all deals: https://www.mealscout.us/search?q=${encodeURIComponent(cityLabel + " food truck deals")}`;

    return emailService.sendBasicEmail(
      to,
      `🍽️ This Week's Deals Near You in ${cityLabel}`,
      html,
      text,
    );
  }
}

export const dinerDigestService = DinerDigestService.getInstance();
