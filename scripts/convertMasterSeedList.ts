import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

/**
 * Convert the master "Business Lists Master ... .xlsx" into ingest-ready JSON,
 * seeding ONLY the food/bars sheet (MealScout-fit) and excluding Contractors,
 * Hosts, Needs-Review, and metadata sheets.
 *
 * Output feeds scripts/mealscout-bulk-truck-ingest.ts (which dedupes against the
 * DB and fills only missing fields). This script does NOT touch the database.
 *
 * Usage:
 *   npx tsx scripts/convertMasterSeedList.ts
 *   npx tsx scripts/convertMasterSeedList.ts --counties="Escambia,Santa Rosa,Okaloosa,Walton,Bay"
 */

const getArg = (flag: string, dflt = "") => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1) return String(process.argv[idx + 1] || "").trim();
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.split("=").slice(1).join("=").trim() : dflt;
};

const INPUT = getArg(
  "--input",
  "C:\\Users\\flavo\\Downloads\\Business Lists Master - Profile Seeds - Deduped - 2026-07-05 - Image Links - Location Safe.xlsx",
);
const SHEET = getArg("--sheet", "Restaurants-Food-Bars");
const OUT = getArg("--out", "backups/seed-food-bars.json");
const countyFilter = getArg("--counties", "")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

const clean = (v: unknown) => {
  let s = String(v ?? "").trim();
  // Fix common mis-decoded em/en dashes and stray artifacts.
  s = s.replace(/ΓÇö|ΓÇô/g, "-").replace(/\u2014|\u2013/g, "-");
  return s.trim();
};
const cellText = (cell: ExcelJS.Cell): string => {
  let v: any = cell?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v) v = (v as any).text;
    else if ("hyperlink" in v) v = (v as any).hyperlink;
    else if ("result" in v) v = (v as any).result;
    else if (Array.isArray((v as any).richText))
      v = (v as any).richText.map((t: any) => t.text).join("");
  }
  return clean(v);
};

const mapBusinessType = (category: string): string => {
  const c = category.toLowerCase();
  if (c.includes("truck") || c.includes("mobile")) return "food_truck";
  if (c.includes("bar") || c.includes("brew") || c.includes("pub")) return "bar";
  return "restaurant";
};

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet not found: ${SHEET}`);

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell).toLowerCase().replace(/\s+/g, "_");
  });
  const colOf = (name: string) => headers.findIndex((h) => h === name);
  const idx = {
    name: colOf("business_name"),
    category: colOf("business_category"),
    sub: colOf("sub_category"),
    phone: colOf("phone"),
    email: colOf("email"),
    website: colOf("website"),
    facebook: colOf("facebook"),
    instagram: colOf("instagram"),
    images: colOf("image_links"),
    address: colOf("address"),
    city: colOf("city"),
    county: colOf("county"),
    state: colOf("state"),
    zip: colOf("zip"),
    license: colOf("license_number"),
    seed: colOf("seed_id"),
  };

  const out: any[] = [];
  const byType: Record<string, number> = {};
  const byCounty: Record<string, number> = {};
  let withPhone = 0, withEmail = 0, withSite = 0, withSocial = 0, withImage = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (i: number) => (i > 0 ? cellText(row.getCell(i)) : "");
    const name = get(idx.name);
    if (!name) return;
    const county = get(idx.county);
    if (countyFilter.length && !countyFilter.includes(county.toLowerCase())) return;

    const category = get(idx.category);
    const images = get(idx.images)
      .split(/[\s,;|]+/)
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//i.test(u));
    const phone = get(idx.phone);
    const email = get(idx.email);
    // The DBPR-sourced website column is ~99% junk (license portal / google).
    // Keep only real business sites; route facebook.com values to the facebook field.
    const JUNK_HOSTS = new Set([
      "myfloridalicense.custhelp.com",
      "www.google.com",
      "google.com",
    ]);
    const rawWebsite = get(idx.website);
    const wsHost = rawWebsite.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
    let website = "";
    let facebookFromSite = "";
    if (rawWebsite && !JUNK_HOSTS.has(wsHost)) {
      if (wsHost.includes("facebook.com")) facebookFromSite = rawWebsite;
      else website = rawWebsite;
    }
    const facebook = get(idx.facebook) || facebookFromSite;
    const instagram = get(idx.instagram);

    if (phone) withPhone += 1;
    if (email) withEmail += 1;
    if (website) withSite += 1;
    if (facebook || instagram) withSocial += 1;
    if (images.length) withImage += 1;

    const businessType = mapBusinessType(category);
    byType[businessType] = (byType[businessType] || 0) + 1;
    const cKey = county || "(unknown)";
    byCounty[cKey] = (byCounty[cKey] || 0) + 1;

    out.push({
      business_name: name,
      business_type: businessType,
      phone,
      email,
      website,
      facebook,
      instagram,
      coverImageUrl: images[0] || "",
      photos: images,
      address: get(idx.address),
      city: get(idx.city),
      state: get(idx.state) || "FL",
      sourceNotes: [
        `seed_id=${get(idx.seed)}`,
        `license=${get(idx.license)}`,
        `category=${category}`,
      ].filter((s) => !s.endsWith("=")),
    });
  });

  mkdirSync("backups", { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");

  console.log(`Sheet: ${SHEET}`);
  if (countyFilter.length) console.log(`County filter: ${countyFilter.join(", ")}`);
  console.log(`Rows written: ${out.length} -> ${OUT}`);
  console.log("\nBy business_type:", JSON.stringify(byType));
  console.log("\nContactability:");
  console.log(`  phone: ${withPhone} | email: ${withEmail} | website: ${withSite} | social: ${withSocial} | image: ${withImage}`);
  const topCounties = Object.entries(byCounty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  console.log("\nTop counties:");
  for (const [c, n] of topCounties) console.log(`  ${c}: ${n}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
