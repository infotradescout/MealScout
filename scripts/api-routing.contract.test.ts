import { readFileSync } from "node:fs";

const source = readFileSync("client/src/lib/api.ts", "utf8");

const requiredSnippets = [
  'const MEALSCOUT_API_ORIGIN_FALLBACK = "https://mealscout.onrender.com";',
  'host === "www.mealscout.us"',
  'host === "mealscout.us"',
  'host.endsWith(".mealscout.us")',
  'return normalizedPath.startsWith("/api/");',
  "if (isMealScoutHost && isMealScoutSameOriginPath(path))",
  'return path.startsWith("/") ? path : `/${path}`;',
  "if (IS_DEV) return \"\";",
  "const fromEnv = String(import.meta.env.VITE_API_BASE_URL || \"\").trim();",
  "return fromEnv.replace(/\\/+$/, \"\");",
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing required api-routing behavior snippet: ${snippet}`);
  }
}

for (const obsoleteSelectiveRoute of [
  'normalizedPath.startsWith("/api/truck-claims")',
  'normalizedPath === "/api/restaurants/signup"',
  "/^\\/api\\/restaurants\\/[^/]+\\/verification\\/request",
]) {
  if (source.includes(obsoleteSelectiveRoute)) {
    throw new Error(
      `MealScout API routing must not depend on a selective allowlist: ${obsoleteSelectiveRoute}`,
    );
  }
}

console.log("api-routing.contract: PASS");
