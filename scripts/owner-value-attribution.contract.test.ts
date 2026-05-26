import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../server/db";
import { requestLogs, restaurants, users } from "../shared/schema";

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
      console.log(`[owner-attribution] waiting for server (${attempts} checks)`);
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
  console.log("[owner-attribution] start");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const ownerEmail = `owner_attr_${Date.now()}@example.com`;
  const outsiderEmail = `owner_attr_out_${Date.now()}@example.com`;
  const password = "OwnerAttribution123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const restId = `owner_attr_rest_${randomUUID()}`;
  const truckId = `owner_attr_truck_${randomUUID()}`;

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
    console.log("[owner-attribution] waiting for auth endpoint");
    await waitForHttp(`${baseUrl}/api/auth/user`);
    console.log("[owner-attribution] server ready");

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
        firstName: "Owner",
        lastName: "Attribution",
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
        firstName: "Out",
        lastName: "Sider",
      },
    ]);

    await db.insert(restaurants as any).values([
      {
        id: restId,
        ownerId,
        name: "Owner Attribution Restaurant",
        address: "123 Runtime Test Ave",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
      },
      {
        id: truckId,
        ownerId,
        name: "Owner Attribution Truck",
        address: "456 Runtime Test Blvd",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        isFoodTruck: true,
        businessType: "food_truck",
      },
    ]);

    const now = new Date();
    await db.insert(requestLogs).values([
      {
        method: "EVENT",
        path: `/p/restaurant/${restId}/owner`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `owner_attr_${randomUUID()}`,
        anonymousActorId: `owner_attr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_view",
        surface: "public_profile",
        entityId: restId,
        entityType: "restaurant",
        ip: "198.51.100.10",
        userAgent: "Owner Attr Test",
        metadata: { actionType: "profile_view", source: "public_profile" },
        createdAt: now,
      },
      {
        method: "EVENT",
        path: `/p/restaurant/${restId}/owner`,
        statusCode: 200,
        durationMs: 0,
        userId: null,
        sessionId: `owner_attr_${randomUUID()}`,
        anonymousActorId: `owner_attr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "profile_action",
        surface: "public_profile",
        entityId: restId,
        entityType: "restaurant",
        ip: "198.51.100.10",
        userAgent: "Owner Attr Test",
        metadata: { actionType: "call_click", source: "public_profile" },
        createdAt: new Date(now.getTime() + 1000),
      },
      {
        method: "EVENT",
        path: `/food-trucks-today/pensacola`,
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `owner_attr_${randomUUID()}`,
        anonymousActorId: `owner_attr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: restId,
        entityType: "restaurant",
        ip: "198.51.100.10",
        userAgent: "Owner Attr Test",
        metadata: {
          discoveryEventType: "discovery_cta_click",
          sourcePageType: "food_trucks_today",
          city: "Pensacola",
          profileId: restId,
          profileType: "restaurant",
          targetPath: `/p/restaurant/${restId}/owner`,
          sourcePath: "/food-trucks-today/pensacola",
        },
        createdAt: new Date(now.getTime() + 2000),
      },
      {
        method: "EVENT",
        path: `/city/pensacola/food`,
        statusCode: 202,
        durationMs: 0,
        userId: null,
        sessionId: `owner_attr_${randomUUID()}`,
        anonymousActorId: `owner_attr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        actorType: "human",
        sourceType: "human",
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: truckId,
        entityType: "truck",
        ip: "198.51.100.10",
        userAgent: "Owner Attr Test",
        metadata: {
          discoveryEventType: "discovery_profile_click",
          sourcePageType: "city_food",
          city: "Pensacola",
          profileId: truckId,
          profileType: "truck",
          targetPath: `/p/truck/${truckId}/owner`,
          sourcePath: "/city/pensacola/food",
        },
        createdAt: new Date(now.getTime() + 3000),
      },
    ] as any);

    const unauth = await fetch(`${baseUrl}/api/owner/value-attribution?window=7d`);
    assert([401, 403].includes(unauth.status), "Unauthenticated request should be rejected");

    await resetAuthRateLimitCounters();
    const ownerCookie = await login(baseUrl, ownerEmail, password);
    const ownerRes = await fetch(`${baseUrl}/api/owner/value-attribution?window=7d`, {
      headers: {
        Cookie: ownerCookie,
        Accept: "application/json",
      },
    });
    assert(ownerRes.status === 200, "Owner attribution request should return 200");
    const ownerBody: any = await ownerRes.json();
    assert(Array.isArray(ownerBody?.entities), "entities array missing");
    assert(ownerBody.entities.length >= 2, "Expected multiple owned entities in response");

    const restEntity = ownerBody.entities.find((item: any) => item.entityId === restId);
    assert(restEntity, "Restaurant entity aggregation missing");
    assert(restEntity.profileViews >= 1, "profileViews should include seeded profile view");
    assert(restEntity.ctaClicks >= 1, "ctaClicks should include seeded discovery CTA click");
    assert(restEntity.highIntentActions >= 2, "highIntentActions should include seeded actions");
    assert(Array.isArray(restEntity.topSources), "topSources should be an array");

    const truckEntity = ownerBody.entities.find((item: any) => item.entityId === truckId);
    assert(truckEntity, "Truck entity aggregation missing");
    assert(truckEntity.highIntentActions >= 1, "Truck highIntentActions should include profile click");
    assert(typeof truckEntity.lastActivityAt === "string" || truckEntity.lastActivityAt === null, "lastActivityAt shape invalid");

    await resetAuthRateLimitCounters();
    const outsiderCookie = await login(baseUrl, outsiderEmail, password);
    const outsiderRes = await fetch(`${baseUrl}/api/owner/value-attribution?window=7d`, {
      headers: {
        Cookie: outsiderCookie,
        Accept: "application/json",
      },
    });
    assert(outsiderRes.status === 200, "Outsider request should return 200 with empty owned scope");
    const outsiderBody: any = await outsiderRes.json();
    assert(Array.isArray(outsiderBody?.entities), "Outsider entities array missing");
    assert(
      outsiderBody.entities.every((item: any) => item.entityId !== restId && item.entityId !== truckId),
      "Outsider should not see owner entities",
    );

    const invalidWindowRes = await fetch(`${baseUrl}/api/owner/value-attribution?window=bad`, {
      headers: {
        Cookie: ownerCookie,
        Accept: "application/json",
      },
    });
    assert(invalidWindowRes.status === 400, "Invalid window should return 400");

    console.log("owner-value-attribution.contract: PASS");
  } finally {
    try {
      await db
        .delete(requestLogs)
        .where(and(inArray(requestLogs.entityId, [restId, truckId])));
      await db
        .delete(restaurants as any)
        .where(inArray((restaurants as any).id, [restId, truckId]));
      await db
        .delete(users as any)
        .where(inArray((users as any).id, [ownerId, outsiderId]));
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
      "owner-value-attribution.contract: FAIL",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
