import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import { storage } from "../../storage";
import { emailService } from "../../emailService";
import { enqueueInProcessJob } from "../../jobs/jobQueue";
import { parseTabularFile } from "../../utils/tabularImport";
import {
  restaurants,
  supplierOrderItems,
  supplierOrders,
  supplierProducts,
  supplierRequestItems,
  supplierRequests,
  suppliers,
} from "@shared/schema";
import type { SupplierRequestsRouteDeps } from "./shared";

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function registerSupplierRequestsRoutes(
  app: Express,
  deps: SupplierRequestsRouteDeps,
) {
  const {
    isSupplierProfileOrAdmin,
    ensureSupplierProfile,
    resolveBuyerRestaurantOrThrow,
    resolveBuyerRestaurantOrNull,
    haversineMiles,
    normalizeSupplyKey,
    recordDemandAndNotifyIfUnlisted,
    computeOnPlatformPaymentFees,
  } = deps;

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
          .min(1)
          .max(200),
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

        const { headers, rows } = await parseTabularFile(file.buffer, file.originalname || "request.csv");
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

        const toCell = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
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
        const deliveryStateEffective =
          parsedMeta.deliveryState ?? (buyerRestaurant as any)?.state ?? null;
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
            else {
              demandByKey.set(key, {
                name: prev.name,
                quantity: (prev.quantity ?? 0) + nextQty,
              });
            }
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

  app.get(
    "/api/supplier/requests",
    isAuthenticated,
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
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
    },
  );

  app.post(
    "/api/supplier/requests/:requestId/accept",
    isAuthenticated,
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
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
    },
  );

  app.patch(
    "/api/supplier/requests/:requestId/delivery",
    isAuthenticated,
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
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
          if (["out_for_delivery", "delivered"].includes(nextStatus) && requestStatus !== "accepted") {
            return res.status(409).json({ message: "Request must be accepted before starting delivery." });
          }
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
}
