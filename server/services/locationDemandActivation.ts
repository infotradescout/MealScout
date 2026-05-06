import { db } from "../db";
import { emailService } from "../emailService";
import { sendSms } from "../smsService";
import { emailSequenceSends } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from "../utils/reminderBusinessHours";

const SEQUENCE_PREFIX = "location_demand_activation_v1";
const MAX_SENDS_PER_RUN = 100;

type CandidateRow = {
  request_id: string;
  posted_by_user_id: string;
  business_name: string;
  address: string;
  min_interested_trucks: number;
  threshold_reached_at: Date | null;
  created_at: Date;
  email: string | null;
  first_name: string | null;
  phone: string | null;
};

function baseUrl(): string {
  return String(process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(
    /\/+$/,
    "",
  );
}

function sequenceFor(requestId: string): string {
  return `${SEQUENCE_PREFIX}:${requestId}`;
}

async function alreadySent(userId: string, requestId: string, step: number): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSequenceSends.id })
    .from(emailSequenceSends)
    .where(
      and(
        eq(emailSequenceSends.userId, userId),
        eq(emailSequenceSends.sequence, sequenceFor(requestId)),
        eq(emailSequenceSends.step, step),
      ),
    )
    .limit(1);
  return Boolean(row?.id);
}

async function markSent(params: {
  userId: string;
  requestId: string;
  step: number;
  channels: string[];
}) {
  await db
    .insert(emailSequenceSends)
    .values({
      userId: params.userId,
      sequence: sequenceFor(params.requestId),
      step: params.step,
      metadata: {
        sentBy: "location_demand_activation_cron",
        channels: params.channels,
      },
    } as any)
    .onConflictDoNothing();
}

function selectDueStep(thresholdReachedAt: Date | null, createdAt: Date): number | null {
  const reachedAt = thresholdReachedAt || createdAt;
  const elapsedMs = Date.now() - reachedAt.getTime();
  const hours = elapsedMs / (60 * 60 * 1000);
  if (hours >= 72) return 3;
  if (hours >= 24) return 2;
  if (hours >= 0) return 1;
  return null;
}

function subjectFor(step: number, businessName: string): string {
  if (step === 1) return `${businessName} hit demand threshold - publish paid slots now`;
  if (step === 2) return `${businessName} is waiting on you - trucks are ready to book`;
  return `Final reminder: activate ${businessName} in MealScout`;
}

function htmlFor(params: {
  step: number;
  firstName: string | null;
  businessName: string;
  address: string;
  minInterestedTrucks: number;
}): string {
  const cta = `${baseUrl()}/parking-pass#parking-pass-settings`;
  const name = params.firstName || "there";
  const urgency =
    params.step === 1
      ? "Your location just reached the demand threshold."
      : params.step === 2
        ? "Trucks are still waiting for your first slot to open."
        : "Demand is ready now. Publish today to avoid losing interested trucks.";

  return `
    <p>Hi ${name},</p>
    <p>${urgency}</p>
    <p><strong>Location:</strong> ${params.businessName}<br/>
    <strong>Address:</strong> ${params.address}<br/>
    <strong>Interested trucks required:</strong> ${params.minInterestedTrucks}+</p>
    <p><a href="${cta}">Publish your paid parking-pass slots</a></p>
    <p>Once published, trucks can immediately book and pay.</p>
  `;
}

function smsFor(params: { step: number; businessName: string }): string {
  const cta = `${baseUrl()}/parking-pass`;
  if (params.step === 2) {
    return `MealScout: ${params.businessName} has trucks waiting. Publish slots now: ${cta}`;
  }
  return `MealScout final reminder: activate ${params.businessName} so trucks can book: ${cta}`;
}

export async function runLocationDemandActivationCron(opts?: { limit?: number }) {
  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip("location demand activation reminders", hours);
    return {
      ok: true,
      candidates: 0,
      sent: 0,
      emailSent: 0,
      smsSent: 0,
      skippedNoChannel: 0,
      deferred: true,
      reason: hours.reason,
      checkedAt: new Date().toISOString(),
    };
  }

  const limitRaw = Number(opts?.limit ?? process.env.LOCATION_DEMAND_ACTIVATION_LIMIT ?? 150);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 150;

  const rows = (await db.execute(sql`
    select
      lr.id as request_id,
      lr.posted_by_user_id,
      lr.business_name,
      lr.address,
      lr.min_interested_trucks,
      lr.threshold_reached_at,
      lr.created_at,
      u.email,
      u.first_name,
      u.phone
    from location_requests lr
    inner join users u on u.id = lr.posted_by_user_id
    where lr.status = 'open'
      and lr.demand_status = 'threshold_met'
      and coalesce(u.is_disabled, false) = false
      and not exists (
        select 1
        from host_location_claims hc
        where hc.location_request_id = lr.id
      )
    order by coalesce(lr.threshold_reached_at, lr.created_at) asc
    limit ${limit}
  `)) as { rows?: CandidateRow[] };

  let candidates = 0;
  let sent = 0;
  let emailSent = 0;
  let smsSent = 0;
  let skippedNoChannel = 0;

  for (const row of rows.rows || []) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    candidates += 1;
    const userId = String(row.posted_by_user_id || "");
    if (!userId) continue;

    const maxDueStep = selectDueStep(row.threshold_reached_at, row.created_at);
    if (!maxDueStep) continue;

    let stepToSend: number | null = null;
    for (let step = 1; step <= maxDueStep; step += 1) {
      if (!(await alreadySent(userId, row.request_id, step))) {
        stepToSend = step;
        break;
      }
    }
    if (!stepToSend) continue;

    const channels: string[] = [];
    const email = String(row.email || "").trim();
    if (email) {
      const ok = await emailService.sendBasicEmail(
        email,
        subjectFor(stepToSend, row.business_name),
        htmlFor({
          step: stepToSend,
          firstName: row.first_name,
          businessName: row.business_name,
          address: row.address,
          minInterestedTrucks: Number(row.min_interested_trucks || 0),
        }),
        undefined,
        "general",
      );
      if (ok) {
        channels.push("email");
        emailSent += 1;
      }
    }

    const smsEnabled = String(process.env.LOCATION_DEMAND_ACTIVATION_SMS || "")
      .trim()
      .toLowerCase() === "true";
    const phone = String(row.phone || "").trim();
    if (smsEnabled && stepToSend >= 2 && phone) {
      const ok = await sendSms(
        phone,
        smsFor({ step: stepToSend, businessName: row.business_name }),
      );
      if (ok) {
        channels.push("sms");
        smsSent += 1;
      }
    }

    if (channels.length === 0) {
      skippedNoChannel += 1;
      continue;
    }

    await markSent({
      userId,
      requestId: row.request_id,
      step: stepToSend,
      channels,
    });
    sent += 1;
  }

  return {
    ok: true,
    candidates,
    sent,
    emailSent,
    smsSent,
    skippedNoChannel,
    checkedAt: new Date().toISOString(),
  };
}

export async function getLocationDemandFunnelKpis() {
  const summaryRes = await db.execute(sql`
    with request_claim_host as (
      select
        hc.location_request_id,
        min(hc.created_at) as first_claim_at,
        max(hc.host_id) filter (where hc.host_id is not null) as host_id
      from host_location_claims hc
      group by hc.location_request_id
    ),
    req as (
      select
        lr.id,
        lr.status,
        lr.demand_status,
        lr.created_at,
        lr.threshold_reached_at,
        rch.first_claim_at,
        rch.host_id
      from location_requests lr
      left join request_claim_host rch on rch.location_request_id = lr.id
    ),
    published_hosts as (
      select distinct es.host_id
      from event_series es
      where es.series_type = 'parking_pass'
        and es.status in ('active', 'draft')
    ),
    booked_hosts as (
      select distinct e.host_id
      from events e
      inner join event_bookings b on b.event_id = e.id
      where b.status = 'confirmed'
    )
    select
      count(*)::int as total_requests,
      count(*) filter (where demand_status = 'collecting' and status = 'open')::int as collecting_open,
      count(*) filter (where demand_status = 'threshold_met' and status = 'open')::int as threshold_met_open,
      count(*) filter (
        where demand_status = 'threshold_met'
          and status = 'open'
          and coalesce(threshold_reached_at, created_at) < now() - interval '24 hours'
      )::int as threshold_met_stuck_24h,
      count(*) filter (
        where demand_status = 'threshold_met'
          and status = 'open'
          and coalesce(threshold_reached_at, created_at) < now() - interval '72 hours'
      )::int as threshold_met_stuck_72h,
      count(*) filter (
        where demand_status in ('claimed', 'fulfilled') or first_claim_at is not null
      )::int as claimed_total,
      count(*) filter (
        where first_claim_at is not null
          and threshold_reached_at is not null
          and first_claim_at <= threshold_reached_at + interval '24 hours'
      )::int as claimed_within_24h,
      count(*) filter (
        where host_id is not null
          and host_id in (select host_id from published_hosts)
      )::int as claimed_with_published_slots,
      count(*) filter (
        where host_id is not null
          and host_id in (select host_id from booked_hosts)
      )::int as claimed_with_confirmed_booking,
      count(*) filter (
        where threshold_reached_at >= now() - interval '7 days'
      )::int as threshold_met_last_7d
    from req
  `);

  const summary = (summaryRes as any)?.rows?.[0] || {};
  const thresholdMetOpen = Number(summary.threshold_met_open || 0);
  const claimedTotal = Number(summary.claimed_total || 0);
  const published = Number(summary.claimed_with_published_slots || 0);
  const booked = Number(summary.claimed_with_confirmed_booking || 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      claimRateFromThresholdOpen:
        thresholdMetOpen > 0 ? Number((claimedTotal / thresholdMetOpen).toFixed(4)) : 0,
      publishRateFromClaimed:
        claimedTotal > 0 ? Number((published / claimedTotal).toFixed(4)) : 0,
      bookingRateFromClaimed:
        claimedTotal > 0 ? Number((booked / claimedTotal).toFixed(4)) : 0,
    },
  };
}
