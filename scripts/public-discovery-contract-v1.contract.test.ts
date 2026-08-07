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
  const claimed =
    "https://www.mealscout.us/truck/3d-eats-tea--95c4e656-f3cc-46ab-ae18-53f549cecfd1";
  const thin =
    "https://www.mealscout.us/truck/16-monkeys-concession--cbd132ee-7bcf-4bee-9150-ed8b9918919d";

  const robots = await fetchText("https://www.mealscout.us/robots.txt", botUa);
  assert.equal(robots.res.status, 200);
  assert.match(
    robots.res.headers.get("content-type") || "",
    /text\/plain/i,
  );

  const sitemap = await fetchText(
    "https://www.mealscout.us/sitemap.xml",
    botUa,
  );
  assert.equal(sitemap.res.status, 200);
  assert.match(
    sitemap.res.headers.get("content-type") || "",
    /xml/i,
  );
  assert.ok(
    !isAppShell(sitemap.text),
    "sitemap.xml must not return an application shell",
  );

  const trucks = await fetchText(
    "https://www.mealscout.us/sitemap-trucks.xml",
    botUa,
  );
  assert.equal(trucks.res.status, 200);
  assert.ok(
    trucks.text.includes(thin.replace("https://www.mealscout.us", "") ) ||
      trucks.text.includes(thin),
    "expected thin sample URL to still be present while regression is open",
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
    !isAppShell(claimedPage.text),
    "claimed bot page must not be SPA shell",
  );

  const thinPage = await fetchText(thin, botUa);
  assert.equal(thinPage.res.status, 200);
  const thinNoindex = /noindex/i.test(thinPage.text);
  const thinInSitemap = trucks.text.includes(
    "16-monkeys-concession--cbd132ee-7bcf-4bee-9150-ed8b9918919d",
  );
  assert.ok(
    !(thinNoindex && thinInSitemap),
    "HARD FAIL: noindex entity must not appear in sitemap (Public Discovery Contract v1 §6)",
  );

  for (const protectedPath of ["/admin", "/dashboard"]) {
    const page = await fetchText(
      `https://www.mealscout.us${protectedPath}`,
      botUa,
    );
    assert.ok(
      !isAppShell(page.text),
      `HARD FAIL: ${protectedPath} must not return homepage SPA shell to crawlers`,
    );
  }
}

async function main() {
  assertContractDoc();
  assertRobotsTemplate();
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
