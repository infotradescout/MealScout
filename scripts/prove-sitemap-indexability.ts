/**
 * Read-only proof: generate truck sitemap membership with the shared
 * public-indexability predicate against the configured DATABASE_URL.
 * Never writes.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";

import { isTruckBusinessType } from "../shared/businessTypes";
import { restaurants, users } from "../shared/schema";
import { isPublicRestaurantIndexable } from "../server/seo/publicRestaurantIndexability";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(root, "../MealScout/.env"));
loadEnvFile(path.join(root, ".env"));

const CLAIMED_ID = "95c4e656-f3cc-46ab-ae18-53f549cecfd1";
const THIN_ID = "cbd132ee-7bcf-4bee-9150-ed8b9918919d";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL required for read-only sitemap proof");
  }

  const { db } = await import("../server/db");

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      isFoodTruck: restaurants.isFoodTruck,
      businessType: restaurants.businessType,
      isActive: restaurants.isActive,
      ownerId: restaurants.ownerId,
      ownerEmail: users.email,
      address: restaurants.address,
      cuisineType: restaurants.cuisineType,
      description: restaurants.description,
      city: restaurants.city,
      state: restaurants.state,
      rawData: restaurants.rawData,
      phone: restaurants.phone,
      websiteUrl: restaurants.websiteUrl,
      updatedAt: restaurants.updatedAt,
    })
    .from(restaurants)
    .innerJoin(users, eq(restaurants.ownerId, users.id))
    .where(eq(restaurants.isActive, true))
    .orderBy(desc(restaurants.updatedAt))
    .limit(50000);

  const trucks = rows.filter(
    (row) =>
      Boolean(row.isFoodTruck) || isTruckBusinessType(row.businessType),
  );
  const indexableTrucks = trucks.filter((row) =>
    isPublicRestaurantIndexable(row),
  );

  const thin = trucks.find((row) => row.id === THIN_ID);
  const claimed = trucks.find((row) => row.id === CLAIMED_ID);

  assert.ok(thin, "16 Monkeys must exist in active truck pool for counterexample");
  assert.ok(claimed, "3D Eats must exist in active truck pool");

  assert.equal(
    isPublicRestaurantIndexable(thin),
    false,
    "16 Monkeys must not be indexable",
  );
  assert.equal(
    isPublicRestaurantIndexable(claimed),
    true,
    "3D Eats must remain indexable",
  );

  const locs = indexableTrucks.map((row) => {
    const slug = `${String(row.name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 80) || row.id}--${row.id}`;
    return `/truck/${encodeURIComponent(slug)}`;
  });

  assert.ok(
    !locs.some((loc) => loc.includes(THIN_ID)),
    "generated truck sitemap must omit 16 Monkeys",
  );
  assert.ok(
    locs.some((loc) => loc.includes(CLAIMED_ID)),
    "generated truck sitemap must include 3D Eats",
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs
    .map((loc) => `  <url><loc>https://www.mealscout.us${loc}</loc></url>`)
    .join("\n")}\n</urlset>`;

  assert.match(xml, /<urlset[\s\S]*<\/urlset>/);
  assert.equal((xml.match(/<loc>/g) || []).length, locs.length);

  console.log(
    JSON.stringify(
      {
        activeTrucks: trucks.length,
        indexableTrucks: indexableTrucks.length,
        excludedTrucks: trucks.length - indexableTrucks.length,
        thinPresent: false,
        claimedPresent: true,
        thinOwnerEmail: thin.ownerEmail,
        claimedOwnerEmail: claimed.ownerEmail,
        sampleClaimedLoc: locs.find((loc) => loc.includes(CLAIMED_ID)),
      },
      null,
      2,
    ),
  );
  console.log("prove-sitemap-indexability: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
