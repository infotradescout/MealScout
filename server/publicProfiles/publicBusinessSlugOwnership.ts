import { and, eq } from "drizzle-orm";

import {
  hosts,
  publicBusinessSlugOwnerships,
  restaurants,
  suppliers,
  users,
} from "@shared/schema";
import { normalizeCleanBusinessSlug } from "@shared/cleanAffiliateLinks";
import {
  isBarBusinessType,
  isTruckBusinessType,
} from "@shared/businessTypes";

import { db } from "../db";
import { storage } from "../storage";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

export type PublicBusinessSlugEntityType =
  | "restaurant"
  | "truck"
  | "bar"
  | "caterer"
  | "private_chef"
  | "location"
  | "supplier";

export type PublicBusinessSlugOwnership = {
  slug: string;
  entityType: PublicBusinessSlugEntityType;
  entityId: string;
  preferredSlug: string | null;
  sourceName: string | null;
  assignmentStatus: string;
};

type AssignmentInput = {
  entityType: PublicBusinessSlugEntityType;
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
};

const toSlug = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const normalizeCandidate = (value: unknown) =>
  normalizeCleanBusinessSlug(toSlug(value));

const asOwnership = (row: any): PublicBusinessSlugOwnership => ({
  slug: String(row.slug || ""),
  entityType: row.entityType as PublicBusinessSlugEntityType,
  entityId: String(row.entityId || ""),
  preferredSlug: row.preferredSlug ? String(row.preferredSlug) : null,
  sourceName: row.sourceName ? String(row.sourceName) : null,
  assignmentStatus: String(row.assignmentStatus || "assigned"),
});

const isMissingSlugOwnershipTable = (error: unknown) => {
  const err = error as { code?: string; message?: string } | null;
  return Boolean(
    err?.code === "42P01" &&
      String(err?.message || "").includes("public_business_slug_ownerships"),
  );
};

export async function getPublicBusinessSlugOwnership(input: {
  entityType: PublicBusinessSlugEntityType;
  id: string;
}): Promise<PublicBusinessSlugOwnership | null> {
  try {
    const [row] = await db
      .select()
      .from(publicBusinessSlugOwnerships)
      .where(
        and(
          eq(publicBusinessSlugOwnerships.entityType, input.entityType),
          eq(publicBusinessSlugOwnerships.entityId, input.id),
        ),
      )
      .limit(1);
    return row ? asOwnership(row) : null;
  } catch (error) {
    if (isMissingSlugOwnershipTable(error)) return null;
    throw error;
  }
}

export async function listPublicBusinessSlugOwnershipsBySlug(
  slug: string,
): Promise<PublicBusinessSlugOwnership[]> {
  const normalized = normalizeCleanBusinessSlug(slug);
  if (!normalized) return [];
  try {
    const rows = await db
      .select()
      .from(publicBusinessSlugOwnerships)
      .where(eq(publicBusinessSlugOwnerships.slug, normalized));
    return rows.map(asOwnership);
  } catch (error) {
    if (isMissingSlugOwnershipTable(error)) return [];
    throw error;
  }
}

function buildSlugCandidates(input: AssignmentInput): string[] {
  const base = normalizeCandidate(input.name) || normalizeCandidate(input.id) || "business";
  const city = normalizeCandidate(input.city);
  const state = normalizeCandidate(input.state);
  const candidates = [
    base,
    city ? `${base}-${city}` : null,
    state ? `${base}-${state}` : null,
    city && state ? `${base}-${city}-${state}` : null,
  ].filter(Boolean) as string[];

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    candidates.push(`${base}-${suffix}`);
  }

  return Array.from(
    new Set(
      candidates
        .map((candidate) => normalizeCleanBusinessSlug(candidate))
        .filter(Boolean) as string[],
    ),
  );
}

export async function ensurePublicBusinessSlugOwnership(
  input: AssignmentInput,
): Promise<PublicBusinessSlugOwnership | null> {
  const id = String(input.id || "").trim();
  const entityType = input.entityType;
  if (!id || !entityType) return null;

  const existing = await getPublicBusinessSlugOwnership({ entityType, id });
  if (existing) return existing;

  const preferredSlug = normalizeCandidate(input.name);
  const candidates = buildSlugCandidates(input);
  for (const slug of candidates) {
    try {
      const [inserted] = await db
        .insert(publicBusinessSlugOwnerships)
        .values({
          slug,
          entityType,
          entityId: id,
          preferredSlug,
          sourceName: String(input.name || "").trim() || null,
          assignmentStatus: slug === preferredSlug ? "assigned" : "assigned_variant",
        })
        .returning();
      if (inserted) return asOwnership(inserted);
    } catch (error) {
      if (isMissingSlugOwnershipTable(error)) return null;
      const claimedByEntity = await getPublicBusinessSlugOwnership({
        entityType,
        id,
      });
      if (claimedByEntity) return claimedByEntity;
    }
  }

  return null;
}

export async function ensurePublicBusinessSlugOwnershipForEntity(input: {
  entityType: PublicBusinessSlugEntityType;
  id: string;
  name?: string | null;
}): Promise<PublicBusinessSlugOwnership | null> {
  const id = String(input.id || "").trim();
  if (!id) return null;

  if (
    input.entityType === "restaurant" ||
    input.entityType === "truck" ||
    input.entityType === "bar" ||
    input.entityType === "caterer" ||
    input.entityType === "private_chef"
  ) {
    const row = await storage.getRestaurant(id);
    const owner = row?.ownerId ? await storage.getUser(row.ownerId) : null;
    if (
      !row ||
      !row.isActive ||
      !owner ||
      owner.isDisabled !== false ||
      !isPublicBusinessVisible(row)
    ) {
      return null;
    }
    const expectedType =
      row.isFoodTruck || isTruckBusinessType(row.businessType)
        ? "truck"
        : isBarBusinessType(row.businessType)
          ? "bar"
          : row.businessType === "caterer" || row.businessType === "private_chef"
            ? row.businessType
            : "restaurant";
    if (expectedType !== input.entityType) return null;
    return ensurePublicBusinessSlugOwnership({
      entityType: expectedType,
      id,
      name: String(row.name || input.name || id),
      city: row.city,
      state: row.state,
    });
  }

  if (input.entityType === "location") {
    const [result] = await db
      .select({ host: hosts })
      .from(hosts)
      .innerJoin(users, eq(hosts.userId, users.id))
      .where(and(eq(hosts.id, id), eq(users.isDisabled, false)))
      .limit(1);
    const row = result?.host;
    if (!row) return null;
    if (
      !isPublicBusinessVisible({
        name: row.businessName,
        city: row.city,
        state: row.state,
      })
    ) {
      return null;
    }
    return ensurePublicBusinessSlugOwnership({
      entityType: "location",
      id,
      name: String(row.businessName || input.name || id),
      city: row.city,
      state: row.state,
    });
  }

  const [result] = await db
    .select({ supplier: suppliers })
    .from(suppliers)
    .innerJoin(users, eq(suppliers.userId, users.id))
    .where(
      and(
        eq(suppliers.id, id),
        eq(suppliers.isActive, true),
        eq(users.isDisabled, false),
      ),
    )
    .limit(1);
  const row = result?.supplier;
  if (!row) return null;
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
    return null;
  }
  return ensurePublicBusinessSlugOwnership({
    entityType: "supplier",
    id,
    name: String(row.businessName || input.name || id),
    city: row.city,
    state: row.state,
  });
}

export async function verifyOwnedSlugTarget(
  ownership: PublicBusinessSlugOwnership,
): Promise<boolean> {
  if (
    ownership.entityType === "restaurant" ||
    ownership.entityType === "truck" ||
    ownership.entityType === "bar" ||
    ownership.entityType === "caterer" ||
    ownership.entityType === "private_chef"
  ) {
    const [row] = await db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        city: restaurants.city,
        state: restaurants.state,
        cuisineType: restaurants.cuisineType,
        description: restaurants.description,
        isActive: restaurants.isActive,
        isFoodTruck: restaurants.isFoodTruck,
        businessType: restaurants.businessType,
      })
      .from(restaurants)
      .innerJoin(users, eq(restaurants.ownerId, users.id))
      .where(
        and(
          eq(restaurants.id, ownership.entityId),
          eq(users.isDisabled, false),
        ),
      )
      .limit(1);
    if (!row || !row.isActive || !isPublicBusinessVisible(row)) return false;
    const expectedType =
      row.isFoodTruck || isTruckBusinessType(row.businessType)
        ? "truck"
        : isBarBusinessType(row.businessType)
          ? "bar"
          : row.businessType === "caterer" || row.businessType === "private_chef"
            ? row.businessType
            : "restaurant";
    return expectedType === ownership.entityType;
  }

  if (ownership.entityType === "location") {
    const [row] = await db
      .select({
        id: hosts.id,
        businessName: hosts.businessName,
        city: hosts.city,
        state: hosts.state,
      })
      .from(hosts)
      .innerJoin(users, eq(hosts.userId, users.id))
      .where(
        and(
          eq(hosts.id, ownership.entityId),
          eq(users.isDisabled, false),
        ),
      )
      .limit(1);
    return Boolean(
      row &&
        isPublicBusinessVisible({
          name: row.businessName,
          city: row.city,
          state: row.state,
        }),
    );
  }

  const [row] = await db
    .select({
      id: suppliers.id,
      businessName: suppliers.businessName,
      city: suppliers.city,
      state: suppliers.state,
      onlinePaymentsNotes: suppliers.onlinePaymentsNotes,
      deliveryNotes: suppliers.deliveryNotes,
    })
    .from(suppliers)
    .innerJoin(users, eq(suppliers.userId, users.id))
    .where(
      and(
        eq(suppliers.id, ownership.entityId),
        eq(suppliers.isActive, true),
        eq(users.isDisabled, false),
      ),
    )
    .limit(1);
  return Boolean(
    row &&
      isPublicBusinessVisible({
        name: row.businessName,
        city: row.city,
        state: row.state,
        description: [row.onlinePaymentsNotes, row.deliveryNotes]
          .filter(Boolean)
          .join(" "),
      }),
  );
}
