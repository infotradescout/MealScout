import { is, SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export function createModelTable(table: PgTable) {
  const config = getTableConfig(table);
  const dialect = new PgDialect();
  const columns = config.columns.map((column) => {
    let definition = `${quote(column.name)} ${column.getSQLType()}`;
    if (column.primary) definition += " PRIMARY KEY";
    if (column.notNull) definition += " NOT NULL";
    if (column.default !== undefined) {
      const value = column.default;
      definition += " DEFAULT " + (is(value, SQL) ? dialect.sqlToQuery(value).sql
        : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value));
    }
    return definition;
  });
  return `CREATE TABLE ${quote(config.name)} (${columns.join(", ")})`;
}
