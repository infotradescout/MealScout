import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { eventSeries, events, hosts, users } from "@shared/schema";
import { emailService, isEmailConfigured } from "./emailService";
import { storage } from "./storage";
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from "./utils/reminderBusinessHours";

const isEmailNotificationsEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const notifications =
    settings?.notifications && typeof settings.notifications === "object"
      ? (settings.notifications as Record<string, any>)
      : null;
  const channels =
    notifications?.channels && typeof notifications.channels === "object"
      ? (notifications.channels as Record<string, any>)
      : null;

  if (channels && typeof channels.email === "boolean") {
    return channels.email;
  }
  return true;
};

const hasPricing = (row: {
  breakfastPriceCents: number | null;
  lunchPriceCents: number | null;
  dinnerPriceCents: number | null;
  dailyPriceCents: number | null;
  weeklyPriceCents: number | null;
  monthlyPriceCents: number | null;
}) =>
  (row.breakfastPriceCents ?? 0) > 0 ||
  (row.lunchPriceCents ?? 0) > 0 ||
  (row.dinnerPriceCents ?? 0) > 0 ||
  (row.dailyPriceCents ?? 0) > 0 ||
  (row.weeklyPriceCents ?? 0) > 0 ||
  (row.monthlyPriceCents ?? 0) > 0;

const pricingFieldsFromRow = (row: {
  breakfastPriceCents: number | null;
  lunchPriceCents: number | null;
  dinnerPriceCents: number | null;
  dailyPriceCents: number | null;
  weeklyPriceCents: number | null;
  monthlyPriceCents: number | null;
}) => ({
  parkingPassBreakfastPriceCents: Number(row.breakfastPriceCents ?? 0) || 0,
  parkingPassLunchPriceCents: Number(row.lunchPriceCents ?? 0) || 0,
  parkingPassDinnerPriceCents: Number(row.dinnerPriceCents ?? 0) || 0,
  parkingPassDailyPriceCents: Number(row.dailyPriceCents ?? 0) || 0,
  parkingPassWeeklyPriceCents: Number(row.weeklyPriceCents ?? 0) || 0,
  parkingPassMonthlyPriceCents: Number(row.monthlyPriceCents ?? 0) || 0,
});

export type ParkingPassOnboardingQueueItem = {
  hostId: string;
  userId: string;
  businessName: string | null;
  address: string | null;
  email: string | null;
  emailNotificationsEnabled: boolean;
  locationType: string | null;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  stripeReady: boolean;
  needsPricing: boolean;
  needsStripe: boolean;
  priority: "high" | "medium";
};

export type ParkingPassPricingAuditItem = {
  hostId: string;
  userId: string;
  businessName: string | null;
  hostPricing: boolean;
  seriesPricing: boolean;
  eventPricing: boolean;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  mismatch: boolean;
};

const isHostExcluded = (host: {
  userType: string | null;
  locationType: string | null;
}) =>
  host.userType === "event_coordinator" ||
  host.locationType === "event_coordinator";

async function buildOnboardingQueueInternal() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hostRows = await db
    .select({
      hostId: hosts.id,
      userId: hosts.userId,
      businessName: hosts.businessName,
      address: hosts.address,
      locationType: hosts.locationType,
      breakfastPriceCents: hosts.parkingPassBreakfastPriceCents,
      lunchPriceCents: hosts.parkingPassLunchPriceCents,
      dinnerPriceCents: hosts.parkingPassDinnerPriceCents,
      dailyPriceCents: hosts.parkingPassDailyPriceCents,
      weeklyPriceCents: hosts.parkingPassWeeklyPriceCents,
      monthlyPriceCents: hosts.parkingPassMonthlyPriceCents,
      stripeConnectAccountId: hosts.stripeConnectAccountId,
      stripeChargesEnabled: hosts.stripeChargesEnabled,
      stripePayoutsEnabled: hosts.stripePayoutsEnabled,
      stripeOnboardingCompleted: hosts.stripeOnboardingCompleted,
      email: users.email,
      userType: users.userType,
      accountSettings: users.accountSettings,
    })
    .from(hosts)
    .innerJoin(users, eq(hosts.userId, users.id))
    .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)));

  const upcomingRows = await db
    .select({
      hostId: events.hostId,
      breakfastPriceCents: events.breakfastPriceCents,
      lunchPriceCents: events.lunchPriceCents,
      dinnerPriceCents: events.dinnerPriceCents,
      dailyPriceCents: events.dailyPriceCents,
      weeklyPriceCents: events.weeklyPriceCents,
      monthlyPriceCents: events.monthlyPriceCents,
    })
    .from(events)
    .where(and(eq(events.requiresPayment, true), gte(events.date, today)));

  const seriesRows = await db
    .select({
      hostId: eventSeries.hostId,
      breakfastPriceCents: eventSeries.defaultBreakfastPriceCents,
      lunchPriceCents: eventSeries.defaultLunchPriceCents,
      dinnerPriceCents: eventSeries.defaultDinnerPriceCents,
      dailyPriceCents: eventSeries.defaultDailyPriceCents,
      weeklyPriceCents: eventSeries.defaultWeeklyPriceCents,
      monthlyPriceCents: eventSeries.defaultMonthlyPriceCents,
    })
    .from(eventSeries)
    .where(eq(eventSeries.seriesType, "parking_pass"));

  const hostsWithEventPricing = new Set<string>();
  for (const row of upcomingRows) {
    if (hasPricing(row)) hostsWithEventPricing.add(row.hostId);
  }

  const hostsWithSeriesPricing = new Set<string>();
  for (const row of seriesRows) {
    if (hasPricing(row)) hostsWithSeriesPricing.add(row.hostId);
  }

  const queue: ParkingPassOnboardingQueueItem[] = [];
  for (const host of hostRows) {
    if (isHostExcluded(host)) continue;

    const hasHostPricing = hasPricing(host);
    const hasSeriesPricing = hostsWithSeriesPricing.has(host.hostId);
    const hasEventPricing = hostsWithEventPricing.has(host.hostId);
    const pricingReady = hasHostPricing || hasSeriesPricing || hasEventPricing;
    const pricingSource = hasHostPricing
      ? "host"
      : hasSeriesPricing
        ? "series"
        : hasEventPricing
          ? "event"
          : "none";
    const stripeReady = Boolean(
      host.stripeConnectAccountId &&
      host.stripeChargesEnabled &&
      host.stripePayoutsEnabled &&
      host.stripeOnboardingCompleted,
    );
    const needsPricing = !pricingReady;
    const needsStripe = !stripeReady;
    if (!needsPricing && !needsStripe) continue;

    queue.push({
      hostId: host.hostId,
      userId: host.userId,
      businessName: host.businessName,
      address: host.address,
      email: host.email,
      emailNotificationsEnabled: isEmailNotificationsEnabled(
        host.accountSettings,
      ),
      locationType: host.locationType,
      pricingReady,
      pricingSource,
      stripeReady,
      needsPricing,
      needsStripe,
      priority: needsStripe ? "high" : "medium",
    });
  }

  queue.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    const aName = String(a.businessName || "").toLowerCase();
    const bName = String(b.businessName || "").toLowerCase();
    return aName.localeCompare(bName);
  });

  return queue;
}

export async function getParkingPassPricingAudit() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hostRows = await db
    .select({
      hostId: hosts.id,
      userId: hosts.userId,
      businessName: hosts.businessName,
      locationType: hosts.locationType,
      breakfastPriceCents: hosts.parkingPassBreakfastPriceCents,
      lunchPriceCents: hosts.parkingPassLunchPriceCents,
      dinnerPriceCents: hosts.parkingPassDinnerPriceCents,
      dailyPriceCents: hosts.parkingPassDailyPriceCents,
      weeklyPriceCents: hosts.parkingPassWeeklyPriceCents,
      monthlyPriceCents: hosts.parkingPassMonthlyPriceCents,
      userType: users.userType,
    })
    .from(hosts)
    .innerJoin(users, eq(hosts.userId, users.id))
    .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)));

  const eventRows = await db
    .select({
      hostId: events.hostId,
      breakfastPriceCents: events.breakfastPriceCents,
      lunchPriceCents: events.lunchPriceCents,
      dinnerPriceCents: events.dinnerPriceCents,
      dailyPriceCents: events.dailyPriceCents,
      weeklyPriceCents: events.weeklyPriceCents,
      monthlyPriceCents: events.monthlyPriceCents,
    })
    .from(events)
    .where(and(eq(events.requiresPayment, true), gte(events.date, today)));

  const seriesRows = await db
    .select({
      hostId: eventSeries.hostId,
      breakfastPriceCents: eventSeries.defaultBreakfastPriceCents,
      lunchPriceCents: eventSeries.defaultLunchPriceCents,
      dinnerPriceCents: eventSeries.defaultDinnerPriceCents,
      dailyPriceCents: eventSeries.defaultDailyPriceCents,
      weeklyPriceCents: eventSeries.defaultWeeklyPriceCents,
      monthlyPriceCents: eventSeries.defaultMonthlyPriceCents,
    })
    .from(eventSeries)
    .where(eq(eventSeries.seriesType, "parking_pass"));

  const hostsWithEventPricing = new Set<string>();
  for (const row of eventRows) {
    if (hasPricing(row)) hostsWithEventPricing.add(row.hostId);
  }

  const hostsWithSeriesPricing = new Set<string>();
  for (const row of seriesRows) {
    if (hasPricing(row)) hostsWithSeriesPricing.add(row.hostId);
  }

  const items: ParkingPassPricingAuditItem[] = [];
  for (const host of hostRows) {
    if (isHostExcluded(host)) continue;

    const hostPricing = hasPricing(host);
    const seriesPricing = hostsWithSeriesPricing.has(host.hostId);
    const eventPricing = hostsWithEventPricing.has(host.hostId);
    const pricingReady = hostPricing || seriesPricing || eventPricing;
    const pricingSource = hostPricing
      ? "host"
      : seriesPricing
        ? "series"
        : eventPricing
          ? "event"
          : "none";
    const mismatch =
      (hostPricing ? 1 : 0) + (seriesPricing ? 1 : 0) + (eventPricing ? 1 : 0) > 1;

    items.push({
      hostId: host.hostId,
      userId: host.userId,
      businessName: host.businessName,
      hostPricing,
      seriesPricing,
      eventPricing,
      pricingReady,
      pricingSource,
      mismatch,
    });
  }

  const mismatches = items.filter((item) => item.mismatch);
  const noPricing = items.filter((item) => !item.pricingReady);

  return {
    totalHosts: items.length,
    withHostPricing: items.filter((item) => item.hostPricing).length,
    withSeriesPricing: items.filter((item) => item.seriesPricing).length,
    withEventPricing: items.filter((item) => item.eventPricing).length,
    mismatches: mismatches.length,
    noPricing: noPricing.length,
    items: mismatches.concat(noPricing).slice(0, 100),
  };
}

export async function repairParkingPassPricingDrift() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hostRows = await db
    .select({
      hostId: hosts.id,
      locationType: hosts.locationType,
      userType: users.userType,
      breakfastPriceCents: hosts.parkingPassBreakfastPriceCents,
      lunchPriceCents: hosts.parkingPassLunchPriceCents,
      dinnerPriceCents: hosts.parkingPassDinnerPriceCents,
      dailyPriceCents: hosts.parkingPassDailyPriceCents,
      weeklyPriceCents: hosts.parkingPassWeeklyPriceCents,
      monthlyPriceCents: hosts.parkingPassMonthlyPriceCents,
    })
    .from(hosts)
    .innerJoin(users, eq(hosts.userId, users.id))
    .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)));

  const seriesRows = await db
    .select({
      id: eventSeries.id,
      hostId: eventSeries.hostId,
      defaultStartTime: eventSeries.defaultStartTime,
      defaultEndTime: eventSeries.defaultEndTime,
      parkingPassDaysOfWeek: eventSeries.parkingPassDaysOfWeek,
      breakfastPriceCents: eventSeries.defaultBreakfastPriceCents,
      lunchPriceCents: eventSeries.defaultLunchPriceCents,
      dinnerPriceCents: eventSeries.defaultDinnerPriceCents,
      dailyPriceCents: eventSeries.defaultDailyPriceCents,
      weeklyPriceCents: eventSeries.defaultWeeklyPriceCents,
      monthlyPriceCents: eventSeries.defaultMonthlyPriceCents,
    })
    .from(eventSeries)
    .where(eq(eventSeries.seriesType, "parking_pass"));

  const eventRows = await db
    .select({
      id: events.id,
      hostId: events.hostId,
      startTime: events.startTime,
      endTime: events.endTime,
      breakfastPriceCents: events.breakfastPriceCents,
      lunchPriceCents: events.lunchPriceCents,
      dinnerPriceCents: events.dinnerPriceCents,
      dailyPriceCents: events.dailyPriceCents,
      weeklyPriceCents: events.weeklyPriceCents,
      monthlyPriceCents: events.monthlyPriceCents,
      date: events.date,
    })
    .from(events)
    .where(and(eq(events.requiresPayment, true), gte(events.date, today)));

  const hostById = new Map<string, (typeof hostRows)[number]>(
    hostRows.map((row: (typeof hostRows)[number]) => [String(row.hostId), row]),
  );
  const seriesByHostId = new Map<string, (typeof seriesRows)[number]>();
  for (const row of seriesRows) {
    if (!hasPricing(row)) continue;
    const rowHostId = String(row.hostId);
    if (!seriesByHostId.has(rowHostId)) {
      seriesByHostId.set(rowHostId, row);
    }
  }

  const eventByHostId = new Map<string, (typeof eventRows)[number]>();
  for (const row of eventRows) {
    if (!hasPricing(row)) continue;
    const rowHostId = String(row.hostId);
    const existing = eventByHostId.get(rowHostId);
    if (!existing || new Date(row.date).getTime() < new Date(existing.date).getTime()) {
      eventByHostId.set(rowHostId, row);
    }
  }

  let updatedHosts = 0;
  let syncedSeries = 0;
  let repairedFromSeries = 0;
  let repairedFromEvent = 0;

  for (const [hostId, host] of hostById.entries()) {
    if (isHostExcluded(host)) continue;

    const hostPricing = hasPricing(host);
    const seriesPricing = seriesByHostId.has(hostId);
    const eventPricing = eventByHostId.has(hostId);

    let hostUpdated = false;

    if (!hostPricing && seriesPricing) {
      const series = seriesByHostId.get(hostId)!;
      await db
        .update(hosts)
        .set({
          ...pricingFieldsFromRow(series),
          parkingPassStartTime: series.defaultStartTime ?? null,
          parkingPassEndTime: series.defaultEndTime ?? null,
          parkingPassDaysOfWeek: series.parkingPassDaysOfWeek ?? [],
          updatedAt: new Date(),
        } as any)
        .where(eq(hosts.id, hostId));
      hostUpdated = true;
      repairedFromSeries += 1;
    } else if (!hostPricing && !seriesPricing && eventPricing) {
      const event = eventByHostId.get(hostId)!;
      await db
        .update(hosts)
        .set({
          ...pricingFieldsFromRow(event),
          parkingPassStartTime: event.startTime ?? null,
          parkingPassEndTime: event.endTime ?? null,
          updatedAt: new Date(),
        } as any)
        .where(eq(hosts.id, hostId));
      hostUpdated = true;
      repairedFromEvent += 1;
    }

    if (hostUpdated || (hostPricing && (seriesPricing || eventPricing))) {
      updatedHosts += hostUpdated ? 1 : 0;
      const seriesId = await storage.syncParkingPassSeriesFromHost(hostId);
      if (seriesId) syncedSeries += 1;
    }
  }

  const audit = await getParkingPassPricingAudit();
  return {
    success: true,
    updatedHosts,
    syncedSeries,
    repairedFromSeries,
    repairedFromEvent,
    remainingMismatches: audit.mismatches,
    remainingNoPricing: audit.noPricing,
  };
}

export async function getParkingPassOnboardingQueue() {
  const queue = await buildOnboardingQueueInternal();
  return {
    total: queue.length,
    highPriority: queue.filter((item) => item.priority === "high").length,
    mediumPriority: queue.filter((item) => item.priority === "medium").length,
    items: queue,
  };
}

export async function sendParkingPassReminderForHost(hostId: string) {
  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip("manual parking pass reminder", hours);
    return {
      ok: false,
      code: "outside_business_hours",
      message: "Reminder emails can only be sent during business hours",
    };
  }

  const normalizedHostId = String(hostId || "").trim();
  if (!normalizedHostId) {
    return {
      ok: false,
      code: "invalid_host_id",
      message: "Host ID is required",
    };
  }

  if (!isEmailConfigured()) {
    return {
      ok: false,
      code: "email_not_configured",
      message: "Email provider is not configured",
    };
  }

  const queue = await buildOnboardingQueueInternal();
  const item = queue.find((entry) => entry.hostId === normalizedHostId);
  if (!item) {
    return {
      ok: false,
      code: "not_eligible",
      message: "Host is not in onboarding queue",
    };
  }

  if (!item.email) {
    return {
      ok: false,
      code: "missing_email",
      message: "Host owner has no email address",
    };
  }

  if (!item.emailNotificationsEnabled) {
    return {
      ok: false,
      code: "notifications_opted_out",
      message: "Host owner has email notifications turned off",
    };
  }

  const sent = await emailService.sendParkingPassCompletionReminder({
    email: item.email,
    businessName: item.businessName || "Your location",
    address: item.address || "",
  });

  if (!sent) {
    return {
      ok: false,
      code: "send_failed",
      message: "Reminder email failed to send",
    };
  }

  return {
    ok: true,
    code: "sent",
    message: "Reminder sent",
    host: {
      hostId: item.hostId,
      businessName: item.businessName,
      email: item.email,
      needsPricing: item.needsPricing,
      pricingSource: item.pricingSource,
      needsStripe: item.needsStripe,
      priority: item.priority,
    },
  };
}

export async function remindIncompleteParkingPassHosts() {
  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip("parking pass completion reminders", hours);
    return {
      sent: 0,
      skipped: 0,
      eligible: 0,
      pricingIncomplete: 0,
      stripeIncomplete: 0,
      deferred: true,
      reason: hours.reason,
    };
  }

  if (!isEmailConfigured()) {
    console.warn("[parking-pass] Email not configured; skipping reminders");
    return { sent: 0, skipped: 0, eligible: 0 };
  }

  const queue = await buildOnboardingQueueInternal();
  if (queue.length === 0) {
    return {
      sent: 0,
      skipped: 0,
      eligible: 0,
      pricingIncomplete: 0,
      stripeIncomplete: 0,
    };
  }

  let sent = 0;
  let skipped = 0;
  let eligible = 0;
  const pricingIncomplete = queue.filter((item) => item.needsPricing).length;
  const stripeIncomplete = queue.filter((item) => item.needsStripe).length;

  for (const item of queue) {
    if (!item.email || !item.emailNotificationsEnabled) {
      skipped += 1;
      continue;
    }

    eligible += 1;
    const ok = await emailService.sendParkingPassCompletionReminder({
      email: item.email,
      businessName: item.businessName || "Your location",
      address: item.address || "",
    });
    if (ok) {
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    sent,
    skipped,
    eligible,
    pricingIncomplete,
    stripeIncomplete,
  };
}
