import type { Express } from "express";
import Stripe from "stripe";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";
import { db } from "../../db";
import {
  eventBookings,
  events,
  eventSeries,
  foodTruckLocations,
  foodTruckSessions,
  restaurants,
} from "@shared/schema";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export function registerAdminCoreOpsRoutes(app: Express) {
  app.get(
    "/api/admin/stats",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const stats = await storage.getAdminStats();
        res.json(stats);
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ message: "Failed to fetch stats" });
      }
    },
  );

  app.get(
    "/api/admin/dashboard-totals",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const statsPromise = storage.getAdminStats();
        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const upcoming7d = new Date(today);
        upcoming7d.setDate(upcoming7d.getDate() + 7);
        const liveSince = new Date(Date.now() - 15 * 60 * 1000);

        const operationsPromise = (async () => {
          try {
            const [
              seriesTotals,
              seriesPublishedTotals,
              bookingsTodayTotals,
              bookings7dTotals,
              openCallCapacity7dRows,
              openCallAccepted7dRows,
              liveTruckTotals,
              activeSessionTotals,
              paymentHealth,
            ] = await Promise.all([
              db
                .select({
                  total: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventSeries)
                .where(eq(eventSeries.seriesType, "parking_pass" as any)),
              db
                .select({
                  published: sql<number>`count(*)`.mapWith(Number),
                  publishedHosts:
                    sql<number>`count(distinct ${eventSeries.hostId})`.mapWith(
                      Number,
                    ),
                  spotCapacity:
                    sql<number>`coalesce(sum(${eventSeries.defaultMaxTrucks}), 0)`.mapWith(
                      Number,
                    ),
                })
                .from(eventSeries)
                .where(
                  and(
                    eq(eventSeries.seriesType, "parking_pass" as any),
                    eq(eventSeries.status, "published" as any),
                  ),
                ),
              db
                .select({
                  count: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventBookings)
                .innerJoin(events, eq(events.id, eventBookings.eventId))
                .where(
                  and(
                    eq(events.eventType, "parking_pass" as any),
                    gte(events.date, today),
                    lt(events.date, tomorrow),
                    eq(eventBookings.status, "confirmed" as any),
                  ),
                ),
              db
                .select({
                  count: sql<number>`count(*)`.mapWith(Number),
                })
                .from(eventBookings)
                .innerJoin(events, eq(events.id, eventBookings.eventId))
                .where(
                  and(
                    eq(events.eventType, "parking_pass" as any),
                    gte(events.date, today),
                    lt(events.date, upcoming7d),
                    eq(eventBookings.status, "confirmed" as any),
                  ),
                ),
              db.execute(sql`
                select coalesce(sum(e.max_trucks), 0)::int as capacity_total
                from events e
                inner join event_series s on s.id = e.series_id
                where s.series_type in ('event', 'open_call')
                  and e.date >= ${today}
                  and e.date < ${upcoming7d}
                  and e.status in ('open', 'booked')
              `),
              db.execute(sql`
                select count(*)::int as accepted_total
                from event_interests i
                inner join events e on e.id = i.event_id
                inner join event_series s on s.id = e.series_id
                where i.status = 'accepted'
                  and s.series_type in ('event', 'open_call')
                  and e.date >= ${today}
                  and e.date < ${upcoming7d}
                  and e.status in ('open', 'booked')
              `),
              db
                .select({
                  live: sql<number>`count(distinct ${foodTruckLocations.restaurantId})`.mapWith(
                    Number,
                  ),
                })
                .from(foodTruckLocations)
                .where(gte(foodTruckLocations.recordedAt, liveSince)),
              db
                .select({
                  active:
                    sql<number>`count(distinct ${foodTruckSessions.restaurantId})`.mapWith(
                      Number,
                    ),
                })
                .from(foodTruckSessions)
                .where(
                  and(
                    eq(foodTruckSessions.isActive, true),
                    isNull(foodTruckSessions.endedAt),
                  ),
                ),
              getPaymentHealthSnapshot().catch((error) => {
                console.error(
                  "[admin] Failed to compute payment health totals:",
                  error,
                );
                return null;
              }),
            ]);

            const openCallCapacityRow = Array.isArray(
              (openCallCapacity7dRows as any)?.rows,
            )
              ? (openCallCapacity7dRows as any).rows[0]
              : Array.isArray(openCallCapacity7dRows)
                ? (openCallCapacity7dRows as any)[0]
                : null;
            const openCallAcceptedRow = Array.isArray(
              (openCallAccepted7dRows as any)?.rows,
            )
              ? (openCallAccepted7dRows as any).rows[0]
              : Array.isArray(openCallAccepted7dRows)
                ? (openCallAccepted7dRows as any)[0]
                : null;
            const openCallCapacity7d = Number(
              openCallCapacityRow?.capacity_total || 0,
            );
            const openCallAccepted7d = Number(
              openCallAcceptedRow?.accepted_total || 0,
            );
            const openCallFillRate7dPct =
              openCallCapacity7d > 0
                ? Number(
                    ((openCallAccepted7d / openCallCapacity7d) * 100).toFixed(
                      2,
                    ),
                  )
                : 0;

            return {
              parkingPass: {
                seriesTotal: Number(seriesTotals?.[0]?.total ?? 0),
                seriesPublished: Number(
                  seriesPublishedTotals?.[0]?.published ?? 0,
                ),
                hostsPublished: Number(
                  seriesPublishedTotals?.[0]?.publishedHosts ?? 0,
                ),
                spotCapacityPublished: Number(
                  seriesPublishedTotals?.[0]?.spotCapacity ?? 0,
                ),
              },
              openCalls: {
                acceptedNext7Days: openCallAccepted7d,
                capacityNext7Days: openCallCapacity7d,
                fillRateNext7DaysPct: openCallFillRate7dPct,
              },
              bookings: {
                parkingPassConfirmedToday: Number(
                  bookingsTodayTotals?.[0]?.count ?? 0,
                ),
                parkingPassConfirmedNext7Days: Number(
                  bookings7dTotals?.[0]?.count ?? 0,
                ),
                pendingCheckoutHolds: Number(
                  paymentHealth?.counts?.pendingTotal ?? 0,
                ),
                staleCheckoutHolds: Number(
                  paymentHealth?.counts?.pendingExpired ?? 0,
                ),
                failedPaymentsLast24h: Number(
                  paymentHealth?.counts?.failedLast24h ?? 0,
                ),
                confirmedLast24h: Number(
                  paymentHealth?.counts?.confirmedLast24h ?? 0,
                ),
              },
              trucks: {
                liveTrucks15m: Number(liveTruckTotals?.[0]?.live ?? 0),
                activeSessions: Number(activeSessionTotals?.[0]?.active ?? 0),
              },
            };
          } catch (error) {
            console.error(
              "[admin] Failed to compute operations totals:",
              error,
            );
            return null;
          }
        })();

        const stats = await statsPromise;
        const operations = await operationsPromise;
        const roleTotal = Number(stats.memberCountsTotal || 0);
        const totalUsers = Number(stats.totalUsers || 0);
        const isConsistent = roleTotal <= totalUsers;

        res.json({
          generatedAt: new Date().toISOString(),
          totals: stats,
          operations,
          consistency: {
            roleTotal,
            totalUsers,
            unclassifiedUsers: Math.max(0, totalUsers - roleTotal),
            rolesWithinUserTotal: isConsistent,
          },
        });
      } catch (error) {
        console.error("Error fetching dashboard totals:", error);
        res.status(500).json({ message: "Failed to fetch dashboard totals" });
      }
    },
  );

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
        const sanitized = sanitizeUsers(users, { includeStripe: true });

        // Attach business name from restaurants table (left join by owner_id)
        const restaurantRows = await db
          .select({ ownerId: restaurants.ownerId, name: restaurants.name })
          .from(restaurants);
        const restaurantByOwner = new Map<string, string>();
        for (const r of restaurantRows) {
          if (r.ownerId && !restaurantByOwner.has(r.ownerId)) {
            restaurantByOwner.set(r.ownerId, r.name);
          }
        }

        const withBusiness = sanitized.map((u: any) => ({
          ...u,
          businessName: u.businessName || restaurantByOwner.get(u.id) || null,
        }));

        res.json(withBusiness);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    },
  );
}
