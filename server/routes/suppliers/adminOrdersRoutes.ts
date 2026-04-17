import type { Express } from "express";
import { desc, lt } from "drizzle-orm";
import { db } from "../../db";
import { supplierOrders } from "@shared/schema";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";

type SupplierAdminOrdersRouteDeps = {
  parsePageLimit: (raw: unknown, fallback: number, max: number) => number;
  parseBeforeTimestamp: (raw: unknown) => Date | null;
};

export function registerSupplierAdminOrdersRoutes(
  app: Express,
  deps: SupplierAdminOrdersRouteDeps,
) {
  const { parsePageLimit, parseBeforeTimestamp } = deps;

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
