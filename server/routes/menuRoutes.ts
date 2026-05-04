/**
 * menuRoutes.ts
 * Online Menu Management – CRUD for menus, categories, items, variants, modifiers
 * and menu import infrastructure (CSV, PDF, public menu URLs, POS adapters).
 *
 * All write endpoints require: isAuthenticated + business profile access.
 * Public read endpoints are unauthenticated (customer-facing menu view).
 *
 * Platform fee: $1 USD per order. Configurable per-menu via hidePlatformFee flag.
 */

import type { Express } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
import dns from "dns/promises";
import net from "net";
import { db } from "../db";
import {
  menus,
  menuCategories,
  menuItems,
  menuItemVariants,
  menuItemModifiers,
  menuImportLogs,
  restaurants,
  restaurantSubscriptions,
  users,
  insertMenuSchema,
  insertMenuCategorySchema,
  insertMenuItemSchema,
  insertMenuItemVariantSchema,
  insertMenuItemModifierSchema,
  LISA_CLAIM_TYPES,
  LISA_CLAIM_SOURCES,
  lisaClaims,
  type Menu,
  type MenuCategory,
  type MenuItem,
  type MenuItemVariant,
  type MenuItemModifier,
} from "@shared/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { storage } from "../storage";
import { parseMenuCsv } from "../utils/menuCsvParser";
import { parsePdfMenuWithAi } from "../utils/menuPdfParser";
import { uploadToCloudinary, isCloudinaryConfigured } from "../imageUpload";
import { distributedRateLimit } from "../middleware/distributedRateLimit";

const EXTERNAL_MENU_SOURCES = [
  "ubereats",
  "clover",
  "toast",
  "square",
  "gmb",
  "google",
  "grubhub",
  "yelp",
  "website",
] as const;

const MENU_SERVICE_TYPES = new Set([
  "all",
  "breakfast",
  "lunch",
  "dinner",
  "late_night",
  "weekend_brunch",
]);

export type ExternalMenuSource = (typeof EXTERNAL_MENU_SOURCES)[number];

export const MENU_URL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const MENU_URL_IMPORT_MAX_REDIRECTS = 5;
const MENU_URL_IMPORT_HEADERS = {
  "User-Agent": "MealScoutMenuImporter/1.0 (+https://www.mealscout.us)",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

// ── Multer config (memory storage – files processed in-process) ───────────────
// Anthropic Claude vision only accepts jpeg/png/gif/webp; HEIC/HEIF are rejected
// up-front so users get a clear error instead of a cryptic API failure.
const SUPPORTED_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB – modern phone photos can exceed 10 MB
  fileFilter(_req, file, cb) {
    const allowed = [".csv", ".pdf", ".json", ".xlsx", ".xls", ".tsv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    if (
      SUPPORTED_IMAGE_EXTS.includes(ext) ||
      SUPPORTED_IMAGE_MIMES.has(file.mimetype || "")
    ) {
      return cb(null, true);
    }
    if (ext === ".heic" || ext === ".heif" || file.mimetype === "image/heic" || file.mimetype === "image/heif") {
      return cb(
        new Error(
          "HEIC/HEIF photos are not supported. Please export as JPEG or PNG and try again.",
        ),
      );
    }
    cb(
      new Error(
        "Unsupported file type. Allowed: csv, pdf, json, xlsx, xls, jpg, jpeg, png, webp, gif.",
      ),
    );
  },
});

/**
 * Compute a meaningful audit-log status from import counts.
 * - "failed":   nothing imported, errors present
 * - "empty":    nothing imported, no errors (e.g., AI returned 0 items)
 * - "partial":  some imported, but errors also present
 * - "complete": fully successful
 */
export function computeImportStatus(
  importedCount: number,
  errorCount: number,
): "failed" | "empty" | "partial" | "complete" {
  if (importedCount === 0) return errorCount > 0 ? "failed" : "empty";
  return errorCount > 0 ? "partial" : "complete";
}

/**
 * Resolve a list of category names to category IDs for a given menu, creating
 * any that don't already exist. Used by AI menu importers that return a
 * `categoryName` per item. Returns a Map keyed by lowercase trimmed name.
 */
async function resolveCategoryIds(
  menuId: string,
  restaurantId: string,
  names: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(
      names
        .map((n) => (typeof n === "string" ? n.trim() : ""))
        .filter((n) => n.length > 0),
    ),
  );
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const existing = await db
    .select({ id: menuCategories.id, name: menuCategories.name })
    .from(menuCategories)
    .where(eq(menuCategories.menuId, menuId));
  for (const row of existing) {
    map.set(row.name.trim().toLowerCase(), row.id);
  }

  const toCreate = unique.filter((n) => !map.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    const baseSort = existing.length;
    const inserted = await db
      .insert(menuCategories)
      .values(
        toCreate.map((name, idx) => ({
          menuId,
          restaurantId,
          name,
          sortOrder: baseSort + idx,
        })),
      )
      .returning({ id: menuCategories.id, name: menuCategories.name });
    for (const row of inserted) {
      map.set(row.name.trim().toLowerCase(), row.id);
    }
  }
  return map;
}

// ── Ownership helper ──────────────────────────────────────────────────────────
async function assertOwnsRestaurant(
  userId: string,
  restaurantId: string,
  userType?: string,
) {
  if (["admin", "super_admin", "staff"].includes(String(userType || ""))) {
    return;
  }
  const ok = await storage.verifyRestaurantOwnership(
    restaurantId,
    userId,
    "manageProfile",
  );
  if (!ok)
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
}
async function assertOwnsMenu(userId: string, menuId: string, userType?: string) {
  const [menu] = await db.select().from(menus).where(eq(menus.id, menuId));
  if (!menu)
    throw Object.assign(new Error("Menu not found"), { statusCode: 404 });
  await assertOwnsRestaurant(userId, menu.restaurantId, userType);
  return menu;
}

async function assertOwnsMenuItem(
  userId: string,
  itemId: string,
  userType?: string,
) {
  const [item] = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!item)
    throw Object.assign(new Error("Item not found"), { statusCode: 404 });
  await assertOwnsRestaurant(userId, item.restaurantId, userType);
  return item;
}

async function loadFullMenusForRestaurant(
  restaurantId: string,
  options: { includeInactive?: boolean; menuId?: string } = {},
) {
  const filters = [eq(menus.restaurantId, restaurantId)];
  if (!options.includeInactive) {
    filters.push(eq(menus.isActive, true));
  }
  if (options.menuId) {
    filters.push(eq(menus.id, options.menuId));
  }

  const restaurantMenus: Menu[] = await db
    .select()
    .from(menus)
    .where(and(...filters))
    .orderBy(asc(menus.serviceType));

  if (restaurantMenus.length === 0) return [];

  const menuIds = restaurantMenus.map((m) => m.id);

  const [categories, items] = await Promise.all([
    db
      .select()
      .from(menuCategories)
      .where(
        and(
          inArray(menuCategories.menuId, menuIds),
          ...(options.includeInactive
            ? []
            : [eq(menuCategories.isActive, true)]),
        ),
      )
      .orderBy(asc(menuCategories.sortOrder)),
    db
      .select()
      .from(menuItems)
      .where(
        and(
          inArray(menuItems.menuId, menuIds),
          ...(options.includeInactive
            ? []
            : [eq(menuItems.isAvailable, true)]),
        ),
      )
      .orderBy(asc(menuItems.sortOrder)),
  ]);

  const typedCategories = categories as MenuCategory[];
  const typedItems = items as MenuItem[];
  const itemIds = typedItems.map((i) => i.id);
  const [realVariants, realModifiers]: [
    MenuItemVariant[],
    MenuItemModifier[],
  ] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuItemVariants)
          .where(inArray(menuItemVariants.menuItemId, itemIds))
          .orderBy(asc(menuItemVariants.sortOrder)),
        db
          .select()
          .from(menuItemModifiers)
          .where(inArray(menuItemModifiers.menuItemId, itemIds))
          .orderBy(asc(menuItemModifiers.sortOrder)),
      ])
    : [[], []];

  return restaurantMenus.map((menu) => {
    const menuCats = typedCategories.filter((c) => c.menuId === menu.id);
    const menuItemsList = typedItems.filter((i) => i.menuId === menu.id);

    const enrichedItems = menuItemsList.map((item) => ({
      ...item,
      variants: realVariants.filter((v) => v.menuItemId === item.id),
      modifiers: realModifiers.filter((m) => m.menuItemId === item.id),
    }));

    return {
      ...menu,
      categories: menuCats.map((cat) => ({
        ...cat,
        items: enrichedItems.filter((i) => i.categoryId === cat.id),
      })),
      uncategorizedItems: enrichedItems.filter((i) => !i.categoryId),
    };
  });
}

// ── Error wrapper ─────────────────────────────────────────────────────────────
function wrap(handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      const status = err?.statusCode || 500;
      const message = err?.message || "Internal server error";
      if (status === 500) console.error("[menuRoutes]", err);
      res.status(status).json(err?.payload || { message });
    }
  };
}

function isMissingRelationError(error: unknown, relationName: string): boolean {
  const code = String((error as any)?.code || "").toUpperCase();
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    code === "42P01" &&
    (message.includes(`relation \"${relationName}\" does not exist`) ||
      message.includes(`relation '${relationName}' does not exist`) ||
      message.includes(`${relationName} does not exist`))
  );
}

function normalizeMenuServiceType(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!normalized) return "all";

  const aliases: Record<string, string> = {
    all_day: "all",
    brunch: "weekend_brunch",
    happy_hour: "late_night",
    seasonal: "all",
  };

  const mapped = aliases[normalized] ?? normalized;
  return MENU_SERVICE_TYPES.has(mapped) ? mapped : "all";
}

export async function importMenuItemsFromPublicUrl({
  menu,
  menuId,
  userId,
  url,
  source,
}: {
  menu: Menu;
  menuId: string;
  userId: string;
  url: string;
  source: ExternalMenuSource;
}) {
  const parsed = new URL(url);
  const urlValidation = await validatePublicImportUrl(parsed);
  if (!urlValidation.ok) {
    throw Object.assign(new Error(urlValidation.message), { statusCode: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let rawData: Record<string, any>[] = [];
  try {
    const response = await fetchPublicMenuUrl(parsed, controller.signal);

    if (!response.ok) {
      throw Object.assign(new Error(`Source URL returned ${response.status}`), {
        statusCode: 422,
      });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (
      Number.isFinite(contentLength) &&
      contentLength > MENU_URL_IMPORT_MAX_BYTES
    ) {
      throw Object.assign(new Error("That menu URL is too large to import."), {
        statusCode: 413,
      });
    }

    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > MENU_URL_IMPORT_MAX_BYTES) {
      throw Object.assign(new Error("That menu URL is too large to import."), {
        statusCode: 413,
      });
    }
    rawData = extractMenuRowsFromHtml(html);
  } finally {
    clearTimeout(timer);
  }

  if (rawData.length === 0) {
    const errors = [{ row: 0, reason: "No menu item data found on URL." }];
    await db.insert(menuImportLogs).values({
      restaurantId: menu.restaurantId,
      importedByUserId: userId,
      source,
      fileName: url,
      itemsImported: 0,
      itemsSkipped: 0,
      errors: errors as any,
      status: "failed",
    });
    throw Object.assign(
      new Error(
        "We could not extract menu items from that URL. Try CSV/PDF import or upload a platform export.",
      ),
      {
        statusCode: 422,
        payload: {
          message:
            "We could not extract menu items from that URL. Try CSV/PDF import or upload a platform export.",
          imported: 0,
          skipped: 0,
          errors,
          source,
        },
      },
    );
  }

  const { imported, skipped, errors } = normalizeExternalMenuData(
    rawData,
    source,
    menuId,
    menu.restaurantId,
  );

  if (imported.length > 0) {
    await db.insert(menuItems).values(imported);
  }

  await db.insert(menuImportLogs).values({
    restaurantId: menu.restaurantId,
    importedByUserId: userId,
    source,
    fileName: url,
    itemsImported: imported.length,
    itemsSkipped: skipped,
    errors: errors as any,
    status: computeImportStatus(imported.length, errors.length),
  });

  await db
    .update(menus)
    .set({
      importSource: source,
      importedAt: new Date(),
      importUrl: url,
      updatedAt: new Date(),
    })
    .where(eq(menus.id, menuId));

  return {
    imported: imported.length,
    skipped,
    errors,
    source,
  };
}

export function registerMenuRoutes(app: Express) {
  // ── Rate limiters for expensive owner-side endpoints. ────────────────────
  // Keyed by user id when authenticated, else IP, so they survive a launch-
  // week burst of new owners hammering imports + photo uploads.
  const ownerKey = (req: any) =>
    String(req.user?.id || req.ip || "anon");
  const menuImportLimiter = distributedRateLimit({
    scope: "menu-import",
    limit: 20,
    windowMs: 5 * 60 * 1000,
    key: ownerKey,
  });
  const menuPhotoUploadLimiter = distributedRateLimit({
    scope: "menu-photo-upload",
    limit: 60,
    windowMs: 5 * 60 * 1000,
    key: ownerKey,
  });

  // ── ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: customer-facing menu view
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/menus/:restaurantId
   * Returns all active menus with categories, items, variants and modifiers.
   * Used by the customer-facing ordering UI.
   */
  app.get(
    "/api/menus/:restaurantId",
    wrap(async (req, res) => {
      const { restaurantId } = req.params;

      let result: Awaited<ReturnType<typeof loadFullMenusForRestaurant>>;
      try {
        result = await loadFullMenusForRestaurant(restaurantId);
      } catch (error) {
        if (
          isMissingRelationError(error, "menus") ||
          isMissingRelationError(error, "menu_categories") ||
          isMissingRelationError(error, "menu_items") ||
          isMissingRelationError(error, "menu_item_variants") ||
          isMissingRelationError(error, "menu_item_modifiers")
        ) {
          console.warn(
            "[menuRoutes] Menu tables are unavailable; returning empty public menu response",
            { restaurantId },
          );
          return res.json({ menus: [], orderingEnabled: false });
        }

        throw error;
      }

      if (result.length === 0) {
        return res.json({ menus: [], orderingEnabled: false });
      }

      // Determine if online ordering is enabled for this restaurant.
      // Ordering is part of the $25/month subscription (or lifetime access).
      // We also check trial status via users.trialEndsAt.
      let orderingEnabled = false;
      const [restaurantRow] = await db
        .select({
          ownerId: restaurants.ownerId,
          name: restaurants.name,
          city: restaurants.city,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
          cuisineType: restaurants.cuisineType,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (restaurantRow?.ownerId) {
        // Check for active subscription (includes lifetime isLifetimeFree=true rows)
        const [activeSub] = await db
          .select({ id: restaurantSubscriptions.id })
          .from(restaurantSubscriptions)
          .where(
            and(
              eq(restaurantSubscriptions.restaurantId, restaurantId),
              eq(restaurantSubscriptions.status, "active"),
            ),
          )
          .limit(1);
        if (activeSub) {
          orderingEnabled = true;
        } else {
          // Check trial access
          const [ownerRow] = await db
            .select({ trialEndsAt: users.trialEndsAt, stripeSubscriptionId: users.stripeSubscriptionId })
            .from(users)
            .where(eq(users.id, restaurantRow.ownerId))
            .limit(1);
          if (
            ownerRow?.trialEndsAt &&
            new Date(ownerRow.trialEndsAt) > new Date()
          ) {
            orderingEnabled = true;
          } else if (ownerRow?.stripeSubscriptionId) {
            // Stripe subscription as final fallback (active check deferred to server-side gate)
            orderingEnabled = true;
          }
        }
      }

      res.json({
        menus: result,
        orderingEnabled,
        restaurantName: restaurantRow?.name ?? null,
        restaurantCity: restaurantRow?.city ?? null,
        isFoodTruck: restaurantRow?.isFoodTruck ?? false,
        businessType: restaurantRow?.businessType ?? null,
        cuisineType: restaurantRow?.cuisineType ?? null,
      });
    }),
  );

  // ── ─────────────────────────────────────────────────────────────────────────
  // OWNER: menu management
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/owner/menus/:restaurantId
   * Returns ALL menus (incl. inactive) for the owner dashboard.
   */
  app.get(
    "/api/owner/menus/:restaurantId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      const elevatedRole = ["admin", "super_admin", "staff"].includes(
        String(req.user?.userType || ""),
      );

      if (!elevatedRole) {
        try {
          const ownsRestaurant = await storage.verifyRestaurantOwnership(
            restaurantId,
            req.user.id,
            "manageProfile",
          );
          if (!ownsRestaurant) {
            return res.json({ menus: [] });
          }
        } catch (ownershipError) {
          console.warn("[menuRoutes] Ownership check failed; returning empty owner menu list", {
            userId: req.user?.id,
            restaurantId,
            error: (ownershipError as any)?.message || ownershipError,
          });
          return res.json({ menus: [] });
        }
      }

      let restaurantMenus: any[] = [];
      try {
        restaurantMenus = await db
          .select()
          .from(menus)
          .where(eq(menus.restaurantId, restaurantId))
          .orderBy(asc(menus.serviceType));
      } catch (menuQueryError) {
        console.warn("[menuRoutes] Ordered owner menu query failed; falling back to unordered query", {
          restaurantId,
          error: (menuQueryError as any)?.message || menuQueryError,
        });
        try {
          restaurantMenus = await db
            .select()
            .from(menus)
            .where(eq(menus.restaurantId, restaurantId));
        } catch (fallbackQueryError) {
          if (isMissingRelationError(fallbackQueryError, "menus")) {
            console.warn(
              "[menuRoutes] menus relation missing; returning empty owner menu list",
              {
                restaurantId,
                error:
                  (fallbackQueryError as any)?.message || fallbackQueryError,
              },
            );
            return res.json({ menus: [] });
          }
          throw fallbackQueryError;
        }
      }

      res.json({ menus: restaurantMenus });
    }),
  );

  /**
   * GET /api/owner/menus/:restaurantId/full
   * Returns owner-editable menus, including inactive menus/categories/items.
   */
  app.get(
    "/api/owner/menus/:restaurantId/full",
    isAuthenticated,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(
        req.user.id,
        restaurantId,
        req.user?.userType,
      );

      const menuId = String(req.query.menuId || "").trim() || undefined;
      if (menuId) {
        await assertOwnsMenu(req.user.id, menuId, req.user?.userType);
      }

      const ownerMenus = await loadFullMenusForRestaurant(restaurantId, {
        includeInactive: true,
        menuId,
      });

      res.json({ menus: ownerMenus });
    }),
  );

  /**
   * POST /api/owner/menus
   * Create a new menu for a restaurant.
   */
  app.post(
    "/api/owner/menus",
    isAuthenticated,
    wrap(async (req, res) => {
      const body = insertMenuSchema.parse(req.body);
      const normalizedBody = {
        ...body,
        serviceType: normalizeMenuServiceType(body.serviceType),
      };
      await assertOwnsRestaurant(
        req.user.id,
        normalizedBody.restaurantId,
        req.user?.userType,
      );

      const [menu] = await db.insert(menus).values(normalizedBody).returning();

      await db.insert(menuCategories).values({
        menuId: menu.id,
        restaurantId: menu.restaurantId,
        name: "Menu Items",
        sortOrder: 0,
      });

      // Emit LISA claim for menu published
      db.insert(lisaClaims).values({
        app: "mealscout",
        claimType: LISA_CLAIM_TYPES.MENU_PUBLISHED,
        source: LISA_CLAIM_SOURCES.MENU,
        subjectType: "menu",
        subjectId: menu.id,
        actorType: "user",
        actorId: req.user.id,
        payload: { restaurantId: normalizedBody.restaurantId, menuName: menu.name },
      }).catch(() => {});

      res.status(201).json({ menu });
    }),
  );

  /**
   * PATCH /api/owner/menus/:menuId
   * Update a menu's settings (name, availability, fee settings, etc.)
   */
  app.patch(
    "/api/owner/menus/:menuId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      const updateSchema = insertMenuSchema
        .partial()
        .omit({ restaurantId: true });
      const parsedUpdates = updateSchema.parse(req.body);
      const updates = {
        ...parsedUpdates,
        ...(Object.prototype.hasOwnProperty.call(parsedUpdates, "serviceType")
          ? {
              serviceType: normalizeMenuServiceType(parsedUpdates.serviceType),
            }
          : {}),
      };

      const [updated] = await db
        .update(menus)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(menus.id, menuId))
        .returning();
      res.json({ menu: updated });
    }),
  );

  /**
   * DELETE /api/owner/menus/:menuId
   * Soft-delete: marks menu inactive (preserves order history references).
   */
  app.delete(
    "/api/owner/menus/:menuId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      await db
        .update(menus)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(menus.id, menuId));
      res.json({ success: true });
    }),
  );

  // ── Categories ──────────────────────────────────────────────────────────────

  /**
   * POST /api/owner/menu-categories
   */
  app.post(
    "/api/owner/menu-categories",
    isAuthenticated,
    wrap(async (req, res) => {
      const body = insertMenuCategorySchema.parse(req.body);
      await assertOwnsMenu(req.user.id, body.menuId, req.user?.userType);

      const [cat] = await db.insert(menuCategories).values(body).returning();
      res.status(201).json({ category: cat });
    }),
  );

  /**
   * PATCH /api/owner/menu-categories/:categoryId
   */
  app.patch(
    "/api/owner/menu-categories/:categoryId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user.id, cat.restaurantId, req.user?.userType);

      const updateSchema = insertMenuCategorySchema
        .partial()
        .omit({ menuId: true, restaurantId: true });
      const updates = updateSchema.parse(req.body);

      const [updated] = await db
        .update(menuCategories)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(menuCategories.id, categoryId))
        .returning();
      res.json({ category: updated });
    }),
  );

  /**
   * DELETE /api/owner/menu-categories/:categoryId
   */
  app.delete(
    "/api/owner/menu-categories/:categoryId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user.id, cat.restaurantId, req.user?.userType);

      await db
        .update(menuCategories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(menuCategories.id, categoryId));
      res.json({ success: true });
    }),
  );

  // ── Menu Items ──────────────────────────────────────────────────────────────

  /**
   * POST /api/owner/menu-items
   */
  app.post(
    "/api/owner/menu-items",
    isAuthenticated,
    wrap(async (req, res) => {
      const body = insertMenuItemSchema.parse(req.body);
      await assertOwnsMenu(req.user.id, body.menuId, req.user?.userType);

      const [item] = await db.insert(menuItems).values(body).returning();
      res.status(201).json({ item });
    }),
  );

  /**
   * PATCH /api/owner/menu-items/:itemId
   */
  app.patch(
    "/api/owner/menu-items/:itemId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      const updateSchema = insertMenuItemSchema
        .partial()
        .omit({ menuId: true, restaurantId: true });
      const updates = updateSchema.parse(req.body);

      const [updated] = await db
        .update(menuItems)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(menuItems.id, itemId))
        .returning();
      res.json({ item: updated });
    }),
  );

  /**
   * DELETE /api/owner/menu-items/:itemId
   * Soft-delete: marks item unavailable.
   */
  app.delete(
    "/api/owner/menu-items/:itemId",
    isAuthenticated,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      await db
        .update(menuItems)
        .set({ isAvailable: false, updatedAt: new Date() })
        .where(eq(menuItems.id, itemId));
      res.json({ success: true });
    }),
  );

  // ── Inventory update ──────────────────────────────────────────────────────

  /**
   * PATCH /api/owner/menu-items/:itemId/inventory
   * Update stock quantity for a tracked item.
   */
  app.patch(
    "/api/owner/menu-items/:itemId/inventory",
    isAuthenticated,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      const { inventoryQty } = z
        .object({ inventoryQty: z.number().int().min(0) })
        .parse(req.body);

      const [updated] = await db
        .update(menuItems)
        .set({
          inventoryQty,
          isAvailable: inventoryQty > 0,
          updatedAt: new Date(),
        })
        .where(eq(menuItems.id, itemId))
        .returning();
      res.json({ item: updated });
    }),
  );

  // ── Variants ────────────────────────────────────────────────────────────────

  /**
   * PUT /api/owner/menu-items/:itemId/variants
   * Replace all variants for an item with the provided list.
   */
  app.put(
    "/api/owner/menu-items/:itemId/variants",
    isAuthenticated,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      const variantList = z
        .array(insertMenuItemVariantSchema)
        .parse(req.body.variants);

      // Delete existing then insert new
      await db
        .delete(menuItemVariants)
        .where(eq(menuItemVariants.menuItemId, itemId));

      let inserted: any[] = [];
      if (variantList.length > 0) {
        inserted = await db
          .insert(menuItemVariants)
          .values(variantList.map((v) => ({ ...v, menuItemId: itemId })))
          .returning();
      }
      res.json({ variants: inserted });
    }),
  );

  // ── Modifiers ───────────────────────────────────────────────────────────────

  /**
   * PUT /api/owner/menu-items/:itemId/modifiers
   * Replace all modifiers for an item with the provided list.
   */
  app.put(
    "/api/owner/menu-items/:itemId/modifiers",
    isAuthenticated,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      const modList = z
        .array(insertMenuItemModifierSchema)
        .parse(req.body.modifiers);

      await db
        .delete(menuItemModifiers)
        .where(eq(menuItemModifiers.menuItemId, itemId));

      let inserted: any[] = [];
      if (modList.length > 0) {
        inserted = await db
          .insert(menuItemModifiers)
          .values(modList.map((m) => ({ ...m, menuItemId: itemId })))
          .returning();
      }
      res.json({ modifiers: inserted });
    }),
  );

  // ── Item photo upload ──────────────────────────────────────────────────────

  /**
   * POST /api/owner/menu-items/:itemId/photo
   * Upload a photo for a menu item. Stored in Cloudinary; the resulting URL is
   * persisted as the item's imageUrl.
   */
  app.post(
    "/api/owner/menu-items/:itemId/photo",
    isAuthenticated,
    menuPhotoUploadLimiter,
    upload.single("file"),
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId, req.user?.userType);

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      if (!req.file.mimetype?.startsWith("image/")) {
        return res
          .status(400)
          .json({ message: "Only image uploads are allowed for item photos." });
      }
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({
          message:
            "Image hosting is not configured (Cloudinary credentials missing). " +
            "Paste an image URL instead.",
        });
      }

      const result = await uploadToCloudinary(req.file.buffer, "menu-items", itemId);

      const [updated] = await db
        .update(menuItems)
        .set({ imageUrl: result.secureUrl, updatedAt: new Date() })
        .where(eq(menuItems.id, itemId))
        .returning();

      res.json({
        item: updated,
        imageUrl: result.secureUrl,
        thumbnailUrl: result.thumbnailUrl,
      });
    }),
  );

  // ── Reorder ─────────────────────────────────────────────────────────────────

  /**
   * PUT /api/owner/menus/:menuId/reorder/categories
   * Body: { categoryIds: string[] }  (in the new desired order)
   */
  app.put(
    "/api/owner/menus/:menuId/reorder/categories",
    isAuthenticated,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user.id, menuId, req.user?.userType);
      const { categoryIds } = z
        .object({ categoryIds: z.array(z.string().uuid()).max(200) })
        .parse(req.body);

      // Verify all IDs belong to this menu before updating.
      const existing = await db
        .select({ id: menuCategories.id })
        .from(menuCategories)
        .where(eq(menuCategories.menuId, menuId));
      const valid = new Set(existing.map((r: { id: string }) => r.id));
      for (const id of categoryIds) {
        if (!valid.has(id)) {
          return res.status(400).json({ message: "Invalid category id" });
        }
      }

      await Promise.all(
        categoryIds.map((id, idx) =>
          db
            .update(menuCategories)
            .set({ sortOrder: idx, updatedAt: new Date() })
            .where(eq(menuCategories.id, id)),
        ),
      );
      res.json({ success: true });
    }),
  );

  /**
   * PUT /api/owner/menu-categories/:categoryId/reorder/items
   * Body: { itemIds: string[] }  (in the new desired order, all in this category)
   */
  app.put(
    "/api/owner/menu-categories/:categoryId/reorder/items",
    isAuthenticated,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(
        req.user.id,
        cat.restaurantId,
        req.user?.userType,
      );

      const { itemIds } = z
        .object({ itemIds: z.array(z.string().uuid()).max(500) })
        .parse(req.body);

      const existing = await db
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(eq(menuItems.categoryId, categoryId));
      const valid = new Set(existing.map((r: { id: string }) => r.id));
      for (const id of itemIds) {
        if (!valid.has(id)) {
          return res.status(400).json({ message: "Invalid item id" });
        }
      }

      await Promise.all(
        itemIds.map((id, idx) =>
          db
            .update(menuItems)
            .set({ sortOrder: idx, updatedAt: new Date() })
            .where(eq(menuItems.id, id)),
        ),
      );
      res.json({ success: true });
    }),
  );

  // ── ─────────────────────────────────────────────────────────────────────────
  // MENU IMPORTS
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/owner/menus/:menuId/import/csv
   * Upload a CSV file and bulk-import menu items.
   * Expected columns: name, description, price, category, sku (optional)
   */
  app.post(
    "/api/owner/menus/:menuId/import/csv",
    isAuthenticated,
    menuImportLimiter,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { imported, skipped, errors } = await parseMenuCsv(
        req.file.buffer,
        menuId,
        menu.restaurantId,
      );

      // Insert imported items in a transaction
      if (imported.length > 0) {
        const catMap = await resolveCategoryIds(
          menuId,
          menu.restaurantId,
          imported.map((it) => it.categoryName),
        );
        const itemsToInsert = imported.map(({ categoryName, ...rest }) => ({
          ...rest,
          categoryId: categoryName
            ? catMap.get(categoryName.trim().toLowerCase()) ?? null
            : null,
        }));
        await db.insert(menuItems).values(itemsToInsert);
      }

      // Audit log
      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: "csv",
        fileName: req.file.originalname,
        itemsImported: imported.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status: computeImportStatus(imported.length, errors.length),
      });

      await db
        .update(menus)
        .set({
          importSource: "csv",
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({
        imported: imported.length,
        skipped,
        errors,
      });
    }),
  );

  /**
   * POST /api/owner/menus/:menuId/import/pdf
   * Upload a PDF menu and extract items via AI parsing.
   */
  app.post(
    "/api/owner/menus/:menuId/import/pdf",
    isAuthenticated,
    menuImportLimiter,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { imported, skipped, errors } = await parsePdfMenuWithAi(
        req.file.buffer,
        menuId,
        menu.restaurantId,
        req.file.mimetype,
      );

      if (imported.length > 0) {
        // Resolve AI-extracted category names to category IDs (creating new
        // categories as needed) so imported items aren't orphaned.
        const catMap = await resolveCategoryIds(
          menuId,
          menu.restaurantId,
          imported.map((it) => it.categoryName),
        );
        const itemsToInsert = imported.map(({ categoryName, ...rest }) => ({
          ...rest,
          categoryId: categoryName
            ? catMap.get(categoryName.trim().toLowerCase()) ?? null
            : null,
        }));
        await db.insert(menuItems).values(itemsToInsert);
      }

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: req.file.mimetype?.startsWith("image/") ? "image" : "pdf",
        fileName: req.file.originalname,
        itemsImported: imported.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status: computeImportStatus(imported.length, errors.length),
      });

      await db
        .update(menus)
        .set({
          importSource: req.file.mimetype?.startsWith("image/")
            ? "image"
            : "pdf",
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({ imported: imported.length, skipped, errors });
    }),
  );

  /**
   * POST /api/owner/menus/:menuId/import/external
   * Import menu from supported public/menu export sources and POS adapters.
   * Body: { source: 'ubereats' | 'clover' | 'toast' | 'square' | 'gmb' | 'google' | 'grubhub' | 'yelp' | 'website', rawData: object[] }
   *
   * NOTE: Full third-party API integrations are implemented incrementally.
   * This endpoint accepts raw exported JSON/objects and normalizes them.
   */
  app.post(
    "/api/owner/menus/:menuId/import/external",
    isAuthenticated,
    menuImportLimiter,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      const bodySchema = z.object({
        source: z.enum(EXTERNAL_MENU_SOURCES),
        // Raw exported data from the third-party platform.
        // Shape varies per source; normalizer handles each.
        rawData: z.array(z.record(z.any())).min(1).max(500),
      });

      const { source, rawData } = bodySchema.parse(req.body);

      const { imported, skipped, errors } = normalizeExternalMenuData(
        rawData,
        source,
        menuId,
        menu.restaurantId,
      );

      if (imported.length > 0) {
        await db.insert(menuItems).values(imported);
      }

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source,
        itemsImported: imported.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status: computeImportStatus(imported.length, errors.length),
      });

      await db
        .update(menus)
        .set({
          importSource: source,
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({ imported: imported.length, skipped, errors });
    }),
  );

  /**
   * POST /api/owner/menus/:menuId/import/url
   * Import menu by crawling a public URL.
   * Body: { url: string, source?: string }
   */
  app.post(
    "/api/owner/menus/:menuId/import/url",
    isAuthenticated,
    menuImportLimiter,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      const bodySchema = z.object({
        url: z.string().url(),
        source: z.string().optional(),
      });

      const { url, source } = bodySchema.parse(req.body);
      const resolvedSource = normalizeExternalSource(
        source || detectSourceFromUrl(url),
      );
      const result = await importMenuItemsFromPublicUrl({
        menu,
        menuId,
        userId: req.user.id,
        url,
        source: resolvedSource,
      });
      res.json(result);
    }),
  );

  /**
   * GET /api/owner/menus/:menuId/import-logs
   * Returns import history for a menu.
   */
  app.get(
    "/api/owner/menus/:menuId/import-logs",
    isAuthenticated,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      const logs = await db
        .select()
        .from(menuImportLogs)
        .where(eq(menuImportLogs.restaurantId, menu.restaurantId))
        .orderBy(menuImportLogs.createdAt);

      res.json({ logs });
    }),
  );
}

// ── External data normalizer ─────────────────────────────────────────────────

type NormalizedImportResult = {
  imported: {
    menuId: string;
    restaurantId: string;
    name: string;
    description: string | null;
    priceCents: number;
    dietaryTags: string[];
    allergens: string[];
    isAvailable: boolean;
    sortOrder: number;
  }[];
  skipped: number;
  errors: { row: number; reason: string }[];
};

/**
 * normalizeExternalMenuData
 * Converts known third-party menu export formats into our normalized shape.
 * Each source has a slightly different field naming convention.
 */
export function normalizeExternalMenuData(
  rawData: Record<string, any>[],
  source: string,
  menuId: string,
  restaurantId: string,
): NormalizedImportResult {
  const imported: NormalizedImportResult["imported"] = [];
  const errors: NormalizedImportResult["errors"] = [];
  let skipped = 0;

  rawData.forEach((row, idx) => {
    try {
      const name = String(
        row.name || row.title || row.item_name || row.itemName || "",
      ).trim();
      if (!name) {
        skipped++;
        return;
      }

      // Try various price field names used by different platforms
      const rawPrice =
        row.price ??
        row.price_cents ??
        row.basePrice ??
        row.item_price ??
        row.cost ??
        0;

      // Accept both dollar amounts and cent amounts
      let priceCents: number;
      const numPrice = Number(rawPrice);
      if (isNaN(numPrice)) {
        errors.push({ row: idx, reason: `Invalid price: ${rawPrice}` });
        return;
      }
      // Heuristic: if value > 500 assume it's already in cents
      priceCents =
        numPrice > 500 ? Math.round(numPrice) : Math.round(numPrice * 100);

      const description =
        String(row.description || row.desc || row.details || "").trim() || null;

      const dietaryTags: string[] = Array.isArray(row.dietaryTags)
        ? row.dietaryTags
        : Array.isArray(row.dietary_tags)
          ? row.dietary_tags
          : [];

      const allergens: string[] = Array.isArray(row.allergens)
        ? row.allergens
        : [];

      imported.push({
        menuId,
        restaurantId,
        name,
        description,
        priceCents,
        dietaryTags,
        allergens,
        isAvailable: true,
        sortOrder: idx,
      });
    } catch (err: any) {
      errors.push({ row: idx, reason: err?.message || "Unknown error" });
    }
  });

  return { imported, skipped, errors };
}

export function normalizeExternalSource(source?: string): ExternalMenuSource {
  const normalized = String(source || "website").trim().toLowerCase();
  if ((EXTERNAL_MENU_SOURCES as readonly string[]).includes(normalized)) {
    return normalized as ExternalMenuSource;
  }
  return "website";
}

export function detectSourceFromUrl(url: string): string {
  const value = String(url || "").toLowerCase();
  if (value.includes("ubereats") || value.includes("uber.com")) return "ubereats";
  if (value.includes("google.") || value.includes("g.page") || value.includes("maps.app.goo.gl")) {
    return "google";
  }
  if (value.includes("grubhub")) return "grubhub";
  if (value.includes("yelp")) return "yelp";
  return "website";
}

export async function fetchPublicMenuUrl(
  initialUrl: URL,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = new URL(initialUrl.toString());

  for (let attempt = 0; attempt <= MENU_URL_IMPORT_MAX_REDIRECTS; attempt += 1) {
    const validation = await validatePublicImportUrl(currentUrl);
    if (!validation.ok) {
      throw Object.assign(new Error(validation.message), { statusCode: 400 });
    }

    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: MENU_URL_IMPORT_HEADERS,
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl);
  }

  throw Object.assign(new Error("Too many redirects while importing menu URL."), {
    statusCode: 400,
  });
}

export async function validatePublicImportUrl(url: URL): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!["http:", "https:"].includes(url.protocol)) {
    return {
      ok: false,
      message: "Only http/https URLs are supported for import.",
    };
  }

  const hostname = url.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    return {
      ok: false,
      message: "That menu URL is not a public website.",
    };
  }

  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion && isBlockedImportIp(hostname)) {
    return {
      ok: false,
      message: "That menu URL is not a public website.",
    };
  }

  if (!literalIpVersion) {
    let addresses: Array<{ address: string }> = [];
    try {
      addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      return {
        ok: false,
        message: "We could not resolve that menu URL.",
      };
    }

    if (
      addresses.length === 0 ||
      addresses.some((entry) => isBlockedImportIp(entry.address))
    ) {
      return {
        ok: false,
        message: "That menu URL is not a public website.",
      };
    }
  }

  return { ok: true, message: "" };
}

function isBlockedImportIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const value = address.toLowerCase();
    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:") ||
      value.startsWith("ff")
    );
  }

  return true;
}

export function extractMenuRowsFromHtml(html: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];

  const pushRow = (name: string, priceRaw: unknown, description?: string) => {
    const cleanName = String(name || "").trim();
    const priceCents = toPriceCents(priceRaw);
    if (!cleanName || priceCents === null || priceCents < 0) return;
    rows.push({
      name: cleanName,
      description: String(description || "").trim() || null,
      price_cents: priceCents,
    });
  };

  const jsonLdPattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch: RegExpExecArray | null = null;
  while ((jsonLdMatch = jsonLdPattern.exec(html))) {
    const parsed = parseJsonSafe(jsonLdMatch[1]);
    if (!parsed) continue;
    collectMenuNodes(parsed, pushRow);
  }

  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextDataMatch) {
    const parsed = parseJsonSafe(nextDataMatch[1]);
    if (parsed) collectMenuNodes(parsed, pushRow);
  }

  if (rows.length === 0) {
    collectScriptEmbeddedMenuRows(html, pushRow);
  }

  if (rows.length === 0) {
    collectTextMenuRows(html, pushRow);
  }

  const uniqueMap = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const key = `${String(row.name).toLowerCase()}::${Number(row.price_cents)}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, row);
  }

  return Array.from(uniqueMap.values()).slice(0, 500);
}

function collectMenuNodes(
  node: unknown,
  pushRow: (name: string, priceRaw: unknown, description?: string) => void,
) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectMenuNodes(item, pushRow);
    return;
  }
  if (typeof node !== "object") return;

  const value = node as Record<string, any>;
  const name = value.name || value.title || value.itemName;
  const description = value.description || value.subtitle || value.details;
  const offerPrice =
    value.price ??
    value.priceAmount ??
    value.basePrice ??
    value.item_price ??
    value.price_cents ??
    value?.offers?.price ??
    value?.offer?.price ??
    value?.priceSpecification?.price ??
    value?.pricing?.price;

  if (name && offerPrice != null) {
    pushRow(String(name), offerPrice, description ? String(description) : "");
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectMenuNodes(child, pushRow);
    }
  }
}

function collectScriptEmbeddedMenuRows(
  html: string,
  pushRow: (name: string, priceRaw: unknown, description?: string) => void,
) {
  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null = null;

  while ((scriptMatch = scriptPattern.exec(html))) {
    const rawScript = scriptMatch[1].trim();
    if (!rawScript) continue;

    const parsed = parseJsonSafe(rawScript);
    if (parsed) {
      collectMenuNodes(parsed, pushRow);
      continue;
    }

    const decodedChunks = decodeNextFlightChunks(rawScript);
    for (const chunk of decodedChunks) {
      const parsedChunk = parseJsonSafe(chunk);
      if (parsedChunk) collectMenuNodes(parsedChunk, pushRow);
      collectTextMenuRows(chunk, pushRow);
      collectMenuRowsFromLooseJsonText(chunk, pushRow);
    }
  }
}

function decodeNextFlightChunks(script: string): string[] {
  const chunks: string[] = [];
  const pushPattern = /self\.__next_f\.push\(\[(?:\d+),\s*("(?:\\.|[^"\\])*")\]\)/g;
  let match: RegExpExecArray | null = null;

  while ((match = pushPattern.exec(script))) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      // Ignore malformed chunks; other extraction paths still apply.
    }
  }

  return chunks;
}

function collectMenuRowsFromLooseJsonText(
  text: string,
  pushRow: (name: string, priceRaw: unknown, description?: string) => void,
) {
  const normalized = text
    .replace(/\\"/g, '"')
    .replace(/\\u0022/g, '"')
    .replace(/\\u0026/g, "&");

  const objectishPattern =
    /"name"\s*:\s*"([^"]{3,90})"[\s\S]{0,900}?"(?:price|price_cents|displayString|unitAmount|basePrice)"\s*:\s*(?:"([^"]{1,24})"|(\d{2,7}))/gi;
  let match: RegExpExecArray | null = null;
  while ((match = objectishPattern.exec(normalized))) {
    const name = cleanJsonText(match[1]);
    const price = match[2] ?? match[3];
    if (looksLikeMenuItemName(name)) {
      pushRow(name, price);
    }
  }

  const displayPattern =
    /"displayString"\s*:\s*"(\$?\d{1,3}(?:\.\d{2})?)"[\s\S]{0,900}?"name"\s*:\s*"([^"]{3,90})"/gi;
  while ((match = displayPattern.exec(normalized))) {
    const price = match[1];
    const name = cleanJsonText(match[2]);
    if (looksLikeMenuItemName(name)) {
      pushRow(name, price);
    }
  }
}

function cleanJsonText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\n/g, " ")
    .replace(/\\/g, "")
    .trim();
}

function collectTextMenuRows(
  html: string,
  pushRow: (name: string, priceRaw: unknown, description?: string) => void,
) {
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|td|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " "),
  );

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 180);

  const pricePattern = /\$?\b(\d{1,3}(?:\.\d{2})?)\b/g;
  for (const line of lines) {
    const matches = Array.from(line.matchAll(pricePattern));
    if (matches.length === 0) continue;

    const match = matches[matches.length - 1];
    const priceText = match[0];
    const price = toPriceCents(priceText);
    if (price === null || price < 100 || price > 25000) continue;

    const rawName = line.slice(0, match.index).trim();
    const name = rawName
      .replace(/[-–—:|]+$/g, "")
      .replace(/^\W+/, "")
      .trim();

    if (!looksLikeMenuItemName(name)) continue;
    pushRow(name, price);
  }
}

function looksLikeMenuItemName(value: string): boolean {
  if (value.length < 3 || value.length > 90) return false;
  if (!/[a-zA-Z]/.test(value)) return false;
  const lower = value.toLowerCase();
  const blocked = [
    "subtotal",
    "delivery",
    "service fee",
    "sales tax",
    "gift card",
    "minimum",
    "copyright",
    "privacy",
    "terms",
  ];
  return !blocked.some((word) => lower.includes(word));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function toPriceCents(rawPrice: unknown): number | null {
  if (rawPrice == null) return null;
  if (typeof rawPrice === "number" && Number.isFinite(rawPrice)) {
    return rawPrice > 500 ? Math.round(rawPrice) : Math.round(rawPrice * 100);
  }

  const cleaned = String(rawPrice).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 500 ? Math.round(numeric) : Math.round(numeric * 100);
}

function parseJsonSafe(raw: string): unknown | null {
  try {
    return JSON.parse(raw.trim());
  } catch {
    return null;
  }
}
