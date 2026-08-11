import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const page = read("client/src/pages/owner-ai-actions.tsx");
const app = read("client/src/App.tsx");
const shell = read("client/src/components/business-workspace-shell.tsx");
const navigation = read("client/src/components/navigation.tsx");
const seo = read("client/src/components/seo-head.tsx");

assert.match(app, /const OwnerAiActionsPage = lazy/);
assert.match(app, /path="\/owner-ai" component=\{OwnerAiActionsPage\}/);
assert.match(app, /currentPath === "\/owner-ai"/);
assert.match(shell, /id: "ai"/);
assert.match(shell, /href: buildWorkspaceHref\("\/owner-ai", business\.id\)/);
assert.match(navigation, /currentPath === "\/owner-ai"/);
assert.match(seo, /"\/owner-ai"/);

for (const copy of [
  "Run MealScout from the AI you already use",
  "any free or paid AI",
  "menus, prices",
  "logos and images",
  "schedules, events",
  "social descriptions and artwork",
  "Portable action packet",
  "Prepare changes and social previews",
  "Approve changes and posts",
  "MealScout commits first",
  "Logos, menu photos, and other supplied images",
  "Continue approved posts",
  "Copy current context for any AI",
  "Exact validated MealScout values",
]) {
  assert.ok(page.includes(copy), `Missing owner AI workflow copy: ${copy}`);
}

// A connector can prepare only. The authenticated MealScout page owns the
// explicit approval and exposes per-channel results after canonical commit.
assert.match(page, /revocable key can read this business and prepare drafts/);
assert.match(page, /cannot approve, alter MealScout, or publish a post/);
assert.match(page, /\/api\/owner-ai\/credentials/);
assert.match(page, /\/api\/owner-ai\/drafts/);
assert.match(page, /\/approve/);
assert.match(page, /expectedRevision: selectedDraft\?\.revision \|\| 1/);
assert.match(page, /normalizeSocialDrafts/);
assert.match(page, /post\.status/);
assert.match(page, /post\.errorMessage/);
assert.match(page, /post\.providerUrl/);
assert.match(page, /post\.attemptedPayloadText/);
assert.match(page, /selectedDraft\?\.mediaPreviews/);
assert.match(page, /localOwnerAiPreviewUrl/);
assert.match(page, /canContinueSocial/);
assert.match(page, /requiredPreviewKeys/);
assert.match(page, /MEDIA_CHANGED|image changed/i);

// Free chats use the same strict packet submitted by direct tool clients.
assert.match(page, /JSON\.parse\(packetText\)/);
assert.match(
  page,
  /`\/api\/owner-ai\/restaurants\/\$\{encodeURIComponent\(restaurantId\)\}\/drafts`/,
);
assert.match(page, /parsed\.packet && typeof parsed\.packet === "object"/);
assert.match(page, /: \{ packet: parsed \}/);
assert.match(page, /schemaVersion: "1\.0"/);
assert.match(page, /schedules:/);
assert.match(page, /kind: "event_stop"/);
assert.match(page, /platforms: \["facebook", "instagram", "x"\]/);

for (const forbidden of [
  /STRIPE_SECRET_KEY/,
  /BREVO_API_KEY/,
  /github actions/i,
  /auto.?approve/i,
  /publish immediately/i,
]) {
  assert.doesNotMatch(page, forbidden);
}

console.log("mealscout-owner-ai-control-workspace.contract: PASS");
