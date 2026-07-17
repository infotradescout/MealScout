import "dotenv/config";

import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { restaurants } from "../shared/schema";

const TARGET_ID = "95c4e656-f3cc-46ab-ae18-53f549cecfd1";
const TARGET_NAME = "3D Eats & Tea";
const SOURCE_ARTIFACT =
  "docs/evidence/3d-eats-frui-tea-sauce-update-2026-07-17.json";
const PRODUCT_SENTENCE =
  "Features a small-batch FRUI-TEA BBQ sauce lineup in seven distinct flavors, available through the MessHaul Bus.";
const CUISINE_LABEL = "BBQ Sauces";

const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");

type JsonRecord = Record<string, unknown>;

const evidence = JSON.parse(
  readFileSync(SOURCE_ARTIFACT, "utf8"),
) as JsonRecord;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const appendProductSentence = (value: unknown) => {
  const current = String(value || "").trim();
  if (/FRUI-TEA BBQ sauce/i.test(current)) return current;
  if (!current) return `American food truck. ${PRODUCT_SENTENCE}`;
  return `${current.replace(/[.\s]+$/g, "")}. ${PRODUCT_SENTENCE}`;
};

const appendCuisineLabel = (value: unknown) => {
  const labels = String(value || "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  if (!labels.some((label) => label.toLowerCase() === CUISINE_LABEL.toLowerCase())) {
    labels.push(CUISINE_LABEL);
  }
  return labels.join(", ");
};

const buildRawData = (value: unknown, appliedAt: string) => {
  const current = asRecord(value);
  const productLines = asRecord(current.productLines);
  const adminReview = asRecord(current.adminReview);
  const reads = Array.isArray(current.appendOnlyProfileReads)
    ? [...current.appendOnlyProfileReads]
    : [];
  const alreadyRecorded = reads.some(
    (entry) => asRecord(entry).sourceArtifact === SOURCE_ARTIFACT,
  );

  if (!alreadyRecorded) {
    reads.push({
      source: "user_supplied_facebook_screenshots_2026_07_17",
      sourceArtifact: SOURCE_ARTIFACT,
      appliedAt,
      applyMode: "append_only_product_enrichment",
      classification: "sauce_not_drink",
      productLine: evidence.productLine,
      scheduleEvidence: evidence.scheduleEvidence,
      menuHandling:
        "No menu items created because the source has no prices and two flavor labels still require exact-name confirmation.",
    });
  }

  return {
    ...current,
    productLines: {
      ...productLines,
      fruiTeaBbqSauces: {
        ...asRecord(evidence.productLine),
        sourceArtifact: SOURCE_ARTIFACT,
        sourceCapturedAt: evidence.capturedAt,
        classification: "sauce_not_drink",
        lastAppliedAt: appliedAt,
      },
    },
    adminReview: {
      ...adminReview,
      fruiTeaSaucePricesMissing: true,
      fruiTeaRemainingFlavorNamesNeedConfirmation: true,
      fruiTeaThursdayStopsHistoricalOnly: true,
    },
    appendOnlyProfileReads: reads,
  };
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (apply && !allowProduction) {
    throw new Error("Production apply requires --allow-production.");
  }

  const [current] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      description: restaurants.description,
      cuisineType: restaurants.cuisineType,
      rawData: restaurants.rawData,
      updatedAt: restaurants.updatedAt,
    })
    .from(restaurants)
    .where(eq(restaurants.id, TARGET_ID))
    .limit(1);

  if (!current || current.name !== TARGET_NAME) {
    throw new Error(`Verified ${TARGET_NAME} profile was not found at ${TARGET_ID}.`);
  }

  const appliedAt = new Date().toISOString();
  const preview = {
    description: appendProductSentence(current.description),
    cuisineType: appendCuisineLabel(current.cuisineType),
    rawData: buildRawData(current.rawData, appliedAt),
  };

  if (apply) {
    await db.transaction(async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`restaurant:${TARGET_ID}`}))`,
      );

      const [locked] = await tx
        .select({
          id: restaurants.id,
          name: restaurants.name,
          description: restaurants.description,
          cuisineType: restaurants.cuisineType,
          rawData: restaurants.rawData,
        })
        .from(restaurants)
        .where(eq(restaurants.id, TARGET_ID))
        .limit(1);

      if (!locked || locked.name !== TARGET_NAME) {
        throw new Error(
          `Verified ${TARGET_NAME} profile changed or disappeared before apply.`,
        );
      }

      await tx
        .update(restaurants)
        .set({
          description: appendProductSentence(locked.description),
          cuisineType: appendCuisineLabel(locked.cuisineType),
          rawData: buildRawData(locked.rawData, appliedAt),
          updatedAt: new Date(appliedAt),
        })
        .where(eq(restaurants.id, TARGET_ID));
    });
  }

  console.log(
    JSON.stringify(
      {
        lane: "3d_eats_frui_tea_bbq_sauce_update",
        mode: apply ? "apply" : "dry_run",
        targetId: TARGET_ID,
        targetName: TARGET_NAME,
        sourceArtifact: SOURCE_ARTIFACT,
        before: {
          description: current.description,
          cuisineType: current.cuisineType,
          updatedAt: current.updatedAt,
        },
        after: {
          description: preview.description,
          cuisineType: preview.cuisineType,
          productCategory: "Sauces & Add-ons",
          flavorCount: 7,
          availability: "MessHaul Bus",
        },
        safeguards: {
          menuRowsCreated: 0,
          scheduleRowsCreated: 0,
          imageRowsCreated: 0,
          classification: "sauce_not_drink",
          transactionLock: "restaurant advisory lock",
        },
        productionApplied: apply,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("apply3dEatsFruiTeaSauceUpdate failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end?.();
  });
