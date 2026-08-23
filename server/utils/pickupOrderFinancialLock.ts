export function pickupOrderFinancialLockKey(orderId: string) {
  const normalizedOrderId = String(orderId || "").trim();
  if (!normalizedOrderId) {
    throw new Error("Pickup order ID is required for financial serialization");
  }
  return `pickup_order_financial:${normalizedOrderId}`;
}
