import { sql, type SQL } from "drizzle-orm";

/**
 * Bind JavaScript strings as a PostgreSQL text array. Interpolating an array
 * directly into a Drizzle sql template expands it as a parenthesized record,
 * which PostgreSQL cannot cast to text[].
 */
export function postgresTextArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}
