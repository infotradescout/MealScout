import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import {
  businessInsuranceVerifications,
  hosts,
  insertBusinessInsuranceVerificationSchema,
  restaurants,
  users,
} from "@shared/schema";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { validateDocuments } from "../documentValidation";
import { recordMealScoutCreditAction } from "../mealScoutCreditsService";

const entityInputSchema = z.object({
  entityType: z.enum([
    "restaurant",
    "food_truck",
    "caterer",
    "private_chef",
    "host",
  ]),
  entityId: z.string().trim().min(1),
});

const reviewSchema = z.object({
  reviewerNotes: z.string().trim().max(2000).optional().nullable(),
});

async function requireOwnedInsuranceEntity(req: any, res: any) {
  const parsed = entityInputSchema.safeParse({
    entityType: req.body?.entityType || req.query?.entityType,
    entityId: req.body?.entityId || req.query?.entityId,
  });
  if (!parsed.success) {
    res.status(400).json({ message: "Business type and id are required" });
    return null;
  }

  const userId = String(req.user?.id || "");
  const entityType = parsed.data.entityType;
  const entityId = parsed.data.entityId;

  if (entityType === "host") {
    const [host] = await db
      .select({
        id: hosts.id,
        ownerId: hosts.userId,
        city: hosts.city,
        state: hosts.state,
      })
      .from(hosts)
      .where(eq(hosts.id, entityId))
      .limit(1);
    if (!host || String(host.ownerId) !== userId) {
      res.status(403).json({ message: "Unauthorized" });
      return null;
    }
    return { entityType, entityId, ownerId: userId, city: host.city, state: host.state };
  }

  const [restaurant] = await db
    .select({
      id: restaurants.id,
      ownerId: restaurants.ownerId,
      city: restaurants.city,
      state: restaurants.state,
      isFoodTruck: restaurants.isFoodTruck,
      businessType: restaurants.businessType,
    })
    .from(restaurants)
    .where(eq(restaurants.id, entityId))
    .limit(1);

  if (!restaurant || String(restaurant.ownerId) !== userId) {
    res.status(403).json({ message: "Unauthorized" });
    return null;
  }

  const isFoodTruck =
    Boolean(restaurant.isFoodTruck) ||
    String(restaurant.businessType || "").toLowerCase() === "food_truck";
  const businessType = String(restaurant.businessType || "").toLowerCase();
  const actualEntityType = isFoodTruck
    ? "food_truck"
    : businessType === "caterer"
      ? "caterer"
      : businessType === "private_chef"
        ? "private_chef"
        : "restaurant";
  if (entityType === "food_truck" && !isFoodTruck) {
    res.status(400).json({ message: "Business is not marked as a food truck" });
    return null;
  }
  if (entityType === "caterer" && actualEntityType !== "caterer") {
    res.status(400).json({ message: "Business is not marked as a caterer" });
    return null;
  }
  if (entityType === "private_chef" && actualEntityType !== "private_chef") {
    res.status(400).json({ message: "Business is not marked as a private chef" });
    return null;
  }

  return {
    entityType: actualEntityType,
    entityId,
    ownerId: userId,
    city: restaurant.city,
    state: restaurant.state,
  };
}

export function registerInsuranceVerificationRoutes(app: Express) {
  app.get("/api/business/insurance/status", isAuthenticated, async (req: any, res) => {
    try {
      const entity = await requireOwnedInsuranceEntity(req, res);
      if (!entity) return;

      const [latest] = await db
        .select()
        .from(businessInsuranceVerifications)
        .where(
          and(
            eq(businessInsuranceVerifications.entityType, entity.entityType),
            eq(businessInsuranceVerifications.entityId, entity.entityId),
          ),
        )
        .orderBy(desc(businessInsuranceVerifications.createdAt))
        .limit(1);

      const now = new Date();
      const expiresAt = latest?.expiresAt ? new Date(latest.expiresAt) : null;
      const expired = Boolean(expiresAt && expiresAt.getTime() < now.getTime());
      const valid =
        latest?.status === "approved" &&
        Boolean(expiresAt) &&
        !expired &&
        latest.attestedCommercialCoverage &&
        latest.attestedJurisdictionCompliance;

      res.json({
        required: true,
        valid,
        status: expired && latest?.status === "approved" ? "expired" : latest?.status || "not_submitted",
        latest: latest || null,
      });
    } catch (error: any) {
      console.error("Error loading insurance status:", error);
      res.status(500).json({ message: "Failed to load insurance status" });
    }
  });

  app.post("/api/business/insurance/submit", isAuthenticated, async (req: any, res) => {
    try {
      const entity = await requireOwnedInsuranceEntity(req, res);
      if (!entity) return;

      const parsed = insertBusinessInsuranceVerificationSchema.parse({
        ...req.body,
        entityType: entity.entityType,
        entityId: entity.entityId,
        ownerId: entity.ownerId,
        jurisdictionCity: req.body?.jurisdictionCity || entity.city || null,
        jurisdictionState: req.body?.jurisdictionState || entity.state || null,
      });

      const documentValidation = validateDocuments(parsed.documents);
      if (!documentValidation.valid) {
        return res.status(400).json({
          message: "Document validation failed",
          errors: documentValidation.errors,
        });
      }

      if (parsed.expiresAt.getTime() <= Date.now()) {
        return res.status(400).json({
          message: "Insurance expiration date must be in the future",
        });
      }

      const [record] = await db
        .insert(businessInsuranceVerifications)
        .values({
          ...parsed,
          expiresAt: parsed.expiresAt,
          effectiveDate: parsed.effectiveDate || null,
          updatedAt: new Date(),
        })
        .returning();

      recordMealScoutCreditAction({
        userId: entity.ownerId,
        action: "insurance_submitted",
        sourceId: record.id,
        entityType: entity.entityType,
        entityId: entity.entityId,
        metadata: {
          jurisdictionCity: record.jurisdictionCity,
          jurisdictionState: record.jurisdictionState,
          coverageType: record.coverageType,
          expiresAt: record.expiresAt,
        },
      }).catch((creditError) => {
        console.error("[credits] failed to record insurance_submitted:", creditError);
      });

      res.status(201).json(record);
    } catch (error: any) {
      console.error("Error submitting insurance verification:", error);
      res.status(400).json({
        message: error?.message || "Failed to submit insurance verification",
      });
    }
  });

  app.get(
    "/api/admin/insurance-verifications",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const status = String(req.query?.status || "").trim();
        const statuses = ["pending", "approved", "rejected", "expired"];
        const rows = await db
          .select({
            id: businessInsuranceVerifications.id,
            entityType: businessInsuranceVerifications.entityType,
            entityId: businessInsuranceVerifications.entityId,
            ownerId: businessInsuranceVerifications.ownerId,
            ownerEmail: users.email,
            status: businessInsuranceVerifications.status,
            jurisdictionCity: businessInsuranceVerifications.jurisdictionCity,
            jurisdictionState: businessInsuranceVerifications.jurisdictionState,
            carrierName: businessInsuranceVerifications.carrierName,
            policyNumber: businessInsuranceVerifications.policyNumber,
            coverageType: businessInsuranceVerifications.coverageType,
            coverageAmountCents: businessInsuranceVerifications.coverageAmountCents,
            expiresAt: businessInsuranceVerifications.expiresAt,
            documents: businessInsuranceVerifications.documents,
            notes: businessInsuranceVerifications.notes,
            reviewerNotes: businessInsuranceVerifications.reviewerNotes,
            reviewedAt: businessInsuranceVerifications.reviewedAt,
            createdAt: businessInsuranceVerifications.createdAt,
            restaurantName: restaurants.name,
            restaurantBusinessType: restaurants.businessType,
            restaurantIsFoodTruck: restaurants.isFoodTruck,
            hostName: hosts.businessName,
            hostLocationType: hosts.locationType,
          })
          .from(businessInsuranceVerifications)
          .leftJoin(users, eq(businessInsuranceVerifications.ownerId, users.id))
          .leftJoin(restaurants, eq(businessInsuranceVerifications.entityId, restaurants.id))
          .leftJoin(hosts, eq(businessInsuranceVerifications.entityId, hosts.id))
          .where(
            status && statuses.includes(status)
              ? eq(businessInsuranceVerifications.status, status)
              : inArray(businessInsuranceVerifications.status, statuses),
          )
          .orderBy(desc(businessInsuranceVerifications.createdAt))
          .limit(200);

        res.json(
          rows.map((row: any) => {
            const businessType = String(row.restaurantBusinessType || "").toLowerCase();
            const isTruck =
              row.entityType === "food_truck" ||
              row.restaurantIsFoodTruck ||
              businessType === "food_truck";
            const entityLabel =
              row.entityType === "host"
                ? row.hostLocationType
                  ? `Host - ${row.hostLocationType}`
                  : "Host"
                : isTruck
                  ? "Food Truck"
                  : businessType === "private_chef"
                    ? "Private Chef"
                    : businessType === "caterer"
                      ? "Caterer"
                      : businessType === "bar"
                        ? "Restaurant or Bar"
                        : "Restaurant";
            return {
              ...row,
              entityName: row.hostName || row.restaurantName || null,
              entityLabel,
            };
          }),
        );
      } catch (error) {
        console.error("Error loading insurance verifications:", error);
        res.status(500).json({ message: "Failed to load insurance verifications" });
      }
    },
  );

  app.post(
    "/api/admin/insurance-verifications/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = reviewSchema.parse(req.body || {});
        const [record] = await db
          .update(businessInsuranceVerifications)
          .set({
            status: "approved",
            reviewerNotes: parsed.reviewerNotes || null,
            reviewedBy: req.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(businessInsuranceVerifications.id, req.params.id))
          .returning();
        if (!record) return res.status(404).json({ message: "Insurance verification not found" });
        res.json(record);
      } catch (error: any) {
        res.status(400).json({ message: error?.message || "Failed to approve insurance verification" });
      }
    },
  );

  app.post(
    "/api/admin/insurance-verifications/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = reviewSchema
          .extend({ reviewerNotes: z.string().trim().min(3).max(2000) })
          .parse(req.body || {});
        const [record] = await db
          .update(businessInsuranceVerifications)
          .set({
            status: "rejected",
            reviewerNotes: parsed.reviewerNotes,
            reviewedBy: req.user.id,
            reviewedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(businessInsuranceVerifications.id, req.params.id))
          .returning();
        if (!record) return res.status(404).json({ message: "Insurance verification not found" });
        res.json(record);
      } catch (error: any) {
        res.status(400).json({ message: error?.message || "Failed to reject insurance verification" });
      }
    },
  );

  app.post("/api/cron/insurance-expiry-scan", async (_req, res) => {
    try {
      await db
        .update(businessInsuranceVerifications)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(businessInsuranceVerifications.status, "approved"),
            sql`${businessInsuranceVerifications.expiresAt} < now()`,
          ),
        );
      res.json({ ok: true });
    } catch (error) {
      console.error("Insurance expiry scan failed:", error);
      res.status(500).json({ ok: false });
    }
  });
}
