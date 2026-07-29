import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";

import { pool, db } from "../server/db";
import { restaurants, suppliers } from "../shared/schema";

const APPLY_CONFIRMATION =
  "MEALSCOUT_QUARANTINE_CONFIRMED_PUBLIC_TEST_RECORDS_2026_07_29";

const restaurantTargets = [
  {
    id: "ac10d98b-61a5-4e88-b072-4ef87c853524",
    expectedName: "asdf",
  },
  {
    id: "a39791fa-6d77-4a65-82b7-2e61f161d556",
    expectedName: "asdfasdfasdf",
  },
  {
    id: "e0c8f6c8-841a-4464-8063-11c6d44de42e",
    expectedName: "Discoverability Flow 1777479688781-295625",
  },
] as const;

const supplierTargets = [
  {
    id: "d48fb6af-997f-4b93-ad15-084cd83c336d",
    expectedName: "Test Supplier 1771607433376-s17ept",
  },
  {
    id: "8fa06e2c-21b1-4a3f-b12b-d1eed9ab3baa",
    expectedName: "Test Supplier 1771621830580-1vi34g",
  },
] as const;

const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");
const confirmation = process.argv
  .find((value) => value.startsWith("--confirm="))
  ?.slice("--confirm=".length);

type TargetState = {
  entityType: "restaurant" | "supplier";
  id: string;
  expectedName: string;
  actualName: string | null;
  activeBefore: boolean | null;
  disposition: "would_quarantine" | "quarantined" | "already_quarantined";
};

const run = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (apply && (!allowProduction || confirmation !== APPLY_CONFIRMATION)) {
    throw new Error(
      `Production apply requires --allow-production --confirm=${APPLY_CONFIRMATION}.`,
    );
  }

  const restaurantRows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      isActive: restaurants.isActive,
    })
    .from(restaurants)
    .where(
      inArray(
        restaurants.id,
        restaurantTargets.map((target) => target.id),
      ),
    );
  const supplierRows = await db
    .select({
      id: suppliers.id,
      name: suppliers.businessName,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(
      inArray(
        suppliers.id,
        supplierTargets.map((target) => target.id),
      ),
    );

  const restaurantById = new Map(
    restaurantRows.map((row: any) => [String(row.id), row]),
  );
  const supplierById = new Map(
    supplierRows.map((row: any) => [String(row.id), row]),
  );
  const states: TargetState[] = [];

  for (const target of restaurantTargets) {
    const row = restaurantById.get(target.id);
    if (!row || String(row.name) !== target.expectedName) {
      throw new Error(
        `Restaurant precondition failed for ${target.id}; expected ${JSON.stringify(target.expectedName)}, found ${JSON.stringify(row ? String(row.name) : null)}; no write occurred.`,
      );
    }
    states.push({
      entityType: "restaurant",
      id: target.id,
      expectedName: target.expectedName,
      actualName: String(row.name),
      activeBefore: row.isActive !== false,
      disposition:
        row.isActive === false
          ? "already_quarantined"
          : apply
            ? "quarantined"
            : "would_quarantine",
    });
  }

  for (const target of supplierTargets) {
    const row = supplierById.get(target.id);
    if (!row || String(row.name) !== target.expectedName) {
      throw new Error(
        `Supplier precondition failed for ${target.id}; expected ${JSON.stringify(target.expectedName)}, found ${JSON.stringify(row ? String(row.name) : null)}; no write occurred.`,
      );
    }
    states.push({
      entityType: "supplier",
      id: target.id,
      expectedName: target.expectedName,
      actualName: String(row.name),
      activeBefore: row.isActive !== false,
      disposition:
        row.isActive === false
          ? "already_quarantined"
          : apply
            ? "quarantined"
            : "would_quarantine",
    });
  }

  if (apply) {
    for (const target of restaurantTargets) {
      await db
        .update(restaurants)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(restaurants.id, target.id),
            eq(restaurants.name, target.expectedName),
            eq(restaurants.isActive, true),
          ),
        );
    }
    for (const target of supplierTargets) {
      await db
        .update(suppliers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(suppliers.id, target.id),
            eq(suppliers.businessName, target.expectedName),
            eq(suppliers.isActive, true),
          ),
        );
    }
  }

  return {
    lane: "confirmed_public_test_record_quarantine",
    mode: apply ? "apply" : "dry_run",
    records: states,
    safety:
      "Soft deactivation only; exact id and exact name preconditions; no user, order, payment, or secret fields read or changed.",
  };
};

run()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end?.();
  });
