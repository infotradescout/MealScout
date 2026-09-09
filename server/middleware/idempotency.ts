import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

type Options = {
  scope: string;
  ttlMs?: number;
  lockMs?: number;
};

const localFallback = new Map<
  string,
  {
    requestHash: string;
    state: "processing" | "completed";
    expiresAt: number;
    statusCode?: number;
    responseBody?: any;
  }
>();

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function requestHashFor(req: Request) {
  const routePart = String(req.path || "");
  const bodyPart = stableStringify((req as any).body ?? {});
  return crypto.createHash("sha256").update(`${routePart}|${bodyPart}`).digest("hex");
}

function captureResponseBody(res: Response) {
  let capturedBody: any = undefined;
  const originalJson = res.json.bind(res) as any;
  (res as any).json = (body: any, ...args: any[]) => {
    capturedBody = body;
    return originalJson(body, ...args);
  };
  return () => capturedBody;
}

export function requireIdempotencyKey(options: Options) {
  const ttlMs = Math.max(60_000, Number(options.ttlMs || 24 * 60 * 60 * 1000));
  const lockMs = Math.max(5_000, Number(options.lockMs || 60_000));

  return async (req: Request, res: Response, next: NextFunction) => {
    const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
    if (!idempotencyKey) {
      return res.status(400).json({
        message: "Idempotency-Key header is required.",
        code: "missing_idempotency_key",
      });
    }

    const identityKey =
      String((req as any)?.user?.id || "").trim() || String(req.ip || "unknown").trim();
    const scope = `${options.scope}:${String(req.path || "")}`;
    const reqHash = requestHashFor(req);
    const lockedUntil = new Date(Date.now() + lockMs);
    const expiresAt = new Date(Date.now() + ttlMs);
    const localKey = `${scope}:${identityKey}:${idempotencyKey}`;

    try {
      const inserted: any = await db.execute(sql`
        INSERT INTO idempotency_keys (
          scope, identity_key, idem_key, request_hash, state, locked_until, expires_at, created_at, updated_at
        )
        VALUES (
          ${scope}, ${identityKey}, ${idempotencyKey}, ${reqHash}, 'processing', ${lockedUntil}, ${expiresAt}, now(), now()
        )
        ON CONFLICT (scope, identity_key, idem_key) DO NOTHING
        RETURNING id;
      `);

      const hasInsert = Array.isArray(inserted?.rows) && inserted.rows.length > 0;
      if (!hasInsert) {
        const existingRes: any = await db.execute(sql`
          SELECT request_hash, state, status_code, response_body, locked_until, expires_at
          FROM idempotency_keys
          WHERE scope = ${scope}
            AND identity_key = ${identityKey}
            AND idem_key = ${idempotencyKey}
          LIMIT 1;
        `);
        const existing = existingRes?.rows?.[0];
        if (!existing) return res.status(409).json({ message: "Request already processing." });

        if (String(existing.request_hash || "") !== reqHash) {
          return res.status(409).json({
            message: "Idempotency key reused with different request payload.",
            code: "idempotency_key_reuse_mismatch",
          });
        }

        const isCompleted = String(existing.state || "") === "completed";
        const notExpired = existing.expires_at ? new Date(existing.expires_at).getTime() > Date.now() : false;
        if (isCompleted && notExpired) {
          const code = Number(existing.status_code || 200);
          return res.status(code).json(existing.response_body ?? { ok: true });
        }

        const lockStillActive =
          existing.locked_until && new Date(existing.locked_until).getTime() > Date.now();
        if (lockStillActive) {
          return res.status(409).json({
            message: "A matching request is already in progress.",
            code: "request_in_progress",
          });
        }

        await db.execute(sql`
          UPDATE idempotency_keys
          SET request_hash = ${reqHash},
              state = 'processing',
              locked_until = ${lockedUntil},
              expires_at = ${expiresAt},
              updated_at = now()
          WHERE scope = ${scope}
            AND identity_key = ${identityKey}
            AND idem_key = ${idempotencyKey};
        `);
      }

      const getCaptured = captureResponseBody(res);
      res.on("finish", () => {
        const body = getCaptured();
        const bodyJson = body === undefined ? null : JSON.stringify(body);
        const continuationRequired = Number(res.statusCode || 200) === 202;
        const responseState = continuationRequired ? "processing" : "completed";
        const responseLock = continuationRequired ? new Date() : lockedUntil;
        void db.execute(sql`
          UPDATE idempotency_keys
          SET state = ${responseState},
              status_code = ${Number(res.statusCode || 200)},
              response_body = CASE WHEN ${bodyJson} IS NULL THEN NULL ELSE CAST(${bodyJson} AS jsonb) END,
              locked_until = ${responseLock},
              expires_at = ${expiresAt},
              updated_at = now()
          WHERE scope = ${scope}
            AND identity_key = ${identityKey}
            AND idem_key = ${idempotencyKey};
        `);
      });

      return next();
    } catch (_error) {
      // Safe in-memory fallback if table is not deployed yet.
      const entry = localFallback.get(localKey);
      const nowMs = Date.now();
      if (entry && entry.expiresAt > nowMs) {
        if (entry.requestHash !== reqHash) {
          return res.status(409).json({
            message: "Idempotency key reused with different request payload.",
            code: "idempotency_key_reuse_mismatch",
          });
        }
        if (entry.state === "completed") {
          return res.status(Number(entry.statusCode || 200)).json(entry.responseBody ?? { ok: true });
        }
        return res.status(409).json({
          message: "A matching request is already in progress.",
          code: "request_in_progress",
        });
      }

      localFallback.set(localKey, {
        requestHash: reqHash,
        state: "processing",
        expiresAt: nowMs + ttlMs,
      });
      const getCaptured = captureResponseBody(res);
      res.on("finish", () => {
        if (Number(res.statusCode || 200) === 202) {
          localFallback.delete(localKey);
          return;
        }
        const current = localFallback.get(localKey);
        if (!current) return;
        current.state = "completed";
        current.statusCode = Number(res.statusCode || 200);
        current.responseBody = getCaptured();
        current.expiresAt = Date.now() + ttlMs;
        localFallback.set(localKey, current);
      });

      return next();
    }
  };
}
