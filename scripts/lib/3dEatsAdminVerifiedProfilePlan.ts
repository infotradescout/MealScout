export type PlannedMenuItem = {
  category: string;
  categoryDescription: string | null;
  name: string;
  description: string | null;
  priceCents: number;
  itemType: "food" | "drink";
  categorySortOrder: number;
  itemSortOrder: number;
};

export type MenuMergeConflict = {
  category: string;
  name: string;
  canonicalPriceCents: number;
  approvedPriceCents: number;
};

const normalizedText = (value: unknown) => String(value || "").trim();

const normalizedKeyPart = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

export const normalizedMenuKey = (row: PlannedMenuItem) =>
  `${normalizedKeyPart(row.category)}\u0000${normalizedKeyPart(row.name)}`;

export const planApprovedMenuAdditions = (
  canonicalRows: PlannedMenuItem[],
  approvedRows: PlannedMenuItem[],
) => {
  const byKey = new Map(
    canonicalRows.map((row) => [normalizedMenuKey(row), row]),
  );
  const rowsToInsert: PlannedMenuItem[] = [];
  const conflicts: MenuMergeConflict[] = [];
  let exactDuplicatesSkipped = 0;

  for (const row of approvedRows) {
    const key = normalizedMenuKey(row);
    const canonical = byKey.get(key);
    if (!canonical) {
      rowsToInsert.push(row);
      byKey.set(key, row);
      continue;
    }
    if (
      canonical.priceCents === row.priceCents &&
      normalizedText(canonical.description) ===
        normalizedText(row.description) &&
      canonical.itemType === row.itemType
    ) {
      exactDuplicatesSkipped += 1;
      continue;
    }
    conflicts.push({
      category: row.category,
      name: row.name,
      canonicalPriceCents: canonical.priceCents,
      approvedPriceCents: row.priceCents,
    });
  }

  return { rowsToInsert, conflicts, exactDuplicatesSkipped };
};
