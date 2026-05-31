import { readFileSync } from "node:fs";

const adminUi = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const required = [
  "Existing truck:",
  "Match strength:",
  "Matched by:",
  "Classification:",
  "Classification reasons:",
  "Identity signals:",
  "Menu signals:",
  "Missing fields:",
  "Menu deferred override:",
  "Publish warnings:",
  "Publish audit notes:",
  "Why unknown:",
  "OCR text snippet:",
  "OCR confidence:",
  "Approve updates to existing truck",
  "Approve new truck draft",
  "Reject weak/unknown evidence",
  "Mark menuDeferred=true",
  "Require menu before publish",
  "submit(\"apply\")",
];

for (const snippet of required) {
  if (!adminUi.includes(snippet)) {
    throw new Error(`Missing review surface snippet: ${snippet}`);
  }
}

console.log("profile-evidence-review-surface.contract: PASS");
