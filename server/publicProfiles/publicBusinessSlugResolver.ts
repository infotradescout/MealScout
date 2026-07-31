import { eq } from "drizzle-orm";

import { hosts, suppliers } from "@shared/schema";
import { normalizeCleanBusinessSlug } from "@shared/cleanAffiliateLinks";
import {
  isBarBusinessType,
  isTruckBusinessType,
  toCanonicalFoodBusinessType,
} from "@shared/businessTypes";

import { db } from "../db";
import { storage } from "../storage";
import {
  ensurePublicBusinessSlugOwnershipForEntity,
  listPublicBusinessSlugOwnershipsBySlug,
  verifyOwnedSlugTarget,
} from "./publicBusinessSlugOwnership";

export type PublicBusinessSlugCandidate = {
  entityType:
    | "restaurant"
    | "truck"
    | "bar"
    | "caterer"
    | "private_chef"
    | "location"
    | "supplier";
  id: string;
  businessSlug: string;
};

export type PublicBusinessSlugResolution =
  | { status: "not_found"; businessSlug: string }
  | {
      status: "ambiguous";
      businessSlug: string;
      candidates: PublicBusinessSlugCandidate[];
    }
  | {
      status: "unique";
      businessSlug: string;
      match: PublicBusinessSlugCandidate;
    };

const toSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const classifyRestaurantEntityType = (row: any) => {
  if (row?.isFoodTruck || isTruckBusinessType(row?.businessType)) {
    return "truck" as const;
  }
  if (isBarBusinessType(row?.businessType)) {
    return "bar" as const;
  }
  const canonicalType = toCanonicalFoodBusinessType(row?.businessType);
  if (canonicalType === "caterer" || canonicalType === "private_chef") {
    return canonicalType;
  }
  return "restaurant" as const;
};

export async function listPublicBusinessSlugCandidates(
  businessSlug: string,
): Promise<PublicBusinessSlugCandidate[]> {
  const normalizedSlug = normalizeCleanBusinessSlug(businessSlug);
  if (!normalizedSlug) return [];

  const candidates: PublicBusinessSlugCandidate[] = [];
  const ownedSlugRows = await listPublicBusinessSlugOwnershipsBySlug(normalizedSlug);
  if (ownedSlugRows.length > 0) {
    for (const row of ownedSlugRows) {
      if (!(await verifyOwnedSlugTarget(row))) continue;
      candidates.push({
        entityType: row.entityType,
        id: row.entityId,
        businessSlug: row.slug,
      });
    }
    return candidates;
  }

  const restaurantRows = (await storage.getAllRestaurants()).filter((row: any) =>
    Boolean(row?.isActive),
  );
  for (const row of restaurantRows) {
    if (toSlug(row?.name) !== normalizedSlug) continue;
    if (!row?.id) continue;
    candidates.push({
      entityType: classifyRestaurantEntityType(row),
      id: String(row.id),
      businessSlug: normalizedSlug,
    });
  }

  const hostRows = await db.select().from(hosts);
  for (const row of hostRows) {
    if (toSlug(row?.businessName) !== normalizedSlug) continue;
    if (!row?.id) continue;
    candidates.push({
      entityType: "location",
      id: String(row.id),
      businessSlug: normalizedSlug,
    });
  }

  const supplierRows = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.isActive, true));
  for (const row of supplierRows) {
    if (toSlug(row?.businessName) !== normalizedSlug) continue;
    if (!row?.id) continue;
    candidates.push({
      entityType: "supplier",
      id: String(row.id),
      businessSlug: normalizedSlug,
    });
  }

  return candidates;
}

export async function resolvePublicBusinessSlug(
  businessSlug: string,
): Promise<PublicBusinessSlugResolution> {
  const normalizedSlug = normalizeCleanBusinessSlug(businessSlug) || "";
  const candidates = await listPublicBusinessSlugCandidates(normalizedSlug);

  if (candidates.length === 0) {
    return { status: "not_found", businessSlug: normalizedSlug };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      businessSlug: normalizedSlug,
      candidates,
    };
  }

  return {
    status: "unique",
    businessSlug: normalizedSlug,
    match: candidates[0],
  };
}

export async function resolveUniqueCleanBusinessPathForEntity(input: {
  entityType:
    | "restaurant"
    | "truck"
    | "bar"
    | "caterer"
    | "private_chef"
    | "location"
    | "supplier";
  id: string;
  name: string;
}): Promise<string | null> {
  const ownership = await ensurePublicBusinessSlugOwnershipForEntity(input);
  const businessSlug = normalizeCleanBusinessSlug(ownership?.slug);
  if (!businessSlug || !ownership) return null;

  const resolution = await resolvePublicBusinessSlug(businessSlug);
  if (resolution.status !== "unique") return null;

  if (
    resolution.match.entityType !== input.entityType ||
    resolution.match.id !== String(input.id)
  ) {
    return null;
  }

  return `/${encodeURIComponent(businessSlug)}`;
}
