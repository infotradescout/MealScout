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
  "Publish warnings:",
  "Publish audit notes:",
  "Why unknown:",
  "OCR text snippet:",
  "OCR confidence:",
  "Reject weak/unknown evidence",
  "Direct publication is disabled.",
  "Queue for Owner Review",
  "This intake never creates a new truck draft.",
];

for (const snippet of required) {
  if (!adminUi.includes(snippet)) {
    throw new Error(`Missing review surface snippet: ${snippet}`);
  }
}

for (const forbidden of [
  "Menu deferred override:",
  "Mark menuDeferred=true",
  "Require menu before publish",
  'submit("apply")',
]) {
  if (adminUi.includes(forbidden)) {
    throw new Error(`Dead or unsafe review control remains: ${forbidden}`);
  }
}

console.log("profile-evidence-review-surface.contract: PASS");
