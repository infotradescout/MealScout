import "dotenv/config";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { extname } from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import {
  restaurants,
  menus,
  menuCategories,
  menuItems,
  truckManualSchedules,
  imageUploads,
} from "@shared/schema";
import { uploadToCloudinary, isCloudinaryConfigured } from "../server/imageUpload";

/**
 * Applies a hand-curated profile-completion data file (logo/cover photo,
 * description, operating hours, menu, food-truck manual schedule) to one
 * real business account, as part of the 2026-07-15 real-account
 * completeness follow-up (see scripts/realAccountCompletenessReport.ts).
 *
 * Source data for each business is gathered from the owner directly or
 * from their own public pages (Facebook/Instagram/website) - this script
 * only writes what's given in the data file, it does not invent content.
 *
 * Idempotent: re-running with the same data file skips a menu that
 * already has items, and skips schedule entries that already exist for
 * the same truck+date+location.
 *
 * Usage:
 *   npx tsx scripts/onboardBusinessProfile.ts --data=scripts/data/onboarding/<slug>.json --dry-run
 *   npx tsx scripts/onboardBusinessProfile.ts --data=scripts/data/onboarding/<slug>.json --apply
 */

type OperatingHoursSlot = { open: string; close: string };
type MenuItemInput = {
  name: string;
  description?: string;
  priceCents: number;
  itemType?: string;
  imageLocalPath?: string;
};

function normalizeMenuCategories(
  menu: NonNullable<OnboardingData["menu"]>,
): { name: string; items: MenuItemInput[] }[] {
  if (menu.categories) return menu.categories;
  return [{ name: menu.category || "Menu", items: menu.items || [] }];
}

function allMenuItems(menu: NonNullable<OnboardingData["menu"]>): MenuItemInput[] {
  return normalizeMenuCategories(menu).flatMap((c) => c.items);
}

function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Strips generic food-type suffixes (e.g. "Casablanca Beef" vs "Casablanca
// Beef Taco" should match) without falling back to loose substring
// containment, which false-positives on real distinct items that happen to
// share a word (e.g. "Cola" is NOT the same item as "Diet Cola").
function stripFoodSuffix(normalized: string): string {
  return normalized.replace(/(tacos?|burritos?|sandwiches?)$/, "");
}

function itemAlreadyExists(name: string, existing: { name: string }[]): boolean {
  const normalized = normalizeItemName(name);
  const stripped = stripFoodSuffix(normalized);
  return existing.some((e) => {
    const existingNormalized = normalizeItemName(e.name);
    return (
      existingNormalized === normalized ||
      stripFoodSuffix(existingNormalized) === stripped
    );
  });
}
type OnboardingData = {
  restaurantId: string;
  slug: string;
  logo?: { localPath: string };
  cover?: { localPath: string };
  description?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  facebookPageUrl?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  operatingHours?: Record<string, OperatingHoursSlot[]>;
  menu?: {
    name: string;
    category?: string;
    items?: MenuItemInput[];
    categories?: { name: string; items: MenuItemInput[] }[];
  };
  manualSchedule?: {
    date: string;
    startTime: string;
    endTime: string;
    locationName: string;
    address: string;
    city: string;
    state: string;
    notes?: string;
  }[];
};

type PreparedProfileImage = {
  url: string;
  uploadRow: typeof imageUploads.$inferInsert;
  copiedPath?: string;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const dataArg = args.find((a) => a.startsWith("--data="));
  return {
    dataPath: dataArg?.split("=")[1],
    apply: args.includes("--apply"),
  };
};

async function uploadPhoto(
  localPath: string,
  restaurantId: string,
  ownerId: string,
  kind: "logo" | "cover",
): Promise<PreparedProfileImage> {
  const buffer = readFileSync(localPath);
  const result = await uploadToCloudinary(
    buffer,
    kind === "logo" ? "restaurant-logos" : "restaurant-covers",
    `restaurant-${restaurantId}-${kind}`,
  );

  return {
    url: result.secureUrl,
    uploadRow: {
      uploadedByUserId: ownerId,
      imageType: kind === "logo" ? "restaurant_logo" : "restaurant_cover",
      entityId: restaurantId,
      entityType: "restaurant",
      cloudinaryPublicId: result.publicId,
      cloudinaryUrl: result.secureUrl,
      thumbnailUrl: result.thumbnailUrl,
      width: result.width,
      height: result.height,
      fileSize: result.bytes,
      mimeType: "image/jpeg",
    },
  };
}

/**
 * Fallback used when Cloudinary isn't configured (production has no
 * CLOUDINARY_* secrets as of 2026-07-15). Mirrors the precedent set by the
 * 3D Eats & Tea onboarding (storage_mode: local_public_asset_cloudinary_unconfigured,
 * see artifacts/mealscout-onboarding/3d-eats-and-tea/evidence-assets.md):
 * commit the image into client/public/business-assets/<slug>/ and record an
 * image_uploads row whose cloudinaryUrl is that public path, so the data
 * shape matches a normal upload. Requires a git commit + deploy to go live
 * (it's a build-time static file, not a runtime upload).
 */
async function useLocalPublicAsset(
  localPath: string,
  slug: string,
  restaurantId: string,
  ownerId: string,
  kind: "logo" | "cover",
): Promise<PreparedProfileImage> {
  const ext = extname(localPath) || ".jpg";
  const fileName = kind === "logo" ? `logo${ext}` : `cover-photo${ext}`;
  const destDir = `client/public/business-assets/${slug}`;
  mkdirSync(destDir, { recursive: true });
  const destPath = `${destDir}/${fileName}`;
  copyFileSync(localPath, destPath);
  const publicUrl = `/business-assets/${slug}/${fileName}`;

  console.log(
    `[onboard-business-profile] Committed ${kind} to ${destPath} (needs git commit + deploy to go live).`,
  );
  return {
    url: publicUrl,
    copiedPath: destPath,
    uploadRow: {
      uploadedByUserId: ownerId,
      imageType: kind === "logo" ? "restaurant_logo" : "restaurant_cover",
      entityId: restaurantId,
      entityType: "restaurant",
      cloudinaryUrl: publicUrl,
      thumbnailUrl: publicUrl,
      mimeType: ext === ".png" ? "image/png" : "image/jpeg",
    },
  };
}

async function main() {
  const { dataPath, apply } = parseArgs();
  if (!dataPath) {
    console.error(
      "[onboard-business-profile] Missing --data=<path to onboarding json>",
    );
    process.exit(1);
  }

  const data: OnboardingData = JSON.parse(readFileSync(dataPath, "utf8"));
  console.log(
    `[onboard-business-profile] Starting (${apply ? "APPLY" : "DRY RUN - no writes"}) for restaurant ${data.restaurantId} using ${dataPath}`,
  );

  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, data.restaurantId));
  if (!restaurant) {
    console.error(
      `[onboard-business-profile] Restaurant ${data.restaurantId} not found.`,
    );
    process.exit(1);
  }

  const existingMenuItems = await db
    .select({ id: menuItems.id, name: menuItems.name, imageUrl: menuItems.imageUrl })
    .from(menuItems)
    .where(eq(menuItems.restaurantId, data.restaurantId));
  const [existingMenuRow] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(eq(menus.restaurantId, data.restaurantId));
  const existingCategories = existingMenuRow
    ? await db
        .select({ id: menuCategories.id, name: menuCategories.name })
        .from(menuCategories)
        .where(eq(menuCategories.menuId, existingMenuRow.id))
    : [];
  const existingSchedule = await db
    .select()
    .from(truckManualSchedules)
    .where(eq(truckManualSchedules.truckId, data.restaurantId));

  console.log(`[onboard-business-profile] Plan for "${restaurant.name}":`);
  if (data.logo) console.log(`  - upload logo from ${data.logo.localPath}`);
  if (data.cover) console.log(`  - upload cover from ${data.cover.localPath}`);
  if (data.description) console.log(`  - set description`);
  if (data.websiteUrl) console.log(`  - set websiteUrl`);
  if (data.instagramUrl) console.log(`  - set instagramUrl`);
  if (data.facebookPageUrl) console.log(`  - set facebookPageUrl`);
  if (data.phone) console.log(`  - set phone`);
  if (data.address) console.log(`  - set address`);
  if (data.city) console.log(`  - set city`);
  if (data.state) console.log(`  - set state`);
  if (data.operatingHours) console.log(`  - set operatingHours`);
  if (data.menu) {
    const categories = normalizeMenuCategories(data.menu);
    const allItems = allMenuItems(data.menu);
    const newItems = allItems.filter(
      (item) => !itemAlreadyExists(item.name, existingMenuItems),
    );
    console.log(
      `  - menu: add ${newItems.length}/${allItems.length} new item(s) across ${categories.length} categor${categories.length === 1 ? "y" : "ies"} (${allItems.length - newItems.length} already present)`,
    );
  }
  if (data.manualSchedule) {
    const newEntries = data.manualSchedule.filter(
      (entry) =>
        !existingSchedule.some(
          (row) =>
            row.locationName === entry.locationName &&
            new Date(row.date).toISOString().slice(0, 10) === entry.date,
        ),
    );
    console.log(
      `  - insert ${newEntries.length}/${data.manualSchedule.length} manual schedule entry(ies) (${data.manualSchedule.length - newEntries.length} already present)`,
    );
  }

  if (!apply) {
    console.log(
      "\n[onboard-business-profile] DRY-RUN: no writes made. Re-run with --apply.",
    );
    return;
  }

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `backups/onboard-business-profile-${restaurant.name.replace(/[^a-z0-9]+/gi, "-")}-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify({ restaurant, existingMenuItems, existingSchedule }, null, 2),
    "utf8",
  );
  console.log(`[onboard-business-profile] Backup written: ${backupPath}`);

  const canUploadPhotos = isCloudinaryConfigured();
  if (!canUploadPhotos && (data.logo || data.cover)) {
    console.warn(
      "[onboard-business-profile] Cloudinary is not configured; falling back to committed local public assets (needs a deploy to go live).",
    );
  }

  const copiedAssetPaths: string[] = [];
  let logoImage: PreparedProfileImage | undefined;
  let coverImage: PreparedProfileImage | undefined;
  if (data.logo) {
    logoImage = canUploadPhotos
      ? await uploadPhoto(data.logo.localPath, data.restaurantId, restaurant.ownerId, "logo")
      : await useLocalPublicAsset(data.logo.localPath, data.slug, data.restaurantId, restaurant.ownerId, "logo");
    if (logoImage.copiedPath) copiedAssetPaths.push(logoImage.copiedPath);
    console.log(`[onboard-business-profile] Logo set: ${logoImage.url}`);
  }
  if (data.cover) {
    coverImage = canUploadPhotos
      ? await uploadPhoto(data.cover.localPath, data.restaurantId, restaurant.ownerId, "cover")
      : await useLocalPublicAsset(data.cover.localPath, data.slug, data.restaurantId, restaurant.ownerId, "cover");
    if (coverImage.copiedPath) copiedAssetPaths.push(coverImage.copiedPath);
    console.log(`[onboard-business-profile] Cover set: ${coverImage.url}`);
  }

  const menuItemImageUrls = new Map<string, string>();
  if (data.menu) {
    for (const item of allMenuItems(data.menu)) {
      if (!item.imageLocalPath) continue;
      const itemSlug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const url = canUploadPhotos
        ? (await uploadToCloudinary(readFileSync(item.imageLocalPath), "menu-items", `restaurant-${data.restaurantId}-${itemSlug}`)).secureUrl
        : (() => {
            const ext = extname(item.imageLocalPath!) || ".jpg";
            const destDir = `client/public/business-assets/${data.slug}/menu`;
            mkdirSync(destDir, { recursive: true });
            const destPath = `${destDir}/${itemSlug}${ext}`;
            copyFileSync(item.imageLocalPath!, destPath);
            copiedAssetPaths.push(destPath);
            return `/business-assets/${data.slug}/menu/${itemSlug}${ext}`;
          })();
      menuItemImageUrls.set(item.name, url);
      console.log(`[onboard-business-profile] Menu item image set for "${item.name}": ${url}`);
    }
  }

  try {
    await db.transaction(async (tx: any) => {
    const restaurantUpdates: Record<string, unknown> = {};
    if (logoImage) restaurantUpdates.logoUrl = logoImage.url;
    if (coverImage) restaurantUpdates.coverImageUrl = coverImage.url;
    if (data.description) restaurantUpdates.description = data.description;
    if (data.websiteUrl) restaurantUpdates.websiteUrl = data.websiteUrl;
    if (data.instagramUrl) restaurantUpdates.instagramUrl = data.instagramUrl;
    if (data.facebookPageUrl)
      restaurantUpdates.facebookPageUrl = data.facebookPageUrl;
    if (data.phone) restaurantUpdates.phone = data.phone;
    if (data.address) restaurantUpdates.address = data.address;
    if (data.city) restaurantUpdates.city = data.city;
    if (data.state) restaurantUpdates.state = data.state;
    if (data.operatingHours)
      restaurantUpdates.operatingHours = data.operatingHours;

    if (Object.keys(restaurantUpdates).length > 0) {
      restaurantUpdates.updatedAt = new Date();
      await tx
        .update(restaurants)
        .set(restaurantUpdates)
        .where(eq(restaurants.id, data.restaurantId));
    }

    const profileImageRows = [logoImage?.uploadRow, coverImage?.uploadRow].filter(
      (row): row is typeof imageUploads.$inferInsert => Boolean(row),
    );
    if (profileImageRows.length > 0) {
      await tx.insert(imageUploads).values(profileImageRows);
    }

    if (data.menu) {
      const categories = normalizeMenuCategories(data.menu);
      let menuId = existingMenuRow?.id;
      if (!menuId) {
        const [menuRow] = await tx
          .insert(menus)
          .values({ restaurantId: data.restaurantId, name: data.menu.name })
          .returning();
        menuId = menuRow.id;
      }

      const knownItems = [...existingMenuItems];
      const categoryIdByName = new Map(
        existingCategories.map((c) => [c.name.toLowerCase(), c.id]),
      );
      let itemCount = 0;
      for (const category of categories) {
        let categoryId = categoryIdByName.get(category.name.toLowerCase());
        if (!categoryId) {
          const [categoryRow] = await tx
            .insert(menuCategories)
            .values({
              menuId,
              restaurantId: data.restaurantId,
              name: category.name,
            })
            .returning();
          categoryId = categoryRow.id;
          categoryIdByName.set(category.name.toLowerCase(), categoryId);
        }
        for (const item of category.items) {
          if (itemAlreadyExists(item.name, knownItems)) continue;
          await tx.insert(menuItems).values({
            menuId,
            categoryId,
            restaurantId: data.restaurantId,
            name: item.name,
            description: item.description,
            priceCents: item.priceCents,
            itemType: item.itemType || "food",
            imageUrl: menuItemImageUrls.get(item.name),
          });
          knownItems.push({ name: item.name });
          itemCount += 1;
        }
      }
      console.log(
        `[onboard-business-profile] Menu: added ${itemCount} new item(s) across ${categories.length} categor${categories.length === 1 ? "y" : "ies"} (${allMenuItems(data.menu).length - itemCount} already present, skipped).`,
      );

      if (menuItemImageUrls.size > 0) {
        for (const existing of existingMenuItems) {
          const newImageUrl = menuItemImageUrls.get(existing.name);
          if (newImageUrl && newImageUrl !== existing.imageUrl) {
            await tx
              .update(menuItems)
              .set({ imageUrl: newImageUrl })
              .where(eq(menuItems.id, existing.id));
          }
        }
      }
    }

    if (data.manualSchedule) {
      const newEntries = data.manualSchedule.filter(
        (entry) =>
          !existingSchedule.some(
            (row) =>
              row.locationName === entry.locationName &&
              new Date(row.date).toISOString().slice(0, 10) === entry.date,
          ),
      );
      for (const entry of newEntries) {
        await tx.insert(truckManualSchedules).values({
          truckId: data.restaurantId,
          date: new Date(`${entry.date}T00:00:00`),
          startTime: entry.startTime,
          endTime: entry.endTime,
          locationName: entry.locationName,
          address: entry.address,
          city: entry.city,
          state: entry.state,
          notes: entry.notes,
          sourceType: "admin_curated",
          isPublic: true,
        });
      }
      console.log(
        `[onboard-business-profile] Inserted ${newEntries.length} manual schedule entry(ies).`,
      );
    }
    });
  } catch (err) {
    for (const copiedPath of copiedAssetPaths) {
      try {
        unlinkSync(copiedPath);
      } catch {
        // Best effort cleanup; keep the original DB/write failure visible.
      }
    }
    throw err;
  }

  console.log("\n[onboard-business-profile] Done.");
}

main()
  .catch((err) => {
    console.error("[onboard-business-profile] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
