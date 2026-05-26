import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "../server/db";
import { requestLogs, users } from "../shared/schema";

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
  let attempts = 0;
  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    if (attempts % 10 === 0) {
      console.log(`[pda-integration] waiting for server (${attempts} checks)`);
    }
    try {
      const res = await fetch(url);
      if ([200, 401, 403].includes(res.status)) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

function getSetCookies(res: Response): string[] {
  const headers = res.headers as any;
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().map((v: unknown) => String(v || ""));
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function toCookieHeader(setCookies: string[]) {
  return setCookies.map((v) => v.split(";")[0]).filter(Boolean).join("; ");
}

async function login(baseUrl: string, email: string, password: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: baseUrl,
      Referer: `${baseUrl}/login`,
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await res.json().catch(() => ({}));
  const setCookie = getSetCookies(res);
  if (!res.ok) {
    throw new Error(
      `Login failed status=${res.status} message=${String(
        payload?.error || payload?.message || "unknown",
      )}`,
    );
  }
  assert(setCookie.length > 0, "Login succeeded but Set-Cookie was missing");
  return toCookieHeader(setCookie);
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

async function run() {
  console.log("[pda-integration] start");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminId = randomUUID();
  const adminEmail = `pda_admin_${Date.now()}@example.com`;
  const password = "PDAContract123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const seededEntityIds = [
    `pda_rest_${randomUUID()}`,
    `pda_truck_${randomUUID()}`,
    `pda_host_${randomUUID()}`,
  ];

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

  try {
    console.log("[pda-integration] waiting for auth endpoint");
    await waitForHttp(`${baseUrl}/api/auth/user`);
    console.log("[pda-integration] server ready");

    await db.insert(users as any).values({
      id: adminId,
      userType: "admin",
      email: adminEmail,
      passwordHash,
      emailVerified: true,
      isDisabled: false,
      mustResetPassword: false,
      appContext: "mealscout",
      firstName: "PDA",
      lastName: "Admin",
    });

    const unauth = await fetch(`${baseUrl}/api/admin/discovery-analytics?window=7d`);
    assert([401, 403].includes(unauth.status), "Unauthenticated access must be rejected");

    await resetAuthRateLimitCounters();
    const adminCookie = await login(baseUrl, adminEmail, password);
    console.log("[pda-integration] fetching baseline");
    const beforeRes = await fetch(`${baseUrl}/api/admin/discovery-analytics?window=7d`, {
      headers: {
        Cookie: adminCookie,
        Accept: "application/json",
      },
    });
    assert(beforeRes.ok, "Pre-seed discovery aggregate request failed");
    const before: any = await beforeRes.json();

    const now = new Date();
    const seededRows = [
      {
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda_${randomUUID()}`,
        anonymousActorId: `pda_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: seededEntityIds[0],
        entityType: "restaurant",
        ip: "198.51.100.42",
        userAgent: "PDA Integration",
        metadata: {
          discoveryEventType: "discovery_page_view",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          cuisine: null,
          profileId: seededEntityIds[0],
          profileType: "restaurant",
          targetPath: `/p/restaurant/${seededEntityIds[0]}/runtime`,
          sourcePath: "/food-trucks-today/pensacola",
          referrer: "https://example.com",
          timestamp: now.toISOString(),
        },
        createdAt: now,
      },
      {
        method: "EVENT",
        path: "/food-trucks-today/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda_${randomUUID()}`,
        anonymousActorId: `pda_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: seededEntityIds[1],
        entityType: "truck",
        ip: "198.51.100.42",
        userAgent: "PDA Integration",
        metadata: {
          discoveryEventType: "discovery_cta_click",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          cuisine: "tacos",
          profileId: seededEntityIds[1],
          profileType: "truck",
          targetPath: `/p/truck/${seededEntityIds[1]}/runtime`,
          sourcePath: "/food-trucks-today/pensacola",
          referrer: "https://example.com",
          timestamp: now.toISOString(),
        },
        createdAt: new Date(now.getTime() + 1000),
      },
      {
        method: "EVENT",
        path: "/locations-with-trucks/pensacola",
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `pda_${randomUUID()}`,
        anonymousActorId: `pda_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: seededEntityIds[2],
        entityType: "host",
        ip: "198.51.100.42",
        userAgent: "PDA Integration",
        metadata: {
          discoveryEventType: "discovery_profile_click",
          sourcePageType: "locations_with_trucks",
          city: "Pensacola",
          cuisine: null,
          profileId: seededEntityIds[2],
          profileType: "location",
          targetPath: `/p/location/${seededEntityIds[2]}/runtime`,
          sourcePath: "/locations-with-trucks/pensacola",
          referrer: "https://example.com",
          timestamp: now.toISOString(),
        },
        createdAt: new Date(now.getTime() + 2000),
      },
      {
        method: "EVENT",
        path: `/p/restaurant/${seededEntityIds[0]}/runtime`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `pda_${randomUUID()}`,
        anonymousActorId: `pda_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_view",
        surface: "public_profile",
        entityId: seededEntityIds[0],
        entityType: "restaurant",
        ip: "198.51.100.42",
        userAgent: "PDA Integration",
        metadata: {
          source: "public_profile",
          actionType: "profile_view",
          seededBy: "public-discovery-analytics.integration.contract",
        },
        createdAt: new Date(now.getTime() + 3000),
      },
    ];
    await db.insert(requestLogs).values(seededRows as any);

    console.log("[pda-integration] fetching post-seed aggregate");
    const afterRes = await fetch(`${baseUrl}/api/admin/discovery-analytics?window=7d`, {
      headers: {
        Cookie: adminCookie,
        Accept: "application/json",
      },
    });
    assert(afterRes.status === 200, "Post-seed discovery aggregate did not return 200");
    const after: any = await afterRes.json();

    assert(after?.totals, "Discovery totals missing");
    assert(
      Number(after.totals.discoveryPageViews || 0) >= Number(before?.totals?.discoveryPageViews || 0) + 1,
      "discoveryPageViews did not increase as expected",
    );
    assert(
      Number(after.totals.ctaClicks || 0) >= Number(before?.totals?.ctaClicks || 0) + 1,
      "ctaClicks did not increase as expected",
    );
    assert(
      Number(after.totals.profileClicks || 0) >= Number(before?.totals?.profileClicks || 0) + 1,
      "profileClicks did not increase as expected",
    );

    assert(Array.isArray(after.topPages), "topPages should be an array");
    assert(Array.isArray(after.topProfilesFromDiscovery), "topProfilesFromDiscovery should be an array");
    assert(Array.isArray(after.topCities), "topCities should be an array");
    assert(
      after.topPages.some((item: any) => String(item.sourcePath || "").includes("/food-trucks-today/pensacola")),
      "Expected seeded sourcePath not present in topPages",
    );
    assert(
      after.topProfilesFromDiscovery.some((item: any) => seededEntityIds.includes(String(item.profileId || ""))),
      "Expected seeded profileIds not present in topProfilesFromDiscovery",
    );

    const badEventRes = await fetch(`${baseUrl}/api/public/discovery-analytics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: baseUrl,
        Referer: `${baseUrl}/food-trucks-today/pensacola`,
      },
      body: JSON.stringify({
        eventType: "bad_event",
        sourcePageType: "food_trucks_today",
        sourcePath: "/food-trucks-today/pensacola",
      }),
    });
    assert(
      badEventRes.status === 400,
      `Invalid eventType should return 400 (got ${badEventRes.status})`,
    );

    const badSourceRes = await fetch(`${baseUrl}/api/public/discovery-analytics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: baseUrl,
        Referer: `${baseUrl}/food-trucks-today/pensacola`,
      },
      body: JSON.stringify({
        eventType: "discovery_page_view",
        sourcePageType: "bad_source",
        sourcePath: "/food-trucks-today/pensacola",
      }),
    });
    assert(
      badSourceRes.status === 400,
      `Invalid sourcePageType should return 400 (got ${badSourceRes.status})`,
    );

    const emptyRes = await fetch(`${baseUrl}/api/admin/discovery-analytics?window=30d`, {
      headers: {
        Cookie: adminCookie,
        Accept: "application/json",
      },
    });
    assert(emptyRes.status === 200, "Empty-state aggregate request should still return 200");
    const emptyBody: any = await emptyRes.json();
    assert(typeof emptyBody?.totals?.discoveryPageViews === "number", "Empty-state totals should be numeric");

    console.log("public-discovery-analytics.integration: PASS");
  } finally {
    try {
      await db
        .delete(requestLogs)
        .where(
          and(
            inArray(requestLogs.entityId, seededEntityIds),
            gte(requestLogs.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
          ),
        );
      await db.delete(users as any).where(eq((users as any).id, adminId));
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
      "public-discovery-analytics.integration: FAIL",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
