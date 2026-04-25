/**
 * menuRoutes.ts
 * Online Menu Management – CRUD for menus, categories, items, variants, modifiers
 * and menu import infrastructure (CSV, PDF, UberEats/DoorDash/POS adapters).
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

const EXTERNAL_MENU_SOURCES = [
  "ubereats",
  "doordash",
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

type ExternalMenuSource = (typeof EXTERNAL_MENU_SOURCES)[number];

const MENU_URL_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const MENU_URL_IMPORT_MAX_REDIRECTS = 5;
const MENU_URL_IMPORT_HEADERS = {
  "User-Agent": "MealScoutMenuImporter/1.0 (+https://www.mealscout.us)",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

// ── Multer config (memory storage – files processed in-process) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter(_req, file, cb) {
    const allowed = [".csv", ".pdf", ".json", ".xlsx", ".xls"];
    const imageExts = [".jpg", ".jpeg", ".png", ".webp", ".heic"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || imageExts.includes(ext) || file.mimetype?.startsWith("image/")) {
      return cb(null, true);
    }
    cb(new Error("Unsupported file type. Allowed: csv, pdf, json, xlsx, xls, jpg, png, webp"));
  },
});

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

// ── Error wrapper ─────────────────────────────────────────────────────────────
function wrap(handler: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      const status = err?.statusCode || 500;
      const message = err?.message || "Internal server error";
      if (status === 500) console.error("[menuRoutes]", err);
      res.status(status).json({ message });
    }
  };
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

export function registerMenuRoutes(app: Express) {
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

      const restaurantMenus: Menu[] = await db
        .select()
        .from(menus)
        .where(
          and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)),
        )
        .orderBy(asc(menus.serviceType));

      if (restaurantMenus.length === 0) {
        return res.json({ menus: [], orderingEnabled: false });
      }

      const menuIds = restaurantMenus.map((m) => m.id);

      const [categories, items] = await Promise.all([
        db
          .select()
          .from(menuCategories)
          .where(
            and(
              inArray(menuCategories.menuId, menuIds),
              eq(menuCategories.isActive, true),
            ),
          )
          .orderBy(asc(menuCategories.sortOrder)),
        db
          .select()
          .from(menuItems)
          .where(
            and(
              inArray(menuItems.menuId, menuIds),
              eq(menuItems.isAvailable, true),
            ),
          )
          .orderBy(asc(menuItems.sortOrder)),
      ]);

      // Re-query variants + modifiers now that we have item IDs
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

      const result = restaurantMenus.map((menu) => {
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
        const restaurantIds = restaurantMenus.map((m) => m.restaurantId);
        // Check for active subscription (includes lifetime isLifetimeFree=true rows)
        const [activeSub] = await db
          .select({ id: restaurantSubscriptions.id })
          .from(restaurantSubscriptions)
          .where(
            and(
              inArray(restaurantSubscriptions.restaurantId, restaurantIds),
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
      await assertOwnsRestaurant(req.user.id, restaurantId, req.user?.userType);

      const restaurantMenus = await db
        .select()
        .from(menus)
        .where(eq(menus.restaurantId, restaurantId))
        .orderBy(asc(menus.serviceType));

      res.json({ menus: restaurantMenus });
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
        await db.insert(menuItems).values(imported);
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
        status:
          errors.length > 0 && imported.length === 0 ? "failed" : "complete",
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
        await db.insert(menuItems).values(imported);
      }

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: "pdf",
        fileName: req.file.originalname,
        itemsImported: imported.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status:
          errors.length > 0 && imported.length === 0 ? "failed" : "complete",
      });

      await db
        .update(menus)
        .set({
          importSource: "pdf",
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({ imported: imported.length, skipped, errors });
    }),
  );

  /**
   * POST /api/owner/menus/:menuId/import/external
   * Import menu from UberEats / DoorDash / Clover / Toast / Square / GMB.
   * Body: { source: 'ubereats' | 'doordash' | 'clover' | 'toast' | 'square' | 'gmb' | 'google' | 'grubhub' | 'yelp' | 'website', rawData: object[] }
   *
   * NOTE: Full third-party API integrations are implemented incrementally.
   * This endpoint accepts raw exported JSON/objects and normalizes them.
   */
  app.post(
    "/api/owner/menus/:menuId/import/external",
    isAuthenticated,
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
        status:
          errors.length > 0 && imported.length === 0 ? "failed" : "complete",
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
   * Import menu by crawling a public URL (DoorDash/UberEats/Google/other sites).
   * Body: { url: string, source?: string }
   */
  app.post(
    "/api/owner/menus/:menuId/import/url",
    isAuthenticated,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId, req.user?.userType);

      const bodySchema = z.object({
        url: z.string().url(),
        source: z.string().optional(),
      });

      const { url, source } = bodySchema.parse(req.body);
      const parsed = new URL(url);
      const urlValidation = await validatePublicImportUrl(parsed);
      if (!urlValidation.ok) {
        return res
          .status(400)
          .json({ message: urlValidation.message });
      }

      const resolvedSource = normalizeExternalSource(
        source || detectSourceFromUrl(url),
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      let rawData: Record<string, any>[] = [];
      try {
        const response = await fetchPublicMenuUrl(parsed, controller.signal);

        if (!response.ok) {
          throw new Error(`Source URL returned ${response.status}`);
        }

        const contentLength = Number(response.headers.get("content-length") || 0);
        if (
          Number.isFinite(contentLength) &&
          contentLength > MENU_URL_IMPORT_MAX_BYTES
        ) {
          return res.status(413).json({
            message: "That menu URL is too large to import.",
          });
        }

        const html = await response.text();
        if (Buffer.byteLength(html, "utf8") > MENU_URL_IMPORT_MAX_BYTES) {
          return res.status(413).json({
            message: "That menu URL is too large to import.",
          });
        }
        rawData = extractMenuRowsFromHtml(html);
      } finally {
        clearTimeout(timer);
      }

      if (rawData.length === 0) {
        await db.insert(menuImportLogs).values({
          restaurantId: menu.restaurantId,
          importedByUserId: req.user.id,
          source: resolvedSource,
          fileName: url,
          itemsImported: 0,
          itemsSkipped: 0,
          errors: [{ row: 0, reason: "No menu item data found on URL." }] as any,
          status: "failed",
        });
        return res.status(422).json({
          message:
            "We could not extract menu items from that URL. Try CSV/PDF import or upload a platform export.",
          imported: 0,
          skipped: 0,
          errors: [{ row: 0, reason: "No menu item data found on URL." }],
        });
      }

      const { imported, skipped, errors } = normalizeExternalMenuData(
        rawData,
        resolvedSource,
        menuId,
        menu.restaurantId,
      );

      if (imported.length > 0) {
        await db.insert(menuItems).values(imported);
      }

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: resolvedSource,
        fileName: url,
        itemsImported: imported.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status:
          errors.length > 0 && imported.length === 0 ? "failed" : "complete",
      });

      await db
        .update(menus)
        .set({
          importSource: resolvedSource,
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({
        imported: imported.length,
        skipped,
        errors,
        source: resolvedSource,
      });
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
function normalizeExternalMenuData(
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

function normalizeExternalSource(source?: string): ExternalMenuSource {
  const normalized = String(source || "website").trim().toLowerCase();
  if ((EXTERNAL_MENU_SOURCES as readonly string[]).includes(normalized)) {
    return normalized as ExternalMenuSource;
  }
  return "website";
}

function detectSourceFromUrl(url: string): string {
  const value = String(url || "").toLowerCase();
  if (value.includes("doordash")) return "doordash";
  if (value.includes("ubereats") || value.includes("uber.com")) return "ubereats";
  if (value.includes("google.") || value.includes("g.page") || value.includes("maps.app.goo.gl")) {
    return "google";
  }
  if (value.includes("grubhub")) return "grubhub";
  if (value.includes("yelp")) return "yelp";
  return "website";
}

async function fetchPublicMenuUrl(
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

async function validatePublicImportUrl(url: URL): Promise<{
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

function extractMenuRowsFromHtml(html: string): Record<string, any>[] {
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
