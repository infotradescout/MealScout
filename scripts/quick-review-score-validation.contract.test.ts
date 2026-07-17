import { parseQuickReviewScore } from "../server/quickReview/parseQuickReviewScore";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

// Omitted field -> null, no error.
{
  const result = parseQuickReviewScore("food", undefined, undefined);
  assertEqual(result.value, null, "omitted score should be null");
  assertEqual(result.error, undefined, "omitted score should not error");
}

// Valid boundary values.
{
  const low = parseQuickReviewScore("food", 1, undefined);
  assertEqual(low.value, 1, "1 is a valid lower-bound score");
  assertEqual(low.error, undefined, "1 should not error");

  const high = parseQuickReviewScore("food", 100, undefined);
  assertEqual(high.value, 100, "100 is a valid upper-bound score");
  assertEqual(high.error, undefined, "100 should not error");

  const mid = parseQuickReviewScore("food", "80", undefined);
  assertEqual(mid.value, 80, "numeric string in range should parse");
  assertEqual(mid.error, undefined, "in-range numeric string should not error");
}

// Out of range - rejected, not clamped.
{
  const tooHigh = parseQuickReviewScore("food", 999, undefined);
  assertEqual(tooHigh.value, null, "out-of-range score should not be persisted");
  assertEqual(tooHigh.error, "food", "out-of-range score should report its field");

  const zero = parseQuickReviewScore("value", 0, undefined);
  assertEqual(zero.error, "value", "0 is below the 1-100 range and should error");

  const negative = parseQuickReviewScore("speed", -5, undefined);
  assertEqual(negative.error, "speed", "negative score should error");
}

// Non-integer - rejected.
{
  const fractional = parseQuickReviewScore("vibe", 75.5, undefined);
  assertEqual(fractional.error, "vibe", "non-integer score should error");

  const nonNumeric = parseQuickReviewScore("vibe", "not-a-number", undefined);
  assertEqual(nonNumeric.error, "vibe", "non-numeric score should error");

  const booleanValue = parseQuickReviewScore("food", true, undefined);
  assertEqual(
    booleanValue.error,
    "food",
    "booleans must not coerce into numeric scores",
  );

  const arrayValue = parseQuickReviewScore("value", [75], undefined);
  assertEqual(
    arrayValue.error,
    "value",
    "arrays must not coerce into numeric scores",
  );
}

// Legacy fallback field (e.g. body.foodScore) is honored when scores.food is absent.
{
  const fromLegacy = parseQuickReviewScore("food", undefined, 42);
  assertEqual(fromLegacy.value, 42, "legacy field should be used when primary is absent");

  const primaryWins = parseQuickReviewScore("food", 10, 42);
  assertEqual(primaryWins.value, 10, "primary field should win over legacy field");
}

console.log("quick-review-score-validation.contract.test.ts: all assertions passed");
