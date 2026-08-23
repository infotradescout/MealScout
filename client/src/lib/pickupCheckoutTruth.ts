export interface AuthoritativePaymentOrder {
  merchantNameSnapshot: string;
  pickupAddressSnapshot: string;
  pricesIncludeTax: boolean;
}

export function toAuthoritativePaymentOrder(
  order: Record<string, unknown>,
): AuthoritativePaymentOrder {
  return {
    merchantNameSnapshot: String(order.merchantNameSnapshot || "").trim(),
    pickupAddressSnapshot: String(order.pickupAddressSnapshot || "").trim(),
    pricesIncludeTax: order.pricesIncludeTax === true,
  };
}
