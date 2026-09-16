/** Read-only, fixed-target proof launcher. Never merge this proof branch into the app. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sourceRef = "aab4aeb49d992032d9c0b1c09fe832837d8fd8d4";
const targetRevision = "f2a18ab19469890684483749ca4dd0775966a8db";
const target = "https://meal-scout2-le9xj9aya-tradescouts-projects.vercel.app";
const canonicalBase = "https://www.mealscout.us";
const sourceConfigBlob = "2f0b4cbd93fcf933dab4d3ecdf62877489597660";
const pages = [
  ["/for-food-trucks", "List or Claim Your Food Truck | MealScout", "Put your food truck where locals can find it"],
  ["/for-restaurants", "MealScout for Restaurants", "Help local diners find your restaurant"],
  ["/for-hosts", "MealScout for Host Locations", "Turn open parking into recurring host revenue"],
  ["/host-location-partner", "Host Location Partner Request | MealScout", "Apply to become a MealScout host location partner"],
];
const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36";
const agents = [["browser-before", browser], ["diagnostic-googlebot", "Googlebot/2.1"], ["diagnostic-chatgpt-user", "ChatGPT-User/1.0"], ["browser-after", browser]];
const proof = {
  schemaVersion: 1, startedAt: new Date().toISOString(), sourceRef, targetRevision, target,
  launcherRevision: process.env.VERCEL_GIT_COMMIT_SHA || null,
  mode: "read_only_preview_diagnostic", genuineGoogleRequest: false,
  productionChanged: false, fullReleaseSuiteRun: false, nativeContracts: null, responses: [], passed: false,
};

async function boundedGet(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(20000) });
  const parts = [];
  let size = 0;
  for await (const part of response.body || []) {
    size += part.length;
    if (size > 1048576) throw new Error("Response exceeds the 1 MiB proof limit");
    parts.push(part);
  }
  return { response, text: Buffer.concat(parts).toString("utf8") };
}

function decode(text) {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function attribute(tag, name) {
  const value = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return value ? decode(value[2]) : null;
}
async function probePage([pathname, expectedTitle, expectedHeading]) {
  for (const [agentKind, agent] of agents) {
    const row = { pathname, agentKind, checkedAt: new Date().toISOString(), passed: false };
    try {
      const headers = { "user-agent": agent, accept: "text/html" };
      // Use only the project's existing automation permission; never disclose its value.
      if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
        headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      }
      const { response, text } = await boundedGet(`${target}${pathname}`, { headers });
      row.status = response.status;
      row.contentType = response.headers.get("content-type");
      row.robotsHeader = response.headers.get("x-robots-tag");
      row.cache = response.headers.get("x-vercel-cache");
      row.bodySha256 = createHash("sha256").update(text).digest("hex");
      row.title = decode(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
      row.heading = decode(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
      row.canonicals = [...text.matchAll(/<link\b[^>]*>/gi)].map(([tag]) =>
        attribute(tag, "rel")?.toLowerCase() === "canonical" ? attribute(tag, "href") : null).filter(Boolean);
      row.hasApplicationRoot = /<[^>]+\bid=["']root["']/i.test(text);
      row.hasModule = /<script\b[^>]*\btype=["']module["']/i.test(text);
      assert.equal(row.status, 200, "Expected HTTP 200 without a redirect or authentication wall");
      assert.match(row.contentType || "", /text\/html/i);
      assert.match(row.robotsHeader || "", /(?:^|[\s,:])noindex(?:$|[\s,])/i, "Preview must retain noindex");
      if (agentKind.startsWith("diagnostic-")) {
        assert.equal(row.title, expectedTitle, "Crawler must receive route-specific title");
        assert.equal(row.heading, expectedHeading, "Crawler must receive existing SSR content");
        assert.deepEqual(row.canonicals, [`${canonicalBase}${pathname}`]);
        const schemas = [...text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
          .map((match) => JSON.parse(match[1]));
        assert.ok(schemas.some((schema) => schema.url === `${canonicalBase}${pathname}`), "Expected route-specific structured data");
      } else {
        assert.equal(row.hasApplicationRoot, true, "Browser SPA root must remain available");
        assert.equal(row.hasModule, true, "Browser must retain compiled application entry");
      }
      row.passed = true;
    } catch (error) {
      row.error = String(error?.message || error).slice(0, 1200);
    }
    proof.responses.push(row);
  }
}

const temp = mkdtempSync(path.join(tmpdir(), "acquisition-source-proof-"));
try {
  const { response, text } = await boundedGet(`https://raw.githubusercontent.com/infotradescout/MealScout/${sourceRef}/vercel.json`);
  assert.equal(response.status, 200, "Exact candidate config must be accessible");
  const bytes = Buffer.from(text);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(blob, sourceConfigBlob, "Downloaded config must match the tested Git blob");
  const configPath = path.join(temp, "vercel.json");
  writeFileSync(configPath, text);
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "scripts/acquisition-edge-routing.contract.test.mjs", "scripts/acquisition-release-gate.contract.test.mjs"], {
    env: { ...process.env, ACQUISITION_ROUTING_CONFIG: configPath }, encoding: "utf8", timeout: 60000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  proof.nativeContracts = { exitCode: result.status, sourceConfigBlob: blob, output: output.slice(-20000) };
  console.log(output);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, "Native contracts must pass");
  assert.match(output, /# tests 14(?:\s|$)/);
  assert.match(output, /# pass 14(?:\s|$)/);
  assert.match(output, /# fail 0(?:\s|$)/);
  await Promise.all(pages.map(probePage));
  proof.passed = proof.responses.length === 16 && proof.responses.every((row) => row.passed);
} catch (error) {
  proof.error = String(error?.message || error).slice(0, 1600);
} finally {
  rmSync(temp, { recursive: true, force: true });
  proof.finishedAt = new Date().toISOString();
  mkdirSync("proof-output", { recursive: true });
  writeFileSync("proof-output/evidence.json", JSON.stringify(proof, null, 2));
  writeFileSync("proof-output/index.html", '<!doctype html><meta name="robots" content="noindex,nofollow"><title>MealScout read-only edge verification</title><p>Diagnostic preview verification only; not Google indexing or production release proof.</p><a href="/evidence.json">Evidence</a>');
  console.log("SEO_EDGE_PROOF_RESULT=" + JSON.stringify(proof));
  if (!proof.passed) process.exitCode = 1;
}
