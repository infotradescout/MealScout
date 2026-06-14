import "dotenv/config";
import { and, eq, gte, lte, or } from "drizzle-orm";

import { db, pool } from "../server/db";
import { restaurants, truckManualSchedules } from "../shared/schema";

const TRUCK_ID = "e77ac77a-c432-42d0-ac0f-22c48b6306c9";
const TRUCK_NAME = "Blessed Berry Bowls";
const SOURCE_ARTIFACT = "719523676_2163800804470829_7581408798811548725_n.jpg";
const SOURCE_TYPE = "uploaded_schedule_image";
const SCHEDULE_TYPE = "current_week_only";
const TIMEZONE = "America/Chicago";
const WEEK_START = "2026-06-15";
const WEEK_END = "2026-06-21";
const EXPIRES_AT = new Date("2026-06-22T00:00:00-05:00");

const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");

type ScheduleEvent = {
  date: string;
  status: "open" | "closed";
  locationName?: string;
  addressLine1?: string;
  city?: string | null;
  state?: string | null;
  startTimeLocal?: string;
  endTimeLocal?: string;
  note?: string;
  mapEligible: boolean;
  liveFeedEligible: boolean;
  geocodeStatus?: string;
};

const events: ScheduleEvent[] = [
  {
    date: "2026-06-15",
    status: "open",
    locationName: "The Tristan Apartments",
    addressLine1: "1559 W Nine Mile Rd.",
    city: null,
    state: "FL",
    startTimeLocal: "16:00",
    endTimeLocal: "19:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-16",
    status: "open",
    locationName: "Pruitt Health-Santa Rosa",
    addressLine1: "5530 Northrop Rd.",
    city: null,
    state: "FL",
    startTimeLocal: "11:00",
    endTimeLocal: "14:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-17",
    status: "open",
    locationName: "Century Health & Rehab",
    addressLine1: "6020 Industrial Blvd.",
    city: null,
    state: "FL",
    startTimeLocal: "11:00",
    endTimeLocal: "13:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-18",
    status: "open",
    locationName: "Escambia County Jail",
    addressLine1: "3080 N Pace Blvd.",
    city: "Pensacola",
    state: "FL",
    startTimeLocal: "11:00",
    endTimeLocal: "14:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-19",
    status: "open",
    locationName: "Community Health",
    addressLine1: "2315 W Jackson St.",
    city: "Pensacola",
    state: "FL",
    startTimeLocal: "11:00",
    endTimeLocal: "13:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-19",
    status: "open",
    locationName: "Molino Ballpark",
    addressLine1: "2340 Crabtree Church Rd.",
    city: "Molino",
    state: "FL",
    startTimeLocal: "16:00",
    endTimeLocal: "21:00",
    mapEligible: true,
    liveFeedEligible: true,
    geocodeStatus: "needs_geocode",
  },
  {
    date: "2026-06-20",
    status: "closed",
    mapEligible: false,
    liveFeedEligible: false,
  },
  {
    date: "2026-06-21",
    status: "closed",
    note: "Happy Father's Day",
    mapEligible: false,
    liveFeedEligible: false,
  },
];

const toDate = (date: string) => new Date(`${date}T00:00:00`);

const rows = events.map((event) => ({
  truckId: TRUCK_ID,
  date: toDate(event.date),
  startTime: event.status === "open" ? event.startTimeLocal : null,
  endTime: event.status === "open" ? event.endTimeLocal : null,
  locationName: event.locationName || null,
  address: event.addressLine1 || null,
  city: event.city ?? null,
  state: event.state ?? null,
  notes: event.note || null,
  isPublic: true,
  status: event.status,
  scheduleType: SCHEDULE_TYPE,
  timezone: TIMEZONE,
  sourceType: SOURCE_TYPE,
  sourceArtifact: SOURCE_ARTIFACT,
  sourceConfidence: "high",
  ownerSubmittedEquivalent: true,
  recurring: false,
  expiresAt: EXPIRES_AT,
  geocodeStatus: event.geocodeStatus || null,
  mapEligible: event.mapEligible,
  liveFeedEligible: event.liveFeedEligible,
}));

const run = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (apply && !allowProduction) {
    throw new Error("Production apply requires --allow-production.");
  }

  const [truck] = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.id, TRUCK_ID))
    .limit(1);

  if (!truck) throw new Error(`${TRUCK_NAME} row not found: ${TRUCK_ID}`);

  const existing = await db
    .select({
      id: truckManualSchedules.id,
      date: truckManualSchedules.date,
      status: truckManualSchedules.status,
      sourceType: truckManualSchedules.sourceType,
      sourceArtifact: truckManualSchedules.sourceArtifact,
      scheduleType: truckManualSchedules.scheduleType,
      locationName: truckManualSchedules.locationName,
    })
    .from(truckManualSchedules)
    .where(
      and(
        eq(truckManualSchedules.truckId, TRUCK_ID),
        gte(truckManualSchedules.date, toDate(WEEK_START)),
        lte(truckManualSchedules.date, toDate(WEEK_END)),
      ),
    );

  const managedExisting = existing.filter(
    (row) =>
      row.sourceArtifact === SOURCE_ARTIFACT ||
      row.sourceType === SOURCE_TYPE ||
      row.scheduleType === SCHEDULE_TYPE,
  );
  const unmanagedExisting = existing.filter(
    (row) => !managedExisting.some((managed) => managed.id === row.id),
  );

  if (unmanagedExisting.length > 0) {
    throw new Error(
      `Refusing to overwrite ${unmanagedExisting.length} unmanaged existing schedule row(s) for ${TRUCK_NAME}.`,
    );
  }

  if (apply) {
    await db.transaction(async (tx: any) => {
      if (managedExisting.length > 0) {
        await tx
          .delete(truckManualSchedules)
          .where(
            and(
              eq(truckManualSchedules.truckId, TRUCK_ID),
              gte(truckManualSchedules.date, toDate(WEEK_START)),
              lte(truckManualSchedules.date, toDate(WEEK_END)),
              or(
                eq(truckManualSchedules.sourceArtifact, SOURCE_ARTIFACT),
                eq(truckManualSchedules.sourceType, SOURCE_TYPE),
                eq(truckManualSchedules.scheduleType, SCHEDULE_TYPE),
              ),
            ),
          );
      }

      await tx.insert(truckManualSchedules).values(rows);
    });
  }

  const result = {
    lane: "blessed_berry_current_week_schedule_apply",
    mode: apply ? "apply" : "dry_run",
    truckId: TRUCK_ID,
    truckName: truck.name,
    weekStartDate: WEEK_START,
    weekEndDate: WEEK_END,
    timezone: TIMEZONE,
    sourceType: SOURCE_TYPE,
    sourceArtifact: SOURCE_ARTIFACT,
    recurring: false,
    rowsPrepared: rows.length,
    openStopsPrepared: rows.filter((row) => row.status === "open").length,
    closedDaysPrepared: rows.filter((row) => row.status === "closed").length,
    managedExistingRows: managedExisting.length,
    productionApplied: apply,
  };

  console.log(JSON.stringify(result, null, 2));
};

run()
  .catch((error) => {
    console.error("applyBlessedBerryCurrentWeekSchedule failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end?.();
  });
