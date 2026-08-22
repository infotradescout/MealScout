import { eq, inArray, or, sql } from "drizzle-orm";

import { FOOD_TRUCK_BUSINESS_TYPE_ALIASES } from "@shared/businessTypes";

export const publicTruckClassificationWhere = (
  isFoodTruckColumn: any,
  businessTypeColumn: any,
) =>
  or(
    eq(isFoodTruckColumn, true),
    inArray(
      sql<string>`lower(btrim(coalesce(${businessTypeColumn}, '')))`,
      [...FOOD_TRUCK_BUSINESS_TYPE_ALIASES],
    ),
  );
