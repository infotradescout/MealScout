import { db } from "./db";
import { restaurants, users, telemetryEvents } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
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
  latitude?: string | number | null;
  longitude?: string | number | null;
  amenities?: Record<string, boolean> | null;
};

type EventInfo = {
  id: string;
  name: string;
  description?: string | null;
  date: Date;
  startTime: string;
  endTime: string;
  requiresPayment?: boolean;
  hostPriceCents?: number | null;
};

type NotifyOptions = {
  radiusMiles?: number;
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

function toCoord(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMiles(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);
  const lat1 = toRad(start.lat);
  const lat2 = toRad(end.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) *
      Math.sin(dLng / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

type CandidateTruck = {
  id: string;
  name: string;
  ownerId: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
};

async function getCandidateTrucksForHost(
  host: HostInfo,
  radiusMiles: number,
): Promise<CandidateTruck[]> {
  const hostLat = toCoord(host.latitude);
  const hostLng = toCoord(host.longitude);

  const trucks = (await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      ownerId: restaurants.ownerId,
      city: restaurants.city,
      state: restaurants.state,
      address: restaurants.address,
      latitude: restaurants.latitude,
      longitude: restaurants.longitude,
    })
    .from(restaurants)
    .where(and(eq(restaurants.isFoodTruck, true), eq(restaurants.isActive, true)))) as CandidateTruck[];

  const hasHostCoords = hostLat !== null && hostLng !== null;
  if (!hasHostCoords) {
    const cityLike = host.city?.trim() ? `%${host.city.trim()}%` : "";
    const stateLike = host.state?.trim() ? `%${host.state.trim()}%` : "";
    return trucks.filter((truck: CandidateTruck) => {
      if (!cityLike && !stateLike) return false;
      const truckCity = String(truck.city || "").toLowerCase();
      const truckAddress = String(truck.address || "").toLowerCase();
      const truckState = String(truck.state || "").toLowerCase();
      const hostCity = String(host.city || "").toLowerCase();
      const hostState = String(host.state || "").toLowerCase();
      return (
        (hostCity && (truckCity.includes(hostCity) || truckAddress.includes(hostCity))) ||
        (hostState && truckState.includes(hostState))
      );
    });
  }

  return trucks.filter((truck: CandidateTruck) => {
    const truckLat = toCoord(truck.latitude);
    const truckLng = toCoord(truck.longitude);
    if (truckLat === null || truckLng === null) return false;
    const distanceMiles = haversineMiles(
      { lat: hostLat, lng: hostLng },
      { lat: truckLat, lng: truckLng },
    );
    return Number.isFinite(distanceMiles) && distanceMiles <= radiusMiles;
  });
}

export async function notifyNearbyTrucksOfNewSeries(
  series: SeriesInfo,
  host: HostInfo,
  options: NotifyOptions = {},
): Promise<{ notified: number; errors: number }> {
  let notified = 0;
  let errors = 0;
  const radiusMiles = Math.max(1, Math.min(250, Number(options.radiusMiles || 50)));

  try {
    const trucks = await getCandidateTrucksForHost(host, radiusMiles);

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
            radiusMiles,
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

export async function notifyNearbyTrucksOfNewEvent(
  event: EventInfo,
  host: HostInfo,
  options: NotifyOptions = {},
): Promise<{ notified: number; errors: number }> {
  let notified = 0;
  let errors = 0;
  const radiusMiles = Math.max(1, Math.min(250, Number(options.radiusMiles || 50)));

  try {
    const trucks = await getCandidateTrucksForHost(host, radiusMiles);
    for (const truck of trucks) {
      if (!truck.ownerId) continue;

      const alreadySent = await db.query.telemetryEvents.findFirst({
        where: and(
          eq(telemetryEvents.eventName, "truck_event_match_sent"),
          eq(telemetryEvents.userId, truck.ownerId),
          sql`properties->>'eventId' = ${event.id}`,
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
        await sendEventMatchEmail(
          owner.email,
          owner.firstName,
          truck.name,
          event,
          host,
        );
        await db.insert(telemetryEvents).values({
          eventName: "truck_event_match_sent",
          userId: truck.ownerId,
          properties: {
            eventId: event.id,
            truckId: truck.id,
            hostCity: host.city,
            radiusMiles,
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
    `[TruckEventMatch] Event ${event.id}: notified=${notified} errors=${errors}`,
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
  return emailService.sendBasicEmail(
    to,
    `🚚 New event opportunity for your truck in ${location}`,
    html,
    text,
  );
}

async function sendEventMatchEmail(
  to: string,
  firstName: string | null,
  truckName: string,
  event: EventInfo,
  host: HostInfo,
): Promise<boolean> {
  const name = firstName || truckName || "Food Truck Owner";
  const location = host.state
    ? `${host.city}, ${host.state}`
    : (host.city ?? "your area");
  const dateLabel = new Date(event.date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const pricingLabel =
    event.hostPriceCents && event.hostPriceCents > 0
      ? `Host fee: $${(event.hostPriceCents / 100).toFixed(2)} (+ $10 platform fee)`
      : "Free to participate";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>New Event Opportunity</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f9fa;color:#333;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:#fff;padding:30px 40px;text-align:center;">
      <h1 style="margin:0;font-size:28px;">MealScout</h1>
      <div style="margin:8px 0 0;font-size:16px;opacity:0.9;">New Event Opportunity in ${location}</div>
    </div>
    <div style="padding:40px;">
      <h2 style="color:#ff6b35;font-size:24px;margin:0 0 16px;">A new event just posted near you</h2>
      <p>Hey ${name}!</p>
      <p><strong>${host.businessName}</strong> posted a new event looking for trucks in <strong>${location}</strong>.</p>
      <div style="background:#fff8f5;border-left:4px solid #ff6b35;padding:20px;margin:20px 0;border-radius:4px;">
        <strong>${event.name}</strong><br>
        ${event.description ? `<em>${event.description}</em><br>` : ""}
        Date: ${dateLabel}<br>
        Time: ${event.startTime} - ${event.endTime}<br>
        ${pricingLabel}<br>
        Location: ${host.address}${host.city ? `, ${host.city}` : ""}
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="https://www.mealscout.us/events" style="background:linear-gradient(135deg,#ff6b35 0%,#f7931e 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:6px;font-weight:600;">Open Events Portal</a>
      </div>
      <p style="font-size:13px;color:#999;">You're receiving this because your truck operates near ${location}. To unsubscribe, update your <a href="https://www.mealscout.us/profile" style="color:#ff6b35;">notification settings</a>.</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 40px;text-align:center;border-top:1px solid #e9ecef;font-size:13px;color:#666;">
      <p style="margin:0;">© 2026 MealScout. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `Hey ${name}! ${host.businessName} posted "${event.name}" in ${location} on ${dateLabel} (${event.startTime}-${event.endTime}). View it: https://www.mealscout.us/events`;
  return emailService.sendBasicEmail(
    to,
    `New food truck event near ${location}`,
    html,
    text,
  );
}
