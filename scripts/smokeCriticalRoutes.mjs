const normalizeBaseUrl = (input) =>
  String(input || "")
    .trim()
    .replace(/\/$/, "")
    // Node fetch on Windows can prefer IPv6 for localhost; our server binds IPv4.
    .replace(/^http:\/\/localhost(?=[:/]|$)/, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/, "https://127.0.0.1");

const baseUrl = normalizeBaseUrl(
  process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000",
);
const apiOnly =
  String(process.env.SMOKE_API_ONLY || "").toLowerCase() === "true" ||
  baseUrl.includes(".onrender.com");

const checks = [
  { name: "Home page", path: "/", expect: [200] },
  { name: "Login page", path: "/login", expect: apiOnly ? [200, 404] : [200] },
  { name: "Map page", path: "/map", expect: apiOnly ? [200, 404] : [200] },
  { name: "API health", path: "/api/health", expect: [200] },
  { name: "Critical endpoint health", path: "/health/critical-endpoints", expect: [200] },
  { name: "Auth user", path: "/api/auth/user", expect: [200, 401] },
  { name: "Host profile status", path: "/api/hosts/me", expect: [200, 401] },
  { name: "Map locations", path: "/api/map/locations", expect: [200] },
  { name: "Parking pass feed", path: "/api/parking-pass", expect: [200] },
  { name: "Stories feed", path: "/api/stories/feed?page=0", expect: [200, 401] },
  {
    name: "Admin dashboard totals (guest guarded)",
    path: "/api/admin/dashboard-totals",
    expect: [401, 403],
  },
];

const run = async () => {
  console.log(`Smoke base URL: ${baseUrl}`);
  let failed = 0;

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
      });
      const ok = check.expect.includes(response.status);
      const marker = ok ? "PASS" : "FAIL";
      console.log(
        `[${marker}] ${check.name} -> ${response.status} (${check.expect.join(
          "/",
        )})`,
      );
      if (!ok) failed += 1;
    } catch (error) {
      failed += 1;
      console.log(`[FAIL] ${check.name} -> network error: ${error.message}`);
    }
  }

  if (failed > 0) {
    console.error(`Smoke checks failed: ${failed}`);
    process.exitCode = 1;
    return;
  }

  console.log("Smoke checks passed.");
};

run();
