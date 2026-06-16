import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { registerMealScoutIntakeRoutes } from "../server/routes/mealscoutIntakeRoutes";

const app = express();
registerMealScoutIntakeRoutes(app);

const server = createServer(app);

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  assert(address && typeof address === "object", "Expected local test server address");

  const res = await fetch(
    `http://127.0.0.1:${address.port}/api/mealscout/intake/action-cards`,
  );
  const contentType = res.headers.get("content-type") || "";
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.match(contentType, /^application\/json\b/i);
  assert.deepEqual(body, []);

  console.log("mealscout-action-card-route-surface.contract: PASS");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
