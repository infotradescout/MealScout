import type { Express } from "express";
import Stripe from "stripe";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export function registerAdminCoreOpsRoutes(app: Express) {
  app.get(
    "/api/admin/payments/health",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const snapshot = await getPaymentHealthSnapshot();
        res.json(snapshot);
      } catch (error) {
        console.error("Error fetching payment health:", error);
        res.status(500).json({ message: "Failed to fetch payment health" });
      }
    },
  );

  // Admin endpoint to sync subscriptions from Stripe to database
  app.post(
    "/api/admin/subscriptions/sync",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        if (!stripe) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const results = {
          synced: 0,
          skipped: 0,
          errors: 0,
          details: [] as any[],
        };

        const allUsers = await storage.getAllUsers();
        const usersWithStripe = allUsers.filter((u) => u.stripeCustomerId);

        console.log(
          `[ADMIN SYNC] Found ${usersWithStripe.length} users with Stripe customer IDs`,
        );

        for (const user of usersWithStripe) {
          try {
            if (user.stripeSubscriptionId) {
              results.skipped++;
              continue;
            }

            const subscriptions = await stripe.subscriptions.list({
              customer: user.stripeCustomerId!,
              status: "active",
              limit: 1,
            });

            if (subscriptions.data.length > 0) {
              const subscription = subscriptions.data[0];
              const interval =
                subscription.items.data[0]?.price?.recurring?.interval;
              const intervalCount =
                subscription.items.data[0]?.price?.recurring?.interval_count ||
                1;

              let billingInterval = "month";
              if (interval === "month" && intervalCount === 3) {
                billingInterval = "quarter";
              } else if (interval === "year") {
                billingInterval = "year";
              }

              await storage.updateUserStripeInfo(
                user.id,
                user.stripeCustomerId!,
                subscription.id,
                `standard-${billingInterval}`,
              );

              results.synced++;
              results.details.push({
                userId: user.id,
                email: user.email,
                subscriptionId: subscription.id,
                billingInterval: `standard-${billingInterval}`,
                status: "synced",
              });

              console.log(
                `[ADMIN SYNC] Synced subscription ${subscription.id} for user ${user.email}`,
              );
            } else {
              results.skipped++;
            }
          } catch (error: any) {
            results.errors++;
            results.details.push({
              userId: user.id,
              email: user.email,
              error: error.message,
              status: "error",
            });
            console.error(
              `[ADMIN SYNC] Error syncing user ${user.email}:`,
              error,
            );
          }
        }

        console.log(
          `[ADMIN SYNC] Complete: ${results.synced} synced, ${results.skipped} skipped, ${results.errors} errors`,
        );
        res.json(results);
      } catch (error) {
        console.error("Error syncing subscriptions:", error);
        res.status(500).json({ message: "Failed to sync subscriptions" });
      }
    },
  );

  app.get(
    "/api/admin/restaurants/pending",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const restaurants = await storage.getPendingRestaurants();
        res.json(restaurants);
      } catch (error) {
        console.error("Error fetching pending restaurants:", error);
        res
          .status(500)
          .json({ message: "Failed to fetch pending restaurants" });
      }
    },
  );

  app.post(
    "/api/admin/restaurants/:id/approve",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.approveRestaurant(req.params.id);
        res.json({ message: "Restaurant approved successfully" });
      } catch (error) {
        console.error("Error approving restaurant:", error);
        res.status(500).json({ message: "Failed to approve restaurant" });
      }
    },
  );

  app.delete(
    "/api/admin/restaurants/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await storage.deleteRestaurant(req.params.id);
        res.json({ message: "Restaurant deleted successfully" });
      } catch (error) {
        console.error("Error deleting restaurant:", error);
        res.status(500).json({ message: "Failed to delete restaurant" });
      }
    },
  );

  app.get(
    "/api/admin/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const users = await storage.getAllUsers();
        res.json(sanitizeUsers(users, { includeStripe: true }));
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    },
  );
}
