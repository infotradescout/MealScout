import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

type Options = {
  scope: "parking_pass_booking";
  authorizeReplay: (req: Request) => Promise<boolean>;
  reconcile?: (req: Request, checkpoint: unknown) => Promise<{ statusCode: number; body: Record<string, unknown> } | null>;
};

function stableJson(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

/** Persistent request admission; no process-local fallback or lease takeover.
 * An unresolved request is blocked for reconciliation, never executed again.
 * All protected handlers must finish through res.json. Response bodies are
 * recorded BEFORE acknowledgement. This does not make external payments atomic.
 */
export function requireDurableIdempotencyKey(options: Options) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = String((req as any).user?.id || "").trim();
    if (!identity) return res.status(401).json({ message: "Sign in to continue." });
    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!key || key.length > 255) return res.status(400).json({
      code: !key ? "missing_idempotency_key" : "invalid_idempotency_key",
      message: "A valid Idempotency-Key header is required.",
    });
    const scope = `${options.scope}:${req.path}`;
    const hash = createHash("sha256").update(`${req.path}|${stableJson(req.body ?? {})}`).digest("hex");
    res.setHeader("Cache-Control", "no-store");
    const unresolved = () => res.status(409).json({
      code: "booking_request_unresolved", requestId: key,
      message: "This booking request needs reconciliation. Check My Schedule or contact support with this reference; do not start another payment.",
    });
    try {
      const inserted = await db.execute(sql`
        INSERT INTO idempotency_keys
          (scope, identity_key, idem_key, request_hash, state, locked_until, expires_at, created_at, updated_at)
        VALUES (${scope}, ${identity}, ${key}, ${hash}, 'processing',
          now() + interval '60 seconds', now() + interval '24 hours', now(), now())
        ON CONFLICT (scope, identity_key, idem_key) DO NOTHING RETURNING id;
      `);
      if (!Array.isArray(inserted?.rows)) throw new Error("Invalid request-store response");
      if (inserted.rows.length === 0) {
        const stored = await db.execute(sql`
          SELECT request_hash, state, status_code, response_body, locked_until, expires_at,
            expires_at > now() AS result_fresh, locked_until > now() AS lock_active
          FROM idempotency_keys
          WHERE scope = ${scope} AND identity_key = ${identity} AND idem_key = ${key};
        `);
        const row = stored?.rows?.[0];
        if (!row) return unresolved();
        if (row.request_hash !== hash) return res.status(409).json({
          code: "idempotency_key_reuse_mismatch", message: "This request reference belongs to different booking details.",
        });
        // Session authentication must run before this middleware. Permissions
        // can change after the first request, so cached results need fresh access.
        if (!(await options.authorizeReplay(req))) return res.status(403).json({
          code: "booking_replay_forbidden", message: "Booking access is no longer available for this account.",
        });
        if (row.result_fresh !== true) return unresolved();
        if (row.state === "completed" && row.response_body != null &&
            Number.isInteger(row.status_code) && row.status_code >= 200 && row.status_code <= 599) {
          return res.status(row.status_code).json(row.response_body);
        }
        if (row.state === "processing" && row.lock_active === true) {
          res.setHeader("Retry-After", "5");
          return res.status(409).json({ code: "request_in_progress", requestId: key,
            message: "The same booking request is still processing. Retry this reference shortly." });
        }
        // A stale request may recover from positive evidence, never re-run next().
        if (row.state === "processing" && row.response_body != null && options.reconcile) {
          const recovered = await options.reconcile(req, row.response_body);
          if (recovered) {
            if (!(await options.authorizeReplay(req))) return res.status(403).json({
              code: "booking_replay_forbidden", message: "Booking access is no longer available for this account.",
            });
            const encoded = JSON.stringify(recovered.body);
            const saved = await db.execute(sql`
              UPDATE idempotency_keys SET state = 'completed', status_code = ${recovered.statusCode},
                response_body = CAST(${encoded} AS jsonb), updated_at = now()
              WHERE scope = ${scope} AND identity_key = ${identity} AND idem_key = ${key}
                AND request_hash = ${hash} AND state = 'processing' AND expires_at > now()
                AND response_body = CAST(${JSON.stringify(row.response_body)} AS jsonb) RETURNING id;
            `);
            if (saved?.rows?.length === 1) return res.status(recovered.statusCode).json(JSON.parse(encoded));
          }
        }
        // A clock deadline cannot establish whether holds or an intent exist.
        return unresolved();
      }
    } catch {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ code: "booking_request_store_unavailable", requestId: key,
        message: "Booking recovery could not be verified. Keep this request reference and retry; do not start a new payment." });
    }

    const originalJson = res.json.bind(res);
    let recording = false;
    res.json = ((body: unknown) => {
      if (recording) return res;
      recording = true;
      const status = res.statusCode;
      // Serialize synchronously so subsequent handler mutations cannot change
      // either the saved receipt or the response sent to the caller.
      let encoded: string;
      try {
        encoded = JSON.stringify(body);
        if (encoded === undefined) throw new Error("Missing JSON response");
      } catch {
        res.status(503);
        return originalJson({ code: "booking_request_unresolved", requestId: key,
          message: "The booking result could not be recorded. Check the existing request before paying again." });
      }
      void (async () => {
        try {
          const saved = await db.execute(sql`
            UPDATE idempotency_keys SET
              state = CASE WHEN CAST(${status} AS integer) >= 400 AND response_body->>'kind' = 'parking_booking_holds_v1'
                THEN 'processing' ELSE 'completed' END,
              status_code = ${status},
              response_body = CASE WHEN CAST(${status} AS integer) >= 400 AND response_body->>'kind' = 'parking_booking_holds_v1'
                THEN response_body ELSE CAST(${encoded} AS jsonb) END,
              locked_until = CASE WHEN CAST(${status} AS integer) >= 400 AND response_body->>'kind' = 'parking_booking_holds_v1'
                THEN now() ELSE locked_until END,
              updated_at = now()
            WHERE scope = ${scope} AND identity_key = ${identity} AND idem_key = ${key}
              AND request_hash = ${hash} AND state = 'processing'
            RETURNING id;
          `);
          if (saved?.rows?.length !== 1) throw new Error("Receipt not recorded");
          if (!res.destroyed && !res.headersSent) { res.status(status); originalJson(JSON.parse(encoded)); }
        } catch {
          if (!res.destroyed && !res.headersSent) {
            res.status(503); originalJson({ code: "booking_request_unresolved", requestId: key,
              message: "The booking result could not be recorded. Retry the same reference or check My Schedule before paying again." });
          }
        }
      })();
      return res;
    }) as Response["json"];
    return next();
  };
}

/** Opaque provider key: retries of one admitted request use the same identity.
 * This is additional protection, not permission to bypass the durable guard.
 */
export function parkingBookingProviderKey(userId: string, route: string, requestId: string): string {
  if (![userId, route, requestId].every(value => typeof value === "string" && value.trim())) {
    throw new Error("Booking request identity is required");
  }
  return `parking-pass:${createHash("sha256").update(JSON.stringify([userId, route, requestId])).digest("hex")}`;
}
