/** Presentation-boundary checks only; the server still owns order permissions,
 * status transitions, settlement, cancellation, and refunds. */
export class OwnerOrdersReadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OwnerOrdersReadError";
    this.status = status;
  }
}

type OrderRecord = Record<string, unknown>;

export type OwnerOrdersPayload = {
  orders: OrderRecord[];
  page: number;
  hasMore: boolean;
};

function isRecord(value: unknown): value is OrderRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOrderForBusiness(value: unknown, restaurantId: string): value is OrderRecord {
  return isRecord(value) &&
    hasText(value.id) && value.restaurantId === restaurantId &&
    hasText(value.status) && hasText(value.orderType) && hasText(value.paymentMethod) &&
    Array.isArray(value.items) && value.items.every((item: unknown) =>
      isRecord(item) && hasText(item.id) && typeof item.itemName === "string" &&
      typeof item.quantity === "number" && Number.isFinite(item.quantity) &&
      typeof item.lineTotalCents === "number" && Number.isFinite(item.lineTotalCents));
}

/** Do not convert missing, malformed, or wrong-business data to an empty queue.
 * Keep the query in its existing error/retry state until a valid read succeeds.
 * No rows are dropped silently and no order or financial fields are rewritten. */
export async function readOwnerOrdersResponse(
  response: Response,
  restaurantId: string,
): Promise<OwnerOrdersPayload> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload)
      ? [payload.message, payload.error].find(hasText)
      : undefined;
    throw new OwnerOrdersReadError(
      message || (response.status === 401
        ? "Your session expired. Sign in again to load orders."
        : response.status === 403
          ? "Order access is unavailable for this business."
          : "Orders could not be loaded. Check your connection and try again."),
      response.status,
    );
  }

  const invalidResponse = () => new OwnerOrdersReadError(
    "MealScout could not verify the order list. Refresh orders before taking action.",
    response.status,
  );
  if (!hasText(restaurantId) || !isRecord(payload) || !Array.isArray(payload.orders) ||
    !payload.orders.every((order: unknown) => isOrderForBusiness(order, restaurantId))) {
    throw invalidResponse();
  }
  const orders = payload.orders as OrderRecord[];
  if (new Set(orders.map((order) => order.id)).size !== orders.length) {
    throw invalidResponse();
  }

  // The kitchen response can omit pagination. Preserve numeric-string page
  // compatibility, but never turn bad metadata into an endless page-one loop.
  const rawPage = payload.page === undefined ? 1 : payload.page;
  if (!(typeof rawPage === "number" ||
    (typeof rawPage === "string" && /^[1-9]\d*$/.test(rawPage)))) {
    throw invalidResponse();
  }
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page >= Number.MAX_SAFE_INTEGER ||
    (payload.hasMore !== undefined && typeof payload.hasMore !== "boolean") ||
    (payload.hasMore === true && orders.length === 0)) {
    throw invalidResponse();
  }
  return { orders, page, hasMore: payload.hasMore === true };
}

export function isOwnerOrdersAccessError(error: unknown): boolean {
  return error instanceof OwnerOrdersReadError &&
    (error.status === 401 || error.status === 403);
}
