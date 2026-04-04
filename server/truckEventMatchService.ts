/**
 * truckEventMatchService.ts
 *
 * When a host publishes a new event series, email all active food trucks
 * in the same city/area that might want to participate.
 *
 * Called fire-and-forget from openCallSeriesRoutes.ts on series publish.
 * Skips trucks that have already received a notification for this series.
 * Respects accountSettings.notifications.topics.nearbyEvents / channels.email opt-out.
 */

import { db } from "./db";
import { restaurants, users, telemetryEvents } from "@shared/schema";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { emailService } from "./emailService";

type SeriesInfo = {
  id: string;
  name: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  defaultStartTime: string;
  defaultEndTime: string;
};

type HostInfo = {
  businessName: string;
  city?: string | null;
  state?: string | null;
  address: string;
};

function isNotifEnabled(accountSettings: unknown): boolean {
  const s = accountSettings as {
    notifications?: {
      channels?: { email?: boolean };
      topics?: { nearbyEvents?: boolean };
    };
  } | null;
  if (!s || typeof s !== "object") return true;
  if (s.notifications?.channels?.email === false) return false;
  if (s.notifications?.topics?.nearbyEvents === false) return false;
  return true;
}

export async function notifyNearbyTrucksOfNewSeries(
  series: SeriesInfo,
  host: HostInfo,
): Promise<{ notified: number; errors: number }> {
  let notified = 0;
  let errors = 0;

  try {
    if (!host.city?.trim()) return { notified: 0, errors: 0 };

    const cityLike = `%${host.city.trim()}%`;

    // Find active food trucks with an email in the same city area
    const trucks = await db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        ownerId: restaurants.ownerId,
      })
      .from(restaurants)
      .where(
        and(
          eq(restaurants.isFoodTruck, true),
          eq(restaurants.isActive, true),
          or(
            ilike(restaurants.city, cityLike),
            ilike(restaurants.address, cityLike),
          ),
        ),
      );

    for (const truck of trucks) {
      if (!truck.ownerId) continue;

      // Idempotency: skip if already notified about this series
      const alreadySent = await db.query.telemetryEvents.findFirst({
        where: and(
          eq(telemetryEvents.eventName, "truck_series_match_sent"),
          eq(telemetryEvents.userId, truck.ownerId),
          sql`properties->>'seriesId' = ${series.id}`,
        ),
      });
      if (alreadySent) continue;

      const [owner] = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          accountSettings: users.accountSettings,
        })
        .from(users)
        .where(eq(users.id, truck.ownerId))
        .limit(1);

      if (!owner?.email) continue;
      if (!isNotifEnabled(owner.accountSettings)) continue;

      try {
        await sendMatchEmail(owner.email, owner.firstName, truck.name, series, host);

        await db.insert(telemetryEvents).values({
          eventName: "truck_series_match_sent",
          userId: truck.ownerId,
          properties: {
            seriesId: series.id,
            truckId: truck.id,
            hostCity: host.city,
          },
        });

        notified++;
      } catch (err) {
        console.error(`[TruckEventMatch] Failed to notify truck owner ${truck.ownerId}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error("[TruckEventMatch] Fatal error:", err);
    errors++;
  }

  console.log(`[TruckEventMatch] Series ${series.id}: notified=${notified} errors=${errors}`);
  return { notified, errors };
}

async function sendMatchEmail(
  to: string,
  firstName: string | null,
  truckName: string,
  series: SeriesInfo,
  host: HostInfo,
): Promise<boolean> {
  const name = firstName || truckName || "Food Truck Owner";
  const location = host.state ? `${host.city}, ${host.state}` : (host.city ?? "your area");
  const startDateLabel = new Date(series.startDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const endDateLabel = new Date(series.endDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>New Event Opportunity</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">🍽️ MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">New Event Opportunity in ${location}</div>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#ff6b35;font-size:24px;margin:0 0 16px;">New event open in your area 📍</h2>
      <p>Hey ${name}!</p>
      <p><strong>${host.businessName}</strong> just posted a new event series looking for food trucks near <strong>${location}</strong>.</p>
      <div style="background:#fff8f5;border-left:4px solid #ff6b35;padding:20px;margin:20px 0;border-radius:4px;">
        <strong>${series.name}</strong><br>
        ${series.description ? `<em>${series.description}</em><br>` : ""}
        📅 ${startDateLabel} – ${endDateLabel}<br>
        🕐 ${series.defaultStartTime} – ${series.defaultEndTime}<br>
        📍 ${host.address}${host.city ? `, ${host.city}` : ""}
      </div>
      <p>Express your interest before the spots fill up. It only takes a minute to let the host know you're available.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="https://www.mealscout.us/truck/discovery" style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">View Event & Express Interest</a>
      </div>
      <p style="font-size:13px;color:#999;">You're receiving this because your truck operates near ${location}. To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2025 MealScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hey ${name}! ${host.businessName} posted a new event in ${location}: "${series.name}" (${startDateLabel} – ${endDateLabel}, ${series.defaultStartTime}–${series.defaultEndTime}). View it: https://www.mealscout.us/truck/discovery`;
  return emailService.sendBasicEmail(to, `🚚 New event opportunity for your truck in ${location}`, html, text);
}
