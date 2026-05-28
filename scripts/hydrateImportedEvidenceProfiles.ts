import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../server/db";
import {
  menuCategories,
  menuItems,
  menus,
  restaurants,
  truckImportListings,
} from "../shared/schema";

const listingIdArg = process.argv.includes("--listing-id")
  ? String(process.argv[process.argv.indexOf("--listing-id") + 1] || "").trim()
  : "";
const businessNameArg = process.argv.includes("--business")
  ? String(process.argv[process.argv.indexOf("--business") + 1] || "").trim()
  : "";
const batchPathArg = process.argv.includes("--batch")
  ? String(process.argv[process.argv.indexOf("--batch") + 1] || "").trim()
  : "";

const normalize = (value: unknown) => String(value || "").trim();
const priceToCents = (value: unknown): number | null => {
  const raw = normalize(value);
  if (!raw) return null;
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
};

const rebuildMenu = async (restaurantId: string, items: any[]) => {
  const parsed = items
    .map((entry: any) => ({
      section: normalize(entry?.section) || "Menu",
      name: normalize(entry?.item_name || entry?.name),
      description: normalize(entry?.description) || null,
      priceCents: priceToCents(entry?.price),
    }))
    .filter((entry) => entry.name);
  if (!parsed.length) return { sections: 0, items: 0 };

  await db.delete(menuItems).where(eq(menuItems.restaurantId, restaurantId));
  await db.delete(menuCategories).where(eq(menuCategories.restaurantId, restaurantId));
  await db.delete(menus).where(eq(menus.restaurantId, restaurantId));

  const [menu] = await db
    .insert(menus)
    .values({
      restaurantId,
      name: "Imported Menu",
      serviceType: "all",
      importSource: "csv",
      importedAt: new Date(),
      isActive: true,
    } as any)
    .returning({ id: menus.id });

  const sections = Array.from(new Set(parsed.map((item) => item.section)));
  const sectionToCategoryId = new Map<string, string>();
  for (let i = 0; i < sections.length; i += 1) {
    const [category] = await db
      .insert(menuCategories)
      .values({
        menuId: menu.id,
        restaurantId,
        name: sections[i],
        sortOrder: i,
        isActive: true,
      } as any)
      .returning({ id: menuCategories.id });
    sectionToCategoryId.set(sections[i], String(category.id));
  }

  let createdItems = 0;
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i];
    if (row.priceCents == null) continue;
    await db.insert(menuItems).values({
      menuId: menu.id,
      categoryId: sectionToCategoryId.get(row.section) || null,
      restaurantId,
      name: row.name,
      description: row.description,
      priceCents: row.priceCents,
      itemType: "food",
      isAvailable: true,
      sortOrder: i,
    } as any);
    createdItems += 1;
  }

  return { sections: sections.length, items: createdItems };
};

const run = async () => {
  const batchRows: any[] =
    batchPathArg && batchPathArg.endsWith(".json")
      ? JSON.parse(readFileSync(batchPathArg, "utf8"))
      : [];
  const batchByName = new Map(
    Array.isArray(batchRows)
      ? batchRows.map((row: any) => [String(row?.business_name || row?.name || "").trim(), row])
      : [],
  );

  if (businessNameArg) {
    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.name, businessNameArg))
      .limit(1);
    if (!restaurant) {
      console.log(
        JSON.stringify(
          { ok: false, reason: "restaurant_not_found", businessName: businessNameArg },
          null,
          2,
        ),
      );
      return;
    }
    const batchRow = batchByName.get(businessNameArg);
    const menu = Array.isArray(batchRow?.menuItems) ? batchRow.menuItems : [];
    if (!menu.length) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            processed: 1,
            report: [
              {
                businessName: businessNameArg,
                restaurantId: restaurant.id,
                status: "skipped_no_batch_menu_evidence",
              },
            ],
          },
          null,
          2,
        ),
      );
      return;
    }
    const rebuilt = await rebuildMenu(String(restaurant.id), menu);
    console.log(
      JSON.stringify(
        {
          ok: true,
          processed: 1,
          report: [
            {
              businessName: businessNameArg,
              restaurantId: restaurant.id,
              status: "menu_hydrated_from_batch",
              createdSections: rebuilt.sections,
              createdItems: rebuilt.items,
              sourceMenuItems: menu.length,
            },
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const listings = listingIdArg
    ? await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingIdArg))
    : await db.execute(sql`
        select *
        from truck_import_listings
        where raw_data ? 'evidenceIngest'
          and status in ('unclaimed', 'processed')
      `).then((r: any) => r.rows || []);

  const report: any[] = [];

  for (const listing of listings as any[]) {
    const extracted = listing?.rawData?.evidenceIngest?.extracted || {};
    const menu = Array.isArray(extracted.menuItems) ? extracted.menuItems : [];
    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.claimedFromImportId, String(listing.id)))
      .limit(1);

    if (!restaurant) {
      report.push({
        listingId: listing.id,
        businessName: listing.name,
        status: "skipped_no_linked_restaurant",
      });
      continue;
    }

    if (!menu.length) {
      report.push({
        listingId: listing.id,
        businessName: listing.name,
        restaurantId: restaurant.id,
        status: "skipped_no_menu_evidence",
      });
      continue;
    }

    const rebuilt = await rebuildMenu(String(restaurant.id), menu);
    report.push({
      listingId: listing.id,
      businessName: listing.name,
      restaurantId: restaurant.id,
      status: "menu_hydrated",
      createdSections: rebuilt.sections,
      createdItems: rebuilt.items,
      sourceMenuItems: menu.length,
    });
  }

  console.log(JSON.stringify({ ok: true, processed: report.length, report }, null, 2));
};

run().catch((error) => {
  console.error("hydrateImportedEvidenceProfiles failed:", error);
  process.exit(1);
});
