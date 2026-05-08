export const TRUST_BONUS_POLICY = {
  communityBuilderBonusPoints: 250,
  actionWeights: {
    likes: 1,
    shares: 3,
    follows: 4,
    recommendations: 12,
    favorites: 5,
    reviews: 10,
  },
  maxActionBonusPoints: 150,
} as const;

export type TrustBonusActions = Partial<
  Record<keyof typeof TRUST_BONUS_POLICY.actionWeights, number>
>;

export type TrustBonusEvaluationInput = {
  communityBuilderEnabled?: boolean;
  actions?: TrustBonusActions | null;
};

export type TrustBonusLineItem = {
  id: string;
  label: string;
  points: number;
};

const clampNonNegativeInteger = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

export function getCommunityBuilderBonusPoints() {
  return TRUST_BONUS_POLICY.communityBuilderBonusPoints;
}

export function evaluateTrustBonuses(input: TrustBonusEvaluationInput = {}) {
  const items: TrustBonusLineItem[] = [];

  if (input.communityBuilderEnabled) {
    items.push({
      id: "community_builder",
      label: "Community Builder Bonus",
      points: getCommunityBuilderBonusPoints(),
    });
  }

  const actionPoints = Object.entries(TRUST_BONUS_POLICY.actionWeights).reduce(
    (total, [action, weight]) => {
      const count = clampNonNegativeInteger(
        input.actions?.[action as keyof TrustBonusActions],
      );
      return total + count * weight;
    },
    0,
  );

  if (actionPoints > 0) {
    items.push({
      id: "community_activity",
      label: "Community activity",
      points: Math.min(actionPoints, TRUST_BONUS_POLICY.maxActionBonusPoints),
    });
  }

  return {
    totalPoints: items.reduce((total, item) => total + item.points, 0),
    items,
  };
}
