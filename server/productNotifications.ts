import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { emailService, isEmailConfigured } from "./emailService";
import { isSmsConfigured, sendSms } from "./smsService";
import { telemetryEvents } from "@shared/schema";

type NotificationChannel = "in_app" | "email" | "sms";
type NotificationPriority = "low" | "normal" | "high";

type NotificationUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  accountSettings?: unknown;
};

type ProductNotification = {
  user: NotificationUser;
  topic: string;
  title: string;
  body: string;
  actionUrl?: string | null;
  priority?: NotificationPriority;
  sourceType?: string;
  sourceId?: string | null;
  actorUserId?: string | null;
  channels?: NotificationChannel[];
  emailHtml?: string;
  emailText?: string;
  smsText?: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_CHANNELS: NotificationChannel[] = ["in_app", "email"];
const SMS_TOPICS = new Set([
  "orderUpdates",
  "bookingUpdates",
  "businessMessages",
  "account",
]);

const cleanBaseUrl = () =>
  (process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const truncateSms = (value: string) => {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= 300 ? text : `${text.slice(0, 297).trim()}...`;
};

const settingsOf = (accountSettings: unknown) =>
  accountSettings && typeof accountSettings === "object"
    ? (accountSettings as Record<string, any>)
    : {};

const channelEnabled = (
  accountSettings: unknown,
  channel: NotificationChannel,
) => {
  if (channel === "in_app") return true;
  const channels = settingsOf(accountSettings)?.notifications?.channels;
  if (channel === "sms") {
    return channels?.sms === true;
  }
  return typeof channels?.[channel] === "boolean" ? channels[channel] : true;
};

const topicEnabled = (accountSettings: unknown, topic: string) => {
  const topics = settingsOf(accountSettings)?.notifications?.topics;
  return typeof topics?.[topic] === "boolean" ? topics[topic] : true;
};

const shouldSendSms = (params: ProductNotification) => {
  if (!params.user.phone) return false;
  if (!isSmsConfigured()) return false;
  if (!channelEnabled(params.user.accountSettings, "sms")) return false;
  if (!topicEnabled(params.user.accountSettings, params.topic)) return false;
  return (
    params.priority === "high" ||
    SMS_TOPICS.has(params.topic) ||
    params.channels?.includes("sms") === true
  );
};

export async function notifyUser(params: ProductNotification) {
  const notificationId = randomUUID();
  const requestedChannels = params.channels || DEFAULT_CHANNELS;
  const channelResults: Record<string, string> = {};
  const baseUrl = cleanBaseUrl();
  const settingsUrl = `${baseUrl}/profile/notifications`;
  const actionUrl = params.actionUrl?.startsWith("http")
    ? params.actionUrl
    : params.actionUrl
      ? `${baseUrl}${params.actionUrl}`
      : null;

  if (requestedChannels.includes("in_app")) {
    channelResults.in_app = "created";
  }

  if (
    requestedChannels.includes("email") &&
    params.user.email &&
    isEmailConfigured() &&
    channelEnabled(params.user.accountSettings, "email") &&
    topicEnabled(params.user.accountSettings, params.topic)
  ) {
    const html =
      params.emailHtml ||
      `<p>${escapeHtml(params.body)}</p>${
        actionUrl ? `<p><a href="${actionUrl}">Open in MealScout</a></p>` : ""
      }<p style="color:#6b7280;font-size:13px;">You received this because of your MealScout activity. Update preferences in <a href="${settingsUrl}">notification settings</a>.</p>`;
    const text =
      params.emailText ||
      `${params.body}${actionUrl ? `\n\nOpen in MealScout: ${actionUrl}` : ""}\n\nUpdate notification settings: ${settingsUrl}`;
    const ok = await emailService.sendBasicEmail(
      params.user.email,
      params.title,
      html,
      text,
      params.topic === "account" ? "account" : "general",
    );
    channelResults.email = ok ? "sent" : "failed";
  } else if (requestedChannels.includes("email")) {
    channelResults.email = "skipped";
  }

  if (requestedChannels.includes("sms") && shouldSendSms(params)) {
    const smsBody = truncateSms(
      params.smsText ||
        `${params.title}: ${params.body}${actionUrl ? ` ${actionUrl}` : ""} Reply STOP to opt out.`,
    );
    const ok = await sendSms(String(params.user.phone), smsBody);
    channelResults.sms = ok ? "sent" : "failed";
  } else if (requestedChannels.includes("sms")) {
    channelResults.sms = "skipped";
  }

  await db.insert(telemetryEvents).values({
    eventName: "product_notification",
    userId: params.user.id,
    properties: {
      notificationId,
      topic: params.topic,
      title: params.title,
      body: params.body,
      actionUrl: params.actionUrl || null,
      priority: params.priority || "normal",
      sourceType: params.sourceType || null,
      sourceId: params.sourceId || null,
      actorUserId: params.actorUserId || null,
      channels: channelResults,
      metadata: params.metadata || {},
    },
  });

  return { notificationId, channels: channelResults };
}

export async function listInAppNotifications(userId: string, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const result = await db.execute(sql`
    with notification_rows as (
      select
        id,
        created_at,
        properties
      from telemetry_events
      where event_name = 'product_notification'
        and user_id = ${userId}
      order by created_at desc
      limit ${safeLimit}
    ),
    read_rows as (
      select properties->>'notificationId' as notification_id
      from telemetry_events
      where event_name = 'product_notification_read'
        and user_id = ${userId}
    )
    select
      nr.id,
      nr.created_at as "createdAt",
      nr.properties,
      case when rr.notification_id is null then false else true end as "isRead"
    from notification_rows nr
    left join read_rows rr
      on rr.notification_id = nr.properties->>'notificationId'
    order by nr.created_at desc
  `);
  return Array.isArray((result as any).rows) ? (result as any).rows : [];
}

export async function markInAppNotificationRead(
  userId: string,
  notificationId: string,
) {
  await db.insert(telemetryEvents).values({
    eventName: "product_notification_read",
    userId,
    properties: { notificationId },
  });
}
