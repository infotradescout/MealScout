import type { Express } from "express";
import Stripe from "stripe";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";
import { emailService } from "../../emailService";
import { isAdminUserType } from "../../roleAccess";
import { db } from "../../db";
import {
  eventBookings,
  events,
  eventSeries,
  foodTruckLocations,
  foodTruckSessions,
  restaurants,
  userAddresses,
} from "@shared/schema";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const normalizeSearch = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const isGeneralEmailAllowed = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const channels =
    settings?.notifications?.channels &&
    typeof settings.notifications.channels === "object"
      ? (settings.notifications.channels as Record<string, any>)
      : null;
  return typeof channels?.email === "boolean" ? channels.email : true;
};

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const bodyToHtml = (body: string) =>
  body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${htmlEscape(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");

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
        const allUsers = await storage.getAllUsers();
        const sanitized = sanitizeUsers(allUsers, { includeStripe: true });

        // Attach business name from restaurants table (left join by owner_id)
        const restaurantRows = await db
          .select({
            ownerId: restaurants.ownerId,
            name: restaurants.name,
            city: restaurants.city,
            state: restaurants.state,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
          })
          .from(restaurants);
        const restaurantByOwner = new Map<string, any>();
        for (const r of restaurantRows) {
          if (r.ownerId && !restaurantByOwner.has(r.ownerId)) {
            restaurantByOwner.set(r.ownerId, r);
          }
        }

        const addressRows = await db
          .select({
            userId: userAddresses.userId,
            city: userAddresses.city,
            state: userAddresses.state,
            postalCode: userAddresses.postalCode,
            isDefault: userAddresses.isDefault,
          })
          .from(userAddresses);
        const defaultAddressByUser = new Map<string, any>();
        for (const address of addressRows) {
          if (!address.userId) continue;
          if (address.isDefault || !defaultAddressByUser.has(address.userId)) {
            defaultAddressByUser.set(address.userId, address);
          }
        }

        const withBusiness = sanitized.map((u: any) => ({
          ...u,
          businessName:
            u.businessName || restaurantByOwner.get(u.id)?.name || null,
          businessCity: restaurantByOwner.get(u.id)?.city || null,
          businessState: restaurantByOwner.get(u.id)?.state || null,
          businessType: restaurantByOwner.get(u.id)?.businessType || null,
          businessIsFoodTruck:
            restaurantByOwner.get(u.id)?.isFoodTruck ?? null,
          businessIsActive: restaurantByOwner.get(u.id)?.isActive ?? null,
          businessIsVerified: restaurantByOwner.get(u.id)?.isVerified ?? null,
          hasRestaurant: restaurantByOwner.has(u.id),
          defaultCity: defaultAddressByUser.get(u.id)?.city || null,
          defaultState: defaultAddressByUser.get(u.id)?.state || null,
          defaultPostalCode:
            defaultAddressByUser.get(u.id)?.postalCode || u.postalCode || null,
        }));

        res.json(withBusiness);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    },
  );

  const buildAdminMessageRecipients = async (filters: Record<string, any>) => {
    const allUsers = await storage.getAllUsers();
    const restaurantRows = await db
      .select({
        ownerId: restaurants.ownerId,
        name: restaurants.name,
        city: restaurants.city,
        state: restaurants.state,
        businessType: restaurants.businessType,
        isFoodTruck: restaurants.isFoodTruck,
      })
      .from(restaurants);
    const restaurantsByOwner = new Map<string, any[]>();
    for (const row of restaurantRows) {
      if (!row.ownerId) continue;
      const list = restaurantsByOwner.get(row.ownerId) || [];
      list.push(row);
      restaurantsByOwner.set(row.ownerId, list);
    }

    const addressRows = await db
      .select({
        userId: userAddresses.userId,
        city: userAddresses.city,
        state: userAddresses.state,
        postalCode: userAddresses.postalCode,
        isDefault: userAddresses.isDefault,
      })
      .from(userAddresses);
    const defaultAddressByUser = new Map<string, any>();
    for (const address of addressRows) {
      if (!address.userId) continue;
      if (address.isDefault || !defaultAddressByUser.has(address.userId)) {
        defaultAddressByUser.set(address.userId, address);
      }
    }

    const q = normalizeSearch(filters.q);
    const userType = String(filters.userType || "all");
    const emailVerified = String(filters.emailVerified || "all");
    const status = String(filters.status || "active");
    const city = normalizeSearch(filters.city);
    const state = normalizeSearch(filters.state);
    const businessOnly = Boolean(filters.businessOnly);
    const hasEmailOnly = filters.hasEmail !== false;
    const excludeInternal = filters.excludeInternal !== false;
    const optInOnly = filters.optInOnly !== false;

    let skippedOptOut = 0;
    const recipients = allUsers
      .map((user: any) => {
        const businesses = restaurantsByOwner.get(user.id) || [];
        const defaultAddress = defaultAddressByUser.get(user.id);
        return { user, businesses, defaultAddress };
      })
      .filter(({ user, businesses, defaultAddress }) => {
        if (excludeInternal && isAdminUserType(user.userType)) return false;
        if (excludeInternal && user.userType === "staff") return false;
        if (hasEmailOnly && !user.email) return false;
        if (status === "active" && user.isDisabled === true) return false;
        if (status === "disabled" && user.isDisabled !== true) return false;
        if (userType !== "all" && user.userType !== userType) return false;
        if (emailVerified === "verified" && user.emailVerified !== true) return false;
        if (emailVerified === "unverified" && user.emailVerified === true) return false;
        if (businessOnly && businesses.length === 0) return false;
        if (city) {
          const values = [
            user.city,
            user.postalCode,
            defaultAddress?.city,
            ...businesses.map((b) => b.city),
          ].map(normalizeSearch);
          if (!values.some((value) => value.includes(city))) return false;
        }
        if (state) {
          const values = [
            user.state,
            defaultAddress?.state,
            ...businesses.map((b) => b.state),
          ].map(normalizeSearch);
          if (!values.some((value) => value.includes(state))) return false;
        }
        if (q) {
          const values = [
            user.firstName,
            user.lastName,
            user.email,
            user.phone,
            user.postalCode,
            defaultAddress?.city,
            defaultAddress?.state,
            defaultAddress?.postalCode,
            ...businesses.flatMap((b) => [
              b.name,
              b.city,
              b.state,
              b.businessType,
              b.isFoodTruck ? "food truck" : "",
            ]),
          ].map(normalizeSearch);
          if (!values.some((value) => value.includes(q))) return false;
        }
        if (optInOnly && !isGeneralEmailAllowed(user.accountSettings)) {
          skippedOptOut += 1;
          return false;
        }
        return true;
      })
      .map(({ user, businesses, defaultAddress }) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        businessName: businesses[0]?.name || null,
        city: defaultAddress?.city || businesses[0]?.city || null,
        state: defaultAddress?.state || businesses[0]?.state || null,
      }));

    return { recipients, skippedOptOut };
  };

  app.post(
    "/api/admin/users/message-preview",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        if (!isAdminUserType(req.user?.userType)) {
          return res.status(403).json({ message: "Admin access required" });
        }
        const { recipients, skippedOptOut } = await buildAdminMessageRecipients(
          req.body?.filters || {},
        );
        res.json({
          count: recipients.length,
          skippedOptOut,
          sample: recipients.slice(0, 10),
        });
      } catch (error) {
        console.error("Error previewing admin message recipients:", error);
        res.status(500).json({ message: "Failed to preview recipients" });
      }
    },
  );

  app.post(
    "/api/admin/users/message",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        if (!isAdminUserType(req.user?.userType)) {
          return res.status(403).json({ message: "Admin access required" });
        }
        const subject = String(req.body?.subject || "").trim();
        const body = String(req.body?.body || "").trim();
        if (subject.length < 4 || subject.length > 140) {
          return res.status(400).json({
            message: "Subject must be between 4 and 140 characters",
          });
        }
        if (body.length < 10 || body.length > 5000) {
          return res.status(400).json({
            message: "Message must be between 10 and 5000 characters",
          });
        }

        const { recipients, skippedOptOut } = await buildAdminMessageRecipients(
          req.body?.filters || {},
        );
        const cappedRecipients = recipients.slice(0, 1000);
        const settingsUrl = `${String(
          process.env.PUBLIC_BASE_URL || "http://localhost:5000",
        ).replace(/\/+$/, "")}/profile/notifications`;
        const html = `${bodyToHtml(body)}<p style="color:#6b7280;font-size:13px;">You received this because you have a MealScout account. You can manage email preferences in <a href="${settingsUrl}">notification settings</a>.</p>`;
        const text = `${body}\n\nYou received this because you have a MealScout account. Manage email preferences: ${settingsUrl}`;

        let sent = 0;
        let failed = 0;
        for (const recipient of cappedRecipients) {
          const ok = await emailService.sendBasicEmail(
            recipient.email,
            subject,
            html,
            text,
            "general",
          );
          if (ok) sent += 1;
          else failed += 1;
        }

        res.json({
          count: recipients.length,
          attempted: cappedRecipients.length,
          sent,
          failed,
          skippedOptOut,
          capped: recipients.length > cappedRecipients.length,
        });
      } catch (error) {
        console.error("Error sending admin message:", error);
        res.status(500).json({ message: "Failed to send message" });
      }
    },
  );
}
