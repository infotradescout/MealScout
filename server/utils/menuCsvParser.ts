/**
 * menuCsvParser.ts
 * Parses a CSV/TSV file buffer and returns normalized menu item rows
 * ready to insert into the menu_items table.
 *
 * Expected columns (case-insensitive header matching):
 *   name (required), price (required), description, category,
 *   sku, calories, protein, carbs, fat, dietary_tags, allergens,
 *   available_from, available_to
 */

import { parseTabularFile } from "./tabularImport";

type ParsedMenuItem = {
  menuId: string;
  restaurantId: string;
  categoryName: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  sku: string | null;
  calories: number | null;
  proteinG: string | null;
  carbsG: string | null;
  fatG: string | null;
  dietaryTags: string[];
  allergens: string[];
  isAvailable: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  sortOrder: number;
};

type ParseResult = {
  imported: ParsedMenuItem[];
  skipped: number;
  errors: { row: number; reason: string }[];
};

// Normalize column header to a canonical key.
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\s_-]+/g, "_")
    .trim();
}

// Parse a price string into cents. Accepts "$12.99", "12.99", "1299" (cents).
function parsePriceCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  // Heuristic: if value > 500 and no decimal, treat as cents
  if (num > 500 && !raw.includes(".")) return Math.round(num);
  return Math.round(num * 100);
}

function parseTags(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[,;|]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function parseDecimal(raw: string): string | null {
  const cleaned = raw.replace(/[^0-9.]/g, "").trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num.toFixed(2);
}

function parseIntOrNull(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

export async function parseMenuCsv(
  buffer: Buffer,
  menuId: string,
  restaurantId: string,
): Promise<ParseResult> {
  const { headers, rows } = await parseTabularFile(buffer, "file.csv");

  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    colMap[normalizeHeader(h)] = i;
  });

  const col = (row: string[], ...names: string[]): string => {
    for (const n of names) {
      const idx = colMap[n];
      if (idx !== undefined) return (row[idx] || "").trim();
    }
    return "";
  };

  const imported: ParsedMenuItem[] = [];
  const errors: { row: number; reason: string }[] = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 2; // 1-indexed + header row

    const name = col(row, "name", "item_name", "item", "title");
    if (!name) {
      skipped++;
      return;
    }

    const priceRaw = col(row, "price", "price_cents", "cost", "amount");
    const priceCents = parsePriceCents(priceRaw);
    if (priceCents === null || priceCents < 0) {
      errors.push({
        row: rowNum,
        reason: `Invalid or missing price: "${priceRaw}"`,
      });
      return;
    }

    const description =
      col(row, "description", "desc", "details", "notes") || null;
    const categoryName =
      col(row, "category", "category_name", "section", "menu_section") || null;
    const sku = col(row, "sku", "item_sku", "product_code") || null;
    const calories = parseIntOrNull(col(row, "calories", "cals"));
    const proteinG = parseDecimal(col(row, "protein", "protein_g"));
    const carbsG = parseDecimal(col(row, "carbs", "carbs_g", "carbohydrates"));
    const fatG = parseDecimal(col(row, "fat", "fat_g", "fats"));
    const dietaryTags = parseTags(
      col(row, "dietary_tags", "dietary", "tags", "diet"),
    );
    const allergens = parseTags(col(row, "allergens", "allergen"));
    const availableFrom = col(row, "available_from", "start_time") || null;
    const availableTo = col(row, "available_to", "end_time") || null;

    imported.push({
      menuId,
      restaurantId,
      categoryName,
      name,
      description,
      priceCents,
      sku,
      calories,
      proteinG,
      carbsG,
      fatG,
      dietaryTags,
      allergens,
      isAvailable: true,
      availableFrom,
      availableTo,
      sortOrder: imported.length,
    });
  });

  return { imported, skipped, errors };
}
