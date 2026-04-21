import type { Express } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { telemetryEvents } from "@shared/schema";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { db } from "../../db";
import { logAudit } from "../../auditLogger";
import { storage } from "../../storage";

export function registerAdminLisaActionsRoutes(app: Express) {
  app.get(
    "/api/admin/lisa/remediations",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hoursRaw = Number(req.query.hours ?? 24 * 30);
        const hours = Number.isFinite(hoursRaw)
          ? Math.max(24, Math.min(24 * 120, Math.trunc(hoursRaw)))
          : 24 * 30;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        const entityType = String(req.query.entityType || "").trim();
        const entityId = String(req.query.entityId || "").trim();

        const rows = await db
          .select({
            id: telemetryEvents.id,
            userId: telemetryEvents.userId,
            createdAt: telemetryEvents.createdAt,
            properties: telemetryEvents.properties,
          })
          .from(telemetryEvents)
          .where(
            and(
              eq(telemetryEvents.eventName, "lisa_remediation_action"),
              gte(telemetryEvents.createdAt, since),
            ),
          )
          .orderBy(desc(telemetryEvents.createdAt))
          .limit(1000);

        const items = rows
          .map((row: any) => {
            const properties =
              row.properties && typeof row.properties === "object"
                ? (row.properties as Record<string, any>)
                : {};
            return {
              id: row.id,
              userId: row.userId,
              createdAt: row.createdAt,
              entityType: String(properties.entityType || ""),
              entityId: String(properties.entityId || ""),
              actionId: String(properties.actionId || ""),
              actionLabel: String(properties.actionLabel || ""),
              actionHref: String(properties.actionHref || ""),
              actionKind: String(properties.actionKind || "admin"),
              status: String(properties.status || "started"),
              notes: String(properties.notes || ""),
            };
          })
          .filter((item: any) => {
            if (entityType && item.entityType !== entityType) return false;
            if (entityId && item.entityId !== entityId) return false;
            return Boolean(item.entityType && item.entityId && item.actionId);
          });

        const latestByAction = new Map<string, (typeof items)[number]>();
        for (const item of items) {
          const key = `${item.entityType}:${item.entityId}:${item.actionId}`;
          if (!latestByAction.has(key)) {
            latestByAction.set(key, item);
          }
        }

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
          latest: Array.from(latestByAction.values()),
        });
      } catch (error) {
        console.error("Error fetching LISA remediations:", error);
        res.status(500).json({ message: "Failed to fetch remediations" });
      }
    },
  );

  app.post(
    "/api/admin/lisa/remediations",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const entityType = String(req.body?.entityType || "").trim();
        const entityId = String(req.body?.entityId || "").trim();
        const actionId = String(req.body?.actionId || "").trim();
        const actionLabel = String(req.body?.actionLabel || "").trim();
        const actionHref = String(req.body?.actionHref || "").trim();
        const actionKind =
          String(req.body?.actionKind || "admin").trim() === "public"
            ? "public"
            : "admin";
        const status =
          String(req.body?.status || "started").trim() === "completed"
            ? "completed"
            : "started";
        const notes = String(req.body?.notes || "").trim().slice(0, 500);

        if (!entityType || !entityId || !actionId || !actionLabel) {
          return res.status(400).json({ message: "Missing remediation fields" });
        }

        const [eventRow] = await db
          .insert(telemetryEvents)
          .values({
            eventName: "lisa_remediation_action",
            userId: req.user?.id || null,
            properties: {
              entityType,
              entityId,
              actionId,
              actionLabel,
              actionHref,
              actionKind,
              status,
              notes: notes || null,
            },
          })
          .returning({
            id: telemetryEvents.id,
            createdAt: telemetryEvents.createdAt,
          });

        logAudit(
          req.user?.id || "",
          "lisa_remediation_action",
          "lisa_entity",
          `${entityType}:${entityId}`,
          req.ip || "",
          String(req.get("user-agent") || ""),
          {
            actionId,
            actionLabel,
            actionHref,
            actionKind,
            status,
          },
        ).catch((err) =>
          console.error("Failed to write LISA remediation audit log:", err),
        );

        storage
          .emitClaim({
            subjectType: entityType,
            subjectId: entityId,
            actorType: "user",
            actorId: req.user?.id || null,
            app: "mealscout",
            claimType: "remediation_action_logged",
            claimValue: {
              actionId,
              actionLabel,
              actionHref,
              actionKind,
              status,
              notes: notes || null,
            },
            source: "admin_control_center",
          })
          .catch((err) =>
            console.error("Failed to emit remediation LISA claim:", err),
          );

        res.json({
          ok: true,
          item: {
            id: eventRow?.id || null,
            createdAt: eventRow?.createdAt || new Date().toISOString(),
            entityType,
            entityId,
            actionId,
            actionLabel,
            actionHref,
            actionKind,
            status,
            notes,
          },
        });
      } catch (error) {
        console.error("Error logging LISA remediation:", error);
        res.status(500).json({ message: "Failed to log remediation" });
      }
    },
  );

  app.get(
    "/api/admin/lisa/brief-actions",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const hoursRaw = Number(req.query.hours ?? 24 * 30);
        const hours = Number.isFinite(hoursRaw)
          ? Math.max(24, Math.min(24 * 120, Math.trunc(hoursRaw)))
          : 24 * 30;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const rows = await db
          .select({
            id: telemetryEvents.id,
            userId: telemetryEvents.userId,
            createdAt: telemetryEvents.createdAt,
            properties: telemetryEvents.properties,
          })
          .from(telemetryEvents)
          .where(
            and(
              eq(telemetryEvents.eventName, "lisa_brief_action"),
              gte(telemetryEvents.createdAt, since),
            ),
          )
          .orderBy(desc(telemetryEvents.createdAt))
          .limit(1000);

        const items = rows
          .map((row: any) => {
            const properties =
              row.properties && typeof row.properties === "object"
                ? (row.properties as Record<string, any>)
                : {};
            return {
              id: row.id,
              userId: row.userId,
              createdAt: row.createdAt,
              briefKey: String(properties.briefKey || ""),
              action: String(properties.action || ""),
              title: String(properties.title || ""),
              href: String(properties.href || ""),
            };
          })
          .filter((item: any) => Boolean(item.briefKey && item.action));

        const latestByBrief = new Map<string, (typeof items)[number]>();
        for (const item of items) {
          if (!latestByBrief.has(item.briefKey)) {
            latestByBrief.set(item.briefKey, item);
          }
        }

        res.json({
          ok: true,
          generatedAt: new Date().toISOString(),
          windowHours: hours,
          items,
          latest: Array.from(latestByBrief.values()),
        });
      } catch (error) {
        console.error("Error fetching LISA brief actions:", error);
        res.status(500).json({ message: "Failed to fetch brief actions" });
      }
    },
  );

  app.post(
    "/api/admin/lisa/brief-actions",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const briefKey = String(req.body?.briefKey || "").trim();
        const actionRaw = String(req.body?.action || "").trim().toLowerCase();
        const title = String(req.body?.title || "").trim();
        const href = String(req.body?.href || "").trim();
        const action =
          actionRaw === "done" || actionRaw === "snooze" || actionRaw === "dismiss"
            ? actionRaw
            : "";

        if (!briefKey || !action) {
          return res.status(400).json({ message: "Missing brief action fields" });
        }

        const [eventRow] = await db
          .insert(telemetryEvents)
          .values({
            eventName: "lisa_brief_action",
            userId: req.user?.id || null,
            properties: {
              briefKey,
              action,
              title: title || null,
              href: href || null,
            },
          })
          .returning({
            id: telemetryEvents.id,
            createdAt: telemetryEvents.createdAt,
          });

        logAudit(
          req.user?.id || "",
          "lisa_brief_action",
          "lisa_brief",
          briefKey,
          req.ip || "",
          String(req.get("user-agent") || ""),
          { briefKey, action, title, href },
        ).catch((err) =>
          console.error("Failed to write LISA brief audit log:", err),
        );

        res.json({
          ok: true,
          item: {
            id: eventRow?.id || null,
            createdAt: eventRow?.createdAt || new Date().toISOString(),
            briefKey,
            action,
            title,
            href,
          },
        });
      } catch (error) {
        console.error("Error logging LISA brief action:", error);
        res.status(500).json({ message: "Failed to log brief action" });
      }
    },
  );
}
