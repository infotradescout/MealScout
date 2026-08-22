import { and, eq, or, sql } from "drizzle-orm";

import { FOOD_TRUCK_BUSINESS_TYPE_ALIASES } from "@shared/businessTypes";
import { restaurants } from "@shared/schema";

export type FoodTruckIdentity = {
  normalizedName: string;
  normalizedAddress: string;
  lockKey: string;
};

export function normalizeFoodTruckIdentityText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildFoodTruckIdentity(input: {
  name: unknown;
  address: unknown;
}): FoodTruckIdentity | null {
  const normalizedName = normalizeFoodTruckIdentityText(input.name);
  const normalizedAddress = normalizeFoodTruckIdentityText(input.address);
  if (!normalizedName || !normalizedAddress) return null;

  return {
    normalizedName,
    normalizedAddress,
    lockKey: `food_truck_identity:${normalizedName}:${normalizedAddress}`,
  };
}

export function foodTruckStoredClassificationPredicate() {
  const aliases = [...FOOD_TRUCK_BUSINESS_TYPE_ALIASES];
  return or(
    eq(restaurants.isFoodTruck, true),
    sql`lower(trim(coalesce(${restaurants.businessType}, ''))) in (${sql.join(
      aliases.map((alias) => sql`${alias}`),
      sql`, `,
    )})`,
  );
}

export function normalizedFoodTruckRestaurantIdentityPredicate(
  identity: FoodTruckIdentity,
) {
  return and(
    foodTruckStoredClassificationPredicate(),
    sql`trim(regexp_replace(lower(${restaurants.name}), '[^a-z0-9]+', ' ', 'g')) = ${identity.normalizedName}`,
    sql`trim(regexp_replace(lower(${restaurants.address}), '[^a-z0-9]+', ' ', 'g')) = ${identity.normalizedAddress}`,
  );
}

export function normalizedFoodTruckImportIdentityPredicate(
  identity: FoodTruckIdentity,
  columns: { name: any; address: any },
) {
  return and(
    sql`trim(regexp_replace(lower(${columns.name}), '[^a-z0-9]+', ' ', 'g')) = ${identity.normalizedName}`,
    sql`trim(regexp_replace(lower(${columns.address}), '[^a-z0-9]+', ' ', 'g')) = ${identity.normalizedAddress}`,
  );
}

export async function acquireFoodTruckIdentityLock(
  queryRunner: { execute: (query: unknown) => Promise<unknown> },
  identity: FoodTruckIdentity,
) {
  await queryRunner.execute(
    sql`select pg_advisory_xact_lock(hashtext(${identity.lockKey}))`,
  );
}
