import { eq, sql } from "drizzle-orm";
import { cities, eventSeries } from "@shared/schema";
import { db } from "../db";
import { resolveCityTimeZoneStrict } from "./cityTimeZone";
import { resolvePersistedEventServiceTimeZone } from "./persistedServiceTimeZoneRules";

export {
  normalizePersistedIanaTimeZone,
  resolvePersistedEventServiceTimeZone,
} from "./persistedServiceTimeZoneRules";

const clean = (value: unknown) => String(value ?? "").trim();

/**
 * Correlated projection for public read queries. It returns a venue timezone
 * only when the persisted city identity resolves to exactly one stored value;
 * callers still validate the returned IANA identifier before composing time.
 */
export function persistedVenueTimeZoneSql(
  cityExpression: any,
  stateExpression: any,
) {
  return sql<string | null>`(
    select case
      when count(distinct btrim(persisted_city.timezone)) = 1
        then min(btrim(persisted_city.timezone))
      else null
    end
    from ${cities} as persisted_city
    where (
      lower(btrim(persisted_city.name)) = lower(btrim(${cityExpression}))
      or persisted_city.slug = regexp_replace(
        lower(btrim(${cityExpression})),
        '[^a-z0-9-]+',
        '-',
        'g'
      )
    )
      and upper(btrim(persisted_city.state)) = upper(btrim(${stateExpression}))
  )`;
}

export async function loadPersistedEventServiceTimeZone(input: {
  seriesId?: unknown;
  city?: unknown;
  state?: unknown;
  database?: any;
}): Promise<string | null> {
  const database = input.database ?? db;
  const seriesId = clean(input.seriesId);
  if (seriesId) {
    const [series] = await database
      .select({ timezone: eventSeries.timezone })
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .limit(1);
    return resolvePersistedEventServiceTimeZone({
      seriesId,
      seriesTimeZone: series?.timezone,
    });
  }

  const venueTimeZone = await resolveCityTimeZoneStrict(
    {
      city: clean(input.city),
      state: clean(input.state),
    },
    database,
  );
  return resolvePersistedEventServiceTimeZone({ venueTimeZone });
}
