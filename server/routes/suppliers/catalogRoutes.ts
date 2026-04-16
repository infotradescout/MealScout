import type { Express } from "express";
import { db } from "../../db";
import { supplierProducts, suppliers } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export function registerSupplierCatalogRoutes(app: Express) {
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
}
