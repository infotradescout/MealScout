import type { Express } from "express";
import { z } from "zod";
import {
  classifyDiscoveryRequest,
  deriveDiscoverySourceEvidence,
  discoveryRequestActorType,
} from "../services/discoveryRequestSignals";

const SIGNAL_TYPES = new Set([
  "public_profile_page_error", "public_profile_not_found_viewed", "missing_menu_viewed",
  "missing_schedule_viewed", "failed_profile_image",
]);
const IMAGE_TYPES = new Set(["logo", "cover"]);
const schema = z.object({
  type: z.string().trim().min(1).max(80),
  profile_id: z.string().trim().min(1).max(120).optional().nullable(),
  profile_type: z.enum(["restaurant", "truck", "bar", "location", "supplier"]).optional().nullable(),
  path: z.string().trim().min(1).max(240),
  missing_menu: z.boolean().optional(),
  missing_schedule: z.boolean().optional(),
  failed_image_type: z.string().trim().max(32).optional().nullable(),
  timestamp: z.string().trim().max(64).optional().nullable(),
}).strip();

type QualityRecord = {
  method: string; path: string; statusCode: number; durationMs: number;
  userId: null; sessionId: null; anonymousActorId: null;
  actorType: string; sourceType: string; eventType: string; surface: string;
  entityId: string | null; entityType: string | null; ip: null; userAgent: null;
  metadata: Record<string, unknown>;
};

/** Uses the existing request-log writer in production. Quality reports are not visits or completed actions. */
export function registerPublicProfileQualityRoute(
  app: Express,
  writeRecord: (record: QualityRecord) => Promise<unknown>,
): void {
  app.post("/api/analytics/shell", async (req, res) => {
    try {
      const parsed = schema.parse(req.body || {});
      if (!SIGNAL_TYPES.has(parsed.type)) {
        return res.status(400).json({ message: "Unsupported quality signal" });
      }
      if (parsed.type === "failed_profile_image" && !IMAGE_TYPES.has(String(parsed.failed_image_type || ""))) {
        return res.status(400).json({ message: "Unsupported image signal" });
      }
      const trafficQuality = classifyDiscoveryRequest(req);
      const source = deriveDiscoverySourceEvidence(req);
      const actorType = discoveryRequestActorType(trafficQuality);
      await writeRecord({
        method: "EVENT", path: parsed.path, statusCode: 202, durationMs: 0,
        userId: null, sessionId: null, anonymousActorId: null,
        actorType, sourceType: actorType, eventType: parsed.type, surface: "public_profile",
        entityId: parsed.profile_id || null,
        entityType: parsed.profile_type === "location" ? "host" : parsed.profile_type || null,
        ip: null, userAgent: null,
        metadata: {
          type: parsed.type, profile_id: parsed.profile_id || null,
          profile_type: parsed.profile_type || null, path: parsed.path,
          missing_menu: parsed.missing_menu === true,
          missing_schedule: parsed.missing_schedule === true,
          failed_image_type: parsed.failed_image_type || null,
          timestamp: parsed.timestamp || new Date().toISOString(),
          trafficQuality, discoverySource: source.source, discoverySourceBasis: source.basis,
          evidenceKind: "client_reported_profile_quality",
        },
      });
      return res.status(202).json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid quality signal" });
      console.error("Error recording public profile quality signal:", error);
      return res.status(202).json({ ok: false });
    }
  });
}
