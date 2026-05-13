import { emailService, isEmailConfigured } from "../emailService";
import { notifyUser } from "../productNotifications";
import { db } from "../db";
import {
  restaurantFollows,
  users,
  userAddresses,
  hosts,
  socialPostQueue,
} from "@shared/schema";
import { and, eq, isNull, isNotNull, or } from "drizzle-orm";
import {
  markSocialPostResult,
  publishSocialQueueItem,
} from "../services/socialPublishing";

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

export async function notifyNearbyDealSubscribers(params: {
  creatorUserId: string;
  dealId: string;
  dealTitle: string;
  restaurantName: string;
  lat: number;
  lng: number;
}) {
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
  const dealUrl = `${baseUrl.replace(/\/+$/, "")}/deals/${params.dealId}`;

  const candidates = await db
    .select({
      userId: users.id,
      email: users.email,
      phone: users.phone,
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
    if (candidate.userId === params.creatorUserId) continue;
    if (!isDealAlertsEnabled(candidate.accountSettings)) continue;

    const radiusKm = getNearbyDealRadiusKm(candidate.accountSettings);
    if (!radiusKm) continue;

    const userLat = toNumeric(candidate.latitude);
    const userLng = toNumeric(candidate.longitude);
    if (userLat == null || userLng == null) continue;

    const distanceKm = haversineKm(params.lat, params.lng, userLat, userLng);
    if (distanceKm > radiusKm) continue;

    await notifyUser({
      user: {
        id: String(candidate.userId),
        email: candidate.email,
        phone: candidate.phone,
        accountSettings: candidate.accountSettings,
      },
      topic: "dealAlerts",
      title: `New deal near you: ${params.restaurantName}`,
      body: `${params.dealTitle} is available near your saved location.`,
      actionUrl: `/deal/${params.dealId}`,
      sourceType: "deal",
      sourceId: params.dealId,
      actorUserId: params.creatorUserId,
      channels: ["in_app", "email"],
      metadata: {
        restaurantName: params.restaurantName,
        distanceKm,
      },
    });
  }
}

export async function notifyRestaurantFollowersOfDeal(params: {
  creatorUserId: string;
  restaurantId: string;
  dealId: string;
  dealTitle: string;
  restaurantName: string;
}) {
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
      phone: users.phone,
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
    if (follower.userId === params.creatorUserId) continue;
    if (!isFollowedActivityEnabled(follower.accountSettings)) continue;

    await notifyUser({
      user: {
        id: String(follower.userId),
        email: follower.email,
        phone: follower.phone,
        accountSettings: follower.accountSettings,
      },
      topic: "followedActivity",
      title: `${params.restaurantName} posted a new deal`,
      body: `${params.dealTitle} is live for people following ${params.restaurantName}.`,
      actionUrl: `/deal/${params.dealId}`,
      sourceType: "deal",
      sourceId: params.dealId,
      actorUserId: params.creatorUserId,
      channels: ["in_app", "email"],
      emailHtml: `<p><strong>${safeRestaurantName}</strong> posted something new for people who follow them on MealScout.</p><p><strong>${safeDealTitle}</strong></p><p><a href="${dealUrl}">View it on MealScout</a></p><p style="color:#6b7280;font-size:13px;">You received this because you follow ${safeRestaurantName}. You can change these emails in <a href="${settingsUrl}">notification settings</a>.</p>`,
      emailText: `${params.restaurantName} posted a new deal on MealScout: ${params.dealTitle}. View: ${dealUrl}\n\nYou received this because you follow ${params.restaurantName}. Change email settings: ${settingsUrl}`,
      metadata: { restaurantName: params.restaurantName },
    });
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
  imageUrl?: string | null;
  restaurantId?: string | null;
  createdByUserId?: string | null;
  source?: string | null;
}) => {
  const [row] = await db.insert(socialPostQueue).values({
    platform: payload.platform,
    target: payload.target || null,
    message: payload.message,
    link: payload.link || null,
    imageUrl: payload.imageUrl || null,
    restaurantId: payload.restaurantId || null,
    createdByUserId: payload.createdByUserId || null,
    source: payload.source || "deal_auto_publish",
    status: "pending",
    updatedAt: new Date(),
  }).returning();

  const result = await publishSocialQueueItem(row);
  await markSocialPostResult(row, result);
};
