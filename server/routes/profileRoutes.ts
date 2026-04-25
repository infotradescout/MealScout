/**
 * Business Profile Routes
 *
 * API endpoints for viewing, auto-populating, and editing
 * Google Places-powered business profiles for restaurants and hosts.
 */

import type { Express } from "express";
import { db } from "../db";
import { restaurants, hosts, businessPhotos } from "../../shared/schema/legacy";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  populateRestaurantProfile,
  populateHostProfile,
  getGooglePhotoUrl,
} from "../services/googleProfileService";
import { isAuthenticated } from "../unifiedAuth";
import { FacebookPagesProvider } from "../../shared/business-profile-import/providers/facebook";
import { MealScoutRestaurantAdapter, MealScoutHostAdapter, toBusinessPhotoInserts } from "../../shared/business-profile-import/adapters/mealscout";

export function registerProfileRoutes(app: Express) {

const hasProfileWriteAccess = async (
  req: any,
  entityType: "restaurant" | "host",
  entityId: string,
) => {
  const userId = String(req?.user?.id || "").trim();
  const userType = String(req?.user?.userType || "").trim().toLowerCase();
  if (!userId) return false;
  if (["admin", "super_admin", "staff"].includes(userType)) return true;

  if (entityType === "restaurant") {
    const [row] = await db
      .select({ ownerId: restaurants.ownerId })
      .from(restaurants)
      .where(eq(restaurants.id, entityId))
      .limit(1);
    return String(row?.ownerId || "") === userId;
  }

  const [row] = await db
    .select({ userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, entityId))
    .limit(1);
  return String(row?.userId || "") === userId;
};

const requireStaffOrAdmin = (req: any, res: any): boolean => {
  const userType = String(req?.user?.userType || "").trim().toLowerCase();
  if (["admin", "super_admin", "staff"].includes(userType)) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
};

const hostNeedsGoogleProfile = (host: typeof hosts.$inferSelect) => {
  const hasCategories =
    Array.isArray(host.googleCategories) && host.googleCategories.length > 0;
  const hasPhotos = Array.isArray(host.googlePhotos) && host.googlePhotos.length > 0;
  return (
    !host.googlePlaceId ||
    (!host.description &&
      !hasCategories &&
      !hasPhotos &&
      !host.googleFormattedPhone &&
      !host.businessHours &&
      !host.businessWebsite)
  );
};

// ── Public: Get restaurant profile ──────────────────────────────────────────
app.get("/api/profiles/restaurant/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);

    if (!restaurant) return res.status(404).json({ error: "Not found" });

    // Build photo URLs from google photo references
    const photos = Array.isArray(restaurant.googlePhotos)
      ? (restaurant.googlePhotos as any[]).map((p) => ({
          url: getGooglePhotoUrl(p.name) || "",
          width: p.widthPx,
          height: p.heightPx,
          attribution: p.authorAttributions?.[0]?.displayName || "",
        }))
      : [];

    const priceLevelLabels = ["Free", "$", "$$", "$$$", "$$$$"];

    res.json({
      id: restaurant.id,
      name: restaurant.name,
      address: restaurant.address,
      city: restaurant.city,
      state: restaurant.state,
      businessType: restaurant.businessType,
      cuisineType: restaurant.cuisineType,
      description: restaurant.description,
      phone: restaurant.phone || restaurant.googleFormattedPhone,
      website: restaurant.websiteUrl,
      logoUrl: restaurant.logoUrl,
      coverImageUrl: restaurant.coverImageUrl,
      operatingHours: restaurant.operatingHours,
      amenities: restaurant.amenities,
      googlePriceLevel: restaurant.googlePriceLevel,
      priceLevelLabel:
        typeof restaurant.googlePriceLevel === "number"
          ? priceLevelLabels[restaurant.googlePriceLevel] || null
          : null,
      googleCategories: restaurant.googleCategories,
      menuUrl: restaurant.menuUrl,
      orderUrl: restaurant.orderUrl,
      photos,
      isVerified: restaurant.isVerified,
      hasGoldenPlate: restaurant.hasGoldenPlate,
      profileSource: restaurant.profileSource,
    });
  } catch (err) {
    console.error("[Profiles] Get restaurant error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Public: Get host profile ────────────────────────────────────────────────
app.get("/api/profiles/host/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing host id" });

    let [host] = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .limit(1);

    if (!host) return res.status(404).json({ error: "Not found" });

    if (hostNeedsGoogleProfile(host)) {
      const populated = await populateHostProfile(id);
      if (populated.success) {
        const [freshHost] = await db
          .select()
          .from(hosts)
          .where(eq(hosts.id, id))
          .limit(1);
        if (freshHost) host = freshHost;
      } else {
        console.warn(
          `[Profiles] Google host enrichment skipped for ${id}: ${populated.error}`,
        );
      }
    }

    const photos = Array.isArray(host.googlePhotos)
      ? (host.googlePhotos as any[]).map((p) => ({
          url: getGooglePhotoUrl(p.name) || "",
          width: p.widthPx,
          height: p.heightPx,
          attribution: p.authorAttributions?.[0]?.displayName || "",
        }))
      : [];

    const priceLevelLabels = ["Free", "$", "$$", "$$$", "$$$$"];

    res.json({
      id: host.id,
      businessName: host.businessName,
      address: host.address,
      city: host.city,
      state: host.state,
      locationType: host.locationType,
      description: host.description,
      phone: host.contactPhone || host.googleFormattedPhone,
      website: host.businessWebsite,
      spotImageUrl: host.spotImageUrl,
      businessHours: host.businessHours,
      amenities: host.amenities,
      googlePriceLevel: host.googlePriceLevel,
      priceLevelLabel:
        typeof host.googlePriceLevel === "number"
          ? priceLevelLabels[host.googlePriceLevel] || null
          : null,
      googleCategories: host.googleCategories,
      menuUrl: host.menuUrl,
      photos,
      isVerified: host.isVerified,
      profileSource: host.profileSource,
    });
  } catch (err) {
    console.error("[Profiles] Get host error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin/Owner: Trigger auto-populate for a restaurant ─────────────────────
app.post("/api/profiles/restaurant/:id/populate", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    if (!(await hasProfileWriteAccess(req, "restaurant", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const result = await populateRestaurantProfile(id);
    if (result.success) {
      res.json({ success: true, placeId: result.placeId });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error("[Profiles] Populate restaurant error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin/Owner: Trigger auto-populate for a host ───────────────────────────
app.post("/api/profiles/host/:id/populate", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing host id" });

    if (!(await hasProfileWriteAccess(req, "host", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const result = await populateHostProfile(id);
    if (result.success) {
      res.json({ success: true, placeId: result.placeId });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    console.error("[Profiles] Populate host error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin/Owner: Manually edit restaurant profile ───────────────────────────
app.patch("/api/profiles/restaurant/:id", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    if (!(await hasProfileWriteAccess(req, "restaurant", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const allowedFields = [
      "description",
      "websiteUrl",
      "menuUrl",
      "orderUrl",
      "reservationUrl",
      "operatingHours",
      "amenities",
      "cuisineType",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // Mark as manually edited
    const [existing] = await db
      .select({ profileSource: restaurants.profileSource })
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Not found" });

    updates.profileSource =
      existing.profileSource === "google" ? "mixed" : "manual";
    updates.updatedAt = new Date();

    await db.update(restaurants).set(updates).where(eq(restaurants.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[Profiles] Edit restaurant error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin/Owner: Manually edit host profile ─────────────────────────────────
app.patch("/api/profiles/host/:id", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing host id" });

    if (!(await hasProfileWriteAccess(req, "host", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const allowedFields = [
      "description",
      "businessWebsite",
      "menuUrl",
      "businessHours",
      "amenities",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const [existing] = await db
      .select({ profileSource: hosts.profileSource })
      .from(hosts)
      .where(eq(hosts.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Not found" });

    updates.profileSource =
      existing.profileSource === "google" ? "mixed" : "manual";
    updates.updatedAt = new Date();

    await db.update(hosts).set(updates).where(eq(hosts.id, id));
    res.json({ success: true });
  } catch (err) {
    console.error("[Profiles] Edit host error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin: Bulk auto-populate all restaurants without profiles ───────────────
app.post("/api/profiles/bulk-populate/restaurants", isAuthenticated, async (req: any, res) => {
  try {
    if (!requireStaffOrAdmin(req, res)) return;

    const unpopulated = await db
      .select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.profileSource, "none"))
      .limit(50); // Process in batches of 50

    const results = [];
    for (const r of unpopulated) {
      const result = await populateRestaurantProfile(r.id);
      results.push({ id: r.id, name: r.name, ...result });
      // Rate limit: 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    res.json({
      total: unpopulated.length,
      results,
    });
  } catch (err) {
    console.error("[Profiles] Bulk populate restaurants error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Facebook Import: Exchange code and list user's pages ───────────────────
app.post("/api/profiles/facebook/pages", isAuthenticated, async (req: any, res) => {
  try {
    const userAccessToken = String(req.body.accessToken || "").trim();
    if (!userAccessToken) {
      return res.status(400).json({ error: "Missing Facebook access token" });
    }

    const fbProvider = new FacebookPagesProvider({
      appId: process.env.FACEBOOK_APP_ID || "",
      appSecret: process.env.FACEBOOK_APP_SECRET || "",
    });

    const pages = await fbProvider.listUserPages(userAccessToken);
    res.json({ pages });
  } catch (err) {
    console.error("[Profiles] Facebook list pages error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Facebook Import: Populate restaurant from Facebook Page ────────────────
app.post("/api/profiles/restaurant/:id/populate-facebook", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const pageId = String(req.body.pageId || "").trim();
    const pageAccessToken = String(req.body.pageAccessToken || "").trim();
    const userId = req.user?.id;

    if (!id || !pageId || !pageAccessToken) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!(await hasProfileWriteAccess(req, "restaurant", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const fbProvider = new FacebookPagesProvider({
      appId: process.env.FACEBOOK_APP_ID || "",
      appSecret: process.env.FACEBOOK_APP_SECRET || "",
    });

    const profile = await fbProvider.fetchProfile(pageId, pageAccessToken);
    if (!profile) {
      return res.status(400).json({ success: false, error: "Failed to fetch Facebook page data" });
    }

    // Get existing restaurant for fill_empty merge
    const [existing] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Restaurant not found" });

    const adapter = new MealScoutRestaurantAdapter("fill_empty");
    const updates = adapter.toEntityUpdate(profile, existing as any);

    await db.update(restaurants).set(updates).where(eq(restaurants.id, id));

    // Import photos to business_photos gallery
    if (profile.photos.length > 0 && userId) {
      const photoInserts = toBusinessPhotoInserts(profile.photos, {
        restaurantId: id,
        uploadedByUserId: userId,
        maxPhotos: 20,
      });

      for (const photo of photoInserts) {
        await db.insert(businessPhotos).values(photo).onConflictDoNothing();
      }
    }

    res.json({ success: true, fieldsUpdated: Object.keys(updates).length, photosImported: profile.photos.length });
  } catch (err) {
    console.error("[Profiles] Facebook populate restaurant error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Facebook Import: Populate host from Facebook Page ──────────────────────
app.post("/api/profiles/host/:id/populate-facebook", isAuthenticated, async (req: any, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const pageId = String(req.body.pageId || "").trim();
    const pageAccessToken = String(req.body.pageAccessToken || "").trim();
    const userId = req.user?.id;

    if (!id || !pageId || !pageAccessToken) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!(await hasProfileWriteAccess(req, "host", id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const fbProvider = new FacebookPagesProvider({
      appId: process.env.FACEBOOK_APP_ID || "",
      appSecret: process.env.FACEBOOK_APP_SECRET || "",
    });

    const profile = await fbProvider.fetchProfile(pageId, pageAccessToken);
    if (!profile) {
      return res.status(400).json({ success: false, error: "Failed to fetch Facebook page data" });
    }

    const [existing] = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Host not found" });

    const adapter = new MealScoutHostAdapter("fill_empty");
    const updates = adapter.toEntityUpdate(profile, existing as any);

    await db.update(hosts).set(updates).where(eq(hosts.id, id));

    if (profile.photos.length > 0 && userId) {
      const photoInserts = toBusinessPhotoInserts(profile.photos, {
        hostId: id,
        uploadedByUserId: userId,
        maxPhotos: 20,
      });

      for (const photo of photoInserts) {
        await db.insert(businessPhotos).values(photo).onConflictDoNothing();
      }
    }

    res.json({ success: true, fieldsUpdated: Object.keys(updates).length, photosImported: profile.photos.length });
  } catch (err) {
    console.error("[Profiles] Facebook populate host error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Business Photos Gallery: Get photos for a restaurant ───────────────────
app.get("/api/profiles/restaurant/:id/photos", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    const photos = await db
      .select()
      .from(businessPhotos)
      .where(eq(businessPhotos.restaurantId, id))
      .orderBy(businessPhotos.sortOrder);

    // Also include Google photos from the restaurant record
    const [restaurant] = await db
      .select({ googlePhotos: restaurants.googlePhotos })
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);

    const googlePhotoUrls = Array.isArray(restaurant?.googlePhotos)
      ? (restaurant.googlePhotos as any[]).map((p) => ({
          url: getGooglePhotoUrl(p.name) || "",
          width: p.widthPx,
          height: p.heightPx,
          source: "google",
          attribution: p.authorAttributions?.[0]?.displayName || "",
        }))
      : [];

    res.json({ gallery: photos, googlePhotos: googlePhotoUrls });
  } catch (err) {
    console.error("[Profiles] Get restaurant photos error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Business Photos Gallery: Upload a photo ────────────────────────────────
app.post("/api/profiles/:entityType/:id/photos", async (req: any, res) => {
  try {
    const entityType = String(req.params.entityType || "").trim();
    const id = String(req.params.id || "").trim();
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!id || !['restaurant', 'host'].includes(entityType)) {
      return res.status(400).json({ error: "Invalid entity type or id" });
    }

    const { url, caption, width, height, fileSize, mimeType } = req.body;
    if (!url) return res.status(400).json({ error: "Missing photo URL" });

    // Check photo count limit (50 per entity)
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(businessPhotos)
      .where(
        entityType === 'restaurant'
          ? eq(businessPhotos.restaurantId, id)
          : eq(businessPhotos.hostId, id)
      );

    const currentCount = Number(countResult[0]?.count || 0);
    if (currentCount >= 50) {
      return res.status(400).json({ error: "Maximum of 50 photos per business" });
    }

    const [photo] = await db.insert(businessPhotos).values({
      restaurantId: entityType === 'restaurant' ? id : null,
      hostId: entityType === 'host' ? id : null,
      uploadedByUserId: userId,
      url,
      caption: caption || null,
      width: width || null,
      height: height || null,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      sortOrder: currentCount,
      source: 'manual',
    }).returning();

    res.json({ success: true, photo });
  } catch (err) {
    console.error("[Profiles] Upload photo error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Business Photos Gallery: Delete a photo ────────────────────────────────
app.delete("/api/profiles/photos/:photoId", async (req: any, res) => {
  try {
    const photoId = String(req.params.photoId || "").trim();
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!photoId) return res.status(400).json({ error: "Missing photo id" });

    await db.delete(businessPhotos).where(eq(businessPhotos.id, photoId));
    res.json({ success: true });
  } catch (err) {
    console.error("[Profiles] Delete photo error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Business Photos Gallery: Reorder photos ────────────────────────────────
app.patch("/api/profiles/photos/reorder", async (req: any, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { photoIds } = req.body; // Array of photo IDs in desired order
    if (!Array.isArray(photoIds)) {
      return res.status(400).json({ error: "photoIds must be an array" });
    }

    for (let i = 0; i < photoIds.length; i++) {
      await db
        .update(businessPhotos)
        .set({ sortOrder: i })
        .where(eq(businessPhotos.id, photoIds[i]));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[Profiles] Reorder photos error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// ── Admin: Bulk auto-populate all hosts without profiles ────────────────────
app.post("/api/profiles/bulk-populate/hosts", async (req, res) => {
  try {
    // TODO: Add admin auth check
    const unpopulated = await db
      .select({ id: hosts.id, businessName: hosts.businessName })
      .from(hosts)
      .where(eq(hosts.profileSource, "none"))
      .limit(50);

    const results = [];
    for (const h of unpopulated) {
      const result = await populateHostProfile(h.id);
      results.push({ id: h.id, name: h.businessName, ...result });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    res.json({
      total: unpopulated.length,
      results,
    });
  } catch (err) {
    console.error("[Profiles] Bulk populate hosts error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

}
