/**
 * Public Discovery Contract v1 — MealScout gate helpers.
 *
 * Default: offline structural assertions against repo governance + robots template.
 * Optional live probes: PUBLIC_DISCOVERY_LIVE=1 (network; never mutates production).
 *
 * Fail closed on hard contract violations when live probes are enabled.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const live = ["1", "true", "yes"].includes(
  String(process.env.PUBLIC_DISCOVERY_LIVE || "").toLowerCase(),
);
const liveBase = String(
  process.env.PUBLIC_DISCOVERY_BASE_URL || "https://www.mealscout.us",
)
  .trim()
  .replace(/\/+$/, "");

const CLAIMED_TRUCK_SLUG =
  "3d-eats-tea--95c4e656-f3cc-46ab-ae18-53f549cecfd1";
const THIN_TRUCK_SLUG =
  "16-monkeys-concession--cbd132ee-7bcf-4bee-9150-ed8b9918919d";

const MARKETING_TITLE = "MealScout | Discover Local Food Near You";

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assertContractDoc() {
  const docPath = "docs/governance/PUBLIC_DISCOVERY_CONTRACT_V1.md";
  assert.ok(existsSync(path.join(root, docPath)), `${docPath} must exist`);
  const doc = read(docPath);
  for (const needle of [
    "Public eligibility",
    "Required first-response facts",
    "Sitemap rules",
    "Attribution requirements",
    "Live production proof",
    "discovery_landing",
    "JW Stone",
  ]) {
    assert.ok(doc.includes(needle), `contract must define: ${needle}`);
  }
}

function assertRobotsTemplate() {
  const robots = read("client/public/robots.txt");
  assert.ok(robots.includes("Sitemap: https://www.mealscout.us/sitemap.xml"));
  assert.ok(robots.includes("Disallow: /admin"));
  assert.ok(robots.includes("Disallow: /dashboard"));
  assert.ok(robots.includes("Allow: /truck/"));
  assert.ok(robots.includes("AI: https://www.mealscout.us/llms.txt"));
}

function assertSharedIndexabilityWiring() {
  const sitemap = read("server/routes/seoRoutes.ts");
  const prerender = read("server/seo/publicProfilePrerender.ts");
  const shared = read("server/seo/publicRestaurantIndexability.ts");
  assert.match(shared, /evaluatePublicRestaurantIndexability/);
  assert.match(shared, /SITEMAP_MEMBERSHIP_VERSION/);
  assert.match(sitemap, /isIndexableRestaurantRow|isPublicRestaurantIndexable/);
  assert.match(sitemap, /applySitemapMembershipCacheHeaders/);
  assert.match(prerender, /publicRestaurantRobotsDirective/);
  assert.equal(
    /shouldServePrerender|from "\.\/botDetection"/i.test(prerender),
    false,
    "public profile prerender must not gate SSR on botDetection / crawler UA",
  );

  const vercel = JSON.parse(read("vercel.json"));
  const profileProxyRules = [
    ...(vercel.rewrites || []),
    ...(vercel.routes || []),
  ].filter((rule: { source?: string; src?: string; destination?: string; dest?: string }) => {
    const src = String(rule.source || rule.src || "");
    const dest = String(rule.destination || rule.dest || "");
    return (
      /truck/.test(src) &&
      dest.includes("mealscout.onrender.com") &&
      !dest.includes("sitemap")
    );
  });
  assert.ok(
    profileProxyRules.length > 0,
    "vercel must proxy public truck/profile paths to Render",
  );
  for (const rule of profileProxyRules) {
    assert.equal(
      Array.isArray(rule.has),
      false,
      "vercel public profile proxy must not be UA- or query-gated",
    );
  }
}

function assertProtectedRouteWiring() {
  const gate = read("server/seo/protectedHtmlRoutes.ts");
  const indexTs = read("server/index.ts");
  const viteTs = read("server/vite.ts");
  assert.match(gate, /guardUnauthenticatedProtectedHtml/);
  assert.match(gate, /buildProtectedRouteInterstitialHtml/);
  assert.equal(
    /\bGPTBot\b|req\.get\(\s*["']user-agent["']|headers\[["']user-agent["']\]/i.test(
      gate,
    ),
    false,
    "protected-route gate must not detect crawlers by UA",
  );
  assert.match(indexTs, /guardUnauthenticatedProtectedHtml/);
  assert.match(viteTs, /guardUnauthenticatedProtectedHtml/);

  const interstitial = gate.includes("Sign in required");
  assert.ok(interstitial, "interstitial copy must exist in gate module");

  const vercel = JSON.parse(read("vercel.json"));
  const rewrites: Array<{ source?: string; destination?: string }> =
    vercel.rewrites || [];
  for (const prefix of ["/admin", "/dashboard"]) {
    assert.ok(
      rewrites.some(
        (rule) =>
          String(rule.source || "").startsWith(prefix) &&
          String(rule.destination || "").includes("mealscout.onrender.com"),
      ),
      `vercel must proxy ${prefix} to Render (not marketing SPA)`,
    );
  }
}

async function fetchText(url: string, ua?: string) {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml",
  };
  if (ua) headers["user-agent"] = ua;
  const res = await fetch(url, {
    headers,
    redirect: "manual",
  });
  const text = await res.text();
  return { res, text };
}

function isAppShell(html: string): boolean {
  return (
    /id=["']root["']/.test(html) &&
    /<title>\s*MealScout\s*\|\s*Discover Local Food Near You\s*<\/title>/i.test(
      html,
    )
  );
}

function assertProtectedHtmlResponse(protectedPath: string, text: string, status: number) {
  assert.ok(
    !isAppShell(text),
    `HARD FAIL: ${protectedPath} must not return homepage SPA shell`,
  );
  assert.equal(
    text.includes(MARKETING_TITLE),
    false,
    `HARD FAIL: ${protectedPath} must not include marketing homepage title`,
  );
  assert.equal(
    /application\/ld\+json/i.test(text) && /Discover (Local Food|food trucks)/i.test(text),
    false,
    `HARD FAIL: ${protectedPath} must not include marketing homepage JSON-LD`,
  );
  assert.ok(
    [401, 403, 404].includes(status) || /noindex/i.test(text),
    `${protectedPath} must be 401/403/404 or explicit noindex interstitial (status=${status})`,
  );
}

async function liveProtectedRouteProbes() {
  // Unauthenticated requests — any UA. Enforcement must not depend on GPTBot.
  const browserUa =
    "Mozilla/5.0 (compatible; MealScoutDiscoveryContract/1.0; +https://www.mealscout.us)";
  for (const protectedPath of [
    "/admin",
    "/dashboard",
    "/vendor-dashboard",
    "/supplier-portal",
  ]) {
    const page = await fetchText(`${liveBase}${protectedPath}`, browserUa);
    assertProtectedHtmlResponse(protectedPath, page.text, page.res.status);
  }
}

function extractCanonical(html: string): string {
  const match = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  ) || html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
  );
  return match?.[1] || "";
}

function extractRobots(html: string): string {
  const match = html.match(
    /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i,
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']robots["']/i,
  );
  return (match?.[1] || "").toLowerCase();
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return (match?.[1] || "").trim();
}

function assertClaimedTruckSsrIdentity(label: string, html: string, status: number) {
  assert.equal(status, 200, `${label}: claimed truck must return 200`);
  assert.ok(!isAppShell(html), `${label}: must not be generic SPA shell`);
  assert.equal(
    html.includes(MARKETING_TITLE),
    false,
    `${label}: must not use marketing homepage title`,
  );
  assert.ok(/<h1>/i.test(html), `${label}: needs route-specific h1`);
  const title = extractTitle(html);
  assert.ok(title.length > 0, `${label}: needs title`);
  assert.ok(
    /3d\s*eats/i.test(title) || /3d\s*eats/i.test(html),
    `${label}: needs truck-specific identity (3D Eats)`,
  );
  const robots = extractRobots(html);
  assert.match(robots, /index\s*,\s*follow/i, `${label}: needs index,follow`);
  const canonical = extractCanonical(html);
  assert.ok(canonical, `${label}: needs canonical`);
  assert.ok(
    canonical.includes(CLAIMED_TRUCK_SLUG) ||
      /\/truck\//i.test(canonical),
    `${label}: canonical must identify claimed truck route`,
  );
  return { title, robots, canonical };
}

async function liveSitemapAndProfileProbes() {
  const botUa =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const chromeUa =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const claimed = `${liveBase}/truck/${CLAIMED_TRUCK_SLUG}`;
  const thin = `${liveBase}/truck/${THIN_TRUCK_SLUG}`;

  const robots = await fetchText(`${liveBase}/robots.txt`, botUa);
  assert.equal(robots.res.status, 200);
  assert.match(
    robots.res.headers.get("content-type") || "",
    /text\/plain/i,
  );

  const sitemap = await fetchText(`${liveBase}/sitemap.xml`, botUa);
  assert.equal(sitemap.res.status, 200);
  assert.match(
    sitemap.res.headers.get("content-type") || "",
    /xml/i,
  );
  assert.ok(
    !isAppShell(sitemap.text),
    "sitemap.xml must not return an application shell",
  );

  const trucks = await fetchText(`${liveBase}/sitemap-trucks.xml`, botUa);
  assert.equal(trucks.res.status, 200);
  assert.match(
    trucks.res.headers.get("content-type") || "",
    /xml/i,
  );
  assert.ok(
    trucks.text.includes("<urlset") && trucks.text.includes("</urlset>"),
    "truck sitemap must be valid urlset XML",
  );

  const thinInSitemap = trucks.text.includes(THIN_TRUCK_SLUG);
  const claimedInSitemap = trucks.text.includes(CLAIMED_TRUCK_SLUG);
  assert.equal(
    thinInSitemap,
    false,
    "HARD FAIL: noindex/unclaimed truck must not appear in sitemap-trucks.xml",
  );
  assert.equal(
    claimedInSitemap,
    true,
    "claimed indexable truck (3D Eats) must remain in sitemap-trucks.xml",
  );
  assert.ok(
    !sitemap.text.includes(THIN_TRUCK_SLUG),
    "thin truck must also be absent from sitemap.xml",
  );

  const claimedBot = await fetchText(claimed, botUa);
  const claimedChrome = await fetchText(claimed, chromeUa);
  const botIdentity = assertClaimedTruckSsrIdentity(
    "Googlebot",
    claimedBot.text,
    claimedBot.res.status,
  );
  const chromeIdentity = assertClaimedTruckSsrIdentity(
    "Chrome desktop",
    claimedChrome.text,
    claimedChrome.res.status,
  );
  assert.equal(
    chromeIdentity.canonical,
    botIdentity.canonical,
    "Chrome and Googlebot must share the same claimed-truck canonical",
  );
  assert.equal(
    chromeIdentity.robots,
    botIdentity.robots,
    "Chrome and Googlebot must share the same robots directive",
  );
  assert.equal(
    chromeIdentity.title,
    botIdentity.title,
    "Chrome and Googlebot must share the same page title identity",
  );

  const thinPage = await fetchText(thin, chromeUa);
  assert.equal(thinPage.res.status, 200);
  const thinNoindex = /noindex/i.test(thinPage.text);
  assert.ok(thinNoindex, "thin/unclaimed sample should emit noindex");
  assert.ok(
    !(thinNoindex && thinInSitemap),
    "HARD FAIL: noindex entity must not appear in sitemap (Public Discovery Contract v1 §6)",
  );
}

async function liveProbes() {
  await liveProtectedRouteProbes();
  console.log("public-discovery-contract-v1 protected-route live probes: PASS");

  const runSitemap = !["0", "false", "no"].includes(
    String(process.env.PUBLIC_DISCOVERY_LIVE_SITEMAP || "1").toLowerCase(),
  );
  if (!runSitemap) {
    console.log(
      "public-discovery-contract-v1 sitemap/profile live probes: SKIPPED",
    );
    return;
  }

  await liveSitemapAndProfileProbes();
}

async function main() {
  assertContractDoc();
  assertRobotsTemplate();
  assertSharedIndexabilityWiring();
  assertProtectedRouteWiring();
  console.log("public-discovery-contract-v1 offline checks: PASS");

  if (!live) {
    console.log(
      "public-discovery-contract-v1 live probes: SKIPPED (set PUBLIC_DISCOVERY_LIVE=1)",
    );
    return;
  }

  await liveProbes();
  console.log("public-discovery-contract-v1 live probes: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
