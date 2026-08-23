import type { AuthoritativePaymentOrder } from './pickupCheckoutTruth';

export type PickupCheckoutServerTotals = {
  subtotalCents: number;
  mealscoutFeeCents: number;
  processingFeeCents: number;
  platformFeeCents: number;
  totalCents: number;
  feePaidByBusiness: boolean;
};

export type PickupCheckoutReplayPayload = {
  restaurantId: string;
  menuId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  orderType: 'pickup';
  checkoutRequestId: string;
  customerAccessToken: string;
  paymentMethod: 'card';
  promotionToken?: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
    selectedVariantId?: string | null;
    selectedModifierIds?: string[];
    specialInstructions?: string;
  }>;
};

export type PickupCheckoutRecovery = {
  version: 1;
  restaurantId: string;
  checkoutRequestId: string;
  customerAccessToken: string;
  checkoutPayload: PickupCheckoutReplayPayload | null;
  orderId: string | null;
  clientSecret: string | null;
  authoritativePaymentOrder: AuthoritativePaymentOrder | null;
  serverTotals: PickupCheckoutServerTotals | null;
  updatedAt: number;
};

export type PickupCheckoutRecoveryStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

const STORAGE_PREFIX = 'mealscout:pickup-checkout:';

const storageKey = (restaurantId: string) =>
  `${STORAGE_PREFIX}${encodeURIComponent(restaurantId)}`;

function browserSessionStorage(): PickupCheckoutRecoveryStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPickupCheckoutRecovery(
  restaurantId: string,
  storage: PickupCheckoutRecoveryStorage | null = browserSessionStorage(),
): PickupCheckoutRecovery | null {
  const normalizedRestaurantId = String(restaurantId || '').trim();
  if (!normalizedRestaurantId || !storage) return null;

  try {
    const raw = storage.getItem(storageKey(normalizedRestaurantId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PickupCheckoutRecovery>;
    if (
      value.version !== 1 ||
      String(value.restaurantId || '').trim() !== normalizedRestaurantId ||
      !String(value.checkoutRequestId || '').trim() ||
      String(value.customerAccessToken || '').length < 32 ||
      (value.orderId && !value.checkoutPayload) ||
      (value.checkoutPayload &&
        (value.checkoutPayload.restaurantId !== normalizedRestaurantId ||
          value.checkoutPayload.checkoutRequestId !== value.checkoutRequestId ||
          value.checkoutPayload.customerAccessToken !==
            value.customerAccessToken))
    ) {
      return null;
    }
    return value as PickupCheckoutRecovery;
  } catch {
    return null;
  }
}

export function writePickupCheckoutRecovery(
  recovery: PickupCheckoutRecovery,
  storage: PickupCheckoutRecoveryStorage | null = browserSessionStorage(),
): void {
  const restaurantId = String(recovery.restaurantId || '').trim();
  if (!restaurantId || !storage) return;
  try {
    storage.setItem(storageKey(restaurantId), JSON.stringify(recovery));
  } catch {
    // Checkout remains usable when browser storage is unavailable.
  }
}

export function clearPickupCheckoutRecovery(
  restaurantId: string,
  storage: PickupCheckoutRecoveryStorage | null = browserSessionStorage(),
): void {
  const normalizedRestaurantId = String(restaurantId || '').trim();
  if (!normalizedRestaurantId || !storage) return;
  try {
    storage.removeItem(storageKey(normalizedRestaurantId));
  } catch {
    // Ignore storage restrictions after the checkout has ended.
  }
}
