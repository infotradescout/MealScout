import { users, type User } from "@shared/schema";
import { db } from "../db";
import { eq, and, or, isNull } from "drizzle-orm";

// ── Payments / Subscriptions Repository ──────────────────────────────────────
// Owns all Stripe customer/subscription write and lookup persistence.

export function createPaymentsSubscriptionsRepository() {
  return {
    async updateUserStripeCustomerId(userId: string, customerId: string): Promise<void> {
      await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
    },

    async updateUserStripeInfo(
      id: string,
      stripeCustomerId: string,
      stripeSubscriptionId: string,
      subscriptionBillingInterval?: string,
    ): Promise<User> {
      const [user] = await db
        .update(users)
        .set({ stripeCustomerId, stripeSubscriptionId, subscriptionBillingInterval, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return user;
    },

    async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.stripeCustomerId, stripeCustomerId), or(eq(users.isDisabled, false), isNull(users.isDisabled))));
      return user;
    },

    async getUserByStripeSubscriptionId(stripeSubscriptionId: string): Promise<User | undefined> {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.stripeSubscriptionId, stripeSubscriptionId), or(eq(users.isDisabled, false), isNull(users.isDisabled))));
      return user;
    },
  };
}
