import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { chromium } from "@playwright/test";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../server/db";
import { requestLogs, restaurants, restaurantSubscriptions, users } from "../shared/schema";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function getFreePort(preferred = 0): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(port, "127.0.0.1", () => {
        const address = srv.address();
        const actual = typeof address === "string" ? preferred : address.port;
        srv.close(() => resolve(actual));
      });
    });
  try {
    return await tryPort(preferred);
  } catch {
    return await tryPort(0);
  }
}

async function waitForHttp(url: string, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if ([200, 401, 403].includes(res.status)) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function resetAuthRateLimitCounters() {
  await db.execute(
    sql`delete from rate_limit_counters where scope in ('auth:moderate', 'auth:strict')`,
  );
}

async function stopServer(server: ChildProcess) {
  if (!server || server.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.once("close", () => resolve());
    }),
    sleep(10_000).then(() => undefined),
  ]);
}

async function loginViaApi(
  page: Awaited<ReturnType<ReturnType<typeof chromium.launch>["newPage"]>>,
  baseUrl: string,
  email: string,
  password: string,
) {
  const response = await page.request.post(`${baseUrl}/api/auth/login`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: baseUrl,
      Referer: `${baseUrl}/login`,
    },
    data: { email, password },
  });
  const body = await response.json().catch(() => ({}));
  assert(
    response.ok(),
    `Browser login failed status=${response.status()} message=${String(body?.error || body?.message || "unknown")}`,
  );
}

async function readMetric(page: any, label: string) {
  const labelNode = page.locator("p", { hasText: label }).first();
  await labelNode.waitFor({ state: "visible", timeout: 20_000 });
  const card = labelNode.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
  const valueNode = card.locator("p.text-base.font-semibold").first();
  const valueText = (await valueNode.innerText()).trim();
  const value = Number(valueText);
  assert(Number.isFinite(value), `Metric "${label}" did not render numeric value (got "${valueText}")`);
  return value;
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const emptyOwnerId = randomUUID();
  const ownerEmail = `pda24_owner_${Date.now()}@example.com`;
  const outsiderEmail = `pda24_out_${Date.now()}@example.com`;
  const emptyOwnerEmail = `pda24_empty_${Date.now()}@example.com`;
  const password = "PDA24OwnerPass123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const ownerRestaurantId = randomUUID();
  const outsiderRestaurantId = randomUUID();
  const emptyRestaurantId = randomUUID();
  const ownerRestaurantName = "PDA24 Owner Kitchen";
  const outsiderRestaurantName = "PDA24 Outsider Kitchen";
  const emptyRestaurantName = "PDA24 Empty Kitchen";

  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const server = spawn("npm", ["run", "dev:server"], {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_ORIGIN: "http://127.0.0.1:5174",
      ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://127.0.0.1:5174`,
    },
  });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await waitForHttp(`${baseUrl}/api/auth/user`);

    await db.insert(users as any).values([
      {
        id: ownerId,
        userType: "restaurant_owner",
        email: ownerEmail,
        passwordHash,
        emailVerified: true,
        isDisabled: false,
        mustResetPassword: false,
        appContext: "mealscout",
        firstName: "PDA24",
        lastName: "Owner",
      },
      {
        id: outsiderId,
        userType: "restaurant_owner",
        email: outsiderEmail,
        passwordHash,
        emailVerified: true,
        isDisabled: false,
        mustResetPassword: false,
        appContext: "mealscout",
        firstName: "PDA24",
        lastName: "Outsider",
      },
      {
        id: emptyOwnerId,
        userType: "restaurant_owner",
        email: emptyOwnerEmail,
        passwordHash,
        emailVerified: true,
        isDisabled: false,
        mustResetPassword: false,
        appContext: "mealscout",
        firstName: "PDA24",
        lastName: "Empty",
      },
    ]);

    await db.insert(restaurants as any).values([
      {
        id: ownerRestaurantId,
        ownerId,
        name: ownerRestaurantName,
        address: "101 Runtime Ave",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
      },
      {
        id: outsiderRestaurantId,
        ownerId: outsiderId,
        name: outsiderRestaurantName,
        address: "202 Runtime Ave",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
      },
      {
        id: emptyRestaurantId,
        ownerId: emptyOwnerId,
        name: emptyRestaurantName,
        address: "303 Runtime Ave",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
      },
    ]);
    await db.insert(restaurantSubscriptions as any).values([
      {
        restaurantId: ownerRestaurantId,
        tier: "monthly",
        status: "active",
        hasAnalytics: true,
      },
      {
        restaurantId: emptyRestaurantId,
        tier: "monthly",
        status: "active",
        hasAnalytics: true,
      },
    ]);

    await db.insert(requestLogs).values([
      // 7d data
      ...Array.from({ length: 3 }).map((_, idx) => ({
        method: "EVENT",
        path: `/p/restaurant/${ownerRestaurantId}/pda24`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_view",
        surface: "public_profile",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: { source: "direct", actionType: "profile_view" },
        createdAt: new Date(now.getTime() - (idx + 1) * 60_000),
      })),
      ...Array.from({ length: 5 }).map((_, idx) => ({
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: {
          discoveryEventType: "discovery_page_view",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          profileId: ownerRestaurantId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${ownerRestaurantId}/pda24`,
          sourcePath: "/food-trucks-today/pensacola",
        },
        createdAt: new Date(now.getTime() - (idx + 1) * 50_000),
      })),
      ...Array.from({ length: 2 }).map((_, idx) => ({
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: {
          discoveryEventType: "discovery_cta_click",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          profileId: ownerRestaurantId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${ownerRestaurantId}/pda24`,
          sourcePath: "/food-trucks-today/pensacola",
        },
        createdAt: new Date(now.getTime() - (idx + 1) * 40_000),
      })),
      {
        method: "EVENT",
        path: `/p/restaurant/${ownerRestaurantId}/pda24`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_action",
        surface: "public_profile",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: { source: "facebook", actionType: "share_click" },
        createdAt: new Date(now.getTime() - 20_000),
      },
      {
        method: "EVENT",
        path: `/p/restaurant/${ownerRestaurantId}/pda24`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_action",
        surface: "public_profile",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: { source: "direct", actionType: "call_click" },
        createdAt: new Date(now.getTime() - 10_000),
      },
      // within 30d only
      {
        method: "EVENT",
        path: `/p/restaurant/${ownerRestaurantId}/pda24`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_view",
        surface: "public_profile",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: { source: "direct", actionType: "profile_view" },
        createdAt: tenDaysAgo,
      },
      ...Array.from({ length: 2 }).map((_, idx) => ({
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: {
          discoveryEventType: "discovery_page_view",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          profileId: ownerRestaurantId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${ownerRestaurantId}/pda24`,
          sourcePath: "/food-trucks-today/pensacola",
        },
        createdAt: new Date(tenDaysAgo.getTime() + (idx + 1) * 60_000),
      })),
      {
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: {
          discoveryEventType: "discovery_cta_click",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          profileId: ownerRestaurantId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${ownerRestaurantId}/pda24`,
          sourcePath: "/food-trucks-today/pensacola",
        },
        createdAt: new Date(tenDaysAgo.getTime() + 5 * 60_000),
      },
      {
        method: "EVENT",
        path: `/p/restaurant/${ownerRestaurantId}/pda24`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_owner_${randomUUID()}`,
        anonymousActorId: `pda24_owner_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_action",
        surface: "public_profile",
        entityId: ownerRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.44",
        userAgent: "PDA24 Browser",
        metadata: { source: "facebook", actionType: "share_click" },
        createdAt: new Date(tenDaysAgo.getTime() + 6 * 60_000),
      },
      // outsider data should never appear for owner
      {
        method: "EVENT",
        path: "/events-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda24_out_${randomUUID()}`,
        anonymousActorId: `pda24_out_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: outsiderRestaurantId,
        entityType: "restaurant",
        ip: "198.51.100.55",
        userAgent: "PDA24 Browser",
        metadata: {
          discoveryEventType: "discovery_page_view",
          sourcePageType: "events_today",
          city: "Pensacola",
          profileId: outsiderRestaurantId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${outsiderRestaurantId}/pda24`,
          sourcePath: "/events-today/pensacola",
        },
        createdAt: new Date(now.getTime() - 5_000),
      },
    ] as any);

    await resetAuthRateLimitCounters();
    await loginViaApi(page, baseUrl, ownerEmail, password);

    const requestUrls: string[] = [];
    page.on("request", (request) => {
      requestUrls.push(request.url());
    });

    await page.goto(
      `${baseUrl}/restaurant-owner-dashboard?setup=profile&restaurantId=${encodeURIComponent(ownerRestaurantId)}`,
      { waitUntil: "networkidle" },
    );

    await page.getByText("Profile value").first().waitFor({ state: "visible", timeout: 20_000 });
    await page
      .getByText("Discovery traffic and profile actions are shown from real activity only.")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await page
      .getByText(
        "Completing your menu, photos, and action links helps people take the next step when they discover your profile.",
      )
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await page
      .getByText("Use this panel weekly to track what changed and decide your next profile update.")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await page.getByRole("button", { name: "Complete profile basics" }).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Update menu and links" }).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.getByText("7 days").first().click();
    await page.waitForTimeout(800);

    assert(requestUrls.some((url) => url.includes("/api/owner/value-attribution?window=7d")), "7d request not observed");
    assert((await readMetric(page, "Profile views")) === 3, "7d Profile views mismatch");
    assert((await readMetric(page, "Discovery impressions")) === 5, "7d Discovery impressions mismatch");
    assert((await readMetric(page, "CTA clicks")) === 2, "7d CTA clicks mismatch");
    assert((await readMetric(page, "Share opens")) === 1, "7d Share opens mismatch");
    assert((await readMetric(page, "High-intent actions")) === 3, "7d High-intent actions mismatch");

    const topSourcesBlock7d = await page.getByText("Top sources").locator("xpath=..").innerText();
    assert(
      topSourcesBlock7d.includes("discovery:food_trucks_today - 7"),
      "7d top source count mismatch",
    );
    assert(!(await page.content()).includes(outsiderRestaurantName), "Outsider entity leaked into owner dashboard");

    await page.getByText("30 days").first().click();
    await page.waitForTimeout(800);

    assert(requestUrls.some((url) => url.includes("/api/owner/value-attribution?window=30d")), "30d request not observed");
    assert((await readMetric(page, "Profile views")) === 4, "30d Profile views mismatch");
    assert((await readMetric(page, "Discovery impressions")) === 7, "30d Discovery impressions mismatch");
    assert((await readMetric(page, "CTA clicks")) === 3, "30d CTA clicks mismatch");
    assert((await readMetric(page, "Share opens")) === 2, "30d Share opens mismatch");
    assert((await readMetric(page, "High-intent actions")) === 4, "30d High-intent actions mismatch");

    const topSourcesBlock30d = await page.getByText("Top sources").locator("xpath=..").innerText();
    assert(
      topSourcesBlock30d.includes("discovery:food_trucks_today - 10"),
      "30d top source count mismatch",
    );

    await context.clearCookies();
    await resetAuthRateLimitCounters();
    await loginViaApi(page, baseUrl, emptyOwnerEmail, password);
    await page.goto(
      `${baseUrl}/restaurant-owner-dashboard?setup=profile&restaurantId=${encodeURIComponent(emptyRestaurantId)}`,
      { waitUntil: "networkidle" },
    );
    await page
      .getByText("No discovery activity yet.")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await page
      .getByText(
        "Your profile is ready to receive views, clicks, and shares as people find you through MealScout.",
      )
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    console.log("owner-value-attribution-browser: PASS");
  } finally {
    await browser.close();
    try {
      await db
        .delete(requestLogs)
        .where(inArray(requestLogs.entityId, [ownerRestaurantId, outsiderRestaurantId, emptyRestaurantId]));
      await db
        .delete(restaurants as any)
        .where(inArray((restaurants as any).id, [ownerRestaurantId, outsiderRestaurantId, emptyRestaurantId]));
      await db
        .delete(restaurantSubscriptions as any)
        .where(
          inArray((restaurantSubscriptions as any).restaurantId, [
            ownerRestaurantId,
            outsiderRestaurantId,
            emptyRestaurantId,
          ]),
        );
      await db
        .delete(users as any)
        .where(inArray((users as any).id, [ownerId, outsiderId, emptyOwnerId]));
    } catch {}
    await stopServer(server);
  }
}

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "owner-value-attribution-browser: FAIL",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
