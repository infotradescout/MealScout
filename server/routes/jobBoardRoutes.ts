import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import {
  isCloudinaryConfigured,
  uploadRawToCloudinary,
} from "../imageUpload";
import {
  getBusinessAccessContext,
  hasBusinessPermissionForRestaurant,
} from "../services/businessTeamAccess";
import { isAuthenticated } from "../unifiedAuth";
import {
  jobApplications,
  jobPostings,
  restaurants,
  users,
} from "@shared/schema";

const JOB_STATUSES = new Set(["draft", "open", "paused", "closed"]);
const APPLICATION_STATUSES = new Set([
  "new",
  "reviewed",
  "contacted",
  "interviewing",
  "hired",
  "declined",
]);

const supportedResumeMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/rtf",
  "text/rtf",
  "application/octet-stream",
]);

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const extensionAllowed = /\.(pdf|doc|docx|txt|rtf)$/.test(name);
    if (supportedResumeMimeTypes.has(file.mimetype) || extensionAllowed) {
      cb(null, true);
      return;
    }
    cb(new Error("Resume must be a PDF, DOC, DOCX, TXT, or RTF file."));
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const resumeMiddleware = (req: Request, res: Response, next: NextFunction) => {
  resumeUpload.single("resume")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "Resume files must be 10 MB or smaller."
        : error instanceof Error
          ? error.message
          : "Resume upload failed.";
    res.status(400).json({ message });
  });
};

const optionalString = z
  .union([z.string(), z.number(), z.boolean()])
  .optional()
  .nullable();

const jobPayloadSchema = z.object({
  restaurantId: z.string().min(1),
  title: z.string().min(2).max(160),
  roleType: optionalString,
  employmentType: optionalString,
  description: optionalString,
  requirements: optionalString,
  scheduleDescription: optionalString,
  compensationLabel: optionalString,
  payMinCents: optionalString,
  payMaxCents: optionalString,
  locationLabel: optionalString,
  city: optionalString,
  state: optionalString,
  isRemoteFriendly: optionalString,
  positionsAvailable: optionalString,
  status: optionalString,
  expiresAt: optionalString,
});

const applicationPayloadSchema = z.object({
  applicantName: z.string().min(2).max(160),
  applicantEmail: z.string().email().max(220),
  applicantPhone: optionalString,
  resumeUrl: optionalString,
  coverNote: optionalString,
  availability: optionalString,
  experienceSummary: optionalString,
});

const trimToNull = (value: unknown, max = 5000) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
};

const trimToValue = (value: unknown, fallback: string, max = 120) =>
  (trimToNull(value, max) || fallback).slice(0, max);

const toOptionalInteger = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
};

const toBoolean = (value: unknown) =>
  value === true ||
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";

const toOptionalDate = (value: unknown) => {
  const raw = trimToNull(value, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const isStaffOrAdminUser = (user: any) =>
  ["staff", "admin", "super_admin"].includes(
    String(user?.userType || "").toLowerCase(),
  );

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const resolveBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.CLIENT_ORIGIN ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

const openJobWindow = () =>
  or(isNull(jobPostings.expiresAt), gt(jobPostings.expiresAt, new Date()));

const publicJobSelect = {
  id: jobPostings.id,
  restaurantId: jobPostings.restaurantId,
  title: jobPostings.title,
  roleType: jobPostings.roleType,
  employmentType: jobPostings.employmentType,
  description: jobPostings.description,
  requirements: jobPostings.requirements,
  scheduleDescription: jobPostings.scheduleDescription,
  compensationLabel: jobPostings.compensationLabel,
  payMinCents: jobPostings.payMinCents,
  payMaxCents: jobPostings.payMaxCents,
  locationLabel: jobPostings.locationLabel,
  city: jobPostings.city,
  state: jobPostings.state,
  positionsAvailable: jobPostings.positionsAvailable,
  expiresAt: jobPostings.expiresAt,
  createdAt: jobPostings.createdAt,
  updatedAt: jobPostings.updatedAt,
  restaurantName: restaurants.name,
  restaurantBusinessType: restaurants.businessType,
  restaurantLogoUrl: restaurants.logoUrl,
  restaurantCoverImageUrl: restaurants.coverImageUrl,
  restaurantCity: restaurants.city,
  restaurantState: restaurants.state,
};

type PublicJobRow = typeof publicJobSelect & {
  id: string;
  title: string;
  restaurantName: string;
};

const decorateJob = (row: any) => {
  const slug =
    toSlug(`${row.restaurantName || "mealscout"} ${row.title || "job"}`) ||
    row.id;
  return {
    ...row,
    slug,
    publicUrl: `/jobs/${encodeURIComponent(row.id)}/${encodeURIComponent(slug)}`,
    restaurantProfileUrl: `/restaurant/${encodeURIComponent(row.restaurantId)}/${encodeURIComponent(toSlug(row.restaurantName) || row.restaurantId)}`,
  };
};

const normalizeJobPayload = (raw: z.infer<typeof jobPayloadSchema>) => {
  const status = trimToValue(raw.status, "open", 40);
  return {
    restaurantId: raw.restaurantId,
    title: trimToValue(raw.title, "Help wanted", 160),
    roleType: trimToValue(raw.roleType, "other", 80),
    employmentType: trimToValue(raw.employmentType, "part_time", 80),
    description: trimToNull(raw.description, 5000),
    requirements: trimToNull(raw.requirements, 3000),
    scheduleDescription: trimToNull(raw.scheduleDescription, 1000),
    compensationLabel: trimToNull(raw.compensationLabel, 140),
    payMinCents: toOptionalInteger(raw.payMinCents),
    payMaxCents: toOptionalInteger(raw.payMaxCents),
    locationLabel: trimToNull(raw.locationLabel, 180),
    city: trimToNull(raw.city, 120),
    state: trimToNull(raw.state, 80),
    isRemoteFriendly: toBoolean(raw.isRemoteFriendly),
    positionsAvailable: Math.min(
      50,
      Math.max(1, toOptionalInteger(raw.positionsAvailable) || 1),
    ),
    status: JOB_STATUSES.has(status) ? status : "open",
    expiresAt: toOptionalDate(raw.expiresAt),
  };
};

const requireRestaurantAccess = async (
  req: any,
  res: Response,
  restaurantId: string,
) => {
  const userId = String(req.user?.id || "");
  if (!userId) {
    res.status(401).json({ message: "Please sign in first." });
    return false;
  }
  const allowed = await hasBusinessPermissionForRestaurant(
    userId,
    restaurantId,
    "manageProfile",
  );
  if (!allowed) {
    res.status(403).json({ message: "You do not have access to this business." });
    return false;
  }
  return true;
};

async function getPublicJobs(params: {
  restaurantId?: string;
  city?: string;
  state?: string;
  roleType?: string;
  search?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(Number(params.limit || 40), 1), 100);
  const clauses = [
    eq(jobPostings.status, "open"),
    openJobWindow(),
    eq(restaurants.isActive, true),
  ];

  if (params.restaurantId) {
    clauses.push(eq(jobPostings.restaurantId, params.restaurantId));
  }
  if (params.city) {
    clauses.push(ilike(jobPostings.city, params.city));
  }
  if (params.state) {
    clauses.push(ilike(jobPostings.state, params.state));
  }
  if (params.roleType) {
    clauses.push(eq(jobPostings.roleType, params.roleType));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    clauses.push(
      or(
        ilike(jobPostings.title, term),
        ilike(jobPostings.description, term),
        ilike(restaurants.name, term),
      )!,
    );
  }

  const rows = await db
    .select(publicJobSelect)
    .from(jobPostings)
    .innerJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
    .where(and(...clauses))
    .orderBy(desc(jobPostings.createdAt))
    .limit(limit);

  return rows.map(decorateJob);
}

async function sendApplicationNotice(params: {
  job: any;
  application: any;
}) {
  const [owner] = await db
    .select({
      email: users.email,
      restaurantName: restaurants.name,
    })
    .from(restaurants)
    .innerJoin(users, eq(users.id, restaurants.ownerId))
    .where(eq(restaurants.id, params.job.restaurantId))
    .limit(1);

  if (!owner?.email) return;

  const baseUrl = resolveBaseUrl();
  const jobUrl = `${baseUrl}${params.job.publicUrl || ""}`;
  const subject = `New applicant for ${params.job.title}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
      <h2 style="margin:0 0 12px">New job application</h2>
      <p><strong>${escapeHtml(params.application.applicantName)}</strong> applied for <strong>${escapeHtml(params.job.title)}</strong> at ${escapeHtml(owner.restaurantName)}.</p>
      <p><strong>Email:</strong> ${escapeHtml(params.application.applicantEmail)}</p>
      ${params.application.applicantPhone ? `<p><strong>Phone:</strong> ${escapeHtml(params.application.applicantPhone)}</p>` : ""}
      ${params.application.availability ? `<p><strong>Availability:</strong><br>${escapeHtml(params.application.availability)}</p>` : ""}
      ${params.application.experienceSummary ? `<p><strong>Experience:</strong><br>${escapeHtml(params.application.experienceSummary)}</p>` : ""}
      ${params.application.resumeUrl ? `<p><a href="${escapeHtml(params.application.resumeUrl)}">Open resume</a></p>` : ""}
      <p><a href="${escapeHtml(jobUrl)}">View the public job post</a></p>
    </div>
  `;
  const text = [
    "New job application",
    `${params.application.applicantName} applied for ${params.job.title}.`,
    `Email: ${params.application.applicantEmail}`,
    params.application.applicantPhone
      ? `Phone: ${params.application.applicantPhone}`
      : "",
    params.application.resumeUrl ? `Resume: ${params.application.resumeUrl}` : "",
    `Job: ${jobUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  await emailService.sendBasicEmail(owner.email, subject, html, text, "general");
}

export function registerJobBoardRoutes(app: Express) {
  app.get("/api/jobs", async (req, res) => {
    try {
      const jobs = await getPublicJobs({
        restaurantId: trimToNull(req.query.restaurantId, 80) || undefined,
        city: trimToNull(req.query.city, 120) || undefined,
        state: trimToNull(req.query.state, 80) || undefined,
        roleType: trimToNull(req.query.roleType, 80) || undefined,
        search: trimToNull(req.query.q, 120) || undefined,
        limit: Number(req.query.limit || 40),
      });
      res.json({ jobs });
    } catch (error) {
      console.error("[jobs] failed to list public jobs:", error);
      res.status(500).json({ message: "Failed to load jobs" });
    }
  });

  app.get("/api/jobs/restaurant/:restaurantId/open", async (req, res) => {
    try {
      const restaurantId = String(req.params.restaurantId || "").trim();
      const jobs = await getPublicJobs({ restaurantId, limit: 12 });
      res.json({
        jobs,
        activeJob: jobs[0] || null,
        openCount: jobs.length,
      });
    } catch (error) {
      console.error("[jobs] failed to load restaurant jobs:", error);
      res.status(500).json({ message: "Failed to load open jobs" });
    }
  });

  app.get("/api/jobs/:jobId", async (req, res) => {
    try {
      const jobId = String(req.params.jobId || "").trim();
      const [job] = await db
        .select(publicJobSelect)
        .from(jobPostings)
        .innerJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
        .where(
          and(
            eq(jobPostings.id, jobId),
            eq(jobPostings.status, "open"),
            openJobWindow(),
            eq(restaurants.isActive, true),
          ),
        )
        .limit(1);
      if (!job) {
        return res.status(404).json({ message: "Job post not found" });
      }
      res.json({ job: decorateJob(job) });
    } catch (error) {
      console.error("[jobs] failed to load job:", error);
      res.status(500).json({ message: "Failed to load job" });
    }
  });

  app.post("/api/jobs/:jobId/apply", resumeMiddleware, async (req: any, res) => {
    try {
      const jobId = String(req.params.jobId || "").trim();
      const [job] = await db
        .select(publicJobSelect)
        .from(jobPostings)
        .innerJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
        .where(
          and(
            eq(jobPostings.id, jobId),
            eq(jobPostings.status, "open"),
            openJobWindow(),
            eq(restaurants.isActive, true),
          ),
        )
        .limit(1);
      if (!job) {
        return res.status(404).json({ message: "Job post not found" });
      }

      const parsed = applicationPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Please add your name and a valid email.",
          errors: parsed.error.flatten(),
        });
      }

      let resumeUrl = trimToNull(parsed.data.resumeUrl, 500);
      let resumeFileName = null;
      let resumeStoragePublicId = null;
      const file = req.file as Express.Multer.File | undefined;
      if (file) {
        if (!isCloudinaryConfigured()) {
          return res.status(503).json({
            message:
              "Resume file storage is not configured yet. Paste a resume link instead.",
          });
        }
        const safeName = String(file.originalname || "resume")
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, "-")
          .replace(/(^-|-$)+/g, "")
          .slice(0, 80);
        const uploaded = await uploadRawToCloudinary(
          file.buffer,
          "job-resumes",
          `${jobId}-${Date.now()}-${safeName || "resume"}`,
        );
        resumeUrl = uploaded.secureUrl;
        resumeFileName = file.originalname || null;
        resumeStoragePublicId = uploaded.publicId;
      }

      const [application] = await db
        .insert(jobApplications)
        .values({
          jobId,
          restaurantId: job.restaurantId,
          applicantUserId:
            req.isAuthenticated?.() && req.user?.id ? req.user.id : null,
          applicantName: trimToValue(parsed.data.applicantName, "Applicant", 160),
          applicantEmail: trimToValue(parsed.data.applicantEmail, "", 220)
            .toLowerCase(),
          applicantPhone: trimToNull(parsed.data.applicantPhone, 60),
          resumeUrl,
          resumeFileName,
          resumeStoragePublicId,
          coverNote: trimToNull(parsed.data.coverNote, 4000),
          availability: trimToNull(parsed.data.availability, 1000),
          experienceSummary: trimToNull(parsed.data.experienceSummary, 2000),
        })
        .returning();

      sendApplicationNotice({ job: decorateJob(job), application }).catch(
        (error) => {
          console.warn(
            "[jobs] application email failed:",
            error instanceof Error ? error.message : String(error),
          );
        },
      );

      res.status(201).json({ application });
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({
          message:
            "You already applied to this job with that email. The business has your application.",
        });
      }
      console.error("[jobs] failed to submit application:", error);
      res.status(500).json({ message: "Failed to submit application" });
    }
  });

  app.get("/api/owner/jobs/businesses", isAuthenticated, async (req: any, res) => {
    try {
      if (isStaffOrAdminUser(req.user)) {
        const search = trimToNull(req.query.q, 120);
        const includeRestaurantId = trimToNull(req.query.includeRestaurantId, 80);
        const limit = Math.min(
          Math.max(Number.parseInt(String(req.query.limit || "150"), 10) || 150, 1),
          500,
        );
        const clauses = [eq(restaurants.isActive, true)];

        if (search) {
          const term = `%${search.replace(/[%_]/g, "\\$&")}%`;
          clauses.push(
            or(
              ilike(restaurants.name, term),
              ilike(restaurants.cuisineType, term),
              ilike(restaurants.city, term),
              ilike(restaurants.state, term),
            )!,
          );
        }

        let rows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            businessType: restaurants.businessType,
            cuisineType: restaurants.cuisineType,
            city: restaurants.city,
            state: restaurants.state,
            ownerId: restaurants.ownerId,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
          })
          .from(restaurants)
          .where(and(...clauses))
          .orderBy(desc(restaurants.createdAt))
          .limit(limit);

        if (
          includeRestaurantId &&
          !rows.some((row: { id: string }) => row.id === includeRestaurantId)
        ) {
          const [included] = await db
            .select({
              id: restaurants.id,
              name: restaurants.name,
              businessType: restaurants.businessType,
              cuisineType: restaurants.cuisineType,
              city: restaurants.city,
              state: restaurants.state,
              ownerId: restaurants.ownerId,
              isFoodTruck: restaurants.isFoodTruck,
              isActive: restaurants.isActive,
            })
            .from(restaurants)
            .where(eq(restaurants.id, includeRestaurantId))
            .limit(1);

          if (included) {
            rows = [included, ...rows].slice(0, limit);
          }
        }

        return res.json({ restaurants: rows, scope: "all" });
      }

      const context = await getBusinessAccessContext(String(req.user.id));
      res.json({ restaurants: context.restaurants, scope: "managed" });
    } catch (error) {
      console.error("[jobs] failed to load hiring businesses:", error);
      res.status(500).json({ message: "Failed to load businesses" });
    }
  });

  app.get("/api/owner/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const restaurantId = String(req.query.restaurantId || "").trim();
      if (!restaurantId) {
        return res.status(400).json({ message: "Restaurant is required" });
      }
      if (!(await requireRestaurantAccess(req, res, restaurantId))) return;

      const jobs = await db
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.restaurantId, restaurantId))
        .orderBy(desc(jobPostings.createdAt));

      const counts = await db.execute(sql`
        select job_id, count(*)::int as count
        from job_applications
        where restaurant_id = ${restaurantId}
        group by job_id
      `);
      const countByJob = new Map(
        (counts.rows || []).map((row: any) => [
          String(row.job_id),
          Number(row.count || 0),
        ]),
      );

      const decorated = jobs.map((job: any) => ({
        ...job,
        slug: toSlug(job.title) || job.id,
        applicationCount: countByJob.get(job.id) || 0,
      }));
      res.json({
        jobs: decorated,
        openJobs: decorated.filter((job: any) => job.status === "open"),
        activeJob:
          decorated.find((job: any) => job.status === "open") || null,
      });
    } catch (error) {
      console.error("[jobs] failed to load owner jobs:", error);
      res.status(500).json({ message: "Failed to load hiring posts" });
    }
  });

  app.post("/api/owner/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = jobPayloadSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Please add a job title and business.",
          errors: parsed.error.flatten(),
        });
      }
      const payload = normalizeJobPayload(parsed.data);
      if (!(await requireRestaurantAccess(req, res, payload.restaurantId))) {
        return;
      }

      const [restaurant] = await db
        .select({
          city: restaurants.city,
          state: restaurants.state,
          name: restaurants.name,
        })
        .from(restaurants)
        .where(eq(restaurants.id, payload.restaurantId))
        .limit(1);

      const [job] = await db
        .insert(jobPostings)
        .values({
          ...payload,
          postedByUserId: req.user.id,
          city: payload.city || restaurant?.city || null,
          state: payload.state || restaurant?.state || null,
          locationLabel:
            payload.locationLabel ||
            [restaurant?.city, restaurant?.state].filter(Boolean).join(", ") ||
            null,
        })
        .returning();

      res.status(201).json({ job });
    } catch (error) {
      console.error("[jobs] failed to create job:", error);
      res.status(500).json({ message: "Failed to create hiring post" });
    }
  });

  app.post(
    "/api/owner/jobs/help-wanted",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const parsed = jobPayloadSchema.safeParse({
          ...req.body,
          status: "open",
        });
        if (!parsed.success) {
          return res.status(400).json({
            message: "Please add the role you are hiring for.",
            errors: parsed.error.flatten(),
          });
        }
        const payload = normalizeJobPayload(parsed.data);
        if (!(await requireRestaurantAccess(req, res, payload.restaurantId))) {
          return;
        }

        const [restaurant] = await db
          .select({
            city: restaurants.city,
            state: restaurants.state,
            name: restaurants.name,
          })
          .from(restaurants)
          .where(eq(restaurants.id, payload.restaurantId))
          .limit(1);

        const [existing] = await db
          .select()
          .from(jobPostings)
          .where(
            and(
              eq(jobPostings.restaurantId, payload.restaurantId),
              eq(jobPostings.status, "open"),
            ),
          )
          .orderBy(desc(jobPostings.updatedAt))
          .limit(1);

        if (existing) {
          const [job] = await db
            .update(jobPostings)
            .set({
              ...payload,
              postedByUserId: req.user.id,
              city: payload.city || restaurant?.city || null,
              state: payload.state || restaurant?.state || null,
              locationLabel:
                payload.locationLabel ||
                [restaurant?.city, restaurant?.state]
                  .filter(Boolean)
                  .join(", ") ||
                null,
              updatedAt: new Date(),
            })
            .where(eq(jobPostings.id, existing.id))
            .returning();
          return res.json({ job, mode: "updated" });
        }

        const [job] = await db
          .insert(jobPostings)
          .values({
            ...payload,
            postedByUserId: req.user.id,
            city: payload.city || restaurant?.city || null,
            state: payload.state || restaurant?.state || null,
            locationLabel:
              payload.locationLabel ||
              [restaurant?.city, restaurant?.state].filter(Boolean).join(", ") ||
              null,
            description:
              payload.description ||
              `Join the team at ${restaurant?.name || "this MealScout business"}. Share your availability and experience so they can follow up quickly.`,
          })
          .returning();

        res.status(201).json({ job, mode: "created" });
      } catch (error) {
        console.error("[jobs] failed to toggle help wanted:", error);
        res.status(500).json({ message: "Failed to update help wanted" });
      }
    },
  );

  app.post(
    "/api/owner/jobs/help-wanted/close",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const restaurantId = String(req.body?.restaurantId || "").trim();
        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant is required" });
        }
        if (!(await requireRestaurantAccess(req, res, restaurantId))) return;

        const closedJobs = await db
          .update(jobPostings)
          .set({ status: "closed", updatedAt: new Date() })
          .where(
            and(
              eq(jobPostings.restaurantId, restaurantId),
              eq(jobPostings.status, "open"),
            ),
          )
          .returning({ id: jobPostings.id });

        res.json({ closed: closedJobs.length });
      } catch (error) {
        console.error("[jobs] failed to close help wanted:", error);
        res.status(500).json({ message: "Failed to remove help wanted" });
      }
    },
  );

  app.patch("/api/owner/jobs/:jobId", isAuthenticated, async (req: any, res) => {
    try {
      const jobId = String(req.params.jobId || "").trim();
      const [existing] = await db
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.id, jobId))
        .limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Hiring post not found" });
      }
      if (!(await requireRestaurantAccess(req, res, existing.restaurantId))) {
        return;
      }

      const parsed = jobPayloadSchema.safeParse({
        ...existing,
        ...req.body,
        restaurantId: existing.restaurantId,
        title: req.body?.title ?? existing.title,
      });
      if (!parsed.success) {
        return res.status(400).json({
          message: "Please check the hiring post fields.",
          errors: parsed.error.flatten(),
        });
      }
      const payload = normalizeJobPayload(parsed.data as any);
      const [job] = await db
        .update(jobPostings)
        .set({
          title: payload.title,
          roleType: payload.roleType,
          employmentType: payload.employmentType,
          description: payload.description,
          requirements: payload.requirements,
          scheduleDescription: payload.scheduleDescription,
          compensationLabel: payload.compensationLabel,
          payMinCents: payload.payMinCents,
          payMaxCents: payload.payMaxCents,
          locationLabel: payload.locationLabel,
          city: payload.city,
          state: payload.state,
          isRemoteFriendly: payload.isRemoteFriendly,
          positionsAvailable: payload.positionsAvailable,
          status: payload.status,
          expiresAt: payload.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(jobPostings.id, jobId))
        .returning();

      res.json({ job });
    } catch (error) {
      console.error("[jobs] failed to update job:", error);
      res.status(500).json({ message: "Failed to update hiring post" });
    }
  });

  app.get(
    "/api/owner/jobs/:jobId/applications",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const jobId = String(req.params.jobId || "").trim();
        const [job] = await db
          .select()
          .from(jobPostings)
          .where(eq(jobPostings.id, jobId))
          .limit(1);
        if (!job) {
          return res.status(404).json({ message: "Hiring post not found" });
        }
        if (!(await requireRestaurantAccess(req, res, job.restaurantId))) {
          return;
        }

        const applications = await db
          .select()
          .from(jobApplications)
          .where(eq(jobApplications.jobId, jobId))
          .orderBy(desc(jobApplications.createdAt));
        res.json({ applications });
      } catch (error) {
        console.error("[jobs] failed to load applications:", error);
        res.status(500).json({ message: "Failed to load applications" });
      }
    },
  );

  app.patch(
    "/api/owner/job-applications/:applicationId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const applicationId = String(req.params.applicationId || "").trim();
        const [existing] = await db
          .select()
          .from(jobApplications)
          .where(eq(jobApplications.id, applicationId))
          .limit(1);
        if (!existing) {
          return res.status(404).json({ message: "Application not found" });
        }
        if (
          !(await requireRestaurantAccess(req, res, existing.restaurantId))
        ) {
          return;
        }
        const status = trimToValue(req.body?.status, existing.status, 40);
        if (!APPLICATION_STATUSES.has(status)) {
          return res.status(400).json({ message: "Unknown application status" });
        }

        const [application] = await db
          .update(jobApplications)
          .set({ status, updatedAt: new Date() })
          .where(eq(jobApplications.id, applicationId))
          .returning();

        res.json({ application });
      } catch (error) {
        console.error("[jobs] failed to update application:", error);
        res.status(500).json({ message: "Failed to update application" });
      }
    },
  );
}
