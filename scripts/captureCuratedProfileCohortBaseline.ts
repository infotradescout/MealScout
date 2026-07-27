import "dotenv/config";

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

/**
 * Production (run only in the deployed MealScout Render web-service shell):
 *
 *   npm run capture:curated-profile-cohort-baseline -- \
 *     --environment production \
 *     --confirm-production-read-only \
 *     --output backups/curated-profile-cohort-production.json
 *
 * Production identity binds to Render's runtime commit/repository/hostname
 * variables. Non-production runs must also pass --deployed-commit <40-char SHA>.
 * The database transaction is REPEATABLE READ and READ ONLY in every mode.
 */

const REGISTRY_PATH =
  "scripts/data/onboarding/curated-profile-cohort.json";
const CAPTURE_SCRIPT_PATH =
  "scripts/captureCuratedProfileCohortBaseline.ts";
const EXPECTED_TARGET_COUNT = 11;
const EXPECTED_TARGET_IDS = new Set([
  "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  "6ca08365-f8af-4c1d-9754-6c998c803869",
  "0a5ef5b8-852a-4bfd-8626-f06218d83b31",
  "75dd470e-2692-4579-bde0-a64dcc3f6fcb",
  "96cc9541-c39a-47e9-ba9f-2e15e0d0a6f2",
  "d0fd61f5-4181-4216-a000-3dc08bd9a348",
  "f3b76054-f355-43b0-a2d3-901277748557",
  "bfe24073-7362-4975-83ba-43c096f782e3",
  "e77ac77a-c432-42d0-ac0f-22c48b6306c9",
  "60475d81-2ef7-4de9-bfbc-a009f097cbd6",
  "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0",
]);
const FLORIDA_CANONICAL_ID = "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0";
const FLORIDA_DUPLICATE_ID = "7e36413b-6396-454e-a3c2-e93c00bad2bf";
const TROPIQ_FUEL_ID = "ea23bd89-c674-4fe2-b581-e13a6d130752";
const BASELINE_SCRIPT_BASE_COMMIT =
  "525b0cd6f12d8c53cbcd07450687c3625e42c74d";
const EXPECTED_RENDER_REPO_SLUG = "infotradescout/mealscout";
const EXPECTED_RENDER_HOSTNAME = "mealscout.onrender.com";
const ANALYTICS_LOOKBACK_DAYS = 365;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_DUPLICATE_LINKS = new Set([
  "95c4e656-f3cc-46ab-ae18-53f549cecfd1:271878aa-082c-4990-a0ae-4da1d665ca0a",
  "95c4e656-f3cc-46ab-ae18-53f549cecfd1:7ff7ba14-8e0a-48cf-b20a-e663e8d9d9e1",
  "95c4e656-f3cc-46ab-ae18-53f549cecfd1:4c39db22-6c2f-4312-820f-45ad79aa9998",
  "95c4e656-f3cc-46ab-ae18-53f549cecfd1:53de3f22-ebb6-4726-81c3-b2eba7c4ebc8",
  "75dd470e-2692-4579-bde0-a64dcc3f6fcb:c07e668e-63a9-4c1f-8a10-95bd15978df3",
  "75dd470e-2692-4579-bde0-a64dcc3f6fcb:16f4f038-6e85-4448-a03d-0669cc6e2876",
  "f1ed3d1d-3ea8-4f54-85b9-af48d1d884e0:7e36413b-6396-454e-a3c2-e93c00bad2bf",
]);
const OWNER_HASH_NAMESPACE = "mealscout-curated-cohort-owner-v1";
const ALLOWED_ENVIRONMENTS = new Set([
  "development",
  "staging",
  "production",
]);

type ClassificationExpectation = "food_truck" | "bar" | "unresolved";

type CohortTarget = {
  restaurantId: string;
  name: string;
  expectedSlug: string;
  classificationExpectation: ClassificationExpectation;
};

type DuplicateCandidate = {
  canonicalRestaurantId: string;
  candidateRestaurantId: string;
  name: string;
  reason: string;
};

type ExplicitExclusion = {
  restaurantId: string;
  name: string;
  reason: string;
};

type CohortRegistry = {
  schemaVersion: number;
  scope: string;
  canonicalTargetCount: number;
  targets: CohortTarget[];
  duplicateCandidates: DuplicateCandidate[];
  explicitExclusions: ExplicitExclusion[];
};

type QueryClient = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  release: () => void;
};

const normalizedText = (value: unknown) => String(value || "").trim();

const normalizeName = (value: unknown) =>
  normalizedText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const toSlug = (value: unknown) =>
  normalizedText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const asBoolean = (value: unknown) => value === true;

const asCount = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const asIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const ownerSubjectHash = (ownerSubjectId: unknown) => {
  const id = normalizedText(ownerSubjectId);
  return id ? `sha256:${sha256(`${OWNER_HASH_NAMESPACE}:${id}`)}` : null;
};

const parseValueArg = (name: string) => {
  const exactIndex = process.argv.indexOf(name);
  if (exactIndex >= 0) return normalizedText(process.argv[exactIndex + 1]);
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  return inline ? normalizedText(inline.slice(prefix.length)) : "";
};

const hasFlag = (name: string) => process.argv.includes(name);

const resolveEvidenceOutput = (rawPath: string) => {
  if (!rawPath) {
    throw new Error(
      "An explicit --output backups/<file>.json path is required; no evidence file was created.",
    );
  }
  const outputPath = resolve(process.cwd(), rawPath);
  const backupsRoot = resolve(process.cwd(), "backups");
  const relativeToBackups = relative(backupsRoot, outputPath);
  if (
    relativeToBackups === "" ||
    relativeToBackups === ".." ||
    relativeToBackups.startsWith(`..${sep}`) ||
    !outputPath.toLowerCase().endsWith(".json")
  ) {
    throw new Error(
      "Cohort baseline output must be an explicit JSON file below the ignored backups/ directory.",
    );
  }
  if (existsSync(outputPath) && !hasFlag("--overwrite")) {
    throw new Error(
      `Output already exists at ${rawPath}; pass --overwrite only after reviewing the existing capture.`,
    );
  }
  return outputPath;
};

const loadAndValidateRegistry = (): {
  registry: CohortRegistry;
  registrySha256: string;
} => {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const registry = JSON.parse(raw) as CohortRegistry;
  if (
    registry.schemaVersion !== 1 ||
    registry.canonicalTargetCount !== EXPECTED_TARGET_COUNT ||
    registry.targets.length !== EXPECTED_TARGET_COUNT
  ) {
    throw new Error(
      `The cohort registry must contain exactly ${EXPECTED_TARGET_COUNT} canonical targets.`,
    );
  }

  const targetIds = registry.targets.map((target) =>
    normalizedText(target.restaurantId),
  );
  const normalizedTargetNames = registry.targets.map((target) =>
    normalizeName(target.name),
  );
  if (
    targetIds.some((id) => !id) ||
    new Set(targetIds).size !== EXPECTED_TARGET_COUNT ||
    targetIds.some((id) => !UUID_PATTERN.test(id)) ||
    normalizedTargetNames.some((name) => !name) ||
    new Set(normalizedTargetNames).size !== EXPECTED_TARGET_COUNT ||
    targetIds.some((id) => !EXPECTED_TARGET_IDS.has(id)) ||
    [...EXPECTED_TARGET_IDS].some((id) => !targetIds.includes(id))
  ) {
    throw new Error(
      "Canonical cohort IDs and normalized names must uniquely match the locked 11-profile cohort.",
    );
  }

  const duplicateLinks = registry.duplicateCandidates.map(
    (candidate) =>
      `${normalizedText(candidate.canonicalRestaurantId)}:${normalizedText(
        candidate.candidateRestaurantId,
      )}`,
  );
  if (
    duplicateLinks.length !== EXPECTED_DUPLICATE_LINKS.size ||
    new Set(duplicateLinks).size !== EXPECTED_DUPLICATE_LINKS.size ||
    duplicateLinks.some((link) => !EXPECTED_DUPLICATE_LINKS.has(link)) ||
    [...EXPECTED_DUPLICATE_LINKS].some(
      (link) => !duplicateLinks.includes(link),
    ) ||
    registry.duplicateCandidates.some(
      (candidate) =>
        !UUID_PATTERN.test(candidate.candidateRestaurantId) ||
        !normalizedText(candidate.name) ||
        !normalizedText(candidate.reason) ||
        targetIds.includes(candidate.candidateRestaurantId) ||
        !targetIds.includes(candidate.canonicalRestaurantId) ||
        candidate.candidateRestaurantId === TROPIQ_FUEL_ID,
    )
  ) {
    throw new Error(
      "The registry must preserve the exact locked 3D Eats, CREATIVBOWLS, and Florida Kitchen duplicate candidates without promoting a duplicate to the canonical cohort.",
    );
  }
  const floridaPair = registry.duplicateCandidates.find(
    (candidate) =>
      candidate.canonicalRestaurantId === FLORIDA_CANONICAL_ID &&
      candidate.candidateRestaurantId === FLORIDA_DUPLICATE_ID,
  );
  if (!floridaPair) {
    throw new Error(
      "The Florida Kitchen canonical/duplicate pair must remain explicit.",
    );
  }
  if (
    registry.explicitExclusions.length !== 1 ||
    registry.explicitExclusions[0]?.restaurantId !== TROPIQ_FUEL_ID ||
    targetIds.includes(TROPIQ_FUEL_ID)
  ) {
    throw new Error(
      "Tropiq Fuel must remain an explicit issue-303 exclusion, not a canonical issue-302 target.",
    );
  }

  const spot = registry.targets.find(
    (target) => target.name === "The Spot Tavern",
  );
  const around = registry.targets.find(
    (target) => target.name === "Around The Table Catrring",
  );
  if (
    spot?.classificationExpectation !== "bar" ||
    around?.classificationExpectation !== "unresolved"
  ) {
    throw new Error(
      "The Spot Tavern must remain bar-classified and Around The Table must remain unresolved.",
    );
  }

  return { registry, registrySha256: sha256(raw) };
};

const ownerClass = (row: Record<string, unknown>) => {
  const userType = normalizedText(row.owner_user_type).toLowerCase();
  if (row.owner_exists === false) {
    return "orphaned_owner_reference";
  }
  if (asBoolean(row.owner_is_system_import)) {
    return "system_import_placeholder";
  }
  if (["admin", "duper_admin", "super_admin", "staff"].includes(userType)) {
    return "platform_operator";
  }
  if (asBoolean(row.owner_is_disabled)) return "disabled_linked_account";
  if (["food_truck", "restaurant_owner"].includes(userType)) {
    return "business_account";
  }
  return "other_linked_account";
};

const hasOwnerActivation = (row: Record<string, unknown>) =>
  asBoolean(row.owner_email_verified) ||
  asBoolean(row.owner_has_google_id) ||
  asBoolean(row.owner_has_facebook_id) ||
  asBoolean(row.owner_has_tradescout_id) ||
  (asBoolean(row.owner_has_password) &&
    !asBoolean(row.owner_must_reset_password));

const derivedEntityType = (row: Record<string, unknown>) => {
  const businessType = normalizedText(row.business_type).toLowerCase();
  if (
    asBoolean(row.is_food_truck) ||
    ["food_truck", "food-truck", "foodtruck"].includes(businessType)
  ) {
    return "truck";
  }
  if (["bar", "tavern", "brewery", "pub", "nightclub"].includes(businessType)) {
    return "bar";
  }
  return "restaurant";
};

const claimedState = (row: Record<string, unknown>) => {
  const hasImportLink = Boolean(normalizedText(row.claimed_from_import_id));
  if (!hasImportLink) return "not_import_backed";
  if (asBoolean(row.owner_is_system_import)) return "active_claimable_shell";
  if (
    asCount(row.approved_claim_request_count) > 0 ||
    ownerClass(row) === "business_account" ||
    ownerClass(row) === "platform_operator"
  ) {
    return "claimed_or_managed_import";
  }
  return "linked_import_review_required";
};

const publicState = (row: Record<string, unknown>) => {
  if (!asBoolean(row.is_active)) return "inactive";
  if (
    Boolean(normalizedText(row.claimed_from_import_id)) &&
    !asBoolean(row.is_verified) &&
    asBoolean(row.owner_is_system_import)
  ) {
    return "active_claimable_shell";
  }
  return asBoolean(row.is_verified)
    ? "active_verified_record"
    : "active_unverified_record";
};

const sanitizeHours = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowedDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return Object.fromEntries(
    allowedDays.map((day) => {
      const rawSlots = (value as Record<string, unknown>)[day];
      const slots = Array.isArray(rawSlots)
        ? rawSlots
            .map((slot) => {
              if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
                return null;
              }
              const record = slot as Record<string, unknown>;
              const open = normalizedText(record.open);
              const close = normalizedText(record.close);
              return open && close ? { open, close } : null;
            })
            .filter(Boolean)
        : [];
      return [day, slots];
    }),
  );
};

const galleryCounts = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { storedCount: 0, publicApprovedCount: 0 };
  }
  const entries = (value as Record<string, unknown>).publicGalleryImages;
  if (!Array.isArray(entries)) {
    return { storedCount: 0, publicApprovedCount: 0 };
  }
  return {
    storedCount: entries.length,
    publicApprovedCount: entries.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).publicApproved === true,
    ).length,
  };
};

const hoursSlotCount = (hours: Record<string, unknown>) =>
  Object.values(hours).reduce<number>(
    (total, value) => total + (Array.isArray(value) ? value.length : 0),
    0,
  );

const quoteIdentifier = (value: unknown) => {
  const identifier = normalizedText(value);
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
};

const groupBy = (
  rows: Record<string, unknown>[],
  key: string,
): Map<string, Record<string, unknown>[]> => {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = normalizedText(row[key]);
    if (!id) continue;
    const current = grouped.get(id) || [];
    current.push(row);
    grouped.set(id, current);
  }
  return grouped;
};

async function captureFloridaDependencies(
  client: QueryClient,
  canonicalId: string,
  duplicateId: string,
) {
  const foreignKeys = (
    await client.query(`
      select distinct
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_catalog = tc.constraint_catalog
       and kcu.constraint_schema = tc.constraint_schema
       and kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_catalog = tc.constraint_catalog
       and ccu.constraint_schema = tc.constraint_schema
       and ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and ccu.table_schema = 'public'
        and ccu.table_name = 'restaurants'
        and ccu.column_name = 'id'
      order by kcu.table_name, kcu.column_name
    `)
  ).rows;

  const dependencies: Array<{
    table: string;
    column: string;
    scope: "all_time" | "recent_365d";
    schemaState: "present" | "missing_table" | "missing_column";
    canonicalCount: number | null;
    duplicateCount: number | null;
  }> = [];

  for (const foreignKey of foreignKeys) {
    const schemaName = quoteIdentifier(foreignKey.table_schema);
    const tableName = quoteIdentifier(foreignKey.table_name);
    const columnName = quoteIdentifier(foreignKey.column_name);
    const [counts] = (
      await client.query(
        `
          select
            count(*) filter (where ${columnName} = $1)::int as canonical_count,
            count(*) filter (where ${columnName} = $2)::int as duplicate_count
          from ${schemaName}.${tableName}
        `,
        [canonicalId, duplicateId],
      )
    ).rows;
    dependencies.push({
      table: normalizedText(foreignKey.table_name),
      column: normalizedText(foreignKey.column_name),
      scope: "all_time",
      schemaState: "present",
      canonicalCount: asCount(counts?.canonical_count),
      duplicateCount: asCount(counts?.duplicate_count),
    });
  }

  const genericDependencies = [
    {
      table: "image_uploads",
      column: "entity_id",
      requiredColumns: ["entity_id"],
      whereClause: "",
      scope: "all_time" as const,
    },
    {
      table: "public_business_slug_ownerships",
      column: "entity_id",
      requiredColumns: ["entity_id"],
      whereClause: "",
      scope: "all_time" as const,
    },
    {
      table: "request_logs",
      column: "entity_id",
      requiredColumns: ["entity_id", "created_at"],
      whereClause: `where created_at >= current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'`,
      scope: "recent_365d" as const,
    },
    {
      table: "market_entities",
      column: "entity_id",
      requiredColumns: ["entity_id"],
      whereClause: "",
      scope: "all_time" as const,
    },
    {
      table: "security_audit_log",
      column: "resource_id",
      requiredColumns: ["resource_id", "timestamp"],
      whereClause: `where "timestamp" >= current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'`,
      scope: "recent_365d" as const,
    },
    {
      table: "affiliate_links",
      column: "resource_id",
      requiredColumns: ["resource_id", "created_at"],
      whereClause: `where created_at >= current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'`,
      scope: "recent_365d" as const,
    },
    {
      table: "affiliate_share_events",
      column: "resource_id",
      requiredColumns: ["resource_id", "created_at"],
      whereClause: `where created_at >= current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'`,
      scope: "recent_365d" as const,
    },
    {
      table: "lisa_claim",
      column: "subject_id",
      requiredColumns: ["subject_id", "created_at"],
      whereClause: `where created_at >= current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'`,
      scope: "recent_365d" as const,
    },
  ];

  const genericSchemaRows = (
    await client.query(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [
        [
          ...new Set([
            ...genericDependencies.map((entry) => entry.table),
            "telemetry_events",
          ]),
        ],
      ],
    )
  ).rows;
  const availableGenericTables = new Set(
    genericSchemaRows.map((row) => normalizedText(row.table_name)),
  );
  const availableGenericColumns = new Set(
    genericSchemaRows.map(
      (row) =>
        `${normalizedText(row.table_name)}.${normalizedText(row.column_name)}`,
    ),
  );
  const schemaStateFor = (table: string, columns: string[]) => {
    if (!availableGenericTables.has(table)) return "missing_table" as const;
    if (
      columns.some(
        (column) => !availableGenericColumns.has(`${table}.${column}`),
      )
    ) {
      return "missing_column" as const;
    }
    return "present" as const;
  };

  for (const dependency of genericDependencies) {
    const schemaState = schemaStateFor(
      dependency.table,
      dependency.requiredColumns,
    );
    if (schemaState !== "present") {
      dependencies.push({
        table: dependency.table,
        column: dependency.column,
        scope: dependency.scope,
        schemaState,
        canonicalCount: null,
        duplicateCount: null,
      });
      continue;
    }
    const [counts] = (
      await client.query(
        `
          select
            count(*) filter (
              where ${quoteIdentifier(dependency.column)} = $1
            )::int as canonical_count,
            count(*) filter (
              where ${quoteIdentifier(dependency.column)} = $2
            )::int as duplicate_count
          from public.${quoteIdentifier(dependency.table)}
          ${dependency.whereClause}
        `,
        [canonicalId, duplicateId],
      )
    ).rows;
    dependencies.push({
      table: dependency.table,
      column: dependency.column,
      scope: dependency.scope,
      schemaState: "present",
      canonicalCount: asCount(counts?.canonical_count),
      duplicateCount: asCount(counts?.duplicate_count),
    });
  }

  const pathSchemaState = schemaStateFor("request_logs", [
    "path",
    "created_at",
  ]);
  let pathCounts: Record<string, unknown> | undefined;
  if (pathSchemaState === "present") {
    [pathCounts] = (
      await client.query(
        `
          select
            count(*) filter (where position($1 in path) > 0)::int
              as canonical_count,
            count(*) filter (where position($2 in path) > 0)::int
              as duplicate_count
          from public.request_logs
          where created_at >= current_timestamp
            - interval '${ANALYTICS_LOOKBACK_DAYS} days'
        `,
        [canonicalId, duplicateId],
      )
    ).rows;
  }
  dependencies.push({
    table: "request_logs",
    column: "path_contains_restaurant_id_last_365_days",
    scope: "recent_365d",
    schemaState: pathSchemaState,
    canonicalCount:
      pathSchemaState === "present"
        ? asCount(pathCounts?.canonical_count)
        : null,
    duplicateCount:
      pathSchemaState === "present"
        ? asCount(pathCounts?.duplicate_count)
        : null,
  });

  const telemetrySchemaState = schemaStateFor("telemetry_events", [
    "properties",
    "created_at",
  ]);
  let telemetryCounts: Record<string, unknown> | undefined;
  if (telemetrySchemaState === "present") {
    [telemetryCounts] = (
      await client.query(
        `
          select
            count(*) filter (
              where properties->>'restaurantId' = $1
                 or properties->>'truckId' = $1
                 or properties->>'businessId' = $1
                 or properties->>'entityId' = $1
            )::int as canonical_count,
            count(*) filter (
              where properties->>'restaurantId' = $2
                 or properties->>'truckId' = $2
                 or properties->>'businessId' = $2
                 or properties->>'entityId' = $2
            )::int as duplicate_count
          from public.telemetry_events
          where created_at >= current_timestamp
            - interval '${ANALYTICS_LOOKBACK_DAYS} days'
        `,
        [canonicalId, duplicateId],
      )
    ).rows;
  }
  dependencies.push({
    table: "telemetry_events",
    column:
      "properties.restaurantId|truckId|businessId|entityId_last_365_days",
    scope: "recent_365d",
    schemaState: telemetrySchemaState,
    canonicalCount:
      telemetrySchemaState === "present"
        ? asCount(telemetryCounts?.canonical_count)
        : null,
    duplicateCount:
      telemetrySchemaState === "present"
        ? asCount(telemetryCounts?.duplicate_count)
        : null,
  });

  return dependencies.sort((left, right) =>
    `${left.table}.${left.column}`.localeCompare(
      `${right.table}.${right.column}`,
    ),
  );
}

async function main() {
  const databaseUrl = normalizedText(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for a baseline capture; no production evidence snapshot was generated.",
    );
  }

  const declaredEnvironment = parseValueArg("--environment").toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(declaredEnvironment)) {
    throw new Error(
      "Pass --environment development, staging, or production so the evidence does not imply an unverified environment.",
    );
  }
  if (
    declaredEnvironment === "production" &&
    !hasFlag("--confirm-production-read-only")
  ) {
    throw new Error(
      "Production capture requires --confirm-production-read-only. The transaction remains READ ONLY.",
    );
  }
  const declaredDeployedCommit =
    parseValueArg("--deployed-commit").toLowerCase();
  const renderRuntimeProof =
    declaredEnvironment === "production"
      ? {
          render: normalizedText(process.env.RENDER).toLowerCase(),
          gitCommit: normalizedText(process.env.RENDER_GIT_COMMIT).toLowerCase(),
          gitRepoSlug: normalizedText(
            process.env.RENDER_GIT_REPO_SLUG,
          ).toLowerCase(),
          externalHostname: normalizedText(
            process.env.RENDER_EXTERNAL_HOSTNAME,
          ).toLowerCase(),
          isPullRequest: normalizedText(
            process.env.IS_PULL_REQUEST,
          ).toLowerCase(),
        }
      : null;
  if (renderRuntimeProof && declaredDeployedCommit) {
    throw new Error(
      "Do not pass --deployed-commit for production; the capture binds directly to Render's RENDER_GIT_COMMIT.",
    );
  }
  const deployedCommit = renderRuntimeProof
    ? renderRuntimeProof.gitCommit
    : declaredDeployedCommit;
  if (
    !/^[0-9a-f]{40}$/.test(deployedCommit) ||
    (renderRuntimeProof &&
      (renderRuntimeProof.render !== "true" ||
        renderRuntimeProof.gitRepoSlug !== EXPECTED_RENDER_REPO_SLUG ||
        renderRuntimeProof.externalHostname !== EXPECTED_RENDER_HOSTNAME ||
        renderRuntimeProof.isPullRequest === "true"))
  ) {
    throw new Error(
      renderRuntimeProof
        ? "Production capture must run in the non-PR MealScout Render web service with a full RENDER_GIT_COMMIT."
        : "Pass the exact 40-character deployed application SHA with --deployed-commit.",
    );
  }

  const outputPath = resolveEvidenceOutput(parseValueArg("--output"));
  const { registry, registrySha256 } = loadAndValidateRegistry();
  const targetIds = registry.targets.map((target) => target.restaurantId);
  const duplicateCandidateIds = registry.duplicateCandidates.map(
    (candidate) => candidate.candidateRestaurantId,
  );
  const explicitCanonicalByCandidateId = new Map(
    registry.duplicateCandidates.map((candidate) => [
      candidate.candidateRestaurantId,
      candidate.canonicalRestaurantId,
    ]),
  );
  const normalizedTargetNames = registry.targets.map((target) =>
    normalizeName(target.name),
  );
  const importSystemEmail =
    normalizedText(process.env.IMPORT_SYSTEM_EMAIL) ||
    "system-import@mealscout.us";

  const parsedDatabaseUrl = new URL(databaseUrl);
  const databaseIdentity = `${parsedDatabaseUrl.hostname.toLowerCase()}${parsedDatabaseUrl.pathname}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const client = (await pool.connect()) as unknown as QueryClient;
  let transactionStarted = false;

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");

    const [clock] = (
      await client.query(`
        select
          current_timestamp as captured_at,
          current_date as database_date,
          current_timestamp - interval '${ANALYTICS_LOOKBACK_DAYS} days'
            as analytics_window_start,
          current_timestamp as analytics_window_end,
          current_setting('TimeZone') as database_timezone,
          current_setting('transaction_read_only') as transaction_read_only,
          current_setting('transaction_isolation') as transaction_isolation
      `)
    ).rows;
    if (
      normalizedText(clock?.transaction_read_only).toLowerCase() !== "on" ||
      normalizedText(clock?.transaction_isolation).toLowerCase() !==
        "repeatable read"
    ) {
      throw new Error(
        "The database did not confirm a REPEATABLE READ READ ONLY transaction.",
      );
    }

    const profileRows = (
      await client.query(
        `
          select
            r.id,
            r.owner_id,
            r.name,
            r.business_type,
            r.is_food_truck,
            r.is_active,
            r.is_verified,
            r.claimed_from_import_id,
            r.operating_hours,
            r.social_autopost_settings,
            r.logo_url is not null and btrim(r.logo_url) <> '' as has_logo,
            r.cover_image_url is not null and btrim(r.cover_image_url) <> '' as has_cover,
            r.mobile_online,
            r.current_latitude is not null as has_current_latitude,
            r.current_longitude is not null as has_current_longitude,
            r.last_broadcast_at,
            r.live_until_at,
            r.created_at as profile_created_at,
            r.updated_at as profile_updated_at,
            u.id is not null as owner_exists,
            u.user_type as owner_user_type,
            coalesce(u.is_disabled, false) as owner_is_disabled,
            coalesce(u.email_verified, false) as owner_email_verified,
            u.google_id is not null as owner_has_google_id,
            u.facebook_id is not null as owner_has_facebook_id,
            u.tradescout_id is not null as owner_has_tradescout_id,
            u.password_hash is not null as owner_has_password,
            coalesce(u.must_reset_password, false) as owner_must_reset_password,
            lower(coalesce(u.email, '')) = lower($2) as owner_is_system_import,
            u.created_at as owner_created_at,
            u.updated_at as owner_updated_at,
            til.status as import_listing_status,
            til.source as import_listing_source,
            til.created_at as import_listing_created_at,
            til.updated_at as import_listing_updated_at,
            coalesce(claims.claim_request_count, 0)::int as claim_request_count,
            coalesce(claims.approved_claim_request_count, 0)::int
              as approved_claim_request_count
          from restaurants r
          left join users u on u.id = r.owner_id
          left join truck_import_listings til
            on til.id = r.claimed_from_import_id
          left join lateral (
            select
              count(*)::int as claim_request_count,
              count(*) filter (where lower(coalesce(tcr.status, '')) = 'approved')::int
                as approved_claim_request_count
            from truck_claim_requests tcr
            where tcr.restaurant_id = r.id
          ) claims on true
          where r.id = any($1::text[])
          order by r.id
        `,
        [targetIds, importSystemEmail],
      )
    ).rows;

    const duplicateRows = (
      await client.query(
        `
          select
            r.id,
            r.owner_id,
            r.name,
            r.business_type,
            r.is_food_truck,
            r.is_active,
            r.is_verified,
            r.claimed_from_import_id,
            r.created_at,
            r.updated_at,
            u.id is not null as owner_exists,
            u.user_type as owner_user_type,
            coalesce(u.is_disabled, false) as owner_is_disabled,
            lower(coalesce(u.email, '')) = lower($3) as owner_is_system_import,
            regexp_replace(lower(btrim(r.name)), '[^a-z0-9]+', '', 'g')
              as normalized_name
          from restaurants r
          left join users u on u.id = r.owner_id
          where r.id = any($2::text[])
             or regexp_replace(lower(btrim(r.name)), '[^a-z0-9]+', '', 'g')
                = any($1::text[])
          order by r.name, r.id
          limit 101
        `,
        [
          normalizedTargetNames,
          duplicateCandidateIds,
          importSystemEmail,
        ],
      )
    ).rows;
    if (duplicateRows.length > 100) {
      throw new Error(
        "Duplicate discovery exceeded the 100-row safety cap; narrow and review the identity scope before capture.",
      );
    }
    const observedDuplicateInventoryIds = new Set(
      duplicateRows.map((row) => normalizedText(row.id)).filter(Boolean),
    );
    const missingExplicitDuplicateCandidateIds = duplicateCandidateIds.filter(
      (candidateId) => !observedDuplicateInventoryIds.has(candidateId),
    );
    const duplicateInventoryIds = [
      ...new Set([
        ...targetIds,
        ...duplicateCandidateIds,
        ...duplicateRows.map((row) => normalizedText(row.id)).filter(Boolean),
      ]),
    ];

    const routeRows = (
      await client.query(
        `
          select
            slug,
            entity_type,
            entity_id,
            preferred_slug,
            source_name,
            assignment_status,
            created_at,
            updated_at
          from public_business_slug_ownerships
          where entity_id = any($1::text[])
          order by entity_id, slug
        `,
        [duplicateInventoryIds],
      )
    ).rows;

    const menuRows = (
      await client.query(
        `
          select
            m.restaurant_id,
            count(distinct m.id)::int as menu_count,
            count(distinct m.id) filter (where m.is_active = true)::int
              as active_menu_count,
            count(mi.id)::int as menu_item_count,
            count(mi.id) filter (
              where m.is_active = true and mi.is_available = true
            )::int as public_menu_item_count,
            max(m.updated_at) as latest_menu_updated_at,
            max(mi.updated_at) as latest_menu_item_updated_at
          from menus m
          left join menu_items mi
            on mi.menu_id = m.id
           and mi.restaurant_id = m.restaurant_id
          where m.restaurant_id = any($1::text[])
          group by m.restaurant_id
          order by m.restaurant_id
        `,
        [targetIds],
      )
    ).rows;

    const menuIntegrityRows = (
      await client.query(
        `
          select
            m.restaurant_id,
            count(mi.id)::int as cross_owner_menu_item_count
          from menus m
          join menu_items mi
            on mi.menu_id = m.id
           and mi.restaurant_id is distinct from m.restaurant_id
          where m.restaurant_id = any($1::text[])
          group by m.restaurant_id
          order by m.restaurant_id
        `,
        [targetIds],
      )
    ).rows;

    const mediaRows = (
      await client.query(
        `
          select
            entity_id as restaurant_id,
            count(*)::int as upload_count,
            count(*) filter (
              where lower(coalesce(image_type, '')) = 'restaurant_logo'
            )::int as logo_upload_count,
            count(*) filter (
              where lower(coalesce(image_type, '')) = 'restaurant_cover'
            )::int as cover_upload_count,
            count(*) filter (
              where lower(coalesce(image_type, '')) like 'restaurant_gallery_%'
            )::int as gallery_upload_count,
            max(uploaded_at) as latest_upload_at
          from image_uploads
          where entity_id = any($1::text[])
            and lower(coalesce(entity_type, '')) in (
              'restaurant', 'truck', 'food_truck'
            )
          group by entity_id
          order by entity_id
        `,
        [targetIds],
      )
    ).rows;

    const manualScheduleRows = (
      await client.query(
        `
          select
            tms.id,
            tms.truck_id,
            tms.date,
            tms.start_time,
            tms.end_time,
            tms.location_name,
            tms.city,
            tms.state,
            tms.is_public,
            tms.status,
            tms.schedule_type,
            tms.timezone,
            tms.source_type,
            tms.source_artifact,
            tms.source_confidence,
            tms.owner_submitted_equivalent,
            tms.recurring,
            tms.expires_at,
            tms.geocode_status,
            tms.map_eligible,
            tms.live_feed_eligible,
            tms.last_confirmed_at,
            tms.created_at,
            tms.updated_at,
            tms.date >= current_date as is_future,
            (
              tms.date >= current_date
              and coalesce(tms.is_public, true) = true
              and coalesce(tms.live_feed_eligible, true) = true
              and lower(coalesce(tms.status, 'open')) not in (
                'archived', 'cancelled', 'canceled', 'closed', 'deleted',
                'draft', 'expired', 'inactive', 'unavailable'
              )
              and (tms.expires_at is null or tms.expires_at >= now())
            ) as passes_basic_stored_filters
          from truck_manual_schedules tms
          where tms.truck_id = any($1::text[])
          order by tms.truck_id, tms.date, tms.id
        `,
        [targetIds],
      )
    ).rows;

    const bookingSummaryRows = (
      await client.query(
        `
          select
            eb.truck_id,
            count(*)::int as booking_count,
            count(*) filter (
              where lower(coalesce(eb.status, '')) = 'confirmed'
            )::int as confirmed_booking_count,
            count(*) filter (where e.date >= current_date)::int
              as future_booking_count,
            count(*) filter (
              where e.date >= current_date
                and lower(coalesce(eb.status, '')) = 'confirmed'
                and lower(coalesce(e.status, 'open')) not in (
                  'archived', 'cancelled', 'canceled', 'closed', 'deleted',
                  'draft', 'expired', 'inactive', 'unavailable'
                )
            )::int as confirmed_future_booking_count,
            max(eb.updated_at) as latest_booking_updated_at,
            max(e.last_confirmed_at) as latest_event_confirmed_at
          from event_bookings eb
          join events e on e.id = eb.event_id
          where eb.truck_id = any($1::text[])
          group by eb.truck_id
          order by eb.truck_id
        `,
        [targetIds],
      )
    ).rows;

    const futureBookingRows = (
      await client.query(
        `
          select
            eb.id,
            eb.truck_id,
            eb.event_id,
            eb.status as booking_status,
            eb.booking_confirmed_at,
            eb.created_at,
            eb.updated_at,
            e.date,
            e.start_time,
            e.end_time,
            e.status as event_status,
            e.event_type,
            e.last_confirmed_at
          from event_bookings eb
          join events e on e.id = eb.event_id
          where eb.truck_id = any($1::text[])
            and e.date >= current_date
          order by eb.truck_id, e.date, eb.id
        `,
        [targetIds],
      )
    ).rows;

    const evidenceReviewRows = (
      await client.query(
        `
          select
            restaurant_id,
            count(*)::int as review_count,
            count(*) filter (where owner_approved = true)::int
              as owner_approved_count,
            count(*) filter (where production_applied = true)::int
              as production_applied_count,
            max(captured_at) as latest_captured_at,
            max(reviewed_at) as latest_reviewed_at,
            max(updated_at) as latest_updated_at
          from menu_draft_reviews
          where restaurant_id = any($1::text[])
          group by restaurant_id
          order by restaurant_id
        `,
        [targetIds],
      )
    ).rows;

    const floridaDependencies = await captureFloridaDependencies(
      client,
      FLORIDA_CANONICAL_ID,
      FLORIDA_DUPLICATE_ID,
    );

    await client.query("COMMIT");
    transactionStarted = false;

    const profileById = new Map(
      profileRows.map((row) => [normalizedText(row.id), row]),
    );
    const routesById = groupBy(routeRows, "entity_id");
    const menuById = new Map(
      menuRows.map((row) => [normalizedText(row.restaurant_id), row]),
    );
    const menuIntegrityById = new Map(
      menuIntegrityRows.map((row) => [
        normalizedText(row.restaurant_id),
        row,
      ]),
    );
    const mediaById = new Map(
      mediaRows.map((row) => [normalizedText(row.restaurant_id), row]),
    );
    const schedulesById = groupBy(manualScheduleRows, "truck_id");
    const bookingSummaryById = new Map(
      bookingSummaryRows.map((row) => [normalizedText(row.truck_id), row]),
    );
    const futureBookingsById = groupBy(futureBookingRows, "truck_id");
    const evidenceReviewById = new Map(
      evidenceReviewRows.map((row) => [
        normalizedText(row.restaurant_id),
        row,
      ]),
    );
    const duplicateRoutesById = groupBy(routeRows, "entity_id");

    const targets = registry.targets.map((target) => {
      const row = profileById.get(target.restaurantId);
      if (!row) {
        return {
          target,
          captureState: "canonical_target_missing",
          readiness: "blocked",
        };
      }

      const entityType = derivedEntityType(row);
      const ownedRoutes = (routesById.get(target.restaurantId) || []).map(
        (route) => ({
          slug: normalizedText(route.slug),
          entityType: normalizedText(route.entity_type),
          cleanPath: `/${normalizedText(route.slug)}`,
          preferredSlug: normalizedText(route.preferred_slug) || null,
          assignmentStatus: normalizedText(route.assignment_status),
          createdAt: asIso(route.created_at),
          updatedAt: asIso(route.updated_at),
        }),
      );
      const menu = menuById.get(target.restaurantId) || {};
      const menuIntegrity =
        menuIntegrityById.get(target.restaurantId) || {};
      const crossOwnerMenuItemCount = asCount(
        menuIntegrity.cross_owner_menu_item_count,
      );
      const media = mediaById.get(target.restaurantId) || {};
      const schedules = schedulesById.get(target.restaurantId) || [];
      const bookingSummary = bookingSummaryById.get(target.restaurantId) || {};
      const futureBookings = futureBookingsById.get(target.restaurantId) || [];
      const evidenceReview = evidenceReviewById.get(target.restaurantId) || {};
      const hours = sanitizeHours(row.operating_hours);
      const gallery = galleryCounts(row.social_autopost_settings);
      const targetNormalizedName = normalizeName(target.name);
      const explicitCandidateIds = registry.duplicateCandidates
        .filter(
          (candidate) =>
            candidate.canonicalRestaurantId === target.restaurantId,
        )
        .map((candidate) => candidate.candidateRestaurantId);

      const duplicateMatches = duplicateRows
        .filter((candidate) => {
          const candidateId = normalizedText(candidate.id);
          if (targetIds.includes(candidateId)) return false;
          const explicitCanonicalId =
            explicitCanonicalByCandidateId.get(candidateId);
          if (explicitCanonicalId) {
            return explicitCanonicalId === target.restaurantId;
          }
          return (
            normalizedText(candidate.normalized_name) === targetNormalizedName
          );
        })
        .map((candidate) => {
          const candidateId = normalizedText(candidate.id);
          return {
            restaurantId: candidateId,
            name: normalizedText(candidate.name),
            normalizedName: normalizedText(candidate.normalized_name),
            businessType: normalizedText(candidate.business_type),
            isFoodTruck: asBoolean(candidate.is_food_truck),
            isActive: asBoolean(candidate.is_active),
            isVerified: asBoolean(candidate.is_verified),
            hasImportLink: Boolean(
              normalizedText(candidate.claimed_from_import_id),
            ),
            ownerSubjectHash: ownerSubjectHash(candidate.owner_id),
            ownerExists: asBoolean(candidate.owner_exists),
            ownerClass: ownerClass(candidate),
            routes: (duplicateRoutesById.get(candidateId) || []).map(
              (route) => ({
                slug: normalizedText(route.slug),
                entityType: normalizedText(route.entity_type),
                cleanPath: `/${normalizedText(route.slug)}`,
                assignmentStatus: normalizedText(route.assignment_status),
              }),
            ),
            createdAt: asIso(candidate.created_at),
            updatedAt: asIso(candidate.updated_at),
          };
        });

      const expectedEntityType =
        target.classificationExpectation === "food_truck"
          ? "truck"
          : target.classificationExpectation;
      const classificationConflict =
        expectedEntityType !== "unresolved" && expectedEntityType !== entityType;
      const targetSchedules = schedules.map((schedule) => ({
        id: normalizedText(schedule.id),
        date: asIso(schedule.date),
        startTime: normalizedText(schedule.start_time) || null,
        endTime: normalizedText(schedule.end_time) || null,
        locationName: normalizedText(schedule.location_name) || null,
        city: normalizedText(schedule.city) || null,
        state: normalizedText(schedule.state) || null,
        isPublic: schedule.is_public !== false,
        status: normalizedText(schedule.status) || null,
        scheduleType: normalizedText(schedule.schedule_type) || null,
        timezone: normalizedText(schedule.timezone) || null,
        sourceType: normalizedText(schedule.source_type) || null,
        sourceArtifact: normalizedText(schedule.source_artifact) || null,
        sourceConfidence:
          normalizedText(schedule.source_confidence) || null,
        ownerSubmittedEquivalent: asBoolean(
          schedule.owner_submitted_equivalent,
        ),
        recurring: asBoolean(schedule.recurring),
        expiresAt: asIso(schedule.expires_at),
        geocodeStatus: normalizedText(schedule.geocode_status) || null,
        mapEligible: schedule.map_eligible !== false,
        liveFeedEligible: schedule.live_feed_eligible !== false,
        lastConfirmedAt: asIso(schedule.last_confirmed_at),
        createdAt: asIso(schedule.created_at),
        updatedAt: asIso(schedule.updated_at),
        isFuture: asBoolean(schedule.is_future),
        passesBasicStoredFilters: asBoolean(
          schedule.passes_basic_stored_filters,
        ),
      }));

      return {
        target,
        captureState: "captured",
        identity: {
          observedName: normalizedText(row.name),
          exactNameMatch: normalizedText(row.name) === target.name,
          owner: {
            subjectHash: ownerSubjectHash(row.owner_id),
            class: ownerClass(row),
            exists: asBoolean(row.owner_exists),
            userType: normalizedText(row.owner_user_type),
            isDisabled: asBoolean(row.owner_is_disabled),
            hasActivationSignal: hasOwnerActivation(row),
            createdAt: asIso(row.owner_created_at),
            updatedAt: asIso(row.owner_updated_at),
          },
          claim: {
            state: claimedState(row),
            hasImportLink: Boolean(
              normalizedText(row.claimed_from_import_id),
            ),
            importListingStatus:
              normalizedText(row.import_listing_status) || null,
            importListingSource:
              normalizedText(row.import_listing_source) || null,
            claimRequestCount: asCount(row.claim_request_count),
            approvedClaimRequestCount: asCount(
              row.approved_claim_request_count,
            ),
          },
        },
        classification: {
          expectation: target.classificationExpectation,
          observedBusinessType: normalizedText(row.business_type),
          observedIsFoodTruck: asBoolean(row.is_food_truck),
          derivedEntityType: entityType,
          requiresResolution:
            target.classificationExpectation === "unresolved" ||
            classificationConflict,
          classificationConflict,
        },
        state: {
          isActive: asBoolean(row.is_active),
          isVerified: asBoolean(row.is_verified),
          publicState: publicState(row),
          currentSitemapQueryEligible:
            asBoolean(row.is_active) && entityType === "truck",
        },
        routes: {
          idScopedCanonicalPath: `/${entityType}/${toSlug(row.name)}--${target.restaurantId}`,
          legacyIdPath: `/${entityType}/${target.restaurantId}`,
          bareSlugCandidatePath: `/${entityType}/${target.expectedSlug}`,
          cleanSlugOwnerships: ownedRoutes,
        },
        menu: {
          menuCount: asCount(menu.menu_count),
          activeMenuCount: asCount(menu.active_menu_count),
          menuItemCount: asCount(menu.menu_item_count),
          publicMenuItemCount: asCount(menu.public_menu_item_count),
          latestMenuUpdatedAt: asIso(menu.latest_menu_updated_at),
          latestMenuItemUpdatedAt: asIso(
            menu.latest_menu_item_updated_at,
          ),
          crossOwnerMenuItemCount,
          integrityState:
            crossOwnerMenuItemCount === 0
              ? "clear"
              : "blocked_cross_owner_menu_rows",
        },
        media: {
          hasProfileLogo: asBoolean(row.has_logo),
          hasProfileCover: asBoolean(row.has_cover),
          uploadCount: asCount(media.upload_count),
          logoUploadCount: asCount(media.logo_upload_count),
          coverUploadCount: asCount(media.cover_upload_count),
          galleryUploadCount: asCount(media.gallery_upload_count),
          storedGalleryCount: gallery.storedCount,
          publicApprovedGalleryCount: gallery.publicApprovedCount,
          latestUploadAt: asIso(media.latest_upload_at),
        },
        hours: {
          operatingHours: hours,
          slotCount: hoursSlotCount(hours),
        },
        manualSchedules: {
          totalCount: targetSchedules.length,
          futureCount: targetSchedules.filter((entry) => entry.isFuture)
            .length,
          passesBasicStoredFiltersCount: targetSchedules.filter(
            (entry) => entry.passesBasicStoredFilters,
          ).length,
          latestUpdatedAt:
            targetSchedules
              .map((entry) => entry.updatedAt)
              .filter(Boolean)
              .sort()
              .at(-1) || null,
          latestConfirmedAt:
            targetSchedules
              .map((entry) => entry.lastConfirmedAt)
              .filter(Boolean)
              .sort()
              .at(-1) || null,
          futureEntries: targetSchedules.filter((entry) => entry.isFuture),
          scoutEligibilityEvaluation: {
            state: "not_evaluated",
            reason:
              "The public operating-plan gate also evaluates confirmation freshness, timezone, slot windows, suppression, and geocoding; this capture records inputs without claiming Scout eligibility.",
          },
        },
        confirmedBookings: {
          bookingCount: asCount(bookingSummary.booking_count),
          confirmedBookingCount: asCount(
            bookingSummary.confirmed_booking_count,
          ),
          futureBookingCount: asCount(
            bookingSummary.future_booking_count,
          ),
          confirmedFutureBookingCount: asCount(
            bookingSummary.confirmed_future_booking_count,
          ),
          latestBookingUpdatedAt: asIso(
            bookingSummary.latest_booking_updated_at,
          ),
          latestEventConfirmedAt: asIso(
            bookingSummary.latest_event_confirmed_at,
          ),
          futureEntries: futureBookings.map((booking) => ({
            bookingId: normalizedText(booking.id),
            eventId: normalizedText(booking.event_id),
            bookingStatus: normalizedText(booking.booking_status),
            eventStatus: normalizedText(booking.event_status),
            eventType: normalizedText(booking.event_type),
            date: asIso(booking.date),
            startTime: normalizedText(booking.start_time) || null,
            endTime: normalizedText(booking.end_time) || null,
            bookingConfirmedAt: asIso(booking.booking_confirmed_at),
            eventLastConfirmedAt: asIso(booking.last_confirmed_at),
            createdAt: asIso(booking.created_at),
            updatedAt: asIso(booking.updated_at),
          })),
        },
        live: {
          mobileOnline: asBoolean(row.mobile_online),
          hasCompleteCurrentCoordinates:
            asBoolean(row.has_current_latitude) &&
            asBoolean(row.has_current_longitude),
          hasPartialCurrentCoordinates:
            asBoolean(row.has_current_latitude) !==
            asBoolean(row.has_current_longitude),
          lastBroadcastAt: asIso(row.last_broadcast_at),
          liveUntilAt: asIso(row.live_until_at),
        },
        evidenceReview: {
          reviewCount: asCount(evidenceReview.review_count),
          ownerApprovedCount: asCount(
            evidenceReview.owner_approved_count,
          ),
          productionAppliedCount: asCount(
            evidenceReview.production_applied_count,
          ),
          latestCapturedAt: asIso(evidenceReview.latest_captured_at),
          latestReviewedAt: asIso(evidenceReview.latest_reviewed_at),
          latestUpdatedAt: asIso(evidenceReview.latest_updated_at),
        },
        timestamps: {
          profileCreatedAt: asIso(row.profile_created_at),
          profileUpdatedAt: asIso(row.profile_updated_at),
          importListingCreatedAt: asIso(row.import_listing_created_at),
          importListingUpdatedAt: asIso(row.import_listing_updated_at),
        },
        duplicateDependencyAudit:
          explicitCandidateIds.length === 0
            ? {
                state: "not_applicable_no_explicit_candidate",
                explicitCandidateIds,
              }
            : target.restaurantId === FLORIDA_CANONICAL_ID
              ? {
                  state: "captured_in_floridaKitchenIdentityPair",
                  explicitCandidateIds,
                }
              : {
                  state: "not_evaluated",
                  explicitCandidateIds,
                  reason:
                    "This cohort baseline discovers identity and route conflicts, but only the first-priority Florida Kitchen pair receives full dependency enumeration in this lane.",
                },
        duplicateMatches,
        readiness:
          classificationConflict ||
          target.classificationExpectation === "unresolved" ||
          crossOwnerMenuItemCount > 0 ||
          duplicateMatches.length > 0
            ? "blocked_for_reconciliation"
            : "baseline_only_not_apply_authority",
      };
    });

    const missingTargetIds = targets
      .filter((target) => target.captureState !== "captured")
      .map((target) => target.target.restaurantId);
    const report = {
      schemaVersion: 1,
      artifactType: "curated_profile_cohort_read_only_baseline",
      declaredEnvironment,
      environmentProof: {
        declarationSource:
          declaredEnvironment === "production"
            ? "Render default runtime variables plus operator arguments"
            : "--environment operator argument",
        scriptLineageBaseCommit: BASELINE_SCRIPT_BASE_COMMIT,
        deployedCommit,
        renderRuntime: renderRuntimeProof
          ? {
              gitCommit: renderRuntimeProof.gitCommit,
              gitRepoSlug: renderRuntimeProof.gitRepoSlug,
              externalHostname: renderRuntimeProof.externalHostname,
              isPullRequest: renderRuntimeProof.isPullRequest,
            }
          : null,
        databaseIdentitySubjectHash: `sha256:${sha256(
          `mealscout-cohort-database-identity-v1:${databaseIdentity}`,
        )}`,
        warning:
          declaredEnvironment === "production"
            ? "The application revision and service identity are bound to Render runtime variables; review the database identity hash against the authorized connection record."
            : "The environment label is operator-declared; review the database identity hash against the authorized connection record.",
      },
      transaction: {
        isolationLevel: "REPEATABLE READ",
        accessMode: "READ ONLY",
        statementTimeout: "10s",
        lockTimeout: "2s",
        analyticsLookbackDays: ANALYTICS_LOOKBACK_DAYS,
        analyticsWindow: {
          startAt: asIso(clock?.analytics_window_start),
          endAt: asIso(clock?.analytics_window_end),
          databaseTimezone: normalizedText(clock?.database_timezone),
          historicalCoverage: "not_evaluated",
          authorization:
            "Recent analytics counts are reconciliation inputs only and do not authorize deletion or identity merge.",
        },
        observedIsolationLevel: normalizedText(
          clock?.transaction_isolation,
        ),
        observedReadOnly: normalizedText(clock?.transaction_read_only),
        capturedAt: asIso(clock?.captured_at),
        databaseDate: asIso(clock?.database_date),
      },
      registry: {
        path: REGISTRY_PATH,
        sha256: registrySha256,
        scope: registry.scope,
        canonicalTargetCount: registry.targets.length,
        duplicateCandidateCount: registry.duplicateCandidates.length,
        missingExplicitDuplicateCandidateIds,
        explicitExclusions: registry.explicitExclusions,
      },
      captureScript: {
        path: CAPTURE_SCRIPT_PATH,
        sha256: sha256(readFileSync(CAPTURE_SCRIPT_PATH, "utf8")),
      },
      sanitization: {
        ownerIdentifiers:
          "deterministic SHA-256 subjects scoped to this audit; raw owner IDs are omitted",
        ownerContactFields: "omitted",
        liveCoordinates:
          "presence flags only; raw current coordinates are omitted",
        manualStopAddresses: "omitted",
      },
      readiness: {
        state: "blocked_pending_review",
        reason:
          "This read-only capture is evidence for reconciliation planning, not mutation or release authority.",
        missingCanonicalTargetIds: missingTargetIds,
      },
      targets,
      floridaKitchenIdentityPair: {
        canonicalRestaurantId: FLORIDA_CANONICAL_ID,
        duplicateCandidateRestaurantId: FLORIDA_DUPLICATE_ID,
        dependencyCounts: floridaDependencies,
        mutationAuthorized: false,
      },
    };

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const displayPath = relative(process.cwd(), outputPath);
    console.log(
      JSON.stringify(
        {
          ok: true,
          output: displayPath,
          artifactSha256: sha256(readFileSync(outputPath, "utf8")),
          canonicalTargets: targets.length,
          missingCanonicalTargets: missingTargetIds.length,
          transaction: "REPEATABLE READ READ ONLY",
          readiness: "blocked_pending_review",
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    "captureCuratedProfileCohortBaseline failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
