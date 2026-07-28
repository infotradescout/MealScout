export function evaluateDeliveryEligibility(input: {
  enabled: boolean;
  subtotalCents: number;
  minimumOrderCents: number;
  postalCode: string;
  postalCodes: unknown;
  activeOrders: number;
  maxConcurrentOrders: number;
}) {
  if (!input.enabled) return { ok: false, statusCode: 400, message: "Delivery is not available" };
  if (input.subtotalCents < input.minimumOrderCents) {
    return {
      ok: false,
      statusCode: 400,
      message: `Delivery requires a minimum order of $${(input.minimumOrderCents / 100).toFixed(2)}`,
    };
  }
  const allowedPostalCodes = Array.isArray(input.postalCodes)
    ? input.postalCodes.map((value) => String(value).trim().toUpperCase())
    : [];
  if (allowedPostalCodes.length && !allowedPostalCodes.includes(input.postalCode.trim().toUpperCase())) {
    return { ok: false, statusCode: 400, message: "This address is outside the merchant's delivery area" };
  }
  if (input.activeOrders >= input.maxConcurrentOrders) {
    return { ok: false, statusCode: 409, message: "The merchant is at delivery capacity right now" };
  }
  return { ok: true as const };
}
