import type { Express } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import {
  insertJobApplicationSchema,
  insertJobPostSchema,
  insertPrivateChefLeadSchema,
  insertWorkerProfileSchema,
  jobApplications,
  jobPosts,
  privateChefLeads,
  restaurants,
  users,
  workerProfiles,
} from "@shared/schema";
import { toPublicRestaurantListingArrayWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import { normalizePublicUrl } from "../publicProfiles/publicProfileUtils";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

type HiringRouteDependencies = {
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
};

const moneyToCents = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
};

const parseLimit = (value: unknown, fallback = 40, max = 100) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(numeric)));
};

const publicJob = (job: any) => ({
  id: String(job.id || ""),
  title: String(job.title || ""),
  description: String(job.description || "").trim() || null,
  role: String(job.role || ""),
  jobType: String(job.jobType || "part_time"),
  locationType: String(job.locationType || "onsite"),
  city: String(job.city || "").trim() || null,
  state: String(job.state || "").trim() || null,
  scheduleDescription: String(job.scheduleDescription || "").trim() || null,
  rateMinCents: Number.isSafeInteger(Number(job.rateMinCents))
    ? Math.max(0, Number(job.rateMinCents))
    : null,
  rateMaxCents: Number.isSafeInteger(Number(job.rateMaxCents))
    ? Math.max(0, Number(job.rateMaxCents))
    : null,
  status: "open",
  positionsAvailable: Math.max(1, Number(job.positionsAvailable || 1)),
  startsAt: job.startsAt || null,
  expiresAt: job.expiresAt || null,
  createdAt: job.createdAt || null,
});

const publicWorkerProfile = (profile: any) => ({
  id: String(profile.id || ""),
  displayName: String(profile.displayName || "Community worker"),
  headline: String(profile.headline || "").trim() || null,
  bio: String(profile.bio || "").trim() || null,
  roles: Array.isArray(profile.roles) ? profile.roles.map(String).slice(0, 12) : [],
  serviceCities: Array.isArray(profile.serviceCities)
    ? profile.serviceCities.map(String).slice(0, 12)
    : [],
  desiredRateCents: Number.isSafeInteger(Number(profile.desiredRateCents))
    ? Math.max(0, Number(profile.desiredRateCents))
    : null,
  portfolioUrl: normalizePublicUrl(profile.portfolioUrl),
  updatedAt: profile.updatedAt || null,
});

const splitCsv = (value: unknown) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const optionalDate = z.preprocess((value) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}, z.date().nullable().optional());

const workerProfilePayloadSchema = insertWorkerProfileSchema.extend({
  displayName: z.string().trim().min(1).max(120),
  roles: z.array(z.string().trim().min(1)).default([]),
  serviceCities: z.array(z.string().trim().min(1)).default([]),
  desiredRateCents: z.number().int().min(0).nullable().optional(),
  isOpenToWork: z.boolean().default(true),
  isPublic: z.boolean().default(true),
});

const jobPostPayloadSchema = insertJobPostSchema.extend({
  restaurantId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(80),
  startsAt: optionalDate,
  expiresAt: optionalDate,
  rateMinCents: z.number().int().min(0).nullable().optional(),
  rateMaxCents: z.number().int().min(0).nullable().optional(),
});

const leadPayloadSchema = insertPrivateChefLeadSchema.extend({
  chefRestaurantId: z.string().trim().min(1),
  customerName: z.string().trim().min(1).max(160),
  customerEmail: z.string().trim().email().nullable().optional(),
  customerPhone: z.string().trim().max(40).nullable().optional(),
  eventDate: optionalDate,
  guestCount: z.number().int().min(1).nullable().optional(),
  budgetCents: z.number().int().min(0).nullable().optional(),
}).refine(
  (payload) =>
    Boolean(String(payload.customerEmail || "").trim()) ||
    Boolean(String(payload.customerPhone || "").trim()),
  {
    message: "Email or phone is required.",
    path: ["customerEmail"],
  },
);

const applicationPayloadSchema = insertJobApplicationSchema.extend({
  jobId: z.string().trim().min(1),
});

const normalizeWorkerProfileInput = (body: any) => ({
  ...body,
  roles: Array.isArray(body?.roles) ? body.roles : splitCsv(body?.roles),
  serviceCities: Array.isArray(body?.serviceCities)
    ? body.serviceCities
    : splitCsv(body?.serviceCities),
  desiredRateCents:
    body?.desiredRateCents !== undefined
      ? body.desiredRateCents
      : moneyToCents(body?.desiredRate),
});

const normalizeJobInput = (body: any) => ({
  ...body,
  rateMinCents:
    body?.rateMinCents !== undefined ? body.rateMinCents : moneyToCents(body?.rateMin),
  rateMaxCents:
    body?.rateMaxCents !== undefined ? body.rateMaxCents : moneyToCents(body?.rateMax),
});

const normalizeLeadInput = (body: any, chefRestaurantId?: string) => ({
  ...body,
  chefRestaurantId: chefRestaurantId || body?.chefRestaurantId,
  customerEmail: body?.customerEmail || null,
  customerPhone: body?.customerPhone || null,
  budgetCents:
    body?.budgetCents !== undefined ? body.budgetCents : moneyToCents(body?.budget),
});

async function getUserWorkerProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(workerProfiles)
    .where(eq(workerProfiles.userId, userId))
    .limit(1);
  return profile || null;
}

async function assertRestaurantAccess(restaurantId: string, userId: string) {
  const ok = await storage.verifyRestaurantOwnership(restaurantId, userId);
  if (!ok) {
    const error = new Error("You do not have access to this business.");
    (error as any).status = 403;
    throw error;
  }
}

export function registerHiringRoutes(
  app: Express,
  { hasCompleteProfileAccess }: HiringRouteDependencies,
) {
  app.get("/api/hiring/jobs", async (req, res) => {
    try {
      const city = String(req.query.city || "").trim();
      const role = String(req.query.role || "").trim();
      const limit = parseLimit(req.query.limit);
      const filters = [
        eq(jobPosts.status, "open"),
        or(sql`${jobPosts.expiresAt} IS NULL`, sql`${jobPosts.expiresAt} > now()`),
      ];

      if (city) filters.push(ilike(jobPosts.city, `%${city}%`));
      if (role) filters.push(eq(jobPosts.role, role));

      const rows = await db
        .select({
          job: jobPosts,
          restaurant: restaurants,
        })
        .from(jobPosts)
        .innerJoin(restaurants, eq(jobPosts.restaurantId, restaurants.id))
        .where(and(...filters))
        .orderBy(desc(jobPosts.createdAt))
        .limit(limit);
      const publicRestaurants =
        await toPublicRestaurantListingArrayWithVisibility(
          rows
            .map((row: any) => row.restaurant)
            .filter(
              (restaurant: any) =>
                restaurant?.isActive === true &&
                isPublicBusinessVisible(restaurant),
            ),
        );
      const publicRestaurantById = new Map(
        publicRestaurants.map((restaurant: any) => [
          String(restaurant.id),
          restaurant,
        ]),
      );
      res.json(
        rows.flatMap((row: any) => {
          const restaurant = publicRestaurantById.get(
            String(row.restaurant.id),
          );
          return restaurant
            ? [{ job: publicJob(row.job), restaurant }]
            : [];
        }),
      );
    } catch (error) {
      console.error("Error listing hiring jobs:", error);
      res.status(500).json({ message: "Failed to load jobs" });
    }
  });

  app.get("/api/hiring/resumes", async (req, res) => {
    try {
      const city = String(req.query.city || "").trim();
      const role = String(req.query.role || "").trim();
      const limit = parseLimit(req.query.limit);
      const filters = [
        eq(workerProfiles.isOpenToWork, true),
        eq(workerProfiles.isPublic, true),
      ];

      if (city) filters.push(sql`${workerProfiles.serviceCities} ? ${city}`);
      if (role) filters.push(sql`${workerProfiles.roles} ? ${role}`);

      const rows = await db
        .select({
          profile: workerProfiles,
          user: {
            id: users.id,
            profileImageUrl: users.profileImageUrl,
          },
        })
        .from(workerProfiles)
        .innerJoin(users, eq(workerProfiles.userId, users.id))
        .where(and(...filters, eq(users.isDisabled, false)))
        .orderBy(desc(workerProfiles.updatedAt), desc(workerProfiles.createdAt))
        .limit(limit);

      res.json(
        rows.map((row: any) => ({
          profile: publicWorkerProfile(row.profile),
          user: {
            profileImageUrl: normalizePublicUrl(row.user?.profileImageUrl, {
              allowInternalPath: true,
            }),
          },
        })),
      );
    } catch (error) {
      console.error("Error listing worker resumes:", error);
      res.status(500).json({ message: "Failed to load open resumes" });
    }
  });

  app.get("/api/private-chefs", async (req, res) => {
    try {
      const city = String(req.query.city || "").trim();
      const filters = [
        eq(restaurants.businessType, "private_chef"),
        eq(restaurants.isActive, true),
      ];
      if (city) filters.push(ilike(restaurants.city, `%${city}%`));

      const rows = await db
        .select()
        .from(restaurants)
        .where(and(...filters))
        .orderBy(desc(restaurants.isVerified), desc(restaurants.createdAt))
        .limit(parseLimit(req.query.limit));

      const accessEligibleRows = [];
      for (const row of rows) {
        try {
          if (
            isPublicBusinessVisible(row) &&
            (await hasCompleteProfileAccess(String(row.ownerId || "")))
          ) {
            accessEligibleRows.push(row);
          }
        } catch {
          // Fail this listing closed when access evidence is unavailable.
        }
      }
      const publicRows =
        await toPublicRestaurantListingArrayWithVisibility(accessEligibleRows);
      res.json(
        publicRows.map((row: any) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          city: row.city,
          state: row.state,
          logoUrl: row.logoUrl,
          coverImageUrl: row.coverImageUrl,
          isVerified: row.isVerified === true,
        })),
      );
    } catch (error) {
      console.error("Error listing private chefs:", error);
      res.status(500).json({ message: "Failed to load private chefs" });
    }
  });

  app.get(
    "/api/hiring/me/worker-profile",
    isAuthenticated,
    async (req: any, res) => {
      try {
        res.json(await getUserWorkerProfile(req.user.id));
      } catch (error) {
        console.error("Error loading worker profile:", error);
        res.status(500).json({ message: "Failed to load worker profile" });
      }
    },
  );

  app.post(
    "/api/hiring/me/worker-profile",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const payload = workerProfilePayloadSchema.parse(
          normalizeWorkerProfileInput(req.body),
        );
        const [profile] = await db
          .insert(workerProfiles)
          .values({
            ...payload,
            userId: req.user.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: workerProfiles.userId,
            set: {
              ...payload,
              updatedAt: new Date(),
            },
          })
          .returning();

        res.json(profile);
      } catch (error: any) {
        console.error("Error saving worker profile:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message:
            error?.name === "ZodError"
              ? "Check the open resume fields."
              : "Failed to save worker profile",
        });
      }
    },
  );

  app.post("/api/hiring/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const payload = jobPostPayloadSchema.parse(normalizeJobInput(req.body));
      await assertRestaurantAccess(payload.restaurantId, req.user.id);

      const [job] = await db
        .insert(jobPosts)
        .values({
          ...payload,
          postedByUserId: req.user.id,
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json(job);
    } catch (error: any) {
      console.error("Error creating job post:", error);
      res.status(error?.status || (error?.name === "ZodError" ? 400 : 500)).json({
        message:
          error?.message ||
          (error?.name === "ZodError"
            ? "Check the job fields."
            : "Failed to create job"),
      });
    }
  });

  app.patch("/api/hiring/jobs/:jobId", isAuthenticated, async (req: any, res) => {
    try {
      const status = z
        .enum(["open", "paused", "filled", "closed"])
        .parse(req.body?.status);
      const [job] = await db
        .select()
        .from(jobPosts)
        .where(eq(jobPosts.id, req.params.jobId))
        .limit(1);

      if (!job) return res.status(404).json({ message: "Job not found" });
      await assertRestaurantAccess(job.restaurantId, req.user.id);

      const [updated] = await db
        .update(jobPosts)
        .set({ status, updatedAt: new Date() })
        .where(eq(jobPosts.id, req.params.jobId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating job post:", error);
      res.status(error?.status || (error?.name === "ZodError" ? 400 : 500)).json({
        message: error?.message || "Failed to update job",
      });
    }
  });

  app.get("/api/hiring/business/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const restaurantId = String(req.query.restaurantId || "").trim();
      const owned = await storage.getRestaurantsByOwner(req.user.id);
      const ownedIds = owned.map((restaurant: any) => restaurant.id);

      if (restaurantId) {
        await assertRestaurantAccess(restaurantId, req.user.id);
      }

      const targetIds = restaurantId ? [restaurantId] : ownedIds;
      if (!targetIds.length) return res.json([]);

      const rows = await db
        .select({
          job: jobPosts,
          restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            businessType: restaurants.businessType,
          },
        })
        .from(jobPosts)
        .innerJoin(restaurants, eq(jobPosts.restaurantId, restaurants.id))
        .where(inArray(jobPosts.restaurantId, targetIds))
        .orderBy(desc(jobPosts.createdAt));

      res.json(rows);
    } catch (error: any) {
      console.error("Error loading business jobs:", error);
      res.status(error?.status || 500).json({
        message: error?.message || "Failed to load business jobs",
      });
    }
  });

  app.get(
    "/api/hiring/business/applications",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const owned = await storage.getRestaurantsByOwner(req.user.id);
        const ownedIds = owned.map((restaurant: any) => restaurant.id);
        if (!ownedIds.length) return res.json([]);

        const rows = await db
          .select({
            application: jobApplications,
            job: jobPosts,
            profile: workerProfiles,
            restaurant: {
              id: restaurants.id,
              name: restaurants.name,
              businessType: restaurants.businessType,
            },
          })
          .from(jobApplications)
          .innerJoin(jobPosts, eq(jobApplications.jobId, jobPosts.id))
          .innerJoin(
            workerProfiles,
            eq(jobApplications.workerProfileId, workerProfiles.id),
          )
          .innerJoin(restaurants, eq(jobPosts.restaurantId, restaurants.id))
          .where(inArray(jobPosts.restaurantId, ownedIds))
          .orderBy(desc(jobApplications.createdAt));

        res.json(rows);
      } catch (error) {
        console.error("Error loading business applications:", error);
        res.status(500).json({ message: "Failed to load applications" });
      }
    },
  );

  app.post(
    "/api/hiring/jobs/:jobId/apply",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const payload = applicationPayloadSchema.parse({
          ...req.body,
          jobId: req.params.jobId,
          proposedRateCents:
            req.body?.proposedRateCents !== undefined
              ? req.body.proposedRateCents
              : moneyToCents(req.body?.proposedRate),
        });
        const profile = await getUserWorkerProfile(req.user.id);
        if (!profile) {
          return res.status(400).json({
            message: "Create your open resume before applying.",
          });
        }

        const [job] = await db
          .select()
          .from(jobPosts)
          .where(and(eq(jobPosts.id, payload.jobId), eq(jobPosts.status, "open")))
          .limit(1);
        if (!job) return res.status(404).json({ message: "Job not found" });

        const [application] = await db
          .insert(jobApplications)
          .values({
            ...payload,
            workerProfileId: profile.id,
            applicantUserId: req.user.id,
          })
          .onConflictDoNothing()
          .returning();

        if (!application) {
          return res.status(409).json({ message: "You already applied." });
        }

        res.status(201).json(application);
      } catch (error: any) {
        console.error("Error applying to job:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message:
            error?.name === "ZodError"
              ? "Check the application fields."
              : "Failed to apply",
        });
      }
    },
  );

  app.get(
    "/api/hiring/jobs/:jobId/applications",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const [job] = await db
          .select()
          .from(jobPosts)
          .where(eq(jobPosts.id, req.params.jobId))
          .limit(1);
        if (!job) return res.status(404).json({ message: "Job not found" });
        await assertRestaurantAccess(job.restaurantId, req.user.id);

        const rows = await db
          .select({
            application: jobApplications,
            profile: workerProfiles,
          })
          .from(jobApplications)
          .innerJoin(
            workerProfiles,
            eq(jobApplications.workerProfileId, workerProfiles.id),
          )
          .where(eq(jobApplications.jobId, req.params.jobId))
          .orderBy(desc(jobApplications.createdAt));

        res.json(rows);
      } catch (error: any) {
        console.error("Error loading job applications:", error);
        res.status(error?.status || 500).json({
          message: error?.message || "Failed to load applications",
        });
      }
    },
  );

  app.patch(
    "/api/hiring/applications/:applicationId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const status = z
          .enum(["pending", "accepted", "rejected", "withdrawn"])
          .parse(req.body?.status);
        const [row] = await db
          .select({
            application: jobApplications,
            job: jobPosts,
          })
          .from(jobApplications)
          .innerJoin(jobPosts, eq(jobApplications.jobId, jobPosts.id))
          .where(eq(jobApplications.id, req.params.applicationId))
          .limit(1);

        if (!row) return res.status(404).json({ message: "Application not found" });
        await assertRestaurantAccess(row.job.restaurantId, req.user.id);

        const [application] = await db
          .update(jobApplications)
          .set({
            status,
            respondedAt: status === "pending" ? null : new Date(),
          })
          .where(eq(jobApplications.id, req.params.applicationId))
          .returning();

        res.json(application);
      } catch (error: any) {
        console.error("Error updating application:", error);
        res.status(error?.status || (error?.name === "ZodError" ? 400 : 500)).json({
          message: error?.message || "Failed to update application",
        });
      }
    },
  );

  app.post("/api/private-chefs/:chefId/leads", async (req: any, res) => {
    try {
      const payload = leadPayloadSchema.parse(
        normalizeLeadInput(req.body, req.params.chefId),
      );
      const [chef] = await db
        .select()
        .from(restaurants)
        .where(
          and(
            eq(restaurants.id, payload.chefRestaurantId),
            eq(restaurants.businessType, "private_chef"),
            eq(restaurants.isActive, true),
          ),
        )
        .limit(1);
      if (!chef || !isPublicBusinessVisible(chef)) {
        return res.status(404).json({ message: "Private chef not found" });
      }
      const [publicChef] =
        await toPublicRestaurantListingArrayWithVisibility([chef]);
      const hasAccess = publicChef
        ? await hasCompleteProfileAccess(String(chef.ownerId || "")).catch(
            () => false,
          )
        : false;
      if (!hasAccess) {
        return res.status(402).json({
          message:
            "This private chef is not accepting MealScout requests right now.",
        });
      }

      const [lead] = await db
        .insert(privateChefLeads)
        .values({
          ...payload,
          customerUserId:
            req.isAuthenticated?.() && req.user?.id ? req.user.id : null,
          updatedAt: new Date(),
        })
        .returning();

      res.status(201).json({
        id: lead.id,
        status: lead.status || "new",
        createdAt: lead.createdAt || null,
      });
    } catch (error: any) {
      console.error("Error creating private chef lead:", error);
      res.status(error?.name === "ZodError" ? 400 : 500).json({
        message:
          error?.name === "ZodError"
            ? "Check the chef request fields."
            : "Failed to send chef request",
      });
    }
  });

  app.get(
    "/api/private-chefs/leads/mine",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const owned = await storage.getRestaurantsByOwner(req.user.id);
        const chefIds = owned
          .filter((restaurant: any) => restaurant.businessType === "private_chef")
          .map((restaurant: any) => restaurant.id);

        if (!chefIds.length) return res.json([]);

        const rows = await db
          .select({
            lead: privateChefLeads,
            chef: {
              id: restaurants.id,
              name: restaurants.name,
            },
          })
          .from(privateChefLeads)
          .innerJoin(
            restaurants,
            eq(privateChefLeads.chefRestaurantId, restaurants.id),
          )
          .where(inArray(privateChefLeads.chefRestaurantId, chefIds))
          .orderBy(desc(privateChefLeads.createdAt));

        res.json(rows);
      } catch (error) {
        console.error("Error loading private chef leads:", error);
        res.status(500).json({ message: "Failed to load chef leads" });
      }
    },
  );

  app.patch(
    "/api/private-chefs/leads/:leadId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const status = z
          .enum(["new", "contacted", "booked", "declined", "closed"])
          .parse(req.body?.status);
        const [row] = await db
          .select()
          .from(privateChefLeads)
          .where(eq(privateChefLeads.id, req.params.leadId))
          .limit(1);

        if (!row) return res.status(404).json({ message: "Lead not found" });
        await assertRestaurantAccess(row.chefRestaurantId, req.user.id);

        const [lead] = await db
          .update(privateChefLeads)
          .set({ status, updatedAt: new Date() })
          .where(eq(privateChefLeads.id, req.params.leadId))
          .returning();

        res.json(lead);
      } catch (error: any) {
        console.error("Error updating private chef lead:", error);
        res.status(error?.status || (error?.name === "ZodError" ? 400 : 500)).json({
          message: error?.message || "Failed to update chef lead",
        });
      }
    },
  );
}
