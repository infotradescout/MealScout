const normalizeBaseUrl = (input) =>
  String(input || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/, "https://127.0.0.1");

const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
);
const smokeOrigin = String(
  process.env.SMOKE_ORIGIN || "http://localhost:5000",
).trim();
let ownerCookie = String(process.env.ORDERING_OWNER_COOKIE || "").trim();
const ownerEmail = String(
  process.env.ORDERING_OWNER_EMAIL ||
    process.env.MEALSCOUT_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "",
).trim();
const ownerPassword = String(
  process.env.ORDERING_OWNER_PASSWORD ||
    process.env.MEALSCOUT_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "",
).trim();

const getCookieHeaderFromResponse = (res) => {
  const values =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  return values
    .map((line) => String(line || "").split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
};

const apiJson = async (path, cookie) => {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      Origin: smokeOrigin,
      Referer: `${smokeOrigin}/`,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

if (!ownerCookie && ownerEmail && ownerPassword) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: smokeOrigin,
      Referer: `${smokeOrigin}/`,
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  ownerCookie = getCookieHeaderFromResponse(res);
}

if (!ownerCookie) {
  console.log(
    "[ordering-profile-smoke] SKIP: set ORDERING_OWNER_COOKIE or owner login credentials",
  );
  process.exit(0);
}

const mine = await apiJson("/api/restaurants/my", ownerCookie);
if (mine.status !== 200 || !Array.isArray(mine.data)) {
  throw new Error(`unable to list owner profiles (${mine.status})`);
}

const restaurantIds = mine.data
  .map((row) => String(row?.id || "").trim())
  .filter(Boolean);
if (restaurantIds.length === 0) {
  console.log("[ordering-profile-smoke] SKIP: account has no business profiles");
  process.exit(0);
}

let failed = 0;
for (const restaurantId of restaurantIds) {
  for (const path of [
    `/api/owner/kitchen-queue/${encodeURIComponent(restaurantId)}`,
    `/api/owner/orders/${encodeURIComponent(restaurantId)}`,
  ]) {
    const result = await apiJson(path, ownerCookie);
    const passed = result.status === 200;
    console.log(
      `[${passed ? "PASS" : "FAIL"}] ${path} -> ${result.status} (expected 200)`,
    );
    if (!passed) failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log("[ordering-profile-smoke] all owned profiles have order workspace access");
