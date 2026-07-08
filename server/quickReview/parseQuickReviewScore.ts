/**
 * Quick-review scores (food/value/speed/vibe) are 1-100 integers. A field
 * left out of the request is fine (stored as null); a field present with a
 * bad value is rejected rather than silently clamped, so a malformed client
 * gets a 400 instead of having its input quietly rewritten.
 */
export type QuickReviewScoreResult = { value: number | null; error?: string };

export function parseQuickReviewScore(
  field: string,
  rawValue: unknown,
  legacyValue: unknown,
): QuickReviewScoreResult {
  const source = rawValue ?? legacyValue;
  if (source === undefined || source === null || source === "") {
    return { value: null };
  }
  const num = Number(source);
  if (!Number.isInteger(num) || num < 1 || num > 100) {
    return { value: null, error: field };
  }
  return { value: num };
}
