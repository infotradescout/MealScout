import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function spawnCmd(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
}

async function getFreePort(preferred = 5210) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
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

async function waitForHttp(url, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if ([200, 401, 403, 404].includes(res.status)) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function stopServer(server) {
  if (!server || server.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }

  await Promise.race([
    new Promise((resolve) => {
      server.once("exit", () => resolve());
      server.once("close", () => resolve());
    }),
    sleep(10_000).then(() => undefined),
  ]);
}

const prohibitedPhrases = [
  "what we know",
  "source evidence",
  "available source evidence",
  "evidence-based profile",
  "profile was built",
  "we're still confirming",
  "we’re still confirming",
  "community-submitted profile",
  "community profile",
  "partial menu evidence",
  "live local taste report",
  "trend engine",
  "the safest nearby mix we have",
  "while local coverage builds",
  "coverage is limited while public profiles are verified",
  "coverage is verified",
  "verified or discoverable food trucks",
  "thin on profile detail",
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function expectVisibleText(page, text, timeout = 25_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}

async function verifyNoProhibitedText(page, contextLabel) {
  const bodyText = normalizeText(await page.locator("body").innerText());
  for (const phrase of prohibitedPhrases) {
    assert(
      !bodyText.includes(phrase),
      `${contextLabel} still contains prohibited phrase: ${phrase}`,
    );
  }
}

async function openRoute(page, baseUrl, route) {
  const response = await page.goto(`${baseUrl}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  assert(response, `No response received for ${route}`);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
}

async function resolveWorkingRestaurantRoute(page, baseUrl) {
  const subscribedResponse = await page.request.get(
    `${baseUrl}/api/restaurants/subscribed/30.4213/-87.2169?radius=25`,
  );

  if (subscribedResponse.ok()) {
    const payload = await subscribedResponse.json().catch(() => []);
    const restaurants = Array.isArray(payload) ? payload : [];
    const restaurant = restaurants.find(
      (item) => !item?.isFoodTruck && String(item?.businessType || "").toLowerCase() !== "food_truck",
    );
    const restaurantId = String(restaurant?.id || "").trim();
    if (restaurantId) return `/restaurant/${restaurantId}`;
  }

  const searchResponse = await page.request.get(
    `${baseUrl}/api/restaurants/search?q=${encodeURIComponent("restaurant")}`,
  );
  if (searchResponse.ok()) {
    const payload = await searchResponse.json().catch(() => []);
    const restaurants = Array.isArray(payload) ? payload : [];
    const restaurant = restaurants.find(
      (item) => !item?.isFoodTruck && String(item?.businessType || "").toLowerCase() !== "food_truck",
    );
    const restaurantId = String(restaurant?.id || "").trim();
    if (restaurantId) return `/restaurant/${restaurantId}`;
  }

  throw new Error("Could not resolve a live restaurant public profile route for browser smoke.");
}

async function verifyScout(page, baseUrl, viewportLabel) {
  await openRoute(page, baseUrl, "/scout");
  await page.locator('[data-testid="scout-map-container"]').first().waitFor({ state: "visible", timeout: 15000 });
  const bodyText = normalizeText(await page.locator("body").innerText());
  assert(
    !bodyText.includes("find what is worth eating nearby.") &&
      !bodyText.includes("what is worth eating in"),
    `${viewportLabel} /scout rendered the removed Scout hero/header copy`,
  );
  assert(
    await page.locator("[data-scout-row-id]").count() > 0 ||
      bodyText.includes("the local board is quiet right now."),
    `${viewportLabel} /scout did not render discovery rails or a sparse-state body`,
  );
  assert(
    bodyText.includes("open now") || bodyText.includes("the local board is quiet right now."),
    `${viewportLabel} /scout did not render a valid discovery or sparse-state body`,
  );
  await verifyNoProhibitedText(page, `${viewportLabel} /scout`);
}

async function verifyMap(page, baseUrl, viewportLabel) {
  // /map intentionally redirects into the Scout discovery experience.
  await openRoute(page, baseUrl, "/map");
  await page.locator('[data-testid="scout-map-container"]').first().waitFor({ state: "visible", timeout: 15000 });
  await verifyNoProhibitedText(page, `${viewportLabel} /map`);
}

async function verifyTrending(page, baseUrl, viewportLabel) {
  // /trending intentionally redirects into the Scout discovery experience.
  await openRoute(page, baseUrl, "/trending");
  await page.locator('[data-testid="scout-map-container"]').first().waitFor({ state: "visible", timeout: 15000 });
  await verifyNoProhibitedText(page, `${viewportLabel} /trending`);
}

async function verifyTruckProfile(
  page,
  baseUrl,
  route,
  expectedName,
  viewportLabel,
  scheduleText,
  extraVisibleTexts = [],
) {
  await openRoute(page, baseUrl, route);
  await expectVisibleText(page, expectedName);
  await expectVisibleText(page, "Menu");
  await expectVisibleText(page, scheduleText);
  for (const text of extraVisibleTexts) {
    await expectVisibleText(page, text);
  }
  await verifyNoProhibitedText(page, `${viewportLabel} ${route}`);
}

async function verifyRestaurantProfile(page, baseUrl, route, viewportLabel) {
  await openRoute(page, baseUrl, route);
  const bodyText = normalizeText(await page.locator("body").innerText());
  assert(!bodyText.includes("profile not found"), `${viewportLabel} ${route} did not resolve`);
  await expectVisibleText(page, "Share this profile");
  await verifyNoProhibitedText(page, `${viewportLabel} ${route}`);
}

async function verifySearchEmpty(page, baseUrl, viewportLabel) {
  await openRoute(page, baseUrl, "/search?q=zzzzzzzzzzzzzzzzzz");
  await expectVisibleText(page, "No matches found");
  await expectVisibleText(page, "Try adjusting your search terms to find restaurants, trucks, or deals.");
}

async function verifyUnavailableState(page, baseUrl, viewportLabel) {
  await openRoute(page, baseUrl, "/restaurant/not-a-real-profile");
  await expectVisibleText(page, "Profile not found");
}

async function runViewport(name, contextOptions, baseUrl) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    const restaurantRoute = await resolveWorkingRestaurantRoute(page, baseUrl);

    await verifyScout(page, baseUrl, name);
    await verifyMap(page, baseUrl, name);
    await verifyTrending(page, baseUrl, name);
    await verifyTruckProfile(
      page,
      baseUrl,
      "/truck/blessed-berry-bowls--e77ac77a-c432-42d0-ac0f-22c48b6306c9",
      "Blessed Berry Bowls",
      name,
      "Schedule",
      ["Share this profile"],
    );
    await verifyTruckProfile(
      page,
      baseUrl,
      "/truck/creativbowls--75dd470e-2692-4579-bde0-a64dcc3f6fcb",
      "CREATIVBOWLS",
      name,
      "Share this profile",
      [
        "Own this truck? Add menu, schedule, logo, or hours.",
      ],
    );
    await verifyRestaurantProfile(page, baseUrl, restaurantRoute, name);
    await verifySearchEmpty(page, baseUrl, name);
    await verifyUnavailableState(page, baseUrl, name);

    console.log(`public-sitewide-copy-cleanup.browser-smoke: PASS (${name})`);
    console.log(`public-sitewide-copy-cleanup.browser-smoke: restaurant-route=${restaurantRoute} (${name})`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawnCmd("npm", ["run", "dev:server"], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      CLIENT_ORIGIN: "http://127.0.0.1:5174",
      ALLOWED_ORIGINS: `${baseUrl},http://127.0.0.1:5174`,
      MEALSCOUT_BYPASS_STRIPE: process.env.MEALSCOUT_BYPASS_STRIPE || "true",
    },
  });

  try {
    await waitForHttp(`${baseUrl}/api/auth/user`);

    await runViewport(
      "desktop",
      {
        viewport: { width: 1440, height: 960 },
      },
      baseUrl,
    );

    await runViewport(
      "mobile",
      {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      baseUrl,
    );
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(
    "public-sitewide-copy-cleanup.browser-smoke: FAIL",
    error?.stack || error?.message || error,
  );
  process.exit(1);
});
