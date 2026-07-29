import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";

type Options = {
  scope: string;
  ttlMs?: number;
  lockMs?: number;
};

function stableStringify(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function requestHashFor(req: Request) {
  const routePart = String(req.path || "");
  const bodyPart = stableStringify((req as any).body ?? {});
  return crypto
    .createHash("sha256")
    .update(`${routePart}|${bodyPart}`)
    .digest("hex");
}

function shouldReleaseForRetry(statusCode: number) {
  return (
    statusCode >= 500 ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429
  );
}

function installDurableResponseGate(params: {
  res: Response;
  scope: string;
  persist: (statusCode: number, bodyJson: string | null) => Promise<void>;
}) {
  const originalJson = params.res.json.bind(params.res) as any;
  const originalSend = params.res.send.bind(params.res) as any;
  let responseStarted = false;
  let bypassGate = false;

  const sendAfterPersistence = (
    statusCode: number,
    bodyJson: string | null,
    send: () => Response,
  ) => {
    void params
      .persist(statusCode, bodyJson)
      .then(() => {
        bypassGate = true;
        send();
      })
      .catch(() => {
        console.error(
          "[idempotency] Failed to persist the completed response.",
          { scope: params.scope },
        );
        bypassGate = true;
        if (shouldReleaseForRetry(statusCode)) {
          send();
          return;
        }
        params.res.status(503);
        originalJson({
          message: "Request protection is temporarily unavailable.",
          code: "idempotency_unavailable",
        });
      });
    return params.res;
  };

  (params.res as any).json = (body: any, ...args: any[]) => {
    if (bypassGate || responseStarted) return originalJson(body, ...args);
    responseStarted = true;
    const statusCode = Number(params.res.statusCode || 200);
    return sendAfterPersistence(
      statusCode,
      body === undefined ? null : JSON.stringify(body),
      () => originalJson(body, ...args),
    );
  };

  (params.res as any).send = (body: any) => {
    if (bypassGate || responseStarted) return originalSend(body);
    responseStarted = true;
    const statusCode = Number(params.res.statusCode || 200);
    let bodyJson: string | null = null;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) {
        bodyJson = JSON.stringify(body.toString("utf8"));
      } else if (typeof body === "string") {
        bodyJson = JSON.stringify(body);
      } else {
        bodyJson = JSON.stringify(body);
      }
    }
    return sendAfterPersistence(statusCode, bodyJson, () => originalSend(body));
  };
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
      String((req as any)?.user?.id || "").trim() ||
      String(req.ip || "unknown").trim();
    const scope = `${options.scope}:${String(req.path || "")}`;
    const reqHash = requestHashFor(req);
    const lockedUntil = new Date(Date.now() + lockMs);
    const expiresAt = new Date(Date.now() + ttlMs);

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

      const hasInsert =
        Array.isArray(inserted?.rows) && inserted.rows.length > 0;
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
        if (!existing)
          return res
            .status(409)
            .json({ message: "Request already processing." });

        if (String(existing.request_hash || "") !== reqHash) {
          return res.status(409).json({
            message: "Idempotency key reused with different request payload.",
            code: "idempotency_key_reuse_mismatch",
          });
        }

        const isCompleted = String(existing.state || "") === "completed";
        const notExpired = existing.expires_at
          ? new Date(existing.expires_at).getTime() > Date.now()
          : false;
        if (isCompleted && notExpired) {
          const code = Number(existing.status_code || 200);
          return res.status(code).json(existing.response_body ?? { ok: true });
        }

        const lockStillActive =
          existing.locked_until &&
          new Date(existing.locked_until).getTime() > Date.now();
        if (lockStillActive) {
          return res.status(409).json({
            message: "A matching request is already in progress.",
            code: "request_in_progress",
          });
        }

        const claimed: any = await db.execute(sql`
          UPDATE idempotency_keys
          SET request_hash = ${reqHash},
              state = 'processing',
              locked_until = ${lockedUntil},
              expires_at = ${expiresAt},
              updated_at = now()
          WHERE scope = ${scope}
            AND identity_key = ${identityKey}
            AND idem_key = ${idempotencyKey}
            AND state = 'processing'
            AND locked_until <= now()
          RETURNING id;
        `);
        if (!Array.isArray(claimed?.rows) || claimed.rows.length !== 1) {
          return res.status(409).json({
            message: "A matching request is already in progress.",
            code: "request_in_progress",
          });
        }
      }

      installDurableResponseGate({
        res,
        scope,
        persist: async (statusCode, bodyJson) => {
          const responseBodySql =
            bodyJson === null ? sql`NULL` : sql`CAST(${bodyJson} AS jsonb)`;
          if (shouldReleaseForRetry(statusCode)) {
            await db.execute(sql`
              DELETE FROM idempotency_keys
              WHERE scope = ${scope}
                AND identity_key = ${identityKey}
                AND idem_key = ${idempotencyKey}
                AND state = 'processing'
                AND locked_until = ${lockedUntil};
            `);
          } else {
            const completed: any = await db.execute(sql`
              UPDATE idempotency_keys
              SET state = 'completed',
                  status_code = ${statusCode},
                  response_body = ${responseBodySql},
                  expires_at = ${expiresAt},
                  updated_at = now()
              WHERE scope = ${scope}
                AND identity_key = ${identityKey}
                AND idem_key = ${idempotencyKey}
                AND state = 'processing'
                AND locked_until = ${lockedUntil}
              RETURNING id;
            `);
            if (
              !Array.isArray(completed?.rows) ||
              completed.rows.length !== 1
            ) {
              throw new Error("Idempotency lease was lost before completion.");
            }
          }
        },
      });

      return next();
    } catch {
      console.error("[idempotency] Durable request protection unavailable.", {
        scope,
      });
      return res.status(503).json({
        message: "Request protection is temporarily unavailable.",
        code: "idempotency_unavailable",
      });
    }
  };
}
