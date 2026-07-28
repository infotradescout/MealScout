export type PublicCrossPromotionCandidate = {
  id: string;
  name: string;
  profileType: "restaurant" | "truck" | "bar";
  cuisineType: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  profilePath: string;
  attributedProfilePath: string;
  attributionApplied: boolean;
};

export type PublicCrossPromotionProfile = {
  id: string;
  cuisineType?: string | null;
};

const normalizedCuisineTokens = (value: unknown) =>
  new Set(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );

const stableScore = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Keeps cross-promotion relevant and deterministic without paid placement.
 * Same-cuisine businesses are de-prioritized so the rail is more likely to
 * complete a meal or extend a visit than present a near-duplicate competitor.
 */
export function rankPublicCrossPromotions(
  source: PublicCrossPromotionProfile,
  candidates: PublicCrossPromotionCandidate[],
  limit = 8,
) {
  const sourceCuisine = normalizedCuisineTokens(source.cuisineType);
  const overlapCount = (candidate: PublicCrossPromotionCandidate) => {
    const candidateCuisine = normalizedCuisineTokens(candidate.cuisineType);
    let overlap = 0;
    candidateCuisine.forEach((token) => {
      if (sourceCuisine.has(token)) overlap += 1;
    });
    return overlap;
  };

  return candidates
    .filter((candidate) => candidate.id !== source.id)
    .sort((left, right) => {
      const cuisineDifference =
        overlapCount(left) - overlapCount(right);
      if (cuisineDifference !== 0) return cuisineDifference;
      return (
        stableScore(`${source.id}:${left.id}`) -
        stableScore(`${source.id}:${right.id}`)
      );
    })
    .slice(0, Math.max(0, limit));
}
