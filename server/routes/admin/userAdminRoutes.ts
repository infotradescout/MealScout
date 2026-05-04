import crypto from "crypto";
import type { Express } from "express";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { registerDealAdminRoutes } from "./dealsRoutes";
import { registerVerificationAdminRoutes } from "./verificationRoutes";
import { sanitizeUser } from "../../utils/sanitize";
import { emailService } from "../../emailService";
import { db } from "../../db";
import { logAudit } from "../../auditLogger";
import { ensurePremiumTrialForUserId } from "../../services/premiumTrial";
import {
  populateHostProfile,
  populateRestaurantProfile,
} from "../../services/googleProfileService";
import {
  computeParkingPassQualityFlags,
  isParkingPassPublicReady,
} from "../../services/parkingPassQuality";
import { listParkingPassOccurrences } from "../../services/parkingPassVirtual";
import { runParkingPassIntegrity } from "../../services/parkingPassIntegrity";
import { isSlotWithinHours } from "@shared/parkingPassSlots";
import {
  CLAIM_TYPES,
  CLAIM_STATUS,
  claims,
  deals,
  eventBookings,
  eventSeries,
  events,
  hosts,
  insertEventSchema,
  insertHostSchema,
  insertRestaurantSchema,
  restaurants,
  suppliers,
  truckClaimRequests,
  truckImportListings,
  users,
  verificationRequests,
} from "@shared/schema";
import { ZodError } from "zod";

type DenyStaffEdits = (req: any, res: any) => boolean;
type RequireAdminUser = (req: any, res: any) => boolean;
type BuildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) => string;

const normalizeCuisineTypes = (value: unknown): string | null => {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());
  const unique = Array.from(
    new Set(
      values
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 8),
    ),
  );
  return unique.length ? unique.join(", ") : null;
};
type HostPricingColumnsCheck = {
  hasAll: boolean;
  missing: string[];
};
type GetHostPricingColumnsCheck = () => Promise<HostPricingColumnsCheck>;
type HasHostSpotImageColumn = () => Promise<boolean>;
type ResetHostPricingColumnsCache = () => void;
type IsMissingColumnError = (error: unknown, columnName?: string) => boolean;

export function registerUserAdminRoutes(
  app: Express,
  deps: {
    denyStaffEdits: DenyStaffEdits;
    requireAdminUser: RequireAdminUser;
    buildLocationKey: BuildLocationKey;
    getHostPricingColumnsCheck: GetHostPricingColumnsCheck;
    hasHostSpotImageColumn: HasHostSpotImageColumn;
    resetHostPricingColumnsCache: ResetHostPricingColumnsCache;
    isMissingColumnError: IsMissingColumnError;
  },
) {
  const {
    denyStaffEdits,
    requireAdminUser,
    buildLocationKey,
    getHostPricingColumnsCheck,
    hasHostSpotImageColumn,
    resetHostPricingColumnsCache,
    isMissingColumnError,
  } = deps;

  app.get(
    "/api/admin/event-intake-requests",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rawLimit = Number(req.query?.limit ?? 100);
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(300, Math.trunc(rawLimit)))
          : 100;
        const claimTypeFilter = String(req.query?.claimType || "all").trim();
        const rawVisibilityFilter = String(
          req.query?.visibility || "all",
        ).trim();
        const visibilityFilter =
          rawVisibilityFilter === "public" ||
          rawVisibilityFilter === "private" ||
          rawVisibilityFilter === "unknown"
            ? rawVisibilityFilter
            : "all";

        const claimTypes =
          claimTypeFilter === CLAIM_TYPES.EVENT
            ? [CLAIM_TYPES.EVENT]
            : claimTypeFilter === CLAIM_TYPES.FOOD_TRUCK
              ? [CLAIM_TYPES.FOOD_TRUCK]
              : [CLAIM_TYPES.EVENT, CLAIM_TYPES.FOOD_TRUCK];

        const rows = await db
          .select({
            id: claims.id,
            personId: claims.personId,
            claimType: claims.claimType,
            status: claims.status,
            claimData: claims.claimData,
            metadata: claims.metadata,
            createdAt: claims.createdAt,
            requesterEmail: users.email,
            requesterFirstName: users.firstName,
            requesterLastName: users.lastName,
          })
          .from(claims)
          .leftJoin(users, eq(users.id, claims.personId))
          .where(
            and(
              inArray(claims.claimType, claimTypes as string[]),
              eq(claims.status, "provisional"),
            ),
          )
          .orderBy(desc(claims.createdAt))
          .limit(limit);

        const shaped = rows
          .map((row: any) => {
            const claimData =
              row.claimData && typeof row.claimData === "object"
                ? (row.claimData as Record<string, any>)
                : {};
            const metadata =
              row.metadata && typeof row.metadata === "object"
                ? (row.metadata as Record<string, any>)
                : {};

            const eventVisibilityRaw = String(
              claimData.eventVisibility || "",
            ).toLowerCase();
            const eventVisibility =
              eventVisibilityRaw === "private" ||
              eventVisibilityRaw === "public"
                ? eventVisibilityRaw
                : metadata.discoverableByAllUsers === true
                  ? "public"
                  : metadata.discoverableByAllUsers === false
                    ? "private"
                    : "unknown";

            const requestedTruckCount = Number(
              claimData.requestedTruckCount || claimData.maxTrucks || 0,
            );

            return {
              id: row.id,
              claimType: row.claimType,
              status: row.status,
              createdAt: row.createdAt,
              personId: row.personId,
              requester: {
                email: row.requesterEmail || null,
                name:
                  [row.requesterFirstName, row.requesterLastName]
                    .filter(Boolean)
                    .join(" ") || null,
              },
              eventVisibility,
              discoverableByAllUsers:
                eventVisibility === "public"
                  ? true
                  : eventVisibility === "private"
                    ? false
                    : null,
              requestedTruckCount:
                Number.isFinite(requestedTruckCount) && requestedTruckCount > 0
                  ? requestedTruckCount
                  : null,
              summary: {
                title:
                  String(
                    claimData.eventName ||
                      claimData.occasion ||
                      "Event request",
                  ) || "Event request",
                city: String(claimData.city || "") || null,
                date: String(claimData.date || "") || null,
                expectedCrowd: String(claimData.expectedCrowd || "") || null,
                guestCount: String(claimData.guestCount || "") || null,
              },
              claimData,
              metadata,
            };
          })
          .filter((item: any) => {
            if (visibilityFilter === "all") return true;
            if (visibilityFilter === "unknown") {
              return (
                item.eventVisibility !== "public" &&
                item.eventVisibility !== "private"
              );
            }
            return item.eventVisibility === visibilityFilter;
          });

        res.json({
          ok: true,
          total: shaped.length,
          items: shaped,
        });
      } catch (error: any) {
        console.error("Error fetching event intake requests:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch event intake requests" });
      }
    },
  );

  app.patch(
    "/api/admin/event-intake-requests/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const [existing] = await db
          .select()
          .from(claims)
          .where(eq(claims.id, req.params.id))
          .limit(1);
        if (!existing) {
          return res.status(404).json({ message: "Request not found" });
        }
        if (
          existing.claimType !== CLAIM_TYPES.EVENT &&
          existing.claimType !== CLAIM_TYPES.FOOD_TRUCK
        ) {
          return res.status(400).json({ message: "Unsupported request type" });
        }

        const currentClaimData =
          existing.claimData && typeof existing.claimData === "object"
            ? (existing.claimData as Record<string, any>)
            : {};
        const currentMetadata =
          existing.metadata && typeof existing.metadata === "object"
            ? (existing.metadata as Record<string, any>)
            : {};
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const updates: Record<string, any> = {};
        const setString = (key: string, sourceKey = key) => {
          if (body[sourceKey] !== undefined) {
            updates[key] = String(body[sourceKey] ?? "").trim();
          }
        };

        setString("eventName");
        setString("occasion", "eventName");
        setString("date");
        setString("startTime");
        setString("endTime");
        setString("timeDisplay");
        setString("requestedVendorType");
        setString("requestSummary");
        setString("hostBusinessName");
        setString("address");
        setString("city");
        setString("state");
        setString("zip");
        if (body.requestedTruckCount !== undefined) {
          const requestedTruckCount = Math.max(
            1,
            Math.min(50, Number(body.requestedTruckCount) || 1),
          );
          updates.requestedTruckCount = requestedTruckCount;
          updates.maxTrucks = requestedTruckCount;
        }

        if (body.eventVisibility !== undefined) {
          const eventVisibility =
            String(body.eventVisibility).toLowerCase() === "private"
              ? "private"
              : "public";
          updates.eventVisibility = eventVisibility;
        }

        if (Array.isArray(body.missingFields)) {
          updates.missingFields = body.missingFields
            .map((item: unknown) => String(item || "").trim())
            .filter(Boolean);
        }
        if (Array.isArray(body.requestedDetailsFromTruck)) {
          updates.requestedDetailsFromTruck = body.requestedDetailsFromTruck
            .map((item: unknown) => String(item || "").trim())
            .filter(Boolean);
        }
        if (body.organizer && typeof body.organizer === "object") {
          updates.organizer = {
            ...(currentClaimData.organizer || {}),
            name: String(body.organizer.name || "").trim() || null,
            title: String(body.organizer.title || "").trim() || null,
            phone: String(body.organizer.phone || "").trim() || null,
            email: String(body.organizer.email || "").trim() || null,
          };
        }

        const nextClaimData: Record<string, any> = {
          ...currentClaimData,
          ...updates,
        };
        const eventVisibility = String(
          nextClaimData.eventVisibility || "",
        ).toLowerCase();
        const nextMetadata = {
          ...currentMetadata,
          discoverableByAllUsers:
            eventVisibility === "public"
              ? true
              : eventVisibility === "private"
                ? false
                : currentMetadata.discoverableByAllUsers,
          updatedBy: req.user?.id || req.user?.claims?.sub || null,
          updatedAt: new Date().toISOString(),
        };

        const [updated] = await db
          .update(claims)
          .set({ claimData: nextClaimData, metadata: nextMetadata })
          .where(eq(claims.id, existing.id))
          .returning();

        await logAudit(
          String(req.user?.id || req.user?.claims?.sub || ""),
          "admin_event_intake_updated",
          "claim",
          String(existing.id),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            claimType: existing.claimType,
            eventVisibility: nextClaimData.eventVisibility || null,
          },
        ).catch(() => {});

        res.json({ ok: true, item: updated });
      } catch (error: any) {
        console.error("Error updating event intake request:", error);
        res
          .status(500)
          .json({ message: "Failed to update event intake request" });
      }
    },
  );

  app.post(
    "/api/admin/event-intake-requests/:id/publish",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const [existing] = await db
          .select()
          .from(claims)
          .where(eq(claims.id, req.params.id))
          .limit(1);
        if (!existing) {
          return res.status(404).json({ message: "Request not found" });
        }
        if (existing.claimType !== CLAIM_TYPES.EVENT) {
          return res.status(400).json({
            message: "Only organizer event requests can be published as events.",
          });
        }

        const currentClaimData =
          existing.claimData && typeof existing.claimData === "object"
            ? (existing.claimData as Record<string, any>)
            : {};
        const currentMetadata =
          existing.metadata && typeof existing.metadata === "object"
            ? (existing.metadata as Record<string, any>)
            : {};
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const nextClaimData: Record<string, any> = {
          ...currentClaimData,
          eventName: String(
            body.eventName ?? currentClaimData.eventName ?? currentClaimData.occasion ?? "",
          ).trim(),
          occasion: String(
            body.eventName ?? currentClaimData.occasion ?? currentClaimData.eventName ?? "",
          ).trim(),
          date: String(body.date ?? currentClaimData.date ?? "").trim(),
          startTime: String(body.startTime ?? currentClaimData.startTime ?? "").trim(),
          endTime: String(body.endTime ?? currentClaimData.endTime ?? "").trim(),
          eventVisibility: "public",
          requestedVendorType: String(
            body.requestedVendorType ?? currentClaimData.requestedVendorType ?? "",
          ).trim(),
          requestedTruckCount: Math.max(
            1,
            Math.min(
              50,
              Number(body.requestedTruckCount ?? currentClaimData.requestedTruckCount ?? currentClaimData.maxTrucks ?? 1) || 1,
            ),
          ),
          maxTrucks: Math.max(
            1,
            Math.min(
              50,
              Number(body.requestedTruckCount ?? currentClaimData.maxTrucks ?? 1) || 1,
            ),
          ),
          requestSummary: String(
            body.requestSummary ?? currentClaimData.requestSummary ?? "",
          ).trim(),
          hostBusinessName: String(
            body.hostBusinessName ?? currentClaimData.hostBusinessName ?? "Event host",
          ).trim(),
          address: String(body.address ?? currentClaimData.address ?? "").trim(),
          city: String(body.city ?? currentClaimData.city ?? "").trim(),
          state: String(body.state ?? currentClaimData.state ?? "").trim(),
          zip: String(body.zip ?? currentClaimData.zip ?? "").trim(),
        };

        if (
          !nextClaimData.eventName ||
          !nextClaimData.date ||
          !nextClaimData.startTime ||
          !nextClaimData.endTime ||
          !nextClaimData.address ||
          !nextClaimData.city ||
          !nextClaimData.state
        ) {
          return res.status(400).json({
            message:
              "Add event name, date, start/end time, address, city, and state before publishing.",
          });
        }

        if (nextClaimData.endTime <= nextClaimData.startTime) {
          return res.status(400).json({
            message: "End time must be after start time.",
          });
        }

        const eventDate = new Date(nextClaimData.date);
        if (Number.isNaN(eventDate.getTime())) {
          return res.status(400).json({
            message: "Add a valid event date before publishing.",
          });
        }

        let host = nextClaimData.hostId
          ? await storage.getHost(String(nextClaimData.hostId)).catch(() => undefined)
          : undefined;
        const ownerUserId = String(existing.personId || req.user?.id || req.user?.claims?.sub || "");
        if (!host && ownerUserId) {
          host = await storage.getHostByUserId(ownerUserId).catch(() => undefined);
        }
        if (!host) {
          const hostInput = insertHostSchema.parse({
            userId: ownerUserId || String(req.user?.id || req.user?.claims?.sub || ""),
            businessName: nextClaimData.hostBusinessName || "Event host",
            address: nextClaimData.address,
            city: nextClaimData.city,
            state: nextClaimData.state,
            contactPhone: nextClaimData.organizer?.phone || null,
            locationType: "event_coordinator",
            spotCount: Number(nextClaimData.maxTrucks || 1),
          });
          host = await storage.createHost(hostInput);
        }

        if (!host) {
          return res.status(500).json({ message: "Failed to prepare host" });
        }

        const eventInput = insertEventSchema.parse({
          hostId: host.id,
          coordinatorUserId: ownerUserId || null,
          name: nextClaimData.eventName,
          description:
            nextClaimData.requestSummary ||
            `Seeking ${nextClaimData.requestedVendorType || "food truck"} vendors.`,
          date: eventDate,
          startTime: nextClaimData.startTime,
          endTime: nextClaimData.endTime,
          maxTrucks: Number(nextClaimData.maxTrucks || 1),
          hardCapEnabled: false,
          eventType: "event",
          requiresPayment: false,
        });
        const event = await storage.createEvent(eventInput);

        const nextMetadata = {
          ...currentMetadata,
          discoverableByAllUsers: true,
          publishedEventId: event.id,
          publishedBy: req.user?.id || req.user?.claims?.sub || null,
          publishedAt: new Date().toISOString(),
        };

        await db
          .update(claims)
          .set({
            status: CLAIM_STATUS.VERIFIED,
            claimData: { ...nextClaimData, hostId: host.id, publishedEventId: event.id },
            metadata: nextMetadata,
          })
          .where(eq(claims.id, existing.id));

        await logAudit(
          String(req.user?.id || req.user?.claims?.sub || ""),
          "admin_event_intake_published",
          "event",
          String(event.id),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          { claimId: existing.id, hostId: host.id },
        ).catch(() => {});

        res.status(201).json({ ok: true, event });
      } catch (error: any) {
        console.error("Error publishing event intake request:", error);
        res.status(500).json({ message: "Failed to publish event" });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/resend-verification",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!user.email) {
          return res.status(400).json({ message: "User has no email address" });
        }
        if (user.emailVerified) {
          return res.status(400).json({ message: "Email is already verified" });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await storage.createEmailVerificationToken({
          userId: user.id,
          tokenHash,
          expiresAt,
          requestIp: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.get("User-Agent") || undefined,
        });

        const apiBaseUrl =
          `${req.protocol}://${req.get("host")}` ||
          process.env.PUBLIC_BASE_URL ||
          "http://localhost:5000";
        const verifyUrl = `${apiBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(
          token,
        )}`;

        await emailService.sendEmailVerificationEmail(user, verifyUrl);

        res.json({ message: "Verification email sent" });
      } catch (error: any) {
        console.error("Error resending verification email:", error);
        res.status(500).json({
          message: error.message || "Failed to resend verification email",
        });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/verify",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (!requireAdminUser(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const updated = await storage.updateUser(user.id, {
          emailVerified: true,
        });
        res.json(sanitizeUser(updated, { includeStripe: true }));
      } catch (error: any) {
        console.error("Error verifying user:", error);
        res.status(500).json({
          message: error.message || "Failed to verify user",
        });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/send-subscription-link",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        if (!user.email) {
          return res.status(400).json({ message: "User has no email address" });
        }

        const baseUrl =
          process.env.CLIENT_ORIGIN ||
          process.env.PUBLIC_BASE_URL ||
          "http://localhost:5000";
        const subscribeUrl = `${baseUrl}/subscribe`;
        const subject = "MealScout Monthly Subscription";
        const html = `
          <p>Hi ${user.firstName || "there"},</p>
          <p>Use the link below to sign up for MealScout monthly subscriptions:</p>
          <p><a href="${subscribeUrl}">Subscribe now</a></p>
          <p>If the link doesn't work, copy and paste this URL:</p>
          <p>${subscribeUrl}</p>
        `;
        const text = `Use this link to sign up for MealScout monthly subscriptions: ${subscribeUrl}`;

        await emailService.sendBasicEmail(user.email, subject, html, text);
        res.json({ message: "Subscription link sent" });
      } catch (error: any) {
        console.error("Error sending subscription link:", error);
        res.status(500).json({
          message: error.message || "Failed to send subscription link",
        });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        const {
          email,
          firstName,
          lastName,
          phone,
          postalCode,
          birthYear,
          gender,
          isActive,
          emailVerified,
          userType,
          profileVisibility,
          customDomainHost,
        } = req.body || {};

        const updates: any = {};
        if (email !== undefined) {
          updates.email = String(email).trim().toLowerCase();
        }
        if (firstName !== undefined) {
          updates.firstName = String(firstName).trim();
        }
        if (lastName !== undefined) {
          updates.lastName = String(lastName).trim();
        }
        if (phone !== undefined) {
          updates.phone = String(phone).trim();
        }
        if (postalCode !== undefined) {
          updates.postalCode = String(postalCode).trim();
        }
        if (birthYear !== undefined && birthYear !== null && birthYear !== "") {
          updates.birthYear = Number(birthYear);
        }
        if (gender !== undefined) {
          updates.gender = String(gender).trim() || null;
        }
        if (isActive !== undefined) {
          updates.isActive = Boolean(isActive);
        }
        if (emailVerified !== undefined) {
          updates.emailVerified = Boolean(emailVerified);
        }

        const currentAccountSettings =
          user.accountSettings && typeof user.accountSettings === "object"
            ? ({ ...(user.accountSettings as any) } as Record<string, any>)
            : {};
        const accountSettingsUpdates: Record<string, any> = {};
        if (profileVisibility !== undefined) {
          const visibility = String(profileVisibility || "")
            .trim()
            .toLowerCase();
          if (!["public", "private", "connections"].includes(visibility)) {
            return res.status(400).json({
              message:
                "Invalid profile visibility. Use public, private, or connections.",
            });
          }
          accountSettingsUpdates.privacy = {
            ...(currentAccountSettings.privacy || {}),
            profileVisibility: visibility,
          };
        }
        if (customDomainHost !== undefined) {
          const hostname = String(customDomainHost || "")
            .trim()
            .toLowerCase();
          if (
            hostname &&
            !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)
          ) {
            return res.status(400).json({
              message: "Invalid custom domain hostname.",
            });
          }

          const [restaurantRow, hostRow, supplierRow] = await Promise.all([
            db
              .select({ id: restaurants.id })
              .from(restaurants)
              .where(eq(restaurants.ownerId, userId))
              .limit(1),
            db
              .select({ id: hosts.id })
              .from(hosts)
              .where(eq(hosts.userId, userId))
              .limit(1),
            db
              .select({ id: suppliers.id })
              .from(suppliers)
              .where(eq(suppliers.userId, userId))
              .limit(1),
          ]);
          const hasBusinessProfile =
            restaurantRow.length > 0 ||
            hostRow.length > 0 ||
            supplierRow.length > 0;
          if (!hasBusinessProfile) {
            return res.status(400).json({
              message:
                "Custom domain can only be set for users with a business profile.",
            });
          }

          accountSettingsUpdates.customDomain = {
            ...(currentAccountSettings.customDomain || {}),
            hostname,
            status: hostname
              ? String(currentAccountSettings.customDomain?.status || "unverified")
              : "unverified",
            lastCheckedAt: hostname
              ? currentAccountSettings.customDomain?.lastCheckedAt || null
              : null,
            expectedTarget: hostname
              ? currentAccountSettings.customDomain?.expectedTarget || null
              : null,
            diagnostics: hostname
              ? currentAccountSettings.customDomain?.diagnostics || null
              : null,
          };
        }
        if (Object.keys(accountSettingsUpdates).length > 0) {
          updates.accountSettings = {
            ...currentAccountSettings,
            ...accountSettingsUpdates,
          };
        }

        if (userType) {
          const allowedTypes = [
            "customer",
            "restaurant_owner",
            "caterer",
            "food_truck",
            "supplier",
            "host",
            "event_coordinator",
            "staff",
            "admin",
            "super_admin",
          ];
          if (!allowedTypes.includes(userType)) {
            return res.status(400).json({ message: "Invalid user type" });
          }
          if (req.user?.userType === "staff") {
            if (userType === "admin" || userType === "super_admin") {
              return res.status(403).json({
                message: "Staff cannot assign admin roles",
              });
            }
          }
          await storage.updateUserType(userId, userType);
        }

        if (updates.email) {
          const [existingByEmail] = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                sql`lower(${users.email}) = ${updates.email}`,
                ne(users.id, userId),
              ),
            )
            .limit(1);
          if (existingByEmail) {
            return res.status(409).json({ message: "Email already in use" });
          }
        }

        const updated = Object.keys(updates).length
          ? await storage.updateUser(userId, updates)
          : await storage.getUser(userId);

        if (!updated) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(sanitizeUser(updated, { includeStripe: true }));
      } catch (error: any) {
        console.error("Error updating user info:", error);
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "Email or phone already in use",
          });
        }
        res.status(500).json({
          message: error.message || "Failed to update user",
        });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/parking-pass",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hosts = await storage.getHostsByUserId(req.params.id);
        if (!hosts.length) {
          return res.json([]);
        }

        // Ensure every host has a draft Parking Pass series so pricing can be edited.
        await Promise.all(
          hosts.map((host) => storage.ensureDraftParkingPassForHost(host.id)),
        );

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const hostIds = hosts.map((host) => host.id);
        const { occurrences } = await listParkingPassOccurrences({
          hostIds,
          horizonDays: 30,
          includeDraft: true,
          start: today,
        });

        const occurrencesByHost = new Map<string, any[]>();
        for (const row of occurrences) {
          const list = occurrencesByHost.get(row.hostId) ?? [];
          list.push(row);
          occurrencesByHost.set(row.hostId, list);
        }

        const listings = hosts.flatMap((host) => {
          const hostOccurrences = occurrencesByHost.get(host.id) ?? [];
          if (!hostOccurrences.length) return [];
          const sorted = [...hostOccurrences].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          const upcoming = sorted.find(
            (event) => new Date(event.date) >= today,
          );
          const representative = upcoming ?? sorted[0];

          return [
            {
              ...representative,
              host,
              nextDate: upcoming?.date ?? representative.date,
              occurrenceCount: sorted.length,
              publicReady: isParkingPassPublicReady(representative),
              qualityFlags: computeParkingPassQualityFlags(representative),
            },
          ];
        });

        res.json(listings);
      } catch (error) {
        console.error("Error fetching parking pass listings:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch parking pass listings" });
      }
    },
  );

  app.patch(
    "/api/admin/parking-pass/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const eventId = req.params.id;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Parking pass not found" });
        }
        const host = event.hostId ? await storage.getHost(event.hostId) : null;

        const updates: any = {};
        const fields = [
          "startTime",
          "endTime",
          "maxTrucks",
          "status",
          "breakfastPriceCents",
          "lunchPriceCents",
          "dinnerPriceCents",
          "dailyPriceCents",
          "weeklyPriceCents",
          "monthlyPriceCents",
        ];
        for (const field of fields) {
          if (req.body?.[field] === undefined) continue;
          if (
            field === "startTime" ||
            field === "endTime" ||
            field === "status"
          ) {
            updates[field] = req.body[field];
          } else {
            updates[field] = Number(req.body[field]);
          }
        }

        if (updates.startTime && updates.endTime) {
          const [startHour, startMinute] = String(updates.startTime)
            .split(":")
            .map(Number);
          const [endHour, endMinute] = String(updates.endTime)
            .split(":")
            .map(Number);
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = endHour * 60 + endMinute;
          if (endMinutes <= startMinutes) {
            return res
              .status(400)
              .json({ message: "End time must be after start time" });
          }
        }

        if (updates.maxTrucks !== undefined && updates.maxTrucks < 1) {
          return res
            .status(400)
            .json({ message: "Max trucks must be at least 1" });
        }

        const breakfast = Number(
          updates.breakfastPriceCents ?? event.breakfastPriceCents ?? 0,
        );
        const lunch = Number(
          updates.lunchPriceCents ?? event.lunchPriceCents ?? 0,
        );
        const dinner = Number(
          updates.dinnerPriceCents ?? event.dinnerPriceCents ?? 0,
        );
        const dailyExisting = Number(event.dailyPriceCents ?? 0);
        const weeklyExisting = Number(event.weeklyPriceCents ?? 0);
        const monthlyExisting = Number(event.monthlyPriceCents ?? 0);
        const dailyCandidate =
          updates.dailyPriceCents !== undefined
            ? Number(updates.dailyPriceCents)
            : dailyExisting;
        const weeklyCandidate =
          updates.weeklyPriceCents !== undefined
            ? Number(updates.weeklyPriceCents)
            : weeklyExisting;
        const monthlyCandidate =
          updates.monthlyPriceCents !== undefined
            ? Number(updates.monthlyPriceCents)
            : monthlyExisting;
        const slotSum = breakfast + lunch + dinner;
        const dailyOverride =
          updates.dailyPriceCents !== undefined
            ? Number(updates.dailyPriceCents)
            : null;
        const weeklyOverride =
          updates.weeklyPriceCents !== undefined
            ? Number(updates.weeklyPriceCents)
            : null;
        const monthlyOverride =
          updates.monthlyPriceCents !== undefined
            ? Number(updates.monthlyPriceCents)
            : null;
        let baseDaily =
          dailyOverride ??
          (slotSum > 0 ? slotSum : (event.dailyPriceCents ?? 0));
        if (baseDaily <= 0) {
          if (weeklyOverride && weeklyOverride > 0) {
            baseDaily = Math.round(weeklyOverride / 7);
          } else if (monthlyOverride && monthlyOverride > 0) {
            baseDaily = Math.round(monthlyOverride / 30);
          }
        }
        const hostPriceCents = slotSum > 0 ? slotSum : baseDaily;
        const pricingUpdates = {
          hostPriceCents: hostPriceCents || event.hostPriceCents || 0,
          dailyPriceCents: baseDaily,
          weeklyPriceCents:
            weeklyOverride ??
            (baseDaily > 0 ? baseDaily * 7 : (event.weeklyPriceCents ?? 0)),
          monthlyPriceCents:
            monthlyOverride ??
            (baseDaily > 0 ? baseDaily * 30 : (event.monthlyPriceCents ?? 0)),
          requiresPayment: true,
          updatedAt: new Date(),
        };

        if (event.seriesId) {
          const seriesUpdates: any = { updatedAt: new Date() };
          if (updates.startTime !== undefined) {
            seriesUpdates.defaultStartTime = String(updates.startTime);
          }
          if (updates.endTime !== undefined) {
            seriesUpdates.defaultEndTime = String(updates.endTime);
          }
          if (updates.maxTrucks !== undefined) {
            seriesUpdates.defaultMaxTrucks = Number(updates.maxTrucks);
          }
          const pricingTouched = [
            "breakfastPriceCents",
            "lunchPriceCents",
            "dinnerPriceCents",
            "dailyPriceCents",
            "weeklyPriceCents",
            "monthlyPriceCents",
          ].some((field) => req.body?.[field] !== undefined);
          if (pricingTouched) {
            seriesUpdates.defaultBreakfastPriceCents = breakfast;
            seriesUpdates.defaultLunchPriceCents = lunch;
            seriesUpdates.defaultDinnerPriceCents = dinner;
            seriesUpdates.defaultDailyPriceCents = baseDaily;
            seriesUpdates.defaultWeeklyPriceCents =
              pricingUpdates.weeklyPriceCents;
            seriesUpdates.defaultMonthlyPriceCents =
              pricingUpdates.monthlyPriceCents;
            seriesUpdates.defaultHostPriceCents = hostPriceCents;

            // Simple model: mirror Parking Pass defaults back onto the host row as the source of truth.
            // This is best-effort because older DBs may not have these columns yet.
            try {
              if (host?.id) {
                await db
                  .update(hosts)
                  .set({
                    parkingPassBreakfastPriceCents: breakfast,
                    parkingPassLunchPriceCents: lunch,
                    parkingPassDinnerPriceCents: dinner,
                    parkingPassDailyPriceCents: baseDaily,
                    parkingPassWeeklyPriceCents:
                      pricingUpdates.weeklyPriceCents,
                    parkingPassMonthlyPriceCents:
                      pricingUpdates.monthlyPriceCents,
                    parkingPassStartTime: String(
                      updates.startTime ?? event.startTime ?? "",
                    ),
                    parkingPassEndTime: String(
                      updates.endTime ?? event.endTime ?? "",
                    ),
                    updatedAt: new Date(),
                  } as any)
                  .where(eq(hosts.id, host.id));
              }
            } catch (e) {
              console.warn("Failed to persist host parking pass defaults:", e);
            }

            const publicReady =
              host &&
              isParkingPassPublicReady({
                host,
                startTime: updates.startTime ?? event.startTime,
                endTime: updates.endTime ?? event.endTime,
                maxTrucks: updates.maxTrucks ?? event.maxTrucks,
                breakfastPriceCents: breakfast,
                lunchPriceCents: lunch,
                dinnerPriceCents: dinner,
                dailyPriceCents: baseDaily,
                weeklyPriceCents: pricingUpdates.weeklyPriceCents,
                monthlyPriceCents: pricingUpdates.monthlyPriceCents,
              });

            seriesUpdates.status = publicReady ? "published" : "draft";
            seriesUpdates.publishedAt = publicReady ? new Date() : null;
          }
          if (Object.keys(seriesUpdates).length > 1) {
            await db
              .update(eventSeries)
              .set(seriesUpdates)
              .where(eq(eventSeries.id, event.seriesId));
          }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const scope = event.seriesId
          ? eq(events.seriesId, event.seriesId)
          : eq(events.hostId, event.hostId);

        const updatedEvents = await db
          .update(events)
          .set({ ...updates, ...pricingUpdates })
          .where(
            and(
              scope,
              gte(events.date, today),
              eq(events.requiresPayment, true),
            ),
          )
          .returning();

        let updated = updatedEvents[0];
        if (!updated) {
          const [singleUpdated] = await db
            .update(events)
            .set({ ...updates, ...pricingUpdates })
            .where(eq(events.id, eventId))
            .returning();
          updated = singleUpdated;
        }

        void logAudit(
          req.user?.id || "",
          "admin_parking_pass_updated",
          "parking_pass",
          String(eventId),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            seriesId: event.seriesId,
            hostId: event.hostId,
            fields: Object.keys(updates),
            pricingFields: Object.keys(pricingUpdates),
          },
        ).catch((err) =>
          console.error("Failed to write admin parking pass audit log:", err),
        );

        res.json(updated ?? event);
      } catch (error: any) {
        console.error("Error updating parking pass:", error);
        res.status(500).json({
          message: error.message || "Failed to update parking pass",
        });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/backfill",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        // Ensures every host row has a draft parking pass series, so pricing can be edited immediately.
        const created = await storage.ensureDraftParkingPassesForHosts();
        res.json({ success: true, created });
      } catch (error: any) {
        console.error("Error backfilling parking pass series:", error);
        res
          .status(500)
          .json({ message: "Failed to backfill parking pass series" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/sync-host-defaults",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const seriesRows = await storage.getParkingPassSeriesSafe();
        let updatedHosts = 0;
        const touchedHostIds = new Set<string>();

        for (const series of seriesRows as any[]) {
          const hostId = String(series?.hostId || "").trim();
          if (!hostId) continue;

          const breakfast =
            Number(series?.defaultBreakfastPriceCents ?? 0) || 0;
          const lunch = Number(series?.defaultLunchPriceCents ?? 0) || 0;
          const dinner = Number(series?.defaultDinnerPriceCents ?? 0) || 0;
          const daily = Number(series?.defaultDailyPriceCents ?? 0) || 0;
          const weekly = Number(series?.defaultWeeklyPriceCents ?? 0) || 0;
          const monthly = Number(series?.defaultMonthlyPriceCents ?? 0) || 0;

          try {
            await db
              .update(hosts)
              .set({
                parkingPassBreakfastPriceCents: breakfast,
                parkingPassLunchPriceCents: lunch,
                parkingPassDinnerPriceCents: dinner,
                parkingPassDailyPriceCents: daily,
                parkingPassWeeklyPriceCents: weekly,
                parkingPassMonthlyPriceCents: monthly,
                parkingPassStartTime: series?.defaultStartTime ?? null,
                parkingPassEndTime: series?.defaultEndTime ?? null,
                parkingPassDaysOfWeek: series?.parkingPassDaysOfWeek ?? [],
                updatedAt: new Date(),
              } as any)
              .where(eq(hosts.id, hostId));
            updatedHosts += 1;
            touchedHostIds.add(hostId);
          } catch (e: any) {
            // If the migration hasn't run yet, fail with a clear message.
            const msg = String(e?.message || "");
            if (msg.includes("parking_pass_breakfast_price_cents")) {
              return res.status(503).json({
                message:
                  "Host parking pass pricing columns are missing. Run migration 071_add_hosts_parking_pass_pricing.sql and retry.",
                code: "migration_required",
              });
            }
            console.warn("sync-host-defaults: failed updating host:", e);
          }
        }

        // Ensure series status reflects host defaults.
        let syncedSeries = 0;
        for (const hostId of touchedHostIds) {
          const seriesId = await storage.syncParkingPassSeriesFromHost(hostId);
          if (seriesId) syncedSeries += 1;
        }

        res.json({
          success: true,
          updatedHosts,
          syncedSeries,
        });
      } catch (error: any) {
        console.error("Error syncing host parking pass defaults:", error);
        res
          .status(500)
          .json({ message: "Failed to sync host parking pass defaults" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/normalize-series",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        let rows: Array<{ series: any }> = [];
        try {
          rows = await db
            .select({ series: eventSeries })
            .from(eventSeries)
            .where(eq(eventSeries.seriesType, "parking_pass"));
        } catch (error) {
          // Degrade gracefully if event_series schema drifts (Drizzle selects all columns).
          console.warn(
            "normalize-series: falling back to safe event_series projection:",
            error,
          );
          const safe = await storage.getParkingPassSeriesSafe();
          rows = safe.map((series: any) => ({ series }));
        }

        const hostIds = Array.from(
          new Set<string>(
            rows
              .map((row: any) => String(row.series?.hostId || "").trim())
              .filter(Boolean),
          ),
        );
        const hostRows = await storage.getHostsByIds(hostIds);
        const hostById = new Map<string, any>(
          (hostRows || []).map((host: any) => [host.id, host]),
        );

        let updated = 0;
        for (const row of rows as any[]) {
          const series = row.series;
          const host = hostById.get(String(series.hostId || "").trim()) ?? null;
          const listing = {
            host,
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            breakfastPriceCents: series.defaultBreakfastPriceCents,
            lunchPriceCents: series.defaultLunchPriceCents,
            dinnerPriceCents: series.defaultDinnerPriceCents,
            dailyPriceCents: series.defaultDailyPriceCents,
            weeklyPriceCents: series.defaultWeeklyPriceCents,
            monthlyPriceCents: series.defaultMonthlyPriceCents,
          };
          const publicReady = isParkingPassPublicReady(listing);
          const nextStatus = publicReady ? "published" : "draft";

          if (String(series.status) !== nextStatus) {
            await db
              .update(eventSeries)
              .set({
                status: nextStatus as any,
                publishedAt: publicReady
                  ? (series.publishedAt ?? new Date())
                  : null,
                updatedAt: new Date(),
              })
              .where(eq(eventSeries.id, series.id));
            updated += 1;
          }
        }

        res.json({ success: true, updated });
      } catch (error: any) {
        console.error("Error normalizing parking pass series:", error);
        res
          .status(500)
          .json({ message: "Failed to normalize parking pass series" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/integrity/run",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const dryRun = Boolean(req.body?.dryRun);
        const result = await runParkingPassIntegrity({ dryRun });
        res.json({ success: true, ...result });
      } catch (error: any) {
        console.error("Error running parking pass integrity:", error);
        res.status(500).json({ message: "Failed to run integrity job" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const { isActive } = req.body;
        await storage.updateUserStatus(req.params.id, isActive);
        res.json({ message: "User status updated successfully" });
      } catch (error) {
        console.error("Error updating user status:", error);
        res.status(500).json({ message: "Failed to update user status" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:id/type",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const { userType } = req.body;
        const allowedTypes = [
          "customer",
          "restaurant_owner",
          "caterer",
          "food_truck",
          "supplier",
          "host",
          "event_coordinator",
          "staff",
          "admin",
          "super_admin",
        ];

        if (!allowedTypes.includes(userType)) {
          return res.status(400).json({ message: "Invalid user type" });
        }

        await storage.updateUserType(req.params.id, userType);
        res.json({ message: "User type updated successfully" });
      } catch (error) {
        console.error("Error updating user type:", error);
        res.status(500).json({ message: "Failed to update user type" });
      }
    },
  );

  app.get(
    "/api/admin/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        // Enrich hosts with their rep (user) for admin tooling.
        // If the join fails due to schema drift, fall back to plain hosts.
        try {
          const rows = await db
            .select({
              host: hosts,
              user: users,
            })
            .from(hosts)
            .leftJoin(users, eq(hosts.userId, users.id))
            .orderBy(desc(hosts.createdAt));

          const referrerIds = Array.from(
            new Set<string>(
              rows
                .flatMap((row: any) => [
                  row?.user?.affiliateCloserUserId,
                  row?.user?.affiliateBookerUserId,
                ])
                .filter(
                  (value: any) =>
                    typeof value === "string" && value.trim().length > 0,
                ),
            ),
          );
          const referrerById = new Map<string, any>();
          if (referrerIds.length > 0) {
            const referrers = await db
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
                phone: users.phone,
                userType: users.userType,
                affiliateTag: users.affiliateTag,
              })
              .from(users)
              .where(inArray(users.id, referrerIds));
            for (const u of referrers as any[]) {
              referrerById.set(String(u.id), u);
            }
          }

          res.json(
            rows.map((row: any) => ({
              ...row.host,
              rep: row.user
                ? {
                    id: row.user.id,
                    firstName: row.user.firstName,
                    lastName: row.user.lastName,
                    email: row.user.email,
                    phone: row.user.phone,
                    userType: row.user.userType,
                    affiliateTag: row.user.affiliateTag,
                    affiliateCloserUserId: row.user.affiliateCloserUserId,
                    affiliateBookerUserId: row.user.affiliateBookerUserId,
                    referredByCloser: row.user.affiliateCloserUserId
                      ? (referrerById.get(
                          String(row.user.affiliateCloserUserId),
                        ) ?? null)
                      : null,
                    referredByBooker: row.user.affiliateBookerUserId
                      ? (referrerById.get(
                          String(row.user.affiliateBookerUserId),
                        ) ?? null)
                      : null,
                  }
                : null,
            })),
          );
          return;
        } catch (e) {
          console.warn("/api/admin/hosts join fallback:", e);
        }

        const allHosts = await storage.getAllHosts();
        res.json(allHosts);
      } catch (error) {
        console.error("Error fetching hosts:", error);
        res.status(500).json({ message: "Failed to fetch hosts" });
      }
    },
  );

  app.patch(
    "/api/admin/hosts/:hostId/coordinates",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostId = req.params.hostId;
        const lat = Number(req.body?.latitude);
        const lng = Number(req.body?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return res.status(400).json({ message: "Invalid coordinates" });
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return res.status(400).json({ message: "Invalid coordinates" });
        }

        const updated = await storage.updateHostCoordinates(hostId, lat, lng);
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating host coordinates:", error);
        res.status(500).json({ message: "Failed to update coordinates" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        await storage.deleteUser(req.params.id);
        res.json({ message: "User deleted successfully" });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ message: "Failed to delete user" });
      }
    },
  );

  app.get(
    "/api/admin/users/:userId/addresses",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const addresses = await storage.getUserAddresses(req.params.userId);
        res.json(addresses);
      } catch (error) {
        console.error("Error fetching user addresses:", error);
        res.status(500).json({ message: "Failed to fetch user addresses" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/addresses",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const address = await storage.createUserAddress({
          userId: req.params.userId,
          label: req.body?.label || "Address",
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          postalCode: req.body?.postalCode,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          type: req.body?.type || "other",
          isDefault: !!req.body?.isDefault,
        });

        if (req.body?.isDefault) {
          await storage.setDefaultAddress(req.params.userId, address.id);
        }
        await storage.syncHostFromUserAddress(
          req.params.userId,
          address,
          undefined,
          {
            force: true,
          },
        );

        res.json(address);
      } catch (error: any) {
        console.error("Error creating user address:", error);
        res.status(500).json({ message: "Failed to create address" });
      }
    },
  );

  app.patch(
    "/api/admin/users/:userId/addresses/:addressId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const existing = await storage.getUserAddress(req.params.addressId);
        const updated = await storage.updateUserAddress(req.params.addressId, {
          label: req.body?.label,
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          postalCode: req.body?.postalCode,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          type: req.body?.type,
        });

        if (req.body?.isDefault) {
          await storage.setDefaultAddress(req.params.userId, updated.id);
        }
        if (existing) {
          await storage.syncHostFromUserAddress(
            req.params.userId,
            updated,
            existing,
            { force: true },
          );
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating user address:", error);
        res.status(500).json({ message: "Failed to update address" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/addresses/:addressId/default",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        await storage.setDefaultAddress(
          req.params.userId,
          req.params.addressId,
        );
        res.json({ message: "Default address updated" });
      } catch (error) {
        console.error("Error setting default address:", error);
        res.status(500).json({ message: "Failed to set default address" });
      }
    },
  );

  app.delete(
    "/api/admin/users/:userId/addresses/:addressId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const existing = await storage.getUserAddress(req.params.addressId);
        await storage.deleteUserAddress(req.params.addressId);
        if (existing) {
          await storage.deleteHostForUserAddress(req.params.userId, existing);
        }
        res.json({ message: "Address deleted" });
      } catch (error) {
        console.error("Error deleting user address:", error);
        res.status(500).json({ message: "Failed to delete address" });
      }
    },
  );

  app.post(
    "/api/admin/users/:userId/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = req.params.userId;
        const address = req.body?.address?.trim();
        const businessName = req.body?.businessName?.trim();

        if (!businessName || !address) {
          return res.status(400).json({
            message: "Business name and address are required.",
          });
        }

        const city = req.body?.city?.trim() || null;
        const state = req.body?.state?.trim() || null;
        const newKey = buildLocationKey(address, city, state);
        const existingHosts = await db
          .select({
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
          })
          .from(hosts)
          .where(eq(hosts.userId, userId));
        const hasDuplicate = existingHosts.some(
          (host: (typeof existingHosts)[number]) =>
            buildLocationKey(host.address, host.city, host.state) === newKey,
        );
        if (hasDuplicate) {
          return res.status(409).json({
            message: "This user already has a host location for that address.",
          });
        }

        const expectedFootTraffic =
          req.body?.expectedFootTraffic !== undefined &&
          req.body?.expectedFootTraffic !== null &&
          req.body?.expectedFootTraffic !== ""
            ? Number(req.body.expectedFootTraffic)
            : undefined;
        const spotCount =
          req.body?.spotCount !== undefined &&
          req.body?.spotCount !== null &&
          req.body?.spotCount !== ""
            ? Number(req.body.spotCount)
            : undefined;

        const parsed = insertHostSchema.parse({
          userId,
          businessName,
          address,
          city,
          state,
          locationType: req.body?.locationType || "other",
          expectedFootTraffic: Number.isFinite(expectedFootTraffic)
            ? expectedFootTraffic
            : undefined,
          contactPhone: req.body?.contactPhone || null,
          notes: req.body?.notes || null,
          amenities: req.body?.amenities,
          spotCount: Number.isFinite(spotCount) ? spotCount : undefined,
          isVerified: true,
          adminCreated: true,
          latitude:
            req.body?.latitude !== undefined && req.body?.latitude !== null
              ? req.body.latitude.toString()
              : undefined,
          longitude:
            req.body?.longitude !== undefined && req.body?.longitude !== null
              ? req.body.longitude.toString()
              : undefined,
        });

        const host = await storage.createHost(parsed);
        // Ensure the new host has draft Parking Pass events so pricing can be edited immediately.
        await storage.ensureDraftParkingPassForHost(host.id);

        // Fire-and-forget: auto-populate Google profile data
        populateHostProfile(host.id).catch((err) => {
          console.warn("[AdminCreateHost] Google auto-populate failed for host", host.id, err);
        });

        res.status(201).json(host);
      } catch (error: any) {
        console.error("Error creating host location:", error);
        res.status(500).json({ message: "Failed to create host location" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/hosts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        res.json(hostsForUser);
      } catch (error) {
        console.error("Error fetching user hosts:", error);
        res.status(500).json({ message: "Failed to fetch hosts" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/restaurants",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const restaurantsForUser = await storage.getRestaurantsByOwner(
          req.params.id,
        );
        res.json(restaurantsForUser);
      } catch (error) {
        console.error("Error fetching user restaurants:", error);
        res.status(500).json({ message: "Failed to fetch restaurants" });
      }
    },
  );

  app.post(
    "/api/admin/users/:id/restaurants",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const ownerId = req.params.id;
        const owner = await storage.getUser(ownerId);
        if (!owner) {
          return res.status(404).json({ message: "User not found" });
        }

        const businessType = String(
          req.body?.businessType || "restaurant",
        ).toLowerCase();
        if (!["restaurant", "bar", "food_truck", "caterer"].includes(businessType)) {
          return res.status(400).json({
            message: "Invalid businessType",
          });
        }

        const payload = insertRestaurantSchema.parse({
          ownerId,
          name: String(req.body?.name || "").trim(),
          address: String(req.body?.address || "").trim(),
          city: String(req.body?.city || "").trim(),
          state: String(req.body?.state || "").trim(),
          phone: req.body?.phone || null,
          cuisineType: normalizeCuisineTypes(
            req.body?.cuisineTypes ?? req.body?.cuisineType,
          ),
          businessType,
          isFoodTruck: businessType === "food_truck",
          offersCatering: businessType === "caterer",
          isActive: req.body?.isActive ?? true,
          isVerified: req.body?.isVerified ?? true,
          description: req.body?.description || null,
          websiteUrl: req.body?.websiteUrl || null,
          instagramUrl: req.body?.instagramUrl || null,
          facebookPageUrl: req.body?.facebookPageUrl || null,
        });

        const created = await storage.createRestaurant(payload as any);
        populateRestaurantProfile(created.id).catch((err) => {
          console.warn(
            "[admin.users] Google restaurant enrichment failed after manual create",
            err,
          );
        });

        if (owner.userType === "customer") {
          const nextType =
            businessType === "food_truck"
              ? "food_truck"
              : businessType === "caterer"
                ? "caterer"
                : "restaurant_owner";
          await storage.updateUserType(ownerId, nextType as any);
        }

        res.status(201).json(created);
      } catch (error: any) {
        console.error("Error creating user restaurant profile:", error);
        if (error instanceof ZodError) {
          return res.status(400).json({
            message:
              error.errors[0]?.message ||
              "Please check the business profile fields.",
            errors: error.errors,
          });
        }
        res.status(500).json({
          message: error?.message || "Failed to create business profile",
        });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const ownedRestaurants = await storage.getRestaurantsByOwner(
          req.params.id,
        );
        if (!ownedRestaurants.length) {
          return res.json([]);
        }
        const restaurantIds = ownedRestaurants.map((r) => r.id);
        const userDeals = await db
          .select()
          .from(deals)
          .where(inArray(deals.restaurantId, restaurantIds))
          .orderBy(deals.createdAt);
        res.json(userDeals);
      } catch (error) {
        console.error("Error fetching user deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/events",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        if (!hostsForUser.length) {
          return res.json([]);
        }
        const hostIds = hostsForUser.map((h) => h.id);
        const userEvents = await db
          .select()
          .from(events)
          .where(inArray(events.hostId, hostIds))
          .orderBy(events.date);
        res.json(userEvents);
      } catch (error) {
        console.error("Error fetching user events:", error);
        res.status(500).json({ message: "Failed to fetch events" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/event-series",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostsForUser = await storage.getHostsByUserId(req.params.id);
        if (!hostsForUser.length) {
          return res.json([]);
        }
        const hostIds = hostsForUser.map((h) => h.id);
        const userSeries = await db
          .select()
          .from(eventSeries)
          .where(inArray(eventSeries.hostId, hostIds))
          .orderBy(eventSeries.createdAt);
        res.json(userSeries);
      } catch (error) {
        console.error("Error fetching event series:", error);
        res.status(500).json({ message: "Failed to fetch event series" });
      }
    },
  );

  app.get(
    "/api/admin/users/:id/parking-pass-bookings",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = req.params.id;
        const bookingsAsTruck = await db
          .select()
          .from(eventBookings)
          .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
          .where(eq(restaurants.ownerId, userId));

        const hostRows = await db
          .select({ id: hosts.id })
          .from(hosts)
          .where(eq(hosts.userId, userId));
        const hostIds = hostRows.map(
          (row: (typeof hostRows)[number]) => row.id,
        );
        const bookingsAsHost = hostIds.length
          ? await db
              .select()
              .from(eventBookings)
              .where(inArray(eventBookings.hostId, hostIds))
          : [];

        res.json({ bookingsAsTruck, bookingsAsHost });
      } catch (error) {
        console.error("Error fetching parking pass bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    },
  );

  app.patch(
    "/api/admin/hosts/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parseNullableDecimalString = (
          value: unknown,
        ): string | null | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return trimmed;
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return String(value);
          }
          return "__invalid__";
        };

        const parseIntCentsOrZero = (
          value: unknown,
        ): number | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return 0;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return 0;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return Math.max(0, Math.round(num));
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return Math.max(0, Math.round(value));
          }
          return "__invalid__";
        };

        const parseNullableInt = (
          value: unknown,
        ): number | null | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          if (typeof value === "string") {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const num = Number(trimmed);
            if (!Number.isFinite(num)) return "__invalid__";
            return Math.round(num);
          }
          if (typeof value === "number") {
            if (!Number.isFinite(value)) return "__invalid__";
            return Math.round(value);
          }
          return "__invalid__";
        };

        const parseDaysOfWeek = (
          value: unknown,
        ): number[] | undefined | "__invalid__" => {
          if (value === undefined) return undefined;
          if (!Array.isArray(value)) return "__invalid__";
          const out: number[] = [];
          for (const entry of value) {
            const num = typeof entry === "number" ? entry : Number(entry);
            if (!Number.isInteger(num) || num < 0 || num > 6) {
              return "__invalid__";
            }
            out.push(num);
          }
          return Array.from(new Set(out)).sort((a, b) => a - b);
        };

        const latitude = parseNullableDecimalString(req.body?.latitude);
        if (latitude === "__invalid__") {
          return res.status(400).json({ message: "Invalid latitude" });
        }
        const longitude = parseNullableDecimalString(req.body?.longitude);
        if (longitude === "__invalid__") {
          return res.status(400).json({ message: "Invalid longitude" });
        }

        const expectedFootTraffic = parseNullableInt(
          req.body?.expectedFootTraffic,
        );
        if (expectedFootTraffic === "__invalid__") {
          return res
            .status(400)
            .json({ message: "Invalid expectedFootTraffic" });
        }

        const parkingPassDaysOfWeek = parseDaysOfWeek(
          req.body?.parkingPassDaysOfWeek,
        );
        if (parkingPassDaysOfWeek === "__invalid__") {
          return res
            .status(400)
            .json({ message: "Invalid parkingPassDaysOfWeek" });
        }

        const parkingPassBreakfastPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassBreakfastPriceCents,
        );
        if (parkingPassBreakfastPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassBreakfastPriceCents",
          });
        }
        const parkingPassLunchPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassLunchPriceCents,
        );
        if (parkingPassLunchPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassLunchPriceCents",
          });
        }
        const parkingPassDinnerPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassDinnerPriceCents,
        );
        if (parkingPassDinnerPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassDinnerPriceCents",
          });
        }
        const parkingPassDailyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassDailyPriceCents,
        );
        if (parkingPassDailyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassDailyPriceCents",
          });
        }
        const parkingPassWeeklyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassWeeklyPriceCents,
        );
        if (parkingPassWeeklyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassWeeklyPriceCents",
          });
        }
        const parkingPassMonthlyPriceCents = parseIntCentsOrZero(
          req.body?.parkingPassMonthlyPriceCents,
        );
        if (parkingPassMonthlyPriceCents === "__invalid__") {
          return res.status(400).json({
            message: "Invalid parkingPassMonthlyPriceCents",
          });
        }

        const wantsHostPricingUpdate =
          req.body?.parkingPassBreakfastPriceCents !== undefined ||
          req.body?.parkingPassLunchPriceCents !== undefined ||
          req.body?.parkingPassDinnerPriceCents !== undefined ||
          req.body?.parkingPassDailyPriceCents !== undefined ||
          req.body?.parkingPassWeeklyPriceCents !== undefined ||
          req.body?.parkingPassMonthlyPriceCents !== undefined ||
          req.body?.parkingPassStartTime !== undefined ||
          req.body?.parkingPassEndTime !== undefined ||
          req.body?.parkingPassDaysOfWeek !== undefined;

        if (wantsHostPricingUpdate) {
          const check = await getHostPricingColumnsCheck();
          if (!check.hasAll) {
            return res.status(409).json({
              message:
                "Parking Pass pricing columns are missing in the database. Run migration `071_add_hosts_parking_pass_pricing.sql` and redeploy.",
              missingColumns: check.missing,
            });
          }
        }

        const wantsHostPricingFieldsUpdate =
          req.body?.parkingPassBreakfastPriceCents !== undefined ||
          req.body?.parkingPassLunchPriceCents !== undefined ||
          req.body?.parkingPassDinnerPriceCents !== undefined ||
          req.body?.parkingPassDailyPriceCents !== undefined ||
          req.body?.parkingPassWeeklyPriceCents !== undefined ||
          req.body?.parkingPassMonthlyPriceCents !== undefined ||
          req.body?.parkingPassDailyOnly !== undefined;

        let derivedBreakfastCents = parkingPassBreakfastPriceCents;
        let derivedLunchCents = parkingPassLunchPriceCents;
        let derivedDinnerCents = parkingPassDinnerPriceCents;
        let derivedDailyCents = parkingPassDailyPriceCents;
        let derivedWeeklyCents = parkingPassWeeklyPriceCents;
        let derivedMonthlyCents = parkingPassMonthlyPriceCents;

        if (wantsHostPricingFieldsUpdate) {
          const slotSum =
            (Number(derivedBreakfastCents ?? 0) || 0) +
            (Number(derivedLunchCents ?? 0) || 0) +
            (Number(derivedDinnerCents ?? 0) || 0);

          const dailyProvided =
            req.body?.parkingPassDailyPriceCents !== undefined;
          const weeklyProvided =
            req.body?.parkingPassWeeklyPriceCents !== undefined;
          const monthlyProvided =
            req.body?.parkingPassMonthlyPriceCents !== undefined;

          const effectiveDaily = dailyProvided
            ? Number(derivedDailyCents ?? 0)
            : slotSum > 0
              ? slotSum
              : Number(derivedDailyCents ?? 0);

          derivedDailyCents = Math.max(0, Math.round(effectiveDaily || 0));

          if (!weeklyProvided) {
            derivedWeeklyCents =
              derivedDailyCents > 0
                ? derivedDailyCents * 7
                : Number(derivedWeeklyCents ?? 0);
          }
          if (!monthlyProvided) {
            derivedMonthlyCents =
              derivedDailyCents > 0
                ? derivedDailyCents * 30
                : Number(derivedMonthlyCents ?? 0);
          }
        }

        const wantsSpotImageUpdate = req.body?.spotImageUrl !== undefined;
        const includeSpotImageUrl = wantsSpotImageUpdate
          ? await hasHostSpotImageColumn().catch(() => false)
          : false;

        const updates: any = {
          businessName: req.body?.businessName,
          address: req.body?.address,
          city: req.body?.city,
          state: req.body?.state,
          latitude,
          longitude,
          // Older deployments may not have `spot_image_url` yet.
          // If the column is missing, silently ignore this field so admins can still update
          // coordinates/pricing without a 500.
          spotImageUrl: includeSpotImageUrl
            ? req.body?.spotImageUrl
            : undefined,
          locationType: req.body?.locationType,
          expectedFootTraffic,
          amenities: req.body?.amenities,
          contactPhone: req.body?.contactPhone,
          notes: req.body?.notes,
          isVerified: req.body?.isVerified,
          // Parking Pass defaults (host is the source of truth).
          parkingPassBreakfastPriceCents: wantsHostPricingFieldsUpdate
            ? derivedBreakfastCents
            : undefined,
          parkingPassLunchPriceCents: wantsHostPricingFieldsUpdate
            ? derivedLunchCents
            : undefined,
          parkingPassDinnerPriceCents: wantsHostPricingFieldsUpdate
            ? derivedDinnerCents
            : undefined,
          parkingPassDailyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedDailyCents
            : undefined,
          parkingPassWeeklyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedWeeklyCents
            : undefined,
          parkingPassMonthlyPriceCents: wantsHostPricingFieldsUpdate
            ? derivedMonthlyCents
            : undefined,
          parkingPassStartTime: req.body?.parkingPassStartTime,
          parkingPassEndTime: req.body?.parkingPassEndTime,
          parkingPassDaysOfWeek,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(hosts)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(hosts.id, req.params.id))
          .returning();

        // Keep derived series in sync so pins/bookability update immediately.
        try {
          if (updated?.id) {
            await storage.syncParkingPassSeriesFromHost(String(updated.id));
          }
        } catch (e) {
          console.warn(
            "admin host update: failed syncing parking pass series:",
            e,
          );
        }

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating host:", error);
        if (
          isMissingColumnError(error) &&
          (error?.message?.includes("parking_pass_") ||
            error?.message?.includes("parkingPass"))
        ) {
          resetHostPricingColumnsCache();
          const check = await getHostPricingColumnsCheck().catch(() => null);
          return res.status(409).json({
            message:
              "Parking Pass pricing columns are missing in the database. Run migration `071_add_hosts_parking_pass_pricing.sql` and redeploy.",
            missingColumns: check?.missing ?? undefined,
          });
        }
        const code = typeof error?.code === "string" ? error.code : null;
        const allowDetailCodes = new Set([
          "42703", // undefined_column
          "22P02", // invalid_text_representation
          "23502", // not_null_violation
          "23503", // foreign_key_violation
          "42804", // datatype_mismatch
        ]);
        const detail =
          allowDetailCodes.has(code || "") && typeof error?.message === "string"
            ? String(error.message).split("\n")[0].slice(0, 220)
            : null;

        res.status(500).json({
          message: `Failed to update host${
            code ? ` (code=${code})` : ""
          }${detail ? `: ${detail}` : ""}`,
        });
      }
    },
  );

  app.delete(
    "/api/admin/hosts/:hostId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hostId = req.params.hostId;
        const host = await storage.getHost(hostId);
        if (!host) {
          return res.status(404).json({ message: "Host location not found" });
        }

        const existingBookings = await db
          .select({ id: eventBookings.id })
          .from(eventBookings)
          .where(eq(eventBookings.hostId, hostId))
          .limit(1);

        if (existingBookings.length > 0) {
          return res.status(409).json({
            message: "This location has bookings and cannot be deleted.",
          });
        }

        await db.delete(hosts).where(eq(hosts.id, hostId));
        res.json({ message: "Host location deleted" });
      } catch (error: any) {
        console.error("Error deleting host location:", error);
        res.status(500).json({ message: "Failed to delete host location" });
      }
    },
  );

  app.patch(
    "/api/admin/restaurants/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const restaurantId = req.params.id;
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
          return res.status(404).json({ message: "Restaurant not found" });
        }

        const updates: any = {
          name: req.body?.name,
          address: req.body?.address,
          phone: req.body?.phone,
          businessType: req.body?.businessType,
          cuisineType: req.body?.cuisineType,
          promoCode: req.body?.promoCode,
          city: req.body?.city,
          state: req.body?.state,
          latitude: req.body?.latitude,
          longitude: req.body?.longitude,
          isActive: req.body?.isActive,
          isVerified: req.body?.isVerified,
          description: req.body?.description,
          websiteUrl: req.body?.websiteUrl,
          instagramUrl: req.body?.instagramUrl,
          facebookPageUrl: req.body?.facebookPageUrl,
          amenities: req.body?.amenities,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const updated = await storage.updateRestaurant(restaurantId, updates);

        if (req.body?.manualTrustScoreAdjustment !== undefined) {
          const parsed = Number(req.body.manualTrustScoreAdjustment);
          if (!Number.isFinite(parsed)) {
            return res.status(400).json({
              message: "manualTrustScoreAdjustment must be a number",
            });
          }
          const bounded = Math.max(-50, Math.min(50, Math.round(parsed)));
          const owner = await storage.getUserById(restaurant.ownerId);
          if (owner) {
            const currentSettings =
              owner.accountSettings && typeof owner.accountSettings === "object"
                ? ({ ...(owner.accountSettings as any) } as Record<string, any>)
                : {};
            const currentOverrides =
              currentSettings.vacOverrides &&
              typeof currentSettings.vacOverrides === "object"
                ? ({ ...(currentSettings.vacOverrides as any) } as Record<string, any>)
                : {};
            const byRestaurant =
              currentOverrides.byRestaurant &&
              typeof currentOverrides.byRestaurant === "object"
                ? ({ ...(currentOverrides.byRestaurant as any) } as Record<string, any>)
                : {};
            byRestaurant[restaurantId] = {
              ...(byRestaurant[restaurantId] || {}),
              manualTrustScoreAdjustment: bounded,
              updatedAt: new Date().toISOString(),
              updatedBy: req.user?.id || null,
            };
            await storage.updateUser(owner.id, {
              accountSettings: {
                ...currentSettings,
                vacOverrides: {
                  ...currentOverrides,
                  byRestaurant,
                },
              } as any,
            });
          }
        }
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating restaurant:", error);
        res.status(500).json({ message: "Failed to update restaurant" });
      }
    },
  );

  app.get(
    "/api/admin/restaurants/:id/deals",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const restaurantDeals = await storage.getDealsByRestaurant(
          req.params.id,
        );
        res.json(restaurantDeals);
      } catch (error) {
        console.error("Error fetching restaurant deals:", error);
        res.status(500).json({ message: "Failed to fetch deals" });
      }
    },
  );

  app.patch(
    "/api/admin/deals/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          title: req.body?.title,
          description: req.body?.description,
          dealType: req.body?.dealType,
          discountValue:
            req.body?.discountValue !== undefined
              ? Number(req.body.discountValue)
              : undefined,
          minOrderAmount:
            req.body?.minOrderAmount !== undefined
              ? Number(req.body.minOrderAmount)
              : undefined,
          imageUrl: req.body?.imageUrl,
          startDate: req.body?.startDate
            ? new Date(req.body.startDate)
            : undefined,
          endDate: req.body?.endDate ? new Date(req.body.endDate) : undefined,
          startTime: req.body?.startTime,
          endTime: req.body?.endTime,
          availableDuringBusinessHours: req.body?.availableDuringBusinessHours,
          isOngoing: req.body?.isOngoing,
          totalUsesLimit:
            req.body?.totalUsesLimit !== undefined
              ? Number(req.body.totalUsesLimit)
              : undefined,
          perCustomerLimit:
            req.body?.perCustomerLimit !== undefined
              ? Number(req.body.perCustomerLimit)
              : undefined,
          isActive: req.body?.isActive,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const updated = await storage.updateDeal(req.params.id, updates);
        res.json(updated);
      } catch (error: any) {
        console.error("Error updating deal:", error);
        res.status(500).json({ message: "Failed to update deal" });
      }
    },
  );

  app.patch(
    "/api/admin/events/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const eventId = req.params.id;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        const updates: any = {
          name: req.body?.name,
          description: req.body?.description,
          date: req.body?.date ? new Date(req.body.date) : undefined,
          startTime: req.body?.startTime,
          endTime: req.body?.endTime,
          maxTrucks:
            req.body?.maxTrucks !== undefined
              ? Number(req.body.maxTrucks)
              : undefined,
          status: req.body?.status,
          hardCapEnabled: req.body?.hardCapEnabled,
          requiresPayment: req.body?.requiresPayment,
          breakfastPriceCents:
            req.body?.breakfastPriceCents !== undefined
              ? Number(req.body.breakfastPriceCents)
              : undefined,
          lunchPriceCents:
            req.body?.lunchPriceCents !== undefined
              ? Number(req.body.lunchPriceCents)
              : undefined,
          dinnerPriceCents:
            req.body?.dinnerPriceCents !== undefined
              ? Number(req.body.dinnerPriceCents)
              : undefined,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        if (updates.startTime && updates.endTime) {
          const [startHour, startMinute] = String(updates.startTime)
            .split(":")
            .map(Number);
          const [endHour, endMinute] = String(updates.endTime)
            .split(":")
            .map(Number);
          const startMinutes = startHour * 60 + startMinute;
          const endMinutes = endHour * 60 + endMinute;
          if (endMinutes <= startMinutes) {
            return res
              .status(400)
              .json({ message: "End time must be after start time" });
          }
        }

        const breakfast = Number(
          updates.breakfastPriceCents ?? event.breakfastPriceCents ?? 0,
        );
        const lunch = Number(
          updates.lunchPriceCents ?? event.lunchPriceCents ?? 0,
        );
        const dinner = Number(
          updates.dinnerPriceCents ?? event.dinnerPriceCents ?? 0,
        );
        const finalRequiresPayment = Boolean(
          updates.requiresPayment ?? event.requiresPayment,
        );
        const isPrivateEvent =
          String(event.eventType || "") === "private_event";
        if (
          isPrivateEvent &&
          (finalRequiresPayment || breakfast > 0 || lunch > 0 || dinner > 0)
        ) {
          return res.status(400).json({
            message:
              "Private events cannot use paid pricing. Change event type/visibility before adding Parking Pass pricing.",
          });
        }
        const finalStartTime = String(updates.startTime ?? event.startTime);
        const finalEndTime = String(updates.endTime ?? event.endTime);
        const invalidSlots: string[] = [];
        if (
          breakfast > 0 &&
          !isSlotWithinHours("breakfast", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Breakfast");
        }
        if (
          lunch > 0 &&
          !isSlotWithinHours("lunch", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Lunch");
        }
        if (
          dinner > 0 &&
          !isSlotWithinHours("dinner", finalStartTime, finalEndTime)
        ) {
          invalidSlots.push("Dinner");
        }
        if (invalidSlots.length > 0) {
          return res.status(400).json({
            message:
              "Parking hours must fully cover priced slots: " +
              invalidSlots.join(", "),
          });
        }
        const slotSum = breakfast + lunch + dinner;
        updates.hostPriceCents = slotSum;
        updates.dailyPriceCents = slotSum;
        updates.weeklyPriceCents = slotSum * 7;
        updates.monthlyPriceCents = slotSum * 30;
        updates.updatedAt = new Date();

        const [updated] = await db
          .update(events)
          .set(updates)
          .where(eq(events.id, eventId))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating event:", error);
        res.status(500).json({ message: "Failed to update event" });
      }
    },
  );

  app.patch(
    "/api/admin/event-series/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          name: req.body?.name,
          description: req.body?.description,
          timezone: req.body?.timezone,
          recurrenceRule: req.body?.recurrenceRule,
          startDate: req.body?.startDate
            ? new Date(req.body.startDate)
            : undefined,
          endDate: req.body?.endDate ? new Date(req.body.endDate) : undefined,
          defaultStartTime: req.body?.defaultStartTime,
          defaultEndTime: req.body?.defaultEndTime,
          defaultMaxTrucks:
            req.body?.defaultMaxTrucks !== undefined
              ? Number(req.body.defaultMaxTrucks)
              : undefined,
          defaultHardCapEnabled: req.body?.defaultHardCapEnabled,
          status: req.body?.status,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(eventSeries)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(eventSeries.id, req.params.id))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating event series:", error);
        res.status(500).json({ message: "Failed to update event series" });
      }
    },
  );

  app.patch(
    "/api/admin/parking-pass-bookings/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      if (denyStaffEdits(req, res)) return;
      try {
        const updates: any = {
          status: req.body?.status,
          refundStatus: req.body?.refundStatus,
          refundAmountCents:
            req.body?.refundAmountCents !== undefined
              ? Number(req.body.refundAmountCents)
              : undefined,
          cancellationReason: req.body?.cancellationReason,
          refundReason: req.body?.refundReason,
        };

        Object.keys(updates).forEach((key) => {
          if (updates[key] === undefined) {
            delete updates[key];
          }
        });

        const [updated] = await db
          .update(eventBookings)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(eventBookings.id, req.params.id))
          .returning();

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating booking:", error);
        res.status(500).json({ message: "Failed to update booking" });
      }
    },
  );

  // OAuth configuration status check
  app.get(
    "/api/admin/oauth/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";

        const status = {
          google: {
            configured: !!(
              process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ),
            clientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
            clientSecretPresent: !!process.env.GOOGLE_CLIENT_SECRET,
            callbackUrls: {
              customer: `${baseUrl}/api/auth/google/customer/callback`,
              restaurant: `${baseUrl}/api/auth/google/restaurant/callback`,
            },
          },
          facebook: {
            configured: !!(
              process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
            ),
            appIdPresent: !!process.env.FACEBOOK_APP_ID,
            appSecretPresent: !!process.env.FACEBOOK_APP_SECRET,
            callbackUrl: `${baseUrl}/api/auth/facebook/callback`,
          },
          requiredUrls: {
            privacyPolicy: `${baseUrl}/privacy-policy`,
            dataDeletion: `${baseUrl}/data-deletion`,
            termsOfService: `${baseUrl}/terms-of-service`,
          },
          baseUrl,
          environment: process.env.NODE_ENV || "development",
        };

        res.json(status);
      } catch (error) {
        console.error("Error checking OAuth status:", error);
        res.status(500).json({ error: "Failed to check OAuth status" });
      }
    },
  );

   // POST /api/admin/backfill/google-profiles - Backfill Google data for all hosts missing it
  app.post(
    "/api/admin/backfill/google-profiles",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const allHosts = await storage.getAllHosts();
        const hostsNeedingPopulation = allHosts.filter((h: any) => {
          if (!h.businessName || !h.address) return false;
          return (
            !h.googlePlaceId ||
            !h.description ||
            !h.googleRating ||
            !h.googleReviewCount ||
            !h.googlePhotos ||
            !h.googleCategories ||
            !h.googleFormattedPhone ||
            !h.businessHours ||
            !h.businessWebsite
          );
        });

        // Process in background, return immediately
        const total = hostsNeedingPopulation.length;
        let succeeded = 0;
        let failed = 0;

        // Process sequentially with a small delay to avoid rate limits
        (async () => {
          for (const host of hostsNeedingPopulation) {
            try {
              const result = await populateHostProfile(host.id);
              if (result.success) {
                succeeded++;
              } else {
                failed++;
                console.warn(`[Backfill] Host ${host.id} (${host.businessName}): ${result.error}`);
              }
            } catch (err) {
              failed++;
              console.warn(`[Backfill] Host ${host.id} error:`, err);
            }
            // Small delay between requests to avoid rate limiting
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          console.log(`[Backfill] Complete: ${succeeded} succeeded, ${failed} failed out of ${total}`);
        })();

        res.json({
          message: `Backfill started for ${total} hosts without Google data`,
          total,
          alreadyPopulated: allHosts.length - total,
        });
      } catch (error) {
        console.error("Error starting backfill:", error);
        res.status(500).json({ message: "Failed to start backfill" });
      }
    },
  );

  // Register verification admin routes
  registerVerificationAdminRoutes(app, { storage });
  // Register deal admin routes
  registerDealAdminRoutes(app);
}
