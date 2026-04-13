import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import {
  supplyBarcodeMappings,
  supplyItemAliases,
  supplyItems,
  supplyPrices,
  supplyPriceWatches,
  supplyScoutPreferences,
  supplyShoppingListItems,
  supplyShoppingLists,
  supplyStoreLocations,
  supplyStores,
} from "@shared/schema";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { parseTabularFile } from "../utils/tabularImport";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const normalizeKey = (raw: string) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const haversineMiles = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 3958.7613;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

async function ensurePreferences(userId: string) {
  const [existing] = await db
    .select()
    .from(supplyScoutPreferences)
    .where(eq(supplyScoutPreferences.userId, userId))
    .limit(1);
  if (existing) return existing;
  const now = new Date();
  const [created] = await db
    .insert(supplyScoutPreferences)
    .values({
      userId,
      hubLabel: null,
      hubLatitude: null,
      hubLongitude: null,
      maxRadiusMiles: 25,
      costPerStopCents: 800,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return created;
}

async function resolveBuyerRestaurantOrThrow(req: any, buyerRestaurantId: string) {
  const buyerRestaurant = await storage.getRestaurant(buyerRestaurantId);
  if (!buyerRestaurant || String(buyerRestaurant.ownerId) !== String(req.user.id)) {
    throw new Error("Not authorized");
  }
  return buyerRestaurant;
}

export function registerSupplyScoutRoutes(app: Express) {
  app.get("/api/supply-scout/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const prefs = await ensurePreferences(String(req.user.id));
      res.json(prefs);
    } catch (error: any) {
      console.error("Error loading supply scout prefs:", error);
      res.status(500).json({ message: error.message || "Failed to load preferences" });
    }
  });

  app.post("/api/supply-scout/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        hubLabel: z.string().max(120).optional().nullable(),
        hubLatitude: z.coerce.number().min(-90).max(90).optional().nullable(),
        hubLongitude: z.coerce.number().min(-180).max(180).optional().nullable(),
        maxRadiusMiles: z.coerce.number().int().min(1).max(250).optional(),
        costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
      });
      const parsed = schema.parse(req.body || {});
      const existing = await ensurePreferences(String(req.user.id));
      const now = new Date();
      const [updated] = await db
        .update(supplyScoutPreferences)
        .set({ ...parsed, updatedAt: now } as any)
        .where(eq(supplyScoutPreferences.id, existing.id))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supply scout prefs:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid preferences", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update preferences" });
    }
  });

  app.get("/api/supply-scout/items/search", isAuthenticated, async (req: any, res) => {
    try {
      const q = String(req.query?.q || "").trim();
      if (!q) return res.status(400).json({ message: "q is required" });
      const limit = Math.min(Number(req.query?.limit || 25) || 25, 100);
      const key = normalizeKey(q);

      const items = await db
        .select()
        .from(supplyItems)
        .where(or(ilike(supplyItems.canonicalName, `%${q}%`), eq(supplyItems.itemKey, key)))
        .orderBy(desc(supplyItems.updatedAt))
        .limit(limit);

      const aliases = await db
        .select()
        .from(supplyItemAliases)
        .where(ilike(supplyItemAliases.alias, `%${q}%`))
        .limit(limit);

      res.json({ items, aliases });
    } catch (error: any) {
      console.error("Error searching supply items:", error);
      res.status(500).json({ message: error.message || "Failed to search items" });
    }
  });

  app.post("/api/supply-scout/lists", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(120),
        buyerRestaurantId: z.string().optional().nullable(),
        notes: z.string().max(2000).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});
      if (parsed.buyerRestaurantId) {
        await resolveBuyerRestaurantOrThrow(req, parsed.buyerRestaurantId);
      }
      const now = new Date();
      const [created] = await db
        .insert(supplyShoppingLists)
        .values({
          ownerUserId: String(req.user.id),
          buyerRestaurantId: parsed.buyerRestaurantId ?? null,
          name: parsed.name,
          notes: parsed.notes ?? null,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();
      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error creating list:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid list", errors: error.errors });
      }
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to create list" });
    }
  });

  app.get("/api/supply-scout/lists/mine", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supplyShoppingLists)
        .where(eq(supplyShoppingLists.ownerUserId, String(req.user.id)))
        .orderBy(desc(supplyShoppingLists.updatedAt))
        .limit(200);
      res.json(rows);
    } catch (error: any) {
      console.error("Error listing lists:", error);
      res.status(500).json({ message: error.message || "Failed to load lists" });
    }
  });

  app.get("/api/supply-scout/lists/:listId", isAuthenticated, async (req: any, res) => {
    try {
      const listId = String(req.params.listId || "").trim();
      const [list] = await db
        .select()
        .from(supplyShoppingLists)
        .where(and(eq(supplyShoppingLists.id, listId), eq(supplyShoppingLists.ownerUserId, String(req.user.id))))
        .limit(1);
      if (!list) return res.status(404).json({ message: "List not found" });

      const items = await db
        .select()
        .from(supplyShoppingListItems)
        .where(eq(supplyShoppingListItems.listId, listId))
        .orderBy(desc(supplyShoppingListItems.updatedAt))
        .limit(500);

      res.json({ list, items });
    } catch (error: any) {
      console.error("Error loading list:", error);
      res.status(500).json({ message: error.message || "Failed to load list" });
    }
  });

  app.post("/api/supply-scout/lists/:listId/items", isAuthenticated, async (req: any, res) => {
    try {
      const listId = String(req.params.listId || "").trim();
      const [list] = await db
        .select()
        .from(supplyShoppingLists)
        .where(and(eq(supplyShoppingLists.id, listId), eq(supplyShoppingLists.ownerUserId, String(req.user.id))))
        .limit(1);
      if (!list) return res.status(404).json({ message: "List not found" });

      const schema = z.object({
        rawName: z.string().min(1).max(200),
        quantity: z.coerce.number().min(0.01).max(1_000_000).default(1),
        unit: z.string().max(40).optional().nullable(),
      });
      const parsed = schema.parse(req.body || {});
      const now = new Date();
      const [created] = await db
        .insert(supplyShoppingListItems)
        .values({
          listId,
          itemId: null,
          rawName: parsed.rawName.trim(),
          quantity: String(parsed.quantity),
          unit: parsed.unit ?? null,
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();
      await db
        .update(supplyShoppingLists)
        .set({ updatedAt: now } as any)
        .where(eq(supplyShoppingLists.id, listId));
      res.status(201).json(created);
    } catch (error: any) {
      console.error("Error adding list item:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid item", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to add item" });
    }
  });

  // Price Finder: best known unit prices near user prefs (or buyer restaurant state).
  app.get("/api/supply-scout/price-finder", isAuthenticated, async (req: any, res) => {
    try {
      const q = String(req.query?.q || "").trim();
      if (!q) return res.status(400).json({ message: "q is required" });
      const limit = Math.min(Number(req.query?.limit || 30) || 30, 100);
      const buyerRestaurantId = String(req.query?.buyerRestaurantId || "").trim();
      const prefs = await ensurePreferences(String(req.user.id));
      const buyerRestaurant = buyerRestaurantId
        ? await resolveBuyerRestaurantOrThrow(req, buyerRestaurantId)
        : null;

      const state = buyerRestaurant
        ? String((buyerRestaurant as any).state || "").trim()
        : "";

      const key = normalizeKey(q);

      const itemCandidates = await db
        .select()
        .from(supplyItems)
        .where(or(ilike(supplyItems.canonicalName, `%${q}%`), eq(supplyItems.itemKey, key)))
        .limit(25);

      const aliasCandidates = await db
        .select()
        .from(supplyItemAliases)
        .where(or(ilike(supplyItemAliases.alias, `%${q}%`), eq(supplyItemAliases.aliasKey, key)))
        .limit(50);

      const itemIds = Array.from(
        new Set([
          ...itemCandidates.map((i: any) => String(i.id)),
          ...aliasCandidates.map((a: any) => String(a.itemId)),
        ]),
      );
      if (itemIds.length === 0) return res.json({ items: [], offers: [] });

      const locationRows = state
        ? await db
            .select()
            .from(supplyStoreLocations)
            .where(and(eq(supplyStoreLocations.isActive, true), eq(supplyStoreLocations.state, state)))
            .limit(500)
        : await db
            .select()
            .from(supplyStoreLocations)
            .where(eq(supplyStoreLocations.isActive, true))
            .limit(500);

      const locById = new Map((locationRows as any[]).map((l) => [String(l.id), l]));
      const storeIds = Array.from(new Set((locationRows as any[]).map((l) => String(l.storeId))));

      const stores = storeIds.length
        ? await db
            .select()
            .from(supplyStores)
            .where(and(eq(supplyStores.isActive, true), inArray(supplyStores.id, storeIds)))
        : [];
      const storeById = new Map((stores as any[]).map((s) => [String(s.id), s]));

      const priceRows = await db
        .select()
        .from(supplyPrices)
        .where(and(inArray(supplyPrices.itemId, itemIds), eq(supplyPrices.currency, "usd")))
        .orderBy(desc(supplyPrices.observedAt))
        .limit(1500);

      const hubLat = Number((prefs as any).hubLatitude);
      const hubLon = Number((prefs as any).hubLongitude);
      const hasHub = Number.isFinite(hubLat) && Number.isFinite(hubLon);
      const maxRadius = Number((prefs as any).maxRadiusMiles || 25) || 25;

      const offers = (priceRows as any[])
        .map((p: any) => {
          const store = storeById.get(String(p.storeId));
          const loc = p.storeLocationId ? locById.get(String(p.storeLocationId)) : null;
          const lat = Number(loc?.latitude);
          const lon = Number(loc?.longitude);
          const distanceMiles =
            hasHub && Number.isFinite(lat) && Number.isFinite(lon)
              ? haversineMiles({ lat: hubLat, lon: hubLon }, { lat, lon })
              : null;
          return {
            price: p,
            store,
            location: loc,
            distanceMiles,
          };
        })
        .filter((o) => o.store && o.store.isActive)
        .filter((o) => (o.distanceMiles === null ? true : o.distanceMiles <= maxRadius))
        .sort((a, b) => Number(a.price.unitPriceCents) - Number(b.price.unitPriceCents))
        .slice(0, limit);

      res.json({
        items: itemCandidates,
        offers,
      });
    } catch (error: any) {
      console.error("Error in price finder:", error);
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to find prices" });
    }
  });

  // Shopping list import: CSV/TSV/XLSX with columns: name|sku + quantity + unit.
  app.post(
    "/api/supply-scout/lists/:listId/import",
    isAuthenticated,
    upload.single("file"),
    async (req: any, res) => {
      try {
        const listId = String(req.params.listId || "").trim();
        const [list] = await db
          .select()
          .from(supplyShoppingLists)
          .where(and(eq(supplyShoppingLists.id, listId), eq(supplyShoppingLists.ownerUserId, String(req.user.id))))
          .limit(1);
        if (!list) return res.status(404).json({ message: "List not found" });

        const file = req.file;
        if (!file) return res.status(400).json({ message: "File is required" });

        const { headers, rows } = await parseTabularFile(
          file.buffer,
          file.originalname || "shopping-list.csv",
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

        const nameIdx = idx(["name", "product", "product_name", "item", "description"]);
        const skuIdx = idx(["sku", "product_sku", "item_sku"]);
        const qtyIdx = idx(["quantity", "qty", "count"]);
        const unitIdx = idx(["unit", "uom", "unit_label"]);

        if (qtyIdx < 0) return res.status(400).json({ message: "Missing required column: quantity", headers });
        if (nameIdx < 0 && skuIdx < 0) return res.status(400).json({ message: "Missing required column: name or sku", headers });

        const toCell = (row: string[], i: number) =>
          i >= 0 ? String(row[i] ?? "").trim() : "";

        const now = new Date();
        const values = rows
          .map((row) => {
            const rawName = toCell(row, nameIdx) || toCell(row, skuIdx);
            const qtyRaw = toCell(row, qtyIdx);
            const quantity = Number(qtyRaw);
            if (!rawName) return null;
            if (!Number.isFinite(quantity) || quantity <= 0) return null;
            return {
              listId,
              itemId: null,
              rawName: rawName.trim(),
              quantity: String(quantity),
              unit: toCell(row, unitIdx) || null,
              createdAt: now,
              updatedAt: now,
            };
          })
          .filter(Boolean) as any[];

        if (values.length === 0) return res.status(400).json({ message: "No valid items found in file." });

        await db.insert(supplyShoppingListItems).values(values as any);
        await db.update(supplyShoppingLists).set({ updatedAt: now } as any).where(eq(supplyShoppingLists.id, listId));

        res.json({ success: true, imported: values.length });
      } catch (error: any) {
        console.error("Error importing shopping list:", error);
        if (String(error?.message || "") === "Not authorized") {
          return res.status(403).json({ message: "Not authorized" });
        }
        res.status(500).json({ message: error.message || "Failed to import shopping list" });
      }
    },
  );

  // Barcode lookup/bind (scanner happens client-side; this is just storage + lookup).
  app.get("/api/supply-scout/barcodes/:barcode", isAuthenticated, async (req: any, res) => {
    try {
      const barcode = String(req.params.barcode || "").trim();
      if (!barcode) return res.status(400).json({ message: "barcode required" });
      const [row] = await db
        .select()
        .from(supplyBarcodeMappings)
        .where(eq(supplyBarcodeMappings.barcode, barcode))
        .limit(1);
      res.json(row || null);
    } catch (error: any) {
      console.error("Error looking up barcode:", error);
      res.status(500).json({ message: error.message || "Failed to lookup barcode" });
    }
  });

  app.post("/api/supply-scout/barcodes/bind", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        barcode: z.string().min(4).max(64),
        itemName: z.string().min(1).max(200),
      });
      const parsed = schema.parse(req.body || {});
      const key = normalizeKey(parsed.itemName);
      if (!key) return res.status(400).json({ message: "Invalid item name" });

      const now = new Date();
      const [existingItem] = await db
        .select()
        .from(supplyItems)
        .where(eq(supplyItems.itemKey, key))
        .limit(1);

      const item = existingItem
        ? existingItem
        : (
            await db
              .insert(supplyItems)
              .values({
                itemKey: key,
                canonicalName: parsed.itemName.trim(),
                createdAt: now,
                updatedAt: now,
              } as any)
              .returning()
          )[0];

      await db
        .insert(supplyBarcodeMappings)
        .values({
          barcode: parsed.barcode.trim(),
          itemId: String((item as any).id),
          alias: parsed.itemName.trim(),
          createdByUserId: String(req.user.id),
          createdAt: now,
        } as any)
        .onConflictDoUpdate({
          target: supplyBarcodeMappings.barcode,
          set: { itemId: String((item as any).id), alias: parsed.itemName.trim() } as any,
        });

      res.json({ success: true, itemId: String((item as any).id) });
    } catch (error: any) {
      console.error("Error binding barcode:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid barcode bind", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to bind barcode" });
    }
  });

  // Optimized shopping plan (1-stop vs best 2-stop split) using known prices + cost-per-stop.
  app.get("/api/supply-scout/lists/:listId/optimize", isAuthenticated, async (req: any, res) => {
    try {
      const listId = String(req.params.listId || "").trim();
      const [list] = await db
        .select()
        .from(supplyShoppingLists)
        .where(and(eq(supplyShoppingLists.id, listId), eq(supplyShoppingLists.ownerUserId, String(req.user.id))))
        .limit(1);
      if (!list) return res.status(404).json({ message: "List not found" });

      const items = await db
        .select()
        .from(supplyShoppingListItems)
        .where(eq(supplyShoppingListItems.listId, listId))
        .limit(500);
      if (items.length === 0) return res.json({ success: true, plan: null, message: "List is empty" });

      const buyerRestaurant = (list as any).buyerRestaurantId
        ? await resolveBuyerRestaurantOrThrow(req, String((list as any).buyerRestaurantId))
        : null;

      const prefs = await ensurePreferences(String(req.user.id));
      const costPerStopCents = Number((prefs as any).costPerStopCents || 0) || 0;
      const maxRadius = Number((prefs as any).maxRadiusMiles || 25) || 25;

      const state = buyerRestaurant ? String((buyerRestaurant as any).state || "").trim() : "";

      const storeLocs = state
        ? await db
            .select()
            .from(supplyStoreLocations)
            .where(and(eq(supplyStoreLocations.isActive, true), eq(supplyStoreLocations.state, state)))
            .limit(800)
        : await db
            .select()
            .from(supplyStoreLocations)
            .where(eq(supplyStoreLocations.isActive, true))
            .limit(800);

      const storeIds = Array.from(new Set((storeLocs as any[]).map((l) => String(l.storeId))));
      const stores = storeIds.length
        ? await db
            .select()
            .from(supplyStores)
            .where(and(eq(supplyStores.isActive, true), inArray(supplyStores.id, storeIds)))
            .limit(800)
        : [];

      const storeById = new Map((stores as any[]).map((s) => [String(s.id), s]));
      const locsByStore = new Map<string, any[]>();
      for (const loc of storeLocs as any[]) {
        const sid = String(loc.storeId);
        const arr = locsByStore.get(sid) || [];
        arr.push(loc);
        locsByStore.set(sid, arr);
      }

      const hubLat = Number((prefs as any).hubLatitude);
      const hubLon = Number((prefs as any).hubLongitude);
      const hasHub = Number.isFinite(hubLat) && Number.isFinite(hubLon);

      const storeCandidates = storeIds
        .map((sid) => {
          const store = storeById.get(sid);
          if (!store) return null;
          const locs = locsByStore.get(sid) || [];
          let distanceMiles: number | null = null;
          if (hasHub && locs.length > 0) {
            const distances = locs
              .map((l: any) => {
                const lat = Number(l.latitude);
                const lon = Number(l.longitude);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
                return haversineMiles({ lat: hubLat, lon: hubLon }, { lat, lon });
              })
              .filter((d: any) => d !== null) as number[];
            distanceMiles = distances.length ? Math.min(...distances) : null;
          }
          return { storeId: sid, store, distanceMiles };
        })
        .filter(Boolean)
        .filter((s: any) => (s.distanceMiles === null ? true : s.distanceMiles <= maxRadius)) as any[];

      // Resolve list items to supply_items via canonical/alias match (basic).
      const terms = Array.from(new Set((items as any[]).map((i) => String(i.rawName || "").trim()).filter(Boolean))).slice(0, 120);
      const keyTerms = Array.from(new Set(terms.map(normalizeKey))).filter(Boolean).slice(0, 120);

      const matchedItems = await db
        .select()
        .from(supplyItems)
        .where(or(...keyTerms.map((k) => eq(supplyItems.itemKey, k))))
        .limit(300);
      const itemByKey = new Map((matchedItems as any[]).map((it) => [String(it.itemKey), it]));

      const aliasRows = await db
        .select()
        .from(supplyItemAliases)
        .where(inArray(supplyItemAliases.aliasKey, keyTerms))
        .limit(500);
      const itemIdByAliasKey = new Map((aliasRows as any[]).map((a) => [String(a.aliasKey), String(a.itemId)]));

      const resolved = (items as any[]).map((li) => {
        const key = normalizeKey(li.rawName);
        const direct = itemByKey.get(key);
        const aliasItemId = itemIdByAliasKey.get(key);
        return {
          ...li,
          resolvedItemId: direct ? String(direct.id) : aliasItemId || null,
          resolvedKey: key,
        };
      });

      const resolvedItemIds = Array.from(new Set(resolved.map((r) => r.resolvedItemId).filter(Boolean))) as string[];
      if (resolvedItemIds.length === 0) {
        return res.json({
          success: true,
          plan: null,
          message: "No list items matched the catalog yet. Try using clearer names.",
        });
      }

      const priceRows = await db
        .select()
        .from(supplyPrices)
        .where(and(inArray(supplyPrices.itemId, resolvedItemIds), eq(supplyPrices.currency, "usd")))
        .orderBy(desc(supplyPrices.observedAt))
        .limit(5000);

      // For each store+item, keep cheapest known unit price.
      const bestPrice = new Map<string, any>(); // `${storeId}:${itemId}` -> priceRow
      for (const p of priceRows as any[]) {
        const k = `${p.storeId}:${p.itemId}`;
        const existing = bestPrice.get(k);
        if (!existing || Number(p.unitPriceCents) < Number(existing.unitPriceCents)) bestPrice.set(k, p);
      }

      const storeStats = new Map<
        string,
        { store: any; storeId: string; subtotalCents: number; coverage: number; missing: number; lines: any[] }
      >();

      for (const s of storeCandidates) {
        const storeId = String(s.storeId);
        let subtotalCents = 0;
        let coverage = 0;
        let missing = 0;
        const lines: any[] = [];
        for (const li of resolved) {
          const itemId = li.resolvedItemId;
          if (!itemId) continue;
          const p = bestPrice.get(`${storeId}:${itemId}`) || null;
          const qty = Number(li.quantity || 1);
          if (!p) {
            missing += 1;
            continue;
          }
          coverage += 1;
          const lineTotalCents = Number(p.unitPriceCents) * Math.max(1, qty);
          subtotalCents += lineTotalCents;
          lines.push({
            rawName: li.rawName,
            quantity: qty,
            unitPriceCents: Number(p.unitPriceCents),
            lineTotalCents,
            storeId,
            itemId,
          });
        }
        storeStats.set(storeId, { storeId, store: s.store, subtotalCents, coverage, missing, lines });
      }

      const storeArray = Array.from(storeStats.values()).sort((a, b) => {
        if (b.coverage !== a.coverage) return b.coverage - a.coverage;
        return a.subtotalCents - b.subtotalCents;
      });

      // Best 1-stop: must cover all resolved items
      const targetCoverage = resolved.filter((r) => r.resolvedItemId).length;
      const oneStop = storeArray
        .filter((s) => s.coverage === targetCoverage)
        .map((s) => ({ ...s, totalCents: s.subtotalCents + costPerStopCents }))
        .sort((a, b) => a.totalCents - b.totalCents)[0] || null;

      // Best 2-stop split: brute force on top N candidates.
      const topN = Math.min(25, storeArray.length);
      let bestTwo: any = null;
      const listItemIds = resolved.map((r) => r.resolvedItemId).filter(Boolean) as string[];

      for (let i = 0; i < topN; i++) {
        for (let j = i + 1; j < topN; j++) {
          const a = storeArray[i];
          const b = storeArray[j];
          let subtotal = 0;
          let covered = 0;
          const lines: any[] = [];
          for (const li of resolved) {
            const itemId = li.resolvedItemId;
            if (!itemId) continue;
            const pa = bestPrice.get(`${a.storeId}:${itemId}`) || null;
            const pb = bestPrice.get(`${b.storeId}:${itemId}`) || null;
            const qty = Number(li.quantity || 1);
            const pick = pa && pb ? (Number(pa.unitPriceCents) <= Number(pb.unitPriceCents) ? { p: pa, storeId: a.storeId } : { p: pb, storeId: b.storeId }) : pa ? { p: pa, storeId: a.storeId } : pb ? { p: pb, storeId: b.storeId } : null;
            if (!pick) continue;
            covered += 1;
            const lineTotalCents = Number(pick.p.unitPriceCents) * Math.max(1, qty);
            subtotal += lineTotalCents;
            lines.push({ rawName: li.rawName, quantity: qty, unitPriceCents: Number(pick.p.unitPriceCents), lineTotalCents, storeId: pick.storeId, itemId });
          }
          if (covered !== targetCoverage) continue;
          const totalCents = subtotal + costPerStopCents * 2;
          if (!bestTwo || totalCents < bestTwo.totalCents) {
            bestTwo = {
              stores: [a.store, b.store],
              storeIds: [a.storeId, b.storeId],
              subtotalCents: subtotal,
              totalCents,
              lines,
            };
          }
        }
      }

      const bestPlan =
        oneStop && bestTwo
          ? bestTwo.totalCents < oneStop.totalCents
            ? { type: "two_stop", ...bestTwo, baselineOneStopTotalCents: oneStop.totalCents }
            : { type: "one_stop", store: oneStop.store, storeId: oneStop.storeId, subtotalCents: oneStop.subtotalCents, totalCents: oneStop.totalCents, lines: oneStop.lines }
          : oneStop
            ? { type: "one_stop", store: oneStop.store, storeId: oneStop.storeId, subtotalCents: oneStop.subtotalCents, totalCents: oneStop.totalCents, lines: oneStop.lines }
            : bestTwo
              ? { type: "two_stop", ...bestTwo }
              : null;

      res.json({
        success: true,
        resolvedCount: targetCoverage,
        unmatchedCount: listItemIds.length - targetCoverage,
        costPerStopCents,
        plan: bestPlan,
        candidatesConsidered: storeArray.length,
      });
    } catch (error: any) {
      console.error("Error optimizing list:", error);
      if (String(error?.message || "") === "Not authorized") {
        return res.status(403).json({ message: "Not authorized" });
      }
      res.status(500).json({ message: error.message || "Failed to optimize shopping plan" });
    }
  });

  // ── Price Watches CRUD ─────────────────────────────────────────────────────

  /**
   * GET /api/supply-scout/price-watches
   * List all active price watches for the authenticated user.
   */
  app.get("/api/supply-scout/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const watches = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.userId, String(req.user.id)), eq(supplyPriceWatches.isActive, true)))
        .orderBy(desc(supplyPriceWatches.createdAt))
        .limit(200);
      res.json({ watches });
    } catch (error: any) {
      console.error("Error fetching price watches:", error);
      res.status(500).json({ message: error.message || "Failed to fetch price watches" });
    }
  });

  const createPriceWatchSchema = z.object({
    itemKey: z.string().min(1).max(200),
    itemName: z.string().min(1).max(200),
    targetPriceCents: z.number().int().positive().optional(),
    maxRadiusMiles: z.number().int().min(1).max(500).default(25),
    buyerRestaurantId: z.string().optional(),
  });

  /**
   * POST /api/supply-scout/price-watches
   * Create a new price watch for an item.
   */
  app.post("/api/supply-scout/price-watches", isAuthenticated, async (req: any, res) => {
    try {
      const body = createPriceWatchSchema.parse(req.body);
      // Verify restaurant ownership if buyerRestaurantId provided
      if (body.buyerRestaurantId) {
        const ok = await storage.verifyRestaurantOwnership(body.buyerRestaurantId, String(req.user.id));
        if (!ok) return res.status(403).json({ message: "Not authorized for that restaurant" });
      }
      const [watch] = await db
        .insert(supplyPriceWatches)
        .values({
          userId: String(req.user.id),
          itemKey: body.itemKey,
          itemName: body.itemName,
          targetPriceCents: body.targetPriceCents ?? null,
          maxRadiusMiles: body.maxRadiusMiles,
          buyerRestaurantId: body.buyerRestaurantId ?? null,
          isActive: true,
        })
        .returning();
      res.status(201).json({ watch });
    } catch (error: any) {
      console.error("Error creating price watch:", error);
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Validation error" });
      res.status(500).json({ message: error.message || "Failed to create price watch" });
    }
  });

  /**
   * DELETE /api/supply-scout/price-watches/:watchId
   * Deactivate (soft-delete) a price watch.
   */
  app.delete("/api/supply-scout/price-watches/:watchId", isAuthenticated, async (req: any, res) => {
    try {
      const watchId = String(req.params.watchId || "").trim();
      const [watch] = await db
        .select()
        .from(supplyPriceWatches)
        .where(and(eq(supplyPriceWatches.id, watchId), eq(supplyPriceWatches.userId, String(req.user.id))))
        .limit(1);
      if (!watch) return res.status(404).json({ message: "Price watch not found" });
      await db
        .update(supplyPriceWatches)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(supplyPriceWatches.id, watchId));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting price watch:", error);
      res.status(500).json({ message: error.message || "Failed to delete price watch" });
    }
  });
}
