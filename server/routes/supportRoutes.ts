import type { Express } from "express";
import { desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { notifyUser } from "../productNotifications";
import { supportTickets, users } from "@shared/schema";

const supportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  category: z
    .enum([
      "account",
      "booking",
      "live_location",
      "payment",
      "business_profile",
      "hiring",
      "private_chef",
      "bug",
      "other",
    ])
    .default("other"),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
});

const directAdminMessageSchema = z.object({
  message: z.string().trim().min(10).max(5000),
  subject: z.string().trim().max(160).optional(),
  priority: z.enum(["normal", "high", "critical"]).default("high"),
});

async function getSuperAdminUser() {
  const adminEmail = String(
    process.env.ADMIN_EMAIL || "info.mealscout@gmail.com",
  )
    .trim()
    .toLowerCase();
  const byEmail = adminEmail ? await storage.getUserByEmail(adminEmail) : null;
  if (byEmail) return byEmail;

  const [superAdmin] = await db
    .select()
    .from(users)
    .where(or(eq(users.userType, "super_admin"), eq(users.userType, "duper_admin")))
    .limit(1);
  return superAdmin || null;
}

export function registerSupportRoutes(app: Express) {
  app.get("/api/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, String(req.user.id)))
        .orderBy(desc(supportTickets.createdAt))
        .limit(50);
      res.json({ tickets: rows });
    } catch (error) {
      console.error("Error loading user support tickets:", error);
      res.status(500).json({ message: "Failed to load support tickets" });
    }
  });

  app.post("/api/support/tickets", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = supportTicketSchema.parse(req.body || {});
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: String(req.user.id),
          subject: parsed.subject,
          description: parsed.description,
          category: parsed.category,
          priority: parsed.priority,
          status: "open",
        })
        .returning();

      const superAdmin = await getSuperAdminUser();
      if (superAdmin) {
        const requesterName =
          [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
          req.user.email ||
          "A MealScout user";
        await notifyUser({
          user: superAdmin,
          topic: "businessMessages",
          title: `New support ticket: ${parsed.subject}`,
          body: `${requesterName} submitted a ${parsed.category.replace(/_/g, " ")} ticket.`,
          actionUrl: "/admin/tickets",
          priority: parsed.priority === "critical" ? "high" : "normal",
          sourceType: "support_ticket",
          sourceId: ticket.id,
          actorUserId: String(req.user.id),
          channels: ["in_app", "email"],
          metadata: {
            ticketId: ticket.id,
            category: parsed.category,
            priority: parsed.priority,
          },
        });
      }

      res.status(201).json({ ticket });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid support ticket",
          errors: error.errors,
        });
      }
      console.error("Error creating support ticket:", error);
      res.status(500).json({ message: "Failed to create support ticket" });
    }
  });

  app.post(
    "/api/support/message-super-admin",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const parsed = directAdminMessageSchema.parse(req.body || {});
        const requesterName =
          [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") ||
          req.user.email ||
          "MealScout user";
        const subject =
          parsed.subject?.trim() || `Direct message from ${requesterName}`;

        const [ticket] = await db
          .insert(supportTickets)
          .values({
            userId: String(req.user.id),
            subject,
            description: parsed.message,
            category: "direct_super_admin",
            priority: parsed.priority,
            status: "open",
          })
          .returning();

        const superAdmin = await getSuperAdminUser();
        if (superAdmin) {
          await notifyUser({
            user: superAdmin,
            topic: "businessMessages",
            title: subject,
            body: parsed.message,
            actionUrl: "/admin/tickets",
            priority: "high",
            sourceType: "direct_super_admin_message",
            sourceId: ticket.id,
            actorUserId: String(req.user.id),
            channels: ["in_app", "email"],
            metadata: {
              ticketId: ticket.id,
              requesterId: String(req.user.id),
              requesterEmail: req.user.email || null,
              directToSuperAdmin: true,
            },
          });
        }

        res.status(201).json({ ticket, deliveredToSuperAdmin: Boolean(superAdmin) });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid message",
            errors: error.errors,
          });
        }
        console.error("Error messaging super admin:", error);
        res.status(500).json({ message: "Failed to message super admin" });
      }
    },
  );
}
