import crypto from "crypto";
import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { storage } from "../storage";
import { emailService, isEmailConfigured } from "../emailService";
import { db } from "../db";
import { CLAIM_TYPES, claims, hosts } from "@shared/schema";
import { logAudit } from "../auditLogger";

const importedUserSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().default(""),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional().default(""),
  userType: z.literal("host").default("host"),
});

const importedHostSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().optional().default("host_location"),
  website: z.string().trim().url().optional().or(z.literal("")),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(2),
  zip: z.string().trim().optional().default(""),
  contactName: z.string().trim().optional().default(""),
  contactTitle: z.string().trim().optional().default(""),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().optional().default(""),
});

const importedEventRequestSchema = z.object({
  eventName: z.string().trim().min(1),
  eventDate: z.string().trim().min(1),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  timeDisplay: z.string().trim().optional().default(""),
  requestedVendorType: z.string().trim().min(1),
  status: z.string().trim().optional().default("needs_truck_match"),
  visibility: z.string().trim().optional().default("private_until_confirmed"),
  requestSummary: z.string().trim().optional().default(""),
  requestedDetailsFromTruck: z.array(z.string().trim()).optional().default([]),
  detailsAvailableBy: z.string().trim().optional().default("Contact event organizer"),
  missingFields: z.array(z.string().trim()).optional().default([]),
});

const hostEventLeadImportSchema = z.object({
  source: z.string().trim().optional().default("admin_lead_import"),
  sendVerificationEmail: z.boolean().optional().default(true),
  user: importedUserSchema,
  host: importedHostSchema,
  eventRequest: importedEventRequestSchema,
  rawSource: z.record(z.any()).optional().default({}),
});

const normalizeLocationValue = (value?: string | null) =>
  String(value || "").trim().toLowerCase();

const buildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  [
    normalizeLocationValue(address),
    normalizeLocationValue(city),
    normalizeLocationValue(state),
  ].join("|");

function buildVerifyBaseUrl(req: any) {
  return String(
    process.env.PUBLIC_BASE_URL ||
      process.env.CLIENT_ORIGIN ||
      `${req.protocol}://${req.get("host")}` ||
      "http://localhost:5000",
  ).replace(/\/+$/, "");
}

async function sendVerificationIfNeeded(req: any, user: any) {
  if (!user?.email) {
    return { sent: false, skipped: "missing_email" };
  }
  if (user.emailVerified) {
    return { sent: false, skipped: "already_verified" };
  }
  if (!isEmailConfigured()) {
    return { sent: false, skipped: "email_not_configured" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await storage.createEmailVerificationToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    requestIp: req.ip || req.connection?.remoteAddress || undefined,
    userAgent: req.get("User-Agent") || undefined,
  });

  const verifyUrl = `${buildVerifyBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const sent = await emailService.sendEmailVerificationEmail(user, verifyUrl);
  return { sent: Boolean(sent), skipped: null };
}

export function registerAdminLeadImportRoutes(app: Express) {
  app.post(
    "/api/admin/lead-import/host-event",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = hostEventLeadImportSchema.parse(req.body || {});
        const actorId = String(req.user?.id || req.user?.claims?.sub || "");

        let user = await storage.getUserByEmail(parsed.user.email);
        let userCreated = false;
        if (!user) {
          user = await storage.createUserInvite({
            email: parsed.user.email,
            firstName: parsed.user.firstName,
            lastName: parsed.user.lastName || null,
            phone: parsed.user.phone || null,
            userType: "host",
          });
          userCreated = true;
        } else {
          const nonOverridableTypes = new Set([
            "admin",
            "super_admin",
            "staff",
          ]);
          if (!nonOverridableTypes.has(String(user.userType || ""))) {
            if (String(user.userType || "") !== "host") {
              user = await storage.updateUserType(user.id, "host");
            }
          }
          const updatePayload: any = {};
          if (parsed.user.firstName && !user.firstName) {
            updatePayload.firstName = parsed.user.firstName;
          }
          if (parsed.user.lastName && !user.lastName) {
            updatePayload.lastName = parsed.user.lastName;
          }
          if (parsed.user.phone && !user.phone) {
            updatePayload.phone = parsed.user.phone;
          }
          if (Object.keys(updatePayload).length > 0) {
            user = await storage.updateUser(user.id, updatePayload);
          }
        }

        const userHosts = await storage.getHostsByUserId(user.id);
        const incomingHostKey = buildLocationKey(
          parsed.host.address,
          parsed.host.city,
          parsed.host.state,
        );
        let host = userHosts.find(
          (item: any) =>
            buildLocationKey(item.address, item.city, item.state) ===
            incomingHostKey,
        );
        let hostCreated = false;
        if (!host) {
          host = await storage.createHost({
            userId: user.id,
            businessName: parsed.host.name,
            address: parsed.host.address,
            city: parsed.host.city,
            state: parsed.host.state,
            locationType: parsed.host.category,
            contactPhone: parsed.host.contactPhone || parsed.user.phone || null,
            notes: [
              parsed.host.website ? `Website: ${parsed.host.website}` : "",
              parsed.host.contactName
                ? `Contact: ${parsed.host.contactName}${parsed.host.contactTitle ? `, ${parsed.host.contactTitle}` : ""}`
                : "",
              parsed.host.contactEmail
                ? `Contact email: ${parsed.host.contactEmail}`
                : "",
              parsed.host.zip ? `ZIP: ${parsed.host.zip}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            spotCount: 1,
          } as any);
          hostCreated = true;
          await storage.ensureDraftParkingPassForHost(host.id).catch(() => false);
        }

        const claimData = {
          eventName: parsed.eventRequest.eventName,
          occasion: parsed.eventRequest.eventName,
          date: parsed.eventRequest.eventDate,
          startTime: parsed.eventRequest.startTime,
          endTime: parsed.eventRequest.endTime,
          timeDisplay:
            parsed.eventRequest.timeDisplay ||
            `${parsed.eventRequest.startTime} - ${parsed.eventRequest.endTime}`,
          requestedVendorType: parsed.eventRequest.requestedVendorType,
          requestedTruckCount: 1,
          maxTrucks: 1,
          eventVisibility: "private",
          status: parsed.eventRequest.status,
          hostId: host.id,
          hostBusinessName: parsed.host.name,
          hostCategory: parsed.host.category,
          address: parsed.host.address,
          city: parsed.host.city,
          state: parsed.host.state,
          zip: parsed.host.zip,
          requestSummary: parsed.eventRequest.requestSummary,
          requestedDetailsFromTruck:
            parsed.eventRequest.requestedDetailsFromTruck,
          detailsAvailableBy: parsed.eventRequest.detailsAvailableBy,
          missingFields: parsed.eventRequest.missingFields,
          organizer: {
            name:
              parsed.host.contactName ||
              [parsed.user.firstName, parsed.user.lastName].filter(Boolean).join(" "),
            title: parsed.host.contactTitle || null,
            phone: parsed.host.contactPhone || parsed.user.phone || null,
            email: parsed.host.contactEmail || parsed.user.email,
          },
        };

        const [claim] = await db
          .insert(claims)
          .values({
            personId: user.id,
            claimType: CLAIM_TYPES.EVENT,
            status: "provisional",
            claimData,
            metadata: {
              source: parsed.source,
              importedBy: actorId || null,
              importedAt: new Date().toISOString(),
              discoverableByAllUsers: false,
              rawSource: parsed.rawSource || {},
            },
          } as any)
          .returning();

        const verification = parsed.sendVerificationEmail
          ? await sendVerificationIfNeeded(req, user)
          : { sent: false, skipped: "disabled_by_request" };

        await logAudit(
          actorId,
          "admin_host_event_lead_imported",
          "host_event_lead",
          String(claim?.id || ""),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            userId: user.id,
            hostId: host.id,
            claimId: claim?.id || null,
            userCreated,
            hostCreated,
            verification,
            source: parsed.source,
          },
        ).catch((error) =>
          console.error("Failed to write lead import audit log:", error),
        );

        res.status(201).json({
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            userType: user.userType,
            emailVerified: user.emailVerified,
            created: userCreated,
          },
          host: {
            id: host.id,
            businessName: host.businessName,
            address: host.address,
            city: host.city,
            state: host.state,
            locationType: host.locationType,
            created: hostCreated,
          },
          eventIntakeClaim: {
            id: claim?.id || null,
            status: claim?.status || "provisional",
            claimType: claim?.claimType || CLAIM_TYPES.EVENT,
          },
          verification,
        });
      } catch (error: any) {
        console.error("Error importing host event lead:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid host event lead import data",
            errors: error.errors,
          });
        }
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "A user, host, or claim with matching unique data already exists",
          });
        }
        res.status(500).json({
          message: error.message || "Failed to import host event lead",
        });
      }
    },
  );
}
