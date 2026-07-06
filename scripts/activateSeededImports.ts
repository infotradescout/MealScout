import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../server/db";
import { users, restaurants } from "../shared/schema";

/**
 * Activate seeded import restaurants so they become searchable / publicly viewable.
 *
 * Public search + Scout gate on `isActive` (not isVerified), and the public profile
 * endpoint 404s when `isActive` is false. Seeded imports are created isActive=false,
 * so they're invisible until activated.
 *
 * IMPORTANT:
 * - Sets ONLY isActive=true. Does NOT touch isVerified (that's the Parking Pass
 *   booking/compliance gate — unclaimed leads must stay unverified).
 * - Targets ONLY import-system-owned, currently-inactive rows.
 * - Optional --match-file scopes to exactly the businesses in a seed JSON
 *   (matched by lower(name)+lower(city)) — use this to activate one region/batch.
 * - Dry-run by default (no writes). --apply to write.
 *
 * SEO note: activating thin unclaimed pages en masse can hurt SEO. Recommended to
 * start with one region (via --match-file), ensure profile pages carry LocalBusiness
 * structured data, and treat unclaimed listings as "community/unclaimed"
 * (consider noindex-until-claimed) so Google only indexes richer claimed pages.
 *
 * Examples:
 *   npx tsx scripts/activateSeededImports.ts --match-file=backups/seed-food-bars-nwfl.json
 *   npx tsx scripts/activateSeededImports.ts --match-file=backups/seed-food-bars-nwfl.json --apply
 *   npx tsx scripts/activateSeededImports.ts            # (dry-run, ALL import-owned inactive)
 */

const getArg = (flag: string, dflt = "") => {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=").slice(1).join("=").trim();
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? String(process.argv[idx + 1] || "").trim() : dflt;
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

async function main() {
  const apply = process.argv.includes("--apply");
  const matchFile = getArg("--match-file", "");

  let matchSet: Set<string> | null = null;
  if (matchFile) {
    const parsed = JSON.parse(readFileSync(matchFile, "utf8")) as any[];
    matchSet = new Set(
      parsed
        .map((r) => `${norm(r.business_name || r.name)}|${norm(r.city)}`)
        .filter((k) => k !== "|"),
    );
    console.log(`Match file: ${matchFile} (${matchSet.size} keys)`);
  }

  const importEmail =
    (process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us").toLowerCase();
  const [importUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, importEmail))
    .limit(1);
  if (!importUser) {
    console.error(`Import system user (${importEmail}) not found.`);
    process.exit(1);
  }

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      state: restaurants.state,
    })
    .from(restaurants)
    .where(and(eq(restaurants.ownerId, importUser.id), eq(restaurants.isActive, false)));

  const target = matchSet
    ? rows.filter((r) => matchSet!.has(`${norm(r.name)}|${norm(r.city)}`))
    : rows;

  console.log(`Mode: ${apply ? "APPLY (isActive=true)" : "DRY-RUN (no writes)"}`);
  console.log(`Import-owned inactive rows: ${rows.length}`);
  console.log(`Target to activate: ${target.length}`);
  console.log("(isVerified is intentionally NOT changed — unclaimed leads stay unverified.)");

  if (!apply) {
    console.log("\nSample:");
    for (const r of target.slice(0, 10)) {
      console.log(`  - ${r.id} ${r.name} (${r.city || "?"}, ${r.state || "?"})`);
    }
    console.log("\nDRY-RUN only: no rows changed. Re-run with --apply to activate.");
    process.exit(0);
  }

  const ids = target.map((r) => r.id);
  let updated = 0;
  const chunkSize = 500;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await db
      .update(restaurants)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(restaurants.ownerId, importUser.id), inArray(restaurants.id, chunk)));
    updated += chunk.length;
    console.log(`  activated ${Math.min(i + chunkSize, ids.length)}/${ids.length}`);
  }
  console.log(`\nDone. Activated ${updated} seeded import(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Activate seeded imports failed:", e);
  process.exit(1);
});
