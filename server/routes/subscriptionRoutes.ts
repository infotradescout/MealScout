import type { Express } from "express";
import type Stripe from "stripe";

import { emailService } from "../emailService";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { db } from "../db";
import { and, eq } from "drizzle-orm";
import { restaurants, restaurantSubscriptions, type User } from "@shared/schema";

type LockedPriceResult = {
  locked: boolean;
  priceId: string;
  label: string;
};

type SubscriptionRouteDependencies = {
  stripe: Stripe | null;
  ensureTrialForUser: (user: User) => Promise<User | null | undefined>;
  isTrialActive: (user: User | null | undefined) => boolean;
  getLockedPriceForUser: (userId: string) => Promise<LockedPriceResult>;
};

async function userHasVerifiedBusiness(userId: string) {
  const restaurantsByOwner = await storage.getRestaurantsByOwner(userId);
  return restaurantsByOwner.some((restaurant) => restaurant.isVerified);
}

async function userHasLifetimeRestaurantAccess(userId: string): Promise<boolean> {
  const ownerId = String(userId || "").trim();
  if (!ownerId) return false;
  const rows = await db
    .select({ id: restaurantSubscriptions.id })
    .from(restaurantSubscriptions)
    .innerJoin(
      restaurants,
      eq(restaurantSubscriptions.restaurantId, restaurants.id),
    )
    .where(
      and(
        eq(restaurants.ownerId, ownerId),
        eq(restaurantSubscriptions.isLifetimeFree, true),
        eq(restaurantSubscriptions.canPostDeals, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function userHasDealPostingEntitlement(userId: string): Promise<boolean> {
  const ownerId = String(userId || "").trim();
  if (!ownerId) return false;

  const rows = await db
    .select({ id: restaurantSubscriptions.id })
    .from(restaurantSubscriptions)
    .innerJoin(
      restaurants,
      eq(restaurantSubscriptions.restaurantId, restaurants.id),
    )
    .where(
      and(
        eq(restaurants.ownerId, ownerId),
        eq(restaurantSubscriptions.canPostDeals, true),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

function hasAccountAgeTrialAccess(user: User | null): boolean {
  if (!user?.createdAt) return false;
  const createdAtMs = new Date(user.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  const trialEndsAtMs = createdAtMs + 30 * 24 * 60 * 60 * 1000;
  return trialEndsAtMs > Date.now();
}

export function registerSubscriptionRoutes(
  app: Express,
  {
    stripe,
    ensureTrialForUser,
    isTrialActive,
    getLockedPriceForUser,
  }: SubscriptionRouteDependencies,
) {
  app.post(
    "/api/subscriptions/initialize",
    isAuthenticated,
    async (req: any, res) => {
      const user = req.user;
      const { billingInterval = "month", promoCode = "" } = req.body;

      const testModeEnabled =
        String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() ===
          "true" || process.env.NODE_ENV !== "production";
      const testPromosRequireAdmin =
        String(process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() ===
        "true";
      const normalizedPromoCode = String(promoCode || "").trim().toUpperCase();
      const isTestDollarPromo =
        normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
      const isAdminUser = ["admin", "super_admin", "staff"].includes(
        String(user?.userType || ""),
      );

      console.log("=== Subscription Initialize Request ===");
      console.log("User ID:", user?.id);
      console.log("User Email:", user?.email);
      console.log("Promo Code:", promoCode);
      console.log("Billing Interval:", billingInterval);

      if (["restaurant_owner", "caterer", "food_truck"].includes(user?.userType)) {
        const hasVerified = await userHasVerifiedBusiness(user.id);
        if (!hasVerified) {
          return res.status(403).json({
            error: {
              message:
                "Verification is required before enabling premium features.",
            },
          });
        }
      }

      const hydratedUser = await ensureTrialForUser(user);
      if (isTrialActive(hydratedUser)) {
        return res.send({
          status: "active",
          subscriptionId: null,
          trialAccess: true,
          message:
            "Your 30-day premium trial is active. We'll prompt you to pay before it ends.",
        });
      }

      if (!stripe) {
        return res
          .status(503)
          .json({ error: { message: "Payment processing is not configured" } });
      }

      if (isTestDollarPromo) {
        if (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser)) {
          return res.status(403).json({ error: { message: "Not authorized" } });
        }
        if (!user.email) {
          return res
            .status(400)
            .json({ error: { message: "No user email on file" } });
        }
        return res.send({
          status: "quote",
          promo: normalizedPromoCode,
          testPricing: true,
          label: "$1 test plan",
          billingInterval: "month",
        });
      }

      if (!user.email) {
        return res
          .status(400)
          .json({ error: { message: "No user email on file" } });
      }

      try {
        const { locked, priceId, label } = await getLockedPriceForUser(user.id);
        if (!priceId.startsWith("price_")) {
          console.error(
            `[subscriptions/initialize] PRICE_MONTHLY_25 is "${priceId}" — not a valid Stripe price ID.`,
          );
          return res.status(503).json({
            error: {
              message:
                "Payment configuration error: invalid price ID. Please contact support.",
            },
          });
        }
        return res.send({
          status: "quote",
          priceId,
          locked,
          label,
          billingInterval: "month",
        });
      } catch (error: any) {
        console.error("Initialize quote error:", error);
        return res.status(503).json({
          error: {
            message: error.message || "Unable to provide pricing quote",
          },
        });
      }
    },
  );

  app.post("/api/create-subscription", isAuthenticated, async (req: any, res) => {
    const user = req.user;
    const {
      promoCode,
      billingInterval = "month",
      applyCreditsCents,
    } = req.body;

    const testModeEnabled =
      String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() === "true" ||
      process.env.NODE_ENV !== "production";
    const testPromosRequireAdmin =
      String(process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() ===
      "true";
    const normalizedPromoCode = String(promoCode || "").trim().toUpperCase();
    const isTestDollarPromo =
      normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
    const isAdminUser = ["admin", "super_admin", "staff"].includes(
      String(user?.userType || ""),
    );

    const hydratedUser = await ensureTrialForUser(user);
    if (isTrialActive(hydratedUser)) {
      return res.status(400).json({
        error: {
          message:
            "Your 30-day premium trial is already active. We'll prompt you to pay before it ends.",
        },
      });
    }

    if (["restaurant_owner", "caterer", "food_truck"].includes(user?.userType)) {
      const hasVerified = await userHasVerifiedBusiness(user.id);
      if (!hasVerified) {
        return res.status(403).json({
          error: {
            message:
              "Verification is required before enabling premium features.",
          },
        });
      }
    }

    if (isTestDollarPromo) {
      if (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser)) {
        return res.status(403).json({
          error: { message: "Not authorized" },
        });
      }
      if (!stripe) {
        return res.status(503).json({
          error: { message: "Payment service temporarily unavailable" },
        });
      }
      if (!user.email) {
        return res
          .status(400)
          .json({ error: { message: "No user email on file" } });
      }

      try {
        let customerId = user.stripeCustomerId;

        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name:
              user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.email,
          });
          customerId = customer.id;
        }

        const subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [
            {
              price_data: {
                currency: "usd",
                product: (
                  await stripe.products.create({ name: "MealScout Test $1" })
                ).id,
                unit_amount: 100,
                recurring: { interval: "month", interval_count: 1 },
              },
            },
          ],
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent"],
        });

        await storage.updateUserStripeInfo(
          user.id,
          customerId,
          subscription.id,
          `standard-${billingInterval}`,
        );

        const latestInvoice = subscription.latest_invoice;
        const paymentIntent =
          typeof latestInvoice === "object" && latestInvoice
            ? (latestInvoice as any).payment_intent
            : null;
        return res.send({
          subscriptionId: subscription.id,
          clientSecret:
            typeof paymentIntent === "object" && paymentIntent
              ? paymentIntent.client_secret
              : null,
          testPricing: true,
          message: "Test pricing applied - $1 charge",
        });
      } catch (error: any) {
        console.error("Error creating test subscription:", error);
        return res.status(400).send({ error: { message: error.message } });
      }
    }

    if (!stripe) {
      return res
        .status(503)
        .json({ error: { message: "Payment processing is not configured" } });
    }

    const validIntervals = ["month"];
    const interval = validIntervals.includes(billingInterval)
      ? billingInterval
      : "month";

    if (user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripeSubscriptionId,
          {
            expand: ["latest_invoice.payment_intent"],
          },
        );

        if (
          subscription.status === "incomplete" ||
          subscription.status === "incomplete_expired"
        ) {
          console.log(
            `Canceling incomplete subscription ${subscription.id} to create new one`,
          );
          await stripe.subscriptions.cancel(subscription.id);
          await storage.updateUser(user.id, { stripeSubscriptionId: null });
        } else {
          const latestInvoice = subscription.latest_invoice;
          const paymentIntent =
            typeof latestInvoice === "object" && latestInvoice
              ? (latestInvoice as any).payment_intent
              : null;

          res.send({
            subscriptionId: subscription.id,
            clientSecret:
              typeof paymentIntent === "object" && paymentIntent
                ? paymentIntent.client_secret
                : null,
          });
          return;
        }
      } catch (error) {
        console.error("Error retrieving subscription:", error);
      }
    }

    if (!user.email) {
      return res
        .status(400)
        .json({ error: { message: "No user email on file" } });
    }

    try {
      let customerId = user.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email,
        });
        customerId = customer.id;
      }

      let creditAppliedCents = 0;
      const requestedCreditCents = Number(applyCreditsCents || 0);
      if (requestedCreditCents > 0) {
        const { getUserCreditBalance, debitCredit } =
          await import("../creditService");
        const balance = await getUserCreditBalance(user.id);
        const availableCents = Math.max(0, Math.floor(balance * 100));
        creditAppliedCents = Math.min(requestedCreditCents, availableCents);

        if (creditAppliedCents > 0) {
          const balanceTx = await stripe.customers.createBalanceTransaction(
            customerId,
            {
              amount: -creditAppliedCents,
              currency: "usd",
              description: "MealScout credits applied",
            },
          );
          await debitCredit(
            user.id,
            creditAppliedCents / 100,
            "subscription_credit",
            balanceTx.id,
            "subscription",
          );
        }
      }

      if (!user.subscriptionSignupDate) {
        await storage.updateUser(user.id, {
          subscriptionSignupDate: new Date(),
        });
      }

      const { locked, priceId, label } = await getLockedPriceForUser(user.id);
      const amount = 2500;

      if (!priceId.startsWith("price_")) {
        console.error(
          `[create-subscription] PRICE_MONTHLY_25 is set to "${priceId}" which is not a valid Stripe price ID (must start with "price_"). Check the PRICE_MONTHLY_25 environment variable.`,
        );
        return res.status(503).json({
          error: {
            message:
              "Payment configuration error: invalid price ID. Please contact support.",
          },
        });
      }

      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
        metadata:
          creditAppliedCents > 0
            ? { creditAppliedCents: creditAppliedCents.toString() }
            : undefined,
      });

      await storage.updateUserStripeInfo(
        user.id,
        customerId,
        subscription.id,
        `standard-${interval}`,
      );

      const planType = `standard-${interval}`;
      emailService
        .sendPaymentConfirmation(user, amount, planType, subscription.id)
        .catch((err) =>
          console.error("Failed to send payment confirmation email:", err),
        );

      const latestInvoice = subscription.latest_invoice;
      const paymentIntent =
        typeof latestInvoice === "object" && latestInvoice
          ? (latestInvoice as any).payment_intent
          : null;
      res.send({
        subscriptionId: subscription.id,
        clientSecret:
          typeof paymentIntent === "object" && paymentIntent
            ? paymentIntent.client_secret
            : null,
        priceId,
        locked,
        label,
      });
    } catch (error: any) {
      console.error("Error creating subscription:", error);
      return res.status(400).send({ error: { message: error.message } });
    }
  });

  app.get("/api/subscription/status", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const user = await storage.getUser(req.user.id);
    if (!user) {
      return res.status(401).json({ status: "none", hasAccess: false });
    }

    const hydratedUser = await ensureTrialForUser(user);
    if (isTrialActive(hydratedUser)) {
      return res.json({
        status: "active",
        hasAccess: true,
        trialAccess: true,
        trialEndsAt: hydratedUser.trialEndsAt,
        message: "30-day premium trial active",
      });
    }

    if (hasAccountAgeTrialAccess(hydratedUser)) {
      return res.json({
        status: "active",
        hasAccess: true,
        trialAccess: true,
        message: "30-day premium trial active",
      });
    }

    if (await userHasLifetimeRestaurantAccess(req.user.id)) {
      return res.json({
        status: "active",
        hasAccess: true,
        lifetimeAccess: true,
        message: "Lifetime premium partner access active",
      });
    }

    if (await userHasDealPostingEntitlement(req.user.id)) {
      return res.json({
        status: "active",
        hasAccess: true,
        message: "Deal posting entitlement active",
      });
    }

    if (!stripe) {
      return res.status(503).json({ message: "Payment service unavailable" });
    }

    try {
      if (!hydratedUser?.stripeSubscriptionId) {
        return res.json({ status: "none", hasAccess: false });
      }

      const subscription = await stripe.subscriptions.retrieve(
        hydratedUser.stripeSubscriptionId,
      );
      const hasAccess = ["active", "trialing"].includes(subscription.status);

      res.json({
        status: subscription.status,
        hasAccess,
        currentPeriodEnd: (subscription as any).current_period_end,
        cancelAtPeriodEnd: (subscription as any).cancel_at_period_end,
      });
    } catch (error: any) {
      console.error("Subscription status error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post(
    "/api/subscription/customer-portal",
    isAuthenticated,
    async (req: any, res) => {
      if (!stripe) {
        return res.status(503).json({ message: "Payment service unavailable" });
      }

      try {
        const user = await storage.getUser(req.user.id);
        if (!user) {
          return res.status(401).json({ message: "Authentication required" });
        }
        if (!user.email) {
          return res
            .status(400)
            .json({ message: "No user email on file" });
        }

        let customerId = String(user.stripeCustomerId || "").trim();
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name:
              user.firstName && user.lastName
                ? `${user.firstName} ${user.lastName}`
                : user.email,
          });
          customerId = customer.id;
          await storage.updateUserStripeCustomerId(user.id, customerId);
        }

        const rawReturnPath = String(req.body?.returnPath || "").trim();
        const returnPath =
          rawReturnPath.startsWith("/") && !rawReturnPath.startsWith("//")
            ? rawReturnPath
            : "/subscription/manage";
        const baseUrl = (
          process.env.PUBLIC_BASE_URL ||
          (req.get("host") ? `${req.protocol}://${req.get("host")}` : "") ||
          "http://localhost:5000"
        ).replace(/\/+$/, "");

        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${baseUrl}${returnPath}`,
        });

        res.json({ url: portalSession.url });
      } catch (error: any) {
        console.error("Customer portal error:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to open billing portal" });
      }
    },
  );

  app.post("/api/subscription/pause", isAuthenticated, async (req: any, res) => {
    if (!stripe) {
      return res.status(503).json({ message: "Payment service unavailable" });
    }

    try {
      const user = req.user;
      if (!user.stripeSubscriptionId) {
        return res.status(400).json({ message: "No active subscription" });
      }

      const subscription = await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        {
          pause_collection: {
            behavior: "keep_as_draft",
          },
        },
      );

      res.json({
        message: "Subscription paused successfully",
        status: subscription.status,
      });
    } catch (error: any) {
      console.error("Pause subscription error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/subscription/cancel", isAuthenticated, async (req: any, res) => {
    if (!stripe) {
      return res.status(503).json({ message: "Payment service unavailable" });
    }

    try {
      const user = req.user;
      if (!user.stripeSubscriptionId) {
        return res.status(400).json({ message: "No active subscription" });
      }

      // Cancel at period end so the user keeps access until their paid period expires.
      // The customer.subscription.deleted webhook will clear stripeSubscriptionId,
      // deactivate restaurantSubscriptions, and deactivate deals when Stripe fires it.
      const subscription = await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        { cancel_at_period_end: true },
      );

      res.json({
        message: "Subscription will cancel at the end of the current billing period. You keep full access until then.",
        cancelAt: (subscription as any).cancel_at ?? null,
        currentPeriodEnd: (subscription as any).current_period_end ?? null,
      });
    } catch (error: any) {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
