import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { isLikelyTestBusiness } from "../server/utils/publicBusinessVisibility";

/**
 * Read-only report: which REAL (non-smoke, non-seed, non-test) business
 * accounts are missing pieces of a "stable baseline" profile - verification,
 * a menu, photos, hours, or (for food trucks) an active schedule.
 *
 * This makes no writes of any kind. It is the reporting half of the ~91
 * early-account audit lineage (see 596706fa and
 * scripts/backfillEarlyAccountTrials.ts) - it does not touch, decommission,
 * or flag any account for deletion. That is intentionally a separate,
 * higher-risk piece of work.
 *
 * Exclusions (durable markers only - see MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md):
 * - users.account_settings->>'smokeAccount' = 'true'
 * - owner email matching the documented smoke_*, *_smoke_*, smoke-* conventions
 * - the system-import placeholder owner (system-import@mealscout.us, override
 *   via IMPORT_SYSTEM_EMAIL) - unclaimed imports have no real owner to help yet
 * - restaurants where isLikelyTestBusiness() (the same function that already
 *   gates public visibility in production) returns true
 * - a known batch of 15 rows all created 2026-01-03 with zero owner telemetry
 *   events ever, named after nationally-famous chains (Kogi BBQ Truck, The
 *   Halal Guys NYC, In-N-Out Burger, etc.) that don't plausibly operate in
 *   this market - confirmed via engagement data as launch-day seed content,
 *   not real signups (see 2026-07-14 conversation record)
 * - obvious dev/QA fixture rows identified the same way: keyboard-mash names,
 *   an internal QA-sweep-named row, and the developer's own company name
 *   appearing as a personal test account
 *
 * Usage:
 *   npx tsx scripts/realAccountCompletenessReport.ts
 */

const SMOKE_EMAIL_PATTERN = /(^|[._-])smoke([._-]|$)/i;

// Exact, case-insensitive name match only - deliberately not a fuzzy heuristic.
// Each entry here was confirmed via the 2026-07-14 engagement-signal pass
// (owner telemetry event count + shared creation date), not guessed from the
// name alone. Do not add to this list without the same kind of evidence.
const KNOWN_SEED_OR_TEST_BUSINESS_NAMES = new Set(
  [
    // 2026-01-03 zero-engagement seed batch (famous chain names)
    "Kogi BBQ Truck",
    "Louisiana Po-Boy Express",
    "The Halal Guys NYC",
    "Al's Beef",
    "Café du Monde Hammond",
    "Franklin Barbecue",
    "Guelaguetza",
    "In-N-Out Burger",
    "Joe's Pizza NYC",
    "Katz's Delicatessen",
    "Lou Malnati's Pizzeria",
    "Pike Place Chowder",
    "Red Lobster Hammond",
    "The Original Ninfa's",
    "Versailles Restaurant",
    // Obvious dev/QA fixture rows
    "asdfasdfasdf",
    "asdfasfdasdfasdf",
    "Discoverability Flow 1777479688781-295625",
    "Sweep Fix Check Diner",
    "Traders Corner LLC",
  ].map((name) => name.toLowerCase()),
);

type Row = {
  restaurantId: string;
  name: string;
  businessType: string;
  isFoodTruck: boolean;
  isActive: boolean;
  isVerified: boolean;
  logoUrl: string | null;
  coverImageUrl: string | null;
  operatingHours: unknown;
  address: string | null;
  cuisineType: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  ownerDomain: string | null;
  accountSettings: Record<string, unknown> | null;
  menuItemCount: number;
  upcomingScheduleCount: number;
  restaurantCreatedAt: string | null;
  ownerCreatedAt: string | null;
  ownerTelemetryEventCount: number;
  ownerLoginEventCount: number;
};

function hasNonEmptyHours(operatingHours: unknown): boolean {
  if (!operatingHours || typeof operatingHours !== "object") return false;
  return Object.values(operatingHours as Record<string, unknown>).some(
    (day) => Array.isArray(day) && day.length > 0,
  );
}

function emailDomain(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1) : null;
}

async function main() {
  const importEmail = (
    process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us"
  ).toLowerCase();

  const result = await db.execute(sql`
    select
      r.id as restaurant_id,
      r.name,
      r.business_type,
      r.is_food_truck,
      r.is_active,
      r.is_verified,
      r.logo_url,
      r.cover_image_url,
      r.operating_hours,
      r.address,
      r.cuisine_type,
      r.description,
      r.city,
      r.state,
      u.id as owner_id,
      u.email as owner_email,
      u.first_name as owner_first_name,
      u.last_name as owner_last_name,
      u.account_settings,
      coalesce(mi.menu_item_count, 0) as menu_item_count,
      coalesce(sched.upcoming_schedule_count, 0) as upcoming_schedule_count,
      r.created_at as restaurant_created_at,
      u.created_at as owner_created_at,
      coalesce(tel.total_events, 0) as owner_telemetry_event_count,
      coalesce(tel.login_events, 0) as owner_login_event_count
    from restaurants r
    join users u on u.id = r.owner_id
    left join (
      select m.restaurant_id, count(mi.id)::int as menu_item_count
      from menus m
      join menu_items mi on mi.menu_id = m.id
      group by m.restaurant_id
    ) mi on mi.restaurant_id = r.id
    left join (
      select truck_id, count(*)::int as upcoming_schedule_count
      from truck_manual_schedules
      where date >= now() - interval '1 day'
      group by truck_id
    ) sched on sched.truck_id = r.id
    left join (
      select
        user_id,
        count(*)::int as total_events,
        count(*) filter (where event_name like 'auth_login%')::int as login_events
      from telemetry_events
      where user_id is not null
      group by user_id
    ) tel on tel.user_id = u.id
    order by r.name asc
  `);

  const rows = (result as any).rows as any[];

  const realRows: Row[] = [];
  let excludedSmoke = 0;
  let excludedSystemImport = 0;
  let excludedTestBusiness = 0;
  let excludedKnownSeedOrTest = 0;

  for (const raw of rows) {
    const ownerEmail = String(raw.owner_email || "").toLowerCase();
    const accountSettings = (raw.account_settings || null) as Record<
      string,
      unknown
    > | null;

    if (ownerEmail === importEmail) {
      excludedSystemImport += 1;
      continue;
    }
    if (accountSettings?.smokeAccount === true) {
      excludedSmoke += 1;
      continue;
    }
    if (SMOKE_EMAIL_PATTERN.test(ownerEmail.split("@")[0] || "")) {
      excludedSmoke += 1;
      continue;
    }
    if (
      isLikelyTestBusiness({
        name: raw.name,
        address: raw.address,
        cuisineType: raw.cuisine_type,
        description: raw.description,
        city: raw.city,
        state: raw.state,
      })
    ) {
      excludedTestBusiness += 1;
      continue;
    }
    if (KNOWN_SEED_OR_TEST_BUSINESS_NAMES.has(String(raw.name || "").toLowerCase())) {
      excludedKnownSeedOrTest += 1;
      continue;
    }

    realRows.push({
      restaurantId: String(raw.restaurant_id),
      name: raw.name,
      businessType: raw.business_type,
      isFoodTruck: Boolean(raw.is_food_truck),
      isActive: Boolean(raw.is_active),
      isVerified: Boolean(raw.is_verified),
      logoUrl: raw.logo_url,
      coverImageUrl: raw.cover_image_url,
      operatingHours: raw.operating_hours,
      address: raw.address,
      cuisineType: raw.cuisine_type,
      description: raw.description,
      city: raw.city,
      state: raw.state,
      ownerDomain: emailDomain(raw.owner_email),
      accountSettings,
      menuItemCount: Number(raw.menu_item_count || 0),
      upcomingScheduleCount: Number(raw.upcoming_schedule_count || 0),
      restaurantCreatedAt: raw.restaurant_created_at,
      ownerCreatedAt: raw.owner_created_at,
      ownerTelemetryEventCount: Number(raw.owner_telemetry_event_count || 0),
      ownerLoginEventCount: Number(raw.owner_login_event_count || 0),
    });
  }

  const graded = realRows.map((row) => {
    const missing: string[] = [];
    if (!row.isVerified) missing.push("verified");
    if (row.menuItemCount === 0) missing.push("menu");
    if (!row.logoUrl && !row.coverImageUrl) missing.push("photos");
    if (!hasNonEmptyHours(row.operatingHours)) missing.push("hours");
    if (row.isFoodTruck && row.upcomingScheduleCount === 0) {
      missing.push("schedule");
    }
    const applicableFieldCount = row.isFoodTruck ? 5 : 4;
    return {
      ...row,
      missing,
      completenessScore: `${applicableFieldCount - missing.length}/${applicableFieldCount}`,
    };
  });

  graded.sort((a, b) => b.missing.length - a.missing.length);

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = `backups/real-account-completeness-${stamp}.json`;
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        excluded: {
          smokeAccounts: excludedSmoke,
          systemImportOwned: excludedSystemImport,
          likelyTestBusiness: excludedTestBusiness,
          knownSeedOrTestBusinessName: excludedKnownSeedOrTest,
        },
        totalRealAccounts: graded.length,
        accounts: graded,
      },
      null,
      2,
    ),
    "utf8",
  );

  const fieldCounts: Record<string, number> = {
    verified: 0,
    menu: 0,
    photos: 0,
    hours: 0,
    schedule: 0,
  };
  for (const row of graded) {
    for (const field of row.missing) {
      fieldCounts[field] = (fieldCounts[field] || 0) + 1;
    }
  }
  const fullyComplete = graded.filter((r) => r.missing.length === 0).length;

  console.log(`[real-account-completeness] Report written: ${reportPath}`);
  console.log(
    `[real-account-completeness] Excluded: ${excludedSmoke} smoke-marked, ${excludedSystemImport} system-import-owned, ${excludedTestBusiness} likely-test-business, ${excludedKnownSeedOrTest} known seed/test business name.`,
  );
  console.log(
    `[real-account-completeness] Real accounts: ${graded.length}. Fully complete: ${fullyComplete}.`,
  );
  console.log(`[real-account-completeness] Missing counts:`, fieldCounts);
  console.log(
    `[real-account-completeness] Top incomplete (no contact info shown - see ${reportPath}):`,
  );
  for (const row of graded.slice(0, 20)) {
    if (row.missing.length === 0) break;
    console.log(
      `  - ${row.name} (${row.completenessScore}) missing: ${row.missing.join(", ")}`,
    );
  }

  const neverLoggedIn = graded.filter((r) => r.ownerLoginEventCount === 0);
  const neverAnyTelemetry = graded.filter(
    (r) => r.ownerTelemetryEventCount === 0,
  );
  console.log(
    `\n[real-account-completeness] Engagement signal (PII-free - name only, no owner identity):`,
  );
  console.log(
    `  ${neverLoggedIn.length}/${graded.length} owners have zero recorded auth_login_* telemetry events.`,
  );
  console.log(
    `  ${neverAnyTelemetry.length}/${graded.length} owners have zero telemetry events of any kind.`,
  );
  console.log(`  Never-logged-in accounts (by business name):`);
  for (const row of neverLoggedIn) {
    console.log(
      `    - ${row.name} (created ${String(row.restaurantCreatedAt || "").slice(0, 10)}, owner joined ${String(row.ownerCreatedAt || "").slice(0, 10)}, ${row.ownerTelemetryEventCount} total telemetry events)`,
    );
  }
}

main()
  .catch((err) => {
    console.error("[real-account-completeness] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
