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
  menuItemRecommendations,
  menuItemPhotos,
  menuItemVariants,
  menuItemModifiers,
  menuImportLogs,
  menuDraftReviews,
  menuDraftReviewItems,
  imageUploads,
  restaurants,
  restaurantFavorites,
  restaurantFollows,
  restaurantSubscriptions,
  restaurantUserRecommendations,
  telemetryEvents,
  users,
  videoStories,
  insertMenuSchema,
  insertMenuCategorySchema,
  insertMenuItemSchema,
  insertMenuItemVariantSchema,
  insertMenuItemModifierSchema,
  insertMenuItemRecommendationSchema,
  LISA_CLAIM_TYPES,
  LISA_CLAIM_SOURCES,
  lisaClaims,
  type Menu,
  type MenuCategory,
  type MenuItem,
  type MenuItemVariant,
  type MenuItemModifier,
} from "@shared/schema";
import {
  eq,
  and,
  asc,
  desc,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { storage } from "../storage";
import { parseMenuCsv } from "../utils/menuCsvParser";
import { parsePdfMenuWithAi } from "../utils/menuPdfParser";
import {
  rehostImportedImages,
  rehostImageBuffers,
} from "../utils/menuImageIngest";
import {
  parseImageMenuWithAi,
  isSupportedMenuPhotoImage,
} from "../utils/menuPhotoParser";
import {
  isCloudinaryConfigured,
  upload as imageUpload,
  uploadToCloudinary,
} from "../imageUpload";

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
const isMenuManagerUserType = (userType?: string | null) =>
  userType === "restaurant_owner" ||
  userType === "staff" ||
  userType === "admin" ||
  userType === "duper_admin" ||
  userType === "super_admin";

const canManageMenu = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if (!isMenuManagerUserType(req.user?.userType)) {
    return res.status(403).json({ error: "Menu management access required" });
  }
  next();
};

async function assertOwnsRestaurant(reqUser: any, restaurantId: string) {
  if (reqUser?.userType && reqUser.userType !== "restaurant_owner") {
    return;
  }
  const ok = await storage.verifyRestaurantOwnership(restaurantId, reqUser.id);
  if (!ok)
    throw Object.assign(new Error("Not authorized"), { statusCode: 403 });
}

async function assertOwnsMenu(reqUser: any, menuId: string) {
  const [menu] = await db.select().from(menus).where(eq(menus.id, menuId));
  if (!menu)
    throw Object.assign(new Error("Menu not found"), { statusCode: 404 });
  await assertOwnsRestaurant(reqUser, menu.restaurantId);
  return menu;
}

async function assertOwnsMenuItem(reqUser: any, itemId: string) {
  const [item] = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.id, itemId));
  if (!item)
    throw Object.assign(new Error("Item not found"), { statusCode: 404 });
  await assertOwnsRestaurant(reqUser, item.restaurantId);
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

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dollarsToCents(
  value: unknown,
  fallbackLabel?: unknown,
): number | null {
  const direct = Number(value);
  if (Number.isFinite(direct)) return Math.round(direct * 100);
  const fromLabel = Number(String(fallbackLabel || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(fromLabel) ? Math.round(fromLabel * 100) : null;
}

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function minutesFromTime(value: unknown): number | null {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isRestaurantOpenNow(operatingHours: unknown): boolean | null {
  if (!operatingHours || typeof operatingHours !== "object") return null;
  const todayKey = dayKeys[new Date().getDay()];
  const windows = (operatingHours as Record<string, unknown>)[todayKey];
  if (!Array.isArray(windows)) return null;
  if (windows.length === 0) return false;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return windows.some((window: any) => {
    const open = minutesFromTime(window?.open ?? window?.start);
    const close = minutesFromTime(window?.close ?? window?.end);
    if (open === null || close === null) return false;
    if (close < open) {
      return nowMinutes >= open || nowMinutes <= close;
    }
    return nowMinutes >= open && nowMinutes <= close;
  });
}

async function getOrderingSubscriptionReady(
  ownerId: string,
  restaurantId: string,
) {
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
  if (activeSub) return true;

  const [ownerRow] = await db
    .select({
      trialEndsAt: users.trialEndsAt,
      stripeSubscriptionId: users.stripeSubscriptionId,
    })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);

  if (ownerRow?.trialEndsAt && new Date(ownerRow.trialEndsAt) > new Date()) {
    return true;
  }
  return Boolean(ownerRow?.stripeSubscriptionId);
}

async function buildOrderingReadiness(restaurantId: string) {
  const [restaurantRow] = await db
    .select({
      id: restaurants.id,
      ownerId: restaurants.ownerId,
      name: restaurants.name,
      city: restaurants.city,
      isFoodTruck: restaurants.isFoodTruck,
      cuisineType: restaurants.cuisineType,
      isActive: restaurants.isActive,
      operatingHours: restaurants.operatingHours,
    })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const restaurantMenus = await db
    .select()
    .from(menus)
    .where(and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)))
    .orderBy(asc(menus.serviceType));

  const menuIds = restaurantMenus.map((menu: any) => menu.id);
  const items = menuIds.length
    ? await db
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(
          and(
            inArray(menuItems.menuId, menuIds),
            eq(menuItems.isAvailable, true),
          ),
        )
    : [];

  const acceptsCash = restaurantMenus.some((menu: any) => menu.acceptsCash);
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const subscriptionReady = restaurantRow?.ownerId
    ? await getOrderingSubscriptionReady(restaurantRow.ownerId, restaurantId)
    : false;
  const openNow = isRestaurantOpenNow(restaurantRow?.operatingHours);

  const checks = [
    {
      id: "business_active",
      label: "Business profile is active",
      ok: Boolean(restaurantRow?.isActive),
      blocking: true,
      action: "Reactivate the business profile.",
    },
    {
      id: "active_menu",
      label: "At least one active menu is published",
      ok: restaurantMenus.length > 0,
      blocking: true,
      action: "Publish an active menu.",
    },
    {
      id: "menu_items",
      label: "Menu has available items",
      ok: items.length > 0,
      blocking: true,
      action: "Add or enable menu items.",
    },
    {
      id: "subscription",
      label: "Online ordering access is active",
      ok: subscriptionReady,
      blocking: true,
      action: "Start or restore the MealScout business plan.",
    },
    {
      id: "stripe",
      label: "Card payment processing is configured",
      ok: stripeConfigured,
      blocking: !acceptsCash,
      action: acceptsCash
        ? "Card payments are unavailable; cash ordering can still work."
        : "Configure Stripe before taking online orders.",
    },
    {
      id: "hours",
      label:
        openNow === null
          ? "Operating hours are not set"
          : "Business is open now",
      ok: openNow === true,
      blocking: openNow === false,
      action:
        openNow === false
          ? "Update hours or reopen ordering when service starts."
          : "Set hours so customers know when ordering is available.",
    },
  ];

  const blockingReasons = checks
    .filter((check) => check.blocking && !check.ok)
    .map((check) => check.label);

  return {
    restaurantName: restaurantRow?.name ?? null,
    restaurantCity: restaurantRow?.city ?? null,
    isFoodTruck: restaurantRow?.isFoodTruck ?? false,
    cuisineType: restaurantRow?.cuisineType ?? null,
    orderingEnabled: blockingReasons.length === 0,
    acceptsCash,
    stripeConfigured,
    activeMenuCount: restaurantMenus.length,
    availableItemCount: items.length,
    openNow,
    checks,
    blockingReasons,
    payout: {
      connected: false,
      chargesEnabled: stripeConfigured,
      payoutsEnabled: false,
      status: stripeConfigured ? "platform_collected" : "not_configured",
      message: stripeConfigured
        ? "Customer payments are collected by MealScout. Direct restaurant payouts still need a dedicated Connect setup path."
        : "Stripe is not configured, so card payments cannot be collected.",
    },
  };
}

// PDF and photo import both call a paid AI model per request (and photo
// import can send up to 8 images in one call), so they share one budget per
// menu rather than each getting their own - a full page turns into a run of
// short abusive imports at $0 marginal cost to the caller otherwise.
const aiMenuImportLimiter = distributedRateLimit({
  scope: "menu:ai-import",
  limit: 6,
  windowMs: 60 * 60 * 1000,
  key: (req: any) => `${req.user?.id || req.ip}:${req.params?.menuId}`,
});

export function registerMenuRoutes(app: Express) {
  // ── ─────────────────────────────────────────────────────────────────────────
  // PUBLIC: customer-facing menu view
  // ── ─────────────────────────────────────────────────────────────────────────

  const localMenuEngagementSchema = z.object({
    eventName: z.enum(["menu_item_impression", "menu_item_click"]),
    itemId: z.string().min(1).max(128),
    restaurantId: z.string().min(1).max(128).optional().nullable(),
    layerId: z.string().max(80).optional().nullable(),
    surface: z.string().max(80).optional().nullable(),
    query: z.string().max(160).optional().nullable(),
    position: z.number().int().min(0).max(500).optional().nullable(),
    discoveryScore: z.number().optional().nullable(),
    discoveryReasons: z.array(z.string().max(80)).max(8).optional().nullable(),
  });

  const menuDraftImportItemSchema = z
    .object({
      itemName: z.string().min(1).max(255),
      baseItemName: z.string().max(255).optional().nullable(),
      variantLabel: z.string().max(120).optional().nullable(),
      description: z.string().max(3000).optional().nullable(),
      price: z.number().optional().nullable(),
      priceLabel: z.string().max(80).optional().nullable(),
      category: z.string().max(255).optional().nullable(),
      options: z.array(z.string().max(255)).optional().default([]),
      sourceConfidence: z.string().max(40).optional().default("low"),
      sourceRef: z.string().max(1000).optional().nullable(),
      ownerApprovalNeeded: z.boolean().default(true),
      ownerApproved: z.boolean().default(false),
    })
    .passthrough();

  const menuDraftImportEntrySchema = z
    .object({
      truckId: z.string().min(1).max(128),
      profileId: z.string().max(128).optional().nullable(),
      businessName: z.string().min(1).max(255),
      publicProfilePath: z.string().max(500).optional().nullable(),
      sourceType: z.string().min(1).max(80),
      sourceUrl: z.string().min(1).max(1000),
      sourceUrls: z.array(z.string().max(1000)).optional().default([]),
      sourceArtifactPaths: z.array(z.string().max(1000)).optional().default([]),
      capturedAt: z.string().optional().nullable(),
      importStatus: z.string().max(80).optional().default("pending_review"),
      importedSections: z.array(z.record(z.any())).optional().default([]),
      importedItems: z.array(menuDraftImportItemSchema).optional().default([]),
      confidence: z.string().max(40).optional().default("low"),
      ownerApprovalNeeded: z.boolean().default(true),
      ownerApproved: z.boolean().default(false),
      currentness: z.string().max(40).optional().default("unknown"),
      productionApplied: z.boolean().default(false),
      notes: z.array(z.string().max(2000)).optional().default([]),
    })
    .passthrough();

  const menuDraftArtifactSchema = z
    .object({
      artifactType: z.literal("review_gated_external_menu_import"),
      generatedAt: z.string().optional().nullable(),
      productionApplied: z.boolean().default(false),
      entries: z.array(menuDraftImportEntrySchema).min(1).max(25),
    })
    .passthrough();

  app.post(
    "/api/menus/local-items/engagement",
    wrap(async (req, res) => {
      const body = localMenuEngagementSchema.parse(req.body || {});
      const userId = req.user?.id ? String(req.user.id) : null;

      await db.insert(telemetryEvents).values({
        eventName: body.eventName,
        userId,
        properties: {
          itemId: body.itemId,
          restaurantId: body.restaurantId || null,
          layerId: body.layerId || null,
          surface: body.surface || "unknown",
          query: body.query || null,
          position: typeof body.position === "number" ? body.position : null,
          discoveryScore:
            typeof body.discoveryScore === "number"
              ? Math.round(body.discoveryScore)
              : null,
          discoveryReasons: Array.isArray(body.discoveryReasons)
            ? body.discoveryReasons.slice(0, 8)
            : [],
        },
      });

      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/menu-draft-reviews",
    isAuthenticated,
    isStaffOrAdmin,
    wrap(async (req, res) => {
      const limit = Math.max(
        1,
        Math.min(
          100,
          Number.parseInt(String(req.query.limit || "50"), 10) || 50,
        ),
      );
      const includeItems = String(req.query.includeItems || "") === "1";
      const status = String(req.query.status || "").trim();

      const rows = await db
        .select()
        .from(menuDraftReviews)
        .where(status ? eq(menuDraftReviews.reviewStatus, status) : sql`true`)
        .orderBy(desc(menuDraftReviews.createdAt))
        .limit(limit);

      if (!includeItems || rows.length === 0) {
        return res.json({ reviews: rows, productionApplied: false });
      }

      const reviewIds = rows.map((row: any) => row.id);
      const items = await db
        .select()
        .from(menuDraftReviewItems)
        .where(inArray(menuDraftReviewItems.draftReviewId, reviewIds))
        .orderBy(
          asc(menuDraftReviewItems.sectionOrder),
          asc(menuDraftReviewItems.sortOrder),
        );
      const itemsByReview = new Map<string, any[]>();
      for (const item of items as any[]) {
        const key = String(item.draftReviewId);
        itemsByReview.set(key, [...(itemsByReview.get(key) || []), item]);
      }

      res.json({
        reviews: rows.map((row: any) => ({
          ...row,
          items: itemsByReview.get(String(row.id)) || [],
        })),
        productionApplied: false,
      });
    }),
  );

  app.post(
    "/api/admin/menu-draft-reviews/import-artifact",
    isAuthenticated,
    isStaffOrAdmin,
    wrap(async (req, res) => {
      const artifact = menuDraftArtifactSchema.parse(
        req.body?.artifact || req.body || {},
      );
      const artifactPath =
        String(req.body?.artifactPath || artifact.artifactPath || "").trim() ||
        null;

      if (artifact.productionApplied === true) {
        return res.status(400).json({
          message: "Published artifacts cannot be imported as draft reviews",
        });
      }

      const unsafeEntry = artifact.entries.find(
        (entry: any) =>
          entry.productionApplied === true || entry.ownerApproved === true,
      );
      if (unsafeEntry) {
        return res.status(400).json({
          message:
            "Draft import entries must not be production-applied or owner-approved by default",
        });
      }

      let importedReviews = 0;
      let importedItems = 0;
      const reviewIds: string[] = [];

      await db.transaction(async (tx: any) => {
        for (const entry of artifact.entries) {
          const sectionOrderByName = new Map<string, number>();
          entry.importedSections.forEach((section: any, index: number) => {
            const name = String(
              section?.category || section?.name || "",
            ).trim();
            if (name) {
              sectionOrderByName.set(
                name,
                Number(
                  section?.displayOrder || section?.sortOrder || index + 1,
                ),
              );
            }
          });

          const [review] = await tx
            .insert(menuDraftReviews)
            .values({
              restaurantId: entry.truckId,
              profileId: entry.profileId || entry.truckId,
              businessName: entry.businessName,
              publicProfilePath: entry.publicProfilePath || null,
              sourceType: entry.sourceType,
              sourceUrl: entry.sourceUrl,
              sourceUrls: entry.sourceUrls as any,
              sourceArtifactPaths: entry.sourceArtifactPaths as any,
              capturedAt: toDateOrNull(entry.capturedAt),
              artifactPath,
              artifactGeneratedAt: toDateOrNull(artifact.generatedAt),
              importStatus: entry.importStatus,
              reviewStatus:
                entry.importedItems.length > 0
                  ? "pending_review"
                  : "needs_manual_extraction",
              confidence: entry.confidence,
              currentness: entry.currentness,
              ownerApprovalNeeded: true,
              ownerApproved: false,
              productionApplied: false,
              notes: entry.notes as any,
              metadata: {
                artifactType: artifact.artifactType,
                originalImportStatus: entry.importStatus,
              },
            } as any)
            .returning();

          importedReviews += 1;
          reviewIds.push(review.id);

          if (entry.importedItems.length === 0) continue;

          const draftItems = entry.importedItems.map(
            (item: any, index: number) => {
              const category = String(item.category || "Menu").trim() || "Menu";
              return {
                draftReviewId: review.id,
                restaurantId: entry.truckId,
                sectionName: category,
                sectionOrder: sectionOrderByName.get(category) || 0,
                itemName: item.itemName,
                baseItemName: item.baseItemName || item.itemName,
                variantLabel: item.variantLabel || null,
                description: item.description || null,
                priceCents: dollarsToCents(item.price, item.priceLabel),
                priceLabel: item.priceLabel || null,
                category,
                options: item.options || [],
                sourceConfidence: item.sourceConfidence || entry.confidence,
                sourceRef: item.sourceRef || entry.sourceUrl,
                ownerApprovalNeeded: true,
                ownerApproved: false,
                sortOrder: index,
                metadata: {
                  sourceType: entry.sourceType,
                  currentness: entry.currentness,
                },
              };
            },
          );

          await tx.insert(menuDraftReviewItems).values(draftItems as any);
          importedItems += draftItems.length;
        }
      });

      res.status(201).json({
        status: "draft_reviews_created",
        importedReviews,
        importedItems,
        reviewIds,
        productionApplied: false,
      });
    }),
  );

  app.post(
    "/api/admin/menu-draft-reviews/:reviewId/review",
    isAuthenticated,
    isStaffOrAdmin,
    wrap(async (req, res) => {
      const reviewId = String(req.params.reviewId || "").trim();
      const body = z
        .object({
          reviewStatus: z.enum([
            "pending_review",
            "needs_manual_extraction",
            "needs_owner_confirmation",
            "approved_for_apply",
            "rejected",
          ]),
          ownerApproved: z.boolean().default(false),
          currentness: z
            .enum(["confirmed_current", "likely_current", "unknown", "stale"])
            .optional(),
          ownerApprovalEvidenceUrl: z
            .string()
            .url()
            .optional()
            .nullable()
            .or(z.literal("")),
          reviewNote: z.string().max(2000).optional().nullable(),
        })
        .parse(req.body || {});

      if (!reviewId) {
        return res.status(400).json({ message: "reviewId is required" });
      }
      if (
        body.reviewStatus === "approved_for_apply" &&
        body.ownerApproved !== true
      ) {
        return res.status(400).json({
          message: "approved_for_apply requires ownerApproved=true",
        });
      }
      if (
        body.ownerApproved === true &&
        !String(body.ownerApprovalEvidenceUrl || "").trim() &&
        !String(body.reviewNote || "").trim()
      ) {
        return res.status(400).json({
          message: "Owner approval requires evidence URL or review note",
        });
      }

      const [updated] = await db
        .update(menuDraftReviews)
        .set({
          reviewStatus: body.reviewStatus,
          ownerApproved: body.ownerApproved,
          currentness: body.currentness || undefined,
          ownerApprovalEvidenceUrl:
            String(body.ownerApprovalEvidenceUrl || "").trim() || null,
          reviewedByUserId: req.user.id,
          reviewedAt: new Date(),
          productionApplied: false,
          updatedAt: new Date(),
          metadata: {
            lastReviewNote: String(body.reviewNote || "").trim() || null,
            lastReviewedAt: new Date().toISOString(),
          },
        } as any)
        .where(eq(menuDraftReviews.id, reviewId))
        .returning();

      if (!updated) {
        return res.status(404).json({ message: "Draft review not found" });
      }

      if (body.ownerApproved === true) {
        await db
          .update(menuDraftReviewItems)
          .set({
            ownerApproved: true,
            ownerApprovalNeeded: false,
            updatedAt: new Date(),
          } as any)
          .where(eq(menuDraftReviewItems.draftReviewId, reviewId));
      }

      res.json({ review: updated, productionApplied: false });
    }),
  );

  app.post(
    "/api/admin/menu-draft-reviews/:reviewId/apply-plan",
    isAuthenticated,
    isStaffOrAdmin,
    wrap(async (req, res) => {
      const reviewId = String(req.params.reviewId || "").trim();
      const body = z
        .object({
          mode: z.literal("plan"),
          confirmOwnerApproved: z.literal(true),
          confirmNoOverwrite: z.literal(true),
        })
        .parse(req.body || {});
      void body;

      const [review] = await db
        .select()
        .from(menuDraftReviews)
        .where(eq(menuDraftReviews.id, reviewId))
        .limit(1);
      if (!review) {
        return res.status(404).json({ message: "Draft review not found" });
      }
      if (
        !review.ownerApproved ||
        review.reviewStatus !== "approved_for_apply"
      ) {
        return res.status(409).json({
          message:
            "Draft review must be owner-approved and approved_for_apply before an apply plan can be generated",
          productionApplied: false,
        });
      }

      const activeMenus = await db
        .select({ id: menus.id })
        .from(menus)
        .where(
          and(
            eq(menus.restaurantId, review.restaurantId),
            eq(menus.isActive, true),
          ),
        );
      const activeMenuIds = activeMenus.map((menu: any) => menu.id);
      const activeItems =
        activeMenuIds.length > 0
          ? await db
              .select({ id: menuItems.id })
              .from(menuItems)
              .where(inArray(menuItems.menuId, activeMenuIds))
          : [];
      const draftItems = await db
        .select({ id: menuDraftReviewItems.id })
        .from(menuDraftReviewItems)
        .where(eq(menuDraftReviewItems.draftReviewId, reviewId));

      res.json({
        status: "apply_plan_only",
        reviewId,
        restaurantId: review.restaurantId,
        draftItemCount: draftItems.length,
        existingActiveMenuCount: activeMenus.length,
        existingActiveItemCount: activeItems.length,
        productionApplied: false,
        wouldCreateMenu: activeMenus.length === 0,
        wouldRequireOverwriteDecision: activeItems.length > 0,
        requiredSignals: [
          "confirmOwnerApproved=true",
          "confirmNoOverwrite=true",
          "reviewStatus=approved_for_apply",
          "ownerApproved=true",
        ],
      });
    }),
  );

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
        Math.min(
          50,
          Number.parseFloat(String(req.query.radiusKm || "12")) || 12,
        ),
      );
      const limit = Math.max(
        1,
        Math.min(
          60,
          Number.parseInt(String(req.query.limit || "24"), 10) || 24,
        ),
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
      const businessTypeFilter = String(req.query.businessType || "")
        .trim()
        .toLowerCase();
      const itemTypeFilter = String(req.query.itemType || "")
        .trim()
        .toLowerCase();
      const preferenceTerms = String(req.query.preferences || "")
        .toLowerCase()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);
      const viewerId = req.user?.id ? String(req.user.id) : "";
      const viewerFavoriteRestaurantIds = new Set<string>();
      const viewerFollowRestaurantIds = new Set<string>();
      const viewerRecommendationRestaurantIds = new Set<string>();
      const viewerVideoRecommendationRestaurantIds = new Set<string>();

      if (viewerId) {
        const [favoriteRows, followRows, recommendationRows, videoRows] =
          await Promise.all([
            db
              .select({ restaurantId: restaurantFavorites.restaurantId })
              .from(restaurantFavorites)
              .where(eq(restaurantFavorites.userId, viewerId)),
            db
              .select({ restaurantId: restaurantFollows.restaurantId })
              .from(restaurantFollows)
              .where(eq(restaurantFollows.userId, viewerId)),
            db
              .select({
                restaurantId: restaurantUserRecommendations.restaurantId,
              })
              .from(restaurantUserRecommendations)
              .where(eq(restaurantUserRecommendations.userId, viewerId)),
            db
              .select({ restaurantId: videoStories.restaurantId })
              .from(videoStories)
              .where(
                and(
                  eq(videoStories.userId, viewerId),
                  eq(videoStories.status, "ready"),
                  eq(videoStories.isApproved, true),
                  isNull(videoStories.deletedAt),
                  isNotNull(videoStories.restaurantId),
                ),
              ),
          ]);

        favoriteRows.forEach((row: any) =>
          viewerFavoriteRestaurantIds.add(String(row.restaurantId)),
        );
        followRows.forEach((row: any) =>
          viewerFollowRestaurantIds.add(String(row.restaurantId)),
        );
        recommendationRows.forEach((row: any) =>
          viewerRecommendationRestaurantIds.add(String(row.restaurantId)),
        );
        videoRows.forEach((row: any) => {
          if (row.restaurantId) {
            viewerVideoRecommendationRestaurantIds.add(
              String(row.restaurantId),
            );
          }
        });
      }

      const rows = await db
        .select({
          id: menuItems.id,
          name: menuItems.name,
          description: menuItems.description,
          priceCents: menuItems.priceCents,
          itemType: menuItems.itemType,
          imageUrl: menuItems.imageUrl,
          dietaryTags: menuItems.dietaryTags,
          updatedAt: menuItems.updatedAt,
          restaurantId: menuItems.restaurantId,
          restaurantName: restaurants.name,
          restaurantCity: restaurants.city,
          restaurantState: restaurants.state,
          restaurantLogoUrl: restaurants.logoUrl,
          restaurantCoverImageUrl: restaurants.coverImageUrl,
          cuisineType: restaurants.cuisineType,
          restaurantLatitude: restaurants.latitude,
          restaurantLongitude: restaurants.longitude,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
          favoriteCount: restaurants.goldenPlateCount,
          rankingScore: restaurants.rankingScore,
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

      // Dish-level "CVS score" (0-100): same rank-by-recommendations-and-
      // activity philosophy as HOME_RANKING_WEIGHTS/AWARD_RANKING_WEIGHTS,
      // applied per dish instead of per restaurant. Volume (recommendation
      // count) counts for more than the raw rating average, same ratio as
      // the restaurant-level formula.
      const dishAggregateRows = await db
        .select({
          menuItemId: menuItemRecommendations.menuItemId,
          recommendationCount: sql<number>`count(*)::int`,
          avgRating: sql<number | null>`avg(${menuItemRecommendations.rating})`,
        })
        .from(menuItemRecommendations)
        .groupBy(menuItemRecommendations.menuItemId);

      const dishAggregateByItemId = new Map<
        string,
        { recommendationCount: number; avgRating: number }
      >();
      for (const row of dishAggregateRows) {
        dishAggregateByItemId.set(String(row.menuItemId), {
          recommendationCount: Number(row.recommendationCount || 0),
          avgRating: row.avgRating != null ? Number(row.avgRating) : 0,
        });
      }

      // Exclude add-ons/modifiers (e.g. "Extra toppings") from discovery -
      // these aren't standalone dishes worth surfacing as a featured item.
      const ADDON_NAME_PATTERN =
        /^(extra|add[\s-]?on|side of|upgrade|substitut)/i;
      const discoveryRows = rows.filter(
        (row: any) => !ADDON_NAME_PATTERN.test(String(row.name || "").trim()),
      );

      const matchedRows = queryTerms.length
        ? discoveryRows.filter((row: any) => {
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
        : discoveryRows;

      const withDistance = matchedRows
        .map((row: any) => {
          if (
            businessTypeFilter &&
            !String(row.businessType || "")
              .toLowerCase()
              .includes(businessTypeFilter) &&
            !(businessTypeFilter === "food_truck" && row.isFoodTruck)
          ) {
            return null;
          }

          const itemHaystack = [
            row.name,
            row.description,
            row.itemType,
            row.cuisineType,
            row.businessType,
            ...(Array.isArray(row.dietaryTags) ? row.dietaryTags : []),
          ]
            .join(" ")
            .toLowerCase();

          if (
            itemTypeFilter &&
            (["merch", "merchandise"].includes(itemTypeFilter)
              ? row.itemType !== "merchandise"
              : itemTypeFilter === "food"
                ? row.itemType !== "food"
                : !itemHaystack.includes(itemTypeFilter))
          ) {
            return null;
          }

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

          const reasons: string[] = [];
          const signals = {
            foodMatch: 0,
            location: 0,
            preference: 0,
            favorite: 0,
            follow: 0,
            recommendation: 0,
            videoRecommendation: 0,
            freshness: 0,
            businessTrust: 0,
            businessType: 0,
          };
          let score = 0;
          if (queryTerms.length > 0) {
            const name = String(row.name || "").toLowerCase();
            const description = String(row.description || "").toLowerCase();
            const cuisine = String(row.cuisineType || "").toLowerCase();
            const matchedName = queryTerms.some((term) => name.includes(term));
            const matchedDescription = queryTerms.some((term) =>
              description.includes(term),
            );
            const matchedCuisine = queryTerms.some((term) =>
              cuisine.includes(term),
            );
            if (matchedName) {
              score += 80;
              signals.foodMatch += 80;
              reasons.push("name match");
            }
            if (matchedDescription) {
              score += 24;
              signals.foodMatch += 24;
              reasons.push("menu description match");
            }
            if (matchedCuisine) {
              score += 18;
              signals.foodMatch += 18;
              reasons.push("food type match");
            }
          }

          if (typeof distanceKm === "number") {
            const locationScore = Math.max(
              0,
              Math.round((1 - Math.min(distanceKm, radiusKm) / radiusKm) * 35),
            );
            score += locationScore;
            signals.location = locationScore;
            if (locationScore > 0) reasons.push("near you");
          }

          if (row.isFoodTruck) {
            score += 6;
            signals.businessType += 6;
            reasons.push("food truck");
          }

          const tags = Array.isArray(row.dietaryTags) ? row.dietaryTags : [];
          const preferenceMatches = preferenceTerms.filter((term) =>
            tags.some((tag: string) =>
              String(tag).toLowerCase().includes(term),
            ),
          );
          if (preferenceMatches.length > 0) {
            const preferenceScore = preferenceMatches.length * 20;
            score += preferenceScore;
            signals.preference = preferenceScore;
            reasons.push("matches preferences");
          }

          const restaurantId = String(row.restaurantId || "");
          if (viewerFavoriteRestaurantIds.has(restaurantId)) {
            score += 80;
            signals.favorite = 80;
            reasons.push("your favorite");
          }
          if (viewerVideoRecommendationRestaurantIds.has(restaurantId)) {
            score += 65;
            signals.videoRecommendation = 65;
            reasons.push("your video recommendation");
          }
          if (viewerRecommendationRestaurantIds.has(restaurantId)) {
            score += 50;
            signals.recommendation = 50;
            reasons.push("you recommended it");
          }
          if (viewerFollowRestaurantIds.has(restaurantId)) {
            score += 35;
            signals.follow = 35;
            reasons.push("you follow this place");
          }

          const updatedAtMs = row.updatedAt
            ? new Date(row.updatedAt).getTime()
            : 0;
          if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
            const ageDays = (Date.now() - updatedAtMs) / (1000 * 60 * 60 * 24);
            if (ageDays <= 14) {
              score += 8;
              signals.freshness = 8;
              reasons.push("recent menu update");
            }
          }

          const businessScore = Number(row.rankingScore || 0);
          if (businessScore > 0) {
            const trustScore = Math.min(20, Math.round(businessScore / 10));
            score += trustScore;
            signals.businessTrust = trustScore;
            reasons.push("trusted local signal");
          }

          const dishAggregate = dishAggregateByItemId.get(String(row.id));
          const dishRecommendationCount =
            dishAggregate?.recommendationCount || 0;
          const dishAvgRating = dishAggregate?.avgRating || 0;
          // Hidden until a dish has at least one recommendation - never show
          // a fabricated/placeholder score for dishes with no real signal.
          const cvsScore =
            dishRecommendationCount > 0
              ? Math.min(
                  100,
                  Math.round(
                    Math.min(70, dishRecommendationCount * 7) +
                      (dishAvgRating > 0 ? (dishAvgRating / 5) * 30 : 0),
                  ),
                )
              : null;

          return {
            ...row,
            distanceMiles:
              typeof distanceKm === "number" ? distanceKm * 0.621371 : null,
            discoveryScore: score,
            discoverySignals: signals,
            discoveryReasons: reasons.slice(0, 4),
            dishRecommendationCount,
            cvsScore,
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          const aScore = Number(a.discoveryScore || 0);
          const bScore = Number(b.discoveryScore || 0);
          if (aScore !== bScore) return bScore - aScore;
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
      const readiness = await buildOrderingReadiness(restaurantId);

      const restaurantMenus: Menu[] = await db
        .select()
        .from(menus)
        .where(
          and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)),
        )
        .orderBy(asc(menus.serviceType));

      if (restaurantMenus.length === 0) {
        return res.json({
          menus: [],
          orderingEnabled: false,
          readiness,
          restaurantName: readiness.restaurantName,
          restaurantCity: readiness.restaurantCity,
          isFoodTruck: readiness.isFoodTruck,
          cuisineType: readiness.cuisineType,
        });
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

      const [restaurantRow] = await db
        .select({
          ownerId: restaurants.ownerId,
          name: restaurants.name,
          city: restaurants.city,
          isFoodTruck: restaurants.isFoodTruck,
          cuisineType: restaurants.cuisineType,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      res.json({
        menus: result,
        orderingEnabled: readiness.orderingEnabled,
        readiness,
        restaurantName: restaurantRow?.name ?? null,
        restaurantCity: restaurantRow?.city ?? null,
        isFoodTruck: restaurantRow?.isFoodTruck ?? false,
        cuisineType: restaurantRow?.cuisineType ?? null,
      });
    }),
  );

  app.get(
    "/api/owner/restaurants/:restaurantId/ordering-readiness",
    isAuthenticated,
    canManageMenu,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(req.user, restaurantId);
      res.json(await buildOrderingReadiness(restaurantId));
    }),
  );

  app.get(
    "/api/admin/restaurants/:restaurantId/ordering-readiness",
    isAuthenticated,
    isStaffOrAdmin,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      res.json(await buildOrderingReadiness(restaurantId));
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
    canManageMenu,
    wrap(async (req, res) => {
      const { restaurantId } = req.params;
      await assertOwnsRestaurant(req.user, restaurantId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const body = insertMenuSchema.parse(req.body);
      await assertOwnsRestaurant(req.user, body.restaurantId);

      const [menu] = await db.insert(menus).values(body).returning();

      // Emit LISA claim for menu published
      db.insert(lisaClaims)
        .values({
          app: "mealscout",
          claimType: LISA_CLAIM_TYPES.MENU_PUBLISHED,
          source: LISA_CLAIM_SOURCES.MENU,
          subjectType: "menu",
          subjectId: menu.id,
          actorType: "user",
          actorId: req.user.id,
          payload: { restaurantId: body.restaurantId, menuName: menu.name },
        })
        .catch(() => {});

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
    canManageMenu,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user, menuId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      await assertOwnsMenu(req.user, menuId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const body = insertMenuCategorySchema.parse(req.body);
      await assertOwnsMenu(req.user, body.menuId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user, cat.restaurantId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { categoryId } = req.params;
      const [cat] = await db
        .select()
        .from(menuCategories)
        .where(eq(menuCategories.id, categoryId));
      if (!cat) return res.status(404).json({ message: "Category not found" });
      await assertOwnsRestaurant(req.user, cat.restaurantId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const body = insertMenuItemSchema.parse(req.body);
      await assertOwnsMenu(req.user, body.menuId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user, itemId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user, itemId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user, itemId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user, itemId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { itemId } = req.params;
      await assertOwnsMenuItem(req.user, itemId);

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
    canManageMenu,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { imported, skipped, errors } = await parseMenuCsv(
        req.file.buffer,
        menuId,
        menu.restaurantId,
      );

      // Download + re-host any item images so they persist on MealScout.
      await rehostImportedImages(imported);

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
    canManageMenu,
    aiMenuImportLimiter,
    upload.single("file"),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

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
    canManageMenu,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

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

      // Download + re-host any item images so they persist on MealScout.
      await rehostImportedImages(imported);

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
   * POST /api/owner/menus/:menuId/import/photo
   * Extract menu items from photos of a menu board / printed menu and/or dish
   * photos via AI vision. Dish photos are re-hosted and attached as item images
   * so the imported menu can include photos, not just text.
   */
  app.post(
    "/api/owner/menus/:menuId/import/photo",
    isAuthenticated,
    canManageMenu,
    aiMenuImportLimiter,
    imageUpload.array("files", 8),
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

      const files = (req.files as any[]) || [];
      const usable = files.filter((f) => isSupportedMenuPhotoImage(f.mimetype));
      if (usable.length === 0) {
        return res.status(400).json({
          message: "Upload at least one JPEG, PNG, WebP, or HEIC photo.",
        });
      }

      const { imported, skipped, errors } = await parseImageMenuWithAi(
        usable.map((f) => ({ buffer: f.buffer, mediaType: f.mimetype })),
        menuId,
        menu.restaurantId,
      );

      // Re-host uploaded photos so a dish photo can back its menu item. The
      // hostedUrls array is aligned to `usable`, matching the parser's
      // image_index values.
      const hostedUrls = await rehostImageBuffers(
        usable.map((f) => f.buffer),
        "menu-items",
      );
      for (const item of imported) {
        if (item.imageIndex != null && hostedUrls[item.imageIndex]) {
          item.imageUrl = hostedUrls[item.imageIndex];
        }
      }

      // Drop the transient imageIndex before inserting.
      const rows = imported.map(({ imageIndex, ...rest }) => rest);
      if (rows.length > 0) {
        await db.insert(menuItems).values(rows);
      }

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: "photo",
        fileName: usable
          .map((f) => f.originalname)
          .join(", ")
          .slice(0, 500),
        itemsImported: rows.length,
        itemsSkipped: skipped,
        errors: errors as any,
        status: errors.length > 0 && rows.length === 0 ? "failed" : "complete",
      });

      await db
        .update(menus)
        .set({
          importSource: "photo",
          importedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.json({ imported: rows.length, skipped, errors });
    }),
  );

  /**
   * POST /api/owner/menus/:menuId/pos-connection-request
   * Capture a POS/menu-source connection request so operators can keep moving
   * even before full OAuth/API sync is available for every provider.
   */
  app.post(
    "/api/owner/menus/:menuId/pos-connection-request",
    isAuthenticated,
    canManageMenu,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

      const bodySchema = z.object({
        source: z.enum([
          "toast",
          "square",
          "clover",
          "website",
          "ubereats",
          "doordash",
          "gmb",
          "other",
        ]),
        sourceUrl: z.string().url().optional().nullable().or(z.literal("")),
        notes: z.string().max(1000).optional().nullable(),
      });

      const body = bodySchema.parse(req.body || {});
      const sourceUrl = String(body.sourceUrl || "").trim();
      const notes = String(body.notes || "").trim();

      await db.insert(menuImportLogs).values({
        restaurantId: menu.restaurantId,
        importedByUserId: req.user.id,
        source: body.source,
        fileName: sourceUrl || null,
        itemsImported: 0,
        itemsSkipped: 0,
        errors: [
          {
            type: "pos_connection_request",
            source: body.source,
            sourceUrl: sourceUrl || null,
            notes: notes || null,
            requestedAt: new Date().toISOString(),
          },
        ] as any,
        status: "pending",
      });

      await db
        .update(menus)
        .set({
          importSource: body.source,
          updatedAt: new Date(),
        })
        .where(eq(menus.id, menuId));

      res.status(202).json({
        ok: true,
        status: "pending",
        message:
          "Connection request saved. MealScout can use this source while the direct sync is being connected.",
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
    canManageMenu,
    wrap(async (req, res) => {
      const { menuId } = req.params;
      const menu = await assertOwnsMenu(req.user, menuId);

      const logs = await db
        .select()
        .from(menuImportLogs)
        .where(eq(menuImportLogs.restaurantId, menu.restaurantId))
        .orderBy(menuImportLogs.createdAt);

      res.json({ logs });
    }),
  );

  /**
   * POST /api/menu-items/:menuItemId/recommend
   * Create/refresh a dish recommendation with optional proof photo.
   * Proof photo is always pending until accepted/featured by business/admin.
   */
  app.post(
    "/api/menu-items/:menuItemId/recommend",
    isAuthenticated,
    imageUpload.single("image"),
    wrap(async (req, res) => {
      const menuItemId = String(req.params.menuItemId || "").trim();
      if (!menuItemId) {
        throw Object.assign(new Error("menuItemId is required"), {
          statusCode: 400,
        });
      }

      const [item] = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, menuItemId))
        .limit(1);
      if (!item) {
        throw Object.assign(new Error("Menu item not found"), {
          statusCode: 404,
        });
      }

      const payload = z
        .object({
          comment: z.string().max(500).optional().nullable(),
          rating: z.number().int().min(1).max(5).optional().nullable(),
          caption: z.string().max(280).optional().nullable(),
          aiGenerated: z.boolean().optional(),
        })
        .parse(req.body || {});

      if (payload.aiGenerated === true) {
        throw Object.assign(
          new Error("AI-generated dish images are not allowed as proof photos"),
          { statusCode: 400 },
        );
      }

      const existing = await db
        .select()
        .from(menuItemRecommendations)
        .where(
          and(
            eq(menuItemRecommendations.menuItemId, menuItemId),
            eq(menuItemRecommendations.userId, req.user.id),
          ),
        )
        .limit(1);

      let recommendation = existing[0] || null;
      if (!recommendation) {
        // One recommended dish per restaurant per user, for accuracy/fairness -
        // a user picking a new favorite dish at a restaurant they've already
        // picked one at must remove that pick first (DELETE this same route).
        const existingAtRestaurant = await db
          .select({ id: menuItemRecommendations.id })
          .from(menuItemRecommendations)
          .where(
            and(
              eq(menuItemRecommendations.restaurantId, item.restaurantId),
              eq(menuItemRecommendations.userId, req.user.id),
            ),
          )
          .limit(1);
        if (existingAtRestaurant.length > 0) {
          throw Object.assign(
            new Error(
              "You can recommend one dish per restaurant. Remove your current pick to choose a different one.",
            ),
            { statusCode: 400 },
          );
        }

        const insertComment = String(payload.comment || "").trim() || null;
        const toInsert = insertMenuItemRecommendationSchema.parse({
          restaurantId: item.restaurantId,
          menuItemId,
          userId: req.user.id,
          comment: insertComment,
          rating: payload.rating ?? null,
        });
        const [inserted] = await db
          .insert(menuItemRecommendations)
          .values(toInsert as any)
          .returning();
        recommendation = inserted;

        // Bare = 1 point. If detail is already attached on this first tap
        // (comment present), it carries the same extra weight a later edit
        // would - see the enrichment branch below for the same rule.
        await db
          .update(users)
          .set({
            recommendationCount: sql`${users.recommendationCount} + 1`,
            influenceScore: sql`${users.influenceScore} + ${insertComment ? 3 : 1}`,
            reviewCount: insertComment
              ? sql`${users.reviewCount} + 1`
              : users.reviewCount,
            updatedAt: new Date(),
          } as any)
          .where(eq(users.id, req.user.id));
      } else {
        const hadComment = Boolean(recommendation.comment);
        const nextComment = String(payload.comment || "").trim() || null;
        const nextRating = payload.rating ?? null;
        const [updated] = await db
          .update(menuItemRecommendations)
          .set({
            comment: nextComment,
            rating: nextRating,
            updatedAt: new Date(),
          } as any)
          .where(eq(menuItemRecommendations.id, recommendation.id))
          .returning();
        recommendation = updated || recommendation;

        // Only counts once - the moment it transitions from bare to carrying
        // detail. Editing an already-detailed pick again doesn't re-count.
        if (!hadComment && nextComment) {
          await db
            .update(users)
            .set({
              reviewCount: sql`${users.reviewCount} + 1`,
              influenceScore: sql`${users.influenceScore} + 2`,
              updatedAt: new Date(),
            } as any)
            .where(eq(users.id, req.user.id));
        }
      }

      let photo: any = null;
      if (req.file) {
        if (!isCloudinaryConfigured()) {
          throw Object.assign(
            new Error("Image upload service not configured"),
            {
              statusCode: 503,
            },
          );
        }
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "menu-item-photos",
          `menu-item-${menuItemId}-${Date.now()}`,
        );

        const [createdPhoto] = await db
          .insert(menuItemPhotos)
          .values({
            restaurantId: item.restaurantId,
            menuItemId,
            sourceUserId: req.user.id,
            recommendationId: recommendation.id,
            imageUrl: uploadResult.secureUrl,
            thumbnailUrl: uploadResult.thumbnailUrl,
            cloudinaryPublicId: uploadResult.publicId,
            caption: String(payload.caption || "").trim() || null,
            status: "pending",
            moderationStatus: "pending",
            featuredByBusiness: false,
          } as any)
          .returning();

        await db.insert(imageUploads).values({
          uploadedByUserId: req.user.id,
          imageType: "menu_item_photo",
          entityId: menuItemId,
          entityType: "menu_item",
          cloudinaryPublicId: uploadResult.publicId,
          cloudinaryUrl: uploadResult.secureUrl,
          thumbnailUrl: uploadResult.thumbnailUrl,
          width: uploadResult.width,
          height: uploadResult.height,
          fileSize: uploadResult.bytes,
          mimeType: req.file.mimetype,
        } as any);

        photo = createdPhoto;
      }

      res.status(201).json({
        recommendation,
        photoStatus: photo
          ? {
              id: photo.id,
              status: photo.status,
              moderationStatus: photo.moderationStatus,
            }
          : null,
      });
    }),
  );

  /**
   * DELETE /api/menu-items/:menuItemId/recommend
   * Remove the caller's own recommendation for this dish - the escape hatch
   * for the one-dish-per-restaurant cap enforced above.
   */
  app.delete(
    "/api/menu-items/:menuItemId/recommend",
    isAuthenticated,
    wrap(async (req, res) => {
      const menuItemId = String(req.params.menuItemId || "").trim();
      if (!menuItemId) {
        throw Object.assign(new Error("menuItemId is required"), {
          statusCode: 400,
        });
      }

      const [existing] = await db
        .select()
        .from(menuItemRecommendations)
        .where(
          and(
            eq(menuItemRecommendations.menuItemId, menuItemId),
            eq(menuItemRecommendations.userId, req.user.id),
          ),
        )
        .limit(1);

      if (!existing) {
        return res.json({ success: true });
      }

      await db
        .delete(menuItemRecommendations)
        .where(eq(menuItemRecommendations.id, existing.id));

      const hadComment = Boolean(existing.comment);
      await db
        .update(users)
        .set({
          recommendationCount: sql`GREATEST(${users.recommendationCount} - 1, 0)`,
          influenceScore: sql`GREATEST(${users.influenceScore} - ${hadComment ? 3 : 1}, 0)`,
          reviewCount: hadComment
            ? sql`GREATEST(${users.reviewCount} - 1, 0)`
            : users.reviewCount,
          updatedAt: new Date(),
        } as any)
        .where(eq(users.id, req.user.id));

      res.json({ success: true });
    }),
  );

  app.get(
    "/api/menu-items/:menuItemId/my-recommendation",
    isAuthenticated,
    wrap(async (req, res) => {
      const menuItemId = String(req.params.menuItemId || "").trim();
      const [recommendation] = await db
        .select()
        .from(menuItemRecommendations)
        .where(
          and(
            eq(menuItemRecommendations.menuItemId, menuItemId),
            eq(menuItemRecommendations.userId, req.user.id),
          ),
        )
        .limit(1);

      const photos = recommendation
        ? await db
            .select()
            .from(menuItemPhotos)
            .where(eq(menuItemPhotos.recommendationId, recommendation.id))
            .orderBy(menuItemPhotos.createdAt)
        : [];

      res.json({
        recommendation: recommendation || null,
        photos: photos.map((photo: any) => ({
          id: photo.id,
          status: photo.status,
          moderationStatus: photo.moderationStatus,
          imageUrl: photo.imageUrl,
          thumbnailUrl: photo.thumbnailUrl,
          caption: photo.caption,
          createdAt: photo.createdAt,
        })),
      });
    }),
  );

  /**
   * GET /api/restaurants/:restaurantId/featured-item
   * Three-tier resolution for the one dish spotlighted on discovery cards:
   *   1. Owner's manual pick (restaurants.featuredMenuItemId), if set.
   *   2. The dish with the most community recommendations at this restaurant.
   *   3. The first available menu item, as a last resort.
   * Returns { item: {...} | null, source: "owner" | "community" | "fallback" | null }.
   */
  app.get(
    "/api/restaurants/:restaurantId/featured-item",
    wrap(async (req, res) => {
      const restaurantId = String(req.params.restaurantId || "").trim();
      if (!restaurantId) {
        throw Object.assign(new Error("restaurantId is required"), {
          statusCode: 400,
        });
      }

      const selectItemFields = {
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        priceCents: menuItems.priceCents,
        imageUrl: menuItems.imageUrl,
      };

      const [restaurant] = await db
        .select({ featuredMenuItemId: restaurants.featuredMenuItemId })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (restaurant?.featuredMenuItemId) {
        const [ownerPick] = await db
          .select(selectItemFields)
          .from(menuItems)
          .where(
            and(
              eq(menuItems.id, restaurant.featuredMenuItemId),
              eq(menuItems.restaurantId, restaurantId),
              eq(menuItems.isAvailable, true),
            ),
          )
          .limit(1);
        if (ownerPick) {
          return res.json({ item: ownerPick, source: "owner" });
        }
        // Owner's pick no longer exists/available - fall through below
        // rather than erroring, since there's no FK enforcing this stays valid.
      }

      const [topRecommended] = await db
        .select({
          ...selectItemFields,
          recommendationCount:
            sql<number>`count(${menuItemRecommendations.id})`.as(
              "recommendation_count",
            ),
        })
        .from(menuItemRecommendations)
        .innerJoin(
          menuItems,
          eq(menuItems.id, menuItemRecommendations.menuItemId),
        )
        .where(
          and(
            eq(menuItemRecommendations.restaurantId, restaurantId),
            eq(menuItems.isAvailable, true),
          ),
        )
        .groupBy(
          menuItems.id,
          menuItems.name,
          menuItems.description,
          menuItems.priceCents,
          menuItems.imageUrl,
        )
        .orderBy(desc(sql`count(${menuItemRecommendations.id})`))
        .limit(1);

      if (topRecommended) {
        const { recommendationCount, ...item } = topRecommended;
        return res.json({ item, source: "community" });
      }

      const [fallbackItem] = await db
        .select(selectItemFields)
        .from(menuItems)
        .innerJoin(menus, eq(menus.id, menuItems.menuId))
        .where(
          and(
            eq(menuItems.restaurantId, restaurantId),
            eq(menuItems.isAvailable, true),
            eq(menus.isActive, true),
          ),
        )
        .orderBy(asc(menuItems.sortOrder))
        .limit(1);

      res.json({
        item: fallbackItem || null,
        source: fallbackItem ? "fallback" : null,
      });
    }),
  );

  app.patch(
    "/api/menu-item-photos/:photoId/moderate",
    isAuthenticated,
    wrap(async (req, res) => {
      const photoId = String(req.params.photoId || "").trim();
      const payload = z
        .object({
          action: z.enum(["accept", "reject", "feature", "unfeature"]),
          reason: z.string().max(500).optional().nullable(),
        })
        .parse(req.body || {});

      const [photo] = await db
        .select()
        .from(menuItemPhotos)
        .where(eq(menuItemPhotos.id, photoId))
        .limit(1);
      if (!photo) {
        throw Object.assign(new Error("Photo not found"), { statusCode: 404 });
      }

      const isPrivileged = [
        "staff",
        "admin",
        "duper_admin",
        "super_admin",
      ].includes(String(req.user?.userType || ""));
      if (!isPrivileged) {
        await assertOwnsRestaurant(req.user, String(photo.restaurantId));
      }

      if (payload.action === "feature") {
        await db
          .update(menuItemPhotos)
          .set({
            status: "accepted",
            moderationStatus: "accepted",
            featuredByBusiness: false,
            updatedAt: new Date(),
          } as any)
          .where(
            and(
              eq(menuItemPhotos.menuItemId, photo.menuItemId),
              eq(menuItemPhotos.featuredByBusiness, true),
            ),
          );
      }

      const nextStatus =
        payload.action === "accept"
          ? "accepted"
          : payload.action === "reject"
            ? "rejected"
            : payload.action === "feature"
              ? "featured"
              : "accepted";
      const isFeature = payload.action === "feature";
      const isReject = payload.action === "reject";

      const [updated] = await db
        .update(menuItemPhotos)
        .set({
          status: nextStatus,
          moderationStatus: nextStatus,
          featuredByBusiness: isFeature,
          rejectedReason: isReject
            ? String(payload.reason || "").trim() || null
            : null,
          reviewedByUserId: req.user.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(menuItemPhotos.id, photoId))
        .returning();

      const scoreBumps: number[] = [];
      if (
        (payload.action === "accept" || payload.action === "feature") &&
        !photo.scorePhotoAwardedAt
      ) {
        scoreBumps.push(8); // +3 submission proof +5 accepted
        await db
          .update(menuItemPhotos)
          .set({ scorePhotoAwardedAt: new Date() } as any)
          .where(eq(menuItemPhotos.id, photoId));
      }
      if (payload.action === "feature" && !photo.scoreFeaturedAwardedAt) {
        scoreBumps.push(10);
        await db
          .update(menuItemPhotos)
          .set({ scoreFeaturedAwardedAt: new Date() } as any)
          .where(eq(menuItemPhotos.id, photoId));
      }
      if (scoreBumps.length) {
        const bump = scoreBumps.reduce((sum, value) => sum + value, 0);
        await db
          .update(users)
          .set({
            influenceScore: sql`${users.influenceScore} + ${bump}`,
            updatedAt: new Date(),
          } as any)
          .where(eq(users.id, String(photo.sourceUserId)));
      }

      res.json({ photo: updated });
    }),
  );

  app.get(
    "/api/menu-items/:menuItemId/photos/public",
    wrap(async (req, res) => {
      const menuItemId = String(req.params.menuItemId || "").trim();
      const photos = await db
        .select({
          id: menuItemPhotos.id,
          imageUrl: menuItemPhotos.imageUrl,
          thumbnailUrl: menuItemPhotos.thumbnailUrl,
          caption: menuItemPhotos.caption,
          status: menuItemPhotos.status,
          featuredByBusiness: menuItemPhotos.featuredByBusiness,
          createdAt: menuItemPhotos.createdAt,
        })
        .from(menuItemPhotos)
        .where(
          and(
            eq(menuItemPhotos.menuItemId, menuItemId),
            inArray(menuItemPhotos.status, ["accepted", "featured"] as any),
          ),
        )
        .orderBy(menuItemPhotos.createdAt);

      res.json({ photos });
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
    itemType: "food" | "merchandise";
    imageUrl: string | null;
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

      // Delivery/POS exports carry item photos under many field names, and
      // sometimes as an array of strings or {url} objects.
      const rawImages = Array.isArray(row.images)
        ? row.images
        : Array.isArray(row.photos)
          ? row.photos
          : [];
      const firstImage = rawImages[0];
      const imageUrl =
        String(
          row.imageUrl ||
            row.image_url ||
            row.imageURL ||
            row.image ||
            row.photo ||
            row.photoUrl ||
            row.photo_url ||
            (firstImage && typeof firstImage === "object"
              ? firstImage.url || firstImage.src
              : firstImage) ||
            "",
        ).trim() || null;

      imported.push({
        menuId,
        restaurantId,
        name,
        description,
        priceCents,
        itemType:
          String(row.itemType || row.item_type || row.type || "")
            .trim()
            .toLowerCase() === "merchandise" ||
          String(row.itemType || row.item_type || row.type || "")
            .trim()
            .toLowerCase() === "merch"
            ? "merchandise"
            : "food",
        imageUrl,
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
