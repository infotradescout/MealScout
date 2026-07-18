export function normalizeParkingPassLocationSearch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bflorida\b/g, "fl")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parkingPassLocationMatches(
  query: unknown,
  values: unknown[],
): boolean {
  const normalizedQuery = normalizeParkingPassLocationSearch(query);
  if (!normalizedQuery) return true;

  const locationText = normalizeParkingPassLocationSearch(
    values.filter(Boolean).join(" "),
  );
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  return queryTokens.every((token) => locationText.includes(token));
}
