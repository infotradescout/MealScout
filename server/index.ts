import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import passport from "passport";
import * as Sentry from "@sentry/node";
import { registerRoutes } from "./routes";
import { registerSchedulers, registerStaticPages, registerOperationalEndpoints } from "./bootstrap";
import actionRoutes from "./routes/actionRoutes";
import {
  verifyTradeScoutToken,
  rateLimitActions,
} from "./middleware/actionAuth";
import { storage } from "./storage";
import { setupWebSocketServer } from "./websocket";
import { antiScrape } from "./middleware/antiScrape";
import { getSession } from "./unifiedAuth";
import { distributedRateLimit } from "./middleware/distributedRateLimit";
import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { validateEnv } from "./utils/env";
import { healthRouter } from "./routes/health";
import { apiMetricsMiddleware, requestIdMiddleware } from "./observability";
import { runOpsDataCleanup } from "./opsCleanup";
import { runMarketplaceHealthAudit } from "./marketplaceHealth";
import { videoStories, restaurants, requestLogs } from "@shared/schema";
import { and, eq } from "drizzle-orm";

validateEnv();

const app = express();
const sentryDsn = process.env.SENTRY_DSN;
const sentryEnabled = Boolean(sentryDsn);

function resolveCanonicalBaseUrl() {
  const raw =
    process.env.PUBLIC_BASE_URL ||
    process.env.SERVICE_URL ||
    "https://www.mealscout.us";
  const withScheme = raw.startsWith("http://") || raw.startsWith("https://")
    ? raw
    : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    // Avoid redirect loops if env is set to the apex domain while edge redirects apex -> www.
    // Canonical for mealscout.us should always be www.mealscout.us.
    if (url.hostname.toLowerCase() === "mealscout.us") {
      url.hostname = "www.mealscout.us";
    }
    return url;
  } catch {
    return new URL("https://www.mealscout.us");
  }
}

const canonicalBaseUrl = resolveCanonicalBaseUrl().toString().replace(/\/+$/, "");
const trackingQueryKeys = new Set([
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "twclid",
  "dclid",
  "yclid",
  "mc_cid",
  "mc_eid",
]);
const privateNoIndexPrefixes = [
  "/admin",
  "/staff",
  "/profile",
  "/settings",
  "/orders",
  "/favorites",
  "/user-dashboard",
  "/restaurant-owner-dashboard",
  "/host/dashboard",
  "/event-coordinator/dashboard",
  "/supplier/dashboard",
  "/account-setup",
];

// Canonical redirect for SEO/indexing consistency (https + canonical host).
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();

  const canonical = resolveCanonicalBaseUrl();
  const canonicalHost = canonical.host.toLowerCase();
  const canonicalProto = canonical.protocol.replace(":", "").toLowerCase();

  const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  const reqHost = rawHost.toLowerCase();

  const rawProto = String(
    req.headers["x-forwarded-proto"] || (req as any).protocol || "",
  )
    .split(",")[0]
    .trim()
    .toLowerCase();
  const reqProto = rawProto || (req.secure ? "https" : "http");

  // Only enforce host redirects when we're on the mealscout.us family (avoid breaking preview domains).
  const shouldEnforceHost =
    canonicalHost.endsWith("mealscout.us") && reqHost.endsWith("mealscout.us");
  const needsHostRedirect =
    shouldEnforceHost && Boolean(reqHost) && reqHost !== canonicalHost;
  const needsProtoRedirect = Boolean(reqProto) && reqProto !== canonicalProto;

  if (needsHostRedirect || needsProtoRedirect) {
    const dest = `${canonicalProto}://${canonical.host}${req.originalUrl}`;
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.redirect(308, dest);
  }

  return next();
});

// Protect indexation quality while keeping affiliate/tracking params functional.
// We keep params working for attribution, but mark tracking/private URL variants noindex.
app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) return next();

  const pathValue = String(req.path || "/");
  const isApiOrAsset =
    pathValue.startsWith("/api/") ||
    pathValue.startsWith("/assets/") ||
    pathValue.startsWith("/static/") ||
    pathValue.startsWith("/@") ||
    /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|map|txt|xml)$/i.test(pathValue);
  if (isApiOrAsset) return next();

  const requestUrl = new URL(req.originalUrl || req.url || "/", canonicalBaseUrl);
  const hasTrackingParams = Array.from(requestUrl.searchParams.keys()).some((key) =>
    trackingQueryKeys.has(String(key).toLowerCase()),
  );
  const isPrivatePath = privateNoIndexPrefixes.some((prefix) =>
    pathValue.toLowerCase().startsWith(prefix),
  );

  if (hasTrackingParams || isPrivatePath) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }

  if (hasTrackingParams) {
    const canonical = new URL(`${requestUrl.pathname}${requestUrl.search}`, canonicalBaseUrl);
    const cleaned = new URLSearchParams();
    requestUrl.searchParams.forEach((value, key) => {
      if (!trackingQueryKeys.has(String(key).toLowerCase())) {
        cleaned.append(key, value);
      }
    });
    canonical.search = cleaned.toString() ? `?${cleaned.toString()}` : "";
    res.setHeader("Link", `<${canonical.toString()}>; rel="canonical"`);
  }

  return next();
});

// Minimal cookie parser (avoids adding a dependency). Several auth + affiliate flows rely on `req.cookies`.
app.use(requestIdMiddleware());
app.use(apiMetricsMiddleware());

app.use((req: any, _res, next) => {
  const header = String(req.headers?.cookie || "");
  const cookies: Record<string, string> = {};
  if (header) {
    header.split(";").forEach((part: string) => {
      const idx = part.indexOf("=");
      if (idx <= 0) return;
      const key = part.slice(0, idx).trim();
      const rawVal = part.slice(idx + 1).trim();
      if (!key) return;
      try {
        cookies[key] = decodeURIComponent(rawVal);
      } catch {
        cookies[key] = rawVal;
      }
    });
  }
  req.cookies = cookies;
  next();
});

// ---- CORS (required for www.mealscout.us -> mealscout.onrender.com) ----
const defaultOrigins = [
  "https://www.mealscout.us",
  "https://mealscout.us",
  "https://mealscout.onrender.com",
  "https://meal-scout.vercel.app",
  "http://localhost:5174",
  "http://localhost:5200",
  "http://localhost:5000",
  "http://127.0.0.1:5200",
  "http://127.0.0.1:5000",
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,PUT,DELETE,OPTIONS"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Basic CSRF guard: require same-origin for state-changing requests.
const csrfSafeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
app.use((req, res, next) => {
  if (csrfSafeMethods.has(req.method)) {
    return next();
  }

  // /api/actions is a server-to-server integration surface (Bearer token auth),
  // so it must not require browser Origin/Referer headers.
  if (String(req.path || "").startsWith("/api/actions")) {
    return next();
  }

  const originHeader = (req.headers.origin || req.headers.referer) as
    | string
    | undefined;
  if (!originHeader) {
    return res.status(403).json({ message: "Invalid origin" });
  }

  let requestOrigin: string | null = null;
  try {
    requestOrigin = new URL(originHeader).origin;
  } catch {
    requestOrigin = null;
  }

  if (!requestOrigin) {
    return res.status(403).json({ message: "Invalid origin" });
  }

  const isAllowed = allowedOrigins.includes(requestOrigin);
  if (!isAllowed) {
    return res.status(403).json({ message: "Invalid origin" });
  }

  next();
});

if (sentryEnabled) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || "development",
  });

  const sentryHandlers = (Sentry as any).Handlers;
  if (sentryHandlers?.requestHandler) {
    app.use(sentryHandlers.requestHandler());
  }
}

// Enhanced graceful shutdown handling
let isShuttingDown = false;

const triggerFatalShutdown = (label: string, error: unknown) => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  console.error(`[fatal] ${label}:`, normalizedError);
  if (normalizedError.stack) {
    console.error(normalizedError.stack);
  }
  // Give logs a moment to flush before terminating the process.
  setTimeout(() => process.exit(1), 250).unref();
};

process.on("uncaughtException", (error) => {
  triggerFatalShutdown("uncaughtException", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[fatal] Unhandled Promise Rejection at:", promise);
  triggerFatalShutdown("unhandledRejection", reason);
});

const gracefulShutdown = (signal: string) => {
  if (isShuttingDown) {
    console.log(`🔄 ${signal} received again. Forcing immediate shutdown...`);
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`🔄 ${signal} received. Initiating graceful shutdown...`);

  // Give the server a few seconds to finish processing current requests
  setTimeout(() => {
    console.log("✅ Graceful shutdown completed");
    process.exit(0);
  }, 5000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Add warning handler for potential memory leaks
process.on("warning", (warning) => {
  if (warning.name === "MaxListenersExceededWarning") {
    console.warn("⚠️  Memory leak warning:", warning.message);
    console.warn("🔍 Consider investigating event listener usage");
  }
});

// Production security and performance middleware
if (process.env.NODE_ENV === "production") {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https:", "ws:", "wss:"],
          fontSrc: ["'self'", "https:", "data:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
}

// Anti-scrape middleware: allow TradeScout crawler, block obvious scrapers
app.use(antiScrape);

// Request logging for admin reporting (skip static assets)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const pathValue = req.originalUrl || req.url || "";
    if (
      pathValue.startsWith("/assets") ||
      pathValue.startsWith("/favicon") ||
      pathValue.startsWith("/static") ||
      pathValue.startsWith("/_next") ||
      pathValue.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|map)$/i)
    ) {
      return;
    }
    const durationMs = Date.now() - start;
    const userId = (req as any).user?.id || null;
      void db
        .insert(requestLogs)
        .values({
          method: req.method,
          path: pathValue,
          statusCode: res.statusCode || 0,
          durationMs,
          userId,
          ip: req.ip,
          userAgent: req.get("user-agent") || null,
          createdAt: new Date(),
        })
        .catch((error: unknown) => {
          console.error("Failed to write request log:", error);
        });
    });
  next();
});

// Basic health endpoints (no auth)
app.use(healthRouter);

// CSP for development - permissive to allow Vite HMR and inline scripts
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' data: https: http: blob:; " +
        "style-src 'self' 'unsafe-inline' https:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http:; " +
        "connect-src 'self' https: http: wss: ws: " +
        "https://geocoding.census.gov " +
        "https://api.zippopotam.us " +
        "https://api.bigdatacloud.net " +
        "https://nominatim.openstreetmap.org " +
        "https://ipapi.co; " +
        "img-src 'self' data: https: blob:; " +
        "font-src 'self' https: data:; " +
        "worker-src 'self' blob:;"
    );
    next();
  });
}

// RATE LIMIT POLICIES - Optimized per endpoint type
// Strategy: "Fast first click, slow spam" - generous for normal users, strict for attackers

// 1. Authentication endpoints - Very strict (prevent brute force)
const strictAuthLimiter = distributedRateLimit({
  scope: "auth:strict",
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 3, // 3 attempts max
  key: (req) => `${req.ip || "unknown"}:${req.path}`,
});

// 2. General authentication (moderate)
const authLimiter = distributedRateLimit({
  scope: "auth:moderate",
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 attempts
  key: (req) => `${req.ip || "unknown"}:${req.path}`,
});

// 3. Search and discovery (generous for normal users)
const searchLimiter = distributedRateLimit({
  scope: "search:discovery",
  windowMs: 60 * 1000, // 1 minute
  limit: 50, // 50 searches per minute
  key: (req) => req.ip || "unknown",
});

// 4. Deal views and engagement (very generous)
const viewLimiter = distributedRateLimit({
  scope: "deals:views",
  windowMs: 60 * 1000, // 1 minute
  limit: 120, // 120 views per minute
  key: (req) => req.ip || "unknown",
});

// 5. Content updates (strict for restaurant owners)
const updateLimiter = distributedRateLimit({
  scope: "content:updates",
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10, // 10 edits per hour
  key: (req) =>
    req.user?.id ? `${req.user.id}:${req.path}` : `${req.ip}:${req.path}`, // Per-user limit with IP fallback for anonymous traffic
});

// Wrap a limiter so it only applies to mutation methods
function onlyMutations(limiter: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS"
    ) {
      return next();
    }
    return limiter(req, res, next);
  };
}

function excludePaths(limiter: any, patterns: RegExp[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (patterns.some((pattern) => pattern.test(req.path))) {
      return next();
    }
    return limiter(req, res, next);
  };
}

const dealUpdateLimiter = excludePaths(onlyMutations(updateLimiter), [
  /^\/[^/]+\/view\/?$/,
]);

// 6. General API (moderate baseline)
const apiLimiter = distributedRateLimit({
  scope: "api:general",
  windowMs: 60 * 1000, // 1 minute
  limit: 30, // 30 requests per window
  key: (req) => req.ip || "unknown",
});

// Body parsing with size limits (keep Stripe webhook raw for signature verification)
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook") return next();
  return express.json({ limit: "10mb" })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook") return next();
  return express.urlencoded({ extended: false, limit: "10mb" })(req, res, next);
});

const REDACTED_LOG_KEYS = new Set([
  "passwordHash",
  "googleAccessToken",
  "facebookAccessToken",
  "tradescoutId",
  "stripeCustomerId",
  "stripeSubscriptionId",
]);

const redactLogPayload = (payload: unknown): string => {
  if (!payload) return "";
  try {
    return JSON.stringify(payload, (key, value) =>
      REDACTED_LOG_KEYS.has(key) ? "[redacted]" : value
    );
  } catch {
    return "[unserializable]";
  }
};

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      if (process.env.NODE_ENV === "production") {
        if (path === "/api/health") {
          return;
        }
        if (path === "/api/hosts/me" && res.statusCode === 401) {
          return;
        }
        const slowMs = Number(process.env.API_LOG_SLOW_MS || 1500) || 1500;
        const verbose =
          String(process.env.API_LOG_VERBOSE || "").toLowerCase() === "true";
        const shouldLog =
          verbose || res.statusCode >= 500 || duration >= slowMs;
        if (!shouldLog) {
          return;
        }
      }
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const redactedPayload = redactLogPayload(capturedJsonResponse);
      if (redactedPayload) {
        logLine += ` :: ${redactedPayload}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      console.log(logLine);
    }
  });

  next();
});

(async () => {
  // Basic database connection test - non-blocking to prevent health check failures
  try {
    await db.execute(sql`SELECT 1 as test`);
    console.log("✅ Database connection established successfully");
  } catch (error) {
    console.warn(
      "⚠️  Warning: Could not connect to database during startup:",
      error instanceof Error ? error.message : String(error)
    );
    console.log(
      "🚀 Server will continue starting, database initialization will be performed after startup"
    );

    // Log connection details for debugging (without exposing credentials)
    if (process.env.DATABASE_URL) {
      const dbUrl = process.env.DATABASE_URL.replace(/\/\/.*@/, "//***:***@");
      console.log("📋 Database URL format:", dbUrl);
    } else {
      console.warn("⚠️  DATABASE_URL environment variable not set");
    }
  }

  // Setup session configuration before routes
  // Trust first proxy so req.secure is honored behind Vercel/Render and Secure cookies are set
  app.set("trust proxy", 1);
  if (process.env.NODE_ENV === "production") {
    console.log("🌐 trust proxy enabled");
  }
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Debug endpoint to verify session/cookie forwarding after redirects
  app.get("/api/debug/session", (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    res.json({
      sessionID: req.sessionID || null,
      user: req.user || null,
      cookie: req.headers?.cookie || null,
      isAuthenticated:
        typeof req.isAuthenticated === "function"
          ? req.isAuthenticated()
          : false,
    });
  });

  // Apply granular rate limiting - optimized per endpoint

  // 🔒 STRICT - Authentication (prevent brute force)
  app.use("/api/auth/forgot-password", strictAuthLimiter);
  app.use("/api/auth/reset-password", strictAuthLimiter);

  // 🔐 MODERATE - Auth attempts (login, signup)
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/signup", authLimiter);
  app.use("/api/auth/resend-verification", authLimiter);
  app.use("/api/auth/tradescout/sso", authLimiter);

  // 🔍 GENEROUS - Search and discovery
  app.use("/api/restaurants/search", searchLimiter);
  app.use("/api/restaurants/nearby", searchLimiter);
  app.use("/api/search", searchLimiter);

  // 👀 VERY GENEROUS - Deal views (engagement tracking)
  app.use("/api/deals/:dealId/view", viewLimiter);
  app.use("/api/restaurants/:restaurantId/locations", viewLimiter);

  // ✏️  STRICT - Content updates (prevent spam editing)
  app.use("/api/deals", dealUpdateLimiter);
  app.use("/api/restaurants/:restaurantId/location", updateLimiter);
  app.use("/api/restaurants/:restaurantId/operating-hours", updateLimiter);
  app.use("/api/restaurants/:restaurantId/mobile-settings", updateLimiter);

  // 📞 MODERATE - General API and reports
  app.use("/api/bug-report", apiLimiter);

  // OAuth normalization middleware - DISABLED because it breaks OAuth flow
  // The redirect was interfering with the Passport.js OAuth flow by redirecting before authentication
  // OAuth works correctly as long as callback URLs are properly configured in Google Cloud Console
  // app.use((req, res, next) => {
  //   const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  //   if (publicBaseUrl && req.path.startsWith('/api/auth/google')) {
  //     const canonicalHost = new URL(publicBaseUrl).hostname;
  //     if (req.hostname !== canonicalHost) {
  //       const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  //       const redirectUrl = `${publicBaseUrl}${req.path}${queryString}`;
  //       log(`Redirecting Google OAuth ${req.hostname} to canonical domain: ${redirectUrl}`);
  //       return res.redirect(307, redirectUrl);
  //     }
  //   }
  //   next();
  // });

  //       return res.redirect(302, redirectUrl);
  //     }
  //   }
  //   next();
  // });

  // Crawler-friendly static HTML routes for Facebook/Google compliance
  // MUST be registered before any SPA routing or Vite middleware
  app.get("/privacy-policy", (_req, res) => {
    console.log("🔍 Privacy policy route HIT");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - MealScout</title>
  <meta name="description" content="Learn how MealScout collects, uses, and protects your personal information.">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #2563eb; border-bottom: 3px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 30px; }
    h3 { color: #1e3a8a; }
    .section { margin: 20px 0; }
    ul { margin: 10px 0; padding-left: 25px; }
    .highlight { background: #eff6ff; padding: 15px; border-left: 4px solid #2563eb; margin: 15px 0; }
    .contact { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p><strong>Last updated: January 13, 2025</strong></p>
  <p>How MealScout collects, uses, and protects your personal information.</p>

  <div class="section">
    <h2>1. Information We Collect</h2>
    <p>We collect information you provide directly to us, information we obtain automatically when you use our Service, and information from third parties.</p>

    <div class="highlight">
      <h3>Personal Information:</h3>
      <ul>
        <li>Name and email address (from account registration)</li>
        <li>Profile information from Google/Facebook OAuth</li>
        <li>Business information (for restaurant owners)</li>
        <li>Payment information (processed securely via Stripe)</li>
      </ul>
    </div>

    <div class="highlight">
      <h3>Location Data:</h3>
      <ul>
        <li>GPS coordinates for deal discovery</li>
        <li>Real-time location for food truck tracking</li>
        <li>Address information for business verification</li>
      </ul>
    </div>
  </div>

  <div class="section">
    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>Provide, maintain, and improve our Service</li>
      <li>Provide location-based deal recommendations</li>
      <li>Process subscription payments and billing</li>
      <li>Enable real-time food truck tracking</li>
      <li>Verify business credentials and documents</li>
      <li>Send important service communications and updates</li>
      <li>Monitor and analyze trends, usage, and activities</li>
      <li>Detect, investigate, and prevent fraudulent activities</li>
      <li>Personalize and improve your experience</li>
    </ul>
  </div>

  <div class="section">
    <h2>3. Information Sharing</h2>
    <p>We may share your information in the following situations:</p>
    <ul>
      <li><strong>With Business Partners:</strong> General location data with restaurants</li>
      <li><strong>With Service Providers:</strong> Third-party payment processing and analytics</li>
      <li><strong>For Legal Requirements:</strong> When required by law or legal process</li>
      <li><strong>With Your Consent:</strong> When you explicitly agree</li>
      <li><strong>Aggregated Data:</strong> De-identified data that cannot be linked to individuals</li>
    </ul>
    <p><strong>We do not sell, trade, or rent your personal information to third parties.</strong></p>
  </div>

  <div class="section">
    <h2>4. Third-Party Services</h2>
    <p>Our Service integrates with:</p>
    <ul>
      <li><strong>Google OAuth:</strong> For secure authentication</li>
      <li><strong>Facebook Login:</strong> For social authentication</li>
      <li><strong>Stripe:</strong> For secure payment processing</li>
      <li><strong>BigDataCloud:</strong> For location geocoding services</li>
    </ul>
  </div>

  <div class="section">
    <h2>5. Data Security</h2>
    <p>We implement appropriate technical and organizational measures including:</p>
    <ul>
      <li>Encryption of data in transit and at rest</li>
      <li>Regular security assessments and updates</li>
      <li>Access controls and authentication requirements</li>
      <li>Secure payment processing through PCI-compliant providers</li>
      <li>Regular backups and disaster recovery procedures</li>
    </ul>
  </div>

  <div class="section">
    <h2>6. Your Rights</h2>
    <ul>
      <li>Access and update your personal information</li>
      <li>Delete your account and associated data</li>
      <li>Control location services through device settings</li>
      <li>Unsubscribe from marketing communications</li>
      <li>Request data portability (GDPR)</li>
      <li>Opt-out of data sale/sharing (CCPA)</li>
    </ul>
  </div>

  <div class="section">
    <h2>7. Data Retention</h2>
    <ul>
      <li><strong>Account Information:</strong> Until deletion, plus 30 days</li>
      <li><strong>Payment Information:</strong> As required by law (typically 7 years)</li>
      <li><strong>Location Data:</strong> Anonymized after 90 days</li>
      <li><strong>Analytics Data:</strong> Aggregated data may be retained indefinitely</li>
    </ul>
  </div>

  <div class="section">
    <h2>8. Contact Us</h2>
    <div class="contact">
      <p><strong>Email:</strong> <a href="mailto:info.mealscout@gmail.com">info.mealscout@gmail.com</a></p>
      <p><strong>Phone:</strong> <a href="tel:+19856626247">(985) 662-6247</a></p>
      <p>We will respond to your inquiry within 30 days.</p>
    </div>
  </div>

  <p style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280;">
    <small>This Privacy Policy is compliant with GDPR, CCPA/CPRA, and other major privacy regulations.</small>
  </p>

  <p style="text-align: center; margin-top: 30px;">
    <a href="${canonicalBaseUrl}" style="color: #2563eb; text-decoration: none;">← Back to MealScout</a>
  </p>
</body>
</html>
    `);
  });

  // Crawler-friendly SSR route for video transcripts
  // Serves initial HTML with transcript and VideoObject JSON-LD for /video/:id
  app.get("/video/:storyId", async (req, res) => {
    try {
      // Minimal HTML escaping helper scoped to this handler
      const escapeHtml = (input: string) =>
        input
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const { storyId } = req.params as { storyId: string };

      const storyRows = await db
        .select()
        .from(videoStories)
        .where(eq(videoStories.id, storyId))
        .limit(1);

      if (!storyRows.length) {
        res.status(404).set("Content-Type", "text/html; charset=utf-8").send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Video Not Found | MealScout</title>
              <link rel="canonical" href="${canonicalBaseUrl}/video/${storyId}">
            </head>
            <body>
              <h1>Video Not Found</h1>
              <p>The requested video could not be found.</p>
            </body>
          </html>
        `);
        return;
      }

      const story = storyRows[0] as any;

      const restaurantRows = story.restaurantId
        ? await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, story.restaurantId))
            .limit(1)
        : [];
      const restaurant = restaurantRows[0] as any;

      const title = story.title || "Food Recommendation";
      const description =
        story.description ||
        `Watch ${title} - a local food recommendation on MealScout`;
      const canonical = `${canonicalBaseUrl}/video/${storyId}`;

      const schema = {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: title,
        description,
        contentUrl: story.videoUrl || undefined,
        uploadDate: story.createdAt
          ? new Date(story.createdAt).toISOString()
          : undefined,
        transcript: story.transcript || undefined,
      };

      const transcriptHtml = story.transcript
        ? `<details open>
             <summary>Transcript</summary>
             <div class="transcript">${escapeHtml(
               String(story.transcript)
             )}</div>
           </details>`
        : "";

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${escapeHtml(title)} ${
        restaurant?.name ? `at ${escapeHtml(restaurant.name)}` : ""
      } - Video | MealScout</title>
            <meta name="description" content="${escapeHtml(description)}">
            <link rel="canonical" href="${canonical}">
            <script type="application/ld+json">${JSON.stringify(
              schema
            )}</script>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 16px; }
              .player { background: #000; aspect-ratio: 9/16; width: 100%; }
              .transcript { white-space: pre-wrap; line-height: 1.6; margin-top: 8px; }
            </style>
          </head>
          <body>
            <h1>${escapeHtml(title)}</h1>
            ${description ? `<p>${escapeHtml(description)}</p>` : ""}
            <div class="player"></div>
            ${transcriptHtml}
          </body>
        </html>
      `);
    } catch (err) {
      console.error("Error rendering video SSR route:", err);
      res.status(500).set("Content-Type", "text/html; charset=utf-8").send(`
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Server Error | MealScout</title>
          </head>
          <body>
            <h1>Server Error</h1>
            <p>Unable to render video page.</p>
          </body>
        </html>
      `);
    }
  });

  app.get("/data-deletion", (_req, res) => {
    console.log("🔍 Data deletion route HIT");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Deletion Instructions - MealScout</title>
  <meta name="description" content="Learn how to request deletion of your personal data from MealScout.">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #dc2626; border-bottom: 3px solid #dc2626; padding-bottom: 10px; }
    h2 { color: #b91c1c; margin-top: 30px; }
    .section { margin: 20px 0; }
    ul, ol { margin: 10px 0; padding-left: 25px; }
    .highlight { background: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }
    .contact { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .warning { background: #fef3c7; padding: 10px; border-left: 4px solid #f59e0b; margin: 15px 0; }
  </style>
</head>
<body>
  <h1>Data Deletion Instructions</h1>
  <p><strong>Last updated: January 13, 2025</strong></p>
  <p>How to request deletion of your personal data from MealScout</p>

  <div class="section">
    <h2>Quick Account Deletion</h2>
    <p>You can delete your MealScout account directly from your profile settings:</p>

    <div class="highlight">
      <h3>Self-Service Deletion:</h3>
      <ol>
        <li>Log into your MealScout account</li>
        <li>Navigate to Profile → Settings</li>
        <li>Scroll to "Account Management"</li>
        <li>Click "Delete Account"</li>
        <li>Confirm deletion by typing your email address</li>
      </ol>
      <p class="warning">⚠️ This action is permanent and cannot be undone.</p>
    </div>
  </div>

  <div class="section">
    <h2>Manual Deletion Request</h2>
    <p>If you're unable to access your account, contact us directly:</p>

    <div class="contact">
      <h3>Contact Information:</h3>
      <p><strong>Email:</strong> <a href="mailto:privacy@mealscout.com">privacy@mealscout.com</a></p>
      <p><strong>General Support:</strong> <a href="mailto:info.mealscout@gmail.com">info.mealscout@gmail.com</a></p>
      <p><strong>Subject Line:</strong> "Data Deletion Request"</p>
    </div>
  </div>

  <div class="section">
    <h2>Required Information</h2>
    <p>To process your deletion request, please provide:</p>
    <ul>
      <li>Full name associated with your account</li>
      <li>Email address used for registration</li>
      <li>Phone number (if provided)</li>
      <li>Reason for deletion (optional but helpful)</li>
      <li>Any additional account identifiers</li>
    </ul>
  </div>

  <div class="section">
    <h2>What Gets Deleted</h2>
    <div class="highlight">
      <h3>Personal Data Removed:</h3>
      <ul>
        <li>Profile information and photos</li>
        <li>Email address and contact details</li>
        <li>Location data and preferences</li>
        <li>Order history and favorites</li>
        <li>Reviews and ratings</li>
        <li>Payment information</li>
        <li>Communication records</li>
      </ul>
    </div>

    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
      <h3>Data We May Retain:</h3>
      <ul>
        <li>Anonymous usage analytics</li>
        <li>Financial records (tax requirements)</li>
        <li>Legal compliance data</li>
        <li>Fraud prevention records</li>
      </ul>
      <p><small>*Retained data is anonymized and cannot be linked back to you</small></p>
    </div>
  </div>

  <div class="section">
    <h2>Deletion Timeline</h2>
    <div class="highlight">
      <ol>
        <li><strong>Immediate:</strong> Account access disabled</li>
        <li><strong>Within 7 days:</strong> Personal data removed from active systems</li>
        <li><strong>Within 30 days:</strong> Data purged from backups</li>
        <li><strong>Confirmation:</strong> Email notification when deletion is complete</li>
      </ol>
    </div>
  </div>

  <div class="section">
    <h2>Facebook Login Data</h2>
    <p>If you signed up using Facebook Login, deleting your MealScout account will:</p>
    <ul>
      <li>Remove all data MealScout obtained from Facebook</li>
      <li>Revoke MealScout's access to your Facebook account</li>
      <li>Delete any Facebook-sourced profile information</li>
      <li>Remove integration with Facebook's sharing features</li>
    </ul>
    <p><small>Note: This does not affect your Facebook account itself. To fully disconnect, also revoke MealScout's permissions in your Facebook app settings.</small></p>
  </div>

  <div class="section">
    <h2>Need Help?</h2>
    <div class="contact">
      <p><strong>Privacy Team:</strong> privacy@mealscout.com</p>
      <p><strong>Support Team:</strong> info.mealscout@gmail.com</p>
      <p>We typically respond to deletion requests within 1-2 business days.</p>
    </div>
  </div>

  <p style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280;">
    <small>This page complies with GDPR, CCPA, and other privacy regulations. You have the right to request deletion of your personal data at any time.</small>
  </p>

  <p style="text-align: center; margin-top: 30px;">
    <a href="${canonicalBaseUrl}" style="color: #dc2626; text-decoration: none;">← Back to MealScout</a>
  </p>
</body>
</html>
    `);
  });

  // ==================== ACTION API FOR TRADESCOUT LLM ====================
  // Unified endpoint that TradeScout LLM calls to perform actions
  // Requires authentication via TRADESCOUT_API_TOKEN
  app.use(
    "/api/actions",
    rateLimitActions,
    verifyTradeScoutToken,
    actionRoutes
  );

  // Capture affiliate `?ref=` on *all* requests before the SPA/static handlers run.
  // This is required so referral attribution works even when the first page hit is the frontend.
  app.use(async (req: any, res: any, next: any) => {
    const ref = typeof req.query?.ref === "string" ? req.query.ref.trim() : "";
    if (!ref) return next();

    // Avoid recording for obvious static asset hits.
    const pathValue = String(req.path || "");
    if (
      pathValue.startsWith("/assets") ||
      pathValue.startsWith("/favicon") ||
      pathValue.startsWith("/static") ||
      pathValue.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|map)$/i)
    ) {
      return next();
    }

    let referralRecordId: string | null = null;
    try {
      const { resolveAffiliateUserId } = await import("./affiliateTagService");
      const { recordReferralClick } = await import("./referralService");
      const affiliateUserId = await resolveAffiliateUserId(ref);

      if (affiliateUserId) {
        const result = await recordReferralClick(
          affiliateUserId,
          req.originalUrl || "/",
          req.get("user-agent") || undefined,
          req.ip || undefined,
        );
        referralRecordId = result?.referralId || null;
      }
    } catch (error) {
      console.error("[affiliate] Failed to record referral click:", error);
    }

    res.cookie("referralId", ref, {
      maxAge: 1000 * 60 * 60 * 24 * 365,
      httpOnly: false,
      sameSite: "lax",
    });
    if (referralRecordId) {
      res.cookie("referralRecordId", referralRecordId, {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: "lax",
      });
    }

    return next();
  });

  const server = await registerRoutes(app);

  // Bootstrap: static/compliance pages, schedulers, and operational endpoints
  // These are extracted from routes.ts as part of backend refactor Phase 1.
  registerStaticPages(app);
  registerOperationalEndpoints(app);
  await registerSchedulers(app);

  // Setup WebSocket server for food truck GPS tracking
  setupWebSocketServer(server);
  console.log("[express] WebSocket server initialized for food truck tracking");

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log error for debugging
    console.error("❌ Express error middleware:", err);
    if (sentryEnabled) {
      Sentry.captureException(err);
    }

    // Send response if not already sent
    if (!res.headersSent) {
      res.status(status).json({ message });
    }

    // Don't throw after responding to avoid triggering uncaughtException
    // In production, log and continue; in development, we can be more strict
    if (process.env.NODE_ENV !== "production") {
      console.error("💥 Development error - check logs above");
    }
  });

  // Root endpoint health guard - handles health checks while preserving SPA functionality
  app.use("/", (req, res, next) => {
    // Only handle root path, let other paths go through
    if (req.path !== "/") {
      return next();
    }

    // Handle HEAD requests (common for health checks) - always return 200
    if (req.method === "HEAD") {
      return res.status(200).end();
    }

    // Handle GET requests based on Accept header
    if (req.method === "GET") {
      const acceptHeader = req.get("Accept") || "";

      // If not requesting HTML, return JSON status (for API health checks)
      if (!acceptHeader.includes("text/html")) {
        return res.status(200).json({
          status: "ok",
          service: "MealScout API",
          timestamp: new Date().toISOString(),
        });
      }

      // For HTML requests in development, always let Vite handle it
      if (app.get("env") === "development") {
        return next();
      }

      // For HTML requests in production, check if built frontend exists
      // Use the same path logic as serveStatic function in vite.ts
      const indexPath = path.resolve(
        process.cwd(),
        "dist",
        "public",
        "index.html"
      );

      if (fs.existsSync(indexPath)) {
        // SPA build exists, let serveStatic handle it
        return next();
      } else {
        // No build available, return minimal HTML fallback with 200 status
        res.status(200).set({
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        }).send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>MealScout</title>
            </head>
            <body>
              <h1>MealScout</h1>
              <p>Service is running successfully.</p>
              <p>Status: OK</p>
              <p><a href="/health">Health Check</a></p>
            </body>
          </html>
        `);
        return;
      }
    }

    // For other methods, continue to next middleware
    next();
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite.js");
    await setupVite(app, server);
  } else {
    const distPath = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(distPath)) {
      const { serveStatic } = await import("./vite.js");
      serveStatic(app);
    } else {
      console.warn(
        "No frontend build detected at dist/public; serving API-only."
      );
    }
  }
  // Production: frontend is served by Vercel, backend is API-only

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5200 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5200", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      console.log(`[express] serving on port ${port}`);

      // Initialize database data after server startup - truly non-blocking
      setImmediate(async () => {
        try {
          await storage.ensureAdminExists();

          // Never seed fake content unless explicitly enabled for local development.
          const seedEnabled =
            process.env.NODE_ENV === "development" &&
            String(process.env.SEED_DEV_DATA || "").toLowerCase() === "true";
          if (seedEnabled) {
            await storage.seedDevelopmentData();
          } else {
            console.log(
              "[seed] Development seed disabled. Set SEED_DEV_DATA=true (and NODE_ENV=development) to enable.",
            );
          }
          console.log("✅ Database initialization completed successfully");
        } catch (error) {
          console.warn(
            "⚠️  Warning: Could not initialize storage after startup:",
            error instanceof Error ? error.message : String(error)
          );
          console.warn(
            "⚠️  Some features may not work properly until database is initialized"
          );
        }
      });

      const enableSessionCleanup =
        process.env.SESSION_CLEANUP_ENABLED !== "false";
      if (enableSessionCleanup) {
        const cleanupIntervalMs = 6 * 60 * 60 * 1000; // 6 hours
        const runSessionCleanup = async () => {
          try {
            await db.execute(sql`delete from sessions where expire < now()`);
            console.log("✅ Session cleanup completed");
          } catch (error) {
            console.warn(
              "⚠️  Session cleanup failed (non-blocking):",
              error instanceof Error ? error.message : String(error),
            );
          }
        };

        setTimeout(() => {
          void runSessionCleanup();
          setInterval(runSessionCleanup, cleanupIntervalMs);
        }, 30_000);
      }

      const enableOpsCleanup = process.env.OPS_CLEANUP_ENABLED !== "false";
      if (enableOpsCleanup) {
        const cleanupIntervalRaw = Number(
          process.env.OPS_CLEANUP_INTERVAL_MINUTES || 30,
        );
        const cleanupIntervalMinutes = Number.isFinite(cleanupIntervalRaw)
          ? Math.max(5, Math.floor(cleanupIntervalRaw))
          : 30;
        const cleanupIntervalMs = cleanupIntervalMinutes * 60 * 1000;
        const runCleanup = async () => {
          const result = await runOpsDataCleanup();
          if (!result.ok) {
            console.warn(
              "⚠️  Ops cleanup failed (non-blocking):",
              result.error || "unknown_error",
            );
            return;
          }
          console.log(
            `✅ Ops cleanup completed (idempotency=${result.idempotencyDeleted}, rateLimit=${result.rateLimitDeleted}, reportTokens=${(result as any).reportTokensDeleted ?? 0})`,
          );
        };

        setTimeout(() => {
          void runCleanup();
          setInterval(runCleanup, cleanupIntervalMs);
        }, 45_000);
      }

      const enableMarketplaceHealthAudit =
        process.env.MARKETPLACE_HEALTH_AUDIT_ENABLED !== "false";
      if (enableMarketplaceHealthAudit) {
        const intervalMinutesRaw = Number(
          process.env.MARKETPLACE_HEALTH_AUDIT_INTERVAL_MINUTES || 60,
        );
        const intervalMinutes = Number.isFinite(intervalMinutesRaw)
          ? Math.max(10, Math.floor(intervalMinutesRaw))
          : 60;
        const intervalMs = intervalMinutes * 60 * 1000;
        const runAudit = async () => {
          const result = await runMarketplaceHealthAudit();
          if (!result.ok) {
            console.warn(
              "⚠️ Marketplace health audit warning:",
              (result as any).error || result,
            );
            return;
          }
          const r: any = result;
          console.log(
            `[marketplace-health] ok total=${r.demandCounts?.total ?? 0} collecting=${r.demandCounts?.collecting ?? 0} threshold_met=${r.demandCounts?.threshold_met ?? 0} claimed=${r.demandCounts?.claimed ?? 0} fulfilled=${r.demandCounts?.fulfilled ?? 0}`,
          );
          if (
            Number(r.stuckThreshold || 0) > 0 ||
            Number(r.staleCollecting || 0) > 0 ||
            Number(r.stalePending || 0) > 0
          ) {
            console.warn(
              `[marketplace-health] stuck_threshold=${r.stuckThreshold} stale_collecting=${r.staleCollecting} stale_pending_bookings=${r.stalePending}`,
            );
          }
        };

        setTimeout(() => {
          void runAudit();
          setInterval(runAudit, intervalMs);
        }, 60_000);
      }

      // Perform database validation after server startup - non-blocking
      setTimeout(async () => {
        try {
          const schemaCheck = await db.execute(sql`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'phone'
        `);

          if (schemaCheck.rows.length === 0) {
            console.error(
              "❌ CRITICAL: phone column missing from users table!"
            );
            console.error(
              "Database URL:",
              process.env.DATABASE_URL?.split("@")[0] + "@..."
            );
            // Don't exit process in production - log error and continue
            if (process.env.NODE_ENV === "production") {
              console.warn(
                "⚠️  Server will continue running despite database schema issues"
              );
            }
          } else {
            console.log("✅ Schema validation: phone column exists");
          }
        } catch (error) {
          console.error(
            "❌ Schema validation failed:",
            error instanceof Error ? error.message : String(error)
          );
          console.warn(
            "⚠️  Server will continue running despite database validation failure"
          );
        }
      }, 1000); // Delay 1 second to allow server to fully start
    }
  );
})();

