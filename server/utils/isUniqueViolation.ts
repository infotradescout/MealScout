/**
 * Postgres unique_violation is SQLSTATE 23505.
 * Drizzle wraps driver errors as DrizzleQueryError, so the code often lives on
 * `error.cause` rather than the top-level error.
 */
export function isUniqueViolation(error: unknown): boolean {
  const code = String(
    (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ||
      (error as { cause?: { code?: unknown } } | null)?.cause?.code ||
      "",
  );
  return code === "23505";
}
