import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import { db } from "../../db";
import { supplyShoppingListItems } from "@shared/schema";
import { parseTabularFile } from "../../utils/tabularImport";
import type { SupplierShoppingListOptimizeRouteDeps } from "./shared";

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function registerSupplierShoppingListOptimizeRoutes(
  app: Express,
  deps: SupplierShoppingListOptimizeRouteDeps,
) {
  const {
    resolveBuyerRestaurantOrNull,
    resolveBuyerRestaurantOrThrow,
    resolveSupplyShoppingListOrThrow,
    ensureSupplyOrderPreferences,
    searchSupplierProductsForTerms,
    normalizeSupplyKey,
    haversineMiles,
    recordDemandAndNotifyIfUnlisted,
  } = deps;

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
          costPerStopCents: z.coerce.number().int().min(0).max(50_000).optional(),
          stopMinutes: z.coerce.number().int().min(0).max(240).optional(),
          costPerMinuteCents: z.coerce.number().int().min(0).max(5_000).optional(),
          pingSuppliers: z.coerce.boolean().optional(),
          allowSubstitutions: z.coerce.boolean().optional(),
        });
        const parsedMeta = schema.parse(req.body || {});

        const buyerRestaurant = await resolveBuyerRestaurantOrNull(req, parsedMeta.buyerRestaurantId);
        const prefs = await ensureSupplyOrderPreferences(String(req.user.id));
        const maxStops =
          parsedMeta.maxStops !== undefined
            ? parsedMeta.maxStops
            : Number((prefs as any).maxStops || 2) || 2;
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

        const { headers, rows } = await parseTabularFile(file.buffer, file.originalname || "order-list.csv");
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

        const toCell = (row: string[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");

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
            console.warn("Order-list demand notify failed:", notifyError);
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
            const lineTotalCents = offer.priceCents * Math.max(1, Number(item.quantity || 1) || 1);
            if (!existing) {
              supplierAgg.set(offer.supplierId, {
                supplier: offer.supplier,
                coverageCount: 1,
                subtotalCents: lineTotalCents,
                items: [
                  {
                    query: item.query,
                    productId: offer.productId,
                    priceCents: offer.priceCents,
                    quantity: item.quantity,
                  },
                ],
              });
            } else {
              existing.coverageCount += 1;
              existing.subtotalCents += lineTotalCents;
              existing.items.push({
                query: item.query,
                productId: offer.productId,
                priceCents: offer.priceCents,
                quantity: item.quantity,
              });
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
              const lines: any[] = [];

              for (const item of itemsOut as any[]) {
                const qty = Math.max(1, Math.floor(Number(item.quantity || 1) || 1));
                const offersForItem = item.offers || [];
                if (offersForItem.length === 0) continue;

                const bestA = offersForItem.find((o: any) => o.supplierId === a.supplierId) || null;
                const bestB = offersForItem.find((o: any) => o.supplierId === b.supplierId) || null;

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
}
