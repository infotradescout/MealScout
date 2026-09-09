import { db } from "./db";
import { events, hosts, telemetryEvents } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { emailService } from "./emailService";
import {
  addDaysToDateKey,
  dateKeyFromUnknown,
  dateKeyInZone,
  formatDateKeyForDisplay,
  utcDateFromDateKey,
} from "./services/dateKeys";
import { resolveCityTimeZoneStrict } from "./services/cityTimeZone";
import { loadPersistedEventServiceTimeZone } from "./services/persistedServiceTimeZone";
import { deliverEventNotificationOnce } from "./services/eventNotificationDeliveryService";

type WeeklyDigestPreferenceShape = {
  notifications?: {
    channels?: {
      email?: boolean;
    };
    topics?: {
      weeklyDigest?: boolean;
    };
  };
};

export class DigestService {
  private static instance: DigestService;

  private constructor() {}

  public static getInstance(): DigestService {
    if (!DigestService.instance) {
      DigestService.instance = new DigestService();
    }
    return DigestService.instance;
  }

  async sendWeeklyDigests(options: { now?: Date } = {}) {
    console.log("[Digest] Starting weekly digest generation...");

    try {
      const now = options.now || new Date();

      const allHosts = await db.query.hosts.findMany({
        with: {
          user: true,
        },
      });

      let sentCount = 0;
      let skippedCount = 0;
      let skippedOptOutCount = 0;
      let skippedNoEmailCount = 0;
      let duplicateCount = 0;

      for (const host of allHosts) {
        const userAny: any = host.user || {};
        const hostEmail = String(userAny.email || "").trim();
        if (!hostEmail) {
          skippedNoEmailCount++;
          continue;
        }

        if (!this.isWeeklyDigestEnabledForUser(userAny)) {
          skippedOptOutCount++;
          continue;
        }

        const hostTimeZone = await resolveCityTimeZoneStrict({
          city: host.city,
          state: host.state,
        });
        if (!hostTimeZone) {
          skippedCount++;
          continue;
        }
        const weekStartKey = dateKeyInZone(now, hostTimeZone);
        const weekEndExclusiveKey = addDaysToDateKey(weekStartKey, 7);
        const idempotencyKey = `${host.id}:${weekStartKey}`;

        const alreadySent = await db.query.telemetryEvents.findFirst({
          where: and(
            eq(telemetryEvents.eventName, "weekly_digest_sent"),
            eq(telemetryEvents.userId, host.userId),
            sql`properties->>'week' = ${idempotencyKey}`,
          ),
        });

        if (alreadySent) {
          duplicateCount++;
          continue;
        }

        const upcomingEvents = await db.query.events.findMany({
          where: and(
            eq(events.hostId, host.id),
            gte(events.date, utcDateFromDateKey(weekStartKey)),
            lt(events.date, utcDateFromDateKey(weekEndExclusiveKey)),
          ),
          with: {
            interests: true,
          },
          orderBy: (events: any, { asc }: any) => [asc(events.date)],
        });

        if (upcomingEvents.length === 0) {
          skippedCount++;
          continue;
        }

        let pendingInterestCount = 0;
        const capacityAlerts: {
          eventName: string;
          date: string;
          accepted: number;
          max: number;
        }[] = [];
        const eventSummaries: {
          name: string;
          date: string;
          accepted: number;
          max: number;
        }[] = [];

        for (const event of upcomingEvents) {
          const eventTimeZone = await loadPersistedEventServiceTimeZone({
            seriesId: event.seriesId,
            city: host.city,
            state: host.state,
          });
          const eventDateKey = dateKeyFromUnknown(event.date, "UTC");
          if (!eventTimeZone || !eventDateKey) continue;
          const interests = event.interests || [];
          const pending = interests.filter((i: any) => i.status === "pending").length;
          const accepted = interests.filter((i: any) => i.status === "accepted").length;

          pendingInterestCount += pending;

          eventSummaries.push({
            name: event.name || "Event",
            date: formatDateKeyForDisplay(eventDateKey),
            accepted,
            max: event.maxTrucks,
          });

          if (accepted >= event.maxTrucks) {
            capacityAlerts.push({
              eventName: event.name || "Event",
              date: formatDateKeyForDisplay(eventDateKey),
              accepted,
              max: event.maxTrucks,
            });
          }
        }

        const digestFacts = {
          hostName: host.businessName,
          weekStart: formatDateKeyForDisplay(weekStartKey),
          weekEnd: formatDateKeyForDisplay(
            addDaysToDateKey(weekEndExclusiveKey, -1),
          ),
          events: eventSummaries,
          pendingCount: pendingInterestCount,
          capacityAlerts,
        };
        const subject = "Your MealScout week at a glance";
        const html = `<p>Hi ${host.businessName},</p><p>Here is your summary for ${digestFacts.weekStart} through ${digestFacts.weekEnd}.</p><p>${pendingInterestCount} pending interest${pendingInterestCount === 1 ? "" : "s"}.</p><ul>${eventSummaries.map((event) => `<li>${event.date}: ${event.name} (${event.accepted}/${event.max})</li>`).join("")}</ul>`;
        const delivery = await deliverEventNotificationOnce({
          notificationKind: "weekly_host_digest",
          subjectId: idempotencyKey,
          recipientUserId: host.userId,
          recipientEmail: hostEmail,
          serviceTimeZone: hostTimeZone,
          serviceDateKey: weekStartKey,
          payload: {
            version: "weekly-host-digest-v1",
            hostId: host.id,
            hostTimeZone,
            weekStartKey,
            weekEndExclusiveKey,
            eventSummaries,
            pendingInterestCount,
            capacityAlerts,
          },
          send: (providerIdempotencyKey) =>
            emailService.sendBasicEmailWithReceipt(
              hostEmail,
              subject,
              html,
              undefined,
              "general",
              providerIdempotencyKey,
            ),
        });

        if (delivery.status !== "provider_confirmed") {
          skippedCount++;
          continue;
        }

        await db.insert(telemetryEvents).values({
          eventName: "weekly_digest_sent",
          userId: host.userId,
          properties: {
            week: idempotencyKey,
            hostId: host.id,
            eventCount: upcomingEvents.length,
            pendingCount: pendingInterestCount,
            alertCount: capacityAlerts.length,
          },
        });

        sentCount++;
      }

      console.log(
        `[Digest] Weekly digest complete. Sent=${sentCount} SkippedEmpty=${skippedCount} SkippedOptOut=${skippedOptOutCount} SkippedNoEmail=${skippedNoEmailCount} Duplicates=${duplicateCount}`,
      );
    } catch (error) {
      console.error("[Digest] Error generating weekly digests:", error);
    }
  }

  private isWeeklyDigestEnabledForUser(user: any): boolean {
    const settings = user?.accountSettings as WeeklyDigestPreferenceShape | undefined;
    if (!settings || typeof settings !== "object") return true;
    const channels = settings.notifications?.channels;
    const topics = settings.notifications?.topics;

    if (channels?.email === false) return false;
    if (topics?.weeklyDigest === false) return false;
    return true;
  }
}

export const digestService = DigestService.getInstance();
