import { readFileSync } from "node:fs";

// Regression guard: photo-only recommendation proofs must still create a
// visible reviews row. There is no read path that surfaces
// image_uploads (entityType "restaurant_recommendation") on its own -
// the proof photo has only ever been made visible via the
// "Photo proof: <url>" line baked into reviews.comment. A prior revision
// gated review creation on `if (comment)` alone, which silently dropped
// photo-only proofs (image uploaded, but no visible record of it).
const routeSource = readFileSync(
  "server/routes/restaurantCoreRoutes.ts",
  "utf8",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  routeSource.includes("if (comment || proofPhoto?.cloudinaryUrl)"),
  "recommend route must create a review when either comment or a photo proof is present, not comment alone",
);

assert(
  !/if \(comment\) \{\s*\n\s*const photoLine/.test(routeSource),
  "recommend route must not regress to gating review creation on comment text alone while still uploading a photo proof",
);

assert(
  routeSource.includes('entityType: "restaurant_recommendation"'),
  "photo-only proofs must retain a durable image-upload record",
);

assert(
  routeSource.includes("contextSubmittedAt"),
  "photo-only context must set the durable idempotency marker",
);

assert(
  !routeSource.includes(
    "`restaurant-recommendation-${restaurantId}-${userId}-${Date.now()}`",
  ),
  "public proof asset names must not embed internal restaurant/user identifiers",
);

console.log(
  "recommend-photo-only-proof.contract.test.ts: all assertions passed",
);
