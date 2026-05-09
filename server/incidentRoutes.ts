/**
 * Incident Management API Endpoints
 *
 * Provides full CRUD and lifecycle management for incidents.
 * All endpoints require admin authentication.
 */

import { timingSafeEqual } from "crypto";
import { Router, type Request } from "express";
import { db } from "./db";
import { incidents, securityAuditLog, type User } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { isAdmin } from "./unifiedAuth";
import incidentManager, { verifyIncidentSignature } from "./incidentManager";
import { logAudit } from "./auditLogger";

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface User {
      id: string;
      role?: string[];
    }
  }
}

const router = Router();

const CRON_SECRETS = [process.env.INCIDENT_CRON_SECRET, process.env.CRON_SECRET]
  .filter((value): value is string => Boolean(value && value.trim().length > 0))
  .map((value) => value.trim());

function constantTimeStringEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function readBearerToken(req: Request): string {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

function hasValidCronSecret(req: Request): boolean {
  if (CRON_SECRETS.length === 0) {
    return false;
  }

  const presented = [
    readBearerToken(req),
    String(req.headers["x-cron-secret"] || "").trim(),
  ].filter((value) => value.length > 0);

  if (presented.length === 0) {
    return false;
  }

  return presented.some((candidate) =>
    CRON_SECRETS.some((secret) => constantTimeStringEquals(candidate, secret)),
  );
}

function isPrivilegedOpsUser(req: Request): boolean {
  const userType = String((req as any)?.user?.userType || "").trim();
  return ["staff", "admin", "duper_admin", "super_admin"].includes(userType);
}

function isLocalDevRequest(req: Request): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  const ip = String(req.ip || "").toLowerCase();
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost"
  );
}

function isAuthorizedCronRequest(req: Request): boolean {
  return (
    isPrivilegedOpsUser(req) ||
    hasValidCronSecret(req) ||
    isLocalDevRequest(req)
  );
}

/**
 * GET /api/incidents
 * List all incidents with optional filtering
 */
router.get("/", isAdmin, async (req, res) => {
  try {
    const allIncidents = await db
      .select()
      .from(incidents)
      .orderBy(desc(incidents.createdAt))
      .limit(100); // Recent 100 incidents

    res.json(allIncidents);
  } catch (error) {
    console.error("Failed to fetch incidents:", error);
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

/**
 * GET /api/incidents/:id
 * Get a single incident by ID
 */
router.get("/:id", isAdmin, async (req, res) => {
  try {
    const incident = (
      await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, req.params.id))
        .limit(1)
    )[0];

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    res.json(incident);
  } catch (error) {
    console.error("Failed to fetch incident:", error);
    res.status(500).json({ error: "Failed to fetch incident" });
  }
});

/**
 * GET /api/incidents/:id/audit-logs
 * Get audit logs related to an incident
 */
router.get("/:id/audit-logs", isAdmin, async (req, res) => {
  try {
    const logs = await db
      .select()
      .from(securityAuditLog)
      .where(eq(securityAuditLog.resourceId, req.params.id))
      .orderBy(desc(securityAuditLog.timestamp));

    res.json(logs);
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

/**
 * PATCH /api/incidents/:id/status
 * Update incident status (new → acknowledged → resolved → closed)
 */
router.patch("/:id/status", isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["new", "acknowledged", "resolved", "closed"];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const incident = (
      await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, req.params.id))
        .limit(1)
    )[0];

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    const userId = req.user?.id || "system";
    let updated;

    if (status === "acknowledged" && incident.status === "new") {
      updated = await incidentManager.acknowledgeIncident(
        req.params.id,
        userId,
      );
    } else if (status === "resolved" && incident.status === "acknowledged") {
      updated = await incidentManager.resolveIncident(req.params.id, userId);
    } else if (status === "closed" && incident.status === "resolved") {
      updated = await incidentManager.closeIncident(req.params.id, userId);
    } else {
      return res
        .status(400)
        .json({
          error: `Cannot transition from ${incident.status} to ${status}`,
        });
    }

    // Log the status change
    await logAudit(
      userId,
      `incident_${status}`,
      "incident",
      req.params.id,
      req.ip || "unknown",
      req.get("user-agent") || "unknown",
      { previousStatus: incident.status, newStatus: status },
    );

    res.json(updated);
  } catch (error) {
    console.error("Failed to update incident status:", error);
    res.status(500).json({ error: "Failed to update incident status" });
  }
});

/**
 * GET /api/incidents/:id/report
 * Download incident report as markdown
 */
router.get("/:id/report", isAdmin, async (req, res) => {
  try {
    const incident = (
      await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, req.params.id))
        .limit(1)
    )[0];

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    // Get related audit logs
    const auditLogs = await db
      .select()
      .from(securityAuditLog)
      .where(eq(securityAuditLog.resourceId, req.params.id));

    // Generate markdown report
    const report = `# Incident Report: ${incident.id}

## Overview
- **ID**: ${incident.id}
- **Rule**: ${incident.ruleId}
- **Severity**: ${incident.severity}
- **Status**: ${incident.status}
- **Created**: ${incident.createdAt ? incident.createdAt.toISOString() : "Unknown"}
- **Acknowledged**: ${incident.acknowledgedAt ? incident.acknowledgedAt.toISOString() : "Pending"}
- **Resolved**: ${incident.resolvedAt ? incident.resolvedAt.toISOString() : "Pending"}

## Metadata
\`\`\`json
${JSON.stringify(incident.metadata, null, 2)}
\`\`\`

## Related Audit Logs
${auditLogs.map((log: any) => `- [${log.timestamp ? log.timestamp.toISOString() : "Unknown"}] ${log.action} on ${log.resourceType}:${log.resourceId}`).join("\n")}

---
Generated on ${new Date().toISOString()}`;

    res.set("Content-Type", "text/markdown");
    res.set(
      "Content-Disposition",
      `attachment; filename="incident-${incident.id}.md"`,
    );
    res.send(report);
  } catch (error) {
    console.error("Failed to generate report:", error);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

/**
 * GET /api/incidents/:id/verify-signature
 * Verify the cryptographic signature of an incident
 */
router.get("/:id/verify-signature", isAdmin, async (req, res) => {
  try {
    const incident = (
      await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, req.params.id))
        .limit(1)
    )[0];

    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    const valid = incident.signatureHash
      ? verifyIncidentSignature(incident, incident.signatureHash)
      : false;

    res.json({
      valid,
      incidentId: incident.id,
      signature: incident.signatureHash,
      message: valid
        ? "✅ Signature verified - no tampering detected"
        : "❌ Signature invalid - incident may have been modified",
    });
  } catch (error) {
    console.error("Failed to verify signature:", error);
    res.status(500).json({ error: "Failed to verify signature" });
  }
});

/**
 * POST /api/cron/escalations
 * Run escalation checks (can be triggered manually or by cron)
 * Returns the number of escalated incidents
 */
router.post("/cron/escalations", async (req, res) => {
  try {
    if (!isAuthorizedCronRequest(req)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Import escalation runner
    const escalatedCount = await incidentManager.checkEscalations();

    res.json({
      success: true,
      escalatedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to run escalations:", error);
    res.status(500).json({ error: "Failed to run escalations" });
  }
});

/**
 * POST /api/cron/auto-close
 * Run auto-close for low-severity incidents (can be triggered manually or by cron)
 * Returns the number of closed incidents
 */
router.post("/cron/auto-close", async (req, res) => {
  try {
    if (!isAuthorizedCronRequest(req)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Import auto-close runner
    const closedCount = await incidentManager.autoCloseLowSeverityIncidents();

    res.json({
      success: true,
      closedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to run auto-close:", error);
    res.status(500).json({ error: "Failed to run auto-close" });
  }
});

export default router;
