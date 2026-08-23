export type RestaurantConnectAccountCreationInput = {
  restaurantId: unknown;
  connectStatus: unknown;
  updatedAt: unknown;
};

export type LockedRestaurantConnectAuthorizationInput = {
  restaurantOwnerId: unknown;
  requesterUserId: unknown;
  requesterIsInternalTeam: boolean;
};

export function canManageLockedRestaurantConnect(
  input: LockedRestaurantConnectAuthorizationInput,
): boolean {
  if (input.requesterIsInternalTeam) return true;

  const restaurantOwnerId = String(input.restaurantOwnerId || '').trim();
  const requesterUserId = String(input.requesterUserId || '').trim();
  return Boolean(
    restaurantOwnerId &&
      requesterUserId &&
      restaurantOwnerId === requesterUserId,
  );
}

export function restaurantConnectAccountCreationIdempotencyKey(
  input: RestaurantConnectAccountCreationInput,
): string {
  const restaurantId = String(input.restaurantId || '').trim();
  if (!restaurantId) {
    throw new Error('Restaurant ID is required for Connect account creation');
  }

  const status = String(input.connectStatus || '')
    .trim()
    .toLowerCase();
  if (status !== 'revoked') {
    return `mealscout:restaurant-connect:${restaurantId}:initial:v1`;
  }

  const updatedAtMs = new Date(input.updatedAt as any).getTime();
  const generation = Number.isFinite(updatedAtMs)
    ? String(Math.floor(updatedAtMs))
    : 'unknown';
  return `mealscout:restaurant-connect:${restaurantId}:revoked-${generation}:v1`;
}
