import { db } from "./db";
import { events, hosts, telemetryEvents } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { emailService } from "./emailService";
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from "./utils/reminderBusinessHours";

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

  async sendWeeklyDigests() {
    const hours = getReminderBusinessHoursStatus();
    if (!hours.allowed) {
      logReminderBusinessHoursSkip("weekly digest", hours);
      return;
    }

    console.log("[Digest] Starting weekly digest generation...");

    try {
      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + 7);

      const weekNumber = this.getWeekNumber(now);
      const idempotencyKey = `${now.getFullYear()}-W${weekNumber}`;

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
            gte(events.date, now),
            lt(events.date, nextWeek),
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
          const interests = event.interests || [];
          const pending = interests.filter((i: any) => i.status === "pending").length;
          const accepted = interests.filter((i: any) => i.status === "accepted").length;

          pendingInterestCount += pending;

          eventSummaries.push({
            name: event.name || "Event",
            date: new Date(event.date).toLocaleDateString(),
            accepted,
            max: event.maxTrucks,
          });

          if (accepted >= event.maxTrucks) {
            capacityAlerts.push({
              eventName: event.name || "Event",
              date: new Date(event.date).toLocaleDateString(),
              accepted,
              max: event.maxTrucks,
            });
          }
        }

        await emailService.sendWeeklyDigest(hostEmail, {
          hostName: host.businessName,
          weekStart: now.toLocaleDateString(),
          weekEnd: nextWeek.toLocaleDateString(),
          events: eventSummaries,
          pendingCount: pendingInterestCount,
          capacityAlerts,
        });

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

  private getWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
