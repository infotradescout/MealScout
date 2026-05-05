import type { Express } from "express";
import multer from "multer";
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
import { isCloudinaryConfigured, uploadRawToCloudinary } from "../imageUpload";

const insuranceDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "image/heic-sequence",
      "image/heif-sequence",
      "application/pdf",
    ]);
    if (allowed.has(String(file.mimetype).toLowerCase())) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPG, PNG, or PDF files are allowed"));
  },
});

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

const adminInsuranceSubmitSchema = z.object({
  entityType: z.enum([
    "restaurant",
    "food_truck",
    "caterer",
    "private_chef",
    "host",
  ]),
  entityId: z.string().trim().min(1),
  ownerId: z.string().trim().min(1).optional().nullable(),
  jurisdictionCity: z.string().trim().max(120).optional().nullable(),
  jurisdictionState: z.string().trim().max(80).optional().nullable(),
  jurisdictionCountry: z.string().trim().max(80).optional().default("US"),
  carrierName: z.string().trim().max(180).optional().nullable(),
  policyNumber: z.string().trim().max(120).optional().nullable(),
  coverageType: z
    .string()
    .trim()
    .max(120)
    .optional()
    .default("commercial_general_liability"),
  coverageAmountCents: z.coerce.number().int().nonnegative().optional().nullable(),
  effectiveDate: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date(),
  documents: z.array(z.string()).min(1).max(5),
  attestedCommercialCoverage: z.literal(true),
  attestedJurisdictionCompliance: z.literal(true),
  notes: z.string().trim().max(2000).optional().nullable(),
  metadata: z.record(z.any()).optional().default({}),
});

function getRestaurantInsuranceEntityType(restaurant: {
  isFoodTruck?: boolean | null;
  businessType?: string | null;
}) {
  const businessType = String(restaurant.businessType || "").toLowerCase();
  const isFoodTruck =
    Boolean(restaurant.isFoodTruck) || businessType === "food_truck";
  if (isFoodTruck) return "food_truck" as const;
  if (businessType === "caterer") return "caterer" as const;
  if (businessType === "private_chef") return "private_chef" as const;
  return "restaurant" as const;
}

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

async function resolveAdminInsuranceEntity(
  input: z.infer<typeof adminInsuranceSubmitSchema>,
  res: any,
) {
  if (input.entityType === "host") {
    const [host] = await db
      .select({
        id: hosts.id,
        ownerId: hosts.userId,
        city: hosts.city,
        state: hosts.state,
      })
      .from(hosts)
      .where(eq(hosts.id, input.entityId))
      .limit(1);

    if (!host) {
      res.status(404).json({ message: "Host location not found" });
      return null;
    }
    if (input.ownerId && String(host.ownerId) !== String(input.ownerId)) {
      res.status(400).json({
        message: "Selected host does not belong to the selected owner",
      });
      return null;
    }
    return {
      entityType: "host" as const,
      entityId: String(host.id),
      ownerId: String(host.ownerId),
      city: host.city,
      state: host.state,
    };
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
    .where(eq(restaurants.id, input.entityId))
    .limit(1);

  if (!restaurant) {
    res.status(404).json({ message: "Business profile not found" });
    return null;
  }
  if (input.ownerId && String(restaurant.ownerId) !== String(input.ownerId)) {
    res.status(400).json({
      message: "Selected business does not belong to the selected owner",
    });
    return null;
  }

  const actualEntityType = getRestaurantInsuranceEntityType(restaurant);
  if (input.entityType !== actualEntityType) {
    res.status(400).json({
      message: `Selected business is a ${actualEntityType}, not a ${input.entityType}`,
    });
    return null;
  }

  return {
    entityType: actualEntityType,
    entityId: String(restaurant.id),
    ownerId: String(restaurant.ownerId),
    city: restaurant.city,
    state: restaurant.state,
  };
}

export function registerInsuranceVerificationRoutes(app: Express) {
  app.post(
    "/api/business/insurance/upload-document",
    isAuthenticated,
    (req: any, res, next) => {
      insuranceDocumentUpload.single("document")(req, res, (err: any) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: "File is too large. Max 12MB." });
        }
        return res.status(400).json({ message: err?.message || "Invalid upload" });
      });
    },
    async (req: any, res) => {
      try {
        if (!isCloudinaryConfigured()) {
          return res
            .status(503)
            .json({ message: "Document upload service not configured." });
        }
        if (!req.file?.buffer) {
          return res.status(400).json({ message: "No document uploaded." });
        }
        const uploaded = await uploadRawToCloudinary(
          req.file.buffer,
          "insurance-documents",
          `insurance-${req.user?.id || "user"}-${Date.now()}`,
        );
        return res.status(201).json({
          url: uploaded.secureUrl,
          bytes: uploaded.bytes,
          format: uploaded.format,
          name: req.file.originalname,
        });
      } catch (error: any) {
        console.error("Error uploading insurance document:", error);
        return res
          .status(500)
          .json({ message: error?.message || "Failed to upload document" });
      }
    },
  );

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
    "/api/admin/insurance-verifications",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = adminInsuranceSubmitSchema.parse(req.body || {});
        const entity = await resolveAdminInsuranceEntity(parsed, res);
        if (!entity) return;

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
            entityType: entity.entityType,
            entityId: entity.entityId,
            ownerId: entity.ownerId,
            jurisdictionCity:
              parsed.jurisdictionCity || entity.city || null,
            jurisdictionState:
              parsed.jurisdictionState || entity.state || null,
            jurisdictionCountry: parsed.jurisdictionCountry || "US",
            carrierName: parsed.carrierName || null,
            policyNumber: parsed.policyNumber || null,
            coverageType:
              parsed.coverageType || "commercial_general_liability",
            coverageAmountCents: parsed.coverageAmountCents ?? null,
            effectiveDate: parsed.effectiveDate || null,
            expiresAt: parsed.expiresAt,
            documents: parsed.documents,
            attestedCommercialCoverage: parsed.attestedCommercialCoverage,
            attestedJurisdictionCompliance:
              parsed.attestedJurisdictionCompliance,
            notes: parsed.notes || null,
            metadata: {
              ...(parsed.metadata || {}),
              submittedByAdmin: true,
              submittedByUserId: req.user?.id || null,
            },
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
            submittedByAdmin: true,
            submittedByUserId: req.user?.id || null,
            jurisdictionCity: record.jurisdictionCity,
            jurisdictionState: record.jurisdictionState,
            coverageType: record.coverageType,
            expiresAt: record.expiresAt,
          },
        }).catch((creditError) => {
          console.error(
            "[credits] failed to record admin insurance_submitted:",
            creditError,
          );
        });

        res.status(201).json(record);
      } catch (error: any) {
        console.error("Error storing admin insurance proof:", error);
        res.status(400).json({
          message: error?.message || "Failed to store business proof",
        });
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
        const [existing] = await db
          .select()
          .from(businessInsuranceVerifications)
          .where(eq(businessInsuranceVerifications.id, req.params.id))
          .limit(1);
        if (!existing) {
          return res.status(404).json({ message: "Insurance verification not found" });
        }
        if (!Array.isArray(existing.documents) || existing.documents.length === 0) {
          return res.status(400).json({
            message: "Uploaded proof is required before business verification can be approved",
          });
        }
        const expiresAt = existing.expiresAt ? new Date(existing.expiresAt) : null;
        if (!expiresAt || expiresAt.getTime() <= Date.now()) {
          return res.status(400).json({
            message: "A future insurance expiration date is required before approval",
          });
        }
        if (
          !existing.attestedCommercialCoverage ||
          !existing.attestedJurisdictionCompliance
        ) {
          return res.status(400).json({
            message:
              "Commercial coverage and jurisdiction compliance attestations are required before approval",
          });
        }

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
        if (!record) {
          return res.status(404).json({ message: "Insurance verification not found" });
        }

        if (record.entityType === "host") {
          await db
            .update(hosts)
            .set({ isVerified: true, updatedAt: new Date() })
            .where(eq(hosts.id, record.entityId));
        } else {
          await db
            .update(restaurants)
            .set({ isVerified: true, isActive: true, updatedAt: new Date() })
            .where(eq(restaurants.id, record.entityId));
        }

        recordMealScoutCreditAction({
          userId: record.ownerId,
          action: "insurance_approved",
          sourceId: record.id,
          entityType: record.entityType,
          entityId: record.entityId,
          metadata: {
            reviewedBy: req.user.id,
            expiresAt: record.expiresAt,
          },
        }).catch((creditError) => {
          console.error("[credits] failed to record insurance_approved:", creditError);
        });

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
