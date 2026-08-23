export type EligiblePage<T> = {
  items: T[];
  hasMore: boolean;
  scanLimitReached: boolean;
};

export type LoadEligiblePageInput<T> = {
  offset: number;
  limit: number;
  batchSize: number;
  maxBatches: number;
  loadBatch: (offset: number, limit: number) => Promise<readonly T[]>;
  isEligible: (item: T) => boolean;
};

/**
 * Applies pagination to the eligible sequence, even when eligibility must be
 * evaluated in application code after database rows are loaded.
 */
export async function loadEligiblePage<T>(
  input: LoadEligiblePageInput<T>,
): Promise<EligiblePage<T>> {
  const offset = Number.isFinite(input.offset)
    ? Math.max(0, Math.floor(input.offset))
    : 0;
  const limit = Number.isFinite(input.limit)
    ? Math.max(0, Math.floor(input.limit))
    : 0;
  if (limit === 0) {
    return { items: [], hasMore: false, scanLimitReached: false };
  }

  const batchSize = Number.isFinite(input.batchSize)
    ? Math.max(1, Math.floor(input.batchSize))
    : Math.max(40, limit + 1);
  const maxBatches = Number.isFinite(input.maxBatches)
    ? Math.max(1, Math.floor(input.maxBatches))
    : 1;
  const items: T[] = [];
  let eligibleSeen = 0;
  let candidateOffset = 0;
  let batchesLoaded = 0;
  let sourceExhausted = false;
  let hasMore = false;

  while (!hasMore && batchesLoaded < maxBatches) {
    const candidates = await input.loadBatch(candidateOffset, batchSize);
    batchesLoaded += 1;
    if (candidates.length === 0) {
      sourceExhausted = true;
      break;
    }

    for (const candidate of candidates) {
      if (!input.isEligible(candidate)) continue;
      if (eligibleSeen < offset) {
        eligibleSeen += 1;
        continue;
      }
      if (items.length < limit) {
        items.push(candidate);
        eligibleSeen += 1;
        continue;
      }
      hasMore = true;
      break;
    }
    candidateOffset += candidates.length;

    if (candidates.length < batchSize) {
      sourceExhausted = true;
      break;
    }
  }

  return {
    items,
    hasMore,
    scanLimitReached:
      !hasMore && !sourceExhausted && batchesLoaded >= maxBatches,
  };
}
