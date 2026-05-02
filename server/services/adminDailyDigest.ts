/**
 * adminDailyDigest
 *
 * Sends a morning operations digest to ADMIN_EMAIL with key launch-week
 * metrics so the operator doesn't have to remember to check the dashboard.
 *
 * Triggered by cron from registerSchedulers.ts.
 */

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  restaurants,
  menus,
  menuItems,
  menuImportLogs,
} from "@shared/schema";
import { emailService, isEmailConfigured } from "../emailService";

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  process.env.EMAIL_FROM ||
  "info.mealscout@gmail.com";

interface DigestSnapshot {
  windowHours: number;
  generatedAt: string;
  newOwners: number;
  newRestaurants: number;
  newMenus: number;
  newItems: number;
  importsAttempted: number;
  importsFailed: number;
  totalStuck: number;
  pendingVerification: number;
  unverifiedEmails: number;
}

export async function buildAdminDigestSnapshot(
  windowHours = 24,
): Promise<DigestSnapshot> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const stuckCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  // New business owners (last N hours)
  const newOwnerRows = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(
      and(
        gte(users.createdAt, cutoff),
        sql`${users.userType} IN ('restaurant_owner','food_truck')`,
      ),
    );
  const newOwners = newOwnerRows.length;
  const unverifiedEmails = newOwnerRows.filter(
    (r: { emailVerified: boolean | null }) => !r.emailVerified,
  ).length;

  // New restaurants
  const [{ count: newRestaurantCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(restaurants)
    .where(gte(restaurants.createdAt, cutoff));

  let newMenuCount = 0;
  let newItemCount = 0;
  let importsAttempted = 0;
  let importsFailed = 0;
  try {
    // New menus
    const [menuMetric] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(menus)
      .where(gte(menus.createdAt, cutoff));
    newMenuCount = Number(menuMetric?.count || 0);

    // New items
    const [itemMetric] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(menuItems)
      .where(gte(menuItems.createdAt, cutoff));
    newItemCount = Number(itemMetric?.count || 0);

    // Imports attempted / failed (failed = itemsImported = 0)
    const importRows = await db
      .select({
        itemsImported: menuImportLogs.itemsImported,
      })
      .from(menuImportLogs)
      .where(gte(menuImportLogs.createdAt, cutoff));
    importsAttempted = importRows.length;
    importsFailed = importRows.filter(
      (r: { itemsImported: number | null }) =>
        Number(r.itemsImported || 0) === 0,
    ).length;
  } catch (error) {
    console.warn(
      "[admin-daily-digest] menu tables unavailable; using zero menu/import counts",
      error,
    );
  }

  // Stuck owners (signed up >6h ago, no verified active restaurant — we
  // approximate by: business-type users who have no restaurant at all yet).
  const stuckRows = await db
    .select({ id: users.id })
    .from(users)
    .leftJoin(restaurants, eq(restaurants.ownerId, users.id))
    .where(
      and(
        sql`${users.userType} IN ('restaurant_owner','food_truck')`,
        gte(users.createdAt, cutoff),
        sql`${users.createdAt} < ${stuckCutoff}`,
        isNull(restaurants.id),
      ),
    );
  const totalStuck = stuckRows.length;

  // Pending admin verification
  const [{ count: pendingVerificationCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(restaurants)
    .where(eq(restaurants.isVerified, false));

  return {
    windowHours,
    generatedAt: now.toISOString(),
    newOwners,
    newRestaurants: Number(newRestaurantCount || 0),
    newMenus: newMenuCount,
    newItems: newItemCount,
    importsAttempted,
    importsFailed,
    totalStuck,
    pendingVerification: Number(pendingVerificationCount || 0),
    unverifiedEmails,
  };
}

function renderDigestHtml(snap: DigestSnapshot, baseUrl: string): string {
  const dashUrl = `${baseUrl}/admin/launch-week`;
  const successRate =
    snap.importsAttempted > 0
      ? Math.round(
          ((snap.importsAttempted - snap.importsFailed) /
            snap.importsAttempted) *
            100,
        )
      : null;
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 640px;">
      <h2 style="margin-bottom:4px;">MealScout — last ${snap.windowHours}h</h2>
      <p style="color:#6b7280; margin-top:0; font-size:13px;">
        Generated ${new Date(snap.generatedAt).toLocaleString()}
      </p>

      <table style="width:100%; border-collapse:collapse; margin:16px 0;">
        <tr>
          <td style="padding:10px; border:1px solid #e5e7eb; background:#f9fafb;">
            <div style="font-size:12px; color:#6b7280;">New owners</div>
            <div style="font-size:22px; font-weight:bold;">${snap.newOwners}</div>
            <div style="font-size:11px; color:#6b7280;">${snap.unverifiedEmails} unverified</div>
          </td>
          <td style="padding:10px; border:1px solid #e5e7eb; background:#f9fafb;">
            <div style="font-size:12px; color:#6b7280;">Stuck (no business)</div>
            <div style="font-size:22px; font-weight:bold; color:${snap.totalStuck > 0 ? "#ea580c" : "#1f2937"};">${snap.totalStuck}</div>
            <div style="font-size:11px; color:#6b7280;">need a nudge</div>
          </td>
        </tr>
        <tr>
          <td style="padding:10px; border:1px solid #e5e7eb;">
            <div style="font-size:12px; color:#6b7280;">New restaurants</div>
            <div style="font-size:22px; font-weight:bold;">${snap.newRestaurants}</div>
          </td>
          <td style="padding:10px; border:1px solid #e5e7eb;">
            <div style="font-size:12px; color:#6b7280;">New menus / items</div>
            <div style="font-size:22px; font-weight:bold;">${snap.newMenus} / ${snap.newItems}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:10px; border:1px solid #e5e7eb; background:#f9fafb;">
            <div style="font-size:12px; color:#6b7280;">Menu imports</div>
            <div style="font-size:22px; font-weight:bold;">${snap.importsAttempted}</div>
            <div style="font-size:11px; color:${snap.importsFailed > 0 ? "#dc2626" : "#6b7280"};">
              ${snap.importsFailed} failed${successRate !== null ? ` (${successRate}% success)` : ""}
            </div>
          </td>
          <td style="padding:10px; border:1px solid #e5e7eb; background:#f9fafb;">
            <div style="font-size:12px; color:#6b7280;">Awaiting your verification</div>
            <div style="font-size:22px; font-weight:bold;">${snap.pendingVerification}</div>
          </td>
        </tr>
      </table>

      <p style="margin: 16px 0;">
        <a href="${dashUrl}" style="background:#f97316;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block;">
          Open Launch Week dashboard
        </a>
      </p>
      <p style="font-size:12px; color:#6b7280;">
        You're receiving this because you're an admin. Reply to this email to disable.
      </p>
    </div>
  `;
}

function renderDigestText(snap: DigestSnapshot, baseUrl: string): string {
  return [
    `MealScout — last ${snap.windowHours}h`,
    ``,
    `New owners: ${snap.newOwners} (${snap.unverifiedEmails} unverified email)`,
    `Stuck (no business yet): ${snap.totalStuck}`,
    `New restaurants: ${snap.newRestaurants}`,
    `New menus: ${snap.newMenus}`,
    `New items: ${snap.newItems}`,
    `Menu imports: ${snap.importsAttempted} attempted, ${snap.importsFailed} failed`,
    `Awaiting verification: ${snap.pendingVerification}`,
    ``,
    `Dashboard: ${baseUrl}/admin/launch-week`,
  ].join("\n");
}

export async function sendAdminDailyDigest(): Promise<{
  sent: boolean;
  reason?: string;
  snapshot?: DigestSnapshot;
}> {
  if (!isEmailConfigured()) {
    return { sent: false, reason: "email_not_configured" };
  }
  if (!ADMIN_EMAIL) {
    return { sent: false, reason: "no_admin_email" };
  }
  const snapshot = await buildAdminDigestSnapshot(24);
  const baseUrl = (
    process.env.PUBLIC_BASE_URL || "https://mealscout.us"
  ).replace(/\/+$/, "");

  const subject = `MealScout daily — ${snapshot.newOwners} new owners${snapshot.totalStuck > 0 ? `, ${snapshot.totalStuck} stuck` : ""}`;
  const html = renderDigestHtml(snapshot, baseUrl);
  const text = renderDigestText(snapshot, baseUrl);

  const ok = await emailService.sendBasicEmail(
    ADMIN_EMAIL,
    subject,
    html,
    text,
    "general",
  );
  return { sent: ok, snapshot };
}
