import {
  restaurants,
  foodTruckSessions,
  foodTruckLocations,
  truckManualSchedules,
  truckParkingReports,
  type Restaurant,
  type FoodTruckSession,
  type FoodTruckLocation,
  type InsertFoodTruckLocation,
  type TruckManualSchedule,
  type InsertTruckManualSchedule,
  type TruckParkingReport,
  type InsertTruckParkingReport,
} from "@shared/schema";
import { db } from "../db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

export function createTruckLiveOpsRepository() {
  const repo = {
    async createTruckManualSchedule(
      schedule: InsertTruckManualSchedule,
    ): Promise<TruckManualSchedule> {
      const now = new Date();
      const [created] = await db
        .insert(truckManualSchedules)
        .values({
          ...schedule,
          lastConfirmedAt: now,
          updatedAt: now,
        })
        .returning();
      return created;
    },

    async getTruckManualSchedules(
      truckId: string,
    ): Promise<TruckManualSchedule[]> {
      return await db
        .select()
        .from(truckManualSchedules)
        .where(eq(truckManualSchedules.truckId, truckId))
        .orderBy(asc(truckManualSchedules.date));
    },

    async deleteTruckManualSchedule(
      scheduleId: string,
      truckId?: string,
    ): Promise<void> {
      const whereClause = truckId
        ? and(
            eq(truckManualSchedules.id, scheduleId),
            eq(truckManualSchedules.truckId, truckId),
          )
        : eq(truckManualSchedules.id, scheduleId);

      await db.delete(truckManualSchedules).where(whereClause);
    },

    async createTruckParkingReport(
      report: InsertTruckParkingReport,
    ): Promise<TruckParkingReport> {
      const updatedAt = new Date();
      const values = { ...report, updatedAt };

      if (report.bookingId) {
        const existing = await db
          .select({ id: truckParkingReports.id })
          .from(truckParkingReports)
          .where(eq(truckParkingReports.bookingId, report.bookingId))
          .limit(1);
        if (existing.length > 0) {
          const [updated] = await db
            .update(truckParkingReports)
            .set(values)
            .where(eq(truckParkingReports.id, existing[0].id))
            .returning();
          return updated;
        }
      }

      if (report.manualScheduleId) {
        const existing = await db
          .select({ id: truckParkingReports.id })
          .from(truckParkingReports)
          .where(
            eq(truckParkingReports.manualScheduleId, report.manualScheduleId),
          )
          .limit(1);
        if (existing.length > 0) {
          const [updated] = await db
            .update(truckParkingReports)
            .set(values)
            .where(eq(truckParkingReports.id, existing[0].id))
            .returning();
          return updated;
        }
      }

      const [created] = await db
        .insert(truckParkingReports)
        .values(values)
        .returning();
      return created;
    },

    async getTruckParkingReports(
      truckId: string,
      options?: { startDate?: Date; endDate?: Date },
    ): Promise<TruckParkingReport[]> {
      const whereClauses = [eq(truckParkingReports.truckId, truckId)];
      if (options?.startDate) {
        whereClauses.push(gte(truckParkingReports.date, options.startDate));
      }
      if (options?.endDate) {
        whereClauses.push(lte(truckParkingReports.date, options.endDate));
      }
      return await db
        .select()
        .from(truckParkingReports)
        .where(and(...whereClauses))
        .orderBy(desc(truckParkingReports.date));
    },

    async startTruckSession(
      restaurantId: string,
      deviceId: string,
      userId: string,
    ): Promise<FoodTruckSession> {
      // End any existing active session first
      await db
        .update(foodTruckSessions)
        .set({
          isActive: false,
          endedAt: new Date(),
        })
        .where(
          and(
            eq(foodTruckSessions.restaurantId, restaurantId),
            eq(foodTruckSessions.isActive, true),
          ),
        );

      // Start new session
      const [session] = await db
        .insert(foodTruckSessions)
        .values({
          restaurantId,
          deviceId,
          startedByUserId: userId,
        })
        .returning();

      // Update restaurant mobile status
      await db
        .update(restaurants)
        .set({
          mobileOnline: true,
          lastBroadcastAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, restaurantId));

      return session;
    },

    async endTruckSession(
      restaurantId: string,
      userId: string,
    ): Promise<void> {
      await db
        .update(foodTruckSessions)
        .set({
          isActive: false,
          endedAt: new Date(),
        })
        .where(
          and(
            eq(foodTruckSessions.restaurantId, restaurantId),
            eq(foodTruckSessions.startedByUserId, userId),
            eq(foodTruckSessions.isActive, true),
          ),
        );

      // Update restaurant mobile status
      await db
        .update(restaurants)
        .set({
          mobileOnline: false,
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, restaurantId));
    },

    async getActiveTruckSession(
      restaurantId: string,
    ): Promise<FoodTruckSession | undefined> {
      const [session] = await db
        .select()
        .from(foodTruckSessions)
        .where(
          and(
            eq(foodTruckSessions.restaurantId, restaurantId),
            eq(foodTruckSessions.isActive, true),
          ),
        )
        .orderBy(desc(foodTruckSessions.startedAt))
        .limit(1);
      return session;
    },

    async hasRecentLocationUpdate(
      restaurantId: string,
      lat: number,
      lng: number,
      timeWindowMs: number = 10000, // 10 seconds
      distanceThreshold: number = 10, // 10 meters
    ): Promise<boolean> {
      const cutoffTime = new Date(Date.now() - timeWindowMs);

      const [recentLocation] = await db
        .select({
          latitude: foodTruckLocations.latitude,
          longitude: foodTruckLocations.longitude,
        })
        .from(foodTruckLocations)
        .where(
          and(
            eq(foodTruckLocations.restaurantId, restaurantId),
            gte(foodTruckLocations.recordedAt, cutoffTime),
          ),
        )
        .orderBy(desc(foodTruckLocations.recordedAt))
        .limit(1);

      if (!recentLocation) return false;

      // Calculate distance using Haversine formula (simplified for short distances)
      const latDiff = Math.abs(parseFloat(recentLocation.latitude) - lat);
      const lngDiff = Math.abs(parseFloat(recentLocation.longitude) - lng);
      const distanceM = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320; // Rough conversion to meters

      return distanceM < distanceThreshold;
    },

    async upsertLiveLocation(
      location: InsertFoodTruckLocation,
    ): Promise<FoodTruckLocation> {
      // Check for recent duplicate location
      const hasRecent = await repo.hasRecentLocationUpdate(
        location.restaurantId,
        location.latitude,
        location.longitude,
      );

      if (hasRecent) {
        // Return the most recent location instead of inserting duplicate
        const [recent] = await db
          .select()
          .from(foodTruckLocations)
          .where(eq(foodTruckLocations.restaurantId, location.restaurantId))
          .orderBy(desc(foodTruckLocations.recordedAt))
          .limit(1);
        return recent;
      }

      // Get active session for the restaurant
      const activeSession = await repo.getActiveTruckSession(
        location.restaurantId,
      );

      // Insert new location record
      const [newLocation] = await db
        .insert(foodTruckLocations)
        .values({
          restaurantId: location.restaurantId,
          latitude: location.latitude.toString(),
          longitude: location.longitude.toString(),
          sessionId: activeSession?.id,
        })
        .returning();

      // Update restaurant's current location
      await db
        .update(restaurants)
        .set({
          currentLatitude: location.latitude.toString(),
          currentLongitude: location.longitude.toString(),
          lastBroadcastAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(restaurants.id, location.restaurantId));

      return newLocation;
    },

    async getLiveTrucksNearby(
      lat: number,
      lng: number,
      radiusKm: number,
    ): Promise<Array<Restaurant & { distance: number; sessionId?: string }>> {
      const staleMinutesRaw = Number(
        process.env.LIVE_TRUCK_STALE_MINUTES || 120,
      );
      const staleMinutes = Number.isFinite(staleMinutesRaw)
        ? Math.max(5, staleMinutesRaw)
        : 120;
      const freshnessCutoffMs = Date.now() - staleMinutes * 60_000;

      // Simple query first - just return food trucks with valid locations
      const results = await db
        .select({
          id: restaurants.id,
          ownerId: restaurants.ownerId,
          name: restaurants.name,
          address: restaurants.address,
          phone: restaurants.phone,
          businessType: restaurants.businessType,
          cuisineType: restaurants.cuisineType,
          promoCode: restaurants.promoCode,
          latitude: restaurants.latitude,
          longitude: restaurants.longitude,
          isFoodTruck: restaurants.isFoodTruck,
          mobileOnline: restaurants.mobileOnline,
          currentLatitude: restaurants.currentLatitude,
          currentLongitude: restaurants.currentLongitude,
          lastBroadcastAt: restaurants.lastBroadcastAt,
          operatingHours: restaurants.operatingHours,
          isActive: restaurants.isActive,
          isVerified: restaurants.isVerified,
          createdAt: restaurants.createdAt,
          updatedAt: restaurants.updatedAt,
          sessionId: foodTruckSessions.id,
        })
        .from(restaurants)
        .leftJoin(
          foodTruckSessions,
          and(
            eq(restaurants.id, foodTruckSessions.restaurantId),
            eq(foodTruckSessions.isActive, true),
          ),
        )
        .where(
          and(
            eq(restaurants.isFoodTruck, true),
            eq(restaurants.mobileOnline, true),
            eq(restaurants.isActive, true),
            sql`current_latitude IS NOT NULL`,
            sql`current_longitude IS NOT NULL`,
          ),
        );
      const visibleResults = results.filter((truck: any) =>
        isPublicBusinessVisible(truck),
      );
      const freshResults = visibleResults.filter((truck: any) => {
        const lastBroadcastMs = truck?.lastBroadcastAt
          ? new Date(truck.lastBroadcastAt).getTime()
          : Number.NaN;
        return (
          Number.isFinite(lastBroadcastMs) &&
          lastBroadcastMs >= freshnessCutoffMs
        );
      });

      // Calculate distance in JavaScript for now (simpler than complex SQL)
      const trucksWithDistance = freshResults.map((truck: any) => {
        if (!truck.currentLatitude || !truck.currentLongitude) {
          return {
            ...truck,
            distance: 999999,
            sessionId: truck.sessionId || undefined,
          };
        }

        const truckLat = parseFloat(truck.currentLatitude);
        const truckLng = parseFloat(truck.currentLongitude);

        // Haversine formula for distance calculation
        const R = 6371; // Earth's radius in kilometers
        const dLat = ((truckLat - lat) * Math.PI) / 180;
        const dLng = ((truckLng - lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((truckLat * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        return {
          ...truck,
          distance,
          sessionId: truck.sessionId || undefined,
        };
      });

      // Filter by radius and sort by distance
      return trucksWithDistance
        .filter((truck: any) => truck.distance <= radiusKm)
        .sort((a: any, b: any) => a.distance - b.distance);
    },

    async getTruckLocationHistory(
      restaurantId: string,
      dateRange?: { start: Date; end: Date },
    ): Promise<FoodTruckLocation[]> {
      const conditions = [eq(foodTruckLocations.restaurantId, restaurantId)];

      if (dateRange) {
        conditions.push(gte(foodTruckLocations.recordedAt, dateRange.start));
        conditions.push(lte(foodTruckLocations.recordedAt, dateRange.end));
      }

      const locations = await db
        .select()
        .from(foodTruckLocations)
        .where(and(...conditions))
        .orderBy(desc(foodTruckLocations.recordedAt))
        .limit(1000); // Reasonable limit to prevent huge responses

      return locations;
    },
  };

  return repo;
}
