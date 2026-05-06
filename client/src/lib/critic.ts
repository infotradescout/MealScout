export type CriticReviewedRestaurant = {
  restaurantId: string;
  reviewedAt: string;
};

export type CriticVideoAssignment = {
  restaurantId: string;
  restaurantName?: string | null;
  status: "pitched" | "assigned" | "completed";
  assignedAt: string;
  source?: string;
};

export type CriticSettings = {
  enabled: boolean;
  radiusMiles: number;
  grantedAt?: string | null;
  grantedByUserId?: string | null;
  reviewedRestaurants: Record<string, CriticReviewedRestaurant>;
  videoAssignments: CriticVideoAssignment[];
};

const DEFAULT_CRITIC_RADIUS_MILES = 25;

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export const getCriticSettings = (value: unknown): CriticSettings => {
  const record = asRecord(value);
  const accountSettings =
    "accountSettings" in record ? record.accountSettings : value;
  const critic = asRecord(asRecord(accountSettings).critic);
  const radiusMiles = Number(critic.radiusMiles);

  return {
    enabled: critic.enabled === true,
    radiusMiles: Number.isFinite(radiusMiles)
      ? Math.max(1, Math.min(250, Math.round(radiusMiles)))
      : DEFAULT_CRITIC_RADIUS_MILES,
    grantedAt: typeof critic.grantedAt === "string" ? critic.grantedAt : null,
    grantedByUserId:
      typeof critic.grantedByUserId === "string"
        ? critic.grantedByUserId
        : null,
    reviewedRestaurants: asRecord(critic.reviewedRestaurants) as Record<
      string,
      CriticReviewedRestaurant
    >,
    videoAssignments: Array.isArray(critic.videoAssignments)
      ? critic.videoAssignments
      : [],
  };
};

export const isCriticAccount = (value: unknown) =>
  getCriticSettings(value).enabled;
