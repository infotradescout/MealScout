type PickupCheckoutReplayOrder = {
  pricesIncludeTax?: unknown;
  merchantNameSnapshot?: unknown;
  merchantOwnerIdSnapshot?: unknown;
  stripeConnectAccountIdSnapshot?: unknown;
  pickupAddressSnapshot?: unknown;
  pickupDirectionsUrlSnapshot?: unknown;
  merchantAcknowledgementMinutesSnapshot?: unknown;
};

type PickupCheckoutReplayReadiness = {
  restaurantName?: unknown;
  pickupAddressLabel?: unknown;
  pickupDirectionsUrl?: unknown;
  merchantAcknowledgementMinutes?: unknown;
  orderingEnabled?: unknown;
  paymentMethods?: { card?: unknown };
  settlementIdentity?: {
    merchantOwnerId?: unknown;
    stripeConnectAccountId?: unknown;
  };
  menuReadiness?: Array<{
    menuId?: unknown;
    orderingEnabled?: unknown;
    pricesIncludeTax?: unknown;
  }>;
};

const normalized = (value: unknown) => String(value || "").trim();

export function isPendingPickupCheckoutReplayReady(input: {
  order: PickupCheckoutReplayOrder;
  menuId: string;
  allItemsStillAvailable: boolean;
  readiness: PickupCheckoutReplayReadiness;
}) {
  const exactMenu = input.readiness.menuReadiness?.find(
    (menu) => normalized(menu.menuId) === input.menuId,
  );
  return Boolean(
    input.allItemsStillAvailable &&
    input.readiness.orderingEnabled === true &&
    input.readiness.paymentMethods?.card === true &&
    exactMenu?.orderingEnabled === true &&
    exactMenu.pricesIncludeTax === true &&
    input.order.pricesIncludeTax === true &&
    normalized(input.readiness.restaurantName) ===
      normalized(input.order.merchantNameSnapshot) &&
    normalized(input.readiness.settlementIdentity?.merchantOwnerId) ===
      normalized(input.order.merchantOwnerIdSnapshot) &&
    normalized(input.readiness.settlementIdentity?.stripeConnectAccountId) ===
      normalized(input.order.stripeConnectAccountIdSnapshot) &&
    normalized(input.readiness.pickupAddressLabel) ===
      normalized(input.order.pickupAddressSnapshot) &&
    normalized(input.readiness.pickupDirectionsUrl) ===
      normalized(input.order.pickupDirectionsUrlSnapshot) &&
    Number(input.readiness.merchantAcknowledgementMinutes) ===
      Number(input.order.merchantAcknowledgementMinutesSnapshot),
  );
}
