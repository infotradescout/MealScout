import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { db } from "../db";
import { storage } from "../storage";
import {
  restaurants,
  supplierOrders,
  supplierOrderItems,
  supplierProducts,
  supplierRequests,
  supplierRequestItems,
  supplyItemAliases,
  supplyItems,
  supplyOrderPreferences,
  supplyPriceAlerts,
  supplyPriceDailySnapshots,
  supplyPrices,
  supplyPriceWatches,
  supplyDemandNotifications,
  supplyDemands,
  supplyShoppingListItems,
  supplyShoppingLists,
  supplyStoreLocations,
  supplyStores,
  suppliers,
} from "@shared/schema";
import { and, desc, eq, ilike, inArray, lt, or } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import multer from "multer";
import { parseTabularFile } from "../utils/tabularImport";
import { emailService } from "../emailService";
import { decideSupplierIntentHandling } from "../utils/supplierPaymentIntent";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { requireIdempotencyKey } from "../middleware/idempotency";
import { enqueueInProcessJob } from "../jobs/jobQueue";

const createSupplierOrderLimiter = distributedRateLimit({
  scope: "supplier_orders_create",
  limit: 40,
  windowMs: 60 * 1000,
  key: (req) => String((req as any)?.user?.id || req.ip || "unknown"),
});
const supplierPayIntentLimiter = distributedRateLimit({
  scope: "supplier_order_pay_intent",
  limit: 20,
  windowMs: 60 * 1000,
  key: (req) => String((req as any)?.user?.id || req.ip || "unknown"),
});
const supplierOrderIdempotency = requireIdempotencyKey({
  scope: "supplier_orders_create",
  ttlMs: 24 * 60 * 60 * 1000,
});
const supplierPayIntentIdempotency = requireIdempotencyKey({
  scope: "supplier_order_pay_intent",
  ttlMs: 24 * 60 * 60 * 1000,
});

const parsePageLimit = (
  raw: unknown,
  fallback: number,
  max: number,
) => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

const parseBeforeTimestamp = (raw: unknown) => {
  const value = String(raw || "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const computeOnPlatformPaymentFees = (supplierGrossCents: number) => {
  const gross = Math.max(0, Math.round(Number(supplierGrossCents || 0)));

  // Platform keeps a fixed $1 on supplier on-platform transactions by default.
  const platformBaseFeeCents =
    Math.max(0, Number(process.env.SUPPLIER_ORDER_PLATFORM_FIXED_CENTS || 100) || 100);

  // Stripe processing estimate (cards are 2.9% + $0.30 by default).
  const stripeFeeBps = Math.max(0, Number(process.env.SUPPLIER_ORDER_STRIPE_FEE_BPS || 290) || 290);
  const stripeFeeFixed = Math.max(0, Number(process.env.SUPPLIER_ORDER_STRIPE_FEE_FIXED_CENTS || 30) || 30);
  const stripeFeeEstimateCents =
    Math.max(0, Math.round((gross * stripeFeeBps) / 10_000)) + stripeFeeFixed;

  // Optional MealScout processing overhead to include in split.
  const msProcessingFeeBps = Math.max(
    0,
    Number(process.env.SUPPLIER_ORDER_MS_PROCESSING_FEE_BPS || 0) || 0,
  );
  const msProcessingFeeFixedCents = Math.max(
    0,
    Number(process.env.SUPPLIER_ORDER_MS_PROCESSING_FIXED_CENTS || 0) || 0,
  );
  const msProcessingFeeCents =
    Math.max(0, Math.round((gross * msProcessingFeeBps) / 10_000)) + msProcessingFeeFixedCents;

  const processingTotalCents = stripeFeeEstimateCents + msProcessingFeeCents;

  // Split processing costs between buyer and seller.
  const buyerProcessingFeeCents = Math.ceil(processingTotalCents / 2);
  const sellerProcessingFeeCents = Math.max(0, processingTotalCents - buyerProcessingFeeCents);

  // `platformFeeCents` is what seller contributes to the platform side.
  const platformFeeCents = platformBaseFeeCents + sellerProcessingFeeCents;

  // Buyer pays: supplier gross + buyer share + $1 platform fee.
  const totalCents = gross + buyerProcessingFeeCents + platformBaseFeeCents;

  return {
    platformBaseFeeCents,
    platformFeeCents,
    stripeFeeEstimateCents,
    msProcessingFeeCents,
    processingTotalCents,
    buyerProcessingFeeCents,
    sellerProcessingFeeCents,
    totalCents,
  };
};

const estimateCardProcessingFeeCents = (amountCents: number) => {
  const amount = Math.max(0, Math.round(Number(amountCents || 0)));
  const cardBps = Math.max(0, Number(process.env.SUPPLIER_ORDER_STRIPE_FEE_BPS || 290) || 290);
  const cardFixed = Math.max(
    0,
    Number(process.env.SUPPLIER_ORDER_STRIPE_FEE_FIXED_CENTS || 30) || 30,
  );
  return Math.max(0, Math.round((amount * cardBps) / 10_000)) + cardFixed;
};

const estimateAchProcessingFeeCents = (amountCents: number) => {
  const amount = Math.max(0, Math.round(Number(amountCents || 0)));
  const achBps = Math.max(0, Number(process.env.SUPPLIER_ORDER_ACH_FEE_BPS || 80) || 80);
  const achFixed = Math.max(0, Number(process.env.SUPPLIER_ORDER_ACH_FEE_FIXED_CENTS || 0) || 0);
  const achCapRaw = String(process.env.SUPPLIER_ORDER_ACH_FEE_CAP_CENTS || "").trim();
  const achCapCents =
    achCapRaw === "" ? 500 : Math.max(0, Number(process.env.SUPPLIER_ORDER_ACH_FEE_CAP_CENTS || 0) || 0);

  const percentPart = Math.max(0, Math.round((amount * achBps) / 10_000));
  const uncapped = percentPart + achFixed;
  if (achCapCents > 0) return Math.min(uncapped, achCapCents);
  return uncapped;
};

const computeAchCheaperThresholdCents = () => {
  const minAmount = Math.max(
    1,
    Number(process.env.SUPPLIER_ORDER_ACH_CHEAPER_MIN_SCAN_CENTS || 100) || 100,
  );
  const maxAmount = Math.max(
    minAmount,
    Number(process.env.SUPPLIER_ORDER_ACH_CHEAPER_MAX_SCAN_CENTS || 500_000) || 500_000,
  );
  const step = Math.max(1, Number(process.env.SUPPLIER_ORDER_ACH_CHEAPER_SCAN_STEP_CENTS || 1) || 1);

  for (let amount = minAmount; amount <= maxAmount; amount += step) {
    if (estimateAchProcessingFeeCents(amount) <= estimateCardProcessingFeeCents(amount)) {
      return amount;
    }
  }

  return maxAmount;
};

const normalizeSupplyKey = (raw: string) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const haversineMiles = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613; // earth radius (miles)
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

async function resolveBuyerRestaurantOrThrow(req: any, buyerRestaurantId: string) {
  const buyerRestaurant = await storage.getRestaurant(buyerRestaurantId);
  if (!buyerRestaurant || String(buyerRestaurant.ownerId) !== String(req.user.id)) {
    throw new Error("Not authorized");
  }
  return buyerRestaurant;
}

async function resolveBuyerRestaurantOrNull(req: any, buyerRestaurantId: unknown) {
  const id = String(buyerRestaurantId || "").trim();
  if (!id) return null;
  return resolveBuyerRestaurantOrThrow(req, id);
}

async function resolveSupplyShoppingListOrThrow(req: any, listId: string) {
  const [list] = await db
    .select()
    .from(supplyShoppingLists)
    .where(eq(supplyShoppingLists.id, String(listId)))
    .limit(1);
  if (!list) throw new Error("List not found");
  if (String((list as any).ownerUserId) !== String(req.user.id)) {
    throw new Error("Not authorized");
  }
  return list as any;
}

async function findLocalSuppliersForBuyer(buyerRestaurant: any) {
  const radiusMiles = Number(process.env.SUPPLY_LOCAL_RADIUS_MILES || 75) || 75;
  const limit = Math.min(Number(process.env.SUPPLY_LOCAL_SUPPLIER_LIMIT || 60) || 60, 200);

  const conditions: any[] = [eq(suppliers.isActive, true)];
  const buyerState = String((buyerRestaurant as any).state || "").trim();
  if (buyerState) conditions.push(eq(suppliers.state, buyerState));

  const candidates = await db
    .select()
    .from(suppliers)
    .where(and(...conditions))
    .orderBy(desc(suppliers.updatedAt))
    .limit(500);

  const buyerLat = Number((buyerRestaurant as any).latitude);
  const buyerLon = Number((buyerRestaurant as any).longitude);
  const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);

  if (!hasBuyerCoords) {
    return candidates.slice(0, limit);
  }

  const withDistance = (candidates as any[])
    .map((s: any) => {
      const lat = Number(s.latitude);
      const lon = Number(s.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const distanceMiles = haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon });
      return { supplier: s, distanceMiles };
    })
    .filter(Boolean) as Array<{ supplier: any; distanceMiles: number }>;

  return withDistance
    .filter((r) => r.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, limit)
    .map((r) => r.supplier);
}

async function searchSupplierProductsForTerms(params: {
  terms: string[];
  buyerRestaurant: any | null;
  limit: number;
}) {
  const terms = params.terms
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  if (terms.length === 0) return [];

  const conditions: any[] = [
    eq(supplierProducts.isActive, true),
    eq(suppliers.isActive, true),
  ];

  const buyerState = params.buyerRestaurant
    ? String((params.buyerRestaurant as any).state || "").trim()
    : "";
  if (buyerState) conditions.push(eq(suppliers.state, buyerState));

  const orConditions: any[] = [];
  for (const t of terms) {
    orConditions.push(ilike(supplierProducts.name, `%${t}%`));
    orConditions.push(ilike(supplierProducts.sku, `%${t}%`));
  }
  conditions.push(or(...orConditions));

  return db
    .select({
      product: supplierProducts,
      supplier: suppliers,
    })
    .from(supplierProducts)
    .innerJoin(suppliers, eq(supplierProducts.supplierId, suppliers.id))
    .where(and(...conditions))
    .orderBy(desc(supplierProducts.updatedAt))
    .limit(Math.min(Math.max(params.limit, 50), 1500));
}

async function recordDemandAndNotifyIfUnlisted(params: {
  buyerRestaurant?: any | null;
  itemNameRaw: string;
  quantity?: number | null;
  source: "manual" | "request" | "import";
}) {
  const itemName = String(params.itemNameRaw || "").trim();
  const itemKey = normalizeSupplyKey(itemName);
  if (!itemKey) return { created: false, notified: 0, reason: "empty_key" };

  const [existing] = await db
    .select({ id: supplierProducts.id })
    .from(supplierProducts)
    .where(
      and(
        eq(supplierProducts.isActive, true),
        or(
          ilike(supplierProducts.name, `%${itemName}%`),
          ilike(supplierProducts.sku, `%${itemName}%`),
        ),
      ),
    )
    .limit(1);
  if (existing) return { created: false, notified: 0, reason: "already_listed" };

  const now = new Date();
  const buyer = params.buyerRestaurant ?? null;
  const [demand] = await db
    .insert(supplyDemands)
    .values({
      buyerRestaurantId: buyer ? String((buyer as any).id) : null,
      itemKey,
      itemName,
      quantity: params.quantity ?? null,
      buyerCity: buyer ? ((buyer as any).city ?? null) : null,
      buyerState: buyer ? ((buyer as any).state ?? null) : null,
      buyerLatitude: buyer ? ((buyer as any).latitude ?? null) : null,
      buyerLongitude: buyer ? ((buyer as any).longitude ?? null) : null,
      source: params.source,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();

  const notifyEnabled =
    String(process.env.SUPPLY_DEMAND_NOTIFY || "").toLowerCase() !== "false";
  if (!notifyEnabled) return { created: true, notified: 0, demandId: demand?.id };
  if (!buyer) return { created: true, notified: 0, demandId: demand?.id };

  const localSuppliers = await findLocalSuppliersForBuyer(buyer);
  if (localSuppliers.length === 0) return { created: true, notified: 0, demandId: demand?.id };

  const supplierIds = localSuppliers.map((s: any) => String(s.id));
  const existingNotifs = await db
    .select()
    .from(supplyDemandNotifications)
    .where(
      and(
        eq(supplyDemandNotifications.itemKey, itemKey),
        inArray(supplyDemandNotifications.supplierId, supplierIds),
      ),
    );

  const notifBySupplierId = new Map<string, any>(
    (existingNotifs as any[]).map((n: any) => [String(n.supplierId), n]),
  );

  const ttlHours = Number(process.env.SUPPLY_DEMAND_NOTIFY_TTL_HOURS || 24) || 24;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  const nowMs = now.getTime();

  const toNotify = (localSuppliers as any[]).filter((s: any) => {
    const n = notifBySupplierId.get(String(s.id));
    if (!n) return true;
    const last = n.lastNotifiedAt ? new Date(n.lastNotifiedAt).getTime() : 0;
    return nowMs - last > ttlMs;
  });

  let notified = 0;
  for (const supplier of toNotify) {
    try {
      const supplierUser = await storage.getUser(String((supplier as any).userId)).catch(
        () => null,
      );
      const to =
        String((supplier as any).contactEmail || "").trim() ||
        String((supplierUser as any)?.email || "").trim();
      if (!to) continue;

      const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
      const manageUrl = `${baseUrl.replace(/\/+$/, "")}/supplier/dashboard`;
      const location = [params.buyerRestaurant.city, params.buyerRestaurant.state]
        .map((s: any) => String(s || "").trim())
        .filter(Boolean)
        .join(", ");
      const subject = location
        ? `In-demand item near ${location}: ${itemName}`
        : `In-demand item: ${itemName}`;
      const html = `
        <h2>Item in demand</h2>
        <p><strong>Item:</strong> ${itemName}</p>
        ${location ? `<p><strong>Area:</strong> ${location}</p>` : ""}
        <p>A local vendor searched for this item but it isn't listed yet.</p>
        <p style="margin: 18px 0;">
          <a href="${manageUrl}" class="cta-button">Add it to your catalog</a>
        </p>
      `;
      enqueueInProcessJob("supply-demand-email", async () => {
        await emailService.sendBasicEmail(to, subject, html, undefined, "general");
      });

      await db
        .insert(supplyDemandNotifications)
        .values({
          supplierId: String((supplier as any).id),
          itemKey,
          lastNotifiedAt: now,
        } as any)
        .onConflictDoUpdate({
          target: [supplyDemandNotifications.supplierId, supplyDemandNotifications.itemKey] as any,
          set: { lastNotifiedAt: now } as any,
        });

      notified += 1;
    } catch (e) {
      console.warn("Demand notify failed:", e);
    }
  }

  return { created: true, notified, demandId: demand?.id };
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function ensureSupplierProfile(userId: string) {
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.userId, userId))
    .limit(1);
  if (existing) return existing;

  const user = await storage.getUser(userId).catch(() => null);

  const [created] = await db
    .insert(suppliers)
    .values({
      userId,
      businessName: "New Supplier",
      contactEmail: (user as any)?.email ?? null,
      isActive: true,
    } as any)
    .returning();
  return created;
}

const isSupplierProfileOrAdmin = async (req: any, res: any, next: any) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user?.isDisabled) {
    return res.status(403).json({ error: "Account disabled" });
  }

  const userType = String(req.user?.userType || "");
  if (["supplier", "admin", "super_admin"].includes(userType)) {
    return next();
  }

  try {
    const [existing] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.userId, String(req.user.id)))
      .limit(1);

    if (existing) {
      return next();
    }
  } catch (error) {
    console.error("Error checking supplier profile access:", error);
    return res.status(500).json({ message: "Failed to verify supplier access" });
  }

  return res.status(403).json({
    error: "Forbidden",
    message: "Supplier profile required",
  });
};

async function ensureSupplyOrderPreferences(userId: string) {
  const [existing] = await db
    .select()
    .from(supplyOrderPreferences)
    .where(eq(supplyOrderPreferences.userId, userId))
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const [created] = await db
    .insert(supplyOrderPreferences)
    .values({
      userId,
      maxStops: 2,
      maxRadiusMiles: 20,
      costPerStopCents: 0,
      stopMinutes: 10,
      costPerMinuteCents: 0,
      pingSuppliers: true,
      allowSubstitutions: true,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return created;
}

const toDayKey = (value: Date) => {
  const yyyy = value.getUTCFullYear();
  const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(value.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

async function resolveSupplyItemIds(params: { itemKey?: string | null; itemName?: string | null }) {
  const rawKey = String(params.itemKey || "").trim();
  const rawName = String(params.itemName || "").trim();
  const normalizedKey = normalizeSupplyKey(rawKey || rawName);

  const itemCandidates = await db
    .select({ id: supplyItems.id, itemKey: supplyItems.itemKey, canonicalName: supplyItems.canonicalName })
    .from(supplyItems)
    .where(
      or(
        eq(supplyItems.itemKey, normalizedKey),
        ilike(supplyItems.canonicalName, `%${rawName || rawKey}%`),
      ),
    )
    .limit(30);

  const aliasCandidates = await db
    .select({ itemId: supplyItemAliases.itemId })
    .from(supplyItemAliases)
    .where(
      or(
        eq(supplyItemAliases.aliasKey, normalizedKey),
        ilike(supplyItemAliases.alias, `%${rawName || rawKey}%`),
      ),
    )
    .limit(40);

  const itemIds = Array.from(
    new Set([
      ...itemCandidates.map((row: any) => String(row.id || "")).filter(Boolean),
      ...aliasCandidates.map((row: any) => String(row.itemId || "")).filter(Boolean),
    ]),
  );

  return {
    normalizedKey,
    itemIds,
    canonicalName: String(itemCandidates[0]?.canonicalName || rawName || rawKey || normalizedKey),
  };
}

async function getLocalizedPriceOffers(params: {
  itemKey?: string | null;
  itemName?: string | null;
  buyerRestaurant?: any | null;
  maxRadiusMiles?: number | null;
}) {
  const { itemIds } = await resolveSupplyItemIds({ itemKey: params.itemKey, itemName: params.itemName });
  if (itemIds.length === 0) return [] as any[];

  const priceRows = await db
    .select()
    .from(supplyPrices)
    .where(and(inArray(supplyPrices.itemId, itemIds), eq(supplyPrices.currency, "usd")))
    .orderBy(desc(supplyPrices.observedAt))
    .limit(2000);
  if (priceRows.length === 0) return [] as any[];

  const storeIds = Array.from(
    new Set((priceRows as any[]).map((row) => String(row.storeId || "")).filter(Boolean)),
  );
  const locationIds = Array.from(
    new Set((priceRows as any[]).map((row) => String(row.storeLocationId || "")).filter(Boolean)),
  );

  const [stores, locations] = await Promise.all([
    storeIds.length > 0
      ? db
          .select()
          .from(supplyStores)
          .where(and(inArray(supplyStores.id, storeIds), eq(supplyStores.isActive, true)))
      : Promise.resolve([] as any[]),
    locationIds.length > 0
      ? db
          .select()
          .from(supplyStoreLocations)
          .where(and(inArray(supplyStoreLocations.id, locationIds), eq(supplyStoreLocations.isActive, true)))
      : Promise.resolve([] as any[]),
  ]);

  const storeById = new Map((stores as any[]).map((row: any) => [String(row.id), row]));
  const locationById = new Map((locations as any[]).map((row: any) => [String(row.id), row]));

  const buyerLat = Number(params.buyerRestaurant?.latitude);
  const buyerLon = Number(params.buyerRestaurant?.longitude);
  const buyerState = String(params.buyerRestaurant?.state || "").trim();
  const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);
  const maxRadius = Math.max(1, Number(params.maxRadiusMiles || 25) || 25);

  return (priceRows as any[])
    .map((price: any) => {
      const store = storeById.get(String(price.storeId || ""));
      if (!store) return null;
      const location = price.storeLocationId
        ? locationById.get(String(price.storeLocationId || "")) || null
        : null;

      if (buyerState) {
        const locationState = String(location?.state || "").trim();
        if (locationState && locationState !== buyerState) {
          return null;
        }
      }

      const lat = Number(location?.latitude);
      const lon = Number(location?.longitude);
      const distanceMiles =
        hasBuyerCoords && Number.isFinite(lat) && Number.isFinite(lon)
          ? haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon })
          : null;

      if (distanceMiles !== null && distanceMiles > maxRadius) {
        return null;
      }

      return {
        unitPriceCents: Number(price.unitPriceCents || 0),
        observedAt: price.observedAt,
        storeId: String(store.id),
        storeName: String(store.name || "Unknown store"),
        storeLocationId: location ? String(location.id) : null,
        storeCity: location?.city ? String(location.city) : null,
        storeState: location?.state ? String(location.state) : null,
        distanceMiles,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      if (a.unitPriceCents !== b.unitPriceCents) return a.unitPriceCents - b.unitPriceCents;
      const aObserved = new Date(a.observedAt || 0).getTime();
      const bObserved = new Date(b.observedAt || 0).getTime();
      return bObserved - aObserved;
    });
}

export function registerSupplierMarketplaceRoutes(app: Express) {
  // Logged-in users can add a supplier profile to their existing account.
  app.post("/api/supplier/profile/activate", isAuthenticated, async (req: any, res) => {
    try {
      if (req.user?.isDisabled) {
        return res.status(403).json({ message: "Account disabled" });
      }

      const schema = z.object({
        businessName: z.string().trim().min(1).max(120).optional(),
      });
      const parsed = schema.parse(req.body || {});

      let supplier = await ensureSupplierProfile(String(req.user.id));
      const businessName = String(parsed.businessName || "").trim();
      if (businessName && businessName !== String((supplier as any)?.businessName || "")) {
        const [updated] = await db
          .update(suppliers)
          .set({
            businessName,
            updatedAt: new Date(),
          } as any)
          .where(eq(suppliers.id, String((supplier as any).id)))
          .returning();
        if (updated) supplier = updated as any;
      }

      return res.json({
        success: true,
        supplier,
      });
    } catch (error: any) {
      console.error("Error activating supplier profile:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid supplier activation payload" });
      }
      return res.status(500).json({ message: "Failed to activate supplier profile" });
    }
  });

  // Stripe Connect onboarding for suppliers (payout setup).
  app.post("/api/supplier/stripe/onboard", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

      const supplier = await ensureSupplierProfile(req.user.id);
      let accountId = String((supplier as any).stripeConnectAccountId || "").trim() || null;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: req.user.email,
          capabilities: {
            transfers: { requested: true },
          },
          metadata: {
            supplierId: String((supplier as any).id),
            businessName: String((supplier as any).businessName || ""),
          },
        });
        accountId = account.id;

        await db
          .update(suppliers)
          .set({ stripeConnectAccountId: accountId, updatedAt: new Date() } as any)
          .where(eq(suppliers.id, String((supplier as any).id)));
      }

      const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${normalizedBaseUrl}/supplier/dashboard?setup=refresh`,
        return_url: `${normalizedBaseUrl}/supplier/dashboard?setup=complete`,
        type: "account_onboarding",
      });

      res.json({ onboardingUrl: accountLink.url });
    } catch (error: any) {
      console.error("Error creating supplier Stripe Connect onboarding:", error);
      res.status(500).json({ message: "Failed to initiate Stripe onboarding" });
    }
  });

  app.get("/api/supplier/stripe/status", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

      const supplier = await ensureSupplierProfile(req.user.id);
      const accountId = String((supplier as any).stripeConnectAccountId || "").trim();
      if (!accountId) {
        return res.json({
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingCompleted: false,
        });
      }

      const account = await stripe.accounts.retrieve(accountId);

      await db
        .update(suppliers)
        .set({
          stripeChargesEnabled: Boolean((account as any).charges_enabled),
          stripePayoutsEnabled: Boolean((account as any).payouts_enabled),
          stripeOnboardingCompleted: Boolean((account as any).details_submitted),
          stripeConnectStatus: (account as any).charges_enabled ? "active" : "pending",
          updatedAt: new Date(),
        } as any)
        .where(eq(suppliers.id, String((supplier as any).id)));

      res.json({
        connected: true,
        chargesEnabled: Boolean((account as any).charges_enabled),
        payoutsEnabled: Boolean((account as any).payouts_enabled),
        onboardingCompleted: Boolean((account as any).details_submitted),
        accountId,
      });
    } catch (error: any) {
      console.error("Error checking supplier Stripe status:", error);
      res.status(500).json({ message: "Failed to check Stripe status" });
    }
  });

  app.get("/api/supply/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await ensureSupplyOrderPreferences(String(req.user.id));
      res.json(prefs);
    } catch (error: any) {
      console.error("Error loading supply preferences:", error);
      res.status(500).json({ message: error.message || "Failed to load preferences" });
    }
  });

  app.post("/api/supply/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        maxStops: z.coerce.number().int().min(1).max(5).optional(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
        // Legacy
        costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
        // Preferred
        stopMinutes: z.coerce.number().int().min(0).max(240).optional(),
        costPerMinuteCents: z.coerce.number().int().min(0).max(5_000).optional(),
        pingSuppliers: z.coerce.boolean().optional(),
        allowSubstitutions: z.coerce.boolean().optional(),
      });
      const parsed = schema.parse(req.body || {});
      const existing = await ensureSupplyOrderPreferences(String(req.user.id));
      const now = new Date();
      const [updated] = await db
        .update(supplyOrderPreferences)
        .set({ ...parsed, updatedAt: now } as any)
        .where(eq(supplyOrderPreferences.id, existing.id))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supply preferences:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid preferences", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update preferences" });
    }
  });

  app.get("/api/supply/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const watches = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.userId, String(req.user.id)), eq(supplyPriceWatches.isActive, true)))
        .orderBy(desc(supplyPriceWatches.updatedAt))
        .limit(200);

      const buyerIds = Array.from(
        new Set(
          (watches as any[])
            .map((watch: any) => String(watch.buyerRestaurantId || "").trim())
            .filter(Boolean),
        ),
      );
      const buyerRestaurants =
        buyerIds.length > 0
          ? await db
              .select()
              .from(restaurants)
              .where(inArray(restaurants.id, buyerIds))
          : [];
      const buyerById = new Map(
        (buyerRestaurants as any[]).map((restaurant: any) => [String(restaurant.id), restaurant]),
      );

      const now = new Date();
      const minTriggerGapMs = 12 * 60 * 60 * 1000;
      const rows = await Promise.all(
        (watches as any[]).map(async (watch: any) => {
          const buyerRestaurant = watch.buyerRestaurantId
            ? buyerById.get(String(watch.buyerRestaurantId)) || null
            : null;
          const offers = await getLocalizedPriceOffers({
            itemKey: String(watch.itemKey || ""),
            itemName: String(watch.itemName || ""),
            buyerRestaurant,
            maxRadiusMiles: Number(watch.maxRadiusMiles || 25),
          });
          const best = offers[0] || null;
          const targetPriceCents =
            watch.targetPriceCents === null || watch.targetPriceCents === undefined
              ? null
              : Number(watch.targetPriceCents);
          const targetMet =
            targetPriceCents !== null && best ? Number(best.unitPriceCents) <= targetPriceCents : false;

          if (targetMet) {
            const lastTriggeredAt = watch.lastTriggeredAt ? new Date(watch.lastTriggeredAt) : null;
            const stale = !lastTriggeredAt || now.getTime() - lastTriggeredAt.getTime() > minTriggerGapMs;
            if (stale) {
              const alertMessage = `${watch.itemName} hit your target at $${(
                Number(best.unitPriceCents || 0) / 100
              ).toFixed(2)} (${best.storeName}).`;
              await db.insert(supplyPriceAlerts).values({
                watchId: String(watch.id),
                userId: String(req.user.id),
                buyerRestaurantId: watch.buyerRestaurantId ? String(watch.buyerRestaurantId) : null,
                itemKey: String(watch.itemKey || ""),
                itemName: String(watch.itemName || ""),
                alertType: "price_target_hit",
                message: alertMessage,
                observedPriceCents: Number(best.unitPriceCents || 0),
                baselinePriceCents: targetPriceCents,
                observedAt: best.observedAt ? new Date(best.observedAt) : now,
                storeId: best.storeId,
                storeLocationId: best.storeLocationId,
                storeName: best.storeName,
                storeCity: best.storeCity,
                storeState: best.storeState,
                createdAt: now,
              } as any);

              await db
                .update(supplyPriceWatches)
                .set({ lastTriggeredAt: now, updatedAt: now } as any)
                .where(eq(supplyPriceWatches.id, String(watch.id)));
            }
          }

          const areaKey = buyerRestaurant?.state
            ? `state:${String(buyerRestaurant.state).trim()}`
            : "global";
          const offerPrices = offers
            .map((offer: any) => Number(offer.unitPriceCents || 0))
            .filter((value: number) => Number.isFinite(value) && value >= 0)
            .sort((a: number, b: number) => a - b);
          if (offerPrices.length > 0) {
            const minPrice = offerPrices[0];
            const maxPrice = offerPrices[offerPrices.length - 1];
            const medianPrice =
              offerPrices.length % 2 === 0
                ? Math.round((offerPrices[offerPrices.length / 2 - 1] + offerPrices[offerPrices.length / 2]) / 2)
                : offerPrices[Math.floor(offerPrices.length / 2)];
            const snapshotDay = toDayKey(now);
            await db
              .insert(supplyPriceDailySnapshots)
              .values({
                itemKey: String(watch.itemKey || ""),
                itemName: String(watch.itemName || ""),
                areaKey,
                snapshotDay,
                minPriceCents: minPrice,
                medianPriceCents: medianPrice,
                maxPriceCents: maxPrice,
                sampleCount: offerPrices.length,
                createdAt: now,
                updatedAt: now,
              } as any)
              .onConflictDoUpdate({
                target: [
                  supplyPriceDailySnapshots.itemKey,
                  supplyPriceDailySnapshots.areaKey,
                  supplyPriceDailySnapshots.snapshotDay,
                ],
                set: {
                  itemName: String(watch.itemName || ""),
                  minPriceCents: minPrice,
                  medianPriceCents: medianPrice,
                  maxPriceCents: maxPrice,
                  sampleCount: offerPrices.length,
                  updatedAt: now,
                } as any,
              });
          }

          return {
            ...watch,
            currentBest: best
              ? {
                  unitPriceCents: Number(best.unitPriceCents || 0),
                  observedAt: best.observedAt,
                  storeName: best.storeName,
                  storeCity: best.storeCity,
                  storeState: best.storeState,
                  distanceMiles: best.distanceMiles,
                }
              : null,
            targetMet,
          };
        }),
      );

      res.json(rows);
    } catch (error: any) {
      console.error("Error loading price watches:", error);
      res.status(500).json({ message: error.message || "Failed to load price watches" });
    }
  });

  app.post("/api/supply/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        itemName: z.string().trim().min(1).max(160),
        itemKey: z.string().trim().max(160).optional().nullable(),
        targetPriceCents: z.coerce.number().int().min(1).max(10_000_000).optional().nullable(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
      });
      const parsed = schema.parse(req.body || {});

      let buyerRestaurantId: string | null = null;
      if (parsed.buyerRestaurantId) {
        const buyerRestaurant = await resolveBuyerRestaurantOrThrow(req, String(parsed.buyerRestaurantId));
        buyerRestaurantId = String((buyerRestaurant as any).id);
      }

      const itemKey = normalizeSupplyKey(String(parsed.itemKey || parsed.itemName || ""));
      const now = new Date();
      const [created] = await db
        .insert(supplyPriceWatches)
        .values({
          userId: String(req.user.id),
          buyerRestaurantId,
          itemKey,
          itemName: String(parsed.itemName).trim(),
          targetPriceCents:
            parsed.targetPriceCents === null || parsed.targetPriceCents === undefined
              ? null
              : Number(parsed.targetPriceCents),
          maxRadiusMiles: Number(parsed.maxRadiusMiles || 25),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();

      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating price watch:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid watch", errors: error.errors });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to create price watch" });
    }
  });

  app.delete("/api/supply/price-watches/:watchId", isAuthenticated, async (req: any, res) => {
    try {
      const watchId = String(req.params.watchId || "").trim();
      const [watch] = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.id, watchId), eq(supplyPriceWatches.userId, String(req.user.id))))
        .limit(1);
      if (!watch) return res.status(404).json({ message: "Watch not found" });

      await db
        .update(supplyPriceWatches)
        .set({ isActive: false, updatedAt: new Date() } as any)
        .where(eq(supplyPriceWatches.id, String((watch as any).id)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting price watch:", error);
      res.status(500).json({ message: error.message || "Failed to delete price watch" });
    }
  });

  app.get("/api/supply/price-watches/alerts", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supplyPriceAlerts)
        .where(eq(supplyPriceAlerts.userId, String(req.user.id)))
        .orderBy(desc(supplyPriceAlerts.createdAt))
        .limit(120);
      res.json(rows);
    } catch (error: any) {
      console.error("Error loading price watch alerts:", error);
      res.status(500).json({ message: error.message || "Failed to load price alerts" });
    }
  });

  app.get("/api/supply/price-watches/:watchId/history", isAuthenticated, async (req: any, res) => {
    try {
      const watchId = String(req.params.watchId || "").trim();
      const [watch] = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.id, watchId), eq(supplyPriceWatches.userId, String(req.user.id))))
        .limit(1);
      if (!watch) return res.status(404).json({ message: "Watch not found" });

      const dayLimit = Math.min(Number(req.query?.days || 30) || 30, 90);
      const snapshots = await db
        .select()
        .from(supplyPriceDailySnapshots)
        .where(eq(supplyPriceDailySnapshots.itemKey, String((watch as any).itemKey || "")))
        .orderBy(desc(supplyPriceDailySnapshots.snapshotDay))
        .limit(dayLimit);

      res.json({
        watch,
        snapshots: (snapshots as any[]).reverse(),
      });
    } catch (error: any) {
      console.error("Error loading watch history:", error);
      res.status(500).json({ message: error.message || "Failed to load watch history" });
    }
  });

  // Shopping lists (Walmart-style: build lists, then optimize purchase plan).
  app.get("/api/supply/lists", isAuthenticated, async (req: any, res) => {
    try {
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const conditions: any[] = [eq(supplyShoppingLists.ownerUserId, String(req.user.id))];
      if (buyerRestaurantId) conditions.push(eq(supplyShoppingLists.buyerRestaurantId, buyerRestaurantId));

      const lists = await db
        .select()
        .from(supplyShoppingLists)
        .where(and(...conditions))
        .orderBy(desc(supplyShoppingLists.updatedAt))
        .limit(200);

      res.json(lists);
    } catch (error: any) {
      console.error("Error loading shopping lists:", error);
      res.status(500).json({ message: error.message || "Failed to load lists" });
    }
  });

  app.post("/api/supply/lists", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        name: z.string().min(1).max(120),
        notes: z.string().max(4000).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});

      if (parsed.buyerRestaurantId) {
        await resolveBuyerRestaurantOrThrow(req, String(parsed.buyerRestaurantId));
      }

      const now = new Date();
      const [created] = await db
        .insert(supplyShoppingLists)
        .values({
          ownerUserId: String(req.user.id),
          buyerRestaurantId: parsed.buyerRestaurantId ? String(parsed.buyerRestaurantId) : null,
          name: parsed.name.trim(),
          notes: parsed.notes ?? null,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();

      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating shopping list:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid list", errors: error.errors });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to create list" });
    }
  });

  app.patch("/api/supply/lists/:listId", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        name: z.string().min(1).max(120).optional(),
        notes: z.string().max(4000).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});

      if (parsed.buyerRestaurantId) {
        await resolveBuyerRestaurantOrThrow(req, String(parsed.buyerRestaurantId));
      }

      const now = new Date();
      const [updated] = await db
        .update(supplyShoppingLists)
        .set({
          buyerRestaurantId:
            parsed.buyerRestaurantId !== undefined
              ? parsed.buyerRestaurantId
                ? String(parsed.buyerRestaurantId)
                : null
              : (list as any).buyerRestaurantId ?? null,
          name: parsed.name !== undefined ? parsed.name.trim() : (list as any).name,
          notes: parsed.notes !== undefined ? (parsed.notes ?? null) : (list as any).notes ?? null,
          updatedAt: now,
        } as any)
        .where(eq(supplyShoppingLists.id, String((list as any).id)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating shopping list:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid list", errors: error.errors });
      }
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to update list" });
    }
  });

  app.delete("/api/supply/lists/:listId", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      await db.delete(supplyShoppingLists).where(eq(supplyShoppingLists.id, String((list as any).id)));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting shopping list:", error);
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to delete list" });
    }
  });

  app.get("/api/supply/lists/:listId/items", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const items = await db
        .select()
        .from(supplyShoppingListItems)
        .where(eq(supplyShoppingListItems.listId, String((list as any).id)))
        .orderBy(desc(supplyShoppingListItems.updatedAt))
        .limit(2000);
      res.json(items);
    } catch (error: any) {
      console.error("Error loading shopping list items:", error);
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to load items" });
    }
  });

  app.post("/api/supply/lists/:listId/items", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const schema = z.object({
        rawName: z.string().min(1).max(240),
        quantity: z.coerce.number().min(0.01).max(1_000_000).default(1),
        unit: z.string().max(40).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});

      const now = new Date();
      const [created] = await db
        .insert(supplyShoppingListItems)
        .values({
          listId: String((list as any).id),
          itemId: null,
          rawName: parsed.rawName.trim(),
          quantity: String(parsed.quantity),
          unit: parsed.unit ?? null,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();

      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error adding shopping list item:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid item", errors: error.errors });
      }
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to add item" });
    }
  });

  app.patch("/api/supply/lists/:listId/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const [existing] = await db
        .select()
        .from(supplyShoppingListItems)
        .where(
          and(
            eq(supplyShoppingListItems.id, String(req.params.itemId)),
            eq(supplyShoppingListItems.listId, String((list as any).id)),
          ),
        )
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Item not found" });

      const schema = z.object({
        rawName: z.string().min(1).max(240).optional(),
        quantity: z.coerce.number().min(0.01).max(1_000_000).optional(),
        unit: z.string().max(40).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});

      const now = new Date();
      const [updated] = await db
        .update(supplyShoppingListItems)
        .set({
          rawName: parsed.rawName !== undefined ? parsed.rawName.trim() : (existing as any).rawName,
          quantity:
            parsed.quantity !== undefined ? String(parsed.quantity) : String((existing as any).quantity),
          unit: parsed.unit !== undefined ? (parsed.unit ?? null) : (existing as any).unit ?? null,
          updatedAt: now,
        } as any)
        .where(eq(supplyShoppingListItems.id, String((existing as any).id)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating shopping list item:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid item", errors: error.errors });
      }
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to update item" });
    }
  });

  app.delete("/api/supply/lists/:listId/items/:itemId", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const [existing] = await db
        .select({ id: supplyShoppingListItems.id })
        .from(supplyShoppingListItems)
        .where(
          and(
            eq(supplyShoppingListItems.id, String(req.params.itemId)),
            eq(supplyShoppingListItems.listId, String((list as any).id)),
          ),
        )
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Item not found" });
      await db.delete(supplyShoppingListItems).where(eq(supplyShoppingListItems.id, String(existing.id)));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting shopping list item:", error);
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to delete item" });
    }
  });

  app.post("/api/supply/lists/:listId/optimize", isAuthenticated, async (req: any, res) => {
    try {
      const list = await resolveSupplyShoppingListOrThrow(req, String(req.params.listId));
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        maxStops: z.coerce.number().int().min(1).max(5).optional(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
        // Legacy
        costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
        // Preferred
        stopMinutes: z.coerce.number().int().min(0).max(240).optional(),
        costPerMinuteCents: z.coerce.number().int().min(0).max(5_000).optional(),
        pingSuppliers: z.coerce.boolean().optional(),
        allowSubstitutions: z.coerce.boolean().optional(),
      });
      const parsedMeta = schema.parse(req.body || {});

      const effectiveBuyerRestaurantId =
        String((list as any).buyerRestaurantId || "").trim() ||
        String(parsedMeta.buyerRestaurantId || "").trim();
      const buyerRestaurant = effectiveBuyerRestaurantId
        ? await resolveBuyerRestaurantOrThrow(req, effectiveBuyerRestaurantId)
        : null;

      const prefs = await ensureSupplyOrderPreferences(String(req.user.id));
      const maxStops =
        parsedMeta.maxStops !== undefined ? parsedMeta.maxStops : Number((prefs as any).maxStops || 2) || 2;
      const maxRadiusMiles =
        parsedMeta.maxRadiusMiles !== undefined
          ? parsedMeta.maxRadiusMiles
          : Number((prefs as any).maxRadiusMiles || 20) || 20;

      const stopMinutes =
        parsedMeta.stopMinutes !== undefined
          ? parsedMeta.stopMinutes
          : Number((prefs as any).stopMinutes ?? 10) || 10;
      const costPerMinuteCents =
        parsedMeta.costPerMinuteCents !== undefined
          ? parsedMeta.costPerMinuteCents
          : Number((prefs as any).costPerMinuteCents ?? 0) || 0;
      const costPerStopCentsEffective =
        costPerMinuteCents > 0
          ? Math.max(0, Math.round(stopMinutes * costPerMinuteCents))
          : parsedMeta.costPerStopCents !== undefined
            ? parsedMeta.costPerStopCents
            : Number((prefs as any).costPerStopCents || 0) || 0;

      const pingSuppliers =
        parsedMeta.pingSuppliers !== undefined
          ? Boolean(parsedMeta.pingSuppliers)
          : Boolean((prefs as any).pingSuppliers ?? true);
      const allowSubstitutions =
        parsedMeta.allowSubstitutions !== undefined
          ? Boolean(parsedMeta.allowSubstitutions)
          : Boolean((prefs as any).allowSubstitutions ?? true);

      const listItems = await db
        .select()
        .from(supplyShoppingListItems)
        .where(eq(supplyShoppingListItems.listId, String((list as any).id)))
        .orderBy(desc(supplyShoppingListItems.updatedAt))
        .limit(2000);

      const items = (listItems as any[])
        .map((row) => {
          const query = String(row.rawName || "").trim();
          const quantity = Number(row.quantity);
          if (!query) return null;
          if (!Number.isFinite(quantity) || quantity <= 0) return null;
          return { query, itemName: query, sku: null as any, quantity };
        })
        .filter(Boolean) as Array<{ query: string; itemName: string; sku: null; quantity: number }>;

      if (items.length === 0) {
        return res.status(400).json({ message: "This list has no valid items to optimize." });
      }

      const terms = Array.from(new Set(items.map((i) => i.query))).slice(0, 100);
      const matches = await searchSupplierProductsForTerms({
        terms,
        buyerRestaurant,
        limit: 1200,
      });

      const buyerLat = buyerRestaurant ? Number((buyerRestaurant as any).latitude) : NaN;
      const buyerLon = buyerRestaurant ? Number((buyerRestaurant as any).longitude) : NaN;
      const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);
      const radiusMiles = maxRadiusMiles;

      const offers = (matches as any[]).map((r: any) => {
        const lat = Number(r.supplier?.latitude);
        const lon = Number(r.supplier?.longitude);
        const distanceMiles =
          hasBuyerCoords && Number.isFinite(lat) && Number.isFinite(lon)
            ? haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon })
            : null;
        return { ...r, distanceMiles };
      });

      const filteredOffers = hasBuyerCoords
        ? offers.filter((r: any) => r.distanceMiles === null || r.distanceMiles <= radiusMiles)
        : offers;

      const itemsOut = items.map((it) => {
        const q = String(it.query).trim();
        const ql = q.toLowerCase();
        const candidates = (filteredOffers as any[])
          .filter((r: any) => {
            const name = String(r.product?.name || "").toLowerCase();
            const sku = String(r.product?.sku || "").toLowerCase();
            if (name.includes(ql) || (sku && sku.includes(ql))) return true;
            if (!allowSubstitutions) return false;
            const tokens = normalizeSupplyKey(q).split(" ").filter(Boolean);
            if (tokens.length <= 1) return false;
            return tokens.every((t) => name.includes(t) || (sku && sku.includes(t)));
          })
          .map((r: any) => ({
            supplierId: String(r.supplier.id),
            supplierName: String(r.supplier.businessName),
            supplier: r.supplier,
            productId: String(r.product.id),
            productName: String(r.product.name),
            sku: r.product.sku ?? null,
            unitLabel: r.product.unitLabel ?? null,
            priceCents: Number(r.product.priceCents || 0) || 0,
            distanceMiles: r.distanceMiles ?? null,
          }))
          .sort((a: any, b: any) => a.priceCents - b.priceCents)
          .slice(0, 10);

        return {
          query: q,
          itemName: it.itemName,
          sku: it.sku,
          quantity: it.quantity,
          offers: candidates,
        };
      });

      if (pingSuppliers) {
        try {
          for (const item of itemsOut as any[]) {
            if ((item.offers || []).length > 0) continue;
            const name = String(item.itemName || item.query || "").trim();
            if (!name) continue;
            await recordDemandAndNotifyIfUnlisted({
              buyerRestaurant,
              itemNameRaw: name,
              quantity: Math.max(1, Math.floor(Number(item.quantity || 1) || 1)),
              source: "import",
            });
          }
        } catch (notifyError) {
          console.warn("List optimize demand notify failed:", notifyError);
        }
      }

      const supplierAgg = new Map<
        string,
        { supplier: any; coverageCount: number; subtotalCents: number; items: any[] }
      >();

      for (const item of itemsOut as any[]) {
        const bestBySupplier = new Map<string, any>();
        for (const offer of item.offers || []) {
          const prev = bestBySupplier.get(offer.supplierId);
          if (!prev || offer.priceCents < prev.priceCents) bestBySupplier.set(offer.supplierId, offer);
        }
        for (const offer of bestBySupplier.values()) {
          const existing = supplierAgg.get(offer.supplierId);
          const qty = Number(item.quantity || 0) || 0;
          const lineTotalCents = Math.max(0, Math.round(offer.priceCents * qty));
          if (!existing) {
            supplierAgg.set(offer.supplierId, {
              supplier: offer.supplier,
              coverageCount: 1,
              subtotalCents: lineTotalCents,
              items: [{ query: item.query, productId: offer.productId, priceCents: offer.priceCents, quantity: item.quantity }],
            });
          } else {
            existing.coverageCount += 1;
            existing.subtotalCents += lineTotalCents;
            existing.items.push({ query: item.query, productId: offer.productId, priceCents: offer.priceCents, quantity: item.quantity });
          }
        }
      }

      const suppliersOut = Array.from(supplierAgg.entries())
        .map(([supplierId, v]) => ({
          supplierId,
          supplier: v.supplier,
          coverageCount: v.coverageCount,
          missingCount: itemsOut.length - v.coverageCount,
          subtotalCents: v.subtotalCents,
          items: v.items,
        }))
        .sort((a: any, b: any) => {
          if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
          return a.subtotalCents - b.subtotalCents;
        })
        .slice(0, 25);

      const requiredCount = (itemsOut as any[]).filter((i) => (i.offers || []).length > 0).length;
      const oneStop =
        suppliersOut
          .filter((s: any) => s.coverageCount === requiredCount)
          .map((s: any) => ({
            type: "one_stop",
            supplierIds: [s.supplierId],
            suppliers: [s.supplier],
            subtotalCents: s.subtotalCents,
            stopCostCents: costPerStopCentsEffective,
            totalCents: s.subtotalCents + costPerStopCentsEffective,
          }))
          .sort((a: any, b: any) => a.totalCents - b.totalCents)[0] || null;

      let twoStop: any = null;
      if (maxStops >= 2 && suppliersOut.length >= 2 && requiredCount > 0) {
        const topN = Math.min(25, suppliersOut.length);
        for (let i = 0; i < topN; i++) {
          for (let j = i + 1; j < topN; j++) {
            const a = suppliersOut[i];
            const b = suppliersOut[j];

            let subtotalCents = 0;
            let covered = 0;

            for (const item of itemsOut as any[]) {
              const qty = Number(item.quantity || 0) || 0;
              if (!qty) continue;

              const bestA = (item.offers || [])
                .filter((o: any) => o.supplierId === a.supplierId)
                .sort((x: any, y: any) => x.priceCents - y.priceCents)[0];
              const bestB = (item.offers || [])
                .filter((o: any) => o.supplierId === b.supplierId)
                .sort((x: any, y: any) => x.priceCents - y.priceCents)[0];

              const pick = bestA && bestB ? (bestA.priceCents <= bestB.priceCents ? bestA : bestB) : bestA || bestB;
              if (!pick) continue;
              covered += 1;
              subtotalCents += Math.max(0, Math.round(pick.priceCents * qty));
            }

            if (covered !== requiredCount) continue;
            const stopCostCents = costPerStopCentsEffective * 2;
            const totalCents = subtotalCents + stopCostCents;
            if (!twoStop || totalCents < twoStop.totalCents) {
              twoStop = {
                type: "two_stop",
                supplierIds: [a.supplierId, b.supplierId],
                suppliers: [a.supplier, b.supplier],
                subtotalCents,
                stopCostCents,
                totalCents,
              };
            }
          }
        }
      }

      const plan = (() => {
        if (oneStop && twoStop) return twoStop.totalCents < oneStop.totalCents ? twoStop : oneStop;
        return oneStop || twoStop || null;
      })();

      res.json({
        success: true,
        itemCount: itemsOut.length,
        items: itemsOut,
        suppliers: suppliersOut,
        plan,
        preferencesUsed: {
          maxStops,
          maxRadiusMiles,
          stopMinutes,
          costPerMinuteCents,
          costPerStopCents: costPerStopCentsEffective,
          pingSuppliers,
          allowSubstitutions,
        },
      });
    } catch (error: any) {
      console.error("Error optimizing shopping list:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid optimize request", errors: error.errors });
      }
      if (String(error?.message || "") === "List not found") {
        return res.status(404).json({ message: "List not found" });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to optimize list" });
    }
  });

  app.get("/api/supply/search", isAuthenticated, async (req: any, res) => {
    try {
      const q = String(req.query?.q || "").trim();
      if (!q) return res.status(400).json({ message: "q is required" });
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const limit = Math.min(Number(req.query?.limit || 50) || 50, 200);

      const buyerRestaurant = buyerRestaurantId
        ? await resolveBuyerRestaurantOrThrow(req, buyerRestaurantId)
        : null;

      const conditions: any[] = [
        eq(supplierProducts.isActive, true),
        eq(suppliers.isActive, true),
        or(
          ilike(supplierProducts.name, `%${q}%`),
          ilike(supplierProducts.sku, `%${q}%`),
        ),
      ];
      const buyerState = buyerRestaurant ? String((buyerRestaurant as any).state || "").trim() : "";
      if (buyerState) conditions.push(eq(suppliers.state, buyerState));

      const rows = await db
        .select({
          product: supplierProducts,
          supplier: suppliers,
        })
        .from(supplierProducts)
        .innerJoin(suppliers, eq(supplierProducts.supplierId, suppliers.id))
        .where(and(...conditions))
        .orderBy(desc(supplierProducts.updatedAt))
        .limit(Math.max(limit, 50));

      const buyerLat = buyerRestaurant ? Number((buyerRestaurant as any).latitude) : NaN;
      const buyerLon = buyerRestaurant ? Number((buyerRestaurant as any).longitude) : NaN;
      const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);
      const radiusMiles = Number(process.env.SUPPLY_LOCAL_RADIUS_MILES || 75) || 75;

      const decorated = (rows as any[]).map((r: any) => {
        const lat = Number(r.supplier?.latitude);
        const lon = Number(r.supplier?.longitude);
        const distanceMiles =
          hasBuyerCoords && Number.isFinite(lat) && Number.isFinite(lon)
            ? haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon })
            : null;
        return { ...r, distanceMiles };
      });

      const filtered = hasBuyerCoords
        ? decorated.filter((r: any) => r.distanceMiles === null || r.distanceMiles <= radiusMiles)
        : decorated;

      filtered.sort((a: any, b: any) => {
        if (a.distanceMiles !== null && b.distanceMiles !== null) {
          return a.distanceMiles - b.distanceMiles;
        }
        if (a.distanceMiles !== null) return -1;
        if (b.distanceMiles !== null) return 1;
        return new Date(b.product.updatedAt).getTime() - new Date(a.product.updatedAt).getTime();
      });

      res.json(
        filtered.slice(0, limit).map((r: any) => ({
          product: r.product,
          supplier: r.supplier,
          distanceMiles: r.distanceMiles,
        })),
      );
    } catch (error: any) {
      console.error("Error searching supply:", error);
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to search supply" });
    }
  });

  app.post("/api/supply/demand", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        buyerRestaurantId: z.string().optional().nullable(),
        itemName: z.string().min(1).max(120),
        quantity: z.number().int().min(1).max(100_000).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});
      const buyerRestaurant = await resolveBuyerRestaurantOrNull(req, parsed.buyerRestaurantId);

      const result = await recordDemandAndNotifyIfUnlisted({
        buyerRestaurant,
        itemNameRaw: parsed.itemName,
        quantity: parsed.quantity ?? null,
        source: "manual",
      });

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error creating supply demand:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid demand data", errors: error.errors });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to create demand" });
    }
  });

  // Upload an order list (CSV/TSV/XLSX) and return best matching supplier deals.
  app.post(
    "/api/supply/order-list/import",
    isAuthenticated,
    importUpload.single("file"),
    async (req: any, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "File is required" });

        const schema = z.object({
          buyerRestaurantId: z.string().optional().nullable(),
          maxStops: z.coerce.number().int().min(1).max(5).optional(),
          maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
          // Legacy
          costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
          // Preferred
          stopMinutes: z.coerce.number().int().min(0).max(240).optional(),
          costPerMinuteCents: z.coerce.number().int().min(0).max(5_000).optional(),
          pingSuppliers: z.coerce.boolean().optional(),
          allowSubstitutions: z.coerce.boolean().optional(),
        });
        const parsedMeta = schema.parse(req.body || {});

        const buyerRestaurant = await resolveBuyerRestaurantOrNull(req, parsedMeta.buyerRestaurantId);

        const prefs = await ensureSupplyOrderPreferences(String(req.user.id));
        const maxStops =
          parsedMeta.maxStops !== undefined ? parsedMeta.maxStops : Number((prefs as any).maxStops || 2) || 2;
        const maxRadiusMiles =
          parsedMeta.maxRadiusMiles !== undefined
            ? parsedMeta.maxRadiusMiles
            : Number((prefs as any).maxRadiusMiles || 20) || 20;

        const stopMinutes =
          parsedMeta.stopMinutes !== undefined
            ? parsedMeta.stopMinutes
            : Number((prefs as any).stopMinutes ?? 10) || 10;
        const costPerMinuteCents =
          parsedMeta.costPerMinuteCents !== undefined
            ? parsedMeta.costPerMinuteCents
            : Number((prefs as any).costPerMinuteCents ?? 0) || 0;
        const costPerStopCentsEffective =
          costPerMinuteCents > 0
            ? Math.max(0, Math.round(stopMinutes * costPerMinuteCents))
            : parsedMeta.costPerStopCents !== undefined
              ? parsedMeta.costPerStopCents
              : Number((prefs as any).costPerStopCents || 0) || 0;

        const pingSuppliers =
          parsedMeta.pingSuppliers !== undefined
            ? Boolean(parsedMeta.pingSuppliers)
            : Boolean((prefs as any).pingSuppliers ?? true);
        const allowSubstitutions =
          parsedMeta.allowSubstitutions !== undefined
            ? Boolean(parsedMeta.allowSubstitutions)
            : Boolean((prefs as any).allowSubstitutions ?? true);

        const { headers, rows } = await parseTabularFile(
          file.buffer,
          file.originalname || "order-list.csv",
        );
        const normalizeHeader = (h: string) =>
          String(h || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        const headerMap = headers.map(normalizeHeader);
        const idx = (names: string[]) => {
          for (const name of names) {
            const i = headerMap.indexOf(name);
            if (i >= 0) return i;
          }
          return -1;
        };

        const skuIdx = idx(["sku", "product_sku", "item_sku"]);
        const nameIdx = idx(["name", "product", "product_name", "item", "description"]);
        const qtyIdx = idx(["quantity", "qty", "count"]);

        if (qtyIdx < 0) {
          return res.status(400).json({ message: "Missing required column: quantity", headers });
        }
        if (skuIdx < 0 && nameIdx < 0) {
          return res.status(400).json({ message: "Missing required column: sku or name", headers });
        }

        const toCell = (row: string[], i: number) =>
          i >= 0 ? String(row[i] ?? "").trim() : "";

        const parsedItems = rows
          .map((row) => {
            const sku = toCell(row, skuIdx);
            const itemName = toCell(row, nameIdx);
            const qtyRaw = toCell(row, qtyIdx);
            const quantity = Math.max(0, Math.floor(Number(qtyRaw)));
            if (!quantity) return null;
            if (!sku && !itemName) return null;
            const query = sku || itemName;
            return { sku: sku || null, itemName: itemName || null, query, quantity };
          })
          .filter(Boolean) as Array<{
          sku: string | null;
          itemName: string | null;
          query: string;
          quantity: number;
        }>;

        if (parsedItems.length === 0) {
          return res.status(400).json({ message: "No valid items found in file." });
        }

        const maxItems = 100;
        const items = parsedItems.slice(0, maxItems);

        const terms = Array.from(new Set(items.map((i) => i.query))).slice(0, 100);
        const matches = await searchSupplierProductsForTerms({
          terms,
          buyerRestaurant,
          limit: 1200,
        });

        const buyerLat = buyerRestaurant ? Number((buyerRestaurant as any).latitude) : NaN;
        const buyerLon = buyerRestaurant ? Number((buyerRestaurant as any).longitude) : NaN;
        const hasBuyerCoords = Number.isFinite(buyerLat) && Number.isFinite(buyerLon);
        const radiusMiles = maxRadiusMiles;

        const offers = (matches as any[]).map((r: any) => {
          const lat = Number(r.supplier?.latitude);
          const lon = Number(r.supplier?.longitude);
          const distanceMiles =
            hasBuyerCoords && Number.isFinite(lat) && Number.isFinite(lon)
              ? haversineMiles({ lat: buyerLat, lon: buyerLon }, { lat, lon })
              : null;
          return { ...r, distanceMiles };
        });

        const filteredOffers = hasBuyerCoords
          ? offers.filter((r: any) => r.distanceMiles === null || r.distanceMiles <= radiusMiles)
          : offers;

        const itemsOut = items.map((it) => {
          const q = String(it.query).trim();
          const ql = q.toLowerCase();
          const candidates = (filteredOffers as any[])
            .filter((r: any) => {
              const name = String(r.product?.name || "").toLowerCase();
              const sku = String(r.product?.sku || "").toLowerCase();
              if (name.includes(ql) || (sku && sku.includes(ql))) return true;
              if (!allowSubstitutions) return false;
              // Basic substitution: token overlap (keeps it cheap and avoids heavy NLP).
              const tokens = normalizeSupplyKey(q).split(" ").filter(Boolean);
              if (tokens.length <= 1) return false;
              return tokens.every((t) => name.includes(t) || (sku && sku.includes(t)));
            })
            .map((r: any) => ({
              supplierId: String(r.supplier.id),
              supplierName: String(r.supplier.businessName),
              supplier: r.supplier,
              productId: String(r.product.id),
              productName: String(r.product.name),
              sku: r.product.sku ?? null,
              unitLabel: r.product.unitLabel ?? null,
              priceCents: Number(r.product.priceCents || 0) || 0,
              distanceMiles: r.distanceMiles ?? null,
            }))
            .sort((a: any, b: any) => a.priceCents - b.priceCents)
            .slice(0, 10);

          return {
            query: q,
            itemName: it.itemName,
            sku: it.sku,
            quantity: it.quantity,
            offers: candidates,
          };
        });

        // Ping local suppliers for items we couldn't match at all (best-effort).
        if (pingSuppliers) {
          try {
            for (const item of itemsOut as any[]) {
              if ((item.offers || []).length > 0) continue;
              const name = String(item.itemName || item.query || "").trim();
              if (!name) continue;
              await recordDemandAndNotifyIfUnlisted({
                buyerRestaurant,
                itemNameRaw: name,
                quantity: Math.max(1, Math.floor(Number(item.quantity || 1) || 1)),
                source: "import",
              });
            }
          } catch (notifyError) {
            console.warn("Order-list demand notify failed:", notifyError);
          }
        }

        // Aggregate by supplier: how many items can they fulfill and estimated subtotal.
        const supplierAgg = new Map<
          string,
          { supplier: any; coverageCount: number; subtotalCents: number; items: any[] }
        >();

        for (const item of itemsOut as any[]) {
          const bestBySupplier = new Map<string, any>();
          for (const offer of item.offers || []) {
            const prev = bestBySupplier.get(offer.supplierId);
            if (!prev || offer.priceCents < prev.priceCents) bestBySupplier.set(offer.supplierId, offer);
          }
          for (const offer of bestBySupplier.values()) {
            const existing = supplierAgg.get(offer.supplierId);
            const lineTotalCents = offer.priceCents * Math.max(1, Number(item.quantity || 1) || 1);
            if (!existing) {
              supplierAgg.set(offer.supplierId, {
                supplier: offer.supplier,
                coverageCount: 1,
                subtotalCents: lineTotalCents,
                items: [{ query: item.query, productId: offer.productId, priceCents: offer.priceCents, quantity: item.quantity }],
              });
            } else {
              existing.coverageCount += 1;
              existing.subtotalCents += lineTotalCents;
              existing.items.push({ query: item.query, productId: offer.productId, priceCents: offer.priceCents, quantity: item.quantity });
            }
          }
        }

        const suppliersOut = Array.from(supplierAgg.entries())
          .map(([supplierId, v]) => ({
            supplierId,
            supplier: v.supplier,
            coverageCount: v.coverageCount,
            missingCount: itemsOut.length - v.coverageCount,
            subtotalCents: v.subtotalCents,
            items: v.items,
          }))
          .sort((a: any, b: any) => {
            if (b.coverageCount !== a.coverageCount) return b.coverageCount - a.coverageCount;
            return a.subtotalCents - b.subtotalCents;
          })
          .slice(0, 25);

        // Optimized plan: best 1-stop vs best 2-stop (maxStops governs).
        const requiredCount = (itemsOut as any[]).filter((i) => (i.offers || []).length > 0).length;
        const oneStop =
          suppliersOut
            .filter((s: any) => s.coverageCount === requiredCount)
            .map((s: any) => ({
              type: "one_stop",
              supplierIds: [s.supplierId],
              suppliers: [s.supplier],
              subtotalCents: s.subtotalCents,
              stopCostCents: costPerStopCentsEffective,
              totalCents: s.subtotalCents + costPerStopCentsEffective,
            }))
            .sort((a: any, b: any) => a.totalCents - b.totalCents)[0] || null;

        let twoStop: any = null;
        if (maxStops >= 2 && suppliersOut.length >= 2 && requiredCount > 0) {
          const topN = Math.min(25, suppliersOut.length);
          for (let i = 0; i < topN; i++) {
            for (let j = i + 1; j < topN; j++) {
              const a = suppliersOut[i];
              const b = suppliersOut[j];

              let subtotalCents = 0;
              let covered = 0;
              const lines: any[] = [];

              for (const item of itemsOut as any[]) {
                const qty = Math.max(1, Math.floor(Number(item.quantity || 1) || 1));
                const offers = item.offers || [];
                if (offers.length === 0) continue;
                const bestA = offers.find((o: any) => o.supplierId === a.supplierId) || null;
                const bestB = offers.find((o: any) => o.supplierId === b.supplierId) || null;
                const pick =
                  bestA && bestB
                    ? bestA.priceCents <= bestB.priceCents
                      ? { o: bestA, supplierId: a.supplierId }
                      : { o: bestB, supplierId: b.supplierId }
                    : bestA
                      ? { o: bestA, supplierId: a.supplierId }
                      : bestB
                        ? { o: bestB, supplierId: b.supplierId }
                        : null;
                if (!pick) continue;
                covered += 1;
                const lineTotalCents = Number(pick.o.priceCents) * qty;
                subtotalCents += lineTotalCents;
                lines.push({
                  query: item.query,
                  quantity: qty,
                  supplierId: pick.supplierId,
                  productId: pick.o.productId,
                  unitPriceCents: pick.o.priceCents,
                  lineTotalCents,
                });
              }

              if (covered !== requiredCount) continue;
              const stopCostCents = costPerStopCentsEffective * 2;
              const totalCents = subtotalCents + stopCostCents;
              if (!twoStop || totalCents < twoStop.totalCents) {
                twoStop = {
                  type: "two_stop",
                  supplierIds: [a.supplierId, b.supplierId],
                  suppliers: [a.supplier, b.supplier],
                  subtotalCents,
                  stopCostCents,
                  totalCents,
                  lines,
                };
              }
            }
          }
        }

        const plan = (() => {
          if (oneStop && twoStop) return twoStop.totalCents < oneStop.totalCents ? twoStop : oneStop;
          return oneStop || twoStop || null;
        })();

        res.json({
          success: true,
          headers,
          itemCount: itemsOut.length,
          items: itemsOut,
          suppliers: suppliersOut,
          plan,
          preferencesUsed: {
            maxStops,
            maxRadiusMiles,
            stopMinutes,
            costPerMinuteCents,
            costPerStopCents: costPerStopCentsEffective,
            pingSuppliers,
            allowSubstitutions,
          },
          truncated: parsedItems.length > maxItems,
        });
      } catch (error: any) {
        console.error("Error importing order list:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid import request", errors: error.errors });
        }
        if (String(error?.message || "") === "Not authorized") {
          return res.status(403).json({ message: "Not authorized" });
        }
        res.status(500).json({ message: error.message || "Failed to import order list" });
      }
    },
  );

  // Public listing (used by the Supply Marketplace).
  // Important: only return public-safe fields (no Stripe Connect IDs/status).
  app.get("/api/suppliers", async (_req: any, res) => {
    try {
      const rows = await db
        .select({
          id: suppliers.id,
          businessName: suppliers.businessName,
          address: suppliers.address,
          city: suppliers.city,
          state: suppliers.state,
          latitude: suppliers.latitude,
          longitude: suppliers.longitude,
          contactPhone: suppliers.contactPhone,
          contactEmail: suppliers.contactEmail,
          isActive: suppliers.isActive,
          onlinePaymentsEnabled: suppliers.onlinePaymentsEnabled,
          onlinePaymentsAllowAch: suppliers.onlinePaymentsAllowAch,
          onlinePaymentsAllowCard: suppliers.onlinePaymentsAllowCard,
          onlinePaymentsMinOrderCents: suppliers.onlinePaymentsMinOrderCents,
          onlinePaymentsNotes: suppliers.onlinePaymentsNotes,
          offersDelivery: suppliers.offersDelivery,
          deliveryRadiusMiles: suppliers.deliveryRadiusMiles,
          deliveryFeeCents: suppliers.deliveryFeeCents,
          deliveryMinOrderCents: suppliers.deliveryMinOrderCents,
          deliveryNotes: suppliers.deliveryNotes,
          createdAt: suppliers.createdAt,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt))
        .limit(200);
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
      res.json(rows);
    } catch (error) {
      console.error("Error listing suppliers:", error);
      res.status(500).json({ message: "Failed to load suppliers" });
    }
  });

  app.get("/api/suppliers/:supplierId", async (req: any, res) => {
    try {
      const supplierId = String(req.params.supplierId || "").trim();
      if (!supplierId) return res.status(400).json({ message: "Supplier ID required" });

      const [row] = await db
        .select({
          id: suppliers.id,
          businessName: suppliers.businessName,
          address: suppliers.address,
          city: suppliers.city,
          state: suppliers.state,
          latitude: suppliers.latitude,
          longitude: suppliers.longitude,
          contactPhone: suppliers.contactPhone,
          contactEmail: suppliers.contactEmail,
          isActive: suppliers.isActive,
          onlinePaymentsEnabled: suppliers.onlinePaymentsEnabled,
          onlinePaymentsAllowAch: suppliers.onlinePaymentsAllowAch,
          onlinePaymentsAllowCard: suppliers.onlinePaymentsAllowCard,
          onlinePaymentsMinOrderCents: suppliers.onlinePaymentsMinOrderCents,
          onlinePaymentsNotes: suppliers.onlinePaymentsNotes,
          offersDelivery: suppliers.offersDelivery,
          deliveryRadiusMiles: suppliers.deliveryRadiusMiles,
          deliveryFeeCents: suppliers.deliveryFeeCents,
          deliveryMinOrderCents: suppliers.deliveryMinOrderCents,
          deliveryNotes: suppliers.deliveryNotes,
          createdAt: suppliers.createdAt,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierId), eq(suppliers.isActive, true)))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Supplier not found" });
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
      res.json(row);
    } catch (error) {
      console.error("Error loading supplier:", error);
      res.status(500).json({ message: "Failed to load supplier" });
    }
  });

  app.get("/api/suppliers/:supplierId/products", async (req: any, res) => {
    try {
      const supplierId = String(req.params.supplierId || "").trim();
      if (!supplierId) return res.status(400).json({ message: "Supplier ID required" });

      const rows = await db
        .select({
          id: supplierProducts.id,
          supplierId: supplierProducts.supplierId,
          name: supplierProducts.name,
          description: supplierProducts.description,
          sku: supplierProducts.sku,
          priceCents: supplierProducts.priceCents,
          unitLabel: supplierProducts.unitLabel,
          imageUrl: supplierProducts.imageUrl,
          isActive: supplierProducts.isActive,
          deliveryEligible: supplierProducts.deliveryEligible,
          createdAt: supplierProducts.createdAt,
          updatedAt: supplierProducts.updatedAt,
        })
        .from(supplierProducts)
        .where(and(eq(supplierProducts.supplierId, supplierId), eq(supplierProducts.isActive, true)))
        .orderBy(desc(supplierProducts.updatedAt))
        .limit(500);
      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      );
      res.json(rows);
    } catch (error) {
      console.error("Error listing supplier products:", error);
      res.status(500).json({ message: "Failed to load products" });
    }
  });

  app.post(
    "/api/supplier/products/import",
    isAuthenticated,
    isSupplierProfileOrAdmin,
    importUpload.single("file"),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const file = req.file;
        if (!file) return res.status(400).json({ message: "File is required" });

        const { headers, rows } = await parseTabularFile(
          file.buffer,
          file.originalname || "products.csv",
        );

        const normalizeHeader = (h: string) =>
          String(h || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        const headerMap = headers.map(normalizeHeader);
        const idx = (names: string[]) => {
          for (const name of names) {
            const i = headerMap.indexOf(name);
            if (i >= 0) return i;
          }
          return -1;
        };

        const nameIdx = idx(["name", "product", "product_name", "title"]);
        const skuIdx = idx(["sku", "product_sku", "item_sku"]);
        const descIdx = idx(["description", "desc", "details"]);
        const unitIdx = idx(["unit", "unit_label", "uom"]);
        const priceIdx = idx(["price_cents", "price", "unit_price", "unit_price_cents"]);
        const activeIdx = idx(["is_active", "active", "enabled"]);
        const deliveryIdx = idx(["delivery_eligible", "delivery", "deliverable"]);

        if (nameIdx < 0) {
          return res.status(400).json({
            message: "Missing required column: name",
            headers,
          });
        }

        const parsePriceCents = (raw: string) => {
          const cleaned = String(raw || "").trim().replace(/[$,]/g, "");
          if (!cleaned) return 0;
          const n = Number(cleaned);
          if (!Number.isFinite(n)) return 0;
          // If the sheet provided cents explicitly, accept integers; otherwise treat as dollars.
          if (/^\d+$/.test(cleaned) && cleaned.length >= 3) {
            return Math.max(0, Math.round(n));
          }
          return Math.max(0, Math.round(n * 100));
        };

        const parseBool = (raw: string) => {
          const v = String(raw || "").trim().toLowerCase();
          if (!v) return true;
          if (["0", "false", "no", "n", "off"].includes(v)) return false;
          if (["1", "true", "yes", "y", "on"].includes(v)) return true;
          return true;
        };

        const toCell = (row: string[], i: number) =>
          i >= 0 ? String(row[i] ?? "").trim() : "";

        const created: any[] = [];
        const updated: any[] = [];
        const skipped: any[] = [];

        for (const row of rows) {
          const name = toCell(row, nameIdx);
          if (!name) continue;
          const sku = toCell(row, skuIdx) || null;
          const description = toCell(row, descIdx) || null;
          const unitLabel = toCell(row, unitIdx) || null;
          const priceCents = parsePriceCents(toCell(row, priceIdx));
          const isActive = parseBool(toCell(row, activeIdx));
          const deliveryEligible = parseBool(toCell(row, deliveryIdx));

          const existing = sku
            ? await db
                .select()
                .from(supplierProducts)
                .where(
                  and(
                    eq(supplierProducts.supplierId, supplier.id),
                    eq(supplierProducts.sku, sku),
                  ),
                )
                .limit(1)
            : await db
                .select()
                .from(supplierProducts)
                .where(
                  and(
                    eq(supplierProducts.supplierId, supplier.id),
                    eq(supplierProducts.name, name),
                  ),
                )
                .limit(1);

          if (existing.length > 0) {
            const [rowUpdated] = await db
              .update(supplierProducts)
              .set({
                name,
                sku,
                description,
                unitLabel,
                priceCents,
                isActive,
                deliveryEligible,
                updatedAt: new Date(),
              } as any)
              .where(eq(supplierProducts.id, existing[0].id))
              .returning();
            updated.push(rowUpdated);
            continue;
          }

          const [rowCreated] = await db
            .insert(supplierProducts)
            .values({
              supplierId: supplier.id,
              name,
              sku,
              description,
              unitLabel,
              priceCents,
              isActive,
              deliveryEligible,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as any)
            .returning();
          if (rowCreated) created.push(rowCreated);
          else skipped.push({ name, sku });
        }

        res.json({
          success: true,
          imported: created.length + updated.length,
          created: created.length,
          updated: updated.length,
          skipped: skipped.length,
        });
      } catch (error: any) {
        console.error("Error importing supplier products:", error);
        res.status(500).json({ message: error.message || "Failed to import products" });
      }
    },
  );

  // Supplier self-management
  app.get("/api/supplier/me", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      res.json(supplier);
    } catch (error) {
      console.error("Error loading supplier profile:", error);
      res.status(500).json({ message: "Failed to load supplier profile" });
    }
  });

  app.patch("/api/supplier/me", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const schema = z.object({
        businessName: z.string().min(1).max(120).optional(),
        address: z.string().max(200).optional().nullable(),
        city: z.string().max(120).optional().nullable(),
        state: z.string().max(50).optional().nullable(),
        latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
        longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
        contactPhone: z.string().max(50).optional().nullable(),
        contactEmail: z.string().max(200).optional().nullable(),
        isActive: z.boolean().optional(),
        offersDelivery: z.boolean().optional(),
        deliveryRadiusMiles: z.coerce.number().int().min(1).max(250).optional().nullable(),
        deliveryFeeCents: z.coerce.number().int().min(0).max(500_000).optional(),
        deliveryMinOrderCents: z.coerce.number().int().min(0).max(5_000_000).optional(),
        deliveryNotes: z.string().max(2000).optional().nullable(),
        onlinePaymentsEnabled: z.boolean().optional(),
        onlinePaymentsAllowAch: z.boolean().optional(),
        onlinePaymentsAllowCard: z.boolean().optional(),
        onlinePaymentsMinOrderCents: z.coerce.number().int().min(0).max(10_000_000).optional(),
        onlinePaymentsNotes: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});

      const updates: any = { ...parsed, updatedAt: new Date() };
      if (parsed.latitude !== undefined) {
        updates.latitude = parsed.latitude === null ? null : parsed.latitude;
      }
      if (parsed.longitude !== undefined) {
        updates.longitude = parsed.longitude === null ? null : parsed.longitude;
      }
      if (parsed.deliveryRadiusMiles !== undefined) {
        updates.deliveryRadiusMiles =
          parsed.deliveryRadiusMiles === null ? null : parsed.deliveryRadiusMiles;
      }

      const [updated] = await db
        .update(suppliers)
        .set(updates)
        .where(eq(suppliers.id, supplier.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier profile:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid supplier data", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update supplier" });
    }
  });

  app.get("/api/supplier/products", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const rows = await db
        .select()
        .from(supplierProducts)
        .where(eq(supplierProducts.supplierId, supplier.id))
        .orderBy(desc(supplierProducts.updatedAt))
        .limit(500);
      res.json(rows);
    } catch (error) {
      console.error("Error listing supplier products:", error);
      res.status(500).json({ message: "Failed to load products" });
    }
  });

  app.post("/api/supplier/products", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const schema = z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional().nullable(),
        priceCents: z.number().int().min(0),
        unitLabel: z.string().max(40).optional().nullable(),
        imageUrl: z.string().max(500).optional().nullable(),
        deliveryEligible: z.boolean().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.parse(req.body || {});

      const [created] = await db
        .insert(supplierProducts)
        .values({
          supplierId: supplier.id,
          name: parsed.name,
          description: parsed.description ?? null,
          priceCents: parsed.priceCents,
          unitLabel: parsed.unitLabel ?? null,
          imageUrl: parsed.imageUrl ?? null,
          deliveryEligible: parsed.deliveryEligible ?? true,
          isActive: parsed.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any)
        .returning();
      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating supplier product:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid product data", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to create product" });
    }
  });

  app.patch("/api/supplier/products/:productId", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const productId = String(req.params.productId || "").trim();
      if (!productId) return res.status(400).json({ message: "Product ID required" });

      const schema = z.object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).optional().nullable(),
        priceCents: z.number().int().min(0).optional(),
        unitLabel: z.string().max(40).optional().nullable(),
        imageUrl: z.string().max(500).optional().nullable(),
        deliveryEligible: z.boolean().optional(),
        isActive: z.boolean().optional(),
      });
      const parsed = schema.parse(req.body || {});

      const [existing] = await db
        .select()
        .from(supplierProducts)
        .where(and(eq(supplierProducts.id, productId), eq(supplierProducts.supplierId, supplier.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Product not found" });

      const [updated] = await db
        .update(supplierProducts)
        .set({ ...parsed, updatedAt: new Date() } as any)
        .where(eq(supplierProducts.id, productId))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier product:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid product data", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update product" });
    }
  });

  // Buyer requests (pickup-only; payment handled offsite/in-person between buyer and supplier)
  app.post("/api/supplier-requests", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        supplierId: z.string().min(1),
        buyerRestaurantId: z.string().optional().nullable(),
        requestedFulfillment: z.enum(["pickup", "delivery"]).default("pickup"),
        paymentPreference: z.enum(["offsite", "in_person", "online"]).default("offsite"),
        note: z.string().max(2000).optional().nullable(),
        deliveryInstructions: z.string().max(2000).optional().nullable(),
        deliveryAddress: z.string().max(400).optional().nullable(),
        deliveryCity: z.string().max(120).optional().nullable(),
        deliveryState: z.string().max(60).optional().nullable(),
        deliveryPostalCode: z.string().max(30).optional().nullable(),
        items: z
          .array(
            z.object({
              productId: z.string().optional().nullable(),
              sku: z.string().optional().nullable(),
              itemName: z.string().optional().nullable(),
              quantity: z.number().int().min(1).max(100_000),
            }),
          )
          .min(1),
      });
      const parsed = schema.parse(req.body || {});

      let buyerRestaurant: any | null = null;
      try {
        buyerRestaurant = await resolveBuyerRestaurantOrNull(req, parsed.buyerRestaurantId);
      } catch (authError: any) {
        if (String(authError?.message || "") === "Not authorized") {
          return res.status(403).json({ message: "Not authorized" });
        }
        throw authError;
      }

      // Personal buyers are allowed. Business profile is optional.

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, parsed.supplierId), eq(suppliers.isActive, true)))
        .limit(1);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      if (parsed.requestedFulfillment === "delivery" && !(supplier as any).offersDelivery) {
        return res.status(400).json({ message: "Supplier does not offer delivery." });
      }
      if (parsed.paymentPreference === "online" && !(supplier as any).onlinePaymentsEnabled) {
        return res.status(400).json({ message: "Supplier does not accept online payments." });
      }
      if (parsed.requestedFulfillment === "delivery") {
        const addr = parsed.deliveryAddress ?? (buyerRestaurant as any)?.address ?? null;
        const city = parsed.deliveryCity ?? (buyerRestaurant as any)?.city ?? null;
        const state = parsed.deliveryState ?? (buyerRestaurant as any)?.state ?? null;
        if (!String(addr || "").trim() || !String(city || "").trim() || !String(state || "").trim()) {
          return res.status(400).json({
            message: "Delivery requires deliveryAddress, deliveryCity, and deliveryState.",
          });
        }

        const radiusMiles = (supplier as any).deliveryRadiusMiles
          ? Number((supplier as any).deliveryRadiusMiles)
          : null;
        const supplierLat = Number((supplier as any).latitude);
        const supplierLon = Number((supplier as any).longitude);
        const buyerLat = buyerRestaurant ? Number((buyerRestaurant as any).latitude) : NaN;
        const buyerLon = buyerRestaurant ? Number((buyerRestaurant as any).longitude) : NaN;
        if (
          radiusMiles &&
          Number.isFinite(radiusMiles) &&
          radiusMiles > 0 &&
          Number.isFinite(supplierLat) &&
          Number.isFinite(supplierLon) &&
          Number.isFinite(buyerLat) &&
          Number.isFinite(buyerLon)
        ) {
          const distance = haversineMiles(
            { lat: supplierLat, lon: supplierLon },
            { lat: buyerLat, lon: buyerLon },
          );
          if (distance > radiusMiles) {
            return res.status(400).json({
              message: `Delivery address is outside the supplier's delivery radius (${radiusMiles} miles).`,
            });
          }
        }
      }

      const productIds = parsed.items
        .map((i) => (i.productId ? String(i.productId) : ""))
        .filter(Boolean);
      const skus = parsed.items
        .map((i) => (i.sku ? String(i.sku).trim() : ""))
        .filter(Boolean);

      const products =
        productIds.length > 0
          ? await db
              .select()
              .from(supplierProducts)
              .where(
                and(
                  eq(supplierProducts.supplierId, supplier.id),
                  eq(supplierProducts.isActive, true),
                  inArray(supplierProducts.id, productIds),
                ),
              )
          : [];

      const productById = new Map<string, any>(
        (products as any[]).map((p: any) => [String(p.id), p]),
      );

      const productsBySku =
        skus.length > 0
          ? await db
              .select()
              .from(supplierProducts)
              .where(
                and(
                  eq(supplierProducts.supplierId, supplier.id),
                  eq(supplierProducts.isActive, true),
                  inArray(supplierProducts.sku, skus as any),
                ),
              )
          : [];
      const productBySku = new Map<string, any>(
        (productsBySku as any[]).map((p: any) => [String(p.sku || "").trim(), p]),
      );

      const normalized = parsed.items.map((item) => {
        const byId = item.productId ? productById.get(String(item.productId)) : null;
        const bySku = item.sku ? productBySku.get(String(item.sku).trim()) : null;
        const product = byId ?? bySku ?? null;
        return {
          productId: product ? String(product.id) : null,
          itemName: item.itemName ? String(item.itemName).trim() : product?.name ?? null,
          quantity: item.quantity,
        };
      });

      if (parsed.requestedFulfillment === "delivery") {
        const notDeliverable = parsed.items
          .map((item) => {
            const byId = item.productId ? productById.get(String(item.productId)) : null;
            const bySku = item.sku ? productBySku.get(String(item.sku).trim()) : null;
            const product = byId ?? bySku ?? null;
            if (!product) return null;
            if ((product as any).deliveryEligible === false) {
              return { id: String(product.id), name: String(product.name) };
            }
            return null;
          })
          .filter(Boolean);
        if (notDeliverable.length > 0) {
          return res.status(400).json({
            message: "Some items are not eligible for delivery from this supplier.",
            notDeliverable,
          });
        }
      }

      const now = new Date();
      const deliveryAddressEffective =
        parsed.deliveryAddress ?? (buyerRestaurant as any)?.address ?? null;
      const deliveryCityEffective = parsed.deliveryCity ?? (buyerRestaurant as any)?.city ?? null;
      const deliveryStateEffective = parsed.deliveryState ?? (buyerRestaurant as any)?.state ?? null;
      const deliveryDefaults =
        parsed.requestedFulfillment === "delivery"
          ? {
              deliveryAddress: deliveryAddressEffective,
              deliveryCity: deliveryCityEffective,
              deliveryState: deliveryStateEffective,
              deliveryPostalCode: parsed.deliveryPostalCode ?? null,
              deliveryInstructions: parsed.deliveryInstructions ?? null,
              deliveryFeeCents: Number((supplier as any).deliveryFeeCents || 0) || 0,
              deliveryStatus: "pending",
            }
          : {
              deliveryAddress: null,
              deliveryCity: null,
              deliveryState: null,
              deliveryPostalCode: null,
              deliveryInstructions: null,
              deliveryFeeCents: 0,
              deliveryStatus: "pending",
            };

      const request = await db.transaction(async (tx: any) => {
        const [created] = await tx
          .insert(supplierRequests)
          .values({
            supplierId: supplier.id,
            buyerUserId: String(req.user.id),
            buyerRestaurantId: buyerRestaurant ? String((buyerRestaurant as any).id) : null,
            status: "submitted",
            requestedFulfillment: parsed.requestedFulfillment,
            paymentPreference: parsed.paymentPreference,
            note: parsed.note ?? null,
            ...deliveryDefaults,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning();

        const values = normalized.map((row) => ({
          requestId: created.id,
          productId: row.productId,
          itemName: row.itemName,
          quantity: row.quantity,
          createdAt: now,
          updatedAt: now,
        }));
        await tx.insert(supplierRequestItems).values(values as any);
        return created;
      });

      // If any items are unmapped and not listed anywhere, record demand + ping local suppliers (best-effort).
      try {
        const demandByKey = new Map<string, { name: string; quantity: number | null }>();
        for (const row of normalized) {
          if (row.productId) continue;
          const name = String(row.itemName || "").trim();
          if (!name) continue;
          const key = normalizeSupplyKey(name);
          if (!key) continue;
          const prev = demandByKey.get(key);
          const nextQty = Math.max(1, Math.floor(Number(row.quantity || 0) || 1));
          if (!prev) demandByKey.set(key, { name, quantity: nextQty });
          else demandByKey.set(key, { name: prev.name, quantity: (prev.quantity ?? 0) + nextQty });
        }

        for (const d of demandByKey.values()) {
          await recordDemandAndNotifyIfUnlisted({
            buyerRestaurant,
            itemNameRaw: d.name,
            quantity: d.quantity,
            source: "request",
          });
        }
      } catch (demandError) {
        console.warn("Demand capture failed:", demandError);
      }

      // Notify supplier immediately (best-effort).
      try {
        const buyerUser = await storage.getUser(String(req.user.id)).catch(() => null);
        const buyerLabel = buyerRestaurant
          ? String((buyerRestaurant as any).name || "Buyer")
          : String((buyerUser as any)?.name || (buyerUser as any)?.email || "Individual buyer");
        const supplierUser = await storage.getUser(String((supplier as any).userId));
        const to =
          String((supplier as any).contactEmail || "").trim() ||
          String((supplierUser as any)?.email || "").trim();
        if (to) {
          const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
          const manageUrl = `${baseUrl.replace(/\/+$/, "")}/supplier/dashboard`;
          const subject = `New supply request: ${buyerLabel}`;
          const html = `
            <h2>New supply request</h2>
            <p><strong>Buyer:</strong> ${buyerLabel}</p>
            <p><strong>Payment preference:</strong> ${parsed.paymentPreference}</p>
            <p><strong>Note:</strong> ${parsed.note ?? ""}</p>
            <p style="margin: 18px 0;">
              <a href="${manageUrl}" class="cta-button">View request</a>
            </p>
          `;
          enqueueInProcessJob("supplier-request-accepted-email", async () => {
            await emailService.sendBasicEmail(to, subject, html, undefined, "general");
          });
        }
      } catch (notifyError) {
        console.warn("Supplier request notify failed:", notifyError);
      }

      res.status(201).json({ request });
    } catch (error: any) {
      console.error("Error creating supplier request:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(400).json({ message: error.message || "Failed to create request" });
    }
  });

  app.post(
    "/api/supplier-requests/import",
    isAuthenticated,
    importUpload.single("file"),
    async (req: any, res) => {
      try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "File is required" });

        const schema = z.object({
          supplierId: z.string().min(1),
          buyerRestaurantId: z.string().optional().nullable(),
          requestedFulfillment: z.enum(["pickup", "delivery"]).default("pickup"),
          paymentPreference: z.enum(["offsite", "in_person", "online"]).default("offsite"),
          note: z.string().max(2000).optional().nullable(),
          deliveryInstructions: z.string().max(2000).optional().nullable(),
          deliveryAddress: z.string().max(400).optional().nullable(),
          deliveryCity: z.string().max(120).optional().nullable(),
          deliveryState: z.string().max(60).optional().nullable(),
          deliveryPostalCode: z.string().max(30).optional().nullable(),
        });
        const parsedMeta = schema.parse(req.body || {});

        let buyerRestaurant: any | null = null;
        try {
          buyerRestaurant = await resolveBuyerRestaurantOrNull(req, parsedMeta.buyerRestaurantId);
        } catch (authError: any) {
          if (String(authError?.message || "") === "Not authorized") {
            return res.status(403).json({ message: "Not authorized" });
          }
          throw authError;
        }

        // Personal buyers are allowed. Business profile is optional.

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, parsedMeta.supplierId), eq(suppliers.isActive, true)))
        .limit(1);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      if (parsedMeta.requestedFulfillment === "delivery" && !(supplier as any).offersDelivery) {
        return res.status(400).json({ message: "Supplier does not offer delivery." });
      }
      if (parsedMeta.paymentPreference === "online" && !(supplier as any).onlinePaymentsEnabled) {
        return res.status(400).json({ message: "Supplier does not accept online payments." });
      }
      if (parsedMeta.requestedFulfillment === "delivery") {
        const addr = parsedMeta.deliveryAddress ?? (buyerRestaurant as any)?.address ?? null;
        const city = parsedMeta.deliveryCity ?? (buyerRestaurant as any)?.city ?? null;
        const state = parsedMeta.deliveryState ?? (buyerRestaurant as any)?.state ?? null;
        if (!String(addr || "").trim() || !String(city || "").trim() || !String(state || "").trim()) {
          return res.status(400).json({
            message: "Delivery requires deliveryAddress, deliveryCity, and deliveryState.",
          });
        }

        const radiusMiles = (supplier as any).deliveryRadiusMiles
          ? Number((supplier as any).deliveryRadiusMiles)
          : null;
        const supplierLat = Number((supplier as any).latitude);
        const supplierLon = Number((supplier as any).longitude);
        const buyerLat = buyerRestaurant ? Number((buyerRestaurant as any).latitude) : NaN;
        const buyerLon = buyerRestaurant ? Number((buyerRestaurant as any).longitude) : NaN;
        if (
          radiusMiles &&
          Number.isFinite(radiusMiles) &&
          radiusMiles > 0 &&
          Number.isFinite(supplierLat) &&
          Number.isFinite(supplierLon) &&
          Number.isFinite(buyerLat) &&
          Number.isFinite(buyerLon)
        ) {
          const distance = haversineMiles(
            { lat: supplierLat, lon: supplierLon },
            { lat: buyerLat, lon: buyerLon },
          );
          if (distance > radiusMiles) {
            return res.status(400).json({
              message: `Delivery address is outside the supplier's delivery radius (${radiusMiles} miles).`,
            });
          }
        }
      }

        const { headers, rows } = await parseTabularFile(
          file.buffer,
          file.originalname || "request.csv",
        );
        const normalizeHeader = (h: string) =>
          String(h || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        const headerMap = headers.map(normalizeHeader);
        const idx = (names: string[]) => {
          for (const name of names) {
            const i = headerMap.indexOf(name);
            if (i >= 0) return i;
          }
          return -1;
        };
        const skuIdx = idx(["sku", "product_sku", "item_sku"]);
        const nameIdx = idx(["name", "product", "product_name", "item"]);
        const qtyIdx = idx(["quantity", "qty", "count"]);

        if (qtyIdx < 0) {
          return res.status(400).json({ message: "Missing required column: quantity", headers });
        }
        if (skuIdx < 0 && nameIdx < 0) {
          return res.status(400).json({ message: "Missing required column: sku or name", headers });
        }

        const toCell = (row: string[], i: number) =>
          i >= 0 ? String(row[i] ?? "").trim() : "";
        const parsedItems = rows
          .map((row) => {
            const sku = toCell(row, skuIdx);
            const itemName = toCell(row, nameIdx);
            const qtyRaw = toCell(row, qtyIdx);
            const quantity = Math.max(0, Math.floor(Number(qtyRaw)));
            if (!quantity) return null;
            if (!sku && !itemName) return null;
            return { sku: sku || null, itemName: itemName || null, quantity };
          })
          .filter(Boolean) as Array<{ sku: string | null; itemName: string | null; quantity: number }>;

        if (parsedItems.length === 0) {
          return res.status(400).json({ message: "No valid items found in file." });
        }

        const skus = Array.from(new Set(parsedItems.map((i) => i.sku).filter(Boolean))) as string[];
        const productsBySku =
          skus.length > 0
            ? await db
                .select()
                .from(supplierProducts)
                .where(
                  and(
                    eq(supplierProducts.supplierId, supplier.id),
                    eq(supplierProducts.isActive, true),
                    inArray(supplierProducts.sku, skus as any),
                  ),
                )
            : [];
        const productBySku = new Map<string, any>(
          (productsBySku as any[]).map((p: any) => [String(p.sku || "").trim(), p]),
        );

        const normalized = parsedItems.map((item) => {
          const product = item.sku ? productBySku.get(String(item.sku).trim()) : null;
          return {
            productId: product ? String(product.id) : null,
            itemName: item.itemName || product?.name || item.sku || null,
            quantity: item.quantity,
          };
        });

        if (parsedMeta.requestedFulfillment === "delivery") {
          const notDeliverable = parsedItems
            .map((item) => {
              const product = item.sku ? productBySku.get(String(item.sku).trim()) : null;
              if (!product) return null;
              if ((product as any).deliveryEligible === false) {
                return { id: String(product.id), name: String(product.name) };
              }
              return null;
            })
            .filter(Boolean);
          if (notDeliverable.length > 0) {
            return res.status(400).json({
              message: "Some items are not eligible for delivery from this supplier.",
              notDeliverable,
            });
          }
        }

        const now = new Date();
        const deliveryAddressEffective =
          parsedMeta.deliveryAddress ?? (buyerRestaurant as any)?.address ?? null;
        const deliveryCityEffective = parsedMeta.deliveryCity ?? (buyerRestaurant as any)?.city ?? null;
        const deliveryStateEffective = parsedMeta.deliveryState ?? (buyerRestaurant as any)?.state ?? null;
        const deliveryDefaults =
          parsedMeta.requestedFulfillment === "delivery"
            ? {
                deliveryAddress: deliveryAddressEffective,
                deliveryCity: deliveryCityEffective,
                deliveryState: deliveryStateEffective,
                deliveryPostalCode: parsedMeta.deliveryPostalCode ?? null,
                deliveryInstructions: parsedMeta.deliveryInstructions ?? null,
                deliveryFeeCents: Number((supplier as any).deliveryFeeCents || 0) || 0,
                deliveryStatus: "pending",
              }
            : {
                deliveryAddress: null,
                deliveryCity: null,
                deliveryState: null,
                deliveryPostalCode: null,
                deliveryInstructions: null,
                deliveryFeeCents: 0,
                deliveryStatus: "pending",
              };

        const request = await db.transaction(async (tx: any) => {
          const [created] = await tx
            .insert(supplierRequests)
            .values({
              supplierId: supplier.id,
              buyerUserId: String(req.user.id),
              buyerRestaurantId: buyerRestaurant ? String((buyerRestaurant as any).id) : null,
              status: "submitted",
              requestedFulfillment: parsedMeta.requestedFulfillment,
              paymentPreference: parsedMeta.paymentPreference,
              note: parsedMeta.note ?? null,
              ...deliveryDefaults,
              createdAt: now,
              updatedAt: now,
            } as any)
            .returning();
          const values = normalized.map((row) => ({
            requestId: created.id,
            productId: row.productId,
            itemName: row.itemName,
            quantity: row.quantity,
            createdAt: now,
            updatedAt: now,
          }));
          await tx.insert(supplierRequestItems).values(values as any);
          return created;
        });

        // If any items are unmapped and not listed anywhere, record demand + ping local suppliers (best-effort).
        try {
          const demandByKey = new Map<string, { name: string; quantity: number | null }>();
          for (const row of normalized) {
            if (row.productId) continue;
            const name = String(row.itemName || "").trim();
            if (!name) continue;
            const key = normalizeSupplyKey(name);
            if (!key) continue;
            const prev = demandByKey.get(key);
            const nextQty = Math.max(1, Math.floor(Number(row.quantity || 0) || 1));
            if (!prev) demandByKey.set(key, { name, quantity: nextQty });
            else
              demandByKey.set(key, {
                name: prev.name,
                quantity: (prev.quantity ?? 0) + nextQty,
              });
          }

          for (const d of demandByKey.values()) {
            await recordDemandAndNotifyIfUnlisted({
              buyerRestaurant,
              itemNameRaw: d.name,
              quantity: d.quantity,
              source: "import",
            });
          }
        } catch (demandError) {
          console.warn("Demand capture failed:", demandError);
        }

        res.status(201).json({ request, items: normalized.length });
      } catch (error: any) {
        console.error("Error importing supplier request:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request data", errors: error.errors });
        }
        res.status(500).json({ message: error.message || "Failed to import request" });
      }
    },
  );

  app.get("/api/supplier-requests/mine", isAuthenticated, async (req: any, res) => {
    try {
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      let whereClause: any = eq(supplierRequests.buyerUserId, String(req.user.id));

      if (buyerRestaurantId) {
        try {
          const buyerRestaurant = await resolveBuyerRestaurantOrThrow(req, buyerRestaurantId);
          whereClause = eq(supplierRequests.buyerRestaurantId, String((buyerRestaurant as any).id));
        } catch (authError: any) {
          if (String(authError?.message || "") === "Not authorized") {
            return res.status(403).json({ message: "Not authorized" });
          }
          throw authError;
        }
      } else {
        // Backstop for older data: include requests tied to any business the user owns.
        const bizRows = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.ownerId, String(req.user.id)));
        const ids = (bizRows || []).map((r: any) => String(r.id)).filter(Boolean);
        if (ids.length > 0) {
          whereClause = or(whereClause, inArray(supplierRequests.buyerRestaurantId, ids as any));
        }
      }

      const requests = await db
        .select()
        .from(supplierRequests)
        .where(whereClause)
        .orderBy(desc(supplierRequests.createdAt))
        .limit(200);
      res.json(requests);
    } catch (error) {
      console.error("Error listing buyer requests:", error);
      res.status(500).json({ message: "Failed to load requests" });
    }
  });

  app.get("/api/supplier/requests", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const requests = await db
        .select()
        .from(supplierRequests)
        .where(eq(supplierRequests.supplierId, supplier.id))
        .orderBy(desc(supplierRequests.createdAt))
        .limit(500);
      res.json(requests);
    } catch (error) {
      console.error("Error listing supplier requests:", error);
      res.status(500).json({ message: "Failed to load requests" });
    }
  });

  app.post("/api/supplier/requests/:requestId/accept", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const requestId = String(req.params.requestId || "").trim();
      if (!requestId) return res.status(400).json({ message: "Request ID required" });

      const [request] = await db
        .select()
        .from(supplierRequests)
        .where(and(eq(supplierRequests.id, requestId), eq(supplierRequests.supplierId, supplier.id)))
        .limit(1);
      if (!request) return res.status(404).json({ message: "Request not found" });
      if (String((request as any).status) !== "submitted") {
        return res.status(409).json({ message: "Request is not pending." });
      }

      const items = await db
        .select()
        .from(supplierRequestItems)
        .where(eq(supplierRequestItems.requestId, requestId));

      const missing = (items as any[]).filter((i) => !i.productId);
      if (missing.length > 0) {
        return res.status(400).json({
          message: "Request contains unmapped items. Please fix the request items before accepting.",
          missingCount: missing.length,
        });
      }

      const productIds = Array.from(new Set((items as any[]).map((i) => String(i.productId))));
      const products = await db
        .select()
        .from(supplierProducts)
        .where(and(eq(supplierProducts.supplierId, supplier.id), inArray(supplierProducts.id, productIds)));
      const productById = new Map<string, any>((products as any[]).map((p: any) => [String(p.id), p]));

      let subtotalCents = 0;
      const normalizedItems = (items as any[]).map((item) => {
        const product = productById.get(String(item.productId));
        const unitPriceCents = Number(product?.priceCents || 0) || 0;
        const lineTotalCents = unitPriceCents * Number(item.quantity || 0);
        subtotalCents += lineTotalCents;
        return { productId: String(item.productId), quantity: Number(item.quantity), unitPriceCents, lineTotalCents };
      });

      const requestedFulfillment = String((request as any).requestedFulfillment || "pickup");
      const deliveryFeeCents =
        requestedFulfillment === "delivery"
          ? Number((request as any).deliveryFeeCents ?? (supplier as any).deliveryFeeCents ?? 0) || 0
          : 0;

      if (requestedFulfillment === "delivery") {
        const minOrderCents = Number((supplier as any).deliveryMinOrderCents || 0) || 0;
        if (minOrderCents > 0 && subtotalCents < minOrderCents) {
          return res.status(400).json({
            message: `Delivery requires a minimum order of $${(minOrderCents / 100).toFixed(2)}.`,
          });
        }

        const radiusMiles = (supplier as any).deliveryRadiusMiles
          ? Number((supplier as any).deliveryRadiusMiles)
          : null;
        const supplierLat = Number((supplier as any).latitude);
        const supplierLon = Number((supplier as any).longitude);
        const buyer =
          (request as any).buyerRestaurantId
            ? await storage.getRestaurant(String((request as any).buyerRestaurantId)).catch(() => null)
            : null;
        const buyerLat = buyer ? Number((buyer as any)?.latitude) : NaN;
        const buyerLon = buyer ? Number((buyer as any)?.longitude) : NaN;
        if (
          radiusMiles &&
          Number.isFinite(radiusMiles) &&
          radiusMiles > 0 &&
          Number.isFinite(supplierLat) &&
          Number.isFinite(supplierLon) &&
          Number.isFinite(buyerLat) &&
          Number.isFinite(buyerLon)
        ) {
          const distance = haversineMiles(
            { lat: supplierLat, lon: supplierLon },
            { lat: buyerLat, lon: buyerLon },
          );
          if (distance > radiusMiles) {
            return res.status(400).json({
              message: `Delivery address is outside the supplier's delivery radius (${radiusMiles} miles).`,
            });
          }
        }
      }

      const now = new Date();
      const paymentPref = String((request as any).paymentPreference || "offsite");
      const isOnline = paymentPref === "online";
      const supplierGrossCents = subtotalCents + deliveryFeeCents;
      const feeModel = isOnline
        ? computeOnPlatformPaymentFees(supplierGrossCents)
        : null;

      const order = await db.transaction(async (tx: any) => {
        const [createdOrder] = await tx
          .insert(supplierOrders)
          .values({
            supplierId: supplier.id,
            buyerUserId: String((request as any).buyerUserId || req.user.id),
            truckRestaurantId: (request as any).buyerRestaurantId ? String((request as any).buyerRestaurantId) : null,
            status: "submitted",
            paymentMethod: isOnline ? "stripe" : "offsite",
            paymentStatus: isOnline ? "unpaid" : "offsite",
            requestedFulfillment: requestedFulfillment === "delivery" ? "delivery" : "pickup",
            subtotalCents,
            deliveryFeeCents,
            platformFeeCents: feeModel ? feeModel.platformFeeCents : 0,
            stripeFeeEstimateCents: feeModel ? feeModel.stripeFeeEstimateCents : 0,
            totalCents: feeModel ? feeModel.totalCents : supplierGrossCents,
            stripeChargeAmountCents: feeModel ? feeModel.totalCents : 0,
            stripeApplicationFeeCents: feeModel ? feeModel.platformFeeCents + feeModel.buyerProcessingFeeCents : 0,
            stripeTransferAmountCents: feeModel ? supplierGrossCents - feeModel.sellerProcessingFeeCents : 0,
            buyerDiscountCents: 0,
            buyerPaymentMethod: null,
            pickupNote: (request as any).note ?? null,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning();

        await tx.insert(supplierOrderItems).values(
          normalizedItems.map((row) => ({
            orderId: createdOrder.id,
            productId: row.productId,
            quantity: row.quantity,
            unitPriceCents: row.unitPriceCents,
            lineTotalCents: row.lineTotalCents,
            createdAt: now,
            updatedAt: now,
          })) as any,
        );

        await tx
          .update(supplierRequests)
          .set({
            status: "accepted",
            acceptedAt: now,
            acceptedBy: req.user.id,
            orderId: createdOrder.id,
            deliveryStatus:
              String((request as any).requestedFulfillment) === "delivery" ? "accepted" : "pending",
            updatedAt: now,
          } as any)
          .where(eq(supplierRequests.id, requestId));

        return createdOrder;
      });

      // Notify buyer (best-effort).
      try {
        const buyerRestaurant = await storage
          .getRestaurant(String((request as any).buyerRestaurantId))
          .catch(() => null);
        const buyerUser = (request as any).buyerUserId
          ? await storage.getUser(String((request as any).buyerUserId))
          : buyerRestaurant?.ownerId
            ? await storage.getUser(String(buyerRestaurant.ownerId))
            : null;
        const to = String((buyerUser as any)?.email || "").trim();
        if (to) {
          const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
          const ordersUrl = `${baseUrl.replace(/\/+$/, "")}/suppliers`;
          const subject = "Supplier accepted your request";
          const html = `
            <h2>Your supply request was accepted</h2>
            <p><strong>Supplier:</strong> ${supplier.businessName}</p>
            <p>Your request was accepted. Coordinate pickup and payment with the supplier.</p>
            <p style="margin: 18px 0;">
              <a href="${ordersUrl}" class="cta-button">View suppliers</a>
            </p>
          `;
          await emailService.sendBasicEmail(to, subject, html, undefined, "general");
        }
      } catch (notifyError) {
        console.warn("Buyer accept notify failed:", notifyError);
      }

      res.json({ success: true, orderId: order.id });
    } catch (error: any) {
      console.error("Error accepting supplier request:", error);
      res.status(500).json({ message: error.message || "Failed to accept request" });
    }
  });

  // Delivery portal updates (supplier only)
  app.patch(
    "/api/supplier/requests/:requestId/delivery",
    isAuthenticated,
    isSupplierProfileOrAdmin,
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const requestId = String(req.params.requestId || "").trim();
        if (!requestId) return res.status(400).json({ message: "Request ID required" });

        const [request] = await db
          .select()
          .from(supplierRequests)
          .where(
            and(eq(supplierRequests.id, requestId), eq(supplierRequests.supplierId, supplier.id)),
          )
          .limit(1);
        if (!request) return res.status(404).json({ message: "Request not found" });
        if (String((request as any).requestedFulfillment) !== "delivery") {
          return res.status(400).json({ message: "This request is not a delivery request." });
        }

        const schema = z.object({
          deliveryStatus: z
            .enum(["pending", "accepted", "out_for_delivery", "delivered", "cancelled"])
            .optional(),
          deliveryScheduledFor: z.string().optional().nullable(),
          deliveryFeeCents: z.coerce.number().int().min(0).max(500_000).optional(),
        });
        const parsed = schema.parse(req.body || {});

        const currentStatus = String((request as any).deliveryStatus || "pending");
        const requestStatus = String((request as any).status || "");
        const nextStatus = parsed.deliveryStatus ? String(parsed.deliveryStatus) : null;

        if (nextStatus) {
          // Only allow delivery status transitions after the request is accepted.
          if (["out_for_delivery", "delivered"].includes(nextStatus) && requestStatus !== "accepted") {
            return res.status(409).json({ message: "Request must be accepted before starting delivery." });
          }
          // Don't allow going backwards (simple guardrail).
          const order = ["pending", "accepted", "out_for_delivery", "delivered", "cancelled"];
          if (order.indexOf(nextStatus) < 0) {
            return res.status(400).json({ message: "Invalid delivery status." });
          }
          if (
            currentStatus !== "cancelled" &&
            currentStatus !== "delivered" &&
            nextStatus !== "cancelled" &&
            order.indexOf(nextStatus) < order.indexOf(currentStatus)
          ) {
            return res.status(409).json({ message: "Cannot move delivery status backwards." });
          }
        }

        const now = new Date();
        const scheduled =
          parsed.deliveryScheduledFor !== undefined && parsed.deliveryScheduledFor !== null
            ? new Date(String(parsed.deliveryScheduledFor))
            : null;
        const safeScheduled =
          scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null;

        const [updated] = await db
          .update(supplierRequests)
          .set({
            ...(parsed.deliveryStatus ? { deliveryStatus: parsed.deliveryStatus } : {}),
            ...(parsed.deliveryFeeCents !== undefined
              ? { deliveryFeeCents: parsed.deliveryFeeCents }
              : {}),
            ...(parsed.deliveryScheduledFor !== undefined
              ? { deliveryScheduledFor: safeScheduled }
              : {}),
            updatedAt: now,
          } as any)
          .where(eq(supplierRequests.id, requestId))
          .returning();

        // Notify buyer on status changes (best-effort).
        if (nextStatus && nextStatus !== currentStatus) {
          try {
            const buyerRestaurant = (request as any).buyerRestaurantId
              ? await storage.getRestaurant(String((request as any).buyerRestaurantId))
              : null;
            const buyerUser = (request as any).buyerUserId
              ? await storage.getUser(String((request as any).buyerUserId))
              : buyerRestaurant?.ownerId
                ? await storage.getUser(String(buyerRestaurant.ownerId))
                : null;
            const to = String((buyerUser as any)?.email || "").trim();
            if (to) {
              const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";
              const suppliersUrl = `${baseUrl.replace(/\/+$/, "")}/suppliers`;
              const subject = `Delivery update: ${nextStatus.replace(/_/g, " ")}`;
              const address = [
                (updated as any).deliveryAddress,
                (updated as any).deliveryCity,
                (updated as any).deliveryState,
              ]
                .map((v: any) => String(v || "").trim())
                .filter(Boolean)
                .join(", ");
              const html = `
                <h2>Delivery status update</h2>
                <p><strong>Status:</strong> ${nextStatus.replace(/_/g, " ")}</p>
                ${address ? `<p><strong>Delivery to:</strong> ${address}</p>` : ""}
                <p style="margin: 18px 0;">
                  <a href="${suppliersUrl}" class="cta-button">View suppliers</a>
                </p>
              `;
              enqueueInProcessJob("supplier-delivery-status-email", async () => {
                await emailService.sendBasicEmail(to, subject, html, undefined, "general");
              });
            }
          } catch (notifyError) {
            console.warn("Buyer delivery status notify failed:", notifyError);
          }
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating delivery request:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid delivery update", errors: error.errors });
        }
        res.status(500).json({ message: error.message || "Failed to update delivery request" });
      }
    },
  );

  // Buyer ordering (business or individual)
  app.post(
    "/api/supplier-orders",
    isAuthenticated,
    supplierOrderIdempotency,
    createSupplierOrderLimiter,
    async (req: any, res) => {
    try {
      const schema = z.object({
        supplierId: z.string().min(1),
        truckRestaurantId: z.string().optional().nullable(),
        paymentMethod: z.enum(["stripe", "offsite"]).default("offsite"),
        pickupNote: z.string().max(2000).optional().nullable(),
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              quantity: z.number().int().min(1).max(10_000),
            }),
          )
          .min(1),
      });
      const parsed = schema.parse(req.body || {});

      const truckRestaurantId = String(parsed.truckRestaurantId || "").trim();
      if (truckRestaurantId) {
        // Verify business ownership.
        const biz = await storage.getRestaurant(truckRestaurantId);
        if (!biz || String(biz.ownerId) !== String(req.user.id)) {
          return res.status(403).json({ message: "Not authorized" });
        }
      }

      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, parsed.supplierId), eq(suppliers.isActive, true)))
        .limit(1);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const productIds = Array.from(new Set(parsed.items.map((i) => i.productId)));
      const products = await db
        .select()
        .from(supplierProducts)
        .where(
          and(
            eq(supplierProducts.supplierId, supplier.id),
            eq(supplierProducts.isActive, true),
            inArray(supplierProducts.id, productIds),
          ),
        );
      const productById = new Map<string, any>(products.map((p: any) => [String(p.id), p]));

      let subtotalCents = 0;
      const normalizedItems = parsed.items.map((item) => {
        const product = productById.get(String(item.productId));
        if (!product) {
          throw new Error(`Invalid product: ${item.productId}`);
        }
        const unitPriceCents = Number(product.priceCents || 0) || 0;
        const lineTotalCents = unitPriceCents * Number(item.quantity || 0);
        subtotalCents += lineTotalCents;
        return {
          productId: String(product.id),
          quantity: Number(item.quantity),
          unitPriceCents,
          lineTotalCents,
        };
      });

      if (subtotalCents <= 0) {
        return res.status(400).json({ message: "Order total must be greater than $0." });
      }

      const supplierGrossCents = subtotalCents;
      const feeModel =
        parsed.paymentMethod === "stripe"
          ? computeOnPlatformPaymentFees(supplierGrossCents)
          : null;
      const platformFeeCents = feeModel ? feeModel.platformFeeCents : 0;
      const stripeFeeEstimateCents = feeModel ? feeModel.stripeFeeEstimateCents : 0;
      const totalCents = feeModel ? feeModel.totalCents : supplierGrossCents;

      const bypassStripe =
        String(process.env.MEALSCOUT_BYPASS_STRIPE || "").toLowerCase() === "true" ||
        String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true";

      if (parsed.paymentMethod === "stripe" && !stripe && !bypassStripe) {
        return res.status(500).json({ message: "Stripe not configured" });
      }
      if (parsed.paymentMethod === "stripe") {
        if (!(supplier as any).onlinePaymentsEnabled) {
          return res.status(400).json({ message: "Supplier does not accept online payments." });
        }
        const destination = String((supplier as any).stripeConnectAccountId || "").trim();
        if (!destination) {
          return res.status(400).json({
            message: "Supplier is not set up to receive online payments yet.",
            code: "supplier_stripe_not_connected",
          });
        }
        if (
          ((supplier as any).stripeChargesEnabled === false ||
            (supplier as any).stripePayoutsEnabled === false) &&
          !bypassStripe
        ) {
          return res.status(400).json({
            message: "Supplier payout account is not fully enabled yet.",
            code: "supplier_stripe_not_ready",
          });
        }
      }

      const now = new Date();

      const created = await db.transaction(async (tx: any) => {
        const [order] = await tx
          .insert(supplierOrders)
          .values({
            supplierId: supplier.id,
            buyerUserId: String(req.user.id),
            truckRestaurantId: truckRestaurantId || null,
            status: "submitted",
            paymentMethod: parsed.paymentMethod,
            paymentStatus: parsed.paymentMethod === "offsite" ? "offsite" : "unpaid",
            subtotalCents,
            platformFeeCents,
            stripeFeeEstimateCents,
            totalCents,
            stripeChargeAmountCents: feeModel ? feeModel.totalCents : 0,
            stripeApplicationFeeCents: feeModel
              ? feeModel.platformFeeCents + feeModel.buyerProcessingFeeCents
              : 0,
            stripeTransferAmountCents: feeModel
              ? supplierGrossCents - feeModel.sellerProcessingFeeCents
              : 0,
            buyerDiscountCents: 0,
            buyerPaymentMethod: null,
            pickupNote: parsed.pickupNote ?? null,
            createdAt: now,
            updatedAt: now,
          } as any)
          .returning();

        const values = normalizedItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          createdAt: now,
          updatedAt: now,
        }));
        await tx.insert(supplierOrderItems).values(values as any);
        return order;
      });

      if (parsed.paymentMethod === "offsite") {
        return res.status(201).json({ order: created, payment: { method: "offsite" } });
      }

      if (bypassStripe) {
        await db
          .update(supplierOrders)
          .set({
            paymentStatus: "paid",
            updatedAt: new Date(),
          } as any)
          .where(eq(supplierOrders.id, created.id));
        return res.status(201).json({
          order: { ...created, paymentStatus: "paid" },
          payment: {
            bypassed: true,
            totalCents,
            breakdown: {
              supplierGrossCents,
              buyerProcessingFeeCents: feeModel ? feeModel.buyerProcessingFeeCents : 0,
              sellerProcessingFeeCents: feeModel ? feeModel.sellerProcessingFeeCents : 0,
              platformBaseFeeCents: feeModel ? feeModel.platformBaseFeeCents : 0,
            },
          },
        });
      }

      if (!stripe) {
        return res.status(500).json({ message: "Stripe not configured" });
      }

      res.status(201).json({
        order: created,
        payment: {
          method: "stripe",
          requiresPaymentIntent: true,
          totalCents,
          breakdown: {
            supplierGrossCents,
            platformFeeCents,
            stripeFeeEstimateCents,
            buyerProcessingFeeCents: feeModel ? feeModel.buyerProcessingFeeCents : 0,
            sellerProcessingFeeCents: feeModel ? feeModel.sellerProcessingFeeCents : 0,
            platformBaseFeeCents: feeModel ? feeModel.platformBaseFeeCents : 0,
          },
        },
      });
    } catch (error: any) {
      console.error("Error creating supplier order:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid order data", errors: error.errors });
      }
      res.status(400).json({ message: error.message || "Failed to create order" });
    }
    },
  );

  app.get("/api/supplier/orders", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const limit = parsePageLimit(req.query?.limit, 100, 300);
      const before = parseBeforeTimestamp(req.query?.before);
      const whereClause = before
        ? and(
            eq(supplierOrders.supplierId, supplier.id),
            lt(supplierOrders.createdAt, before),
          )
        : eq(supplierOrders.supplierId, supplier.id);
      const orders = await db
        .select()
        .from(supplierOrders)
        .where(whereClause)
        .orderBy(desc(supplierOrders.createdAt))
        .limit(limit);
      if (orders.length > 0) {
        const tail: any = orders[orders.length - 1];
        const tailCreatedAt = tail?.createdAt ? new Date(tail.createdAt).toISOString() : "";
        if (tailCreatedAt) res.setHeader("X-Next-Before", tailCreatedAt);
      }
      res.json(orders);
    } catch (error) {
      console.error("Error listing supplier orders:", error);
      res.status(500).json({ message: "Failed to load orders" });
    }
  });

  // Buyer: list my supplier orders (optionally scoped to a specific business).
  app.get("/api/supplier-orders/mine", isAuthenticated, async (req: any, res) => {
    try {
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const limit = parsePageLimit(req.query?.limit, 100, 300);
      const before = parseBeforeTimestamp(req.query?.before);

      let whereClause: any = eq(supplierOrders.buyerUserId, String(req.user.id));
      if (buyerRestaurantId) {
        const buyerRestaurant = await resolveBuyerRestaurantOrThrow(req, buyerRestaurantId);
        whereClause = eq(supplierOrders.truckRestaurantId, String((buyerRestaurant as any).id));
      }
      if (before) {
        whereClause = and(whereClause, lt(supplierOrders.createdAt, before));
      }

      const rows = await db
        .select({ order: supplierOrders, supplier: suppliers })
        .from(supplierOrders)
        .innerJoin(suppliers, eq(supplierOrders.supplierId, suppliers.id))
        .where(whereClause)
        .orderBy(desc(supplierOrders.createdAt))
        .limit(limit);
      if (rows.length > 0) {
        const tail: any = rows[rows.length - 1];
        const tailCreatedAt = tail?.order?.createdAt
          ? new Date(tail.order.createdAt).toISOString()
          : "";
        if (tailCreatedAt) res.setHeader("X-Next-Before", tailCreatedAt);
      }

      res.json(
        (rows as any[]).map((r: any) => ({
          ...r.order,
          supplier: {
            id: String(r.supplier.id),
            businessName: String(r.supplier.businessName),
            onlinePaymentsEnabled: Boolean(r.supplier.onlinePaymentsEnabled),
            onlinePaymentsAllowAch: Boolean(r.supplier.onlinePaymentsAllowAch ?? true),
            onlinePaymentsAllowCard: Boolean(r.supplier.onlinePaymentsAllowCard ?? true),
          },
        })),
      );
    } catch (error: any) {
      console.error("Error listing buyer supplier orders:", error);
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to load orders" });
    }
  });

  // Buyer: get a supplier order (ownership enforced).
  app.get("/api/supplier-orders/:orderId", isAuthenticated, async (req: any, res) => {
    try {
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ message: "orderId required" });

      const [order] = await db
        .select()
        .from(supplierOrders)
        .where(eq(supplierOrders.id, orderId))
        .limit(1);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const buyerUserId = String((order as any).buyerUserId || "").trim();
      if (buyerUserId && buyerUserId === String(req.user.id)) {
        return res.json(order);
      }
      const buyerRestaurantId = String((order as any).truckRestaurantId || "").trim();
      const buyerRestaurant = buyerRestaurantId
        ? await storage.getRestaurant(buyerRestaurantId).catch(() => null)
        : null;
      if (!buyerRestaurant || String((buyerRestaurant as any).ownerId) !== String(req.user.id)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      res.json(order);
    } catch (error: any) {
      console.error("Error loading buyer supplier order:", error);
      res.status(500).json({ message: error.message || "Failed to load order" });
    }
  });

  // Buyer: create/reuse a Stripe PaymentIntent for an order (ACH first, card second).
  app.post(
    "/api/supplier-orders/:orderId/pay-intent",
    isAuthenticated,
    supplierPayIntentIdempotency,
    supplierPayIntentLimiter,
    async (req: any, res) => {
    try {
      if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ message: "orderId required" });

      const [order] = await db
        .select()
        .from(supplierOrders)
        .where(eq(supplierOrders.id, orderId))
        .limit(1);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const buyerUserId = String((order as any).buyerUserId || "").trim();
      if (buyerUserId) {
        if (buyerUserId !== String(req.user.id)) {
          return res.status(403).json({ message: "Not authorized" });
        }
      } else {
        const buyerRestaurantId = String((order as any).truckRestaurantId || "").trim();
        const buyerRestaurant = buyerRestaurantId
          ? await storage.getRestaurant(buyerRestaurantId).catch(() => null)
          : null;
        if (!buyerRestaurant || String((buyerRestaurant as any).ownerId) !== String(req.user.id)) {
          return res.status(403).json({ message: "Not authorized" });
        }
      }

      if (String((order as any).paymentMethod || "") !== "stripe") {
        return res.status(400).json({ message: "This order is not set up for online payment." });
      }
      if (String((order as any).paymentStatus || "") === "paid") {
        return res.status(409).json({ message: "Order is already paid." });
      }

      const supplierId = String((order as any).supplierId || "").trim();
      const [supplier] = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .limit(1);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      if (!(supplier as any).onlinePaymentsEnabled) {
        return res.status(400).json({ message: "Supplier does not accept online payments." });
      }
      if (
        (supplier as any).stripeChargesEnabled === false ||
        (supplier as any).stripePayoutsEnabled === false
      ) {
        return res.status(400).json({
          message: "Supplier payout account is not fully enabled yet.",
          code: "supplier_stripe_not_ready",
        });
      }

      const destination = String((supplier as any).stripeConnectAccountId || "").trim();
      if (!destination) {
        return res.status(400).json({
          message: "Supplier is not set up to receive online payments yet.",
          code: "supplier_stripe_not_connected",
        });
      }

      const supplierGrossCents =
        Math.max(0, Number((order as any).subtotalCents || 0) || 0) +
        Math.max(0, Number((order as any).deliveryFeeCents || 0) || 0);
      const amountCents = Math.max(
        0,
        Number((order as any).stripeChargeAmountCents || (order as any).totalCents || 0) || 0,
      );
      if (!Number.isFinite(amountCents) || amountCents <= 0 || supplierGrossCents <= 0) {
        return res.status(400).json({ message: "Invalid order total." });
      }

      const feeModel = computeOnPlatformPaymentFees(supplierGrossCents);
      const transferAmountBaseCents = Math.max(
        0,
        Number(
          (order as any).stripeTransferAmountCents ||
            supplierGrossCents - feeModel.sellerProcessingFeeCents ||
            0,
        ) || 0,
      );
      const applicationFeeBaseCents = Math.max(
        0,
        Number(
          (order as any).stripeApplicationFeeCents ||
            feeModel.platformFeeCents + feeModel.buyerProcessingFeeCents ||
            0,
        ) || 0,
      );

      const minOnline = Math.max(0, Number((supplier as any).onlinePaymentsMinOrderCents || 0) || 0);
      if (minOnline > 0 && supplierGrossCents < minOnline) {
        return res.status(400).json({
          message: `Online payments require a minimum order of $${(minOnline / 100).toFixed(2)}.`,
        });
      }

      const methodSchema = z.object({
        paymentMethod: z.enum(["ach", "card"]).optional(),
        promoCode: z.string().max(64).optional(),
      });
      const parsed = methodSchema.parse(req.body || {});

      const testModeEnabled =
        String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true" ||
        process.env.NODE_ENV !== "production";
      const testPromosRequireAdmin =
        String(process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() ===
        "true";
      const normalizedPromoCode = String(parsed.promoCode || "")
        .trim()
        .toUpperCase();
      const isTestDollarPromo =
        normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
      const isAdminUser = ["admin", "super_admin", "staff"].includes(
        String(req.user?.userType || ""),
      );
      if (normalizedPromoCode) {
        if (!isTestDollarPromo) {
          return res.status(400).json({ message: "Invalid promo code" });
        }
        if (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser)) {
          return res.status(403).json({ message: "Not authorized" });
        }
      }

      const configuredDefaultThresholdRaw = String(
        process.env.SUPPLIER_ORDER_ACH_DEFAULT_THRESHOLD_CENTS || "",
      ).trim();
      const thresholdDefaultCents =
        configuredDefaultThresholdRaw === ""
          ? computeAchCheaperThresholdCents()
          : Math.max(0, Number(configuredDefaultThresholdRaw) || 0);
      const discountThresholdCents =
        Math.max(0, Number(process.env.SUPPLIER_ORDER_ACH_DISCOUNT_THRESHOLD_CENTS || thresholdDefaultCents) || thresholdDefaultCents);
      const configuredDiscountCents =
        Math.max(0, Number(process.env.SUPPLIER_ORDER_ACH_DISCOUNT_CENTS || 0) || 0);

      const allowAch = Boolean((supplier as any).onlinePaymentsAllowAch ?? true);
      const allowCard = Boolean((supplier as any).onlinePaymentsAllowCard ?? true);

      const defaultMethod =
        amountCents >= thresholdDefaultCents && allowAch ? "ach" : allowCard ? "card" : allowAch ? "ach" : null;
      const paymentMethod = isTestDollarPromo
        ? "card"
        : parsed.paymentMethod ?? defaultMethod;
      if (!paymentMethod) {
        return res.status(400).json({ message: "No payment methods are enabled for this supplier." });
      }
      if (paymentMethod === "ach" && !allowAch) {
        return res.status(400).json({ message: "Supplier does not allow ACH payments." });
      }
      if (paymentMethod === "card" && !allowCard) {
        return res.status(400).json({ message: "Supplier does not allow card payments." });
      }

      const discountCents =
        paymentMethod === "ach" &&
        configuredDiscountCents > 0 &&
        amountCents >= discountThresholdCents
          ? Math.min(configuredDiscountCents, applicationFeeBaseCents)
          : 0;

      let applicationFeeCents = Math.max(0, applicationFeeBaseCents - discountCents);
      let chargeAmountCents = Math.max(0, amountCents - discountCents);
      let transferAmountCents = Math.max(0, transferAmountBaseCents);

      if (isTestDollarPromo) {
        applicationFeeCents = 0;
        transferAmountCents = 0;
        chargeAmountCents = 100;
      }

      const existingIntentId = String((order as any).stripePaymentIntentId || "").trim();
      if (existingIntentId) {
        const intent = await stripe.paymentIntents.retrieve(existingIntentId);
        const decision = decideSupplierIntentHandling({
          intent: {
            status: intent?.status,
            amount: (intent as any)?.amount,
            metadataPaymentMethod: (intent as any)?.metadata?.paymentMethod,
            paymentMethodTypes: Array.isArray((intent as any)?.payment_method_types)
              ? ((intent as any).payment_method_types as string[])
              : [],
          },
          paymentMethod,
          chargeAmountCents,
        });

        if (decision === "reuse") {
          return res.json({
            paymentIntentId: intent.id,
            clientSecret: (intent as any).client_secret,
            totalCents: amountCents,
            chargeAmountCents,
            buyerDiscountCents: discountCents,
            paymentMethod,
            breakdown: {
              supplierGrossCents,
              platformBaseFeeCents: feeModel.platformBaseFeeCents,
              buyerProcessingFeeCents: feeModel.buyerProcessingFeeCents,
              sellerProcessingFeeCents: feeModel.sellerProcessingFeeCents,
            },
          });
        }
        if (decision === "cancel_and_recreate") {
          await stripe.paymentIntents.cancel(existingIntentId);
        } else {
          return res.status(409).json({
            message: "Existing payment is processing. Try again after it completes or fails.",
          });
        }
      }

      const intentParams: Stripe.PaymentIntentCreateParams = {
        amount: chargeAmountCents,
        currency: "usd",
        payment_method_types: paymentMethod === "ach" ? ["us_bank_account"] : ["card"],
        metadata: {
          supplierOrderId: String((order as any).id),
          supplierId: supplierId,
          buyerUserId: String((order as any).buyerUserId || ""),
          buyerRestaurantId: String((order as any).truckRestaurantId || ""),
          paymentType: "supplier_order",
          paymentMethod: paymentMethod,
          buyerDiscountCents: String(discountCents),
          promoCode: normalizedPromoCode || "",
        },
        ...(isTestDollarPromo
          ? {}
          : {
              application_fee_amount:
                applicationFeeCents > 0 ? applicationFeeCents : undefined,
              transfer_data: {
                destination,
                amount: transferAmountCents,
              },
            }),
      };

      const intent = await stripe.paymentIntents.create(intentParams);

      await db
        .update(supplierOrders)
        .set({
          stripePaymentIntentId: intent.id,
          stripeChargeAmountCents: chargeAmountCents,
          stripeApplicationFeeCents: applicationFeeCents,
          stripeTransferAmountCents: transferAmountCents,
          buyerDiscountCents: discountCents,
          buyerPaymentMethod: paymentMethod,
          updatedAt: new Date(),
        } as any)
        .where(eq(supplierOrders.id, String((order as any).id)));

      res.json({
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        totalCents: amountCents,
        chargeAmountCents,
        buyerDiscountCents: discountCents,
        paymentMethod,
        promoCode: normalizedPromoCode || undefined,
        testPricing: isTestDollarPromo,
        breakdown: {
          supplierGrossCents,
          platformBaseFeeCents: feeModel.platformBaseFeeCents,
          buyerProcessingFeeCents: feeModel.buyerProcessingFeeCents,
          sellerProcessingFeeCents: feeModel.sellerProcessingFeeCents,
          platformFeeCents: Math.max(0, Number((order as any).platformFeeCents || 0) || 0),
          stripeFeeEstimateCents: Math.max(0, Number((order as any).stripeFeeEstimateCents || 0) || 0),
        },
      });
    } catch (error: any) {
      console.error("Error creating supplier order PaymentIntent:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payment request", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to create payment intent" });
    }
    },
  );

  app.patch("/api/supplier/orders/:orderId/status", isAuthenticated, isSupplierProfileOrAdmin, async (req: any, res) => {
    try {
      const supplier = await ensureSupplierProfile(req.user.id);
      const orderId = String(req.params.orderId || "").trim();
      if (!orderId) return res.status(400).json({ message: "Order ID required" });

      const schema = z.object({
        status: z.enum(["submitted", "ready", "completed", "cancelled"]),
      });
      const parsed = schema.parse(req.body || {});

      const [existing] = await db
        .select()
        .from(supplierOrders)
        .where(and(eq(supplierOrders.id, orderId), eq(supplierOrders.supplierId, supplier.id)))
        .limit(1);
      if (!existing) return res.status(404).json({ message: "Order not found" });

      const [updated] = await db
        .update(supplierOrders)
        .set({ status: parsed.status, updatedAt: new Date() } as any)
        .where(eq(supplierOrders.id, orderId))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier order status:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid status", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update order" });
    }
  });

  // Admin helper: list all orders
  app.get("/api/admin/supplier-orders", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    try {
      const limit = parsePageLimit(req.query?.limit, 200, 500);
      const before = parseBeforeTimestamp(req.query?.before);
      const orders = before
        ? await db
            .select()
            .from(supplierOrders)
            .where(lt(supplierOrders.createdAt, before))
            .orderBy(desc(supplierOrders.createdAt))
            .limit(limit)
        : await db
            .select()
            .from(supplierOrders)
            .orderBy(desc(supplierOrders.createdAt))
            .limit(limit);
      if (orders.length > 0) {
        const tail: any = orders[orders.length - 1];
        const tailCreatedAt = tail?.createdAt ? new Date(tail.createdAt).toISOString() : "";
        if (tailCreatedAt) res.setHeader("X-Next-Before", tailCreatedAt);
      }
      res.json(orders);
    } catch (error) {
      console.error("Error listing all supplier orders:", error);
      res.status(500).json({ message: "Failed to load orders" });
    }
  });
}
