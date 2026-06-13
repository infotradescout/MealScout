import "dotenv/config";
import { eq } from "drizzle-orm";

import { pool, db } from "../server/db";
import { restaurants } from "../shared/schema";

const JAYS_TRUCK_ID = "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2";
const JAYS_CURRENT_NAME = "Jays Southern Cuisine ";
const JAYS_TRIMMED_NAME = "Jays Southern Cuisine";

const BLESSED_TRUCK_ID = "e77ac77a-c432-42d0-ac0f-22c48b6306c9";

const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");

type HygieneResult = {
  lane: "live_scout_truck_hygiene_lane_1";
  mode: "dry_run" | "apply";
  appliedChanges: Array<{
    truckId: string;
    field: "restaurants.name";
    before: string;
    after: string;
    status: "would_apply" | "applied" | "already_applied";
  }>;
  gatedChanges: Array<{
    truckId: string;
    fields: Array<"restaurants.instagramUrl" | "restaurants.facebookPageUrl">;
    status: "gated";
    reason: string;
  }>;
};

const run = async (): Promise<HygieneResult> => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (apply && !allowProduction) {
    throw new Error("Production apply requires --allow-production.");
  }

  const [jays] = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.id, JAYS_TRUCK_ID))
    .limit(1);

  if (!jays) throw new Error(`Jays truck row not found: ${JAYS_TRUCK_ID}`);

  const result: HygieneResult = {
    lane: "live_scout_truck_hygiene_lane_1",
    mode: apply ? "apply" : "dry_run",
    appliedChanges: [],
    gatedChanges: [
      {
        truckId: BLESSED_TRUCK_ID,
        fields: ["restaurants.instagramUrl", "restaurants.facebookPageUrl"],
        status: "gated",
        reason:
          "Existing evidence artifacts require owner approval, and current ingest/apply paths treat non-blank social URL changes as review conflicts.",
      },
    ],
  };

  if (jays.name === JAYS_TRIMMED_NAME) {
    result.appliedChanges.push({
      truckId: JAYS_TRUCK_ID,
      field: "restaurants.name",
      before: JAYS_CURRENT_NAME,
      after: JAYS_TRIMMED_NAME,
      status: "already_applied",
    });
    return result;
  }

  if (jays.name !== JAYS_CURRENT_NAME) {
    throw new Error(
      `Unexpected Jays display name. Expected ${JSON.stringify(
        JAYS_CURRENT_NAME,
      )}; found ${JSON.stringify(jays.name)}.`,
    );
  }

  if (apply) {
    await db
      .update(restaurants)
      .set({ name: JAYS_TRIMMED_NAME, updatedAt: new Date() })
      .where(eq(restaurants.id, JAYS_TRUCK_ID));
  }

  result.appliedChanges.push({
    truckId: JAYS_TRUCK_ID,
    field: "restaurants.name",
    before: JAYS_CURRENT_NAME,
    after: JAYS_TRIMMED_NAME,
    status: apply ? "applied" : "would_apply",
  });

  return result;
};

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .finally(async () => {
    await pool?.end?.();
  });
