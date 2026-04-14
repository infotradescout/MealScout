import { db } from "../../db";
import { sql } from "drizzle-orm";

export type HostPricingColumnsCheck = {
  checkedAt: number;
  hasAll: boolean;
  missing: string[];
};

const HOST_PRICING_COLUMNS = [
  "parking_pass_breakfast_price_cents",
  "parking_pass_lunch_price_cents",
  "parking_pass_dinner_price_cents",
  "parking_pass_daily_price_cents",
  "parking_pass_weekly_price_cents",
  "parking_pass_monthly_price_cents",
  "parking_pass_start_time",
  "parking_pass_end_time",
  "parking_pass_days_of_week",
] as const;

let hostPricingColumnsCache: HostPricingColumnsCheck | null = null;
let hostSpotImageColumnCache: { checkedAt: number; has: boolean } | null = null;

export async function getHostPricingColumnsCheck(): Promise<HostPricingColumnsCheck> {
  const now = Date.now();
  if (
    hostPricingColumnsCache &&
    now - hostPricingColumnsCache.checkedAt < 5 * 60 * 1000
  ) {
    return hostPricingColumnsCache;
  }

  const rows = await db.execute(
    sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hosts'
        and column_name in (${sql.join(
          HOST_PRICING_COLUMNS.map((col) => sql`${col}`),
          sql`, `,
        )})
    `,
  );

  const present = new Set<string>(
    (rows as any)?.rows?.map((r: any) => String(r?.column_name || "")) ?? [],
  );
  const missing = HOST_PRICING_COLUMNS.filter((col) => !present.has(col));
  hostPricingColumnsCache = {
    checkedAt: now,
    hasAll: missing.length === 0,
    missing: missing.slice(),
  };
  return hostPricingColumnsCache;
}

export async function hasHostSpotImageColumn(): Promise<boolean> {
  const now = Date.now();
  if (
    hostSpotImageColumnCache &&
    now - hostSpotImageColumnCache.checkedAt < 5 * 60 * 1000
  ) {
    return hostSpotImageColumnCache.has;
  }

  const rows = await db.execute(
    sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'hosts'
        and column_name = 'spot_image_url'
      limit 1
    `,
  );

  const present =
    Array.isArray((rows as any)?.rows) &&
    (rows as any).rows.some(
      (r: any) => String(r?.column_name || "") === "spot_image_url",
    );

  hostSpotImageColumnCache = { checkedAt: now, has: present };
  return present;
}

export function resetHostPricingColumnsCache(): void {
  hostPricingColumnsCache = null;
}
