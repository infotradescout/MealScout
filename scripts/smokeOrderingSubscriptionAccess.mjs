const normalizeBaseUrl = (input) =>
  String(input || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/, "https://127.0.0.1");

const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
);

let ownerCookie = String(process.env.ORDERING_OWNER_COOKIE || "").trim();
let subscribedRestaurantId = String(
  process.env.ORDERING_SUBSCRIBED_RESTAURANT_ID || "",
).trim();
let unsubscribedRestaurantId = String(
  process.env.ORDERING_UNSUBSCRIBED_RESTAURANT_ID || "",
).trim();
const ownerEmail = String(process.env.ORDERING_OWNER_EMAIL || "").trim();
const ownerPassword = String(process.env.ORDERING_OWNER_PASSWORD || "").trim();

const getCookieHeaderFromResponse = (res) => {
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (() => {
          const value = res.headers.get("set-cookie");
          return value ? [value] : [];
        })();
  return setCookie
    .map((line) => String(line || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

const loginAndGetCookie = async () => {
  if (!ownerEmail || !ownerPassword) return "";

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `login failed (${res.status}): ${body?.error || body?.message || "unknown error"}`,
    );
  }

  const cookie = getCookieHeaderFromResponse(res);
  if (!cookie) {
    throw new Error("login succeeded but no session cookie was returned");
  }
  return cookie;
};

const apiJson = async (path, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/json",
      Cookie: cookie,
    },
  });

  const data = await res
    .json()
    .catch(() => ({ message: `non-json response (${res.status})` }));
  return { status: res.status, data };
};

const autoDiscoverRestaurants = async (cookie) => {
  const mine = await apiJson("/api/restaurants/my", cookie);
  if (mine.status !== 200 || !Array.isArray(mine.data)) {
    throw new Error(
      `unable to list owner restaurants (${mine.status}): ${JSON.stringify(mine.data)}`,
    );
  }

  if (mine.data.length < 2) {
    throw new Error(
      "need at least 2 restaurants for subscribed vs unsubscribed smoke checks",
    );
  }

  const states = [];
  for (const restaurant of mine.data) {
    const id = String(restaurant?.id || "").trim();
    if (!id) continue;
    const menuRes = await fetch(`${baseUrl}/api/menus/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const menuBody = await menuRes.json().catch(() => ({}));
    states.push({ id, orderingEnabled: Boolean(menuBody?.orderingEnabled) });
  }

  const subscribed = states.find((s) => s.orderingEnabled);
  const unsubscribed = states.find((s) => !s.orderingEnabled);
  if (!subscribed || !unsubscribed) {
    throw new Error(
      "could not auto-discover one subscribed and one unsubscribed restaurant",
    );
  }

  return {
    subscribedRestaurantId: subscribed.id,
    unsubscribedRestaurantId: unsubscribed.id,
  };
};

const ensureInputs = async () => {
  if (!ownerCookie && ownerEmail && ownerPassword) {
    ownerCookie = await loginAndGetCookie();
    console.log("[ordering-smoke] session cookie acquired via /api/auth/login");
  }

  if (!ownerCookie) {
    console.log(
      "[ordering-smoke] SKIP: set ORDERING_OWNER_COOKIE or ORDERING_OWNER_EMAIL + ORDERING_OWNER_PASSWORD",
    );
    process.exit(0);
  }

  if (!subscribedRestaurantId || !unsubscribedRestaurantId) {
    const discovered = await autoDiscoverRestaurants(ownerCookie);
    subscribedRestaurantId ||= discovered.subscribedRestaurantId;
    unsubscribedRestaurantId ||= discovered.unsubscribedRestaurantId;
    console.log(
      `[ordering-smoke] auto-discovered restaurants: subscribed=${subscribedRestaurantId}, unsubscribed=${unsubscribedRestaurantId}`,
    );
  }
};

const request = async (path) => {
  return apiJson(path, ownerCookie);
};

const run = async () => {
  await ensureInputs();

  const checks = [
    {
      name: "subscribed kitchen queue",
      path: `/api/owner/kitchen-queue/${encodeURIComponent(subscribedRestaurantId)}`,
      expect: 200,
    },
    {
      name: "subscribed order history",
      path: `/api/owner/orders/${encodeURIComponent(subscribedRestaurantId)}`,
      expect: 200,
    },
    {
      name: "unsubscribed kitchen queue",
      path: `/api/owner/kitchen-queue/${encodeURIComponent(unsubscribedRestaurantId)}`,
      expect: 403,
    },
    {
      name: "unsubscribed order history",
      path: `/api/owner/orders/${encodeURIComponent(unsubscribedRestaurantId)}`,
      expect: 403,
    },
  ];

  let failed = 0;
  console.log(`[ordering-smoke] base URL: ${baseUrl}`);

  for (const check of checks) {
    try {
      const result = await request(check.path);
      const ok = result.status === check.expect;
      const marker = ok ? "PASS" : "FAIL";
      console.log(
        `[${marker}] ${check.name} -> ${result.status} (expected ${check.expect})`,
      );
      if (!ok) {
        failed += 1;
        console.log(`[ordering-smoke] response: ${JSON.stringify(result.data)}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`[FAIL] ${check.name} -> network error: ${error.message}`);
    }
  }

  if (failed > 0) {
    console.error(`[ordering-smoke] failed checks: ${failed}`);
    process.exit(1);
  }

  console.log("[ordering-smoke] all checks passed");
};

run().catch((error) => {
  console.error(`[ordering-smoke] FAIL: ${error.message || String(error)}`);
  process.exit(1);
});
