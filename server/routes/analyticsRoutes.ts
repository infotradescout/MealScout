import type { Express } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import {
  insertDealFeedbackSchema,
  searchQueryEvents,
  supportTickets,
  type User,
} from "@shared/schema";

function normalizeSearchQuery(input: string) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function shouldDropSearchQuery(normalized: string) {
  if (!normalized || normalized.length < 2 || normalized.length > 80) {
    return true;
  }
  if (normalized.includes("@")) return true;
  if (normalized.includes("http://") || normalized.includes("https://")) {
    return true;
  }
  if (normalized.includes("www.")) return true;
  if (/\d{7,}/.test(normalized)) return true;
  return false;
}

export function registerAnalyticsRoutes(app: Express) {
  app.post("/api/support-tickets", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        subject: z.string().trim().min(3).max(160),
        description: z.string().trim().min(10).max(4000),
        category: z
          .enum(["bug", "feature", "payment", "account", "onboarding", "other"])
          .default("other"),
        priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
      });
      const parsed = schema.parse(req.body);
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: req.user.id,
          subject: parsed.subject,
          description: parsed.description,
          category: parsed.category,
          priority: parsed.priority,
          status: "open",
        })
        .returning();

      res.status(201).json({ ticket });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid support ticket", errors: error.errors });
      }
      console.error("Error creating support ticket:", error);
      res.status(500).json({ message: "Failed to create support ticket" });
    }
  });

  app.get("/api/support-tickets/my", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supportTickets)
        .where(sql`${supportTickets.userId} = ${req.user.id}`)
        .orderBy(sql`${supportTickets.createdAt} desc`)
        .limit(25);
      res.json(rows);
    } catch (error) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ message: "Failed to fetch support tickets" });
    }
  });

  app.get("/api/search/trending", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          count(*)::int as count,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by count desc, last_seen desc
        limit ${limit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const payload = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        query: String(row.display_query || row.normalized_query || "").trim(),
        count: Number(row.count || 0),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      }));
      res.json(payload.filter((item: any) => item.query));
    } catch (error) {
      console.error("Error fetching trending searches:", error);
      res.status(500).json({ message: "Failed to fetch trending searches" });
    }
  });

  app.get("/api/search/latest", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by last_seen desc
        limit ${limit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const payload = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        query: String(row.display_query || row.normalized_query || "").trim(),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      }));
      res.json(payload.filter((item: any) => item.query));
    } catch (error) {
      console.error("Error fetching latest searches:", error);
      res.status(500).json({ message: "Failed to fetch latest searches" });
    }
  });

  app.post("/api/search/track", async (req: any, res) => {
    try {
      const bodySchema = z.object({
        query: z.string().min(1).max(200),
        source: z.string().min(1).max(64).optional(),
      });
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const rawQuery = String(parsed.data.query || "");
      const compacted = rawQuery.trim().replace(/\s+/g, " ");
      const normalized = normalizeSearchQuery(compacted);
      if (shouldDropSearchQuery(normalized)) {
        return res.status(204).end();
      }

      const source = String(parsed.data.source || "unknown").slice(0, 64);
      const userId = req.user?.id ? String(req.user.id) : null;

      await db.insert(searchQueryEvents).values({
        query: compacted,
        source,
        userId,
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error tracking search query:", error);
      res.status(500).json({ message: "Failed to track search query" });
    }
  });

  app.post("/api/bug-report", async (req: any, res) => {
    try {
      const { screenshot, currentUrl, userAgent } = req.body;

      if (!currentUrl || !userAgent) {
        return res
          .status(400)
          .json({ message: "Missing required bug report data" });
      }

      const user = req.user as User | undefined;
      const userName = user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : undefined;
      const userEmail = user?.email || undefined;

      const bugReportData = {
        userEmail,
        userName,
        userAgent,
        currentUrl,
        timestamp: new Date().toLocaleString(),
        screenshotUrl: screenshot || undefined,
      };

      console.log("🐛 Bug Report Received:");
      console.log("   User:", userName || "Anonymous");
      console.log("   Email:", userEmail || "N/A");
      console.log("   URL:", currentUrl);
      console.log("   User Agent:", userAgent);
      console.log("   Time:", bugReportData.timestamp);
      console.log(
        "   Screenshot:",
        screenshot ? `${screenshot.substring(0, 50)}...` : "None",
      );

      const success = await emailService.sendBugReport(bugReportData);

      res.json({
        success: true,
        message: success
          ? "Bug report sent successfully"
          : "Bug report logged (email service not configured)",
      });
    } catch (error) {
      console.error("Error submitting bug report:", error);
      res.status(500).json({ message: "Failed to submit bug report" });
    }
  });

  app.post("/api/deals/:dealId/feedback", async (req: any, res) => {
    try {
      const { dealId } = req.params;
      const validatedData = insertDealFeedbackSchema.parse({
        ...req.body,
        dealId,
        userId: req.user?.id || null,
      });

      const feedback = await storage.createDealFeedback(validatedData);
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid feedback data", errors: error.errors });
      }
      console.error("Error creating deal feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback", async (req, res) => {
    try {
      const { dealId } = req.params;
      const feedback = await storage.getDealFeedback(dealId);
      res.json(feedback);
    } catch (error) {
      console.error("Error fetching deal feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback/stats", async (req, res) => {
    try {
      const { dealId } = req.params;
      const stats = await storage.getDealFeedbackStats(dealId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching feedback stats:", error);
      res.status(500).json({ message: "Failed to fetch feedback stats" });
    }
  });
}
