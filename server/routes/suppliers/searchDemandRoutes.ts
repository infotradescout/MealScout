import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import { supplierProducts, suppliers } from "@shared/schema";
import type { SupplierSearchDemandRouteDeps } from "./shared";

export function registerSupplierSearchDemandRoutes(
  app: Express,
  deps: SupplierSearchDemandRouteDeps,
) {
  const {
    resolveBuyerRestaurantOrThrow,
    resolveBuyerRestaurantOrNull,
    haversineMiles,
    recordDemandAndNotifyIfUnlisted,
  } = deps;

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
}
