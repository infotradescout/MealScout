import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
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
import { submitIndexNowUrls } from "../services/indexNow";
import { isAuthenticated } from "../unifiedAuth";
import { recordMealScoutCreditAction } from "../mealScoutCreditsService";
import {
  jobApplications,
  jobPostings,
  hosts,
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
  restaurantId: z.string().min(1).optional().nullable(),
  hostId: z.string().min(1).optional().nullable(),
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
  hostId: jobPostings.hostId,
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
  restaurantAddress: restaurants.address,
  restaurantCity: restaurants.city,
  restaurantState: restaurants.state,
  restaurantWebsiteUrl: restaurants.websiteUrl,
  hostName: hosts.businessName,
  hostLocationType: hosts.locationType,
  hostAddress: hosts.address,
  hostCity: hosts.city,
  hostState: hosts.state,
  hostWebsiteUrl: hosts.businessWebsite,
  hostImageUrl: hosts.spotImageUrl,
};

type PublicJobRow = any;

const decorateJob = (row: any) => {
  const isHostJob = Boolean(row.hostId);
  const businessId = isHostJob ? row.hostId : row.restaurantId;
  const businessName =
    (isHostJob ? row.hostName : row.restaurantName) ||
    row.restaurantName ||
    row.hostName ||
    "MealScout business";
  const slug =
    toSlug(`${businessName || "mealscout"} ${row.title || "job"}`) ||
    row.id;
  const businessSlug = toSlug(businessName) || businessId || "business";
  const restaurantBusinessType = String(row.restaurantBusinessType || "").toLowerCase();
  const businessProfileUrl = isHostJob
    ? `/p/host/${encodeURIComponent(businessId)}/${encodeURIComponent(businessSlug)}`
    : restaurantBusinessType === "private_chef"
      ? `/chef/${encodeURIComponent(`${businessSlug}--${businessId}`)}`
      : `/restaurant/${encodeURIComponent(businessId)}/${encodeURIComponent(businessSlug)}`;
  return {
    ...row,
    businessEntity: isHostJob ? "host" : "restaurant",
    businessId,
    businessName,
    businessProfileUrl,
    restaurantName: row.restaurantName || businessName,
    restaurantProfileUrl: businessProfileUrl,
    hostProfileUrl: isHostJob ? businessProfileUrl : null,
    restaurantLogoUrl: row.restaurantLogoUrl || row.hostImageUrl || null,
    restaurantCoverImageUrl:
      row.restaurantCoverImageUrl || row.hostImageUrl || null,
    restaurantAddress: row.restaurantAddress || row.hostAddress || null,
    restaurantCity: row.restaurantCity || row.hostCity || null,
    restaurantState: row.restaurantState || row.hostState || null,
    restaurantWebsiteUrl: row.restaurantWebsiteUrl || row.hostWebsiteUrl || null,
    slug,
    publicUrl: `/jobs/${encodeURIComponent(row.id)}/${encodeURIComponent(slug)}`,
  };
};

const absoluteJobUrl = (job: any, businessName?: string | null) => {
  const decorated = decorateJob({
    ...job,
    restaurantName: businessName || job?.restaurantName || "",
    hostName: businessName || job?.hostName || "",
  });
  return `${resolveBaseUrl()}${decorated.publicUrl}`;
};

const submitJobToIndexNow = (
  job: any,
  businessName?: string | null,
  reason = "job-updated",
) => {
  const url = absoluteJobUrl(job, businessName);
  submitIndexNowUrls([url])
    .then((result) => {
      if (result.ok) {
        console.log(`[indexnow] ${reason}: submitted ${url}`);
      }
    })
    .catch((error) => {
      console.warn(
        `[indexnow] ${reason} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    });
};

const normalizeJobPayload = (raw: z.infer<typeof jobPayloadSchema>) => {
  const status = trimToValue(raw.status, "open", 40);
  return {
    restaurantId: trimToNull(raw.restaurantId, 80),
    hostId: trimToNull(raw.hostId, 80),
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

type BusinessTarget = {
  restaurantId?: string | null;
  hostId?: string | null;
};

const normalizeBusinessTarget = (target: BusinessTarget): BusinessTarget => ({
  restaurantId: trimToNull(target.restaurantId, 80),
  hostId: trimToNull(target.hostId, 80),
});

const getTargetError = (target: BusinessTarget) => {
  const normalized = normalizeBusinessTarget(target);
  if (normalized.restaurantId && normalized.hostId) {
    return "Choose either a restaurant or a host, not both.";
  }
  if (!normalized.restaurantId && !normalized.hostId) {
    return "Business is required.";
  }
  return null;
};

const jobTargetWhere = (target: BusinessTarget) => {
  const normalized = normalizeBusinessTarget(target);
  return normalized.hostId
    ? eq(jobPostings.hostId, normalized.hostId)
    : eq(jobPostings.restaurantId, String(normalized.restaurantId || ""));
};

const applicationTargetWhere = (target: BusinessTarget) => {
  const normalized = normalizeBusinessTarget(target);
  return normalized.hostId
    ? eq(jobApplications.hostId, normalized.hostId)
    : eq(jobApplications.restaurantId, String(normalized.restaurantId || ""));
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

const requireHostAccess = async (req: any, res: Response, hostId: string) => {
  const userId = String(req.user?.id || "");
  if (!userId) {
    res.status(401).json({ message: "Please sign in first." });
    return false;
  }
  const [host] = await db
    .select({ id: hosts.id, userId: hosts.userId })
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  if (!host) {
    res.status(404).json({ message: "Host profile not found." });
    return false;
  }
  if (String(host.userId) === userId || isStaffOrAdminUser(req.user)) {
    return true;
  }
  res.status(403).json({ message: "You do not have access to this business." });
  return false;
};

const requireBusinessTargetAccess = async (
  req: any,
  res: Response,
  target: BusinessTarget,
) => {
  const normalized = normalizeBusinessTarget(target);
  const targetError = getTargetError(normalized);
  if (targetError) {
    res.status(400).json({ message: targetError });
    return false;
  }
  if (normalized.hostId) {
    return requireHostAccess(req, res, normalized.hostId);
  }
  return requireRestaurantAccess(req, res, String(normalized.restaurantId));
};

const loadBusinessForTarget = async (target: BusinessTarget) => {
  const normalized = normalizeBusinessTarget(target);
  if (normalized.hostId) {
    const [host] = await db
      .select({
        id: hosts.id,
        name: hosts.businessName,
        city: hosts.city,
        state: hosts.state,
      })
      .from(hosts)
      .where(eq(hosts.id, normalized.hostId))
      .limit(1);
    return host || null;
  }
  const [restaurant] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      state: restaurants.state,
    })
    .from(restaurants)
    .where(eq(restaurants.id, String(normalized.restaurantId || "")))
    .limit(1);
  return restaurant || null;
};

async function getPublicJobs(params: {
  restaurantId?: string;
  hostId?: string;
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
    or(
      and(isNotNull(jobPostings.restaurantId), eq(restaurants.isActive, true)),
      isNotNull(jobPostings.hostId),
    )!,
  ];

  if (params.restaurantId) {
    clauses.push(eq(jobPostings.restaurantId, params.restaurantId));
  }
  if (params.hostId) {
    clauses.push(eq(jobPostings.hostId, params.hostId));
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
        ilike(hosts.businessName, term),
      )!,
    );
  }

  const rows = await db
    .select(publicJobSelect)
    .from(jobPostings)
    .leftJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
    .leftJoin(hosts, eq(hosts.id, jobPostings.hostId))
    .where(and(...clauses))
    .orderBy(desc(jobPostings.createdAt))
    .limit(limit);

  return rows.map(decorateJob);
}

async function sendApplicationNotice(params: {
  job: any;
  application: any;
}) {
  const [owner] = params.job.hostId
    ? await db
        .select({
          email: users.email,
          businessName: hosts.businessName,
        })
        .from(hosts)
        .innerJoin(users, eq(users.id, hosts.userId))
        .where(eq(hosts.id, params.job.hostId))
        .limit(1)
    : await db
        .select({
          email: users.email,
          businessName: restaurants.name,
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
      <p><strong>${escapeHtml(params.application.applicantName)}</strong> applied for <strong>${escapeHtml(params.job.title)}</strong> at ${escapeHtml(owner.businessName)}.</p>
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
        hostId: trimToNull(req.query.hostId, 80) || undefined,
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

  app.get("/api/jobs/host/:hostId/open", async (req, res) => {
    try {
      const hostId = String(req.params.hostId || "").trim();
      const jobs = await getPublicJobs({ hostId, limit: 12 });
      res.json({
        jobs,
        activeJob: jobs[0] || null,
        openCount: jobs.length,
      });
    } catch (error) {
      console.error("[jobs] failed to load host jobs:", error);
      res.status(500).json({ message: "Failed to load open jobs" });
    }
  });

  app.get("/api/jobs/:jobId", async (req, res) => {
    try {
      const jobId = String(req.params.jobId || "").trim();
      const [job] = await db
        .select(publicJobSelect)
        .from(jobPostings)
        .leftJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
        .leftJoin(hosts, eq(hosts.id, jobPostings.hostId))
        .where(
          and(
            eq(jobPostings.id, jobId),
            eq(jobPostings.status, "open"),
            openJobWindow(),
            or(
              and(
                isNotNull(jobPostings.restaurantId),
                eq(restaurants.isActive, true),
              ),
              isNotNull(jobPostings.hostId),
            )!,
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
        .leftJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
        .leftJoin(hosts, eq(hosts.id, jobPostings.hostId))
        .where(
          and(
            eq(jobPostings.id, jobId),
            eq(jobPostings.status, "open"),
            openJobWindow(),
            or(
              and(
                isNotNull(jobPostings.restaurantId),
                eq(restaurants.isActive, true),
              ),
              isNotNull(jobPostings.hostId),
            )!,
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
          restaurantId: job.restaurantId || null,
          hostId: job.hostId || null,
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
        const includeHostId = trimToNull(req.query.includeHostId, 80);
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

        const hostClauses = [];
        if (search) {
          const term = `%${search.replace(/[%_]/g, "\\$&")}%`;
          hostClauses.push(
            or(
              ilike(hosts.businessName, term),
              ilike(hosts.locationType, term),
              ilike(hosts.city, term),
              ilike(hosts.state, term),
            )!,
          );
        }

        let hostRows = await db
          .select({
            id: hosts.id,
            name: hosts.businessName,
            businessType: hosts.locationType,
            cuisineType: hosts.locationType,
            city: hosts.city,
            state: hosts.state,
            ownerId: hosts.userId,
            isFoodTruck: sql<boolean>`false`,
            isActive: sql<boolean>`true`,
          })
          .from(hosts)
          .where(hostClauses.length ? and(...hostClauses) : undefined)
          .orderBy(desc(hosts.createdAt))
          .limit(limit);

        if (
          includeHostId &&
          !hostRows.some((row: { id: string }) => row.id === includeHostId)
        ) {
          const [included] = await db
            .select({
              id: hosts.id,
              name: hosts.businessName,
              businessType: hosts.locationType,
              cuisineType: hosts.locationType,
              city: hosts.city,
              state: hosts.state,
              ownerId: hosts.userId,
              isFoodTruck: sql<boolean>`false`,
              isActive: sql<boolean>`true`,
            })
            .from(hosts)
            .where(eq(hosts.id, includeHostId))
            .limit(1);

          if (included) {
            hostRows = [included, ...hostRows].slice(0, limit);
          }
        }

        const businesses = [
          ...rows.map((row: any) => ({
            ...row,
            entityType: "restaurant",
            targetKey: `restaurant:${row.id}`,
          })),
          ...hostRows.map((row: any) => ({
            ...row,
            entityType: "host",
            targetKey: `host:${row.id}`,
          })),
        ];

        return res.json({
          restaurants: rows,
          hosts: hostRows,
          businesses,
          scope: "all",
        });
      }

      const context = await getBusinessAccessContext(String(req.user.id));
      const hostRows = await db
        .select({
          id: hosts.id,
          name: hosts.businessName,
          businessType: hosts.locationType,
          cuisineType: hosts.locationType,
          city: hosts.city,
          state: hosts.state,
          ownerId: hosts.userId,
          isFoodTruck: sql<boolean>`false`,
          isActive: sql<boolean>`true`,
        })
        .from(hosts)
        .where(eq(hosts.userId, String(req.user.id)))
        .orderBy(desc(hosts.createdAt));
      res.json({
        restaurants: context.restaurants,
        hosts: hostRows,
        businesses: [
          ...context.restaurants.map((row: any) => ({
            ...row,
            entityType: "restaurant",
            targetKey: `restaurant:${row.id}`,
          })),
          ...hostRows.map((row: any) => ({
            ...row,
            entityType: "host",
            targetKey: `host:${row.id}`,
          })),
        ],
        scope: "managed",
      });
    } catch (error) {
      console.error("[jobs] failed to load hiring businesses:", error);
      res.status(500).json({ message: "Failed to load businesses" });
    }
  });

  app.get("/api/owner/jobs", isAuthenticated, async (req: any, res) => {
    try {
      const target = normalizeBusinessTarget({
        restaurantId: req.query.restaurantId,
        hostId: req.query.hostId,
      });
      if (!(await requireBusinessTargetAccess(req, res, target))) return;

      const jobs = await db
        .select()
        .from(jobPostings)
        .where(jobTargetWhere(target))
        .orderBy(desc(jobPostings.createdAt));

      const counts = await db
        .select({ jobId: jobApplications.jobId })
        .from(jobApplications)
        .where(applicationTargetWhere(target));
      const countByJob = new Map<string, number>();
      (counts as Array<{ jobId?: string | null }>).forEach((row) => {
        const key = String(row.jobId || "");
        if (!key) return;
        countByJob.set(key, (countByJob.get(key) || 0) + 1);
      });

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
      if (!(await requireBusinessTargetAccess(req, res, payload))) return;

      const business = await loadBusinessForTarget(payload);

      const [job] = await db
        .insert(jobPostings)
        .values({
          ...payload,
          postedByUserId: req.user.id,
          city: payload.city || business?.city || null,
          state: payload.state || business?.state || null,
          locationLabel:
            payload.locationLabel ||
            [business?.city, business?.state].filter(Boolean).join(", ") ||
            null,
        })
        .returning();

      submitJobToIndexNow(job, business?.name, "job-created");
      recordMealScoutCreditAction({
        userId: req.user.id,
        action: "job_post_created",
        sourceId: job.id,
        entityType: payload.hostId ? "host" : "restaurant",
        entityId: payload.hostId || payload.restaurantId || null,
        metadata: {
          title: job.title,
          roleType: job.roleType,
          businessName: business?.name || null,
        },
      }).catch((creditError) => {
        console.error("[credits] failed to record job_post_created:", creditError);
      });
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
        if (!(await requireBusinessTargetAccess(req, res, payload))) return;

        const business = await loadBusinessForTarget(payload);

        const [existing] = await db
          .select()
          .from(jobPostings)
          .where(
            and(
              jobTargetWhere(payload),
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
              city: payload.city || business?.city || null,
              state: payload.state || business?.state || null,
              locationLabel:
                payload.locationLabel ||
                [business?.city, business?.state]
                  .filter(Boolean)
                  .join(", ") ||
                null,
              updatedAt: new Date(),
            })
            .where(eq(jobPostings.id, existing.id))
            .returning();
          submitJobToIndexNow(job, business?.name, "help-wanted-updated");
          return res.json({ job, mode: "updated" });
        }

        const [job] = await db
          .insert(jobPostings)
          .values({
            ...payload,
            postedByUserId: req.user.id,
            city: payload.city || business?.city || null,
            state: payload.state || business?.state || null,
            locationLabel:
              payload.locationLabel ||
              [business?.city, business?.state].filter(Boolean).join(", ") ||
              null,
            description:
              payload.description ||
              `Join the team at ${business?.name || "this MealScout business"}. Share your availability and experience so they can follow up quickly.`,
          })
          .returning();

        submitJobToIndexNow(job, business?.name, "help-wanted-created");
        recordMealScoutCreditAction({
          userId: req.user.id,
          action: "help_wanted_enabled",
          sourceId: job.id,
          entityType: payload.hostId ? "host" : "restaurant",
          entityId: payload.hostId || payload.restaurantId || null,
          metadata: {
            title: job.title,
            roleType: job.roleType,
            businessName: business?.name || null,
          },
        }).catch((creditError) => {
          console.error("[credits] failed to record help_wanted_enabled:", creditError);
        });
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
        const target = normalizeBusinessTarget({
          restaurantId: req.body?.restaurantId,
          hostId: req.body?.hostId,
        });
        if (!(await requireBusinessTargetAccess(req, res, target))) return;
        const business = await loadBusinessForTarget(target);

        const jobsToClose = await db
          .select({
            id: jobPostings.id,
            title: jobPostings.title,
          })
          .from(jobPostings)
          .where(
            and(
              jobTargetWhere(target),
              eq(jobPostings.status, "open"),
            ),
          );

        const closedJobs = await db
          .update(jobPostings)
          .set({ status: "closed", updatedAt: new Date() })
          .where(
            and(
              jobTargetWhere(target),
              eq(jobPostings.status, "open"),
            ),
          )
          .returning({ id: jobPostings.id });

        jobsToClose.forEach((job: { id: string; title: string }) =>
          submitJobToIndexNow(job, business?.name, "help-wanted-closed"),
        );
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
      const target = normalizeBusinessTarget({
        restaurantId: existing.restaurantId,
        hostId: existing.hostId,
      });
      if (!(await requireBusinessTargetAccess(req, res, target))) return;

      const business = await loadBusinessForTarget(target);

      const parsed = jobPayloadSchema.safeParse({
        ...existing,
        ...req.body,
        restaurantId: existing.restaurantId,
        hostId: existing.hostId,
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

      submitJobToIndexNow(job, business?.name, "job-updated");
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
        if (
          !(await requireBusinessTargetAccess(req, res, {
            restaurantId: job.restaurantId,
            hostId: job.hostId,
          }))
        )
          return;

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
          !(await requireBusinessTargetAccess(req, res, {
            restaurantId: existing.restaurantId,
            hostId: existing.hostId,
          }))
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
