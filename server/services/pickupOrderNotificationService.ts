import { and, asc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";

import {
  orderNotifications,
  pickupOrders,
  restaurants,
  users,
  type PickupOrder,
} from "@shared/schema";
import { db } from "../db";
import { emailService } from "../emailService";
import { sendSms } from "../smsService";
import { buildPickupOrderStatusUrl } from "../utils/pickupOrderStatusUrl";
import {
  describePickupOrderCancellationPayment,
  PICKUP_ORDER_CONTRACT_VERSION,
} from "./pickupOrderPaymentReconciliation";

const shortOrderId = (orderId: string) => orderId.slice(-6).toUpperCase();
const NOTIFICATION_ATTEMPT_STALE_MS = 10 * 60 * 1000;

async function claimNotificationAttempt(input: {
  orderId: string;
  channel: "email" | "sms";
  type: string;
  recipient: string;
}) {
  const dedupeKey = `${input.orderId}:${input.channel}:${input.type}:${
    input.channel === "email" ? input.recipient.toLowerCase() : input.recipient
  }`;
  const values = {
    ...input,
    status: "pending",
    dedupeKey,
    sentAt: new Date(),
    attemptCount: 1,
  };
  const [created] = await db
    .insert(orderNotifications)
    .values(values)
    .onConflictDoNothing({ target: orderNotifications.dedupeKey })
    .returning({ id: orderNotifications.id });
  if (created) return created;

  // A provider failure may retry immediately; an attempt abandoned by a
  // process crash may retry after a bounded lease. The conditional update is
  // the retry claim, so concurrent webhook deliveries cannot both send.
  const retryBefore = new Date(Date.now() - NOTIFICATION_ATTEMPT_STALE_MS);
  const [reclaimed] = await db
    .update(orderNotifications)
    .set({
      status: "pending",
      errorMessage: null,
      sentAt: new Date(),
      attemptCount: sql`${orderNotifications.attemptCount} + 1`,
    })
    .where(
      and(
        eq(orderNotifications.dedupeKey, dedupeKey),
        lt(orderNotifications.attemptCount, 5),
        or(
          eq(orderNotifications.status, "failed"),
          and(
            eq(orderNotifications.status, "pending"),
            lt(orderNotifications.sentAt, retryBefore),
          ),
        ),
      ),
    )
    .returning({ id: orderNotifications.id });
  return reclaimed || null;
}

async function sendOnce(input: {
  orderId: string;
  type: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
}) {
  const claim = await claimNotificationAttempt({
    orderId: input.orderId,
    channel: "email",
    type: input.type,
    recipient: input.recipient,
  });
  if (!claim) return;

  let status = "failed";
  let errorMessage: string | undefined;
  try {
    const sent = await emailService.sendBasicEmail(
      input.recipient,
      input.subject,
      input.html,
      input.text,
      "general",
    );
    status = sent ? "sent" : "failed";
    if (!sent) errorMessage = "Email provider skipped or failed";
  } catch (error: any) {
    errorMessage = String(error?.message || error);
  }

  await db
    .update(orderNotifications)
    .set({ status, errorMessage })
    .where(eq(orderNotifications.id, claim.id));
}

async function sendSmsOnce(input: {
  orderId: string;
  type: string;
  recipient: string;
  text: string;
}) {
  const claim = await claimNotificationAttempt({
    orderId: input.orderId,
    channel: "sms",
    type: input.type,
    recipient: input.recipient,
  });
  if (!claim) return;

  let status = "failed";
  let errorMessage: string | undefined;
  try {
    const sent = await sendSms(input.recipient, input.text);
    status = sent ? "sent" : "failed";
    if (!sent) errorMessage = "SMS provider skipped or failed";
  } catch (error: any) {
    errorMessage = String(error?.message || error);
  }

  await db
    .update(orderNotifications)
    .set({ status, errorMessage })
    .where(eq(orderNotifications.id, claim.id));
}

export async function sendPickupOrderConfirmedNotifications(
  order: PickupOrder,
) {
  const [restaurant] = await db
    .select({
      name: restaurants.name,
      ownerEmail: users.email,
    })
    .from(restaurants)
    .leftJoin(users, eq(restaurants.ownerId, users.id))
    .where(eq(restaurants.id, order.restaurantId))
    .limit(1);

  const businessName = restaurant?.name || "the business";
  const orderNumber = shortOrderId(order.id);
  const total = `$${(order.totalCents / 100).toFixed(2)}`;
  const statusUrl = buildPickupOrderStatusUrl(order.id);
  const acknowledgementMinutes = Number(
    order.merchantAcknowledgementMinutesSnapshot,
  );
  const customerResponseWindow =
    Number.isInteger(acknowledgementMinutes) && acknowledgementMinutes > 0
      ? `The business has ${acknowledgementMinutes} minutes to start preparation; otherwise MealScout cancels the order and starts refund reconciliation automatically.`
      : "The status page will show when preparation begins.";
  const merchantDeadline = order.merchantAcknowledgementDueAt
    ? new Date(order.merchantAcknowledgementDueAt).toISOString()
    : null;
  const merchantResponseWindow = merchantDeadline
    ? `Start preparation by ${merchantDeadline} and enter a real prep estimate.`
    : "Start preparation now and enter a real prep estimate.";

  const sends: Promise<void>[] = [];
  if (order.customerEmail) {
    sends.push(
      sendOnce({
        orderId: order.id,
        type: "confirmation",
        recipient: order.customerEmail,
        subject: `Order received – ${businessName}`,
        html: `<p>Hi ${order.customerName},</p><p>MealScout recorded your order <strong>#${orderNumber}</strong> for ${businessName}.</p><p>${customerResponseWindow}</p><p><a href="${statusUrl}">View order status</a>.</p><p>Total: ${total}</p>`,
        text: `Hi ${order.customerName}, MealScout recorded your order #${orderNumber} for ${businessName}. ${customerResponseWindow} View status: ${statusUrl}. Total: ${total}`,
      }),
    );
  }
  if (order.customerPhone) {
    sends.push(
      sendSmsOnce({
        orderId: order.id,
        type: "confirmation",
        recipient: order.customerPhone,
        text: `MealScout recorded order #${orderNumber} for ${businessName}. ${customerResponseWindow} View status: ${statusUrl}`,
      }),
    );
  }
  if (restaurant?.ownerEmail) {
    sends.push(
      sendOnce({
        orderId: order.id,
        type: "merchant_new_order",
        recipient: restaurant.ownerEmail,
        subject: `New MealScout order #${orderNumber}`,
        html: `<p>${businessName} has a new ${order.orderType.replaceAll("_", " ")} order.</p><p><strong>#${orderNumber}</strong> · ${total}</p><p>${merchantResponseWindow}</p><p>Open the MealScout Orders workspace now.</p>`,
        text: `${businessName} has a new ${order.orderType.replaceAll("_", " ")} order. #${orderNumber} · ${total}. ${merchantResponseWindow} Open the MealScout Orders workspace now.`,
      }),
    );
  }
  await Promise.allSettled(sends);
}

export async function sendPickupOrderCancelledNotification(order: PickupOrder) {
  const orderNumber = shortOrderId(order.id);
  const statusUrl = buildPickupOrderStatusUrl(order.id);
  const outcome = describePickupOrderCancellationPayment(order);
  const sends: Promise<void>[] = [];
  if (order.customerEmail) {
    sends.push(
      sendOnce({
        orderId: order.id,
        type: "cancelled",
        recipient: order.customerEmail,
        subject: `MealScout order #${orderNumber} cancelled`,
        html: `<p>Hi ${order.customerName},</p><p>Your MealScout order <strong>#${orderNumber}</strong> was cancelled.</p><p>${outcome}</p><p><a href="${statusUrl}">View order status</a></p>`,
        text: `Hi ${order.customerName}, your MealScout order #${orderNumber} was cancelled. ${outcome} View status: ${statusUrl}`,
      }),
    );
  }
  if (order.customerPhone) {
    sends.push(
      sendSmsOnce({
        orderId: order.id,
        type: "cancelled",
        recipient: order.customerPhone,
        text: `MealScout order #${orderNumber} was cancelled. ${outcome} View status: ${statusUrl}`,
      }),
    );
  }
  await Promise.allSettled(sends);
}

export async function sendPickupOrderReadyNotifications(order: PickupOrder) {
  const orderNumber = shortOrderId(order.id);
  const statusUrl = buildPickupOrderStatusUrl(order.id);
  const fulfillmentCopy =
    order.orderType === "delivery"
      ? "ready and will head out for delivery soon"
      : "ready for pickup";
  const sends: Promise<void>[] = [];
  if (order.customerEmail) {
    sends.push(
      sendOnce({
        orderId: order.id,
        type: "ready",
        recipient: order.customerEmail,
        subject: "Your order is ready!",
        html: `<p>Hi ${order.customerName},</p><p>Your MealScout order <strong>#${orderNumber}</strong> is ${fulfillmentCopy}.</p><p><a href="${statusUrl}">View order status</a></p>`,
        text: `Hi ${order.customerName}, your MealScout order #${orderNumber} is ${fulfillmentCopy}. View status: ${statusUrl}`,
      }),
    );
  }
  if (order.customerPhone) {
    sends.push(
      sendSmsOnce({
        orderId: order.id,
        type: "ready",
        recipient: order.customerPhone,
        text: `MealScout order #${orderNumber} is ${fulfillmentCopy}. View status: ${statusUrl}`,
      }),
    );
  }
  await Promise.allSettled(sends);

  const expected = [
    ...(order.customerEmail
      ? [{ channel: "email", recipient: order.customerEmail.toLowerCase() }]
      : []),
    ...(order.customerPhone
      ? [{ channel: "sms", recipient: order.customerPhone }]
      : []),
  ];
  const claims = expected.length
    ? await db
        .select({
          channel: orderNotifications.channel,
          recipient: orderNotifications.recipient,
          status: orderNotifications.status,
        })
        .from(orderNotifications)
        .where(
          and(
            eq(orderNotifications.orderId, order.id),
            eq(orderNotifications.type, "ready"),
          ),
        )
    : [];
  const allRequiredSent = expected.every((required) =>
    claims.some(
      (claim: { channel: string; recipient: string; status: string }) =>
        claim.channel === required.channel &&
        (claim.channel === "email"
          ? claim.recipient.toLowerCase()
          : claim.recipient) === required.recipient &&
        claim.status === "sent",
    ),
  );
  await db
    .update(pickupOrders)
    .set({ readyNotificationSent: allRequiredSent, updatedAt: new Date() })
    .where(eq(pickupOrders.id, order.id));
}

export async function retryPickupOrderNotifications(limit = 50) {
  const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const retryBefore = new Date(Date.now() - NOTIFICATION_ATTEMPT_STALE_MS);
  const retryable: Array<{ orderId: string; type: string }> = await db
    .select({
      orderId: orderNotifications.orderId,
      type: orderNotifications.type,
    })
    .from(orderNotifications)
    .where(
      and(
        inArray(orderNotifications.type, [
          "confirmation",
          "merchant_new_order",
          "ready",
          "cancelled",
        ]),
        lt(orderNotifications.attemptCount, 5),
        or(
          eq(orderNotifications.status, "failed"),
          and(
            eq(orderNotifications.status, "pending"),
            lt(orderNotifications.sentAt, retryBefore),
          ),
        ),
      ),
    )
    .limit(boundedLimit);
  const lacksNotification = (
    type: "confirmation" | "merchant_new_order" | "ready" | "cancelled",
    channel: "email" | "sms",
  ) =>
    notExists(
      db
        .select({ id: orderNotifications.id })
        .from(orderNotifications)
        .where(
          and(
            eq(orderNotifications.orderId, pickupOrders.id),
            eq(orderNotifications.type, type),
            eq(orderNotifications.channel, channel),
          ),
        ),
    );
  const hasText = (value: unknown) =>
    sql`length(trim(coalesce(${value as any}, ''))) > 0`;
  const confirmedStatuses = [
    "confirmed",
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
    "completed",
  ];
  const missingClaimRows = await db
    .select({ orderId: pickupOrders.id })
    .from(pickupOrders)
    .innerJoin(restaurants, eq(restaurants.id, pickupOrders.restaurantId))
    .leftJoin(users, eq(users.id, restaurants.ownerId))
    .where(
      and(
        eq(pickupOrders.orderingContractVersion, PICKUP_ORDER_CONTRACT_VERSION),
        or(
          and(
            inArray(pickupOrders.status, confirmedStatuses),
            or(
              and(
                hasText(pickupOrders.customerEmail),
                lacksNotification("confirmation", "email"),
              ),
              and(
                hasText(pickupOrders.customerPhone),
                lacksNotification("confirmation", "sms"),
              ),
              and(
                hasText(users.email),
                lacksNotification("merchant_new_order", "email"),
              ),
            ),
          ),
          and(
            inArray(pickupOrders.status, [
              "ready",
              "out_for_delivery",
              "delivered",
              "completed",
            ]),
            or(
              and(
                hasText(pickupOrders.customerEmail),
                lacksNotification("ready", "email"),
              ),
              and(
                hasText(pickupOrders.customerPhone),
                lacksNotification("ready", "sms"),
              ),
            ),
          ),
          and(
            eq(pickupOrders.status, "cancelled"),
            or(
              and(
                hasText(pickupOrders.customerEmail),
                lacksNotification("cancelled", "email"),
              ),
              and(
                hasText(pickupOrders.customerPhone),
                lacksNotification("cancelled", "sms"),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(pickupOrders.createdAt))
    .limit(boundedLimit);
  const orderIds = [
    ...new Set([
      ...retryable.map((row) => row.orderId),
      ...missingClaimRows.map((row: { orderId: string }) => row.orderId),
    ]),
  ];
  if (orderIds.length === 0) return { examined: 0, attempted: 0, failed: 0 };

  const orders = await db
    .select()
    .from(pickupOrders)
    .where(inArray(pickupOrders.id, orderIds));
  let attempted = 0;
  let failed = 0;
  for (const order of orders) {
    const requestedTypes = new Set(
      retryable
        .filter((row) => row.orderId === order.id)
        .map((row) => row.type),
    );
    try {
      if (order.status === "cancelled" || requestedTypes.has("cancelled")) {
        await sendPickupOrderCancelledNotification(order);
        attempted += 1;
      } else if (
        [
          "confirmed",
          "preparing",
          "ready",
          "out_for_delivery",
          "delivered",
          "completed",
        ].includes(order.status)
      ) {
        await sendPickupOrderConfirmedNotifications(order);
        if (
          ["ready", "out_for_delivery", "delivered", "completed"].includes(
            order.status,
          )
        ) {
          await sendPickupOrderReadyNotifications(order);
        }
        attempted += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[pickup-order-notifications] Retry failed for order ${order.id}`,
        error,
      );
    }
  }
  return { examined: orderIds.length, attempted, failed };
}
