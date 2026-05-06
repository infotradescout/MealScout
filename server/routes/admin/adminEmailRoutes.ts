import type { Express } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import {
  emailDeliveryAudit,
  emailService,
  getEmailConfigSummary,
} from "../../emailService";
import { users } from "@shared/schema";

const userMessageSchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    subject: z.string().trim().min(3).max(160),
    message: z.string().trim().min(1).max(5000),
    context: z.string().trim().max(120).optional(),
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: "Recipient user or email required",
  });

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const messageToHtml = (message: string) =>
  message
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("\n");

export function registerAdminEmailRoutes(app: Express) {
  app.get(
    "/api/admin/email/status",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      res.json(getEmailConfigSummary());
    },
  );

  app.post(
    "/api/admin/email/test",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const to = String(req.body?.to || "").trim() || req.user?.email;
        const categoryRaw = String(req.body?.category || "general").trim();
        const category =
          categoryRaw === "account" ? "account" : ("general" as const);
        if (!to) {
          return res.status(400).json({ message: "Recipient email required" });
        }
        const summary = getEmailConfigSummary();
        if (!summary.configured) {
          return res.status(400).json({
            message:
              "Email provider is not configured (missing/invalid BREVO_API_KEY).",
          });
        }

        const ok = await emailService.sendBasicEmail(
          to,
          "MealScout test email",
          "<p>This is a test email from MealScout admin.</p>",
          "This is a test email from MealScout admin.",
          category,
        );
        res.json({
          success: ok,
          configured: summary.configured,
          mode: summary.mode,
          category,
          latestAttempt: emailDeliveryAudit.latest(),
        });
      } catch (error: any) {
        console.error("Error sending test email:", error);
        res.status(500).json({ message: "Failed to send test email" });
      }
    },
  );

  app.post(
    "/api/admin/email/user-message",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = userMessageSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({
            message: parsed.error.issues[0]?.message || "Invalid message",
          });
        }

        const input = parsed.data;
        const summary = getEmailConfigSummary();
        if (!summary.configured) {
          return res.status(503).json({
            message:
              "Email provider is not configured (missing/invalid BREVO_API_KEY).",
          });
        }

        let targetUser: typeof users.$inferSelect | null = null;
        if (input.userId) {
          const [row] = await db
            .select()
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);
          if (!row) {
            return res.status(404).json({ message: "User not found" });
          }
          targetUser = row;
        }

        const to = String(targetUser?.email || input.email || "").trim();
        if (!to) {
          return res.status(400).json({ message: "User has no email on file" });
        }

        const adminId = req.user?.id || req.user?.claims?.sub || "admin";
        const bodyHtml = messageToHtml(input.message);
        const contextHtml = input.context
          ? `<p style="color:#6b7280;font-size:12px;margin-top:18px;">Context: ${escapeHtml(input.context)}</p>`
          : "";
        const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
            ${bodyHtml}
            ${contextHtml}
            <p style="color:#6b7280;font-size:12px;margin-top:18px;">You can reply directly to this email if you need help.</p>
          </div>
        `;
        const text = input.context
          ? `${input.message}\n\nContext: ${input.context}\n\nYou can reply directly to this email if you need help.`
          : `${input.message}\n\nYou can reply directly to this email if you need help.`;

        const ok = await emailService.sendBasicEmail(
          to,
          input.subject,
          html,
          text,
          "account",
        );
        console.log(
          `[admin/email/user-message] by=${adminId} to=${to} user=${targetUser?.id || "manual"} context=${input.context || "none"} ok=${ok}`,
        );

        res.status(ok ? 200 : 502).json({
          ok,
          to,
          subject: input.subject,
          latestAttempt: emailDeliveryAudit.latest(),
          message: ok
            ? "Email sent"
            : "Email provider did not send the message",
        });
      } catch (error: any) {
        console.error("Error sending admin user message:", error);
        res.status(500).json({ message: "Failed to send user message" });
      }
    },
  );

  app.get(
    "/api/admin/email/attempts",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const rawLimit =
        typeof req.query?.limit === "string" ? req.query.limit : "";
      const limit = Number(rawLimit || 25);
      res.json({ rows: emailDeliveryAudit.list(limit) });
    },
  );
}
