import type { Express } from "express";
import crypto from "crypto";
import Stripe from "stripe";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";
import { db } from "../../db";
import { emailService, isEmailConfigured } from "../../emailService";
import { sendAdminDailyDigest } from "../../services/adminDailyDigest";
import { sendOwnerDiscoverabilityAlerts } from "../../services/ownerDiscoverabilityAlerts";
import {
  eventBookings,
  events,
  eventSeries,
  foodTruckLocations,
  foodTruckSessions,
  users,
  restaurants,
  menus,
  menuItems,
  menuImportLogs,
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
    "/api/admin/restaurants/search",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const query = String(req.query.q || "")
          .trim()
          .toLowerCase();
        const limit = Math.max(
          1,
          Math.min(
            50,
            Number.parseInt(String(req.query.limit || "25"), 10) || 25,
          ),
        );

        if (query.length < 2) {
          return res.json([]);
        }

        const pattern = `%${query.replace(/[%_]/g, "\\$&")}%`;
        const rows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            cuisineType: restaurants.cuisineType,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
            createdAt: restaurants.createdAt,
            ownerEmail: users.email,
          })
          .from(restaurants)
          .leftJoin(users, eq(restaurants.ownerId, users.id))
          .where(
            sql`
            lower(coalesce(${restaurants.name}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.cuisineType}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.address}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.city}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${restaurants.state}, '')) like ${pattern} escape '\\'
            or lower(coalesce(${users.email}, '')) like ${pattern} escape '\\'
          `,
          )
          .orderBy(desc(restaurants.createdAt))
          .limit(limit);

        res.json(rows);
      } catch (error) {
        console.error("Error searching restaurants:", error);
        res.status(500).json({ message: "Failed to search restaurants" });
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

  app.post(
    "/api/admin/restaurants/:id/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const reason =
          String(req.body?.reason || "").trim() ||
          "Rejected from admin restaurant approval queue.";
        await storage.rejectRestaurant(req.params.id, req.user?.id || null, reason);
        res.json({ message: "Restaurant rejected successfully" });
      } catch (error) {
        console.error("Error rejecting restaurant:", error);
        res.status(500).json({ message: "Failed to reject restaurant" });
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
      } catch (error: any) {
        console.error("Error deleting restaurant:", error);
        if (String(error?.code || "") === "23503") {
          return res.status(409).json({
            message:
              "This restaurant has related records and cannot be deleted. Reject or deactivate it instead.",
          });
        }
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

  // ── Launch Week ──────────────────────────────────────────────────────────────
  // Operator-friendly snapshot of new business signups + their setup state.
  // Designed for non-technical owners to triage support during launch week.
  // GET /api/admin/launch-week?days=7
  app.get(
    "/api/admin/launch-week",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const days = Math.min(90, Math.max(1, Number(req.query?.days) || 7));
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const today = new Date(Date.now() - 24 * 60 * 60 * 1000);

        // New business owner accounts in the window
        const newOwners = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            userType: users.userType,
            emailVerified: users.emailVerified,
            createdAt: users.createdAt,
            stripeSubscriptionId: users.stripeSubscriptionId,
            trialEndsAt: users.trialEndsAt,
          })
          .from(users)
          .where(
            and(
              gte(users.createdAt, cutoff),
              sql`${users.userType} IN ('restaurant_owner','food_truck')`,
            ),
          )
          .orderBy(sql`${users.createdAt} DESC`)
          .limit(500);

        // Their restaurants (joined separately to avoid Cartesian)
        const ownerIds = newOwners.map((o: any) => o.id);
        const restaurantsForOwners = ownerIds.length
          ? await db
              .select({
                id: restaurants.id,
                ownerId: restaurants.ownerId,
                name: restaurants.name,
                businessType: restaurants.businessType,
                city: restaurants.city,
                state: restaurants.state,
                isVerified: restaurants.isVerified,
                isActive: restaurants.isActive,
                createdAt: restaurants.createdAt,
              })
              .from(restaurants)
              .where(inArray(restaurants.ownerId, ownerIds))
          : [];

        // Menu + item counts per restaurant (1 query)
        const restaurantIds = restaurantsForOwners.map((r: any) => r.id);
        const menuCounts = restaurantIds.length
          ? await db
              .select({
                restaurantId: menus.restaurantId,
                menuCount: sql<number>`count(distinct ${menus.id})::int`,
                itemCount: sql<number>`count(${menuItems.id})::int`,
              })
              .from(menus)
              .leftJoin(menuItems, eq(menuItems.menuId, menus.id))
              .where(inArray(menus.restaurantId, restaurantIds))
              .groupBy(menus.restaurantId)
          : [];
        const countsByRestaurant = new Map<
          string,
          { menuCount: number; itemCount: number }
        >();
        for (const c of menuCounts as any[]) {
          countsByRestaurant.set(c.restaurantId, {
            menuCount: Number(c.menuCount || 0),
            itemCount: Number(c.itemCount || 0),
          });
        }

        const importRows = restaurantIds.length
          ? await db
              .select({
                restaurantId: menuImportLogs.restaurantId,
                source: menuImportLogs.source,
                status: menuImportLogs.status,
                itemsImported: menuImportLogs.itemsImported,
                itemsSkipped: menuImportLogs.itemsSkipped,
                errors: menuImportLogs.errors,
                createdAt: menuImportLogs.createdAt,
              })
              .from(menuImportLogs)
              .where(
                and(
                  inArray(menuImportLogs.restaurantId, restaurantIds),
                  gte(menuImportLogs.createdAt, cutoff),
                ),
              )
              .orderBy(desc(menuImportLogs.createdAt))
          : [];
        const importsByRestaurant = new Map<
          string,
          {
            attempts: number;
            failed: number;
            lastFailure: {
              source: string;
              status: string;
              itemsImported: number;
              itemsSkipped: number;
              errorCount: number;
              createdAt: Date | null;
            } | null;
          }
        >();
        for (const row of importRows as any[]) {
          const current = importsByRestaurant.get(row.restaurantId) || {
            attempts: 0,
            failed: 0,
            lastFailure: null,
          };
          const itemsImported = Number(row.itemsImported || 0);
          const failed =
            row.status === "failed" ||
            (row.status === "complete" && itemsImported === 0);
          current.attempts += 1;
          if (failed) {
            current.failed += 1;
            if (!current.lastFailure) {
              current.lastFailure = {
                source: row.source || "unknown",
                status: row.status || "unknown",
                itemsImported,
                itemsSkipped: Number(row.itemsSkipped || 0),
                errorCount: Array.isArray(row.errors) ? row.errors.length : 0,
                createdAt: row.createdAt || null,
              };
            }
          }
          importsByRestaurant.set(row.restaurantId, current);
        }

        const restaurantsByOwner = new Map<string, any[]>();
        for (const r of restaurantsForOwners as any[]) {
          const counts = countsByRestaurant.get(r.id) || {
            menuCount: 0,
            itemCount: 0,
          };
          const imports = importsByRestaurant.get(r.id) || {
            attempts: 0,
            failed: 0,
            lastFailure: null,
          };
          const enriched = {
            ...r,
            ...counts,
            publicPreviewUrl: `/restaurant/${r.id}`,
            importAttempts: imports.attempts,
            failedImports: imports.failed,
            lastImportFailure: imports.lastFailure,
          };
          const arr = restaurantsByOwner.get(r.ownerId) || [];
          arr.push(enriched);
          restaurantsByOwner.set(r.ownerId, arr);
        }

        const rows = newOwners.map((o: any) => {
          const owned = restaurantsByOwner.get(o.id) || [];
          const totalMenus = owned.reduce(
            (s: number, r: any) => s + (r.menuCount || 0),
            0,
          );
          const totalItems = owned.reduce(
            (s: number, r: any) => s + (r.itemCount || 0),
            0,
          );
          const totalFailedImports = owned.reduce(
            (s: number, r: any) => s + (r.failedImports || 0),
            0,
          );
          // Setup score = simple checklist for triage
          const checklist = {
            emailVerified: !!o.emailVerified,
            hasBusiness: owned.length > 0,
            hasMenu: totalMenus > 0,
            hasItems: totalItems > 0,
            isVerified: owned.some((r: any) => r.isVerified),
            hasSubscription: !!o.stripeSubscriptionId,
          };
          const score = Object.values(checklist).filter(Boolean).length;
          return {
            ...o,
            restaurants: owned,
            totalMenus,
            totalItems,
            totalFailedImports,
            checklist,
            setupScore: score,
            stuck:
              score < 3 &&
              new Date(o.createdAt).getTime() < Date.now() - 6 * 60 * 60 * 1000,
          };
        });

        // Aggregate counters
        const summary = {
          windowDays: days,
          totalNewOwners: rows.length,
          newToday: rows.filter((r: any) => new Date(r.createdAt) >= today)
            .length,
          unverifiedEmails: rows.filter((r: any) => !r.emailVerified).length,
          noBusinessYet: rows.filter((r: any) => !r.checklist.hasBusiness)
            .length,
          noMenuYet: rows.filter(
            (r: any) => r.checklist.hasBusiness && !r.checklist.hasMenu,
          ).length,
          failedImports: rows.filter((r: any) => r.totalFailedImports > 0)
            .length,
          stuck: rows.filter((r: any) => r.stuck).length,
          subscribed: rows.filter((r: any) => r.checklist.hasSubscription)
            .length,
          byType: {
            restaurant_owner: rows.filter(
              (r: any) => r.userType === "restaurant_owner",
            ).length,
            food_truck: rows.filter((r: any) => r.userType === "food_truck")
              .length,
          },
        };

        res.json({ summary, owners: rows });
      } catch (error: any) {
        console.error("[admin/launch-week] failed:", error);
        res.status(500).json({
          message: "Failed to load launch-week snapshot",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/digest/send
  // Manual trigger for the daily digest so admins can verify email delivery.
  app.post(
    "/api/admin/launch-week/digest/send",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const result = await sendAdminDailyDigest();
        console.log(
          `[admin/launch-week/digest] requested by=${req.user?.id || req.user?.claims?.sub || "admin"} sent=${result.sent} reason=${result.reason || "ok"}`,
        );

        if (!result.sent) {
          const status = result.reason === "email_not_configured" ? 503 : 400;
          return res.status(status).json({
            ok: false,
            message:
              result.reason === "email_not_configured"
                ? "Email provider not configured"
                : "Daily digest was not sent",
            reason: result.reason,
            snapshot: result.snapshot,
          });
        }

        res.json({ ok: true, snapshot: result.snapshot });
      } catch (error: any) {
        console.error("[admin/launch-week/digest] failed:", error);
        res.status(500).json({
          message: "Failed to send daily digest",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/alerts/discoverability/run
  // Manual trigger for the hourly discoverability alert scan.
  app.post(
    "/api/admin/launch-week/alerts/discoverability/run",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const result = await sendOwnerDiscoverabilityAlerts();
        console.log(
          `[admin/launch-week/discoverability-alert] requested by=${req.user?.id || req.user?.claims?.sub || "admin"} sent=${result.sent} reason=${result.reason || "ok"} considered=${result.considered} alerted=${result.alerted}`,
        );
        res.json({ ok: true, ...result });
      } catch (error: any) {
        console.error(
          "[admin/launch-week/discoverability-alert] failed:",
          error,
        );
        res.status(500).json({
          message: "Failed to run discoverability alert scan",
          error: String(error?.message || error),
        });
      }
    },
  );

  // POST /api/admin/launch-week/owners/:userId/action
  // Body: { action: "resend-verification" | "send-menu-nudge" | "send-help-offer" | "verify-restaurants" }
  // One-click triage actions for owners flagged on the Launch Week dashboard.
  app.post(
    "/api/admin/launch-week/owners/:userId/action",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const userId = String(req.params.userId);
        const action = String(req.body?.action || "");
        const validActions = new Set([
          "resend-verification",
          "send-menu-nudge",
          "send-help-offer",
          "verify-restaurants",
        ]);
        if (!validActions.has(action)) {
          return res.status(400).json({ message: "Invalid action" });
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        const requiresEmail =
          action === "resend-verification" ||
          action === "send-menu-nudge" ||
          action === "send-help-offer";
        if (requiresEmail && !user.email) {
          return res.status(400).json({
            message: "User has no email on file",
          });
        }

        const adminId = req.user?.id || req.user?.claims?.sub || "admin";
        const baseUrl = (
          process.env.PUBLIC_BASE_URL ||
          `${req.protocol}://${req.get("host")}` ||
          "http://localhost:5000"
        ).replace(/\/+$/, "");

        if (action === "resend-verification") {
          if (user.emailVerified) {
            return res.json({ ok: true, skipped: "already_verified" });
          }
          if (!isEmailConfigured()) {
            return res
              .status(503)
              .json({ message: "Email provider not configured" });
          }
          const token = crypto.randomBytes(32).toString("hex");
          const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
          await storage.createEmailVerificationToken({
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            requestIp: req.ip || undefined,
            userAgent: req.get("User-Agent") || undefined,
          });
          const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
          const ok = await emailService.sendEmailVerificationEmail(
            user as any,
            verifyUrl,
          );
          console.log(
            `[admin/launch-week] resend-verification by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        if (action === "send-menu-nudge") {
          const firstName = user.firstName || "there";
          const dashUrl = `${baseUrl}/restaurant/dashboard`;
          const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
              <h2>Hi ${firstName}, ready to add your menu?</h2>
              <p>Welcome to MealScout! The fastest way to start getting discovered is to add your menu \u2014 it takes about 2 minutes.</p>
              <p>You can paste a link to your existing website menu, Google profile, Yelp page, or another public menu and we will import the items automatically.</p>
              <p style="margin: 16px 0;">
                <a href="${dashUrl}" style="background:#f97316;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;">
                  Add Your Menu
                </a>
              </p>
              <p>Stuck? Just reply to this email and we will help you import it.</p>
              <p style="color:#6b7280;font-size:12px;">\u2014 The MealScout team</p>
            </div>
          `;
          const text = `Hi ${firstName}, ready to add your menu? Visit ${dashUrl} to get started, or reply to this email and we'll help.`;
          const ok = await emailService.sendBasicEmail(
            user.email,
            "Ready to add your menu? \uD83C\uDF7D\uFE0F",
            html,
            text,
            "general",
          );
          console.log(
            `[admin/launch-week] menu-nudge by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        if (action === "send-help-offer") {
          const firstName = user.firstName || "there";
          const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
              <h2>Hi ${firstName}, want us to set it up for you?</h2>
              <p>I noticed you signed up for MealScout but haven't added a menu yet. No problem \u2014 we can do it for you.</p>
              <p>Just reply to this email with a link to your existing website menu, Google profile, Yelp page, or another public menu and we'll import everything for you within 24 hours.</p>
              <p>Or if you'd rather, reply with a phone number and we'll call to walk you through it.</p>
              <p style="color:#6b7280;font-size:12px;">\u2014 The MealScout team</p>
            </div>
          `;
          const text = `Hi ${firstName}, reply with a link to your menu (website, Google, Yelp, or another public menu) and we'll import it for you within 24 hours. Or send a phone number and we'll call.`;
          const ok = await emailService.sendBasicEmail(
            user.email,
            "Want us to set up your menu for you?",
            html,
            text,
            "general",
          );
          console.log(
            `[admin/launch-week] help-offer by=${adminId} to=${user.email} ok=${ok}`,
          );
          return res.json({ ok });
        }

        if (action === "verify-restaurants") {
          const result = await db
            .update(restaurants)
            .set({ isVerified: true, isActive: true })
            .where(eq(restaurants.ownerId, user.id))
            .returning({ id: restaurants.id });
          console.log(
            `[admin/launch-week] verify-restaurants by=${adminId} owner=${user.id} count=${result.length}`,
          );
          return res.json({ ok: true, verified: result.length });
        }

        return res.status(400).json({ message: "Unhandled action" });
      } catch (error: any) {
        console.error("[admin/launch-week/action] failed:", error);
        res.status(500).json({
          message: "Action failed",
          error: String(error?.message || error),
        });
      }
    },
  );
}
