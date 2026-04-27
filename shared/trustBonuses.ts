export const TRUST_BONUS_POLICY = {
  // Trust bonuses must always remain below this cap.
  goldenPlateBonusPoints: 40,
  maxSingleTrustBonusPoints: 39,
  maxTotalTrustBonusPoints: 39,
  communityBuilderBonusPoints: 25,
} as const;

export type TrustActionSnapshot = {
  likes: number;
  shares: number;
  follows: number;
  recommendations: number;
  favorites: number;
  reviews: number;
};

export type TrustBonusKey = "community_builder";

type TrustBonusRule = {
  key: TrustBonusKey;
  label: string;
  points: number;
  description: string;
  // Action minimums that make bonuses merit-based rather than arbitrary.
  minActions: Partial<Record<keyof TrustActionSnapshot, number>>;
};

export type TrustBonusEvaluationInput = {
  communityBuilderEnabled: boolean;
  actions: TrustActionSnapshot;
};

export type TrustBonusResult = {
  key: TrustBonusKey;
  label: string;
  points: number;
  active: boolean;
  description: string;
  minActions: Partial<Record<keyof TrustActionSnapshot, number>>;
  unmetRequirements: Array<{ action: keyof TrustActionSnapshot; required: number; current: number }>;
};

export type TrustBonusEvaluation = {
  bonuses: TrustBonusResult[];
  totalPoints: number;
  capped: boolean;
};

const TRUST_BONUS_RULES: TrustBonusRule[] = [
  {
    key: "community_builder",
    label: "Community Builder",
    points: TRUST_BONUS_POLICY.communityBuilderBonusPoints,
    description:
      "Recognizes restaurants that consistently give back to their local community.",
    minActions: {
      recommendations: 3,
      follows: 2,
      shares: 1,
    },
  },
];

const normalizeActionValue = (value: unknown) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
};

const clampRulePoints = (points: number) => {
  const normalized = normalizeActionValue(points);
  return Math.min(normalized, TRUST_BONUS_POLICY.maxSingleTrustBonusPoints);
};

export function evaluateTrustBonuses(
  input: TrustBonusEvaluationInput,
): TrustBonusEvaluation {
  const actions: TrustActionSnapshot = {
    likes: normalizeActionValue(input.actions.likes),
    shares: normalizeActionValue(input.actions.shares),
    follows: normalizeActionValue(input.actions.follows),
    recommendations: normalizeActionValue(input.actions.recommendations),
    favorites: normalizeActionValue(input.actions.favorites),
    reviews: normalizeActionValue(input.actions.reviews),
  };

  const bonuses = TRUST_BONUS_RULES.map((rule) => {
    const unmetRequirements = Object.entries(rule.minActions)
      .map(([action, required]) => {
        const key = action as keyof TrustActionSnapshot;
        const requiredValue = normalizeActionValue(required);
        const currentValue = actions[key];
        if (currentValue >= requiredValue) {
          return null;
        }
        return {
          action: key,
          required: requiredValue,
          current: currentValue,
        };
      })
      .filter(
        (
          row,
        ): row is {
          action: keyof TrustActionSnapshot;
          required: number;
          current: number;
        } => Boolean(row),
      );

    const toggledOn = rule.key === "community_builder" ? input.communityBuilderEnabled : false;
    const active = toggledOn && unmetRequirements.length === 0;

    return {
      key: rule.key,
      label: rule.label,
      points: clampRulePoints(rule.points),
      active,
      description: rule.description,
      minActions: rule.minActions,
      unmetRequirements,
    } satisfies TrustBonusResult;
  });

  const rawTotal = bonuses
    .filter((bonus) => bonus.active)
    .reduce((sum, bonus) => sum + bonus.points, 0);
  const totalPoints = Math.min(rawTotal, TRUST_BONUS_POLICY.maxTotalTrustBonusPoints);

  return {
    bonuses,
    totalPoints,
    capped: rawTotal > totalPoints,
  };
}

export function getCommunityBuilderBonusPoints() {
  return TRUST_BONUS_POLICY.communityBuilderBonusPoints;
}
