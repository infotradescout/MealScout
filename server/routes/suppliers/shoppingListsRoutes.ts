import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import { supplyShoppingListItems, supplyShoppingLists } from "@shared/schema";
import type { SupplierShoppingListsRouteDeps } from "./shared";

export function registerSupplierShoppingListsRoutes(
  app: Express,
  deps: SupplierShoppingListsRouteDeps,
) {
  const { resolveBuyerRestaurantOrThrow, resolveSupplyShoppingListOrThrow } =
    deps;

  // Shopping lists (Walmart-style: build lists, then optimize purchase plan).
  app.get("/api/supply/lists", isAuthenticated, async (req: any, res) => {
    try {
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const conditions: any[] = [eq(supplyShoppingLists.ownerUserId, String(req.user.id))];
      if (buyerRestaurantId) {
        conditions.push(eq(supplyShoppingLists.buyerRestaurantId, buyerRestaurantId));
      }

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
}
