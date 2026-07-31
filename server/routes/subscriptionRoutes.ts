import type { Express } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { restaurantSubscriptions } from "@shared/schema";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";

type SubscriptionRouteDependencies = {
  stripe: Stripe | null;
};

const profileAccessStatus = (extra: Record<string, unknown> = {}) => ({
  status: "active",
  hasAccess: true,
  trialAccess: true,
  universalTrial: true,
  trialEndsAt: null,
  subscriptionRequired: false,
  cardRequired: false,
  convertsToPaid: false,
  monthlyBilling: false,
  message: "Free trial access stays active with no expiration or monthly bill.",
  ...extra,
});

/**
 * Compatibility routes for clients that still call the former subscription
 * endpoints. These routes can never create a recurring charge. The only
 * Stripe mutation left here lets an owner immediately stop a legacy MealScout
 * subscription while their complete profile access remains active.
 */
export function registerSubscriptionRoutes(
  app: Express,
  { stripe }: SubscriptionRouteDependencies,
) {
  app.post(
    "/api/subscriptions/initialize",
    isAuthenticated,
    async (_req: any, res) => {
      res.json(profileAccessStatus());
    },
  );

  app.post(
    "/api/create-subscription",
    isAuthenticated,
    async (_req: any, res) => {
      res.json(profileAccessStatus());
    },
  );

  app.get(
    "/api/subscription/status",
    isAuthenticated,
    async (req: any, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(401).json({ status: "none", hasAccess: false });
      }

      return res.json(
        profileAccessStatus({
          legacySubscriptionPresent: Boolean(
            String(user.stripeSubscriptionId || "").trim(),
          ),
        }),
      );
    },
  );

  app.post(
    "/api/subscription/pause",
    isAuthenticated,
    async (_req: any, res) => {
      res.status(409).json(
        profileAccessStatus({
          message:
            "MealScout no longer offers monthly subscriptions, so there is no profile plan to pause.",
        }),
      );
    },
  );

  app.post(
    "/api/subscription/cancel",
    isAuthenticated,
    async (req: any, res) => {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(401).json({ status: "none", hasAccess: false });
      }

      const legacySubscriptionId = String(
        user.stripeSubscriptionId || "",
      ).trim();
      if (!legacySubscriptionId) {
        return res.json(profileAccessStatus({ legacySubscriptionCanceled: false }));
      }

      if (!stripe) {
        return res.status(503).json(
          profileAccessStatus({
            legacySubscriptionPresent: true,
            message:
              "Your profile access is free and active. The legacy recurring charge could not be stopped because billing service is unavailable.",
          }),
        );
      }

      try {
        await stripe.subscriptions.cancel(legacySubscriptionId);
      } catch (error: any) {
        if (String(error?.code || "") !== "resource_missing") {
          console.error("Legacy MealScout subscription cancellation failed", {
            userId: user.id,
            legacySubscriptionId,
            error: error?.message || error,
          });
          return res.status(502).json(
            profileAccessStatus({
              legacySubscriptionPresent: true,
              message:
                "Your profile access is free and active, but the legacy recurring charge could not be stopped. Please try again.",
            }),
          );
        }
      }

      await db
        .update(restaurantSubscriptions)
        .set({
          status: "canceled",
          canceledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          eq(
            restaurantSubscriptions.stripeSubscriptionId,
            legacySubscriptionId,
          ),
        );
      await storage.updateUser(user.id, {
        stripeSubscriptionId: null,
        subscriptionBillingInterval: null,
      });

      return res.json(
        profileAccessStatus({
          legacySubscriptionCanceled: true,
          message:
            "The legacy recurring charge was stopped. Your complete profile access remains active.",
        }),
      );
    },
  );
}
