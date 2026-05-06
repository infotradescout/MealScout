export const DEFAULT_CRITIC_RADIUS_MILES = 25;
export const MIN_CRITIC_RADIUS_MILES = 1;
export const MAX_CRITIC_RADIUS_MILES = 250;

export type CriticReviewedRestaurant = {
  restaurantId: string;
  reviewedAt: string;
};

export type CriticVideoAssignment = {
  restaurantId: string;
  restaurantName?: string | null;
  status: "pitched" | "assigned" | "completed";
  assignedAt: string;
  source: "critic";
};

export type CriticSettings = {
  enabled: boolean;
  radiusMiles: number;
  grantedAt?: string | null;
  grantedByUserId?: string | null;
  reviewedRestaurants: Record<string, CriticReviewedRestaurant>;
  videoAssignments: CriticVideoAssignment[];
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export const clampCriticRadiusMiles = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CRITIC_RADIUS_MILES;
  return Math.max(
    MIN_CRITIC_RADIUS_MILES,
    Math.min(MAX_CRITIC_RADIUS_MILES, Math.round(parsed)),
  );
};

export const normalizeCriticSettings = (
  accountSettings: unknown,
): CriticSettings => {
  const settings = asRecord(accountSettings);
  const critic = asRecord(settings.critic);
  const reviewedRestaurants = asRecord(critic.reviewedRestaurants);
  const normalizedReviewed = Object.entries(reviewedRestaurants).reduce<
    Record<string, CriticReviewedRestaurant>
  >((acc, [restaurantId, value]) => {
    const item = asRecord(value);
    const reviewedAt = String(item.reviewedAt || "").trim();
    if (restaurantId && reviewedAt) {
      acc[restaurantId] = { restaurantId, reviewedAt };
    }
    return acc;
  }, {});

  return {
    enabled: critic.enabled === true,
    radiusMiles: clampCriticRadiusMiles(
      critic.radiusMiles ?? DEFAULT_CRITIC_RADIUS_MILES,
    ),
    grantedAt: typeof critic.grantedAt === "string" ? critic.grantedAt : null,
    grantedByUserId:
      typeof critic.grantedByUserId === "string"
        ? critic.grantedByUserId
        : null,
    reviewedRestaurants: normalizedReviewed,
    videoAssignments: Array.isArray(critic.videoAssignments)
      ? critic.videoAssignments
          .map((assignment) => {
            const item = asRecord(assignment);
            const restaurantId = String(item.restaurantId || "").trim();
            if (!restaurantId) return null;
            const status =
              item.status === "assigned" || item.status === "completed"
                ? item.status
                : "pitched";
            return {
              restaurantId,
              restaurantName:
                typeof item.restaurantName === "string"
                  ? item.restaurantName
                  : null,
              status,
              assignedAt:
                typeof item.assignedAt === "string"
                  ? item.assignedAt
                  : new Date().toISOString(),
              source: "critic" as const,
            };
          })
          .filter(Boolean) as CriticVideoAssignment[]
      : [],
  };
};

export const isCriticAccount = (userOrSettings: unknown): boolean => {
  const value = asRecord(userOrSettings);
  const accountSettings =
    "accountSettings" in value ? value.accountSettings : userOrSettings;
  return normalizeCriticSettings(accountSettings).enabled;
};

export const mergeCriticSettings = (
  accountSettings: unknown,
  patch: Partial<CriticSettings> & {
    enabled?: boolean;
    radiusMiles?: number;
    grantedByUserId?: string | null;
  },
): Record<string, any> => {
  const settings = { ...asRecord(accountSettings) };
  const current = normalizeCriticSettings(settings);
  const nextEnabled =
    typeof patch.enabled === "boolean" ? patch.enabled : current.enabled;
  const now = new Date().toISOString();

  settings.critic = {
    ...current,
    ...patch,
    enabled: nextEnabled,
    radiusMiles: clampCriticRadiusMiles(
      patch.radiusMiles ?? current.radiusMiles,
    ),
    grantedAt:
      nextEnabled && !current.grantedAt ? now : patch.grantedAt ?? current.grantedAt,
    grantedByUserId:
      nextEnabled && patch.grantedByUserId !== undefined
        ? patch.grantedByUserId
        : current.grantedByUserId,
    reviewedRestaurants:
      patch.reviewedRestaurants ?? current.reviewedRestaurants,
    videoAssignments: patch.videoAssignments ?? current.videoAssignments,
  };

  return settings;
};

export const markCriticRestaurantReviewed = (
  accountSettings: unknown,
  restaurantId: string,
): Record<string, any> => {
  const current = normalizeCriticSettings(accountSettings);
  return mergeCriticSettings(accountSettings, {
    reviewedRestaurants: {
      ...current.reviewedRestaurants,
      [restaurantId]: {
        restaurantId,
        reviewedAt: new Date().toISOString(),
      },
    },
  });
};

export const addCriticVideoAssignment = (
  accountSettings: unknown,
  restaurant: { id: string; name?: string | null },
): Record<string, any> => {
  const current = normalizeCriticSettings(accountSettings);
  const existing = current.videoAssignments.find(
    (assignment) => assignment.restaurantId === restaurant.id,
  );
  if (existing) {
    return mergeCriticSettings(accountSettings, {
      videoAssignments: current.videoAssignments,
    });
  }

  const assignment: CriticVideoAssignment = {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name || null,
    status: "pitched",
    assignedAt: new Date().toISOString(),
    source: "critic",
  };

  return mergeCriticSettings(accountSettings, {
    videoAssignments: [assignment, ...current.videoAssignments].slice(0, 100),
  });
};
