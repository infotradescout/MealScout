/**
 * menuRoutes.ts
 * Online Menu Management – CRUD for menus, categories, items, variants, modifiers
 * and menu import infrastructure (CSV, PDF, UberEats/DoorDash/POS adapters).
 *
 * All write endpoints require: isAuthenticated + verified restaurant ownership.
 * Public read endpoints are unauthenticated (customer-facing menu view).
 *
 * Platform fee: $1 USD per order. Configurable per-menu via hidePlatformFee flag.
 */

import type { Express } from "express";
import { z } from "zod";
import multer from "multer";
import path from "path";
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
import { isAuthenticated, isRestaurantOwner } from "../unifiedAuth";
import { storage } from "../storage";
import { parseMenuCsv } from "../utils/menuCsvParser";
import { parsePdfMenuWithAi } from "../utils/menuPdfParser";

// ── Multer config (memory storage – files processed in-process) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter(_req, file, cb) {
    const allowed = [".csv", ".pdf", ".json", ".xlsx", ".xls"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Unsupported file type. Allowed: csv, pdf, json, xlsx, xls"));
  },
});

// ── Ownership helper ──────────────────────────────────────────────────────────
async function assertOwnsRestaurant(userId: string, restaurantId: string) {
  const ok = await storage.verifyRestaurantOwnership(restaurantId, userId);
  if (!ok)
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
}

async function assertOwnsMenu(userId: string, menuId: string) {
  const [menu] = await db.select().from(menus).where(eq(menus.id, menuId));
  if (!menu)
    throw Object.assign(new Error("Menu not found"), { statusCode: 404 });
  await assertOwnsRestaurant(userId, menu.restaurantId);
  return menu;
}

async function assertOwnsMenuItem(userId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!item)
    throw Object.assign(new Error("Item not found"), { statusCode: 404 });
  await assertOwnsRestaurant(userId, item.restaurantId);
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

export function registerMenuRoutes(app: Express) {
  // ── ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: customer-facing menu view
  // ── ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/menus/local-items
   * Local discovery feed of active menu items for Scout discovery layers.
   * Returns real available menu items only; no sample data.
   */
  app.get(
    "/api/menus/local-items",
    wrap(async (req, res) => {
      const lat = Number.parseFloat(String(req.query.lat || ""));
      const lng = Number.parseFloat(String(req.query.lng || ""));
      const radiusKm = Math.max(
        1,
        Math.min(50, Number.parseFloat(String(req.query.radiusKm || "12")) || 12),
      );
      const limit = Math.max(
        1,
        Math.min(60, Number.parseInt(String(req.query.limit || "24"), 10) || 24),
      );
      const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
      const q = String(req.query.q || req.query.category || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ");
      const queryTerms = q
        ? Array.from(
            new Set(
              q
                .split(" ")
                .filter((term) => term.length > 1)
                .flatMap((term) => {
                  const terms = [term];
                  if (term.endsWith("s") && term.length > 3) {
                    terms.push(term.slice(0, -1));
                  } else if (term.length > 3) {
                    terms.push(`${term}s`);
                  }
                  if (term === "burger" || term === "burgers") {
                    terms.push("cheeseburger", "slider", "sandwich");
                  }
                  if (term === "taco" || term === "tacos") {
                    terms.push("burrito", "quesadilla", "mexican");
                  }
                  return terms;
                }),
            ),
          )
        : [];

      const rows = await db
        .select({
          id: menuItems.id,
          name: menuItems.name,
          description: menuItems.description,
          priceCents: menuItems.priceCents,
          imageUrl: menuItems.imageUrl,
          dietaryTags: menuItems.dietaryTags,
          updatedAt: menuItems.updatedAt,
          restaurantId: menuItems.restaurantId,
          restaurantName: restaurants.name,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          cuisineType: restaurants.cuisineType,
          restaurantLatitude: restaurants.latitude,
          restaurantLongitude: restaurants.longitude,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
        })
        .from(menuItems)
        .innerJoin(menus, eq(menus.id, menuItems.menuId))
        .innerJoin(restaurants, eq(restaurants.id, menuItems.restaurantId))
        .where(
          and(
            eq(menuItems.isAvailable, true),
            eq(menus.isActive, true),
            eq(restaurants.isActive, true),
          ),
        );

      const matchedRows = queryTerms.length
        ? rows.filter((row: any) => {
            const haystack = [
              row.name,
              row.description,
              row.restaurantName,
              row.restaurantCity,
              row.restaurantState,
              row.cuisineType,
              row.businessType,
              ...(Array.isArray(row.dietaryTags) ? row.dietaryTags : []),
            ]
              .join(" ")
              .toLowerCase();
            return queryTerms.some((term) => haystack.includes(term));
          })
        : rows;

      const withDistance = matchedRows
        .map((row: any) => {
          const targetLat = Number(row.restaurantLatitude);
          const targetLng = Number(row.restaurantLongitude);
          let distanceKm: number | null = null;
          if (hasLocation) {
            if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
              return null;
            }
            const toRad = (value: number) => (value * Math.PI) / 180;
            const earthRadiusKm = 6371;
            const dLat = toRad(targetLat - lat);
            const dLng = toRad(targetLng - lng);
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat)) *
                Math.cos(toRad(targetLat)) *
                Math.sin(dLng / 2) *
                Math.sin(dLng / 2);
            distanceKm =
              earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) {
              return null;
            }
          }

          return {
            ...row,
            distanceMiles:
              typeof distanceKm === "number" ? distanceKm * 0.621371 : null,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          const aDistance =
            typeof a.distanceMiles === "number"
              ? a.distanceMiles
              : Number.POSITIVE_INFINITY;
          const bDistance =
            typeof b.distanceMiles === "number"
              ? b.distanceMiles
              : Number.POSITIVE_INFINITY;
          if (aDistance !== bDistance) return aDistance - bDistance;
          return (
            new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime()
          );
        })
        .slice(0, limit);

      res.json({ items: withDistance });
    }),
  );

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
        .select({ ownerId: restaurants.ownerId, name: restaurants.name, city: restaurants.city, isFoodTruck: restaurants.isFoodTruck, cuisineType: restaurants.cuisineType })
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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(req.user.id, restaurantId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const body = insertMenuSchema.parse(req.body);
      await assertOwnsRestaurant(req.user.id, body.restaurantId);

      const [menu] = await db.insert(menus).values(body).returning();

      // Emit LISA claim for menu published
      db.insert(lisaClaims).values({
        app: "mealscout",
        claimType: LISA_CLAIM_TYPES.MENU_PUBLISHED,
        source: LISA_CLAIM_SOURCES.MENU,
        subjectType: "menu",
        subjectId: menu.id,
        actorType: "user",
        actorId: req.user.id,
        payload: { restaurantId: body.restaurantId, menuName: menu.name },
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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user.id, menuId);

      const updateSchema = insertMenuSchema
        .partial()
        .omit({ restaurantId: true });
      const updates = updateSchema.parse(req.body);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user.id, menuId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const body = insertMenuCategorySchema.parse(req.body);
      await assertOwnsMenu(req.user.id, body.menuId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user.id, cat.restaurantId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user.id, cat.restaurantId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const body = insertMenuItemSchema.parse(req.body);
      await assertOwnsMenu(req.user.id, body.menuId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId);

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
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user.id, itemId);

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
    isRestaurantOwner,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId);

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
    isRestaurantOwner,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId);

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { imported, skipped, errors } = await parsePdfMenuWithAi(
        req.file.buffer,
        menuId,
        menu.restaurantId,
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
   * Body: { source: 'ubereats' | 'doordash' | 'clover' | 'toast' | 'square' | 'gmb', url?: string, data?: object }
   *
   * NOTE: Full third-party API integrations are implemented incrementally.
   * This endpoint accepts raw exported JSON/objects and normalizes them.
   */
  app.post(
    "/api/owner/menus/:menuId/import/external",
    isAuthenticated,
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId);

      const bodySchema = z.object({
        source: z.enum([
          "ubereats",
          "doordash",
          "clover",
          "toast",
          "square",
          "gmb",
        ]),
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
   * GET /api/owner/menus/:menuId/import-logs
   * Returns import history for a menu.
   */
  app.get(
    "/api/owner/menus/:menuId/import-logs",
    isAuthenticated,
    isRestaurantOwner,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user.id, menuId);

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
