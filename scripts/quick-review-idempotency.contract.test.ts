import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildQuickReviewContextFingerprint,
  decideQuickReviewContext,
  mergeQuickReviewScores,
} from "../server/quickReview/contextIdempotency";

const read = (path: string) => readFileSync(path, "utf8");
const route = read("server/routes/restaurantCoreRoutes.ts");
const component = read(
  "client/src/components/public-profile/ProfileRecommendButton.tsx",
);
const schema = read("shared/schema/legacy.ts");
const migration = read(
  "migrations/112_restaurant_recommendation_context_idempotency.sql",
);
const rolloutChecklist = read("docs/PROD_ROLLOUT_CHECKLIST.md");
const recommendRoute = route.slice(
  route.indexOf('"/api/restaurants/:restaurantId/recommend"'),
  route.indexOf('"/api/restaurants/:restaurantId/featured-item"'),
);
const publicRecommendationsRoute = route.slice(
  route.indexOf('"/api/restaurants/:restaurantId/recommendations/public"'),
  route.indexOf('"/api/recommendations/:recommendationId/reaction"'),
);

const basePayload = {
  comment: "Worth the stop",
  scores: { food: 90, value: null, speed: 70, vibe: null },
  proofBytes: Buffer.from("same-proof"),
};
const fingerprint = buildQuickReviewContextFingerprint(basePayload);
assert.equal(
  buildQuickReviewContextFingerprint({ ...basePayload }),
  fingerprint,
  "the same normalized payload must have a stable fingerprint",
);
assert.notEqual(
  buildQuickReviewContextFingerprint({
    ...basePayload,
    comment: "A different submission",
  }),
  fingerprint,
  "a changed comment must not be treated as an exact retry",
);
assert.notEqual(
  buildQuickReviewContextFingerprint({
    ...basePayload,
    proofBytes: Buffer.from("different-proof"),
  }),
  fingerprint,
  "changed proof bytes must not be treated as an exact retry",
);

assert.equal(
  decideQuickReviewContext({
    hasIncomingContext: false,
    contextSubmittedAt: new Date(),
    storedFingerprint: fingerprint,
    incomingFingerprint: null,
  }),
  "none",
  "a bare recommend is not a context replay",
);
assert.equal(
  decideQuickReviewContext({
    hasIncomingContext: true,
    contextSubmittedAt: null,
    storedFingerprint: null,
    incomingFingerprint: fingerprint,
  }),
  "create",
  "the first context payload must be created",
);
assert.equal(
  decideQuickReviewContext({
    hasIncomingContext: true,
    contextSubmittedAt: new Date(),
    storedFingerprint: fingerprint,
    incomingFingerprint: fingerprint,
  }),
  "replay",
  "an exact retry must replay the committed result",
);
assert.equal(
  decideQuickReviewContext({
    hasIncomingContext: true,
    contextSubmittedAt: new Date(),
    storedFingerprint: fingerprint,
    incomingFingerprint: "different",
  }),
  "conflict",
  "a differing later submission must conflict",
);
assert.equal(
  decideQuickReviewContext({
    hasIncomingContext: true,
    contextSubmittedAt: new Date(),
    storedFingerprint: "legacy",
    incomingFingerprint: fingerprint,
  }),
  "conflict",
  "legacy contexts must fail closed because their exact payload is unknown",
);
assert.deepEqual(
  mergeQuickReviewScores(
    { food: 88, value: 77, speed: null, vibe: 66 },
    { food: null, value: null, speed: 55, vibe: null },
  ),
  { food: 88, value: 77, speed: 55, vibe: 66 },
  "a later context write must not erase legacy scores omitted by the client",
);

assert.match(
  recommendRoute,
  /db\.transaction\(/,
  "context writes must be transactional",
);
assert.match(
  recommendRoute,
  /pg_advisory_xact_lock/,
  "context writes must serialize across server replicas",
);
assert.match(
  recommendRoute,
  /onConflictDoNothing\(\)/,
  "recommend creation must tolerate a concurrent duplicate",
);
assert.match(
  recommendRoute,
  /contextDecision === "conflict"/,
  "differing later context must return a conflict",
);
assert.match(
  recommendRoute,
  /deleteFromCloudinary/,
  "a rolled-back proof upload must receive best-effort external cleanup",
);
assert.doesNotMatch(
  recommendRoute,
  /restaurant-recommendation-\$\{restaurantId\}-\$\{userId\}/,
  "proof asset names must not expose internal identifiers",
);
assert.match(
  recommendRoute,
  /uploadedProofPublicId = null/,
  "the cleanup marker must be cleared after the transaction commits",
);
assert.doesNotMatch(
  recommendRoute,
  /error\.code === "23505"/,
  "unrelated uniqueness failures must not be reported as duplicate success",
);
assert.match(
  recommendRoute,
  /isAuthenticated,\s*restaurantRecommendLimiter,\s*imageUpload\.single\("image"\)/,
  "the distributed authenticated limiter must run before multipart buffering",
);

assert.match(
  component,
  /touchedScores/,
  "the client must distinguish user-selected scores from visual defaults",
);
assert.match(
  component,
  /JSON\.stringify\(submittedScores\)/,
  "the client must submit only explicitly touched scores",
);
assert.doesNotMatch(
  component,
  /JSON\.stringify\(scores\)/,
  "the client must not silently submit all slider defaults",
);
assert.match(
  component,
  /responseBody\?\.contextAlreadySaved/,
  "the client must inspect prior context state on the shallow recommend",
);
assert.match(
  component,
  /result\.ok && !result\.contextAlreadySaved/,
  "the client must not open the composer after context already exists",
);

assert.match(schema, /contextSubmittedAt/, "schema must persist context state");
assert.match(
  schema,
  /contextPayloadFingerprint/,
  "schema must persist the context payload fingerprint",
);
assert.match(
  schema,
  /uniqueIndex\("IDX_restaurant_user_recommendations_unique"\)/,
  "schema-created databases must enforce one recommendation per user/business",
);
assert.match(
  migration,
  /context_submitted_at/,
  "migration must add the durable context marker",
);
assert.match(
  migration,
  /context_payload_fingerprint/,
  "migration must add the context payload fingerprint",
);
assert.match(
  migration,
  /WITH legacy_context AS/,
  "migration must recognize context written before idempotency markers existed",
);
assert.match(
  migration,
  /rur\.food_score IS NOT NULL/,
  "migration must preserve and mark legacy structured score context",
);
assert.match(
  migration,
  /iu\.entity_type = 'restaurant_recommendation'/,
  "migration must recognize legacy attached proof uploads",
);
for (const field of ["food", "value", "speed", "vibe"]) {
  assert.match(
    migration,
    new RegExp(`${field}_score IS NULL OR ${field}_score BETWEEN 1 AND 100`),
    `${field} score must have a database-level range check`,
  );
}

assert.doesNotMatch(
  publicRecommendationsRoute,
  /userId\s*:/,
  "public recommendation payloads must not expose raw user ids",
);

const migration090Index = rolloutChecklist.indexOf(
  "090_recommendation_interactions_and_uniques.sql",
);
const migration111Index = rolloutChecklist.indexOf(
  "111_restaurant_recommendation_quick_review_scores.sql",
);
const migration112Index = rolloutChecklist.indexOf(
  "112_restaurant_recommendation_context_idempotency.sql",
);
assert.ok(
  migration090Index >= 0 &&
    migration090Index < migration111Index &&
    migration111Index < migration112Index,
  "rollout must apply recommendation migrations in 090 -> 111 -> 112 order",
);
assert.match(
  rolloutChecklist,
  /before deploying the application/,
  "the migration sequence must be an explicit migration-before-app gate",
);
assert.match(
  rolloutChecklist,
  /food_score NOT BETWEEN 1 AND 100/,
  "rollout must preflight existing out-of-range scores before adding checks",
);

console.log("MealScout quick-review idempotency contract: PASS");
