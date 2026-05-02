import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  restaurants,
  menus,
  menuItems,
  telemetryEvents,
} from "@shared/schema";
import { emailService, isEmailConfigured } from "../emailService";

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  process.env.EMAIL_FROM ||
  "info.mealscout@gmail.com";

type CandidateOwner = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date | null;
  userType: string | null;
};

type OwnerAlertRow = {
  owner: CandidateOwner;
  restaurantCount: number;
  activeVerifiedCount: number;
  menuCount: number;
  itemCount: number;
  blockers: string[];
};

function ownerName(owner: CandidateOwner): string {
  const full = [owner.firstName, owner.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || owner.email || "(unknown owner)";
}

function ageHours(createdAt: Date | null): number {
  if (!createdAt) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - createdAt.getTime()) / (60 * 60 * 1000)),
  );
}

async function alreadyAlerted(userId: string): Promise<boolean> {
  const existing = await db.query.telemetryEvents.findFirst({
    where: and(
      eq(telemetryEvents.eventName, "owner_not_discoverable_alert_sent"),
      eq(telemetryEvents.userId, userId),
    ),
  });
  return Boolean(existing);
}

function computeBlockers(row: {
  restaurantCount: number;
  activeVerifiedCount: number;
  menuCount: number;
  itemCount: number;
}): string[] {
  const blockers: string[] = [];
  if (row.restaurantCount === 0) blockers.push("no_business");
  if (row.activeVerifiedCount === 0) blockers.push("inactive_or_unverified");
  if (row.menuCount === 0) blockers.push("no_menu");
  if (row.itemCount === 0) blockers.push("no_items");
  return blockers;
}

async function gatherCandidates(): Promise<OwnerAlertRow[]> {
  const thresholdHours = Math.max(
    1,
    Number(process.env.OWNER_DISCOVERABILITY_THRESHOLD_HOURS || 6),
  );
  const lookbackDays = Math.max(
    1,
    Number(process.env.OWNER_DISCOVERABILITY_LOOKBACK_DAYS || 14),
  );

  const now = new Date();
  const thresholdCutoff = new Date(
    now.getTime() - thresholdHours * 60 * 60 * 1000,
  );
  const lookbackCutoff = new Date(
    now.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
  );

  const candidateOwners = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      createdAt: users.createdAt,
      userType: users.userType,
    })
    .from(users)
    .where(
      and(
        gte(users.createdAt, lookbackCutoff),
        lt(users.createdAt, thresholdCutoff),
        sql`${users.userType} IN ('restaurant_owner','food_truck')`,
      ),
    );

  if (candidateOwners.length === 0) return [];

  const ownerIds = candidateOwners.map((o: CandidateOwner) => o.id);
  const ownedRestaurants = await db
    .select({
      id: restaurants.id,
      ownerId: restaurants.ownerId,
      isActive: restaurants.isActive,
      isVerified: restaurants.isVerified,
    })
    .from(restaurants)
    .where(inArray(restaurants.ownerId, ownerIds));

  const restByOwner = new Map<
    string,
    Array<{ id: string; isActive: boolean | null; isVerified: boolean | null }>
  >();
  for (const r of ownedRestaurants) {
    const k = String(r.ownerId || "");
    const arr = restByOwner.get(k) || [];
    arr.push({ id: r.id, isActive: r.isActive, isVerified: r.isVerified });
    restByOwner.set(k, arr);
  }

  const allRestaurantIds = ownedRestaurants.map(
    (r: {
      id: string;
      ownerId: string | null;
      isActive: boolean | null;
      isVerified: boolean | null;
    }) => r.id,
  );
  let menuRows: Array<{ id: string; restaurantId: string | null }> = [];
  let itemRows: Array<{ menuId: string | null; count: number }> = [];
  if (allRestaurantIds.length > 0) {
    try {
      menuRows = await db
        .select({ id: menus.id, restaurantId: menus.restaurantId })
        .from(menus)
        .where(inArray(menus.restaurantId, allRestaurantIds));

      const allMenuIds = menuRows.map(
        (m: { id: string; restaurantId: string | null }) => m.id,
      );
      itemRows = allMenuIds.length
        ? await db
            .select({
              menuId: menuItems.menuId,
              count: sql<number>`COUNT(*)::int`,
            })
            .from(menuItems)
            .where(inArray(menuItems.menuId, allMenuIds))
            .groupBy(menuItems.menuId)
        : [];
    } catch (error) {
      console.warn(
        "[owner-discoverability-alerts] menu tables unavailable; using zero counts",
        error,
      );
      menuRows = [];
      itemRows = [];
    }
  }

  const menusByRestaurant = new Map<string, string[]>();
  for (const m of menuRows) {
    const k = String(m.restaurantId || "");
    const arr = menusByRestaurant.get(k) || [];
    arr.push(m.id);
    menusByRestaurant.set(k, arr);
  }

  const itemsByMenu = new Map<string, number>();
  for (const it of itemRows) {
    itemsByMenu.set(String(it.menuId || ""), Number(it.count || 0));
  }

  const rows: OwnerAlertRow[] = [];
  for (const owner of candidateOwners) {
    const rests = restByOwner.get(owner.id) || [];
    const restaurantCount = rests.length;
    const activeVerifiedRestaurants = rests.filter(
      (r) => Boolean(r.isActive) && Boolean(r.isVerified),
    );

    let menuCount = 0;
    let itemCount = 0;
    for (const r of activeVerifiedRestaurants) {
      const mids = menusByRestaurant.get(r.id) || [];
      menuCount += mids.length;
      for (const mid of mids) {
        itemCount += Number(itemsByMenu.get(mid) || 0);
      }
    }

    const blockers = computeBlockers({
      restaurantCount,
      activeVerifiedCount: activeVerifiedRestaurants.length,
      menuCount,
      itemCount,
    });

    if (blockers.length > 0) {
      rows.push({
        owner,
        restaurantCount,
        activeVerifiedCount: activeVerifiedRestaurants.length,
        menuCount,
        itemCount,
        blockers,
      });
    }
  }

  return rows;
}

function renderHtml(rows: OwnerAlertRow[], baseUrl: string): string {
  const list = rows
    .map((r) => {
      const created = r.owner.createdAt
        ? new Date(r.owner.createdAt).toLocaleString()
        : "unknown";
      return `<li style="margin-bottom:10px;">
        <strong>${ownerName(r.owner)}</strong> (${String(r.owner.userType || "owner")})<br/>
        <span style="color:#6b7280;">${r.owner.email || "no email"} • signed up ${created} (${ageHours(r.owner.createdAt)}h ago)</span><br/>
        <span>Blockers: ${r.blockers.join(", ")}</span>
      </li>`;
    })
    .join("\n");

  return `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#1f2937;">
      <h2 style="margin:0 0 8px;">Launch Alert: owners stuck past 6h</h2>
      <p style="margin:0 0 12px;">${rows.length} owner(s) are still not discoverable.</p>
      <ol>${list}</ol>
      <p style="margin-top:16px;">
        <a href="${baseUrl}/admin/launch-week" style="background:#f97316;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;display:inline-block;">Open Launch Week triage</a>
      </p>
    </div>
  `;
}

function renderText(rows: OwnerAlertRow[], baseUrl: string): string {
  return [
    `Launch Alert: owners stuck past 6h`,
    `${rows.length} owner(s) still not discoverable`,
    "",
    ...rows.map(
      (r) =>
        `- ${ownerName(r.owner)} (${r.owner.email || "no email"}) :: blockers=${r.blockers.join(",")} :: age=${ageHours(r.owner.createdAt)}h`,
    ),
    "",
    `Triage: ${baseUrl}/admin/launch-week`,
  ].join("\n");
}

export async function sendOwnerDiscoverabilityAlerts(): Promise<{
  sent: boolean;
  reason?: string;
  considered: number;
  alerted: number;
}> {
  if (
    String(
      process.env.OWNER_DISCOVERABILITY_ALERTS_ENABLED || "true",
    ).toLowerCase() === "false"
  ) {
    return { sent: false, reason: "disabled", considered: 0, alerted: 0 };
  }
  if (!isEmailConfigured()) {
    return {
      sent: false,
      reason: "email_not_configured",
      considered: 0,
      alerted: 0,
    };
  }

  const rows = await gatherCandidates();
  if (rows.length === 0) {
    return { sent: false, reason: "no_candidates", considered: 0, alerted: 0 };
  }

  const alertRows: OwnerAlertRow[] = [];
  for (const row of rows) {
    const wasAlerted = await alreadyAlerted(row.owner.id);
    if (!wasAlerted) alertRows.push(row);
  }

  if (alertRows.length === 0) {
    return {
      sent: false,
      reason: "already_alerted",
      considered: rows.length,
      alerted: 0,
    };
  }

  const baseUrl = (
    process.env.PUBLIC_BASE_URL || "https://mealscout.us"
  ).replace(/\/+$/, "");
  const subject = `MealScout launch alert: ${alertRows.length} owner${alertRows.length === 1 ? "" : "s"} stuck >6h`;
  const ok = await emailService.sendBasicEmail(
    ADMIN_EMAIL,
    subject,
    renderHtml(alertRows, baseUrl),
    renderText(alertRows, baseUrl),
    "general",
  );

  if (!ok) {
    return {
      sent: false,
      reason: "send_failed",
      considered: rows.length,
      alerted: 0,
    };
  }

  for (const row of alertRows) {
    await db.insert(telemetryEvents).values({
      eventName: "owner_not_discoverable_alert_sent",
      userId: row.owner.id,
      properties: {
        blockers: row.blockers,
        ageHours: ageHours(row.owner.createdAt),
      },
    });
  }

  return { sent: true, considered: rows.length, alerted: alertRows.length };
}
