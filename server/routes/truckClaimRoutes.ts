import type { Express } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { sendAccountSetupInvite } from "../utils/accountSetup";
import { sendEmailVerificationIfNeeded } from "../utils/emailVerification";
import {
  insertRestaurantSchema,
  restaurants,
  truckClaimRequests,
  truckImportListings,
} from "@shared/schema";

const decorateTruckClaimRows = (
  rows: any[],
  opts?: { currentUserId?: string | null },
) => {
  const now = Date.now();
  const COOLDOWN_MS = 6 * 60 * 60 * 1000;

  return rows.map((row) => {
    const status = String(row.status || "unclaimed");
    const hasEmail = Boolean(String(row.email || "").trim());
    const hasInviteUser = Boolean(row.invitedUserId);
    const isInviteOwner =
      row.invitedUserId &&
      opts?.currentUserId &&
      String(row.invitedUserId) === String(opts.currentUserId);

    const lastInviteSentAtMs = row.lastInviteSentAt
      ? new Date(row.lastInviteSentAt).getTime()
      : 0;
    const cooldownRemainingMs = lastInviteSentAtMs
      ? Math.max(0, lastInviteSentAtMs + COOLDOWN_MS - now)
      : 0;

    const canClaim =
      status === "unclaimed"
        ? hasInviteUser
          ? Boolean(isInviteOwner)
          : true
        : status === "claim_requested"
          ? Boolean(isInviteOwner)
          : false;
    const hasPriorInvite = Boolean(lastInviteSentAtMs);
    const canRequest =
      status === "unclaimed" && hasEmail && !isInviteOwner && !hasPriorInvite;

    return {
      id: row.id,
      status,
      name: row.name,
      address: row.address,
      city: row.city,
      state: row.state,
      phone: row.phone,
      externalId: row.externalId,
      confidenceScore: row.confidenceScore,
      invited: Boolean(hasInviteUser || hasEmail),
      hasEmail,
      canClaim,
      canRequest,
      noRepeatPolicy: hasPriorInvite,
      requestCooldownMinutes: cooldownRemainingMs
        ? Math.ceil(cooldownRemainingMs / 60000)
        : 0,
    };
  });
};

export function registerTruckClaimRoutes(app: Express) {
  app.get("/api/truck-claims/search", isAuthenticated, async (req: any, res) => {
    try {
      const query = String(req.query?.q || "").trim();
      if (!query) {
        return res.json([]);
      }

      const externalMatch = await db
        .select({
          id: truckImportListings.id,
          name: truckImportListings.name,
          address: truckImportListings.address,
          city: truckImportListings.city,
          state: truckImportListings.state,
          phone: truckImportListings.phone,
          externalId: truckImportListings.externalId,
          status: truckImportListings.status,
          confidenceScore: truckImportListings.confidenceScore,
          email: truckImportListings.email,
          invitedUserId: truckImportListings.invitedUserId,
          lastInviteSentAt: truckImportListings.lastInviteSentAt,
        })
        .from(truckImportListings)
        .where(
          and(
            or(
              eq(truckImportListings.externalId, query),
              eq(truckImportListings.id, query),
            ),
            inArray(truckImportListings.status, [
              "unclaimed",
              "claim_requested",
            ] as any),
          ),
        )
        .limit(10);

      if (externalMatch.length > 0) {
        return res.json(
          decorateTruckClaimRows(externalMatch, {
            currentUserId: req.user?.id,
          }),
        );
      }

      const searchValue = `%${query.toLowerCase()}%`;
      const matches = await db
        .select({
          id: truckImportListings.id,
          name: truckImportListings.name,
          address: truckImportListings.address,
          city: truckImportListings.city,
          state: truckImportListings.state,
          phone: truckImportListings.phone,
          externalId: truckImportListings.externalId,
          status: truckImportListings.status,
          confidenceScore: truckImportListings.confidenceScore,
          email: truckImportListings.email,
          invitedUserId: truckImportListings.invitedUserId,
          lastInviteSentAt: truckImportListings.lastInviteSentAt,
        })
        .from(truckImportListings)
        .where(
          and(
            inArray(truckImportListings.status, [
              "unclaimed",
              "claim_requested",
            ] as any),
            or(
              eq(truckImportListings.id, query),
              sql`lower(${truckImportListings.name}) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.externalId}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.phone}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(truckImportListings.confidenceScore))
        .limit(10);

      res.json(
        decorateTruckClaimRows(matches, { currentUserId: req.user?.id }),
      );
    } catch (error) {
      console.error("Error searching truck listings:", error);
      res.status(500).json({ message: "Failed to search truck listings" });
    }
  });

  app.get("/api/truck-claims/public-search", async (req: any, res) => {
    try {
      const query = String(req.query?.q || "").trim();
      if (!query) return res.json([]);

      const searchValue = `%${query.toLowerCase()}%`;
      const rows = await db
        .select({
          id: truckImportListings.id,
          name: truckImportListings.name,
          address: truckImportListings.address,
          city: truckImportListings.city,
          state: truckImportListings.state,
          phone: truckImportListings.phone,
          externalId: truckImportListings.externalId,
          status: truckImportListings.status,
          confidenceScore: truckImportListings.confidenceScore,
          lastInviteSentAt: truckImportListings.lastInviteSentAt,
          invitedUserId: truckImportListings.invitedUserId,
          email: truckImportListings.email,
        })
        .from(truckImportListings)
        .where(
          and(
            inArray(truckImportListings.status, [
              "unclaimed",
              "claim_requested",
            ] as any),
            or(
              eq(truckImportListings.id, query),
              sql`lower(${truckImportListings.name}) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.address}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.city}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.state}, '')) like ${searchValue}`,
              sql`lower(coalesce(${truckImportListings.externalId}, '')) like ${searchValue}`,
            ),
          ),
        )
        .orderBy(desc(truckImportListings.confidenceScore))
        .limit(15);

      res.json(decorateTruckClaimRows(rows, { currentUserId: null }));
    } catch (error) {
      console.error("Error public-searching truck listings:", error);
      res.status(500).json({ message: "Failed to search truck listings" });
    }
  });

  app.post("/api/truck-claims/request", async (req: any, res) => {
    try {
      const payloadSchema = z.object({ listingId: z.string().min(1) });
      const { listingId } = payloadSchema.parse(req.body);

      const [listing] = await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingId))
        .limit(1);

      if (
        !listing ||
        !["unclaimed", "claim_requested"].includes(String(listing.status))
      ) {
        return res
          .status(404)
          .json({ message: "Truck listing is not available." });
      }

      const inviteEmail = String(listing.email || "")
        .trim()
        .toLowerCase();
      const hadEmail = Boolean(inviteEmail);
      if (!listing.invitedUserId && !inviteEmail) {
        return res.status(400).json({
          message:
            "This listing doesn't have an email on file. Ask an admin to add one, or claim it manually.",
          hadEmail: false,
        });
      }

      const COOLDOWN_MS = 6 * 60 * 60 * 1000;
      if (listing.lastInviteSentAt) {
        const lastMs = new Date(listing.lastInviteSentAt).getTime();
        const minutesSinceInvite = Math.max(
          1,
          Math.floor((Date.now() - lastMs) / 60000),
        );
        return res.status(409).json({
          message:
            "A setup invite was already sent for this listing. No repeat reminders are sent under the one-touch onboarding policy.",
          noRepeatPolicy: true,
          sentMinutesAgo: minutesSinceInvite,
          cooldownMinutes: COOLDOWN_MS > 0 ? Math.ceil(COOLDOWN_MS / 60000) : 0,
          hadEmail,
        });
      }

      let inviteUser: any | null = null;
      if (listing.invitedUserId) {
        inviteUser = await storage.getUser(listing.invitedUserId);
      }
      if (!inviteUser && inviteEmail) {
        inviteUser = await storage.getUserByEmail(inviteEmail);
        if (!inviteUser) {
          inviteUser = await storage.createUserInvite({
            email: inviteEmail,
            firstName: null,
            lastName: null,
            phone: null,
            userType: "food_truck",
          });
        }
        await db
          .update(truckImportListings)
          .set({ invitedUserId: inviteUser.id, updatedAt: new Date() })
          .where(eq(truckImportListings.id, listing.id));
      }

      if (!inviteUser) {
        return res.status(500).json({ message: "Unable to send reminder." });
      }

      const emailSent = await sendAccountSetupInvite({
        user: inviteUser,
        createdBy: null,
        req,
      });

      await db
        .update(truckImportListings)
        .set({
          lastInviteSentAt: new Date(),
          status: "claim_requested",
          updatedAt: new Date(),
        })
        .where(eq(truckImportListings.id, listing.id));

      res.json({
        success: true,
        emailSent,
        hadEmail,
        cooldownMinutes: 0,
        status: "claim_requested",
      });
    } catch (error: any) {
      console.error("Error requesting truck setup reminder:", error);
      res.status(400).json({
        message: error.message || "Failed to request reminder",
      });
    }
  });

  app.post("/api/truck-claims", isAuthenticated, async (req: any, res) => {
    try {
      const payloadSchema = z.object({
        listingId: z.string().min(1),
        restaurantData: insertRestaurantSchema
          .omit({ ownerId: true })
          .partial(),
      });
      const { listingId, restaurantData } = payloadSchema.parse(req.body);

      const [listing] = await db
        .select()
        .from(truckImportListings)
        .where(eq(truckImportListings.id, listingId))
        .limit(1);

      const listingStatus = String(listing?.status || "");
      const isInviteOwner =
        listing?.invitedUserId &&
        String(listing.invitedUserId) === String(req.user.id);
      const canClaimListing =
        listingStatus === "unclaimed" ||
        (listingStatus === "claim_requested" && Boolean(isInviteOwner));

      if (!listing || !canClaimListing) {
        return res
          .status(404)
          .json({ message: "Truck listing is not available to claim" });
      }

      if (
        listing.invitedUserId &&
        String(listing.invitedUserId) !== String(req.user.id)
      ) {
        return res.status(409).json({
          message:
            "This truck already has an invited owner. Use “Request this truck” to notify them to finish setup.",
        });
      }

      const mergedRestaurant = {
        name: restaurantData.name || listing.name,
        address: restaurantData.address || listing.address,
        city: restaurantData.city || listing.city,
        state: restaurantData.state || listing.state,
        phone: restaurantData.phone || listing.phone,
        cuisineType: restaurantData.cuisineType || listing.cuisineType,
        websiteUrl: restaurantData.websiteUrl || listing.websiteUrl,
        instagramUrl: restaurantData.instagramUrl || listing.instagramUrl,
        facebookPageUrl:
          restaurantData.facebookPageUrl || listing.facebookPageUrl,
        latitude: restaurantData.latitude || listing.latitude,
        longitude: restaurantData.longitude || listing.longitude,
        description: restaurantData.description || null,
        amenities: restaurantData.amenities || null,
      };

      if (!mergedRestaurant.name || !mergedRestaurant.address) {
        return res.status(400).json({
          message: "Name and address are required to claim this listing",
        });
      }

      const importSystemEmail =
        process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us";
      const importSystemUser = await storage.getUserByEmail(importSystemEmail);
      const seededRestaurantCandidate = importSystemUser
        ? (
            await db
              .select()
              .from(restaurants)
              .where(
                and(
                  eq(restaurants.claimedFromImportId, listing.id),
                  eq(restaurants.ownerId, importSystemUser.id),
                ),
              )
              .limit(1)
          )[0]
        : null;

      const restaurant = seededRestaurantCandidate
        ? (
            await db
              .update(restaurants)
              .set({
                ownerId: req.user.id,
                name: mergedRestaurant.name,
                address: mergedRestaurant.address,
                phone: mergedRestaurant.phone || null,
                businessType: "food_truck",
                cuisineType: mergedRestaurant.cuisineType || null,
                city: mergedRestaurant.city || null,
                state: mergedRestaurant.state || null,
                websiteUrl: mergedRestaurant.websiteUrl || null,
                instagramUrl: mergedRestaurant.instagramUrl || null,
                facebookPageUrl: mergedRestaurant.facebookPageUrl || null,
                latitude: mergedRestaurant.latitude || null,
                longitude: mergedRestaurant.longitude || null,
                description: mergedRestaurant.description || null,
                amenities: mergedRestaurant.amenities || null,
                isFoodTruck: true,
                isActive: false,
                isVerified: false,
                updatedAt: new Date(),
              })
              .where(eq(restaurants.id, seededRestaurantCandidate.id))
              .returning()
          )[0]
        : await storage.createRestaurant({
            ownerId: req.user.id,
            name: mergedRestaurant.name,
            address: mergedRestaurant.address,
            phone: mergedRestaurant.phone || null,
            businessType: "food_truck",
            cuisineType: mergedRestaurant.cuisineType || null,
            city: mergedRestaurant.city || null,
            state: mergedRestaurant.state || null,
            websiteUrl: mergedRestaurant.websiteUrl || null,
            instagramUrl: mergedRestaurant.instagramUrl || null,
            facebookPageUrl: mergedRestaurant.facebookPageUrl || null,
            latitude: mergedRestaurant.latitude || null,
            longitude: mergedRestaurant.longitude || null,
            description: mergedRestaurant.description || null,
            amenities: mergedRestaurant.amenities || null,
            isFoodTruck: true,
            isActive: false,
            isVerified: false,
            claimedFromImportId: listing.id,
          });

      if (req.user?.userType === "customer") {
        await storage.updateUserType(req.user.id, "food_truck");
      }

      const [claimRequest] = await db
        .insert(truckClaimRequests)
        .values({
          listingId: listing.id,
          restaurantId: restaurant.id,
          userId: req.user.id,
        })
        .returning();

      await db
        .update(truckImportListings)
        .set({
          status: "claim_requested",
          updatedAt: new Date(),
        })
        .where(eq(truckImportListings.id, listing.id));

      const verification = await sendEmailVerificationIfNeeded(
        req.user,
        req,
      ).catch((error) => {
        console.error(
          "[email] Failed to send verification after truck claim:",
          error,
        );
        return {
          sent: false,
          skippedReason: "provider_not_configured" as const,
        };
      });

      await emailService.sendBasicEmail(
        "notifications@mealscout.us",
        "Food Truck Claim Submitted",
        `
          <p>A food truck claim was submitted.</p>
          <p><strong>Truck:</strong> ${restaurant.name}</p>
          <p><strong>Listing ID:</strong> ${listing.id}</p>
          <p><strong>User ID:</strong> ${req.user.id}</p>
          <p><strong>Email:</strong> ${req.user.email || "Unknown"}</p>
        `,
      );

      res.json({
        restaurant,
        claimRequestId: claimRequest?.id,
        usedSeededRestaurant: Boolean(seededRestaurantCandidate),
        emailVerificationSent: verification.sent,
      });
    } catch (error: any) {
      console.error("Error creating truck claim:", error);
      res.status(400).json({
        message: error.message || "Failed to claim truck listing",
      });
    }
  });
}
