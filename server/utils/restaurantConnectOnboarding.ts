import { createHash } from 'node:crypto';

export type RestaurantConnectAccountCreationInput = {
  restaurantId: unknown;
  restaurantOwnerId: unknown;
  connectGeneration: unknown;
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
  const restaurantOwnerId = String(input.restaurantOwnerId || '').trim();
  if (!restaurantOwnerId) {
    throw new Error('Restaurant owner ID is required for Connect account creation');
  }
  const connectGeneration = Number(input.connectGeneration);
  if (!Number.isInteger(connectGeneration) || connectGeneration < 0) {
    throw new Error('A valid Connect generation is required for account creation');
  }

  const generationIdentity = createHash('sha256')
    .update(`${restaurantId}\u0000${restaurantOwnerId}\u0000${connectGeneration}`)
    .digest('hex');
  return `mealscout:restaurant-connect:${generationIdentity}:v1`;
}
