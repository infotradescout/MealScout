/**
 * registerOperationalEndpoints.ts
 *
 * Admin-only operational/trigger endpoints that were previously inline in routes.ts.
 * Extracted as part of backend refactor Phase 1.
 *
 * Includes: parking-pass reminders, location-demand activation, pricing audit/repair,
 * payout request management, and map watchdog.
 */

import type { Express } from "express";
import { isAuthenticated } from "../unifiedAuth";
import { isInternalTeamUserType } from "../roleAccess";
import {
  getParkingPassOnboardingQueue,
  getParkingPassPricingAudit,
  repairParkingPassPricingDrift,
  remindIncompleteParkingPassHosts,
  sendParkingPassReminderForHost,
} from "../parkingPassReminder";
import {
  getLocationDemandFunnelKpis,
  runLocationDemandActivationCron,
} from "../services/locationDemandActivation";
import {
  getMapEndpointWatchdogSnapshot,
  runMapEndpointWatchdog,
} from "../mapEndpointWatchdog";

// ---------------------------------------------------------------------------
// Middleware helpers (inline to avoid circular imports)
// ---------------------------------------------------------------------------

function isAdmin(req: any, res: any, next: any) {
  const user = req.user;
  if (!user || !isInternalTeamUserType(user.userType)) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Public registration entry point
// ---------------------------------------------------------------------------

export function registerOperationalEndpoints(app: Express): void {
  // ── Parking Pass Reminders ──────────────────────────────────────────────

  app.post(
    "/api/admin/parking-pass/reminders/run",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const stats = await remindIncompleteParkingPassHosts();
        res.json({
          ok: true,
          stats,
          triggeredBy: req.user?.id || null,
          triggeredAt: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error("Manual parking pass reminder trigger failed:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to trigger reminders" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/reminders/:hostId/send",
    isAuthenticated,
    isAdmin,
    async (req: any, res) => {
      try {
        const result = await sendParkingPassReminderForHost(String(req.params.hostId || ""));
        if (!result.ok) return res.status(400).json(result);
        res.json({
          ...result,
          triggeredBy: req.user?.id || null,
          triggeredAt: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error("Manual host parking pass reminder failed:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to send host reminder" });
      }
    },
  );

  app.get(
    "/api/admin/parking-pass/onboarding-queue",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const queue = await getParkingPassOnboardingQueue();
        res.json({ ok: true, ...queue });
      } catch (error: any) {
        console.error("Failed to load parking pass onboarding queue:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to load onboarding queue" });
      }
    },
  );

  app.get(
    "/api/admin/parking-pass/pricing-audit",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const audit = await getParkingPassPricingAudit();
        res.json({ ok: true, ...audit });
      } catch (error: any) {
        console.error("Failed to load parking pass pricing audit:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to load pricing audit" });
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/pricing-repair",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const result = await repairParkingPassPricingDrift();
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error("Failed to repair parking pass pricing drift:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to repair pricing drift" });
      }
    },
  );

  // ── Location Demand Activation ──────────────────────────────────────────

  app.post(
    "/api/admin/location-demand/activation/run",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const stats = await runLocationDemandActivationCron();
        res.json({ ok: true, stats });
      } catch (error: any) {
        console.error("Manual location demand activation trigger failed:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to trigger location demand activation" });
      }
    },
  );

  app.get(
    "/api/admin/location-demand/funnel",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const kpis = await getLocationDemandFunnelKpis();
        res.json({ ok: true, ...kpis });
      } catch (error: any) {
        console.error("Failed to load location demand funnel KPIs:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to load location demand funnel KPIs" });
      }
    },
  );

  // ── Map Endpoint Watchdog ───────────────────────────────────────────────

  app.get(
    "/api/admin/map-watchdog/snapshot",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const snapshot = await getMapEndpointWatchdogSnapshot();
        const { ok: _snapOk, ...snapRest } = (snapshot ?? {}) as any;
        res.json({ ok: true, ...snapRest });
      } catch (error: any) {
        console.error("Failed to get map watchdog snapshot:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to get snapshot" });
      }
    },
  );

  app.post(
    "/api/admin/map-watchdog/run",
    isAuthenticated,
    isAdmin,
    async (_req, res) => {
      try {
        const result = await runMapEndpointWatchdog();
        const { ok: _resultOk, ...resultRest } = result as any;
        res.json({ ok: true, ...resultRest });
      } catch (error: any) {
        console.error("Failed to run map watchdog:", error);
        res.status(500).json({ ok: false, message: error?.message || "Failed to run map watchdog" });
      }
    },
  );

  console.log("✅ Operational endpoints registered");
}
