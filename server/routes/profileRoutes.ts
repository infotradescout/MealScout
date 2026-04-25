/**
 * Business Profile Routes
 *
 * API endpoints for viewing, auto-populating, and editing
 * Google Places-powered business profiles for restaurants and hosts.
 */

import type { Express } from "express";
import { db } from "../db";
import { restaurants, hosts } from "../../shared/schema/legacy";
import { eq } from "drizzle-orm";
import {
  populateRestaurantProfile,
  populateHostProfile,
  getGooglePhotoUrl,
} from "../services/googleProfileService";

export function registerProfileRoutes(app: Express) {

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
      googleRating: restaurant.googleRating,
      googleReviewCount: restaurant.googleReviewCount,
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

    const [host] = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, id))
      .limit(1);

    if (!host) return res.status(404).json({ error: "Not found" });

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
      googleRating: host.googleRating,
      googleReviewCount: host.googleReviewCount,
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
app.post("/api/profiles/restaurant/:id/populate", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    // TODO: Add auth check - only owner or admin can trigger
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
app.post("/api/profiles/host/:id/populate", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing host id" });

    // TODO: Add auth check - only owner or admin can trigger
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
app.patch("/api/profiles/restaurant/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing restaurant id" });

    // TODO: Add auth check - only owner or admin can edit
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
app.patch("/api/profiles/host/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing host id" });

    // TODO: Add auth check - only owner or admin can edit
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
app.post("/api/profiles/bulk-populate/restaurants", async (req, res) => {
  try {
    // TODO: Add admin auth check
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
