const normalizeBaseUrl = (input) =>
  String(input || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/, "https://127.0.0.1");

const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
);

const ownerCookie = String(process.env.ORDERING_OWNER_COOKIE || "").trim();
const subscribedRestaurantId = String(
  process.env.ORDERING_SUBSCRIBED_RESTAURANT_ID || "",
).trim();
const unsubscribedRestaurantId = String(
  process.env.ORDERING_UNSUBSCRIBED_RESTAURANT_ID || "",
).trim();

const missing = [];
if (!ownerCookie) missing.push("ORDERING_OWNER_COOKIE");
if (!subscribedRestaurantId) missing.push("ORDERING_SUBSCRIBED_RESTAURANT_ID");
if (!unsubscribedRestaurantId) missing.push("ORDERING_UNSUBSCRIBED_RESTAURANT_ID");

if (missing.length > 0) {
  console.log(
    `[ordering-smoke] SKIP: set ${missing.join(", ")} to run live endpoint checks`,
  );
  process.exit(0);
}

const request = async (path) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "application/json",
      Cookie: ownerCookie,
    },
  });

  const data = await res
    .json()
    .catch(() => ({ message: `non-json response (${res.status})` }));
  return { status: res.status, data };
};

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
