import type { Request, Response, NextFunction } from "express";

/**
 * Middleware to verify MealScout action API token.
 * Accepts model-agnostic Bearer or action-token headers.
 */
export function verifyActionApiToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.header("Authorization");
  const token =
    authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ??
    req.header("x-action-token") ??
    req.header("x-mealscout-action-token") ??
    req.header("x-mealscout-token");

  if (!token) {
    return res.status(401).json({
      error: "Unauthorized",
      message:
        "Missing or invalid action token. Use Authorization: Bearer <token> or X-Action-Token: <token>.",
    });
  }

  const tokenList = collectConfiguredActionTokens();

  if (tokenList.length === 0) {
    console.error("⚠️  WARNING: Action token env var not configured in environment");
    return res.status(500).json({
      error: "Server configuration error",
      message:
        "MEALSCOUT_ACTION_TOKEN(S) (or legacy TRADESCOUT_API_TOKEN(S)) not configured",
    });
  }

  if (!tokenList.includes(String(token))) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid action token",
    });
  }

  next();
}

function collectConfiguredActionTokens(): string[] {
  const tokenEnvKeys = [
    "MEALSCOUT_ACTION_TOKENS",
    "MEALSCOUT_ACTION_TOKEN",
    "TRADESCOUT_API_TOKENS",
    "TRADESCOUT_API_TOKEN",
  ] as const;

  const seen = new Set<string>();
  const values: string[] = [];

  for (const key of tokenEnvKeys) {
    const raw = String(process.env[key] || "");
    if (!raw.trim()) continue;

    raw
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (seen.has(entry)) return;
        seen.add(entry);
        values.push(entry);
      });
  }

  return values;
}

/**
 * Optional: Rate limiting middleware for action routes
 * Limits requests per IP to prevent abuse
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimitActions(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute window
  const maxRequests = 100; // 100 requests per minute

  const current = requestCounts.get(ip);

  if (!current || now > current.resetAt) {
    requestCounts.set(ip, {
      count: 1,
      resetAt: now + windowMs,
    });
  } else {
    current.count++;

    if (current.count > maxRequests) {
      return res.status(429).json({
        error: "Too many requests",
        message: `Rate limit exceeded: ${maxRequests} requests per minute`,
        retryAfter: Math.ceil((current.resetAt - now) / 1000),
      });
    }
  }

  next();
}

export const verifyTradeScoutToken = verifyActionApiToken;
