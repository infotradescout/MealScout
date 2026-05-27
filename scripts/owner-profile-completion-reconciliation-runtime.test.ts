import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { inArray, sql } from "drizzle-orm";

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
  while (Date.now() - started < timeoutMs) {
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

function createOwnerActionLog(params: {
  entityId: string;
  entityType: "restaurant" | "truck" | "bar";
  missingItemKey: string;
  ownerId: string;
  createdAt: Date;
}) {
  return {
    method: "EVENT",
    path: "/restaurant-owner-dashboard",
    statusCode: 202,
    durationMs: 0,
    userId: params.ownerId,
    sessionId: `pda211_${randomUUID()}`,
    actorType: "human",
    sourceType: "internal",
    eventType: "owner_action",
    surface: "owner_dashboard_profile_completion",
    entityId: params.entityId,
    entityType: params.entityType,
    ip: "198.51.100.11",
    userAgent: "PDA-2.11 Runtime Test",
    metadata: {
      actionType: "profile_completion_cta_click",
      missingItemKey: params.missingItemKey,
      source: "owner_dashboard_profile_completion",
      ownerId: params.ownerId,
      entityId: params.entityId,
      entityType: params.entityType,
    },
    createdAt: params.createdAt,
  };
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const ownerEmail = `pda211_owner_${Date.now()}@example.com`;
  const outsiderEmail = `pda211_out_${Date.now()}@example.com`;
  const password = "Pda211Pass123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const ownerRestaurantId = `pda211_owner_rest_${randomUUID()}`;
  const outsiderRestaurantId = `pda211_out_rest_${randomUUID()}`;

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
        firstName: "PDA",
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
        firstName: "PDA",
        lastName: "Outsider",
      },
    ]);

    await db.insert(restaurants as any).values([
      {
        id: ownerRestaurantId,
        ownerId,
        name: "PDA 2.11 Owner Restaurant",
        address: "110 Runtime Way",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
        menuUrl: "https://example.com/menu",
      },
      {
        id: outsiderRestaurantId,
        ownerId: outsiderId,
        name: "PDA 2.11 Outsider Restaurant",
        address: "220 Runtime Way",
        city: "Pensacola",
        state: "FL",
        isActive: true,
        businessType: "restaurant",
      },
    ]);

    const now = new Date();
    const events: any[] = [];
    for (let i = 0; i < 3; i += 1) {
      events.push(
        createOwnerActionLog({
          ownerId,
          entityId: ownerRestaurantId,
          entityType: "restaurant",
          missingItemKey: "service-area",
          createdAt: new Date(now.getTime() + i * 1000),
        }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      events.push(
        createOwnerActionLog({
          ownerId,
          entityId: ownerRestaurantId,
          entityType: "restaurant",
          missingItemKey: "social",
          createdAt: new Date(now.getTime() + 5000 + i * 1000),
        }),
      );
    }
    events.push(
      createOwnerActionLog({
        ownerId: outsiderId,
        entityId: outsiderRestaurantId,
        entityType: "restaurant",
        missingItemKey: "social",
        createdAt: new Date(now.getTime() + 9000),
      }),
    );
    await db.insert(requestLogs).values(events);

    await resetAuthRateLimitCounters();
    const ownerCookie = await login(baseUrl, ownerEmail, password);

    const ownerRes = await fetch(`${baseUrl}/api/owner/value-attribution?window=7d`, {
      headers: {
        Cookie: ownerCookie,
        Accept: "application/json",
      },
    });
    assert(ownerRes.status === 200, "Expected owner attribution 200");
    const ownerBody: any = await ownerRes.json();
    assert(Array.isArray(ownerBody?.entities), "entities missing");
    const ownerEntity = ownerBody.entities.find((item: any) => item.entityId === ownerRestaurantId);
    assert(ownerEntity, "Owned entity missing in attribution response");
    assert(
      Array.isArray(ownerEntity.completionActionReconciliation),
      "completionActionReconciliation missing",
    );

    const serviceAreaRecon = ownerEntity.completionActionReconciliation.find(
      (item: any) => item.missingItemKey === "service-area",
    );
    assert(serviceAreaRecon, "service-area reconciliation missing");
    assert(
      serviceAreaRecon.clicked === 3,
      `service-area clicked expected 3, got ${serviceAreaRecon.clicked}`,
    );
    assert(
      serviceAreaRecon.nowComplete === 3,
      `service-area nowComplete expected 3, got ${serviceAreaRecon.nowComplete}`,
    );
    assert(
      serviceAreaRecon.stillMissing === 0,
      `service-area stillMissing expected 0, got ${serviceAreaRecon.stillMissing}`,
    );

    const socialRecon = ownerEntity.completionActionReconciliation.find(
      (item: any) => item.missingItemKey === "social",
    );
    assert(socialRecon, "social reconciliation missing");
    assert(socialRecon.clicked === 2, `social clicked expected 2, got ${socialRecon.clicked}`);
    assert(
      socialRecon.nowComplete === 0,
      `social nowComplete expected 0, got ${socialRecon.nowComplete}`,
    );
    assert(
      socialRecon.stillMissing === 2,
      `social stillMissing expected 2, got ${socialRecon.stillMissing}`,
    );

    assert(
      ownerBody.entities.every((item: any) => item.entityId !== outsiderRestaurantId),
      "Outsider-owned entity leaked into owner attribution response",
    );

    await resetAuthRateLimitCounters();
    const outsiderCookie = await login(baseUrl, outsiderEmail, password);
    const outsiderRes = await fetch(`${baseUrl}/api/owner/value-attribution?window=7d`, {
      headers: {
        Cookie: outsiderCookie,
        Accept: "application/json",
      },
    });
    assert(outsiderRes.status === 200, "Expected outsider attribution 200");
    const outsiderBody: any = await outsiderRes.json();
    assert(Array.isArray(outsiderBody?.entities), "Outsider entities missing");
    assert(
      outsiderBody.entities.every((item: any) => item.entityId !== ownerRestaurantId),
      "Owner entity leaked into outsider response",
    );

    console.log("owner-profile-completion-reconciliation-runtime: PASS");
  } finally {
    try {
      await db
        .delete(requestLogs)
        .where(inArray(requestLogs.entityId, [ownerRestaurantId, outsiderRestaurantId]));
    } catch {}
    try {
      await db
        .delete(restaurants as any)
        .where(inArray((restaurants as any).id, [ownerRestaurantId, outsiderRestaurantId]));
    } catch {}
    try {
      await db
        .delete(users as any)
        .where(inArray((users as any).id, [ownerId, outsiderId]));
    } catch {}
    await stopServer(server);
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "owner-profile-completion-reconciliation-runtime: FAIL",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
