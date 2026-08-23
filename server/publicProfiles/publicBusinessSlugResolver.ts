import { and, eq } from "drizzle-orm";

import { hosts, suppliers, users } from "@shared/schema";
import { normalizeCleanBusinessSlug } from "@shared/cleanAffiliateLinks";
import {
  isBarBusinessType,
  isTruckBusinessType,
  toCanonicalFoodBusinessType,
} from "@shared/businessTypes";

import { db } from "../db";
import { storage } from "../storage";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import { loadPublicRestaurantListingVisibility } from "./toPublicRestaurantListingWithVisibility";
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
  const visibilityByOwnerId = await loadPublicRestaurantListingVisibility(
    restaurantRows,
  );
  for (const row of restaurantRows) {
    const ownerVisibility = visibilityByOwnerId.get(String(row?.ownerId || ""));
    if (!ownerVisibility?.ownerEnabled || !isPublicBusinessVisible(row)) continue;
    if (toSlug(row?.name) !== normalizedSlug) continue;
    if (!row?.id) continue;
    candidates.push({
      entityType: classifyRestaurantEntityType(row),
      id: String(row.id),
      businessSlug: normalizedSlug,
    });
  }

  const hostRows = await db
    .select({ host: hosts })
    .from(hosts)
    .innerJoin(users, eq(hosts.userId, users.id))
    .where(eq(users.isDisabled, false));
  for (const { host: row } of hostRows) {
    if (
      !isPublicBusinessVisible({
        name: row.businessName,
        city: row.city,
        state: row.state,
      })
    ) {
      continue;
    }
    if (toSlug(row?.businessName) !== normalizedSlug) continue;
    if (!row?.id) continue;
    candidates.push({
      entityType: "location",
      id: String(row.id),
      businessSlug: normalizedSlug,
    });
  }

  const supplierRows = await db
    .select({ supplier: suppliers })
    .from(suppliers)
    .innerJoin(users, eq(suppliers.userId, users.id))
    .where(
      and(eq(suppliers.isActive, true), eq(users.isDisabled, false)),
    );
  for (const { supplier: row } of supplierRows) {
    if (
      !isPublicBusinessVisible({
        name: row.businessName,
        city: row.city,
        state: row.state,
        description: [row.onlinePaymentsNotes, row.deliveryNotes]
          .filter(Boolean)
          .join(" "),
      })
    ) {
      continue;
    }
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
