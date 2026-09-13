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
import { escapeHtml, sanitizeEmailSubject } from "./utils/htmlEscape";

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
        await sendMatchEmail(
          owner.email,
          owner.firstName,
          truck.name,
          series,
          host,
        );

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
        console.error(
          `[TruckEventMatch] Failed to notify truck owner ${truck.ownerId}:`,
          err,
        );
        errors++;
      }
    }
  } catch (err) {
    console.error("[TruckEventMatch] Fatal error:", err);
    errors++;
  }

  console.log(
    `[TruckEventMatch] Series ${series.id}: notified=${notified} errors=${errors}`,
  );
  return { notified, errors };
}

// ── Event Coordinator Request Notifications ──────────────────────────────

type EventRequestInfo = {
  id: string;
  eventName: string;
  date: string;
  city: string;
  expectedCrowd?: string | null;
  notes?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
};

export async function notifyNearbyTrucksOfEventRequest(
  request: EventRequestInfo,
): Promise<{ notified: number; errors: number }> {
  let notified = 0;
  let errors = 0;

  try {
    if (!request.city?.trim()) return { notified: 0, errors: 0 };

    const cityLike = `%${request.city.trim()}%`;

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

      // Idempotency: skip if already notified about this request
      const alreadySent = await db.query.telemetryEvents.findFirst({
        where: and(
          eq(telemetryEvents.eventName, "truck_event_request_match_sent"),
          eq(telemetryEvents.userId, truck.ownerId),
          sql`properties->>'requestId' = ${request.id}`,
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
        const name = owner.firstName || truck.name || "Food Truck Owner";
        const safeName = escapeHtml(name);
        const safeCity = escapeHtml(request.city);
        const safeEventName = escapeHtml(request.eventName);
        const safeDate = escapeHtml(request.date);
        const safeContactEmail = escapeHtml(request.contactEmail);
        const safeExpectedCrowd = request.expectedCrowd
          ? escapeHtml(request.expectedCrowd)
          : null;
        const safeNotes = request.notes
          ? escapeHtml(request.notes).replace(/\n/g, "<br>")
          : null;
        const safeContactPhone = request.contactPhone
          ? escapeHtml(request.contactPhone)
          : null;
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Event Opportunity</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">🍽️ MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">Event opportunity in ${safeCity}</div>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#ff6b35;font-size:24px;margin:0 0 16px;">New event looking for food trucks 📍</h2>
      <p>Hey ${safeName}!</p>
      <p>An event coordinator is looking for food trucks near <strong>${safeCity}</strong>.</p>
      <div style="background:#fff8f5;border-left:4px solid #ff6b35;padding:20px;margin:20px 0;border-radius:4px;">
        <strong>${safeEventName}</strong><br>
        📅 ${safeDate}<br>
        📍 ${safeCity}<br>
        ${safeExpectedCrowd ? `👥 Expected crowd: ${safeExpectedCrowd}<br>` : ""}
        ${safeNotes ? `<em style="font-size:13px;">${safeNotes}</em><br>` : ""}
      </div>
      <p>Contact the coordinator directly to express interest:</p>
      <p><strong>Email:</strong> <a href="mailto:${safeContactEmail}" style="color:#ff6b35;">${safeContactEmail}</a>${safeContactPhone ? `<br><strong>Phone:</strong> ${safeContactPhone}` : ""}</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="https://www.mealscout.us/truck/discovery" style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">View All Event Requests</a>
      </div>
      <p style="font-size:13px;color:#999;">You're receiving this because your truck operates near ${safeCity}. To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2025 MealScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

        await emailService.sendBasicEmail(
          owner.email,
          sanitizeEmailSubject(
            `🚚 Event opportunity near you: ${request.eventName} in ${request.city}`,
          ),
          html,
        );

        await db.insert(telemetryEvents).values({
          eventName: "truck_event_request_match_sent",
          userId: truck.ownerId,
          properties: {
            requestId: request.id,
            truckId: truck.id,
            city: request.city,
          },
        });

        notified++;
      } catch (err) {
        console.error(
          `[TruckEventMatch] Failed to notify truck owner ${truck.ownerId} of event request:`,
          err,
        );
        errors++;
      }
    }
  } catch (err) {
    console.error("[TruckEventMatch] Fatal error in event request notify:", err);
    errors++;
  }

  console.log(
    `[TruckEventMatch] EventRequest ${request.id}: notified=${notified} errors=${errors}`,
  );
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
  const location = host.state
    ? `${host.city}, ${host.state}`
    : (host.city ?? "your area");
  const startDateLabel = new Date(series.startDate).toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric",
    },
  );
  const endDateLabel = new Date(series.endDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const safeName = escapeHtml(name);
  const safeLocation = escapeHtml(location);
  const safeHostBusinessName = escapeHtml(host.businessName);
  const safeSeriesName = escapeHtml(series.name);
  const safeSeriesDescription = series.description
    ? escapeHtml(series.description).replace(/\n/g, "<br>")
    : null;
  const safeStartDateLabel = escapeHtml(startDateLabel);
  const safeEndDateLabel = escapeHtml(endDateLabel);
  const safeStartTime = escapeHtml(series.defaultStartTime);
  const safeEndTime = escapeHtml(series.defaultEndTime);
  const safeHostAddress = escapeHtml(host.address);
  const safeHostCity = host.city ? escapeHtml(host.city) : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>New Event Opportunity</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">🍽️ MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">New Event Opportunity in ${safeLocation}</div>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#ff6b35;font-size:24px;margin:0 0 16px;">New event open in your area 📍</h2>
      <p>Hey ${safeName}!</p>
      <p><strong>${safeHostBusinessName}</strong> just posted a new event series looking for food trucks near <strong>${safeLocation}</strong>.</p>
      <div style="background:#fff8f5;border-left:4px solid #ff6b35;padding:20px;margin:20px 0;border-radius:4px;">
        <strong>${safeSeriesName}</strong><br>
        ${safeSeriesDescription ? `<em>${safeSeriesDescription}</em><br>` : ""}
        📅 ${safeStartDateLabel} – ${safeEndDateLabel}<br>
        🕐 ${safeStartTime} – ${safeEndTime}<br>
        📍 ${safeHostAddress}${safeHostCity ? `, ${safeHostCity}` : ""}
      </div>
      <p>Express your interest before the spots fill up. It only takes a minute to let the host know you're available.</p>
      <div style="text-align:center;margin:30px 0;">
        <a href="https://www.mealscout.us/truck/discovery" style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">View Event & Express Interest</a>
      </div>
      <p style="font-size:13px;color:#999;">You're receiving this because your truck operates near ${safeLocation}. To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2025 MealScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hey ${name}! ${host.businessName} posted a new event in ${location}: "${series.name}" (${startDateLabel} – ${endDateLabel}, ${series.defaultStartTime}–${series.defaultEndTime}). View it: https://www.mealscout.us/truck/discovery`;
  return emailService.sendBasicEmail(
    to,
    sanitizeEmailSubject(`🚚 New event opportunity for your truck in ${location}`),
    html,
    text,
  );
}
