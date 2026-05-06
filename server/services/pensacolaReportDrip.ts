import { db } from "../db";
import { emailService } from "../emailService";
import {
  pensacolaReportLeads,
  reportLeadSequenceSends,
} from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from "../utils/reminderBusinessHours";

const SEQUENCE = "pensacola_report_v1";

function envEnabled(name: string): boolean {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function publicBaseUrl(): string {
  return String(process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(
    /\/+$/,
    "",
  );
}

async function alreadySent(leadId: string, step: number): Promise<boolean> {
  const [row] = await db
    .select({ id: reportLeadSequenceSends.id })
    .from(reportLeadSequenceSends)
    .where(
      and(
        eq(reportLeadSequenceSends.leadId, leadId),
        eq(reportLeadSequenceSends.sequence, SEQUENCE),
        eq(reportLeadSequenceSends.step, step),
      ),
    )
    .limit(1);
  return Boolean(row?.id);
}

async function markSent(leadId: string, step: number, metadata?: any) {
  await db
    .insert(reportLeadSequenceSends)
    .values({
      leadId,
      sequence: SEQUENCE,
      step,
      metadata: metadata ?? null,
    } as any)
    .onConflictDoNothing();
}

function subjectForStep(step: number): string {
  switch (step) {
    case 2:
      return "See Pensacola spots live (availability + booking)";
    case 3:
      return "Premium is $25/mo — avoid dead nights";
    default:
      return "MealScout";
  }
}

function htmlForStep(params: { step: number; lead: any }): string {
  const base = publicBaseUrl();
  const spotsUrl = `${base}/pensacola/spots`;
  const signupUrl = `${base}/restaurant-signup?redirect=${encodeURIComponent(
    "/pensacola/spots",
  )}`;
  const subscribeUrl = `${base}/subscribe`;
  const name = params.lead?.firstName || "there";

  const wrap = (body: string) => `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <div style="max-width: 640px; margin: 0 auto; padding: 24px;">
          ${body}
          <p style="margin-top: 24px; color:#6b7280; font-size: 12px;">
            MealScout · Pensacola · Reply to unsubscribe
          </p>
        </div>
      </body>
    </html>
  `;

  if (params.step === 2) {
    return wrap(`
      <h2 style="margin: 0 0 12px 0;">Hi ${name} — want the live version?</h2>
      <p style="margin: 0 0 12px 0;">
        The report is the high-level view. The live inventory is here:
        <a href="${spotsUrl}">${spotsUrl}</a>
      </p>
      <p style="margin: 0;">
        No account yet? Create a free one to unlock exact addresses and booking:
        <a href="${signupUrl}">${signupUrl}</a>
      </p>
    `);
  }

  if (params.step === 3) {
    return wrap(`
      <h2 style="margin: 0 0 12px 0;">Premium is $25/month</h2>
      <p style="margin: 0 0 12px 0;">
        It’s less than the cost of one bad night, and it unlocks:
      </p>
      <ul style="margin: 0 0 16px 20px;">
        <li>Live GPS button (instant map presence)</li>
        <li>Editable schedule + booking calendar view</li>
        <li>Faster booking workflow</li>
      </ul>
      <p style="margin: 0;">
        Upgrade here: <a href="${subscribeUrl}">${subscribeUrl}</a>
      </p>
    `);
  }

  return wrap(`<p>MealScout</p>`);
}

export async function runPensacolaReportLeadDripCron() {
  if (!envEnabled("PENSACOLA_REPORT_ENABLED")) return { ok: true, sent: 0 };
  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip("Pensacola report lead drip", hours);
    return { ok: true, sent: 0, deferred: true, reason: hours.reason };
  }

  const lookbackDaysRaw = Number(process.env.PENSACOLA_REPORT_LOOKBACK_DAYS ?? 30);
  const lookbackDays = Number.isFinite(lookbackDaysRaw)
    ? Math.max(1, Math.min(Math.floor(lookbackDaysRaw), 180))
    : 30;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      lead: pensacolaReportLeads,
      step1SentAt: sql<Date | null>`(
        select min(sent_at) from report_lead_sequence_sends s
        where s.lead_id = ${pensacolaReportLeads.id}
          and s.sequence = ${SEQUENCE}
          and s.step = 1
      )`,
    })
    .from(pensacolaReportLeads)
    .where(gte(pensacolaReportLeads.createdAt, cutoff))
    .orderBy(desc(pensacolaReportLeads.createdAt))
    .limit(300);

  const delayByStepDays: Record<number, number> = { 2: 1, 3: 3 };
  const MAX_SENDS_PER_RUN = 50;
  let sent = 0;

  for (const row of rows) {
    if (sent >= MAX_SENDS_PER_RUN) break;
    const lead: any = row.lead;
    const step1SentAt = row.step1SentAt ? new Date(row.step1SentAt) : null;
    if (!lead?.id || !lead?.email) continue;
    if (!step1SentAt) continue;

    for (const step of [2, 3]) {
      if (sent >= MAX_SENDS_PER_RUN) break;
      if (await alreadySent(lead.id, step)) continue;
      const dueAt = new Date(
        step1SentAt.getTime() + delayByStepDays[step] * 24 * 60 * 60 * 1000,
      );
      if (Date.now() < dueAt.getTime()) continue;

      await emailService.sendBasicEmail(
        String(lead.email),
        subjectForStep(step),
        htmlForStep({ step, lead }),
      );
      await markSent(lead.id, step, { kind: "lead", leadId: lead.id });
      sent += 1;
      break;
    }
  }

  return { ok: true, sent };
}
