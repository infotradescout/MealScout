import crypto from "node:crypto";

export type QuickReviewScores = {
  food: number | null;
  value: number | null;
  speed: number | null;
  vibe: number | null;
};

type FingerprintInput = {
  comment: string | null;
  scores: QuickReviewScores;
  proofBytes?: Buffer | null;
};

export type QuickReviewContextDecision =
  | "none"
  | "create"
  | "replay"
  | "conflict";

/**
 * Fingerprints the normalized semantic payload, including the original proof
 * bytes. This lets a timed-out client replay the same submission safely while
 * preventing a later, different submission from being reported as saved.
 */
export function buildQuickReviewContextFingerprint({
  comment,
  scores,
  proofBytes,
}: FingerprintInput): string {
  const proofSha256 = proofBytes
    ? crypto.createHash("sha256").update(proofBytes).digest("hex")
    : null;
  const canonicalPayload = JSON.stringify({
    version: 1,
    comment: comment || null,
    scores: {
      food: scores.food,
      value: scores.value,
      speed: scores.speed,
      vibe: scores.vibe,
    },
    proofSha256,
  });

  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}

export function decideQuickReviewContext(input: {
  hasIncomingContext: boolean;
  contextSubmittedAt: Date | string | null | undefined;
  storedFingerprint: string | null | undefined;
  incomingFingerprint: string | null;
}): QuickReviewContextDecision {
  if (!input.hasIncomingContext) return "none";
  if (!input.contextSubmittedAt) return "create";
  if (
    input.storedFingerprint &&
    input.incomingFingerprint &&
    input.storedFingerprint === input.incomingFingerprint
  ) {
    return "replay";
  }
  return "conflict";
}

export function mergeQuickReviewScores(
  existing: QuickReviewScores,
  incoming: QuickReviewScores,
): QuickReviewScores {
  return {
    food: incoming.food ?? existing.food,
    value: incoming.value ?? existing.value,
    speed: incoming.speed ?? existing.speed,
    vibe: incoming.vibe ?? existing.vibe,
  };
}
