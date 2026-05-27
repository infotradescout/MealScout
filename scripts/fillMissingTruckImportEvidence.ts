import { and, eq, or, sql } from "drizzle-orm";

import { db } from "../server/db";
import { restaurants, truckImportListings } from "../shared/schema";

type EvidencePayload = {
  evidenceSource?: string;
  fields?: Record<string, unknown>;
  fill_if_blank?: Record<string, unknown>;
  fillIfBlank?: Record<string, unknown>;
  suggested_description_only_if_blank?: string;
  suggestedDescriptionOnlyIfBlank?: string;
  notes?: string[];
  missingInfo?: string[];
  missing_info?: string[];
  confidence?: string;
};

type AppliedField = {
  target: "truck_import_listings" | "restaurants";
  field: string;
  value: unknown;
};

type SkippedField = {
  target: "truck_import_listings" | "restaurants";
  field: string;
  reason: "already_present" | "blank_input" | "unsupported_field" | "protected_field";
  existing?: unknown;
  incoming?: unknown;
};

const args = process.argv.slice(2);

const getArg = (name: string) => {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
};

const hasFlag = (name: string) => args.includes(`--${name}`);

const normalizeString = (value: unknown) => String(value ?? "").trim();
const normalizeNullableString = (value: unknown) => {
  const trimmed = normalizeString(value);
  return trimmed.length > 0 ? trimmed : null;
};
const normalizeEmail = (value: unknown) => {
  const trimmed = normalizeString(value).toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};
const isBlank = (value: unknown) =>
  value === null || value === undefined || String(value).trim().length === 0;

const normalizeUrl = (value: unknown, platform?: "instagram" | "facebook") => {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (platform === "instagram") {
    const handle = trimmed.replace(/^@/, "");
    return `https://instagram.com/${handle}`;
  }
  if (platform === "facebook") {
    const slug = trimmed.replace(/^@/, "").replace(/\s+/g, "");
    return `https://facebook.com/${slug}`;
  }
  return `https://${trimmed}`;
};

const readPayload = async (filePath?: string): Promise<EvidencePayload> => {
  if (!filePath) {
    throw new Error("Pass --payload=/path/to/evidence.json");
  }
  const fs = await import("fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as EvidencePayload;
};

const listingFieldMap = {
  externalId: "externalId",
  email: "email",
  name: "name",
  address: "address",
  city: "city",
  state: "state",
  phone: "phone",
  cuisineType: "cuisineType",
  category: "cuisineType",
  websiteUrl: "websiteUrl",
  website: "websiteUrl",
  instagramUrl: "instagramUrl",
  instagram: "instagramUrl",
  facebookPageUrl: "facebookPageUrl",
  facebook: "facebookPageUrl",
  latitude: "latitude",
  longitude: "longitude",
} as const;

const restaurantFieldMap = {
  name: "name",
  address: "address",
  city: "city",
  state: "state",
  phone: "phone",
  cuisineType: "cuisineType",
  category: "cuisineType",
  websiteUrl: "websiteUrl",
  website: "websiteUrl",
  instagramUrl: "instagramUrl",
  instagram: "instagramUrl",
  facebookPageUrl: "facebookPageUrl",
  facebook: "facebookPageUrl",
  latitude: "latitude",
  longitude: "longitude",
} as const;

const protectedFields = new Set([
  "description",
  "menu",
  "schedule",
  "logo",
  "photos",
  "booking_available",
  "bookingAvailable",
  "catering_available",
  "cateringAvailable",
]);

const formatIncoming = (field: string, value: unknown) => {
  if (field === "email") return normalizeEmail(value);
  if (field === "websiteUrl" || field === "website") return normalizeUrl(value);
  if (field === "instagramUrl" || field === "instagram") return normalizeUrl(value, "instagram");
  if (field === "facebookPageUrl" || field === "facebook") return normalizeUrl(value, "facebook");
  return normalizeNullableString(value);
};

const findListing = async (listingId?: string, query?: string) => {
  if (listingId) {
    const [listing] = await db
      .select()
      .from(truckImportListings)
      .where(eq(truckImportListings.id, listingId))
      .limit(1);
    return listing ?? null;
  }

  const trimmed = normalizeString(query);
  if (!trimmed) throw new Error("Pass --listing-id or --query");
  const searchValue = `%${trimmed.toLowerCase()}%`;
  const [listing] = await db
    .select()
    .from(truckImportListings)
    .where(
      or(
        eq(truckImportListings.externalId, trimmed),
        sql`lower(${truckImportListings.name}) like ${searchValue}`,
        sql`lower(coalesce(${truckImportListings.email}, '')) like ${searchValue}`,
        sql`lower(coalesce(${truckImportListings.phone}, '')) like ${searchValue}`,
      ),
    )
    .orderBy(sql`${truckImportListings.confidenceScore} desc nulls last`)
    .limit(1);
  return listing ?? null;
};

const main = async () => {
  const payload = await readPayload(getArg("payload"));
  const incoming = {
    ...(payload.fields || {}),
    ...(payload.fillIfBlank || {}),
    ...(payload.fill_if_blank || {}),
  };
  const listing = await findListing(getArg("listing-id"), getArg("query"));
  if (!listing) throw new Error("Truck import listing not found");

  const [seededRestaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.claimedFromImportId, listing.id))
    .limit(1);

  const listingUpdates: Record<string, unknown> = {};
  const restaurantUpdates: Record<string, unknown> = {};
  const applied: AppliedField[] = [];
  const skipped: SkippedField[] = [];

  for (const [incomingField, rawValue] of Object.entries(incoming)) {
    if (protectedFields.has(incomingField)) {
      skipped.push({
        target: "truck_import_listings",
        field: incomingField,
        reason: "protected_field",
        incoming: rawValue,
      });
      continue;
    }

    const listingField = (listingFieldMap as Record<string, string | undefined>)[incomingField];
    const restaurantField = (restaurantFieldMap as Record<string, string | undefined>)[incomingField];
    if (!listingField && !restaurantField) {
      skipped.push({
        target: "truck_import_listings",
        field: incomingField,
        reason: "unsupported_field",
        incoming: rawValue,
      });
      continue;
    }

    const incomingValue = formatIncoming(incomingField, rawValue);
    if (isBlank(incomingValue)) {
      skipped.push({
        target: "truck_import_listings",
        field: incomingField,
        reason: "blank_input",
        incoming: rawValue,
      });
      continue;
    }

    if (listingField) {
      const existing = (listing as Record<string, unknown>)[listingField];
      if (isBlank(existing)) {
        listingUpdates[listingField] = incomingValue;
        applied.push({ target: "truck_import_listings", field: listingField, value: incomingValue });
      } else {
        skipped.push({
          target: "truck_import_listings",
          field: listingField,
          reason: "already_present",
          existing,
          incoming: incomingValue,
        });
      }
    }

    if (seededRestaurant && restaurantField) {
      const existing = (seededRestaurant as Record<string, unknown>)[restaurantField];
      if (isBlank(existing)) {
        restaurantUpdates[restaurantField] = incomingValue;
        applied.push({ target: "restaurants", field: restaurantField, value: incomingValue });
      } else {
        skipped.push({
          target: "restaurants",
          field: restaurantField,
          reason: "already_present",
          existing,
          incoming: incomingValue,
        });
      }
    }
  }

  const suggestedDescription =
    payload.suggestedDescriptionOnlyIfBlank || payload.suggested_description_only_if_blank;
  if (seededRestaurant && suggestedDescription && isBlank((seededRestaurant as any).description)) {
    restaurantUpdates.description = suggestedDescription;
    applied.push({ target: "restaurants", field: "description", value: suggestedDescription });
  } else if (seededRestaurant && suggestedDescription) {
    skipped.push({
      target: "restaurants",
      field: "description",
      reason: "already_present",
      existing: (seededRestaurant as any).description,
      incoming: suggestedDescription,
    });
  }

  const mergedRawData = {
    ...((listing as any).rawData || {}),
    evidenceFillMissing: {
      evidenceSource: payload.evidenceSource || null,
      confidence: payload.confidence || null,
      notes: payload.notes || [],
      missingInfo: payload.missingInfo || payload.missing_info || [],
      appliedAt: new Date().toISOString(),
    },
  };
  listingUpdates.rawData = mergedRawData;

  const apply = hasFlag("apply");
  if (apply) {
    if (Object.keys(listingUpdates).length > 0) {
      await db
        .update(truckImportListings)
        .set({ ...listingUpdates, updatedAt: new Date() })
        .where(eq(truckImportListings.id, listing.id));
    }
    if (seededRestaurant && Object.keys(restaurantUpdates).length > 0) {
      await db
        .update(restaurants)
        .set({ ...restaurantUpdates, updatedAt: new Date() })
        .where(eq(restaurants.id, seededRestaurant.id));
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "applied" : "dry_run",
        listingId: listing.id,
        restaurantId: seededRestaurant?.id || null,
        applied,
        skipped,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
