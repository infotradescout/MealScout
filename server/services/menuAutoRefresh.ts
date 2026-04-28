/**
 * menuAutoRefresh.ts
 *
 * Periodic re-fetch of menus that were originally imported from a public URL
 * (DoorDash / UberEats / Yelp / Grubhub / Google / restaurant website).
 *
 * Strategy
 * - Pick menus with `import_url IS NOT NULL` that haven't been refreshed within
 *   `MENU_AUTO_REFRESH_STALE_DAYS` (default 7).
 * - For each, re-run the same SSRF-guarded fetch + extract pipeline used by the
 *   manual URL import endpoint.
 * - Upsert items by (menuId, lower(name)) — update price/description on hits,
 *   insert on misses. We never delete: owners may have curated items locally.
 * - Log each run to `menu_import_logs` with source `cron:url-refresh`.
 * - Bounded per-run (`MENU_AUTO_REFRESH_BATCH`) to keep cron tick lightweight.
 */

import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { menus, menuItems, menuImportLogs } from "@shared/schema";
import {
  MENU_URL_IMPORT_MAX_BYTES,
  computeImportStatus,
  extractMenuRowsFromHtml,
  fetchPublicMenuUrl,
  normalizeExternalMenuData,
  normalizeExternalSource,
  validatePublicImportUrl,
} from "../routes/menuRoutes";

const STALE_DAYS = Number(process.env.MENU_AUTO_REFRESH_STALE_DAYS || 7);
const BATCH = Number(process.env.MENU_AUTO_REFRESH_BATCH || 25);
const PER_HOST_DELAY_MS = Number(
  process.env.MENU_AUTO_REFRESH_PER_HOST_DELAY_MS || 4000,
);
const JITTER_MS = Number(process.env.MENU_AUTO_REFRESH_JITTER_MS || 1500);
const REFRESHABLE_SOURCES = new Set([
  "url",
  "doordash",
  "ubereats",
  "grubhub",
  "yelp",
  "google",
  "website",
]);

export interface MenuAutoRefreshSummary {
  scanned: number;
  refreshed: number;
  skipped: number;
  failed: number;
  totalItemsAdded: number;
  totalItemsUpdated: number;
}

export async function runMenuAutoRefreshCron(): Promise<MenuAutoRefreshSummary> {
  const summary: MenuAutoRefreshSummary = {
    scanned: 0,
    refreshed: 0,
    skipped: 0,
    failed: 0,
    totalItemsAdded: 0,
    totalItemsUpdated: 0,
  };

  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({
      id: menus.id,
      restaurantId: menus.restaurantId,
      importUrl: menus.importUrl,
      importSource: menus.importSource,
      importedAt: menus.importedAt,
    })
    .from(menus)
    .where(
      and(
        isNotNull(menus.importUrl),
        or(lt(menus.importedAt, cutoff), sql`${menus.importedAt} IS NULL`),
      ),
    )
    .limit(BATCH);

  summary.scanned = candidates.length;

  const lastHitByHost = new Map<string, number>();
  const sleep = (ms: number) =>
    new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

  for (const menu of candidates) {
    if (!menu.importUrl) {
      summary.skipped++;
      continue;
    }
    const sourceKey = String(menu.importSource || "url").toLowerCase();
    if (!REFRESHABLE_SOURCES.has(sourceKey)) {
      summary.skipped++;
      continue;
    }

    // Be neighborly: throttle per-host so we don't hammer DoorDash/UberEats.
    let host = "";
    try {
      host = new URL(menu.importUrl).hostname;
    } catch {
      host = "unknown";
    }
    const last = lastHitByHost.get(host) || 0;
    const sinceLast = Date.now() - last;
    if (sinceLast < PER_HOST_DELAY_MS) {
      await sleep(PER_HOST_DELAY_MS - sinceLast);
    }
    if (JITTER_MS > 0) {
      await sleep(Math.floor(Math.random() * JITTER_MS));
    }
    lastHitByHost.set(host, Date.now());

    try {
      const result = await refreshOneMenu(
        menu.id,
        menu.restaurantId,
        menu.importUrl,
        sourceKey,
      );
      summary.refreshed++;
      summary.totalItemsAdded += result.added;
      summary.totalItemsUpdated += result.updated;
    } catch (err: any) {
      summary.failed++;
      console.error(
        `[menu-auto-refresh] menu=${menu.id} url=${menu.importUrl} failed:`,
        err?.message || err,
      );
      try {
        await db.insert(menuImportLogs).values({
          restaurantId: menu.restaurantId,
          source: "cron:url-refresh" as any,
          fileName: menu.importUrl,
          itemsImported: 0,
          itemsSkipped: 0,
          errors: [{ row: 0, reason: String(err?.message || err) }] as any,
          status: "failed",
        });
      } catch {
        /* swallow log-write failure */
      }
    }
  }

  return summary;
}

async function refreshOneMenu(
  menuId: string,
  restaurantId: string,
  url: string,
  sourceKey: string,
): Promise<{ added: number; updated: number }> {
  const parsed = new URL(url);
  const validation = await validatePublicImportUrl(parsed);
  if (!validation.ok) {
    throw new Error(validation.message || "URL failed validation");
  }

  const resolvedSource = normalizeExternalSource(sourceKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let rawData: Record<string, any>[] = [];
  try {
    const response = await fetchPublicMenuUrl(parsed, controller.signal);
    if (!response.ok) {
      throw new Error(`Source returned ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MENU_URL_IMPORT_MAX_BYTES
    ) {
      throw new Error("Source response too large");
    }
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MENU_URL_IMPORT_MAX_BYTES) {
      throw new Error("Source response too large");
    }
    rawData = extractMenuRowsFromHtml(html);
  } finally {
    clearTimeout(timer);
  }

  if (rawData.length === 0) {
    await db.insert(menuImportLogs).values({
      restaurantId,
      source: "cron:url-refresh" as any,
      fileName: url,
      itemsImported: 0,
      itemsSkipped: 0,
      errors: [{ row: 0, reason: "No items extracted on refresh." }] as any,
      status: "failed",
    });
    return { added: 0, updated: 0 };
  }

  const { imported, skipped, errors } = normalizeExternalMenuData(
    rawData,
    resolvedSource,
    menuId,
    restaurantId,
  );

  // Existing items keyed by lower(name) for dedup
  const existing = await db
    .select({ id: menuItems.id, name: menuItems.name, priceCents: menuItems.priceCents })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId));
  const byName = new Map<string, { id: string; priceCents: number }>();
  for (const row of existing) {
    byName.set(row.name.trim().toLowerCase(), {
      id: row.id,
      priceCents: row.priceCents,
    });
  }

  let added = 0;
  let updated = 0;
  const toInsert: typeof imported = [];

  for (const it of imported) {
    const key = it.name.trim().toLowerCase();
    const hit = byName.get(key);
    if (hit) {
      if (hit.priceCents !== it.priceCents || it.description) {
        await db
          .update(menuItems)
          .set({
            priceCents: it.priceCents,
            ...(it.description ? { description: it.description } : {}),
            updatedAt: new Date(),
          })
          .where(eq(menuItems.id, hit.id));
        updated++;
      }
    } else {
      toInsert.push(it);
    }
  }
  if (toInsert.length > 0) {
    await db.insert(menuItems).values(toInsert);
    added = toInsert.length;
  }

  await db
    .update(menus)
    .set({
      importedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(menus.id, menuId));

  await db.insert(menuImportLogs).values({
    restaurantId,
    source: "cron:url-refresh" as any,
    fileName: url,
    itemsImported: added,
    itemsSkipped: skipped + updated,
    errors: errors as any,
    status: computeImportStatus(added + updated, errors.length),
  });

  return { added, updated };
}
