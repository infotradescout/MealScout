import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  supplierOrders,
  supplierProducts,
  supplierRequests,
  suppliers,
} from "@shared/schema";
import { parseTabularFile } from "../../utils/tabularImport";
import type {
  EnsureSupplierProfile,
  SupplierRouteMiddleware,
} from "./shared";

type SupplierProfileRouteDeps = {
  isSupplierProfileOrAdmin: SupplierRouteMiddleware;
  ensureSupplierProfile: EnsureSupplierProfile;
};

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function registerSupplierProfileRoutes(
  app: Express,
  deps: SupplierProfileRouteDeps,
) {
  const { isSupplierProfileOrAdmin, ensureSupplierProfile } = deps;

  // Supplier self-management
  app.get(
    "/api/supplier/me",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        res.json(supplier);
      } catch (error) {
        console.error("Error loading supplier profile:", error);
        res.status(500).json({ message: "Failed to load supplier profile" });
      }
    },
  );

  // Backward-compatibility alias for older dashboard clients that still call
  // `/api/suppliers/dashboard` instead of the split `/api/supplier/*` endpoints.
  app.get(
    "/api/suppliers/dashboard",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);

        const [products, orders, requests] = await Promise.all([
          db
            .select()
            .from(supplierProducts)
            .where(eq(supplierProducts.supplierId, supplier.id))
            .orderBy(desc(supplierProducts.updatedAt))
            .limit(500),
          db
            .select()
            .from(supplierOrders)
            .where(eq(supplierOrders.supplierId, supplier.id))
            .orderBy(desc(supplierOrders.createdAt))
            .limit(500),
          db
            .select()
            .from(supplierRequests)
            .where(eq(supplierRequests.supplierId, supplier.id))
            .orderBy(desc(supplierRequests.createdAt))
            .limit(500),
        ]);

        res.json({
          supplier,
          profile: supplier,
          products,
          orders,
          requests,
        });
      } catch (error) {
        console.error("Error loading legacy supplier dashboard payload:", error);
        res.status(500).json({ message: "Failed to load supplier dashboard" });
      }
    },
  );

  app.patch(
    "/api/supplier/me",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const schema = z.object({
          businessName: z.string().min(1).max(120).optional(),
          address: z.string().max(200).optional().nullable(),
          city: z.string().max(120).optional().nullable(),
          state: z.string().max(50).optional().nullable(),
          latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
          longitude: z.coerce
            .number()
            .min(-180)
            .max(180)
            .optional()
            .nullable(),
          contactPhone: z.string().max(50).optional().nullable(),
          contactEmail: z.string().max(200).optional().nullable(),
          isActive: z.boolean().optional(),
          offersDelivery: z.boolean().optional(),
          deliveryRadiusMiles: z.coerce
            .number()
            .int()
            .min(1)
            .max(250)
            .optional()
            .nullable(),
          deliveryFeeCents: z.coerce.number().int().min(0).max(500_000).optional(),
          deliveryMinOrderCents: z.coerce
            .number()
            .int()
            .min(0)
            .max(5_000_000)
            .optional(),
          deliveryNotes: z.string().max(2000).optional().nullable(),
          onlinePaymentsEnabled: z.boolean().optional(),
          onlinePaymentsAllowAch: z.boolean().optional(),
          onlinePaymentsAllowCard: z.boolean().optional(),
          onlinePaymentsMinOrderCents: z.coerce
            .number()
            .int()
            .min(0)
            .max(10_000_000)
            .optional(),
          onlinePaymentsNotes: z.string().max(2000).optional().nullable(),
        });
        const parsed = schema.parse(req.body || {});

        const updates: any = { ...parsed, updatedAt: new Date() };
        if (parsed.latitude !== undefined) {
          updates.latitude = parsed.latitude === null ? null : parsed.latitude;
        }
        if (parsed.longitude !== undefined) {
          updates.longitude =
            parsed.longitude === null ? null : parsed.longitude;
        }
        if (parsed.deliveryRadiusMiles !== undefined) {
          updates.deliveryRadiusMiles =
            parsed.deliveryRadiusMiles === null
              ? null
              : parsed.deliveryRadiusMiles;
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
          return res
            .status(400)
            .json({ message: "Invalid supplier data", errors: error.errors });
        }
        res
          .status(500)
          .json({ message: error.message || "Failed to update supplier" });
      }
    },
  );

  app.get(
    "/api/supplier/products",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
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
    },
  );

  app.post(
    "/api/supplier/products",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
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
          return res
            .status(400)
            .json({ message: "Invalid product data", errors: error.errors });
        }
        res
          .status(500)
          .json({ message: error.message || "Failed to create product" });
      }
    },
  );

  app.patch(
    "/api/supplier/products/:productId",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const productId = String(req.params.productId || "").trim();
        if (!productId)
          return res.status(400).json({ message: "Product ID required" });

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
          .where(
            and(
              eq(supplierProducts.id, productId),
              eq(supplierProducts.supplierId, supplier.id),
            ),
          )
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
          return res
            .status(400)
            .json({ message: "Invalid product data", errors: error.errors });
        }
        res
          .status(500)
          .json({ message: error.message || "Failed to update product" });
      }
    },
  );

  app.post(
    "/api/supplier/products/import",
    (req, res, next) => isSupplierProfileOrAdmin(req, res, next),
    importUpload.single("file"),
    async (req: any, res) => {
      try {
        const supplier = await ensureSupplierProfile(req.user.id);
        const file = req.file;
        if (!file) return res.status(400).json({ message: "File is required" });

        const { headers, rows } = await parseTabularFile(file.buffer, file.originalname || "products.csv");

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

        const toCell = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
        const parseBool = (raw: string, fallback: boolean) => {
          const v = raw.trim().toLowerCase();
          if (!v) return fallback;
          if (["1", "true", "yes", "y", "on"].includes(v)) return true;
          if (["0", "false", "no", "n", "off"].includes(v)) return false;
          return fallback;
        };

        const created: any[] = [];
        const updated: any[] = [];
        const skipped: Array<{ name: string; sku: string | null }> = [];

        for (const row of rows) {
          const name = toCell(row, nameIdx);
          if (!name) continue;
          const sku = toCell(row, skuIdx) || null;
          const description = toCell(row, descIdx) || null;
          const unitLabel = toCell(row, unitIdx) || null;
          const priceRaw = toCell(row, priceIdx);
          const activeRaw = toCell(row, activeIdx);
          const deliveryRaw = toCell(row, deliveryIdx);

          const priceCents = priceRaw
            ? priceRaw.includes(".")
              ? Math.max(0, Math.round(Number(priceRaw) * 100))
              : Math.max(0, Math.round(Number(priceRaw)))
            : 0;
          const isActive = parseBool(activeRaw, true);
          const deliveryEligible = parseBool(deliveryRaw, true);

          const existing =
            sku && sku.length > 0
              ? await db
                  .select()
                  .from(supplierProducts)
                  .where(and(eq(supplierProducts.supplierId, supplier.id), eq(supplierProducts.sku, sku)))
                  .limit(1)
              : await db
                  .select()
                  .from(supplierProducts)
                  .where(and(eq(supplierProducts.supplierId, supplier.id), eq(supplierProducts.name, name)))
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
}
