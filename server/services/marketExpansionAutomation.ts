import { db } from "../db";
import { sql } from "drizzle-orm";

type MarketLifecycleStatus =
  | "seeded"
  | "filtered"
  | "scored"
  | "launch_ready"
  | "active"
  | "remediation_required"
  | "saturated";

type CityMetricsRow = {
  city: string;
  state: string;
  total_businesses: number;
  truck_total: number;
  active_truck_14d: number;
  independent_total: number;
  profile_ready_total: number;
};

type CountByCityRow = {
  city: string;
  state: string;
  count: number;
};

type DirectoryRow = {
  id: string;
  entityType: string;
  businessName: string;
  city: string | null;
  state: string | null;
  source: string | null;
  verificationStatus: string | null;
  qualityScore: number | null;
  servesFoodTrucks: boolean | null;
  isActive: boolean | null;
  tags: unknown;
  notes: string | null;
  updatedAt: Date | string | null;
};

type LifecycleRow = {
  city: string;
  state: string;
  corridor: string;
  seed_order: number;
  gate_status: string;
  gate_reasons: unknown;
  final_score: number;
  restaurants_total: number;
  status: MarketLifecycleStatus;
  ready_streak: number;
  blocked_streak: number;
  remediation_tasks: unknown;
};

type MarketExpansionJobRunRow = {
  id: string;
  job_name: string;
  status: string;
  batch_limit: number | null;
  evaluated_count: number;
  changed_count: number;
  duration_ms: number;
  details: unknown;
  error_message: string | null;
  started_at: Date | string;
  finished_at: Date | string;
};

type InitialOnboardingBatchOptions = {
  limitListings?: number;
  limitCities?: number;
  corridor?: string;
  markContacted?: boolean;
};

type OnboardingCandidateRow = {
  listingId: string;
  name: string;
  city: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  confidenceScore: number | null;
  corridor: string;
  seedOrder: number;
  lifecycleStatus: string;
};

type RecomputeOptions = {
  limitCities?: number;
  corridor?: string;
};

type StateTransitionOptions = {
  limitCities?: number;
  maxActivations?: number;
};

const CHAIN_TOKENS = [
  "mcdonald",
  "burger king",
  "wendy",
  "taco bell",
  "kfc",
  "subway",
  "pizza hut",
  "domino",
  "papa john",
  "chipotle",
  "chick-fil-a",
  "starbucks",
  "dunkin",
  "sonic",
  "arbys",
  "jack in the box",
  "whataburger",
  "little caesars",
  "popeyes",
  "panera",
];

const CORRIDOR_ORDER: Array<{ corridor: string; cities: Array<{ city: string; state: string }> }> = [
  {
    corridor: "pensacola_core",
    cities: [
      { city: "pensacola", state: "fl" },
      { city: "gulf breeze", state: "fl" },
      { city: "milton", state: "fl" },
      { city: "navarre", state: "fl" },
      { city: "pace", state: "fl" },
    ],
  },
  {
    corridor: "gulf_to_dallas",
    cities: [
      { city: "mobile", state: "al" },
      { city: "biloxi", state: "ms" },
      { city: "gulfport", state: "ms" },
      { city: "new orleans", state: "la" },
      { city: "baton rouge", state: "la" },
      { city: "lafayette", state: "la" },
      { city: "lake charles", state: "la" },
      { city: "beaumont", state: "tx" },
      { city: "houston", state: "tx" },
      { city: "dallas", state: "tx" },
      { city: "fort worth", state: "tx" },
    ],
  },
  {
    corridor: "east_coast_to_nj",
    cities: [
      { city: "jacksonville", state: "fl" },
      { city: "savannah", state: "ga" },
      { city: "charleston", state: "sc" },
      { city: "myrtle beach", state: "sc" },
      { city: "wilmington", state: "nc" },
      { city: "richmond", state: "va" },
      { city: "washington", state: "dc" },
      { city: "baltimore", state: "md" },
      { city: "philadelphia", state: "pa" },
      { city: "newark", state: "nj" },
      { city: "jersey city", state: "nj" },
    ],
  },
];

function normalizeLocationToken(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasChainToken(name: string) {
  const normalized = normalizeLocationToken(name);
  if (!normalized) return false;
  return CHAIN_TOKENS.some((token) => normalized.includes(token));
}

function buildCorridorLookup() {
  const lookup = new Map<string, { corridor: string; seedOrder: number }>();
  for (const group of CORRIDOR_ORDER) {
    group.cities.forEach((entry, index) => {
      lookup.set(`${entry.city}|${entry.state}`, {
        corridor: group.corridor,
        seedOrder: index + 1,
      });
    });
  }
  return lookup;
}

function corridorRank(corridor: string) {
  switch (corridor) {
    case "pensacola_core":
      return 1;
    case "gulf_to_dallas":
      return 2;
    case "east_coast_to_nj":
      return 3;
    default:
      return 4;
  }
}

function normalizeBatchLimit(value: unknown, fallback: number, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

async function recordMarketExpansionJobRun(input: {
  jobName: string;
  status: "ok" | "failed";
  batchLimit?: number | null;
  evaluatedCount?: number;
  changedCount?: number;
  durationMs?: number;
  details?: unknown;
  errorMessage?: string | null;
}) {
  try {
    await db.execute(sql`
      insert into market_expansion_job_runs (
        job_name,
        status,
        batch_limit,
        evaluated_count,
        changed_count,
        duration_ms,
        details,
        error_message,
        finished_at
      ) values (
        ${input.jobName},
        ${input.status},
        ${input.batchLimit ?? null},
        ${Math.max(0, Number(input.evaluatedCount || 0))},
        ${Math.max(0, Number(input.changedCount || 0))},
        ${Math.max(0, Number(input.durationMs || 0))},
        ${JSON.stringify(input.details || {})}::jsonb,
        ${input.errorMessage || null},
        now()
      )
    `);
  } catch (error) {
    console.warn("[market-expansion] failed to record job run", error);
  }
}

async function ensureExpansionTables() {
  await db.execute(sql`
    create table if not exists market_expansion_city_scores (
      id varchar primary key default gen_random_uuid(),
      city varchar not null,
      state varchar not null,
      corridor varchar not null default 'radiate',
      seed_order integer not null default 9999,
      restaurants_total integer not null default 0,
      trucks_total integer not null default 0,
      active_trucks_14d integer not null default 0,
      independent_ratio integer not null default 0,
      profile_ready_ratio integer not null default 0,
      demand_score integer not null default 0,
      partner_score integer not null default 0,
      truck_concentration_score integer not null default 0,
      freshness_score integer not null default 0,
      ops_score integer not null default 0,
      final_score integer not null default 0,
      gate_status varchar not null default 'blocked',
      gate_reasons jsonb not null default '[]'::jsonb,
      computed_at timestamp not null default now(),
      created_at timestamp not null default now(),
      updated_at timestamp not null default now(),
      unique(city, state)
    )
  `);

  await db.execute(sql`
    create table if not exists market_expansion_directory (
      id varchar primary key default gen_random_uuid(),
      entity_type varchar not null,
      business_name varchar not null,
      city varchar,
      state varchar,
      latitude numeric,
      longitude numeric,
      contact_phone varchar,
      contact_email varchar,
      website_url text,
      service_radius_miles integer,
      serves_food_trucks boolean not null default true,
      verification_status varchar not null default 'unverified',
      quality_score integer not null default 50,
      source varchar not null default 'manual',
      is_active boolean not null default true,
      tags jsonb not null default '[]'::jsonb,
      notes text,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    )
  `);

  await db.execute(sql`
    create table if not exists market_expansion_city_lifecycle (
      city varchar not null,
      state varchar not null,
      status varchar not null default 'seeded',
      ready_streak integer not null default 0,
      blocked_streak integer not null default 0,
      remediation_tasks jsonb not null default '[]'::jsonb,
      launched_at timestamp,
      last_transition_at timestamp,
      updated_at timestamp not null default now(),
      primary key (city, state)
    )
  `);

  await db.execute(sql`
    create table if not exists market_expansion_job_runs (
      id varchar primary key default gen_random_uuid(),
      job_name varchar not null,
      status varchar not null,
      batch_limit integer,
      evaluated_count integer not null default 0,
      changed_count integer not null default 0,
      duration_ms integer not null default 0,
      details jsonb not null default '{}'::jsonb,
      error_message text,
      started_at timestamp not null default now(),
      finished_at timestamp not null default now()
    )
  `);

  await db.execute(sql`
    create index if not exists idx_market_expansion_city_scores_final
      on market_expansion_city_scores (corridor, seed_order, final_score desc)
  `);

  await db.execute(sql`
    create index if not exists idx_market_expansion_directory_city
      on market_expansion_directory (entity_type, state, city)
  `);

  await db.execute(sql`
    create index if not exists idx_market_expansion_city_lifecycle_status
      on market_expansion_city_lifecycle (status, updated_at desc)
  `);

  await db.execute(sql`
    create index if not exists idx_market_expansion_job_runs_lookup
      on market_expansion_job_runs (job_name, finished_at desc)
  `);
}

async function getCityMetrics(): Promise<CityMetricsRow[]> {
  const result = await db.execute(sql<CityMetricsRow>`
    select
      lower(trim(coalesce(r.city, ''))) as city,
      lower(trim(coalesce(r.state, ''))) as state,
      count(*)::int as total_businesses,
      coalesce(sum(case when r.business_type = 'food_truck' or coalesce(r.is_food_truck, false) = true then 1 else 0 end), 0)::int as truck_total,
      coalesce(sum(case when (r.business_type = 'food_truck' or coalesce(r.is_food_truck, false) = true) and coalesce(r.last_broadcast_at, r.updated_at, r.created_at) >= now() - interval '14 days' then 1 else 0 end), 0)::int as active_truck_14d,
      coalesce(sum(case when lower(coalesce(r.name, '')) like any(array[
        '%mcdonald%', '%burger king%', '%wendy%', '%taco bell%', '%kfc%', '%subway%',
        '%pizza hut%', '%domino%', '%papa john%', '%chipotle%', '%chick-fil-a%', '%starbucks%',
        '%dunkin%', '%sonic%', '%arbys%', '%jack in the box%', '%whataburger%',
        '%little caesars%', '%popeyes%', '%panera%'
      ]) then 0 else 1 end), 0)::int as independent_total,
      coalesce(sum(case when (
        (r.description is not null and length(trim(r.description)) >= 30) and
        (
          (r.website_url is not null and length(trim(r.website_url)) > 0) or
          (r.instagram_url is not null and length(trim(r.instagram_url)) > 0) or
          (r.facebook_page_url is not null and length(trim(r.facebook_page_url)) > 0) or
          (r.x_url is not null and length(trim(r.x_url)) > 0)
        )
      ) then 1 else 0 end), 0)::int as profile_ready_total
    from restaurants r
    where
      coalesce(r.is_active, true) = true and
      trim(coalesce(r.city, '')) <> '' and
      trim(coalesce(r.state, '')) <> ''
    group by 1, 2
  `);

  return ((result as any)?.rows || []) as CityMetricsRow[];
}

async function getRecommendationDemandByCity(): Promise<Map<string, number>> {
  const result = await db.execute(sql<CountByCityRow>`
    select
      lower(trim(coalesce(r.city, ''))) as city,
      lower(trim(coalesce(r.state, ''))) as state,
      count(*)::int as count
    from restaurant_user_recommendations rur
    inner join restaurants r on r.id = rur.restaurant_id
    where
      coalesce(r.is_active, true) = true and
      trim(coalesce(r.city, '')) <> '' and
      trim(coalesce(r.state, '')) <> '' and
      rur.created_at >= now() - interval '30 days'
    group by 1, 2
  `);

  const out = new Map<string, number>();
  for (const row of ((result as any)?.rows || []) as CountByCityRow[]) {
    out.set(`${normalizeLocationToken(row.city)}|${normalizeLocationToken(row.state)}`, Number(row.count) || 0);
  }
  return out;
}

async function getPartnerCountsByCity(): Promise<Map<string, number>> {
  const supplierResult = await db.execute(sql<CountByCityRow>`
    select
      lower(trim(coalesce(s.city, ''))) as city,
      lower(trim(coalesce(s.state, ''))) as state,
      count(*)::int as count
    from suppliers s
    where
      coalesce(s.is_active, true) = true and
      trim(coalesce(s.city, '')) <> '' and
      trim(coalesce(s.state, '')) <> ''
    group by 1, 2
  `);

  const directoryResult = await db.execute(sql<CountByCityRow>`
    select
      lower(trim(coalesce(d.city, ''))) as city,
      lower(trim(coalesce(d.state, ''))) as state,
      count(*)::int as count
    from market_expansion_directory d
    where
      coalesce(d.is_active, true) = true and
      trim(coalesce(d.city, '')) <> '' and
      trim(coalesce(d.state, '')) <> '' and
      d.entity_type in ('supplier', 'commissary_kitchen', 'delivery_service')
    group by 1, 2
  `);

  const out = new Map<string, number>();
  for (const row of ((supplierResult as any)?.rows || []) as CountByCityRow[]) {
    const key = `${normalizeLocationToken(row.city)}|${normalizeLocationToken(row.state)}`;
    out.set(key, (out.get(key) || 0) + (Number(row.count) || 0));
  }
  for (const row of ((directoryResult as any)?.rows || []) as CountByCityRow[]) {
    const key = `${normalizeLocationToken(row.city)}|${normalizeLocationToken(row.state)}`;
    out.set(key, (out.get(key) || 0) + (Number(row.count) || 0));
  }
  return out;
}

function computeGateStatus(input: {
  trucksTotal: number;
  freshnessScore: number;
  independentRatio: number;
  profileReadyRatio: number;
}): { status: "ready" | "blocked"; reasons: string[] } {
  const reasons: string[] = [];
  if (input.trucksTotal < 10) reasons.push("insufficient_truck_density");
  if (input.freshnessScore < 60) reasons.push("truck_freshness_below_threshold");
  if (input.independentRatio < 70) reasons.push("independent_ratio_below_threshold");
  if (input.profileReadyRatio < 40) reasons.push("profile_readiness_below_threshold");
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasons,
  };
}

function parseGateReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildRemediationTasks(gateReasons: string[]) {
  const unique = Array.from(new Set(gateReasons));
  const tasks = unique.map((reason) => {
    switch (reason) {
      case "insufficient_truck_density":
        return {
          reason,
          title: "Increase truck density",
          owner: "growth_ops",
          action:
            "Run focused truck claim campaign and host-location outreach in this city for 2 weeks.",
        };
      case "truck_freshness_below_threshold":
        return {
          reason,
          title: "Improve truck freshness",
          owner: "activation_ops",
          action:
            "Push schedule/live-status activation and autopost onboarding for currently claimed trucks.",
        };
      case "independent_ratio_below_threshold":
        return {
          reason,
          title: "Review chain exclusion",
          owner: "admin_ops",
          action:
            "Run chain exclusion review queue and apply manual allow/exclude overrides.",
        };
      case "profile_readiness_below_threshold":
        return {
          reason,
          title: "Raise profile readiness",
          owner: "success_ops",
          action:
            "Complete profile enrichment for top businesses (description + social or website).",
        };
      default:
        return {
          reason,
          title: "Investigate gate blocker",
          owner: "growth_ops",
          action: "Review city scorecard and resolve blocker.",
        };
    }
  });

  return tasks;
}

export async function runMarketExpansionScoreRecompute(options?: RecomputeOptions) {
  await ensureExpansionTables();
  const startedAt = Date.now();
  const batchLimit = normalizeBatchLimit(options?.limitCities, 120, 1000);
  const corridorFilter = normalizeLocationToken(options?.corridor || "");

  const corridorLookup = buildCorridorLookup();
  const [cityMetrics, demandMap, partnerMap] = await Promise.all([
    getCityMetrics(),
    getRecommendationDemandByCity(),
    getPartnerCountsByCity(),
  ]);

  const filteredMetrics = cityMetrics
    .filter((row) => {
      if (!corridorFilter) return true;
      const key = `${normalizeLocationToken(row.city)}|${normalizeLocationToken(row.state)}`;
      const corridor = corridorLookup.get(key)?.corridor || "radiate";
      return corridor === corridorFilter;
    })
    .sort((a, b) => {
      const keyA = `${normalizeLocationToken(a.city)}|${normalizeLocationToken(a.state)}`;
      const keyB = `${normalizeLocationToken(b.city)}|${normalizeLocationToken(b.state)}`;
      const infoA = corridorLookup.get(keyA);
      const infoB = corridorLookup.get(keyB);
      const rankDiff = corridorRank(infoA?.corridor || "radiate") - corridorRank(infoB?.corridor || "radiate");
      if (rankDiff !== 0) return rankDiff;
      const seedDiff = (infoA?.seedOrder || 9999) - (infoB?.seedOrder || 9999);
      if (seedDiff !== 0) return seedDiff;
      return keyA.localeCompare(keyB);
    })
    .slice(0, batchLimit);

  let upserted = 0;
  for (const row of filteredMetrics) {
    const city = normalizeLocationToken(row.city);
    const state = normalizeLocationToken(row.state);
    if (!city || !state) continue;

    const key = `${city}|${state}`;
    const knownCorridor = corridorLookup.get(key);

    const totalBusinesses = Math.max(0, Number(row.total_businesses) || 0);
    const trucksTotal = Math.max(0, Number(row.truck_total) || 0);
    const activeTruck14d = Math.max(0, Number(row.active_truck_14d) || 0);
    const independentTotal = Math.max(0, Number(row.independent_total) || 0);
    const profileReadyTotal = Math.max(0, Number(row.profile_ready_total) || 0);

    const truckConcentrationScore = clampScore(
      (trucksTotal / Math.max(1, totalBusinesses)) * 140,
    );
    const freshnessScore = clampScore(
      (activeTruck14d / Math.max(1, trucksTotal)) * 100,
    );
    const independentRatio = clampScore(
      (independentTotal / Math.max(1, totalBusinesses)) * 100,
    );
    const profileReadyRatio = clampScore(
      (profileReadyTotal / Math.max(1, totalBusinesses)) * 100,
    );

    const rawDemand = Number(demandMap.get(key) || 0);
    const demandScore = clampScore((rawDemand / Math.max(1, totalBusinesses)) * 800);

    const rawPartners = Number(partnerMap.get(key) || 0);
    const partnerScore = clampScore((rawPartners / Math.max(1, totalBusinesses)) * 200);

    const opsScore = profileReadyRatio;

    const finalScore = clampScore(
      truckConcentrationScore * 0.35 +
        freshnessScore * 0.2 +
        independentRatio * 0.15 +
        demandScore * 0.1 +
        partnerScore * 0.1 +
        opsScore * 0.1,
    );

    const gate = computeGateStatus({
      trucksTotal,
      freshnessScore,
      independentRatio,
      profileReadyRatio,
    });

    await db.execute(sql`
      insert into market_expansion_city_scores (
        city,
        state,
        corridor,
        seed_order,
        restaurants_total,
        trucks_total,
        active_trucks_14d,
        independent_ratio,
        profile_ready_ratio,
        demand_score,
        partner_score,
        truck_concentration_score,
        freshness_score,
        ops_score,
        final_score,
        gate_status,
        gate_reasons,
        computed_at,
        updated_at
      )
      values (
        ${city},
        ${state},
        ${knownCorridor?.corridor || "radiate"},
        ${knownCorridor?.seedOrder || 9999},
        ${totalBusinesses},
        ${trucksTotal},
        ${activeTruck14d},
        ${independentRatio},
        ${profileReadyRatio},
        ${demandScore},
        ${partnerScore},
        ${truckConcentrationScore},
        ${freshnessScore},
        ${opsScore},
        ${finalScore},
        ${gate.status},
        ${JSON.stringify(gate.reasons)}::jsonb,
        now(),
        now()
      )
      on conflict (city, state)
      do update set
        corridor = excluded.corridor,
        seed_order = excluded.seed_order,
        restaurants_total = excluded.restaurants_total,
        trucks_total = excluded.trucks_total,
        active_trucks_14d = excluded.active_trucks_14d,
        independent_ratio = excluded.independent_ratio,
        profile_ready_ratio = excluded.profile_ready_ratio,
        demand_score = excluded.demand_score,
        partner_score = excluded.partner_score,
        truck_concentration_score = excluded.truck_concentration_score,
        freshness_score = excluded.freshness_score,
        ops_score = excluded.ops_score,
        final_score = excluded.final_score,
        gate_status = excluded.gate_status,
        gate_reasons = excluded.gate_reasons,
        computed_at = excluded.computed_at,
        updated_at = excluded.updated_at
    `);

    await db.execute(sql`
      insert into market_expansion_city_lifecycle (city, state, status, updated_at)
      values (${city}, ${state}, 'seeded', now())
      on conflict (city, state) do nothing
    `);

    upserted += 1;
  }

  const durationMs = Date.now() - startedAt;
  await recordMarketExpansionJobRun({
    jobName: "recompute",
    status: "ok",
    batchLimit,
    evaluatedCount: filteredMetrics.length,
    changedCount: upserted,
    durationMs,
    details: {
      corridorFilter: corridorFilter || null,
      sourceTotalCities: cityMetrics.length,
    },
  });

  return {
    ok: true,
    upserted,
    evaluated: filteredMetrics.length,
    durationMs,
    batchLimit,
    sourceTotalCities: cityMetrics.length,
  };
}

export async function listMarketExpansionQueue(limit = 100) {
  await ensureExpansionTables();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));

  const result = await db.execute(sql`
    select
      s.city,
      s.state,
      s.corridor,
      s.seed_order,
      s.restaurants_total,
      s.trucks_total,
      s.active_trucks_14d,
      s.independent_ratio,
      s.profile_ready_ratio,
      s.demand_score,
      s.partner_score,
      s.truck_concentration_score,
      s.freshness_score,
      s.ops_score,
      s.final_score,
      s.gate_status,
      s.gate_reasons,
      s.computed_at,
      coalesce(l.status, 'seeded') as status,
      coalesce(l.ready_streak, 0) as ready_streak,
      coalesce(l.blocked_streak, 0) as blocked_streak,
      coalesce(l.remediation_tasks, '[]'::jsonb) as remediation_tasks,
      l.launched_at,
      l.last_transition_at
    from market_expansion_city_scores s
    left join market_expansion_city_lifecycle l
      on l.city = s.city and l.state = s.state
    order by
      case s.corridor
        when 'pensacola_core' then 1
        when 'gulf_to_dallas' then 2
        when 'east_coast_to_nj' then 3
        else 4
      end,
      s.seed_order asc,
      s.final_score desc,
      s.city asc
    limit ${safeLimit}
  `);

  return ((result as any)?.rows || []) as Array<Record<string, unknown>>;
}

export async function listMarketExpansionLifecycle(limit = 200) {
  await ensureExpansionTables();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const result = await db.execute(sql`
    select
      s.city,
      s.state,
      s.corridor,
      s.seed_order,
      s.final_score,
      s.gate_status,
      s.gate_reasons,
      coalesce(l.status, 'seeded') as status,
      coalesce(l.ready_streak, 0) as ready_streak,
      coalesce(l.blocked_streak, 0) as blocked_streak,
      coalesce(l.remediation_tasks, '[]'::jsonb) as remediation_tasks,
      l.launched_at,
      l.last_transition_at,
      l.updated_at
    from market_expansion_city_scores s
    left join market_expansion_city_lifecycle l
      on l.city = s.city and l.state = s.state
    order by
      case s.corridor
        when 'pensacola_core' then 1
        when 'gulf_to_dallas' then 2
        when 'east_coast_to_nj' then 3
        else 4
      end,
      s.seed_order asc,
      s.final_score desc,
      s.city asc
    limit ${safeLimit}
  `);
  return ((result as any)?.rows || []) as Array<Record<string, unknown>>;
}

export async function runMarketExpansionStateTransition(options?: StateTransitionOptions) {
  await ensureExpansionTables();
  const startedAt = Date.now();
  const batchLimit = normalizeBatchLimit(options?.limitCities, 80, 1000);
  const maxActivations = normalizeBatchLimit(options?.maxActivations, 1, 25);

  const result = await db.execute(sql<LifecycleRow>`
    select
      s.city,
      s.state,
      s.corridor,
      s.seed_order,
      s.gate_status,
      s.gate_reasons,
      s.final_score,
      s.restaurants_total,
      coalesce(l.status, 'seeded') as status,
      coalesce(l.ready_streak, 0) as ready_streak,
      coalesce(l.blocked_streak, 0) as blocked_streak,
      coalesce(l.remediation_tasks, '[]'::jsonb) as remediation_tasks
    from market_expansion_city_scores s
    left join market_expansion_city_lifecycle l
      on l.city = s.city and l.state = s.state
    order by
      case s.corridor
        when 'pensacola_core' then 1
        when 'gulf_to_dallas' then 2
        when 'east_coast_to_nj' then 3
        else 4
      end,
      s.seed_order asc,
      s.final_score desc,
      s.city asc
  `);

  const rows = (((result as any)?.rows || []) as LifecycleRow[]).slice(0, batchLimit);
  let transitioned = 0;
  let activated = 0;
  let remediationRaised = 0;
  const finalStatuses: MarketLifecycleStatus[] = [];
  let activationUsed = false;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const gateReady = String(row.gate_status) === "ready";
    const gateReasons = parseGateReasons(row.gate_reasons);
    const nextReadyStreak = gateReady ? Number(row.ready_streak || 0) + 1 : 0;
    const nextBlockedStreak = gateReady ? 0 : Number(row.blocked_streak || 0) + 1;

    let nextStatus = (row.status || "seeded") as MarketLifecycleStatus;
    let transitionOccurred = false;
    let launchedAtSql = sql`null`;
    let lastTransitionAtSql = sql`null`;

    if (nextStatus === "seeded" && Number(row.restaurants_total || 0) > 0) {
      nextStatus = "filtered";
      transitionOccurred = true;
    }
    if (nextStatus === "filtered" && Number(row.final_score || 0) >= 0) {
      nextStatus = "scored";
      transitionOccurred = true;
    }
    if (nextStatus === "scored" && gateReady && nextReadyStreak >= 2) {
      nextStatus = "launch_ready";
      transitionOccurred = true;
    }

    const predecessorsReady = finalStatuses.every(
      (status) => status === "active" || status === "saturated",
    );
    if (
      nextStatus === "launch_ready" &&
      gateReady &&
      nextReadyStreak >= 2 &&
      predecessorsReady &&
      (!activationUsed || activated < maxActivations)
    ) {
      nextStatus = "active";
      transitionOccurred = true;
      activationUsed = true;
      activated += 1;
      launchedAtSql = sql`coalesce((select launched_at from market_expansion_city_lifecycle where city = ${row.city} and state = ${row.state}), now())`;
    }

    if (nextStatus === "launch_ready" && !gateReady && nextBlockedStreak >= 2) {
      nextStatus = "scored";
      transitionOccurred = true;
    }

    if (nextStatus === "active" && !gateReady && nextBlockedStreak >= 2) {
      nextStatus = "remediation_required";
      transitionOccurred = true;
      remediationRaised += 1;
    }

    if (nextStatus === "remediation_required" && gateReady && nextReadyStreak >= 2) {
      nextStatus = "active";
      transitionOccurred = true;
    }

    if (nextStatus === "active" && gateReady && nextReadyStreak >= 8) {
      nextStatus = "saturated";
      transitionOccurred = true;
    }

    if (transitionOccurred) {
      transitioned += 1;
      lastTransitionAtSql = sql`now()`;
    }

    const remediationTasks =
      nextStatus === "remediation_required"
        ? buildRemediationTasks(gateReasons)
        : [];

    await db.execute(sql`
      insert into market_expansion_city_lifecycle (
        city,
        state,
        status,
        ready_streak,
        blocked_streak,
        remediation_tasks,
        launched_at,
        last_transition_at,
        updated_at
      )
      values (
        ${row.city},
        ${row.state},
        ${nextStatus},
        ${nextReadyStreak},
        ${nextBlockedStreak},
        ${JSON.stringify(remediationTasks)}::jsonb,
        ${launchedAtSql},
        ${lastTransitionAtSql},
        now()
      )
      on conflict (city, state)
      do update set
        status = excluded.status,
        ready_streak = excluded.ready_streak,
        blocked_streak = excluded.blocked_streak,
        remediation_tasks = excluded.remediation_tasks,
        launched_at = coalesce(market_expansion_city_lifecycle.launched_at, excluded.launched_at),
        last_transition_at = coalesce(excluded.last_transition_at, market_expansion_city_lifecycle.last_transition_at),
        updated_at = excluded.updated_at
    `);

    finalStatuses.push(nextStatus);
  }

  const durationMs = Date.now() - startedAt;
  await recordMarketExpansionJobRun({
    jobName: "state_transition",
    status: "ok",
    batchLimit,
    evaluatedCount: rows.length,
    changedCount: transitioned,
    durationMs,
    details: {
      maxActivations,
      activated,
      remediationRaised,
    },
  });

  return {
    ok: true,
    evaluated: rows.length,
    transitioned,
    activated,
    remediationRaised,
    durationMs,
    batchLimit,
    maxActivations,
  };
}

export async function upsertMarketDirectoryEntry(input: {
  id?: string;
  entityType: string;
  businessName: string;
  city?: string | null;
  state?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  websiteUrl?: string | null;
  serviceRadiusMiles?: number | null;
  servesFoodTrucks?: boolean;
  verificationStatus?: string | null;
  qualityScore?: number | null;
  source?: string | null;
  isActive?: boolean;
  tags?: unknown;
  notes?: string | null;
}) {
  await ensureExpansionTables();

  const id = String(input.id || "").trim();
  const entityType = String(input.entityType || "").trim().toLowerCase();
  const businessName = String(input.businessName || "").trim();
  if (!entityType || !businessName) {
    throw new Error("entityType and businessName are required");
  }

  const qualityScore = clampScore(Number(input.qualityScore ?? 50));

  if (id) {
    await db.execute(sql`
      update market_expansion_directory
      set
        entity_type = ${entityType},
        business_name = ${businessName},
        city = ${input.city || null},
        state = ${input.state || null},
        contact_phone = ${input.contactPhone || null},
        contact_email = ${input.contactEmail || null},
        website_url = ${input.websiteUrl || null},
        service_radius_miles = ${input.serviceRadiusMiles ?? null},
        serves_food_trucks = ${input.servesFoodTrucks !== false},
        verification_status = ${input.verificationStatus || "unverified"},
        quality_score = ${qualityScore},
        source = ${input.source || "manual"},
        is_active = ${input.isActive !== false},
        tags = ${JSON.stringify(input.tags || [])}::jsonb,
        notes = ${input.notes || null},
        updated_at = now()
      where id = ${id}
    `);
    return { id, updated: true };
  }

  const inserted = await db.execute(sql<{ id: string }>`
    insert into market_expansion_directory (
      entity_type,
      business_name,
      city,
      state,
      contact_phone,
      contact_email,
      website_url,
      service_radius_miles,
      serves_food_trucks,
      verification_status,
      quality_score,
      source,
      is_active,
      tags,
      notes,
      updated_at
    ) values (
      ${entityType},
      ${businessName},
      ${input.city || null},
      ${input.state || null},
      ${input.contactPhone || null},
      ${input.contactEmail || null},
      ${input.websiteUrl || null},
      ${input.serviceRadiusMiles ?? null},
      ${input.servesFoodTrucks !== false},
      ${input.verificationStatus || "unverified"},
      ${qualityScore},
      ${input.source || "manual"},
      ${input.isActive !== false},
      ${JSON.stringify(input.tags || [])}::jsonb,
      ${input.notes || null},
      now()
    )
    returning id
  `);

  const insertedId = String(((inserted as any)?.rows || [])[0]?.id || "").trim();
  return { id: insertedId, created: true };
}

export async function listMarketDirectory(params?: {
  entityType?: string;
  state?: string;
  city?: string;
  limit?: number;
}) {
  await ensureExpansionTables();

  const entityType = normalizeLocationToken(params?.entityType || "");
  const state = normalizeLocationToken(params?.state || "");
  const city = normalizeLocationToken(params?.city || "");
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params?.limit || 100))));

  const result = await db.execute(sql<DirectoryRow>`
    select
      d.id,
      d.entity_type as "entityType",
      d.business_name as "businessName",
      d.city,
      d.state,
      d.source,
      d.verification_status as "verificationStatus",
      d.quality_score as "qualityScore",
      d.serves_food_trucks as "servesFoodTrucks",
      d.is_active as "isActive",
      d.tags,
      d.notes,
      d.updated_at as "updatedAt"
    from market_expansion_directory d
    where
      (${entityType} = '' or lower(d.entity_type) = ${entityType}) and
      (${state} = '' or lower(coalesce(d.state, '')) = ${state}) and
      (${city} = '' or lower(coalesce(d.city, '')) = ${city})
    order by d.quality_score desc, d.updated_at desc
    limit ${limit}
  `);

  return ((result as any)?.rows || []) as DirectoryRow[];
}

export async function summarizeFastFoodChainPresence(limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.execute(sql<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    business_type: string | null;
  }>`
    select
      r.id,
      r.name,
      r.city,
      r.state,
      r.business_type
    from restaurants r
    where
      coalesce(r.is_active, true) = true and
      trim(coalesce(r.city, '')) <> '' and
      trim(coalesce(r.state, '')) <> ''
    order by coalesce(r.updated_at, r.created_at) desc
    limit ${Math.max(500, safeLimit * 5)}
  `);

  const items = (((rows as any)?.rows || []) as Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    business_type: string | null;
  }>).filter((row) => hasChainToken(row.name));

  return items.slice(0, safeLimit);
}

export async function listMarketExpansionUsage(params?: {
  jobName?: string;
  limit?: number;
}) {
  await ensureExpansionTables();
  const jobName = normalizeLocationToken(params?.jobName || "");
  const limit = Math.max(1, Math.min(500, Math.floor(Number(params?.limit || 120))));

  const result = await db.execute(sql<MarketExpansionJobRunRow>`
    select
      id,
      job_name,
      status,
      batch_limit,
      evaluated_count,
      changed_count,
      duration_ms,
      details,
      error_message,
      started_at,
      finished_at
    from market_expansion_job_runs
    where (${jobName} = '' or lower(job_name) = ${jobName})
    order by finished_at desc
    limit ${limit}
  `);

  const rows = ((result as any)?.rows || []) as MarketExpansionJobRunRow[];
  const aggregate = rows.reduce(
    (acc, row) => {
      acc.totalRuns += 1;
      acc.totalEvaluated += Number(row.evaluated_count || 0);
      acc.totalChanged += Number(row.changed_count || 0);
      acc.totalDurationMs += Number(row.duration_ms || 0);
      if (String(row.status || "") !== "ok") acc.failedRuns += 1;
      return acc;
    },
    {
      totalRuns: 0,
      failedRuns: 0,
      totalEvaluated: 0,
      totalChanged: 0,
      totalDurationMs: 0,
    },
  );

  return {
    rows,
    aggregate: {
      ...aggregate,
      avgDurationMs:
        aggregate.totalRuns > 0
          ? Math.round(aggregate.totalDurationMs / aggregate.totalRuns)
          : 0,
      avgEvaluatedPerRun:
        aggregate.totalRuns > 0
          ? Math.round(aggregate.totalEvaluated / aggregate.totalRuns)
          : 0,
      avgChangedPerRun:
        aggregate.totalRuns > 0
          ? Math.round(aggregate.totalChanged / aggregate.totalRuns)
          : 0,
    },
  };
}

export async function createInitialOnboardingBatch(
  options?: InitialOnboardingBatchOptions,
) {
  await ensureExpansionTables();
  const startedAt = Date.now();
  const limitListings = normalizeBatchLimit(options?.limitListings, 60, 500);
  const limitCities = normalizeBatchLimit(options?.limitCities, 6, 50);
  const corridorFilter = normalizeLocationToken(options?.corridor || "");
  const markContacted = options?.markContacted !== false;

  const candidateRows = await db.execute(sql<OnboardingCandidateRow>`
    with city_scope as (
      select
        s.city,
        s.state,
        s.corridor,
        s.seed_order,
        coalesce(l.status, 'seeded') as lifecycle_status
      from market_expansion_city_scores s
      left join market_expansion_city_lifecycle l
        on l.city = s.city and l.state = s.state
      where
        (${corridorFilter} = '' or lower(s.corridor) = ${corridorFilter}) and
        coalesce(l.status, 'seeded') in ('launch_ready', 'active', 'remediation_required')
      order by
        case s.corridor
          when 'pensacola_core' then 1
          when 'gulf_to_dallas' then 2
          when 'east_coast_to_nj' then 3
          else 4
        end,
        s.seed_order asc,
        s.final_score desc
      limit ${limitCities}
    )
    select
      t.id as "listingId",
      t.name,
      t.city,
      t.state,
      t.email,
      t.phone,
      t.external_id as "externalId",
      t.confidence_score as "confidenceScore",
      c.corridor,
      c.seed_order as "seedOrder",
      c.lifecycle_status as "lifecycleStatus"
    from city_scope c
    inner join truck_import_listings t
      on lower(trim(coalesce(t.city, ''))) = c.city
      and lower(trim(coalesce(t.state, ''))) = c.state
    where
      t.status = 'unclaimed' and
      t.last_invite_sent_at is null and
      trim(coalesce(t.email, '')) <> ''
    order by
      case c.corridor
        when 'pensacola_core' then 1
        when 'gulf_to_dallas' then 2
        when 'east_coast_to_nj' then 3
        else 4
      end,
      c.seed_order asc,
      coalesce(t.confidence_score, 0) desc,
      t.created_at asc
    limit ${limitListings}
  `);

  const rows = ((candidateRows as any)?.rows || []) as OnboardingCandidateRow[];

  if (markContacted && rows.length > 0) {
    const ids = rows.map((row) => String(row.listingId || "").trim()).filter(Boolean);
    if (ids.length > 0) {
      await db.execute(sql`
        update truck_import_listings
        set
          status = 'claim_requested',
          last_invite_sent_at = now(),
          updated_at = now()
        where id = any(${ids}::varchar[])
      `);
    }
  }

  const baseUrl = String(process.env.PUBLIC_BASE_URL || "https://www.mealscout.us").replace(/\/+$/, "");
  const batch = rows.map((row) => {
    const query = String(row.externalId || row.name || "").trim();
    const claimUrl = `${baseUrl}/restaurant-signup?businessType=food_truck&claim=1${
      query ? `&q=${encodeURIComponent(query)}` : ""
    }`;
    return {
      ...row,
      claimUrl,
    };
  });

  const durationMs = Date.now() - startedAt;
  await recordMarketExpansionJobRun({
    jobName: "initial_onboarding_batch",
    status: "ok",
    batchLimit: limitListings,
    evaluatedCount: rows.length,
    changedCount: markContacted ? rows.length : 0,
    durationMs,
    details: {
      limitCities,
      corridorFilter: corridorFilter || null,
      markContacted,
    },
  });

  return {
    ok: true,
    count: batch.length,
    durationMs,
    limitListings,
    limitCities,
    markContacted,
    rows: batch,
  };
}
