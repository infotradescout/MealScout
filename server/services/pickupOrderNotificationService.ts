import { and, eq } from "drizzle-orm";

import {
  orderNotifications,
  restaurants,
  users,
  type PickupOrder,
} from "@shared/schema";
import { db } from "../db";
import { emailService } from "../emailService";

const shortOrderId = (orderId: string) => orderId.slice(-6).toUpperCase();

async function sendOnce(input: {
  orderId: string;
  type: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
}) {
  const dedupeKey = `${input.orderId}:email:${input.type}:${input.recipient.toLowerCase()}`;
  const [claim] = await db
    .insert(orderNotifications)
    .values({
      orderId: input.orderId,
      channel: "email",
      type: input.type,
      recipient: input.recipient,
      status: "pending",
      dedupeKey,
    })
    .onConflictDoNothing({ target: orderNotifications.dedupeKey })
    .returning({ id: orderNotifications.id });
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

  const sends: Promise<void>[] = [];
  if (order.customerEmail) {
    sends.push(
      sendOnce({
        orderId: order.id,
        type: "confirmation",
        recipient: order.customerEmail,
        subject: `Order confirmed – ${businessName}`,
        html: `<p>Hi ${order.customerName},</p><p>${businessName} received your MealScout order <strong>#${orderNumber}</strong>.</p><p>Total: ${total}</p>`,
        text: `Hi ${order.customerName}, ${businessName} received your MealScout order #${orderNumber}. Total: ${total}`,
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
        html: `<p>${businessName} has a new ${order.orderType.replaceAll("_", " ")} order.</p><p><strong>#${orderNumber}</strong> · ${total}</p><p>Open the MealScout Orders workspace to confirm and prepare it.</p>`,
        text: `${businessName} has a new ${order.orderType.replaceAll("_", " ")} order. #${orderNumber} · ${total}. Open the MealScout Orders workspace to confirm and prepare it.`,
      }),
    );
  }
  await Promise.allSettled(sends);
}

export async function sendPickupOrderCancelledNotification(order: PickupOrder) {
  if (!order.customerEmail) return;
  const paidByCard = order.paymentMethod === "card";
  await sendOnce({
    orderId: order.id,
    type: "cancelled",
    recipient: order.customerEmail,
    subject: `MealScout order #${shortOrderId(order.id)} cancelled`,
    html: `<p>Hi ${order.customerName},</p><p>Your MealScout order <strong>#${shortOrderId(order.id)}</strong> was cancelled.</p><p>${paidByCard ? "Your payment refund has been started." : "No card payment was collected."}</p>`,
    text: `Hi ${order.customerName}, your MealScout order #${shortOrderId(order.id)} was cancelled. ${paidByCard ? "Your payment refund has been started." : "No card payment was collected."}`,
  });
}
