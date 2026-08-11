import "dotenv/config";

import assert from "node:assert/strict";

const COHORT: Array<[query: string, expectedId: string]> = [
  ["3D Eats & Tea", "95c4e656-f3cc-46ab-ae18-53f549cecfd1"],
  ["All gas no brakes reloaded", "6ca08365-f8af-4c1d-9754-6c998c803869"],
  ["Around The Table Catering", "0a5ef5b8-852a-4bfd-8626-f06218d83b31"],
  ["CREATIVBOWLS", "75dd470e-2692-4579-bde0-a64dcc3f6fcb"],
  ["Big Jay's Southern Cuisine", "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2"],
  ["Pie Faced", "d0fd61f5-4181-4216-a000-3dc08bd9a348"],
  ["Sweet Love", "f3b76054-f355-43b0-a2d3-901277748557"],
  ["The Spot Tavern", "bfe24073-7362-4975-83ba-43c096f782e3"],
  ["Blessed Berry Bowls", "e77ac77a-c432-42d0-ac0f-22c48b6306c9"],
  ["MOROCCO'S TACO'S", "60475d81-2ef7-4de9-bfbc-a009f097cbd6"],
  [
    "The Florida Kitchen Island Cuisine",
    "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0",
  ],
];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the search ranking DB proof");
}

const [{ db, pool }, { searchPublicRestaurantResults }] = await Promise.all([
  import("../server/db.js"),
  import("../server/routes/publicSearchRoutes.js"),
]);

try {
  for (const [query, expectedId] of COHORT) {
    const results = await searchPublicRestaurantResults(db, query);
    assert.equal(
      results[0]?.id,
      expectedId,
      `${query} must be the first restaurant result after the real SQL candidate cap`,
    );
  }
  console.log(
    `mealscout-public-search-ranking.integration: PASS (${COHORT.length}/${COHORT.length})`,
  );
} finally {
  await pool.end();
}
