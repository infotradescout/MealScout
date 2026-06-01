/**
 * Admin Control Center API Endpoints
 *
 * Provides comprehensive admin tools for:
 * - Incident management
 * - Audit log viewing
 * - Support ticket management
 * - Moderation event review
 * - System health monitoring
 *
 * All endpoints require admin authentication.
 */

import { Router } from "express";
import { db } from "./db";
import {
  supportTickets,
  moderationEvents,
  securityAuditLog,
  incidents,
  users,
  requestLogs,
  adminDailyReports,
} from "@shared/schema";
import { eq, desc, and, or, gte, lte, like, isNull } from "drizzle-orm";
import { isAdmin, isStaffOrAdmin } from "./unifiedAuth";
import { logAudit } from "./auditLogger";
import { storage } from "./storage";
import { sendAccountSetupInvite } from "./utils/accountSetup";
import { getJobQueueStats } from "./jobs/jobQueue";
import {
  canAssignUserType,
  getRoleAssignmentDeniedMessage,
  isInternalTeamUserType,
} from "./roleAccess";

const router = Router();

const requestLogLegacySelect = {
  id: requestLogs.id,
  method: requestLogs.method,
  path: requestLogs.path,
  statusCode: requestLogs.statusCode,
  durationMs: requestLogs.durationMs,
  userId: requestLogs.userId,
  ip: requestLogs.ip,
  userAgent: requestLogs.userAgent,
  createdAt: requestLogs.createdAt,
};

type BotCategory =
  | "llm_crawler"
  | "search_crawler"
  | "automation_script"
  | "browser_human"
  | "unknown_bot"
  | "unknown";

const BOT_SIGNATURES = [
  { label: "GPTBot", match: /gptbot/i, category: "llm_crawler" as BotCategory },
  {
    label: "ChatGPT-User",
    match: /chatgpt-user/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "OAI-SearchBot",
    match: /oai-searchbot/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "ClaudeBot",
    match: /claudebot|claude-web|anthropic-ai/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "Perplexity",
    match: /perplexitybot|perplexity-user/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "Googlebot",
    match: /googlebot|google-inspectiontool/i,
    category: "search_crawler" as BotCategory,
  },
  {
    label: "Google-Extended",
    match: /google-extended/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "Bingbot",
    match: /bingbot|adidxbot/i,
    category: "search_crawler" as BotCategory,
  },
  {
    label: "Applebot",
    match: /applebot/i,
    category: "search_crawler" as BotCategory,
  },
  {
    label: "Meta",
    match: /meta-externalagent|meta-externalfetcher/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "Bytespider",
    match: /bytespider/i,
    category: "llm_crawler" as BotCategory,
  },
  {
    label: "CCBot",
    match: /ccbot/i,
    category: "search_crawler" as BotCategory,
  },
  {
    label: "Amazonbot",
    match: /amazonbot/i,
    category: "search_crawler" as BotCategory,
  },
];

const AUTOMATION_SIGNATURE =
  /curl|python|wget|httpclient|libwww|scrapy|postman|axios|node-fetch|go-http-client/i;
const BOT_HINT_SIGNATURE =
  /bot|crawler|crawl|spider|fetcher|preview|scan|slurp|archive/i;
const BROWSER_SIGNATURE = /mozilla|chrome|safari|firefox|edge|opr\//i;

function classifyTrafficLog(log: {
  userAgent?: string | null;
  userId?: string | null;
}) {
  const ua = String(log.userAgent || "").trim();
  const normalized = ua.toLowerCase();
  const known = BOT_SIGNATURES.find((entry) => entry.match.test(ua));

  if (known) {
    return {
      category: known.category,
      label: known.label,
      isBot: true,
      isLLM: known.category === "llm_crawler",
      isSearchCrawler: known.category === "search_crawler",
    };
  }

  if (AUTOMATION_SIGNATURE.test(normalized)) {
    return {
      category: "automation_script" as BotCategory,
      label: "Automation Script",
      isBot: true,
      isLLM: false,
      isSearchCrawler: false,
    };
  }

  if (BROWSER_SIGNATURE.test(normalized) && log.userId) {
    return {
      category: "browser_human" as BotCategory,
      label: "Authenticated Browser",
      isBot: false,
      isLLM: false,
      isSearchCrawler: false,
    };
  }

  if (BROWSER_SIGNATURE.test(normalized)) {
    return {
      category: "browser_human" as BotCategory,
      label: "Browser",
      isBot: false,
      isLLM: false,
      isSearchCrawler: false,
    };
  }

  if (BOT_HINT_SIGNATURE.test(normalized)) {
    return {
      category: "unknown_bot" as BotCategory,
      label: "Unknown Bot",
      isBot: true,
      isLLM: false,
      isSearchCrawler: false,
    };
  }

  return {
    category: "unknown" as BotCategory,
    label: ua ? "Unknown Client" : "Missing User Agent",
    isBot: false,
    isLLM: false,
    isSearchCrawler: false,
  };
}

/**
 * GET /api/admin/stats
 * Dashboard overview with key metrics
 */
router.get("/stats", isAdmin, async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalIncidents,
      openIncidents,
      criticalIncidents,
      openTickets,
      highPriorityTickets,
      recentModerationEvents,
      auditLogsCount,
    ] = await Promise.all([
      db
        .select()
        .from(users)
        .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)))
        .then((u: any[]) => u.length),
      db
        .select()
        .from(incidents)
        .then((i: any[]) => i.length),
      db
        .select()
        .from(incidents)
        .where(eq(incidents.status, "new"))
        .then((i: any[]) => i.length),
      db
        .select()
        .from(incidents)
        .where(eq(incidents.severity, "critical"))
        .then((i: any[]) => i.length),
      db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.status, "open"))
        .then((t: any[]) => t.length),
      db
        .select()
        .from(supportTickets)
        .then(
          (tickets: any[]) =>
            tickets.filter(
              (t: any) => t.priority === "high" || t.priority === "critical",
            ).length,
        ),
      db
        .select()
        .from(moderationEvents)
        .where(
          gte(
            moderationEvents.createdAt,
            new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          ),
        )
        .then((m: any[]) => m.length),
      db
        .select()
        .from(securityAuditLog)
        .where(gte(securityAuditLog.timestamp, thirtyDaysAgo))
        .then((a: any[]) => a.length),
    ]);

    res.json({
      users: { total: totalUsers },
      incidents: {
        total: totalIncidents,
        open: openIncidents,
        critical: criticalIncidents,
      },
      tickets: { open: openTickets, highPriority: highPriorityTickets },
      moderation: { recentEvents: recentModerationEvents },
      audit: { recentLogs: auditLogsCount },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * GET /api/admin/audit-logs
 * Search and filter audit logs
 */
router.get("/audit-logs", isAdmin, async (req, res) => {
  try {
    const { action, resourceType, userId, search, days = "30" } = req.query;
    const daysNum = parseInt(String(days)) || 30;
    const cutoffDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const logs = await db
      .select()
      .from(securityAuditLog)
      .where(gte(securityAuditLog.timestamp, cutoffDate))
      .orderBy(desc(securityAuditLog.timestamp))
      .limit(500);

    // Client-side filtering for flexibility
    let filtered = logs;
    if (action) {
      filtered = filtered.filter((log: any) => log.action === action);
    }
    if (resourceType) {
      filtered = filtered.filter(
        (log: any) => log.resourceType === resourceType,
      );
    }
    if (userId) {
      filtered = filtered.filter((log: any) => log.userId === userId);
    }
    if (search) {
      const searchLower = String(search).toLowerCase();
      filtered = filtered.filter(
        (log: any) =>
          log.id.toLowerCase().includes(searchLower) ||
          log.resourceId?.toLowerCase().includes(searchLower),
      );
    }

    res.json(filtered.slice(0, 100)); // Return top 100 after filtering
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

/**
 * GET /api/admin/vac-logs
 * Dedicated VAC-lite (Verification Assurance Check) audit log viewer.
 * Returns all `vac:evaluate` entries from the security audit log, enriched
 * with a human-readable summary of each signal so admins can quickly see
 * why a truck was auto-verified or held for manual review.
 */
router.get("/vac-logs", isAdmin, async (req, res) => {
  try {
    const { days = "30", outcome } = req.query;
    const daysNum = Math.min(parseInt(String(days)) || 30, 90);
    const cutoffDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const logs = await db
      .select()
      .from(securityAuditLog)
      .where(
        and(
          eq(securityAuditLog.action, "vac:evaluate"),
          gte(securityAuditLog.timestamp, cutoffDate),
        ),
      )
      .orderBy(desc(securityAuditLog.timestamp))
      .limit(500);

    // Enrich each log with a flat summary for the UI
    const enriched = logs.map((log: any) => {
      const meta = log.metadata ?? {};
      const signals = meta.signals ?? {};
      const autoVerified = meta.shouldAutoVerify === true;
      const score = meta.score ?? null;
      const threshold = meta.threshold ?? null;

      // Build a plain-English signal summary
      const signalSummary: string[] = [];
      if (signals.emailDomainHasMx) signalSummary.push("email MX ✓");
      else signalSummary.push("email MX ✗");
      if (signals.websiteDomainResolves) signalSummary.push("website DNS ✓");
      else signalSummary.push("website DNS ✗");
      if (signals.emailMatchesWebsite) signalSummary.push("email↔website ✓");
      if (signals.hasSocial) signalSummary.push("social ✓");
      if (signals.hasGeo) signalSummary.push("geo ✓");
      if (signals.hasAddress) signalSummary.push("address ✓");
      if (signals.phoneMatches) signalSummary.push("phone match ✓");
      if (signals.freeEmailDomain) signalSummary.push("free email (-10)");

      return {
        id: log.id,
        userId: log.userId,
        restaurantId: log.resourceId,
        timestamp: log.timestamp,
        score,
        threshold,
        autoVerified,
        outcome: autoVerified ? "auto_verified" : "manual_review",
        emailDomain: signals.emailDomain ?? null,
        websiteHost: signals.websiteHost ?? null,
        signalSummary: signalSummary.join(" | "),
        rawMetadata: meta,
      };
    });

    // Filter by outcome if requested
    let result = enriched;
    if (outcome === "auto_verified") {
      result = enriched.filter((e: any) => e.autoVerified);
    } else if (outcome === "manual_review") {
      result = enriched.filter((e: any) => !e.autoVerified);
    }

    res.json({
      total: result.length,
      autoVerifiedCount: enriched.filter((e: any) => e.autoVerified).length,
      manualReviewCount: enriched.filter((e: any) => !e.autoVerified).length,
      logs: result.slice(0, 200),
    });
  } catch (error) {
    console.error("Failed to fetch VAC logs:", error);
    res.status(500).json({ error: "Failed to fetch VAC logs" });
  }
});

/**
 * GET /api/admin/support-tickets
 * List support tickets with filtering
 */
router.get("/support-tickets", isAdmin, async (req, res) => {
  try {
    const { status, priority } = req.query;

    let tickets = await db
      .select()
      .from(supportTickets)
      .orderBy(desc(supportTickets.createdAt))
      .limit(200);

    if (status) {
      tickets = tickets.filter((t: any) => t.status === status);
    }
    if (priority) {
      tickets = tickets.filter((t: any) => t.priority === priority);
    }

    res.json(tickets);
  } catch (error) {
    console.error("Failed to fetch support tickets:", error);
    res.status(500).json({ error: "Failed to fetch support tickets" });
  }
});

/**
 * GET /api/admin/support-tickets/:id
 * Get a single support ticket with user info
 */
router.get("/support-tickets/:id", isAdmin, async (req, res) => {
  try {
    const ticket = (
      await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id))
        .limit(1)
    )[0];

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(ticket);
  } catch (error) {
    console.error("Failed to fetch ticket:", error);
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

/**
 * PATCH /api/admin/support-tickets/:id
 * Update ticket status/notes
 */
router.patch("/support-tickets/:id", isAdmin, async (req, res) => {
  try {
    const { status, adminNotes, priority } = req.body;
    const userId = (req.user as any)?.id || "system";

    const ticket = (
      await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, req.params.id))
        .limit(1)
    )[0];

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const updates: any = {
      updatedAt: new Date(),
    };

    if (status) updates.status = status;
    if (adminNotes !== undefined) updates.adminNotes = adminNotes;
    if (priority) updates.priority = priority;

    if (status === "resolved") {
      updates.resolvedAt = new Date();
      updates.resolvedByAdminId = userId;
    }

    const updated = await db
      .update(supportTickets)
      .set(updates)
      .where(eq(supportTickets.id, req.params.id))
      .returning();

    await logAudit(
      userId,
      "ticket_updated",
      "support_ticket",
      req.params.id,
      "system",
      "internal",
      { changes: updates },
    );

    res.json(updated[0]);
  } catch (error) {
    console.error("Failed to update ticket:", error);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

/**
 * GET /api/admin/moderation-events
 * List moderation events
 */
router.get("/moderation-events", isAdmin, async (req, res) => {
  try {
    const { status, severity } = req.query;

    let events = await db
      .select()
      .from(moderationEvents)
      .orderBy(desc(moderationEvents.createdAt))
      .limit(200);

    if (status) {
      events = events.filter((e: any) => e.status === status);
    }
    if (severity) {
      events = events.filter((e: any) => e.severity === severity);
    }

    res.json(events);
  } catch (error) {
    console.error("Failed to fetch moderation events:", error);
    res.status(500).json({ error: "Failed to fetch moderation events" });
  }
});

/**
 * GET /api/admin/moderation-events/:id
 * Get a single moderation event
 */
router.get("/moderation-events/:id", isAdmin, async (req, res) => {
  try {
    const event = (
      await db
        .select()
        .from(moderationEvents)
        .where(eq(moderationEvents.id, req.params.id))
        .limit(1)
    )[0];

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(event);
  } catch (error) {
    console.error("Failed to fetch event:", error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

/**
 * GET /api/admin/request-logs
 * Download request logs for a date range (default last 48 hours)
 */
router.get("/request-logs", isStaffOrAdmin, async (req, res) => {
  try {
    const startParam = req.query.startDate as string | undefined;
    const endParam = req.query.endDate as string | undefined;
    const limit = Number(req.query.limit || 2000);
    const startDate = startParam
      ? new Date(`${startParam}T00:00:00`)
      : new Date(Date.now() - 48 * 60 * 60 * 1000);
    const endDate = endParam ? new Date(`${endParam}T23:59:59`) : new Date();

    const logs = await db
      .select(requestLogLegacySelect)
      .from(requestLogs)
      .where(
        and(
          gte(requestLogs.createdAt, startDate),
          lte(requestLogs.createdAt, endDate),
        ),
      )
      .orderBy(desc(requestLogs.createdAt))
      .limit(Number.isFinite(limit) ? Math.min(limit, 20000) : 2000);

    res.json({
      range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error("Failed to fetch request logs:", error);
    res.status(500).json({ error: "Failed to fetch request logs" });
  }
});

router.get("/bot-traffic", isStaffOrAdmin, async (req, res) => {
  try {
    const rawHours = Number(req.query.hours || 48);
    const hours = Number.isFinite(rawHours)
      ? Math.max(1, Math.min(24 * 14, Math.trunc(rawHours)))
      : 48;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const logs = await db
      .select(requestLogLegacySelect)
      .from(requestLogs)
      .where(gte(requestLogs.createdAt, since))
      .orderBy(desc(requestLogs.createdAt))
      .limit(10000);

    const totals = {
      requests: logs.length,
      botRequests: 0,
      llmRequests: 0,
      searchCrawlerRequests: 0,
      humanBrowserRequests: 0,
      automationRequests: 0,
      uniqueAgents: 0,
      uniqueIps: 0,
    };

    const categoryCounts: Record<string, number> = {};
    const agentMap = new Map<
      string,
      {
        label: string;
        category: string;
        hits: number;
        lastSeen: string | null;
        sampleUserAgent: string;
        topPaths: Record<string, number>;
      }
    >();
    const pathMap = new Map<
      string,
      {
        hits: number;
        llmHits: number;
        botHits: number;
        humanHits: number;
      }
    >();
    const uniqueIps = new Set<string>();

    for (const log of logs) {
      const classified = classifyTrafficLog(log);
      const agentKey = classified.label;
      const pathKey = String(log.path || "unknown");

      if (log.ip) uniqueIps.add(String(log.ip));

      categoryCounts[classified.category] =
        (categoryCounts[classified.category] || 0) + 1;

      if (classified.isBot) totals.botRequests += 1;
      if (classified.isLLM) totals.llmRequests += 1;
      if (classified.isSearchCrawler) totals.searchCrawlerRequests += 1;
      if (classified.category === "browser_human")
        totals.humanBrowserRequests += 1;
      if (classified.category === "automation_script")
        totals.automationRequests += 1;

      const existingAgent = agentMap.get(agentKey) || {
        label: classified.label,
        category: classified.category,
        hits: 0,
        lastSeen: null,
        sampleUserAgent: String(log.userAgent || ""),
        topPaths: {},
      };
      existingAgent.hits += 1;
      existingAgent.lastSeen = log.createdAt
        ? new Date(log.createdAt).toISOString()
        : existingAgent.lastSeen;
      existingAgent.topPaths[pathKey] =
        (existingAgent.topPaths[pathKey] || 0) + 1;
      agentMap.set(agentKey, existingAgent);

      const existingPath = pathMap.get(pathKey) || {
        hits: 0,
        llmHits: 0,
        botHits: 0,
        humanHits: 0,
      };
      existingPath.hits += 1;
      if (classified.isLLM) existingPath.llmHits += 1;
      if (classified.isBot) existingPath.botHits += 1;
      if (classified.category === "browser_human") existingPath.humanHits += 1;
      pathMap.set(pathKey, existingPath);
    }

    totals.uniqueAgents = agentMap.size;
    totals.uniqueIps = uniqueIps.size;

    const topAgents = Array.from(agentMap.values())
      .map((agent) => ({
        ...agent,
        topPaths: Object.entries(agent.topPaths)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([path, hits]) => ({ path, hits })),
      }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20);

    const topPaths = Array.from(pathMap.entries())
      .map(([path, stats]) => ({ path, ...stats }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 20);

    res.json({
      ok: true,
      windowHours: hours,
      generatedAt: new Date().toISOString(),
      summary: {
        ...totals,
        humanShare:
          totals.requests > 0
            ? totals.humanBrowserRequests / totals.requests
            : 0,
        llmShare:
          totals.requests > 0 ? totals.llmRequests / totals.requests : 0,
        botShare:
          totals.requests > 0 ? totals.botRequests / totals.requests : 0,
      },
      categories: categoryCounts,
      topAgents,
      topPaths,
      notes: [
        "LLM crawler detection is signature-based from request user agents.",
        "Browser traffic without authentication may still include bots or shared previews.",
        "Static assets are excluded from request log capture, so this focuses on page and API demand.",
      ],
    });
  } catch (error) {
    console.error("Failed to fetch bot traffic:", error);
    res.status(500).json({ error: "Failed to fetch bot traffic" });
  }
});

/**
 * GET /api/admin/daily-reports
 * Fetch stored daily summaries (default request logs)
 */
router.get("/daily-reports", isStaffOrAdmin, async (req, res) => {
  try {
    const reportType = (req.query.type as string) || "request_summary";
    const limit = Number(req.query.limit || 30);
    const reports = await db
      .select()
      .from(adminDailyReports)
      .where(eq(adminDailyReports.reportType, reportType))
      .orderBy(desc(adminDailyReports.reportDate))
      .limit(Number.isFinite(limit) ? Math.min(limit, 180) : 30);

    res.json({ reportType, count: reports.length, reports });
  } catch (error) {
    console.error("Failed to fetch daily reports:", error);
    res.status(500).json({ error: "Failed to fetch daily reports" });
  }
});

/**
 * GET /api/admin/moderation-appeals
 * Read-only appeals registry (empty until appeals are stored)
 */
router.get("/moderation-appeals", isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    if (status && !["all", "received", "reviewed"].includes(String(status))) {
      return res.status(400).json({ error: "Invalid status filter" });
    }

    res.json([]);
  } catch (error) {
    console.error("Failed to fetch moderation appeals:", error);
    res.status(500).json({ error: "Failed to fetch moderation appeals" });
  }
});

/**
 * PATCH /api/admin/moderation-events/:id
 * Review and take action on moderation event
 */
router.patch("/moderation-events/:id", isAdmin, async (req, res) => {
  try {
    const { status, actionTaken } = req.body;
    const userId = (req.user as any)?.id || "system";

    const event = (
      await db
        .select()
        .from(moderationEvents)
        .where(eq(moderationEvents.id, req.params.id))
        .limit(1)
    )[0];

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const updates: any = {};
    if (status) updates.status = status;
    if (actionTaken) updates.actionTaken = actionTaken;
    if (status || actionTaken) {
      updates.reviewedAt = new Date();
      updates.reviewedByAdminId = userId;
    }

    const updated = await db
      .update(moderationEvents)
      .set(updates)
      .where(eq(moderationEvents.id, req.params.id))
      .returning();

    await logAudit(
      userId,
      "moderation_reviewed",
      "moderation_event",
      req.params.id,
      "system",
      "internal",
      { action: actionTaken, status },
    );

    res.json(updated[0]);
  } catch (error) {
    console.error("Failed to update moderation event:", error);
    res.status(500).json({ error: "Failed to update moderation event" });
  }
});

/**
 * POST /api/admin/moderation-events
 * Create a moderation event (admin-initiated)
 */
router.post("/moderation-events", isAdmin, async (req, res) => {
  try {
    const {
      eventType,
      severity,
      reportedUserId,
      reportedResourceType,
      reportedResourceId,
      reason,
      description,
    } = req.body;
    const userId = (req.user as any)?.id || "system";

    const event = await db
      .insert(moderationEvents)
      .values({
        eventType,
        severity: severity || "medium",
        reportedUserId,
        reportedResourceType,
        reportedResourceId,
        reason,
        description,
        status: "open",
      })
      .returning();

    await logAudit(
      userId,
      "moderation_event_created",
      "moderation_event",
      event[0].id,
      "system",
      "internal",
      { eventType, reason },
    );

    res.json(event[0]);
  } catch (error) {
    console.error("Failed to create moderation event:", error);
    res.status(500).json({ error: "Failed to create moderation event" });
  }
});

/**
 * GET /api/admin/health
 * System health and background job status
 */
router.get("/health", isAdmin, async (req, res) => {
  try {
    const jobQueue = getJobQueueStats();
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: "connected",
      jobs: {
        queue: jobQueue,
        escalations: { lastRun: "N/A", nextRun: "scheduled" },
        autoClose: { lastRun: "N/A", nextRun: "scheduled" },
      },
    });
  } catch (error) {
    res.status(503).json({ status: "unhealthy", error: String(error) });
  }
});

/**
 * POST /api/admin/grant-lifetime-access
 * Grant lifetime Premium access to a restaurant (no billing, forever)
 */
router.post("/grant-lifetime-access", isAdmin, async (req, res) => {
  try {
    const adminUserId = (req as any).user.id;
    const { restaurantId, reason } = req.body;

    if (!restaurantId) {
      return res.status(400).json({ message: "Restaurant ID required" });
    }

    // Verify restaurant exists
    const { restaurants, restaurantSubscriptions } =
      await import("@shared/schema");
    const restaurant = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!restaurant.length) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    // Check if subscription exists
    const existingSubscription = await db
      .select()
      .from(restaurantSubscriptions)
      .where(eq(restaurantSubscriptions.restaurantId, restaurantId))
      .limit(1);

    if (existingSubscription.length > 0) {
      // Update existing subscription to lifetime Premium
      await db
        .update(restaurantSubscriptions)
        .set({
          tier: "premium",
          status: "active",
          isLifetimeFree: true,
          lifetimeGrantedBy: adminUserId,
          lifetimeGrantedAt: new Date(),
          lifetimeReason: reason || "Admin granted lifetime access",
          canPostVideos: true,
          canPostDeals: true,
          canUseFeaturedSlots: true,
          maxFeaturedSlots: 3,
          hasAnalytics: true,
          hasDealScheduling: true,
          canceledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(restaurantSubscriptions.id, existingSubscription[0].id));
    } else {
      // Create new lifetime Premium subscription
      await db.insert(restaurantSubscriptions).values({
        restaurantId,
        tier: "premium",
        status: "active",
        isLifetimeFree: true,
        lifetimeGrantedBy: adminUserId,
        lifetimeGrantedAt: new Date(),
        lifetimeReason: reason || "Admin granted lifetime access",
        canPostVideos: true,
        canPostDeals: true,
        canUseFeaturedSlots: true,
        maxFeaturedSlots: 3,
        hasAnalytics: true,
        hasDealScheduling: true,
      });
    }

    // Log action
    await logAudit(
      adminUserId,
      "grant_lifetime_access",
      "restaurant_subscription",
      restaurantId,
      "",
      "",
      { reason },
    );

    res.json({
      message: "Lifetime Premium access granted successfully",
      restaurantId,
      restaurantName: restaurant[0].name,
    });
  } catch (error) {
    console.error("Error granting lifetime access:", error);
    res.status(500).json({ message: "Failed to grant lifetime access" });
  }
});

// Manual user onboarding - create any user type and send setup invite
router.post("/users/create", isAdmin, async (req: any, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      userType,
      businessName,
      address,
      cuisineType,
      latitude,
      longitude,
      locationType,
      footTraffic,
      amenities,
      businessType,
      accountType,
      servesFood,
      hostsFoodTrucks,
      wantsFoodTrucks,
      runsEvents,
      postsSpecials,
      allowsPrivateEvents,
      hasFeaturedStaff,
    } = req.body;

    const normalizedAccountType = String(accountType || "")
      .trim()
      .toLowerCase();
    const normalizedRequestedUserType = String(userType || "")
      .trim()
      .toLowerCase();
    const normalizedRequestedBusinessType = String(businessType || "")
      .trim()
      .toLowerCase();
    const accountTypeMap: Record<
      string,
      { userType: string; businessType?: string | null }
    > = {
      food_truck_owner: { userType: "food_truck", businessType: "food_truck" },
      restaurant_owner: { userType: "restaurant_owner", businessType: "restaurant" },
      bar_owner: { userType: "restaurant_owner", businessType: "bar" },
      brewery_taproom_owner: { userType: "restaurant_owner", businessType: "brewery_taproom" },
      caterer_owner: { userType: "restaurant_owner", businessType: "caterer" },
      private_chef_owner: { userType: "restaurant_owner", businessType: "private_chef" },
      host_venue_operator: { userType: "host", businessType: "host_venue" },
      supplier: { userType: "supplier", businessType: "supplier" },
      staff: { userType: "staff", businessType: null },
      event_organizer: { userType: "event_organizer", businessType: "event_organizer" },
      customer: { userType: "customer", businessType: null },
      admin: { userType: "admin", businessType: null },
      duper_admin: { userType: "duper_admin", businessType: null },
      super_admin: { userType: "super_admin", businessType: null },
    };
    const mappedType = accountTypeMap[normalizedAccountType] || null;
    if (normalizedAccountType && !mappedType) {
      return res.status(400).json({ message: "Unknown account type" });
    }
    const resolvedUserType = mappedType?.userType || normalizedRequestedUserType;
    const businessTypesRequiringShell = new Set([
      "food_truck",
      "restaurant",
      "bar",
      "brewery_taproom",
      "caterer",
      "private_chef",
      "host_venue",
      "supplier",
      "event_organizer",
    ]);
    const resolvedBusinessType =
      normalizedRequestedBusinessType ||
      mappedType?.businessType ||
      (resolvedUserType === "food_truck"
        ? "food_truck"
        : resolvedUserType === "restaurant_owner"
          ? "restaurant"
          : null);
    const shouldCreateBusinessShell =
      resolvedUserType === "restaurant_owner" ||
      resolvedUserType === "food_truck" ||
      businessTypesRequiringShell.has(String(resolvedBusinessType || "").toLowerCase());

    if (!email || !resolvedUserType) {
      return res.status(400).json({
        message: "Email and userType are required",
      });
    }

    const validUserTypes = [
      "customer",
      "restaurant_owner",
      "food_truck",
      "caterer",
      "private_chef",
      "supplier",
      "host",
      "event_organizer",
      "staff",
      "admin",
      "duper_admin",
      "super_admin",
    ];
    if (!validUserTypes.includes(resolvedUserType)) {
      return res.status(400).json({ message: "Invalid user type" });
    }

    if (!canAssignUserType(req.user?.userType, resolvedUserType)) {
      return res
        .status(403)
        .json({ message: getRoleAssignmentDeniedMessage(resolvedUserType) });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await storage.getUserByEmail(normalizedEmail);
    if (!user) {
      user = await storage.createUserInvite({
        email: normalizedEmail,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        phone: phone?.trim() || null,
        userType: resolvedUserType as any,
      });
    }

    // Internal staff/admin onboarding should not block on email verification.
    if (isInternalTeamUserType(resolvedUserType)) {
      await storage.updateUser(user.id, { emailVerified: true });
    }

    // Optional profile creation for business users.
    if (shouldCreateBusinessShell && businessName && address) {
      const createdBusiness = await storage.createRestaurantForUser({
        userId: user.id,
        name: businessName,
        address,
        cuisineType: cuisineType || "Various",
      });
      await storage.updateRestaurant(createdBusiness.id, {
        businessType: String(resolvedBusinessType || "restaurant"),
        isFoodTruck: String(resolvedBusinessType || "") === "food_truck",
        servesFood: Boolean(servesFood ?? true),
        hostsFoodTrucks: Boolean(hostsFoodTrucks),
        wantsFoodTrucks: Boolean(wantsFoodTrucks),
        runsEvents: Boolean(runsEvents),
        postsSpecials: Boolean(postsSpecials),
        allowsPrivateEvents: Boolean(allowsPrivateEvents),
        hasFeaturedStaff: Boolean(hasFeaturedStaff),
      } as any, { allowIdentityChange: true });
    }

    if (
      (resolvedUserType === "host" || resolvedUserType === "event_organizer") &&
      businessName &&
      address
    ) {
      const footTrafficMap: Record<string, number> = {
        low: 50,
        medium: 150,
        high: 300,
      };

      const amenitiesObj: Record<string, boolean> = {};
      if (Array.isArray(amenities)) {
        amenities.forEach((amenity: string) => {
          amenitiesObj[amenity] = true;
        });
      }

      const resolvedLocationType =
        resolvedUserType === "event_organizer"
          ? "event_organizer"
          : locationType || "other";

      const hostData: any = {
        userId: user.id,
        businessName,
        address,
        locationType: resolvedLocationType,
        expectedFootTraffic: footTrafficMap[footTraffic] || 100,
        amenities: Object.keys(amenitiesObj).length > 0 ? amenitiesObj : null,
        isVerified: true,
        adminCreated: true,
      };

      if (latitude && longitude) {
        hostData.latitude = String(latitude);
        hostData.longitude = String(longitude);
      }

      await storage.createHost(hostData);
    }

    const inviteResult = await sendAccountSetupInvite({
      user,
      createdBy: req.user,
      req,
      setupPath: `/account-setup?source=admin_provisioning&email=${encodeURIComponent(
        normalizedEmail,
      )}${resolvedBusinessType ? `&businessType=${encodeURIComponent(String(resolvedBusinessType))}` : ""}&role=${encodeURIComponent(String(resolvedUserType || ""))}`,
    });

    await logAudit(
      req.user.id,
      "admin_user_created",
      "user",
      user.id,
      req.ip,
      req.headers["user-agent"],
      {
        userType: resolvedUserType,
        businessType: resolvedBusinessType,
        setupEmailSent: inviteResult.emailSent,
      },
    );

    res.status(201).json({
      message: "User created successfully",
      user: { id: user.id, email: user.email, userType: resolvedUserType },
      setupEmailSent: inviteResult.emailSent,
    });
  } catch (error: any) {
    console.error("Error creating user manually:", error);
    res.status(500).json({ message: "Failed to create user" });
  }
});

// Create host profile with geocoded address
router.post("/hosts/create", isAdmin, async (req: any, res) => {
  try {
    const {
      userId,
      businessName,
      address,
      locationType,
      latitude,
      longitude,
      amenities,
      contactPhone,
      notes,
    } = req.body;

    if (!userId || !businessName || !address || !locationType) {
      return res.status(400).json({
        message: "userId, businessName, address, and locationType are required",
      });
    }

    // Verify user exists
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if host already exists for this user
    const existingHost = await storage.getHostByUserId(userId);
    if (existingHost) {
      return res
        .status(400)
        .json({ message: "Host profile already exists for this user" });
    }

    const hostData: any = {
      userId,
      businessName,
      address,
      locationType,
      amenities: amenities || null,
      contactPhone: contactPhone || null,
      notes: notes || null,
      isVerified: true,
      adminCreated: true,
    };

    // Add geocoding if provided
    if (latitude !== undefined && longitude !== undefined) {
      hostData.latitude = latitude.toString();
      hostData.longitude = longitude.toString();
    }

    const host = await storage.createHost(hostData);
    await logAudit(
      req.user.id,
      "admin_host_created",
      "host",
      host.id,
      req.ip,
      req.headers["user-agent"],
      { userId },
    );

    res.status(201).json({
      message: "Host profile created successfully",
      host,
    });
  } catch (error: any) {
    console.error("Error creating host manually:", error);
    res.status(500).json({ message: "Failed to create host profile" });
  }
});

// Delete user (super admin only)
router.delete("/users/:userId", isAdmin, async (req: any, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Protect super admin email - can never be deleted
    const SUPER_ADMIN_EMAIL =
      process.env.ADMIN_EMAIL || "info.mealscout@gmail.com";
    if (user.email === SUPER_ADMIN_EMAIL) {
      return res
        .status(403)
        .json({ message: "Cannot delete super admin account" });
    }

    // Prevent deleting yourself
    if (user.id === req.user.id) {
      return res
        .status(400)
        .json({ message: "Cannot delete your own account" });
    }

    await storage.deleteUser(userId);
    await logAudit(
      req.user.id,
      "admin_user_deleted",
      "user",
      userId,
      req.ip,
      req.headers["user-agent"],
      {},
    );

    res.json({ message: "User deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

/**
 * GET /api/admin/lifetime-restaurants
 * List all restaurants with lifetime free access
 */
router.get("/lifetime-restaurants", isAdmin, async (req, res) => {
  try {
    const { restaurants, restaurantSubscriptions } =
      await import("@shared/schema");

    const lifetimeRestaurants = await db
      .select({
        subscriptionId: restaurantSubscriptions.id,
        restaurantId: restaurantSubscriptions.restaurantId,
        restaurantName: restaurants.name,
        lifetimeGrantedAt: restaurantSubscriptions.lifetimeGrantedAt,
        lifetimeReason: restaurantSubscriptions.lifetimeReason,
        grantedByAdminId: restaurantSubscriptions.lifetimeGrantedBy,
      })
      .from(restaurantSubscriptions)
      .innerJoin(
        restaurants,
        eq(restaurantSubscriptions.restaurantId, restaurants.id),
      )
      .where(eq(restaurantSubscriptions.isLifetimeFree, true))
      .orderBy(desc(restaurantSubscriptions.lifetimeGrantedAt));

    res.json({ restaurants: lifetimeRestaurants });
  } catch (error) {
    console.error("Error fetching lifetime restaurants:", error);
    res.status(500).json({ message: "Failed to fetch lifetime restaurants" });
  }
});

/**
 * DELETE /api/admin/revoke-lifetime-access/:restaurantId
 * Revoke lifetime access and revert to free tier
 */
router.delete(
  "/revoke-lifetime-access/:restaurantId",
  isAdmin,
  async (req, res) => {
    try {
      const adminUserId = (req as any).user.id;
      const { restaurantId } = req.params;
      const { restaurantSubscriptions } = await import("@shared/schema");

      const subscription = await db
        .select()
        .from(restaurantSubscriptions)
        .where(eq(restaurantSubscriptions.restaurantId, restaurantId))
        .limit(1);

      if (!subscription.length) {
        return res.status(404).json({ message: "Subscription not found" });
      }

      // Revert to free tier
      await db
        .update(restaurantSubscriptions)
        .set({
          tier: "free",
          isLifetimeFree: false,
          lifetimeGrantedBy: null,
          lifetimeGrantedAt: null,
          lifetimeReason: null,
          canPostDeals: false,
          canUseFeaturedSlots: false,
          maxFeaturedSlots: 0,
          hasAnalytics: false,
          hasDealScheduling: false,
          updatedAt: new Date(),
        })
        .where(eq(restaurantSubscriptions.id, subscription[0].id));

      // Log action
      await logAudit(
        adminUserId,
        "revoke_lifetime_access",
        "restaurant_subscription",
        restaurantId,
        "",
        "",
        {},
      );

      res.json({ message: "Lifetime access revoked successfully" });
    } catch (error) {
      console.error("Error revoking lifetime access:", error);
      res.status(500).json({ message: "Failed to revoke lifetime access" });
    }
  },
);

/**
 * GET /api/admin/reported-videos
 * Get all reported videos for moderation
 */
router.get("/reported-videos", isAdmin, async (req, res) => {
  try {
    const status = (req.query.status as string) || "pending";
    const { videoStoryReports, videoStories } = await import("@shared/schema");

    const reports = await db
      .select({
        reportId: videoStoryReports.id,
        storyId: videoStoryReports.storyId,
        storyTitle: videoStories.title,
        storyUrl: videoStories.videoUrl,
        reportedBy: users.email,
        reason: videoStoryReports.reason,
        description: videoStoryReports.description,
        status: videoStoryReports.status,
        createdAt: videoStoryReports.createdAt,
      })
      .from(videoStoryReports)
      .innerJoin(videoStories, eq(videoStoryReports.storyId, videoStories.id))
      .innerJoin(users, eq(videoStoryReports.reportedByUserId, users.id))
      .where(eq(videoStoryReports.status, status))
      .orderBy(desc(videoStoryReports.createdAt));

    res.json({ reports });
  } catch (error) {
    console.error("Error fetching reported videos:", error);
    res.status(500).json({ message: "Failed to fetch reported videos" });
  }
});

/**
 * POST /api/admin/review-report/:reportId
 * Review and take action on a video report (takedown or dismiss)
 */
router.post("/review-report/:reportId", isAdmin, async (req, res) => {
  try {
    const adminUserId = (req as any).user.id;
    const { reportId } = req.params;
    const { action, notes } = req.body; // 'takedown' | 'dismiss'
    const { videoStoryReports, videoStories } = await import("@shared/schema");

    if (!action || !["takedown", "dismiss"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const report = await db
      .select()
      .from(videoStoryReports)
      .where(eq(videoStoryReports.id, reportId))
      .limit(1);

    if (!report.length) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (action === "takedown") {
      // Take down the video
      await db
        .update(videoStories)
        .set({
          status: "expired",
          deletedAt: new Date(),
        })
        .where(eq(videoStories.id, report[0].storyId));

      // Update all reports for this video
      await db
        .update(videoStoryReports)
        .set({
          status: "action_taken",
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
          adminNotes: notes || "Video taken down by admin",
        })
        .where(eq(videoStoryReports.storyId, report[0].storyId));
    } else {
      // Dismiss report
      await db
        .update(videoStoryReports)
        .set({
          status: "dismissed",
          reviewedByAdminId: adminUserId,
          reviewedAt: new Date(),
          adminNotes: notes || "Report dismissed",
        })
        .where(eq(videoStoryReports.id, reportId));
    }

    // Log action
    await logAudit(
      adminUserId,
      `video_report_${action}`,
      "video_story",
      report[0].storyId,
      "",
      "",
      { reportId, notes },
    );

    res.json({
      message: `Report ${
        action === "takedown" ? "processed and video taken down" : "dismissed"
      }`,
    });
  } catch (error) {
    console.error("Error reviewing report:", error);
    res.status(500).json({ message: "Failed to review report" });
  }
});

export default router;
