const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function computeExternalReviewAdjustment(rating: number) {
  if (!Number.isFinite(rating) || rating <= 0) return 0;

  const normalizedRating = clamp(rating, 1, 5);
  const centeredScore = (normalizedRating - 3.5) / 1.5;
  return Math.round(clamp(centeredScore, -1, 1) * 25);
}
