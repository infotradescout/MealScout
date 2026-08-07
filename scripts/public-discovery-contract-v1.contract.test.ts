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
}

async function fetchText(url: string, ua: string) {
  const res = await fetch(url, {
    headers: { "user-agent": ua },
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

async function liveProbes() {
  const botUa = "GPTBot";
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

  const claimedPage = await fetchText(claimed, botUa);
  assert.equal(claimedPage.res.status, 200);
  assert.ok(
    /<h1>/i.test(claimedPage.text),
    "claimed bot response needs h1",
  );
  assert.ok(
    /index\s*,\s*follow/i.test(claimedPage.text),
    "claimed sample should be indexable",
  );
  assert.ok(
    /rel=["']canonical["']/i.test(claimedPage.text),
    "claimed sample needs canonical metadata",
  );
  assert.ok(
    !isAppShell(claimedPage.text),
    "claimed bot page must not be SPA shell",
  );

  const thinPage = await fetchText(thin, botUa);
  assert.equal(thinPage.res.status, 200);
  const thinNoindex = /noindex/i.test(thinPage.text);
  assert.ok(thinNoindex, "thin/unclaimed sample should emit noindex");
  assert.ok(
    !(thinNoindex && thinInSitemap),
    "HARD FAIL: noindex entity must not appear in sitemap (Public Discovery Contract v1 §6)",
  );

  for (const protectedPath of ["/admin", "/dashboard"]) {
    const page = await fetchText(`${liveBase}${protectedPath}`, botUa);
    assert.ok(
      !isAppShell(page.text),
      `HARD FAIL: ${protectedPath} must not return homepage SPA shell to crawlers`,
    );
  }
}

async function main() {
  assertContractDoc();
  assertRobotsTemplate();
  assertSharedIndexabilityWiring();
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
