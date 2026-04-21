import type { Express } from "express";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import {
  emailDeliveryAudit,
  emailService,
  getEmailConfigSummary,
} from "../../emailService";

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
