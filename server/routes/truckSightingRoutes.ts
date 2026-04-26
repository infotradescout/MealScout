import type { Express } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";

type TruckSightingRow = {
  id: string;
  truckName: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  locationLabel: string | null;
  reportCount: number;
  status: string;
  createdAt: string;
  lastReportedAt: string;
  expiresAt: string;
};

let ensured = false;

async function ensureTruckSightingTable() {
  if (ensured) return;

  await db.execute(sql`
    create table if not exists community_truck_sightings (
      id varchar primary key default gen_random_uuid(),
      reported_by_user_id varchar references users(id) on delete set null,
      reporter_ip varchar,
      reporter_user_agent text,
      truck_name varchar not null,
      normalized_truck_name varchar not null,
      sighting_key varchar not null,
      notes text,
      latitude decimal(10,8) not null,
      longitude decimal(11,8) not null,
      location_label text,
      source varchar not null default 'map_user_ping',
      status varchar not null default 'pending',
      report_count integer not null default 1,
      first_seen_at timestamp not null default now(),
      last_reported_at timestamp not null default now(),
      admin_notes text,
      reviewer_user_id varchar references users(id) on delete set null,
      reviewed_at timestamp,
      linked_restaurant_id varchar references restaurants(id) on delete set null,
      created_at timestamp not null default now(),
      updated_at timestamp not null default now()
    )
  `);

  await db.execute(sql`
    create index if not exists idx_truck_sightings_status_last_reported
      on community_truck_sightings (status, last_reported_at desc)
  `);

  await db.execute(sql`
    create index if not exists idx_truck_sightings_key
      on community_truck_sightings (sighting_key)
  `);

  await db.execute(sql`
    create index if not exists idx_truck_sightings_created
      on community_truck_sightings (created_at desc)
  `);

  ensured = true;
}

const submitSightingSchema = z.object({
  truckName: z.string().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  notes: z.string().max(500).optional(),
  locationLabel: z.string().max(220).optional(),
  source: z.string().max(60).optional(),
  seenAt: z.string().datetime().optional(),
});

const updateSightingSchema = z.object({
  status: z
    .enum(["pending", "reviewing", "outreach", "claimed", "dismissed", "duplicate"])
    .optional(),
  adminNotes: z.string().max(2000).optional(),
  linkedRestaurantId: z.string().optional().nullable(),
});

export function registerTruckSightingRoutes(app: Express) {
  const sightingBurstLimiter = distributedRateLimit({
    scope: "truck-sighting:burst",
    limit: 8,
    windowMs: 5 * 60 * 1000,
    key: (req) => {
      const ua = String(req.get("User-Agent") || "").slice(0, 80);
      return `${req.ip}:${ua}`;
    },
  });

  const sightingDailyLimiter = distributedRateLimit({
    scope: "truck-sighting:daily",
    limit: 60,
    windowMs: 24 * 60 * 60 * 1000,
  });

  app.post(
    "/api/public/truck-sightings",
    sightingBurstLimiter,
    sightingDailyLimiter,
    async (req: any, res) => {
      try {
        await ensureTruckSightingTable();
        const parsed = submitSightingSchema.parse(req.body || {});

        const normalizedTruckName = String(parsed.truckName || "")
          .trim()
          .toLowerCase();
        const latBucket = parsed.latitude.toFixed(3);
        const lngBucket = parsed.longitude.toFixed(3);
        const sightingKey = `${normalizedTruckName}|${latBucket}|${lngBucket}`;
        const seenAt = parsed.seenAt ? new Date(parsed.seenAt) : new Date();
        const source = String(parsed.source || "map_user_ping").trim();

        const existingResult = await db.execute(
          sql<{ id: string }>`
            select id
            from community_truck_sightings
            where
              sighting_key = ${sightingKey} and
              status in ('pending', 'reviewing', 'outreach') and
              last_reported_at >= now() - interval '6 hours'
            order by last_reported_at desc
            limit 1
          `,
        );

        const existing = ((existingResult as any)?.rows || [])[0] as
          | { id: string }
          | undefined;

        if (existing?.id) {
          const updatedResult = await db.execute(
            sql<TruckSightingRow>`
              update community_truck_sightings
              set
                report_count = report_count + 1,
                last_reported_at = ${seenAt},
                notes = case
                  when coalesce(notes, '') = '' then ${parsed.notes || null}
                  else notes
                end,
                updated_at = now()
              where id = ${existing.id}
              returning
                id,
                truck_name as "truckName",
                notes,
                latitude::float8 as latitude,
                longitude::float8 as longitude,
                location_label as "locationLabel",
                report_count as "reportCount",
                status,
                created_at as "createdAt",
                last_reported_at as "lastReportedAt",
                (last_reported_at + interval '1 hour') as "expiresAt"
            `,
          );

          const row = ((updatedResult as any)?.rows || [])[0] as TruckSightingRow;
          return res.status(200).json({ ok: true, merged: true, sighting: row });
        }

        const insertedResult = await db.execute(
          sql<TruckSightingRow>`
            insert into community_truck_sightings (
              reported_by_user_id,
              reporter_ip,
              reporter_user_agent,
              truck_name,
              normalized_truck_name,
              sighting_key,
              notes,
              latitude,
              longitude,
              location_label,
              source,
              first_seen_at,
              last_reported_at
            )
            values (
              ${req.user?.id || null},
              ${String(req.ip || "")},
              ${String(req.get("User-Agent") || "")},
              ${String(parsed.truckName).trim()},
              ${normalizedTruckName},
              ${sightingKey},
              ${parsed.notes || null},
              ${parsed.latitude},
              ${parsed.longitude},
              ${parsed.locationLabel || null},
              ${source || "map_user_ping"},
              ${seenAt},
              ${seenAt}
            )
            returning
              id,
              truck_name as "truckName",
              notes,
              latitude::float8 as latitude,
              longitude::float8 as longitude,
              location_label as "locationLabel",
              report_count as "reportCount",
              status,
              created_at as "createdAt",
              last_reported_at as "lastReportedAt",
              (last_reported_at + interval '1 hour') as "expiresAt"
          `,
        );

        const row = ((insertedResult as any)?.rows || [])[0] as TruckSightingRow;
        return res.status(201).json({ ok: true, merged: false, sighting: row });
      } catch (error: any) {
        console.error("Error creating truck sighting:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            ok: false,
            message: "Invalid truck sighting payload",
            issues: error.issues,
          });
        }
        return res.status(500).json({
          ok: false,
          message: "Failed to save truck sighting",
        });
      }
    },
  );

  app.get("/api/trucks/community-sightings/live", async (req: any, res) => {
    try {
      await ensureTruckSightingTable();
      const lat = Number(req.query?.lat);
      const lng = Number(req.query?.lng);
      const radiusKmRaw = Number(req.query?.radiusKm || 6);
      const radiusKm = Number.isFinite(radiusKmRaw)
        ? Math.max(1, Math.min(30, radiusKmRaw))
        : 6;

      const useDistanceFilter = Number.isFinite(lat) && Number.isFinite(lng);

      const result = await db.execute(
        sql<TruckSightingRow>`
          select
            id,
            truck_name as "truckName",
            notes,
            latitude::float8 as latitude,
            longitude::float8 as longitude,
            location_label as "locationLabel",
            report_count as "reportCount",
            status,
            created_at as "createdAt",
            last_reported_at as "lastReportedAt",
            (last_reported_at + interval '1 hour') as "expiresAt"
          from community_truck_sightings
          where
            status in ('pending', 'reviewing', 'outreach') and
            last_reported_at >= now() - interval '1 hour' and
            (
              ${useDistanceFilter === false} or
              (
                6371 * acos(
                  least(
                    1,
                    greatest(
                      -1,
                      cos(radians(${lat})) *
                      cos(radians(latitude::float8)) *
                      cos(radians(longitude::float8) - radians(${lng})) +
                      sin(radians(${lat})) * sin(radians(latitude::float8))
                    )
                  )
                ) <= ${radiusKm}
              )
            )
          order by last_reported_at desc
          limit 100
        `,
      );

      const rows = ((result as any)?.rows || []) as TruckSightingRow[];
      res.json(rows);
    } catch (error) {
      console.error("Error listing live truck sightings:", error);
      res.status(500).json({ message: "Failed to load live truck sightings" });
    }
  });

  app.get(
    "/api/admin/truck-sightings",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await ensureTruckSightingTable();
        const statusFilter = String(req.query?.status || "").trim();
        const limitRaw = Number(req.query?.limit || 200);
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(500, limitRaw))
          : 200;

        const rowsResult = await db.execute(
          sql<any>`
            select
              s.id,
              s.truck_name as "truckName",
              s.notes,
              s.latitude::float8 as latitude,
              s.longitude::float8 as longitude,
              s.location_label as "locationLabel",
              s.source,
              s.status,
              s.report_count as "reportCount",
              s.first_seen_at as "firstSeenAt",
              s.last_reported_at as "lastReportedAt",
              s.created_at as "createdAt",
              s.updated_at as "updatedAt",
              s.admin_notes as "adminNotes",
              s.linked_restaurant_id as "linkedRestaurantId",
              s.reviewed_at as "reviewedAt",
              s.reported_by_user_id as "reportedByUserId",
              ru.email as "reportedByEmail",
              s.reviewer_user_id as "reviewedByUserId",
              rv.email as "reviewedByEmail",
              (s.last_reported_at + interval '1 hour') as "expiresAt",
              (s.last_reported_at >= now() - interval '1 hour') as "isLive"
            from community_truck_sightings s
            left join users ru on ru.id = s.reported_by_user_id
            left join users rv on rv.id = s.reviewer_user_id
            where
              (${statusFilter === ""} or s.status = ${statusFilter})
            order by s.last_reported_at desc
            limit ${limit}
          `,
        );

        const rows = ((rowsResult as any)?.rows || []) as any[];
        res.json({ rows, count: rows.length });
      } catch (error) {
        console.error("Error listing admin truck sightings:", error);
        res.status(500).json({ message: "Failed to load truck sightings" });
      }
    },
  );

  app.patch(
    "/api/admin/truck-sightings/:id",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        await ensureTruckSightingTable();
        const id = String(req.params?.id || "").trim();
        if (!id) {
          return res.status(400).json({ message: "Sighting ID is required" });
        }

        const parsed = updateSightingSchema.parse(req.body || {});

        const statusToSet = parsed.status ?? null;
        const adminNotesToSet =
          parsed.adminNotes !== undefined ? parsed.adminNotes : null;
        const linkedRestaurantIdToSet =
          parsed.linkedRestaurantId !== undefined
            ? parsed.linkedRestaurantId
            : null;

        const result = await db.execute(
          sql<any>`
            update community_truck_sightings
            set
              status = coalesce(${statusToSet}, status),
              admin_notes = coalesce(${adminNotesToSet}, admin_notes),
              linked_restaurant_id =
                case
                  when ${parsed.linkedRestaurantId !== undefined} then ${linkedRestaurantIdToSet}
                  else linked_restaurant_id
                end,
              reviewer_user_id = ${req.user?.id || null},
              reviewed_at = now(),
              updated_at = now()
            where id = ${id}
            returning
              id,
              truck_name as "truckName",
              status,
              admin_notes as "adminNotes",
              linked_restaurant_id as "linkedRestaurantId",
              reviewed_at as "reviewedAt",
              updated_at as "updatedAt"
          `,
        );

        const row = ((result as any)?.rows || [])[0] as any;
        if (!row) {
          return res.status(404).json({ message: "Truck sighting not found" });
        }

        res.json({ ok: true, row });
      } catch (error: any) {
        console.error("Error updating truck sighting:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid truck sighting update payload",
            issues: error.issues,
          });
        }
        res.status(500).json({ message: "Failed to update truck sighting" });
      }
    },
  );
}
