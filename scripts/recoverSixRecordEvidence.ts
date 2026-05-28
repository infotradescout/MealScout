import "dotenv/config";
import { db } from "../server/db";
import { menuCategories, menuItems, menus, restaurants, truckImportListings } from "../shared/schema";
import { eq, inArray } from "drizzle-orm";

const TARGETS = [
  "Sweet Love",
  "The Florida Kitchen - Island Cuisine",
  "Blessed Berry Bowls",
  "Tropiq Fuel LLC",
  "Pie Faced",
  "Something Asian & More",
];

const absUrl = (base: string, raw: string) => {
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
};

const pickFirst = (values: string[]) => values.find((v) => v && /^https?:\/\//i.test(v)) || "";

const extractMetaImage = (html: string, pageUrl: string) => {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const u = absUrl(pageUrl, m[1].trim());
      if (u) return u;
    }
  }
  return "";
};

const parseLdJsonMenu = (html: string) => {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const rows: Array<{ section: string; name: string; description?: string; priceCents: number }> = [];
  for (const s of scripts) {
    const raw = String(s[1] || "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) {
        const sections = n?.hasMenuSection || n?.menu || [];
        const sectionArr = Array.isArray(sections) ? sections : [sections];
        for (const sec of sectionArr) {
          const sectionName = String(sec?.name || "Menu").trim();
          const items = sec?.hasMenuItem || sec?.menuItem || [];
          const itemArr = Array.isArray(items) ? items : [items];
          for (const it of itemArr) {
            const name = String(it?.name || "").trim();
            const description = String(it?.description || "").trim();
            const priceRaw = String(it?.offers?.price || it?.price || "").trim();
            const price = Number(priceRaw);
            if (!name || !Number.isFinite(price)) continue;
            rows.push({
              section: sectionName || "Menu",
              name,
              description: description || undefined,
              priceCents: Math.round(price * 100),
            });
          }
        }
      }
    } catch {
      continue;
    }
  }
  return rows;
};

const ensureMenu = async (restaurantId: string, rows: Array<{ section: string; name: string; description?: string; priceCents: number }>) => {
  if (!rows.length) return 0;
  await db.delete(menuItems).where(eq(menuItems.restaurantId, restaurantId));
  await db.delete(menuCategories).where(eq(menuCategories.restaurantId, restaurantId));
  await db.delete(menus).where(eq(menus.restaurantId, restaurantId));
  const [menu] = await db.insert(menus).values({
    restaurantId,
    name: "Recovered Menu",
    serviceType: "all",
    importSource: "manual",
    importedAt: new Date(),
    isActive: true,
  } as any).returning({ id: menus.id });
  const secNames = [...new Set(rows.map((r) => r.section))];
  const secId = new Map<string, string>();
  for (let i = 0; i < secNames.length; i++) {
    const [cat] = await db.insert(menuCategories).values({
      menuId: menu.id,
      restaurantId,
      name: secNames[i],
      sortOrder: i,
      isActive: true,
    } as any).returning({ id: menuCategories.id });
    secId.set(secNames[i], String(cat.id));
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await db.insert(menuItems).values({
      menuId: menu.id,
      categoryId: secId.get(r.section) || null,
      restaurantId,
      name: r.name,
      description: r.description || null,
      priceCents: r.priceCents,
      itemType: "food",
      isAvailable: true,
      sortOrder: i,
    } as any);
  }
  return rows.length;
};

const run = async () => {
  const rows = await db.select().from(restaurants).where(inArray(restaurants.name, TARGETS as any));
  const results: any[] = [];
  for (const r of rows as any[]) {
    const [listing] = r.claimedFromImportId
      ? await db.select().from(truckImportListings).where(eq(truckImportListings.id, String(r.claimedFromImportId))).limit(1)
      : [null];
    const extracted = (listing as any)?.rawData?.evidenceIngest?.extracted || {};
    const sourceUrls = Array.isArray((listing as any)?.rawData?.evidenceIngest?.sourceUrls)
      ? (listing as any).rawData.evidenceIngest.sourceUrls
      : [];
    const urlCandidates = [
      r.websiteUrl,
      r.facebookPageUrl,
      r.instagramUrl,
      extracted.websiteUrl,
      extracted.website,
      extracted.facebookPageUrl,
      extracted.facebook,
      extracted.instagramUrl,
      extracted.instagram,
      ...sourceUrls,
    ].map((v) => String(v || "").trim()).filter(Boolean);

    let recoveredImage = "";
    let menuRecovered = 0;
    let imageSource = "";
    for (const u of urlCandidates) {
      const pageUrl = /^https?:\/\//i.test(u) ? u : (u.includes(".") ? `https://${u}` : "");
      if (!pageUrl) continue;
      try {
        const res = await fetch(pageUrl, { redirect: "follow" });
        if (!res.ok) continue;
        const html = await res.text();
        if (!recoveredImage) {
          const img = extractMetaImage(html, pageUrl);
          if (img) {
            recoveredImage = img;
            imageSource = pageUrl;
          }
        }
        if (r.name === "Sweet Love" && !menuRecovered) {
          const ldRows = parseLdJsonMenu(html);
          if (ldRows.length) {
            menuRecovered = await ensureMenu(String(r.id), ldRows);
          }
        }
      } catch {
        continue;
      }
    }

    if (!r.coverImageUrl && !r.logoUrl && recoveredImage) {
      await db.update(restaurants).set({ coverImageUrl: recoveredImage, updatedAt: new Date() } as any).where(eq(restaurants.id, String(r.id)));
    }

    results.push({
      business: r.name,
      restaurantId: r.id,
      recoveredImage: recoveredImage || null,
      imageSource: imageSource || null,
      menuRecoveredItems: menuRecovered,
    });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
};

run().catch((error) => {
  console.error("recoverSixRecordEvidence failed:", error);
  process.exit(1);
});

