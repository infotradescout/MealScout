import { eq } from "drizzle-orm";

import { hosts, suppliers } from "@shared/schema";
import { normalizeCleanBusinessSlug } from "@shared/cleanAffiliateLinks";

import { db } from "../db";
import { storage } from "../storage";

const toSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const classifyRestaurantEntityType = (row: any) => {
  if (row?.isFoodTruck || String(row?.businessType || "") === "food_truck") {
    return "truck" as const;
  }
  if (String(row?.businessType || "") === "bar") {
    return "bar" as const;
  }
  return "restaurant" as const;
};

export async function resolvePublicBusinessSlug(businessSlug: string): Promise<{
  entityType: "restaurant" | "truck" | "bar" | "location" | "supplier";
  id: string;
  businessSlug: string;
} | null> {
  const normalizedSlug = normalizeCleanBusinessSlug(businessSlug);
  if (!normalizedSlug) return null;

  const restaurantRows = (await storage.getAllRestaurants()).filter((row: any) =>
    Boolean(row?.isActive),
  );
  const restaurantMatch = restaurantRows.find(
    (row: any) => toSlug(row?.name) === normalizedSlug,
  );
  if (restaurantMatch?.id) {
    return {
      entityType: classifyRestaurantEntityType(restaurantMatch),
      id: String(restaurantMatch.id),
      businessSlug: normalizedSlug,
    };
  }

  const hostRows = await db.select().from(hosts);
  const hostMatch = hostRows.find(
    (row: any) => toSlug(row?.businessName) === normalizedSlug,
  );
  if (hostMatch?.id) {
    return {
      entityType: "location",
      id: String(hostMatch.id),
      businessSlug: normalizedSlug,
    };
  }

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.isActive, true));
  const resolvedSupplier = supplierRows.find(
    (row: any) => toSlug(row?.businessName) === normalizedSlug,
  );
  if (resolvedSupplier?.id) {
    return {
      entityType: "supplier",
      id: String(resolvedSupplier.id),
      businessSlug: normalizedSlug,
    };
  }

  return null;
}
