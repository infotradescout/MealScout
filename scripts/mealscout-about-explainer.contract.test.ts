import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/about.tsx", "utf8");
const explainer = readFileSync(
  "client/src/pages/mealscout-about-explainer.tsx",
  "utf8",
);
const content = readFileSync(
  "client/src/pages/mealscout-about-content.ts",
  "utf8",
);
const styles = readFileSync("client/src/pages/mealscout-about.css", "utf8");
const combined = `${page}\n${explainer}\n${content}`;

assert.match(page, /MealScoutAboutExplainer/);
assert.match(page, /https:\/\/www\.mealscout\.us\/about/);
assert.match(page, /"@type": "AboutPage"/);
assert.match(explainer, /from "\.\/mealscout-about-content"/);
assert.match(explainer, /from "wouter"/);

for (const requiredClaim of [
  "Follow the Flavor",
  "The MealScout Profile",
  "One source. Every customer-facing surface.",
  "The business workspace",
  "The menu is not a PDF buried in a link.",
  "Parking Pass",
  "Hosts + events",
  "Food work",
  "Supplier marketplace",
  "Food video and visual recommendations",
  "Customer accounts",
  "Mobile and installable access",
  "Trust without rating theater",
  "Complete product guide",
]) {
  assert.match(
    combined,
    new RegExp(requiredClaim.replace(/[+]/g, "\\+"), "i"),
    `About atlas lost its canonical lane: ${requiredClaim}`,
  );
}

for (const supportedAudience of [
  "Diners and local food lovers",
  "Restaurants, bars, caterers, chefs, and food sellers",
  "Food trucks and mobile vendors",
  "Hosts and property operators",
  "Event organizers and community partners",
  "Suppliers and food-business partners",
]) {
  assert.match(
    content,
    new RegExp(supportedAudience.replace(/[+]/g, "\\+")),
    `About atlas lost an offered MealScout audience: ${supportedAudience}`,
  );
}

for (const workspaceModule of [
  "Overview",
  "Public profile",
  "Menu",
  "Availability",
  "Photos",
  "Deals",
  "Orders",
  "Audience",
  "Team",
  "Payments",
  "Settings",
]) {
  assert.match(
    content,
    new RegExp(`title: "${workspaceModule}"`),
    `About atlas lost a current workspace module: ${workspaceModule}`,
  );
}

assert.doesNotMatch(
  content,
  /title: "Reports"/,
  "Reports is not a standalone current business-workspace module",
);

const featureIds = [...content.matchAll(/\bid: "[a-z0-9-]+"/g)];
assert.ok(
  featureIds.length >= 14,
  `About atlas must keep at least 14 stable help-ready chapter IDs; found ${featureIds.length}`,
);

for (const requiredStatus of [
  "available",
  "business-supplied",
  "where-enabled",
  "expanding",
]) {
  assert.match(
    content,
    new RegExp(`"?${requiredStatus}"?`),
    `About atlas lost the ${requiredStatus} truth state`,
  );
}

for (const requiredRoute of [
  "/scout",
  "/profile-setup",
  "/claim-business",
  "/parking-pass",
  "/for-hosts",
  "/for-events",
  "/hiring",
  "/suppliers",
  "/video",
  "/install",
  "/contact",
  "/privacy-policy",
]) {
  assert.match(
    combined,
    new RegExp(`href\\s*[:=]\\s*[{\"']*${requiredRoute.replaceAll("/", "\\/")}`),
    `About atlas must keep a real route to ${requiredRoute}`,
  );
}

for (const requiredBoundary of [
  "No account is required to browse",
  "standard self-managed MealScout Profile is free",
  "most simple setups are $100",
  "not a chatbot",
  "No star-rating leaderboard",
  "does not replace permits",
  "Tracking alone never guarantees payment",
]) {
  assert.match(
    combined,
    new RegExp(requiredBoundary.replace(/[.$]/g, "\\$&"), "i"),
    `About atlas lost a truth boundary: ${requiredBoundary}`,
  );
}

for (const forbiddenClaim of [
  "10,000+",
  "500+",
  "50,000+",
  "25+ Cities",
  "Join thousands",
  "honest reviews",
  "verified locations",
  "ScoutCoin",
  "App Store",
  "Google Play",
  "payment methods",
  "customer-signup?role=business",
  "host-dashboard",
  "Claim an existing business",
  "Applications connected to an open resume",
  "cuisine, and business context",
  "moderation, appeal",
  "property, permit, and suitability requirements before confirmation",
]) {
  assert.doesNotMatch(
    combined,
    new RegExp(forbiddenClaim.replace(/[+?]/g, "\\$&"), "i"),
    `About atlas must not restore or invent: ${forbiddenClaim}`,
  );
}

assert.doesNotMatch(explainer, /74%|width:\s*74%|Published/);
assert.doesNotMatch(explainer, /craving-tacos\.jpg|food-truck-night\.png/);
assert.match(explainer, /loading="lazy"/);
assert.match(explainer, /id="complete-guide"/);
assert.match(explainer, /className="ms-about-jumpbar"/);
assert.match(explainer, /window\.addEventListener\("hashchange"/);
assert.match(explainer, /target instanceof HTMLDetailsElement/);
for (const labelledSection of [
  "system-title",
  "people-title",
  "journeys-title",
  "business-title",
  "parking-title",
  "ecosystem-title",
]) {
  assert.match(explainer, new RegExp(`id="${labelledSection}"`));
  assert.match(explainer, new RegExp(`aria-labelledby="${labelledSection}"`));
}
assert.match(styles, /\.ms-about-jumpbar\s*{/);
assert.match(styles, /:focus-visible/);
assert.match(styles, /scroll-margin-top/);
assert.match(styles, /@media \(max-width: 760px\)/);
assert.match(styles, /prefers-reduced-motion/);
assert.doesNotMatch(styles, /fonts\.googleapis\.com/);

console.log("mealscout-about-explainer.contract: PASS");
