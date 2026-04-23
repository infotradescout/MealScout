type ImportedExternalReview = {
  platform: string;
  rating: number;
  reviewCount?: number;
  profileUrl?: string | null;
};

type ImportedReviewAggregate = {
  averageRating: number | null;
  sourceCount: number;
  totalReviewCount: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function computeExternalReviewAdjustment(rawRating: number): number {
  const rating = clamp(Number(rawRating || 0), 1, 5);
  if (!Number.isFinite(rating)) return 0;

  // Anchor points requested:
  // 1.0 => -25, 2.5 => 0, 5.0 => +25
  if (rating <= 2.5) {
    const ratio = (rating - 1) / (2.5 - 1); // 0..1
    return Math.round(-25 + ratio * 25);
  }

  const ratio = (rating - 2.5) / (5 - 2.5); // 0..1
  return Math.round(ratio * 25);
}

export function normalizeImportedReviews(
  input: unknown,
): ImportedExternalReview[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      const platform = String((row as any)?.platform || "")
        .trim()
        .slice(0, 50);
      const rating = Number((row as any)?.rating);
      const reviewCount = Number((row as any)?.reviewCount || 0);
      const profileUrl = String((row as any)?.profileUrl || "").trim();
      if (!platform || !Number.isFinite(rating)) return null;
      const safeRating = clamp(rating, 1, 5);
      const safeCount =
        Number.isFinite(reviewCount) && reviewCount > 0
          ? Math.round(reviewCount)
          : 0;
      return {
        platform,
        rating: safeRating,
        reviewCount: safeCount,
        profileUrl: profileUrl || null,
      } as ImportedExternalReview;
    })
    .filter((row): row is ImportedExternalReview => Boolean(row));
}

export function aggregateImportedReviews(
  input: ImportedExternalReview[],
): ImportedReviewAggregate {
  if (!Array.isArray(input) || input.length === 0) {
    return { averageRating: null, sourceCount: 0, totalReviewCount: 0 };
  }

  let weightedNumerator = 0;
  let weightedDenominator = 0;
  let totalReviewCount = 0;

  for (const row of input) {
    const rating = clamp(Number(row.rating || 0), 1, 5);
    const weight = Math.max(1, Number(row.reviewCount || 0));
    weightedNumerator += rating * weight;
    weightedDenominator += weight;
    totalReviewCount += Math.max(0, Math.round(Number(row.reviewCount || 0)));
  }

  if (weightedDenominator <= 0) {
    return {
      averageRating: null,
      sourceCount: input.length,
      totalReviewCount,
    };
  }

  return {
    averageRating:
      Math.round((weightedNumerator / weightedDenominator) * 100) / 100,
    sourceCount: input.length,
    totalReviewCount,
  };
}

