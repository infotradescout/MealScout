import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { and, eq, inArray, or, sql } from "drizzle-orm";

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
      )} setCookie=${setCookie.length > 0 ? "present" : "missing"}`,
    );
  }
  assert(setCookie.length > 0, "Login succeeded but Set-Cookie was missing");
  return toCookieHeader(setCookie);
}

async function seedRequestEvents(input: {
  restaurantId: string;
  profileEntityType: "restaurant" | "truck" | "bar";
  createdAt: Date;
  actionType: string;
  eventType: "profile_view" | "profile_action" | "qr_open";
  times: number;
}) {
  const rows = Array.from({ length: input.times }).map((_, idx) => ({
    method: "EVENT",
    path: `/p/${input.profileEntityType}/${input.restaurantId}`,
    statusCode: 200,
    durationMs: 0,
    userId: null,
    sessionId: `ovd_test_session_${randomUUID()}`,
    anonymousActorId: `ovd_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    actorType: "human",
    sourceType: "human",
    eventType: input.eventType,
    surface: "public_profile",
    entityId: input.restaurantId,
    entityType: input.profileEntityType,
    ip: "198.51.100.22",
    userAgent: "MealScout OVD Runtime Contract",
    metadata: {
      actionType: input.actionType,
      source: "public_profile",
      seededBy: "owner-value-dashboard.integration.contract",
      index: idx,
    },
    createdAt: new Date(input.createdAt.getTime() + idx * 1000),
  }));
  await db.insert(requestLogs).values(rows as any);
}

async function run() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const ownerId = randomUUID();
  const outsiderId = randomUUID();
  const adminId = randomUUID();
  const targetRestaurantId = `ovd_restaurant_${randomUUID()}`;
  const emptyRestaurantId = `ovd_empty_${randomUUID()}`;
  const ownerEmail = `ovd_owner_${Date.now()}@example.com`;
  const outsiderEmail = `ovd_outsider_${Date.now()}@example.com`;
  const adminEmail = `ovd_admin_${Date.now()}@example.com`;
  const password = "OwnerValue123!";
  const passwordHash = await bcrypt.hash(password, 10);

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
        firstName: "OVD",
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
        firstName: "OVD",
        lastName: "Outsider",
      },
      {
        id: adminId,
        userType: "admin",
        email: adminEmail,
        passwordHash,
        emailVerified: true,
        isDisabled: false,
        mustResetPassword: false,
        appContext: "mealscout",
        firstName: "OVD",
        lastName: "Admin",
      },
    ]);

    const [sanityUser] = await db
      .select({
        id: (users as any).id,
        userType: (users as any).userType,
        email: (users as any).email,
        passwordHash: (users as any).passwordHash,
        emailVerified: (users as any).emailVerified,
        isDisabled: (users as any).isDisabled,
        mustResetPassword: (users as any).mustResetPassword,
        appContext: (users as any).appContext,
      })
      .from(users as any)
      .where(eq((users as any).id, ownerId))
      .limit(1);
    assert(Boolean(sanityUser?.email), "Seed sanity: owner user not persisted");
    assert(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(sanityUser?.id || ""),
      ),
      "Seed sanity: owner id is not UUID",
    );
    assert(
      String(sanityUser?.email || "").toLowerCase() === ownerEmail.toLowerCase(),
      "Seed sanity: owner email mismatch",
    );
    assert(Boolean(sanityUser?.passwordHash), "Seed sanity: passwordHash missing");
    assert(sanityUser?.emailVerified === true, "Seed sanity: emailVerified must be true");
    assert(
      sanityUser?.isDisabled !== true,
      "Seed sanity: isDisabled must be false",
    );
    assert(
      sanityUser?.mustResetPassword !== true,
      "Seed sanity: mustResetPassword must be false",
    );
    assert(
      String(sanityUser?.appContext || "") === "mealscout",
      "Seed sanity: appContext must be mealscout",
    );
    assert(
      await bcrypt.compare(password, String(sanityUser?.passwordHash || "")),
      "Seed sanity: password hash mismatch before login",
    );

    const normalizedOwnerEmail = ownerEmail.toLowerCase();
    const [loginLookupUser] = await db
      .select({
        id: (users as any).id,
        userType: (users as any).userType,
        email: (users as any).email,
        passwordHash: (users as any).passwordHash,
        emailVerified: (users as any).emailVerified,
        isDisabled: (users as any).isDisabled,
        mustResetPassword: (users as any).mustResetPassword,
        appContext: (users as any).appContext,
      })
      .from(users as any)
      .where(
        and(
          sql`lower(${(users as any).email}) = ${normalizedOwnerEmail}`,
          or(
            eq((users as any).isDisabled, false),
            sql`${(users as any).isDisabled} is null`,
          ),
        ),
      )
      .limit(1);
    assert(Boolean(loginLookupUser), "Login lookup sanity: user not found by email");

    await db.insert(restaurants as any).values([
      {
        id: targetRestaurantId,
        ownerId,
        name: "Owner Value Contract Restaurant",
        address: "101 Runtime Lane",
        city: "Hammond",
        state: "LA",
        isActive: true,
        businessType: "restaurant",
      },
      {
        id: emptyRestaurantId,
        ownerId,
        name: "Owner Value Empty Restaurant",
        address: "202 Empty Lane",
        city: "Hammond",
        state: "LA",
        isActive: true,
        businessType: "restaurant",
      },
    ]);

    const now = new Date();
    const currentStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const previousStart = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000);

    const currentSeeds = [
      ["profile_view", "profile_view", 5],
      ["menu_click", "profile_action", 4],
      ["directions_click", "profile_action", 2],
      ["call_click", "profile_action", 1],
      ["order_click", "profile_action", 2],
      ["delivery_click", "profile_action", 3],
      ["qr_profile_open", "qr_open", 2],
      ["qr_menu_open", "qr_open", 1],
      ["deal_click", "profile_action", 2],
      ["event_click", "profile_action", 1],
      ["social_click", "profile_action", 1],
      ["share_click", "profile_action", 1],
    ] as const;
    for (const [actionType, eventType, times] of currentSeeds) {
      await seedRequestEvents({
        restaurantId: targetRestaurantId,
        profileEntityType: "restaurant",
        createdAt: currentStart,
        actionType,
        eventType: eventType as any,
        times,
      });
    }

    const previousSeeds = [
      ["profile_view", "profile_view", 2],
      ["menu_click", "profile_action", 1],
      ["directions_click", "profile_action", 1],
      ["order_click", "profile_action", 1],
      ["delivery_click", "profile_action", 1],
      ["qr_profile_open", "qr_open", 1],
    ] as const;
    for (const [actionType, eventType, times] of previousSeeds) {
      await seedRequestEvents({
        restaurantId: targetRestaurantId,
        profileEntityType: "restaurant",
        createdAt: previousStart,
        actionType,
        eventType: eventType as any,
        times,
      });
    }

    let ownerCookie = "";
    let outsiderCookie = "";
    let adminCookie = "";
    try {
      ownerCookie = await login(baseUrl, ownerEmail, password);
      outsiderCookie = await login(baseUrl, outsiderEmail, password);
      adminCookie = await login(baseUrl, adminEmail, password);
    } catch (error) {
      const safeSummary = {
        idPresent: Boolean(sanityUser?.id),
        emailPresent: Boolean(sanityUser?.email),
        passwordHashPresent: Boolean(sanityUser?.passwordHash),
        emailVerified: Boolean(sanityUser?.emailVerified),
        isDisabled: Boolean(sanityUser?.isDisabled),
        mustResetPassword: Boolean(sanityUser?.mustResetPassword),
        appContext: String(sanityUser?.appContext || ""),
        role: String(sanityUser?.userType || ""),
      };
      console.error("[ovd-integration] login diagnostic summary:", safeSummary);
      throw error;
    }

    const authUserRes = await fetch(`${baseUrl}/api/auth/user`, {
      headers: { Cookie: ownerCookie, Accept: "application/json" },
    });
    assert(authUserRes.status === 200, "Authenticated /api/auth/user check failed");

    const unauth = await fetch(
      `${baseUrl}/api/restaurants/${targetRestaurantId}/owner-value-dashboard?window=7d`,
      { headers: { Origin: baseUrl, Referer: `${baseUrl}/restaurant-owner-dashboard` } },
    );
    assert([401, 403].includes(unauth.status), "Unauthenticated request should be rejected");

    const outsiderRes = await fetch(
      `${baseUrl}/api/restaurants/${targetRestaurantId}/owner-value-dashboard?window=7d`,
      {
        headers: {
          Cookie: outsiderCookie,
          Origin: baseUrl,
          Referer: `${baseUrl}/restaurant-owner-dashboard`,
        },
      },
    );
    assert(outsiderRes.status === 403, "Non-owner should receive 403");

    const ownerRes = await fetch(
      `${baseUrl}/api/restaurants/${targetRestaurantId}/owner-value-dashboard?window=7d`,
      {
        headers: {
          Cookie: ownerCookie,
          Accept: "application/json",
          Origin: baseUrl,
          Referer: `${baseUrl}/restaurant-owner-dashboard`,
        },
      },
    );
    assert(ownerRes.ok, `Owner request failed (${ownerRes.status})`);
    const ownerBody: any = await ownerRes.json();

    assert(ownerBody?.restaurantId === targetRestaurantId, "restaurantId mismatch");
    assert(ownerBody?.window === "7d", "window mismatch");
    assert(typeof ownerBody?.generatedAt === "string", "generatedAt missing");
    assert(typeof ownerBody?.freshnessLabel === "string", "freshnessLabel missing");
    assert(!("logs" in ownerBody), "Raw logs must not be exposed");

    assert(ownerBody?.totals?.profileViews === 5, "profileViews total mismatch");
    assert(ownerBody?.totals?.menuClicks === 4, "menuClicks total mismatch");
    assert(ownerBody?.totals?.directionsClicks === 2, "directionsClicks total mismatch");
    assert(ownerBody?.totals?.callClicks === 1, "callClicks total mismatch");
    assert(ownerBody?.totals?.orderClicks === 2, "orderClicks total mismatch");
    assert(ownerBody?.totals?.deliveryClicks === 3, "deliveryClicks total mismatch");
    assert(ownerBody?.totals?.qrOpens === 3, "qrOpens total mismatch");
    assert(ownerBody?.totals?.dealClicks === 2, "dealClicks total mismatch");
    assert(ownerBody?.totals?.eventClicks === 1, "eventClicks total mismatch");
    assert(ownerBody?.totals?.socialClicks === 1, "socialClicks total mismatch");
    assert(ownerBody?.totals?.shareClicks === 1, "shareClicks total mismatch");

    assert(ownerBody?.previousWindowTotals?.profileViews === 2, "prev profileViews mismatch");
    assert(ownerBody?.previousWindowTotals?.menuClicks === 1, "prev menuClicks mismatch");
    assert(ownerBody?.previousWindowTotals?.directionsClicks === 1, "prev directions mismatch");
    assert(ownerBody?.previousWindowTotals?.orderClicks === 1, "prev order mismatch");
    assert(ownerBody?.previousWindowTotals?.deliveryClicks === 1, "prev delivery mismatch");
    assert(ownerBody?.previousWindowTotals?.qrOpens === 1, "prev qr mismatch");

    assert(ownerBody?.deltas?.profileViews === 3, "profileViews delta mismatch");
    assert(ownerBody?.deltas?.menuClicks === 3, "menuClicks delta mismatch");
    assert(ownerBody?.deltas?.directionsClicks === 1, "directionsClicks delta mismatch");
    assert(ownerBody?.deltas?.callClicks === 1, "callClicks delta mismatch");
    assert(ownerBody?.deltas?.orderClicks === 3, "orderClicks delta mismatch");
    assert(ownerBody?.deltas?.qrOpens === 2, "qrOpens delta mismatch");

    const topActions = Array.isArray(ownerBody?.topActions) ? ownerBody.topActions : [];
    assert(topActions.length > 0, "topActions should not be empty");
    for (let i = 1; i < topActions.length; i++) {
      assert(
        Number(topActions[i - 1].count) >= Number(topActions[i].count),
        "topActions must be sorted descending",
      );
    }

    const adminRes = await fetch(
      `${baseUrl}/api/restaurants/${targetRestaurantId}/owner-value-dashboard?window=7d`,
      {
        headers: {
          Cookie: adminCookie,
          Accept: "application/json",
          Origin: baseUrl,
          Referer: `${baseUrl}/restaurant-owner-dashboard`,
        },
      },
    );
    assert(adminRes.ok, `Admin request failed (${adminRes.status})`);

    const emptyRes = await fetch(
      `${baseUrl}/api/restaurants/${emptyRestaurantId}/owner-value-dashboard?window=7d`,
      {
        headers: {
          Cookie: ownerCookie,
          Accept: "application/json",
          Origin: baseUrl,
          Referer: `${baseUrl}/restaurant-owner-dashboard`,
        },
      },
    );
    assert(emptyRes.ok, `Empty state request failed (${emptyRes.status})`);
    const emptyBody: any = await emptyRes.json();

    assert(emptyBody?.totals?.profileViews === 0, "empty totals profileViews must be 0");
    assert(emptyBody?.totals?.menuClicks === 0, "empty totals menuClicks must be 0");
    assert(emptyBody?.totals?.directionsClicks === 0, "empty totals directionsClicks must be 0");
    assert(emptyBody?.totals?.callClicks === 0, "empty totals callClicks must be 0");
    assert(emptyBody?.totals?.orderClicks === 0, "empty totals orderClicks must be 0");
    assert(emptyBody?.totals?.deliveryClicks === 0, "empty totals deliveryClicks must be 0");
    assert(emptyBody?.totals?.qrOpens === 0, "empty totals qrOpens must be 0");
    assert(!("logs" in emptyBody), "empty response must not expose raw logs");
    const emptyRecs = Array.isArray(emptyBody?.recommendations)
      ? emptyBody.recommendations
      : [];
    assert(
      emptyRecs.some(
        (item: any) =>
          String(item?.id || "").includes("drive_initial_traffic") ||
          String(item?.title || "").toLowerCase().includes("no profile views"),
      ),
      "empty state should include share-profile/QR recommendation",
    );

    console.log("owner-value-dashboard.integration.contract: PASS");
  } finally {
    try {
      await db
        .delete(requestLogs)
        .where(
          and(
            inArray(requestLogs.entityId, [targetRestaurantId, emptyRestaurantId]),
            eq(requestLogs.surface, "public_profile"),
          ),
        );
      await db
        .delete(restaurants as any)
        .where(inArray((restaurants as any).id, [targetRestaurantId, emptyRestaurantId]));
      await db
        .delete(users as any)
        .where(inArray((users as any).id, [ownerId, outsiderId, adminId]));
    } catch {}

    if (!server.killed) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
          shell: true,
          stdio: "ignore",
        });
      } else {
        server.kill("SIGTERM");
      }
    }
  }
}

run().catch((error) => {
  console.error(
    "owner-value-dashboard.integration.contract: FAIL",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
