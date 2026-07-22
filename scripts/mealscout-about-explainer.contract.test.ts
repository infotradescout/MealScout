import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/about.tsx", "utf8");
const explainer = readFileSync(
  "client/src/pages/mealscout-about-explainer.tsx",
  "utf8",
);
const styles = readFileSync("client/src/pages/mealscout-about.css", "utf8");

assert.match(page, /MealScoutAboutExplainer/);
assert.match(page, /https:\/\/www\.mealscout\.us\/about/);
assert.match(page, /"@type": "AboutPage"/);

for (const requiredClaim of [
  "The profile is the source",
  "Scout turns facts into discovery",
  "The business workspace",
  "Mobile food & Parking Pass",
  "Trust without theater",
  "Complete feature reference",
  "Available now",
  "Business supplied",
  "Still expanding",
]) {
  assert.match(
    explainer,
    new RegExp(requiredClaim.replace(/[&]/g, "&")),
    `About explainer lost its canonical section: ${requiredClaim}`,
  );
}

for (const requiredRoute of [
  "/scout",
  "/restaurant-signup",
  "/parking-pass",
  "/events",
  "/faq",
  "/contact",
  "/privacy-policy",
]) {
  assert.match(
    explainer,
    new RegExp(`href=["']${requiredRoute.replaceAll("/", "\\/")}`),
    `About explainer must keep a path to ${requiredRoute}`,
  );
}

for (const retiredClaim of [
  "10,000+",
  "500+",
  "50,000+",
  "25+",
  "Join thousands",
  "honest reviews",
  "customer-signup?role=business",
]) {
  assert.doesNotMatch(
    explainer,
    new RegExp(retiredClaim.replace(/[+?]/g, "\\$&"), "i"),
    `About explainer must not restore the unsupported claim: ${retiredClaim}`,
  );
}

assert.match(explainer, /not a chatbot/i);
assert.match(explainer, /not guess it/i);
assert.match(explainer, /No account is needed to start exploring public discovery/i);
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.doesNotMatch(styles, /fonts\.googleapis\.com/);

console.log("mealscout-about-explainer.contract: PASS");
