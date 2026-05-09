import { emailService, isEmailConfigured } from "../emailService";
import { db } from "../db";
import {
  restaurantFollows,
  users,
  userAddresses,
  hosts,
  socialPostQueue,
} from "@shared/schema";
import { and, eq, isNull, isNotNull, or } from "drizzle-orm";

const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

export const toNumeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEmailChannelEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const channels =
    settings?.notifications?.channels &&
    typeof settings.notifications.channels === "object"
      ? (settings.notifications.channels as Record<string, any>)
      : null;
  return typeof channels?.email === "boolean" ? channels.email : true;
};

const isDealAlertsEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const topics =
    settings?.notifications?.topics &&
    typeof settings.notifications.topics === "object"
      ? (settings.notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.dealAlerts === "boolean" ? topics.dealAlerts : true;
};

const isFollowedActivityEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const topics =
    settings?.notifications?.topics &&
    typeof settings.notifications.topics === "object"
      ? (settings.notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.followedActivity === "boolean"
    ? topics.followedActivity
    : true;
};

const isNearbyEventsEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const topics =
    settings?.notifications?.topics &&
    typeof settings.notifications.topics === "object"
      ? (settings.notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.nearbyEvents === "boolean" ? topics.nearbyEvents : true;
};

const getNearbyDealRadiusKm = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const location =
    settings?.notifications?.location &&
    typeof settings.notifications.location === "object"
      ? (settings.notifications.location as Record<string, any>)
      : null;

  if (location && typeof location.enabled === "boolean" && !location.enabled) {
    return null;
  }

  const radius = Number(location?.radiusKm);
  if (Number.isFinite(radius) && radius > 0) {
    return radius;
  }
  return 8; // ~5 miles default
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const postToFacebookPage = async (message: string, link?: string | null) => {
  const pageId = process.env.MEALSCOUT_FB_PAGE_ID;
  const pageToken = process.env.MEALSCOUT_FB_PAGE_TOKEN;
  if (!pageId || !pageToken) {
    return { ok: false, error: "Missing Facebook page credentials" };
  }
  const body = new URLSearchParams();
  body.set("message", link ? `${message} ${link}` : message);
  body.set("access_token", pageToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || "Facebook post failed",
    };
  }
  return { ok: true, postId: data?.id };
};

export async function notifyNearbyDealSubscribers(params: {
  creatorUserId: string;
  dealId: string;
  dealTitle: string;
  restaurantName: string;
  lat: number;
  lng: number;
}) {
  if (!isEmailConfigured()) return;

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
  const dealUrl = `${baseUrl.replace(/\/+$/, "")}/deals/${params.dealId}`;

  const candidates = await db
    .select({
      userId: users.id,
      email: users.email,
      accountSettings: users.accountSettings,
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
    .where(
      and(
        or(eq(users.isDisabled, false), isNull(users.isDisabled)),
        isNotNull(users.email),
        isNotNull(userAddresses.latitude),
        isNotNull(userAddresses.longitude),
      ),
    );

  for (const candidate of candidates) {
    if (!candidate.email || candidate.userId === params.creatorUserId) continue;
    if (!isEmailChannelEnabled(candidate.accountSettings)) continue;
    if (!isDealAlertsEnabled(candidate.accountSettings)) continue;

    const radiusKm = getNearbyDealRadiusKm(candidate.accountSettings);
    if (!radiusKm) continue;

    const userLat = toNumeric(candidate.latitude);
    const userLng = toNumeric(candidate.longitude);
    if (userLat == null || userLng == null) continue;

    const distanceKm = haversineKm(params.lat, params.lng, userLat, userLng);
    if (distanceKm > radiusKm) continue;

    await emailService.sendBasicEmail(
      candidate.email,
      `New deal near you: ${params.restaurantName}`,
      `<p>A new deal was just posted near your location.</p><p><strong>${params.dealTitle}</strong> at <strong>${params.restaurantName}</strong>.</p><p><a href="${dealUrl}">View deal</a></p>`,
      `New deal near you: ${params.dealTitle} at ${params.restaurantName}. View: ${dealUrl}`,
      "general",
    );
  }
}

export async function notifyRestaurantFollowersOfDeal(params: {
  creatorUserId: string;
  restaurantId: string;
  dealId: string;
  dealTitle: string;
  restaurantName: string;
}) {
  if (!isEmailConfigured()) return;

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  const dealUrl = `${cleanBaseUrl}/deals/${params.dealId}`;
  const settingsUrl = `${cleanBaseUrl}/profile/notifications`;
  const safeRestaurantName = escapeHtml(params.restaurantName);
  const safeDealTitle = escapeHtml(params.dealTitle);

  const followers = await db
    .select({
      userId: users.id,
      email: users.email,
      accountSettings: users.accountSettings,
    })
    .from(restaurantFollows)
    .innerJoin(users, eq(users.id, restaurantFollows.userId))
    .where(
      and(
        eq(restaurantFollows.restaurantId, params.restaurantId),
        or(eq(users.isDisabled, false), isNull(users.isDisabled)),
        isNotNull(users.email),
      ),
    );

  for (const follower of followers) {
    if (!follower.email || follower.userId === params.creatorUserId) continue;
    if (!isEmailChannelEnabled(follower.accountSettings)) continue;
    if (!isFollowedActivityEnabled(follower.accountSettings)) continue;

    await emailService.sendBasicEmail(
      follower.email,
      `${params.restaurantName} posted a new deal on MealScout`,
      `<p><strong>${safeRestaurantName}</strong> posted something new for people who follow them on MealScout.</p><p><strong>${safeDealTitle}</strong></p><p><a href="${dealUrl}">View it on MealScout</a></p><p style="color:#6b7280;font-size:13px;">You received this because you follow ${safeRestaurantName}. You can change these emails in <a href="${settingsUrl}">notification settings</a>.</p>`,
      `${params.restaurantName} posted a new deal on MealScout: ${params.dealTitle}. View: ${dealUrl}\n\nYou received this because you follow ${params.restaurantName}. Change email settings: ${settingsUrl}`,
      "general",
    );
  }
}

export async function notifyHostCapacityWarning(params: {
  hostId: string;
  eventId: string;
  eventStartDate: Date | null;
  confirmedCount: number;
  maxTrucks: number;
}) {
  if (!isEmailConfigured()) return;

  const [recipient] = await db
    .select({
      email: users.email,
      accountSettings: users.accountSettings,
      hostName: hosts.businessName,
    })
    .from(hosts)
    .innerJoin(users, eq(users.id, hosts.userId))
    .where(eq(hosts.id, params.hostId))
    .limit(1);

  if (!recipient?.email) return;
  if (!isEmailChannelEnabled(recipient.accountSettings)) return;
  if (!isNearbyEventsEnabled(recipient.accountSettings)) return;

  const fillPercent = Math.round(
    (params.confirmedCount / Math.max(1, params.maxTrucks)) * 100,
  );
  const isFull = params.confirmedCount >= params.maxTrucks;
  const subject = isFull
    ? `Parking Pass full: ${recipient.hostName || "Host listing"}`
    : `Parking Pass nearing capacity: ${recipient.hostName || "Host listing"}`;
  const eventDateText = params.eventStartDate
    ? new Date(params.eventStartDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Upcoming date";

  await emailService.sendBasicEmail(
    recipient.email,
    subject,
    `<p>Your parking pass date on <strong>${eventDateText}</strong> is now at <strong>${params.confirmedCount}/${params.maxTrucks}</strong> booked spots (${fillPercent}%).</p><p>Event ID: ${params.eventId}</p>`,
    `Parking pass occupancy update: ${eventDateText} is ${params.confirmedCount}/${params.maxTrucks} booked (${fillPercent}%). Event ID: ${params.eventId}`,
    "general",
  );
}

export const queueSocialPost = async (payload: {
  platform: string;
  target?: string | null;
  message: string;
  link?: string | null;
}) => {
  let status = "pending";
  let errorMessage: string | null = null;

  if (payload.platform === "facebook") {
    const result = await postToFacebookPage(payload.message, payload.link);
    status = result.ok ? "posted" : "failed";
    if (!result.ok) {
      errorMessage = result.error || "Facebook post failed";
    }
  }

  await db.insert(socialPostQueue).values({
    platform: payload.platform,
    target: payload.target || null,
    message: payload.message,
    link: payload.link || null,
    status,
    errorMessage,
    updatedAt: new Date(),
  });
};
