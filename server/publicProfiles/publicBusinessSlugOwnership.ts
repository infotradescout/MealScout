import { and, eq } from "drizzle-orm";

import {
  hosts,
  publicBusinessSlugOwnerships,
  restaurants,
  suppliers,
} from "@shared/schema";
import { normalizeCleanBusinessSlug } from "@shared/cleanAffiliateLinks";

import { db } from "../db";
import { storage } from "../storage";

export type PublicBusinessSlugEntityType =
  | "restaurant"
  | "truck"
  | "bar"
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

export async function getPublicBusinessSlugOwnership(input: {
  entityType: PublicBusinessSlugEntityType;
  id: string;
}): Promise<PublicBusinessSlugOwnership | null> {
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
}

export async function listPublicBusinessSlugOwnershipsBySlug(
  slug: string,
): Promise<PublicBusinessSlugOwnership[]> {
  const normalized = normalizeCleanBusinessSlug(slug);
  if (!normalized) return [];
  const rows = await db
    .select()
    .from(publicBusinessSlugOwnerships)
    .where(eq(publicBusinessSlugOwnerships.slug, normalized));
  return rows.map(asOwnership);
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
    } catch {
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
    input.entityType === "bar"
  ) {
    const row = await storage.getRestaurant(id);
    if (!row || !row.isActive) return null;
    const expectedType =
      row.isFoodTruck || row.businessType === "food_truck"
        ? "truck"
        : row.businessType === "bar"
          ? "bar"
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
    const [row] = await db.select().from(hosts).where(eq(hosts.id, id)).limit(1);
    if (!row) return null;
    return ensurePublicBusinessSlugOwnership({
      entityType: "location",
      id,
      name: String(row.businessName || input.name || id),
      city: row.city,
      state: row.state,
    });
  }

  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.isActive, true)))
    .limit(1);
  if (!row) return null;
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
    ownership.entityType === "bar"
  ) {
    const [row] = await db
      .select({
        id: restaurants.id,
        isActive: restaurants.isActive,
        isFoodTruck: restaurants.isFoodTruck,
        businessType: restaurants.businessType,
      })
      .from(restaurants)
      .where(eq(restaurants.id, ownership.entityId))
      .limit(1);
    if (!row || !row.isActive) return false;
    const expectedType =
      row.isFoodTruck || row.businessType === "food_truck"
        ? "truck"
        : row.businessType === "bar"
          ? "bar"
          : "restaurant";
    return expectedType === ownership.entityType;
  }

  if (ownership.entityType === "location") {
    const [row] = await db.select({ id: hosts.id }).from(hosts).where(eq(hosts.id, ownership.entityId)).limit(1);
    return Boolean(row);
  }

  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, ownership.entityId), eq(suppliers.isActive, true)))
    .limit(1);
  return Boolean(row);
}
