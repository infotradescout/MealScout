import { readFileSync } from "node:fs";

const scoutPrototype = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  "function scoreScoutSearchResult(",
  "normalizeScoutSearchText",
  "if (!query) return items.slice(0, 15);",
  "const withScores = items.map((item) => ({",
  ".filter((entry) => entry.score > 0)",
  "if (relevant.length > 0) return relevant.slice(0, 15);",
  "submittedQuery",
];

for (const snippet of requiredSnippets) {
  if (!scoutPrototype.includes(snippet)) {
    throw new Error(`Missing Scout search ranking snippet: ${snippet}`);
  }
}

if (!scoutPrototype.includes("normalizedTitle === q")) {
  throw new Error("Expected exact-name ranking branch is missing.");
}

if (!scoutPrototype.includes("normalizedTitle.startsWith")) {
  throw new Error("Expected starts-with ranking branch is missing.");
}

if (!scoutPrototype.includes("normalizedTitle.includes(q)")) {
  throw new Error("Expected contains-name ranking branch is missing.");
}

console.log("scout-search-ranking.contract: PASS");
