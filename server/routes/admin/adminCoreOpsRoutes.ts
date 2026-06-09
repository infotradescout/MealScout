import type { Express } from "express";
import Stripe from "stripe";
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { storage } from "../../storage";
import { sanitizeUsers } from "../../utils/sanitize";
import { getPaymentHealthSnapshot } from "../../services/paymentHealth";
import { emailService } from "../../emailService";
import { isAdminUserType } from "../../roleAccess";
import { db } from "../../db";
import {
  affiliateShareEvents,
  eventBookings,
  events,
  eventSeries,
  foodTruckLocations,
  foodTruckSessions,
  hosts,
  menuItems,
  requestLogs,
  restaurants,
  telemetryEvents,
  truckImportListings,
  truckManualSchedules,
  users,
  userAddresses,
} from "@shared/schema";
import {
  formatOwnerEmailDisplay,
  getAdminSmokeRowStatus,
} from "@shared/adminSmokeDisplay";
import { parseAdminBroadcastMaxRecipients } from "../../utils/notificationPreferences";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const normalizeSearch = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const leakFixOutcomeStatuses = new Set([
  "resolved_improved",
  "resolved_no_change",
  "resolved_regressed",
  "dismissed_not_applicable",
  "needs_follow_up",
]);

const leakFixQueueStatuses = new Set([
  "open",
  "in_progress",
  "resolved",
  "dismissed",
]);

const normalizeLoose = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenSet = (value: unknown) =>
  normalizeLoose(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const overlapRatio = (left: unknown, right: unknown) => {
  const leftTokens = new Set(tokenSet(left));
  const rightTokens = new Set(tokenSet(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
};

const getSafeAuthDiagnostics = (user: any) => {
  const hasPasswordLogin = Boolean(user?.passwordHash);
  const hasGoogleAuth = Boolean(user?.googleId);
  const hasFacebookAuth = Boolean(user?.facebookId);
  const authProvider = hasPasswordLogin
    ? "password"
    : hasGoogleAuth
      ? "Google"
      : hasFacebookAuth
        ? "Facebook"
        : "unknown";

  return {
    authProvider,
    hasPasswordLogin,
    hasGoogleAuth,
    hasFacebookAuth,
    requiresPasswordReset: Boolean(user?.mustResetPassword),
  };
};

const normalizePhone = (value: unknown) => String(value || "").replace(/[^\d]/g, "");

const normalizeDomain = (value: unknown) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
};

const normalizedAddressLabel = (value: unknown) => normalizeLoose(value);
const QUARANTINE_EVIDENCE_IDS = new Set([
  "contact_phone",
  "contact_address",
  "website_link",
  "social_links",
  "media_logo",
  "media_cover",
  "media_gallery",
  "identity_verification",
]);

const buildQuarantineReview = (row: any) => {
  const rawData =
    row && typeof row.rawData === "object" && row.rawData
      ? (row.rawData as Record<string, any>)
      : {};
  const evidenceIngest =
    rawData && typeof rawData.evidenceIngest === "object" && rawData.evidenceIngest
      ? (rawData.evidenceIngest as Record<string, any>)
      : {};
  const quarantineConfig =
    rawData && typeof rawData.evidenceQuarantine === "object" && rawData.evidenceQuarantine
      ? (rawData.evidenceQuarantine as Record<string, any>)
      : evidenceIngest &&
          typeof evidenceIngest.quarantine === "object" &&
          evidenceIngest.quarantine
        ? (evidenceIngest.quarantine as Record<string, any>)
        : {};
  const decisions =
    quarantineConfig && typeof quarantineConfig.decisions === "object" && quarantineConfig.decisions
      ? (quarantineConfig.decisions as Record<string, any>)
      : {};
  const extractedEvidence =
    evidenceIngest && typeof evidenceIngest.extracted === "object" && evidenceIngest.extracted
      ? (evidenceIngest.extracted as Record<string, any>)
      : {};

  const externalBusinessName =
    String(
      extractedEvidence.business_name ||
        extractedEvidence.name ||
        evidenceIngest.businessName ||
        evidenceIngest.sourceBusinessName ||
        evidenceIngest.googleBusinessName ||
        "",
    ).trim() || null;

  const hardIdentityPhoneMatch =
    normalizePhone(row.phone) &&
    normalizePhone(extractedEvidence.phone) &&
    normalizePhone(row.phone) === normalizePhone(extractedEvidence.phone);
  const hardIdentityEmailMatch =
    String(row.email || "").trim().toLowerCase() &&
    String(extractedEvidence.email || "").trim().toLowerCase() &&
    String(row.email || "").trim().toLowerCase() ===
      String(extractedEvidence.email || "").trim().toLowerCase();
  const hardIdentityWebsiteMatch =
    normalizeDomain(row.websiteUrl) &&
    normalizeDomain(extractedEvidence.website || extractedEvidence.websiteUrl) &&
    normalizeDomain(row.websiteUrl) ===
      normalizeDomain(extractedEvidence.website || extractedEvidence.websiteUrl);
  const hardIdentityAddressMatch =
    normalizedAddressLabel(`${row.address || ""} ${row.city || ""} ${row.state || ""}`) &&
    normalizedAddressLabel(extractedEvidence.address || extractedEvidence.location_text) &&
    normalizedAddressLabel(`${row.address || ""} ${row.city || ""} ${row.state || ""}`) ===
      normalizedAddressLabel(extractedEvidence.address || extractedEvidence.location_text);

  const hasHardIdentityAnchor = Boolean(
    hardIdentityPhoneMatch ||
      hardIdentityEmailMatch ||
      hardIdentityWebsiteMatch ||
      hardIdentityAddressMatch,
  );

  const externalNameMismatch =
    Boolean(externalBusinessName) &&
    Boolean(String(row.name || "").trim()) &&
    overlapRatio(row.name, externalBusinessName) < 0.6;
  const quarantineByRule = externalNameMismatch && !hasHardIdentityAnchor;
  const quarantinedByConfig =
    quarantineConfig.active === true ||
    String(quarantineConfig.status || "")
      .trim()
      .toLowerCase() === "quarantined";
  const isQuarantined = Boolean(quarantinedByConfig || quarantineByRule);
  const hidePublicTrustFields = isQuarantined && quarantineConfig.allowPublicTrustFields !== true;
  const hideMedia = hidePublicTrustFields && quarantineConfig.hideMedia !== false;

  const reasons: string[] = [];
  if (externalNameMismatch) reasons.push("name_mismatch");
  if (!hasHardIdentityAnchor) reasons.push("no_hard_identity_anchor");
  if (quarantinedByConfig) reasons.push("manual_quarantine");
  if (quarantineByRule) reasons.push("rule_quarantine");

  return {
    isQuarantined,
    hidePublicTrustFields,
    hideMedia,
    reasons,
    hasHardIdentityAnchor,
    evidence: {
      externalBusinessName,
      extractedPhone: String(extractedEvidence.phone || "").trim() || null,
      extractedEmail: String(extractedEvidence.email || "").trim() || null,
      extractedWebsite:
        String(extractedEvidence.website || extractedEvidence.websiteUrl || "").trim() || null,
      extractedAddress:
        String(extractedEvidence.address || extractedEvidence.location_text || "").trim() || null,
    },
    decisions,
  };
};

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
    "/api/admin/launch-board",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const cityFilter = String(req.query?.city || "").trim();
        const cityKey = cityFilter.toLowerCase();
        const hasCityFilter = cityKey.length > 0;
        const cityWhereRestaurants = hasCityFilter
          ? sql`lower(trim(coalesce(${restaurants.city}, ''))) = ${cityKey}`
          : sql`true`;
        const cityWhereHosts = hasCityFilter
          ? sql`lower(trim(coalesce(${hosts.city}, ''))) = ${cityKey}`
          : sql`true`;

        const [
          [restaurantTotalsRow],
          [restaurantClaimStatsRow],
          [restaurantContactRow],
          [restaurantPhotoRow],
          [activeTrucksRow],
          [hostsTotalRow],
          [hostsContactRow],
          [hostsPhotoRow],
          [menuProfilesRow],
          [manualScheduleProfilesRow],
          [bookedScheduleProfilesRow],
          [parkingPassListingsRow],
          [bookingStartsRow],
          [bookingConfirmationsRow],
          parkingPassRequestLogRows,
          [publicViewsRow],
          [publicActionsRow],
          [affiliateOpensRow],
          [claimPitchRollupRow],
          claimProfileReconciliationRows,
          usefulProfileDemandLiftRows,
          bookingIntentLiftRows,
          parkingPassLeakDiagnosticsRows,
          leakFixOutcomeRows,
          cityOptionsRows,
        ] = await Promise.all([
          db
            .select({ total: sql<number>`count(*)`.mapWith(Number) })
            .from(restaurants)
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              claimed: sql<number>`count(*) filter (where ${users.userType} in ('restaurant_owner', 'food_truck'))`.mapWith(Number),
            })
            .from(restaurants)
            .leftJoin(users, eq(users.id, restaurants.ownerId))
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              withContact: sql<number>`count(*) filter (where coalesce(nullif(trim(${restaurants.phone}), ''), nullif(trim(${restaurants.websiteUrl}), '')) is not null)`.mapWith(
                Number,
              ),
            })
            .from(restaurants)
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              withPhoto: sql<number>`count(*) filter (where coalesce(nullif(trim(${restaurants.logoUrl}), ''), nullif(trim(${restaurants.coverImageUrl}), '')) is not null)`.mapWith(
                Number,
              ),
            })
            .from(restaurants)
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              activeFoodTrucks: sql<number>`count(*)`.mapWith(Number),
            })
            .from(restaurants)
            .where(
              and(
                eq(restaurants.isActive, true),
                cityWhereRestaurants,
                sql`(${restaurants.isFoodTruck} = true or ${restaurants.businessType} = 'food_truck')`,
              ),
            ),
          db
            .select({ total: sql<number>`count(*)`.mapWith(Number) })
            .from(hosts)
            .where(cityWhereHosts),
          db
            .select({
              withContact: sql<number>`count(*) filter (where nullif(trim(${hosts.contactPhone}), '') is not null)`.mapWith(
                Number,
              ),
            })
            .from(hosts)
            .where(cityWhereHosts),
          db
            .select({
              withPhoto: sql<number>`count(*) filter (where nullif(trim(${hosts.spotImageUrl}), '') is not null)`.mapWith(
                Number,
              ),
            })
            .from(hosts)
            .where(cityWhereHosts),
          db
            .select({
              withMenu: sql<number>`count(distinct ${menuItems.restaurantId})`.mapWith(
                Number,
              ),
            })
            .from(menuItems)
            .innerJoin(restaurants, eq(restaurants.id, menuItems.restaurantId))
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              withManualSchedule:
                sql<number>`count(distinct ${truckManualSchedules.truckId})`.mapWith(
                  Number,
                ),
            })
            .from(truckManualSchedules)
            .innerJoin(restaurants, eq(restaurants.id, truckManualSchedules.truckId))
            .where(and(eq(restaurants.isActive, true), cityWhereRestaurants)),
          db
            .select({
              withBookedSchedule:
                sql<number>`count(distinct ${events.bookedRestaurantId})`.mapWith(
                  Number,
                ),
            })
            .from(events)
            .innerJoin(hosts, eq(hosts.id, events.hostId))
            .where(and(isNotNull(events.bookedRestaurantId), cityWhereHosts)),
          db
            .select({
              listings: sql<number>`count(*)`.mapWith(Number),
            })
            .from(eventSeries)
            .innerJoin(hosts, eq(hosts.id, eventSeries.hostId))
            .where(
              and(
                eq(eventSeries.seriesType, "parking_pass"),
                eq(eventSeries.status, "published"),
                cityWhereHosts,
              ),
            ),
          db
            .select({
              bookingStarts: sql<number>`count(*)`.mapWith(Number),
            })
            .from(eventBookings)
            .innerJoin(events, eq(events.id, eventBookings.eventId))
            .innerJoin(hosts, eq(hosts.id, events.hostId))
            .where(and(eq(events.eventType, "parking_pass"), cityWhereHosts)),
          db
            .select({
              bookingConfirmations:
                sql<number>`count(*) filter (where ${eventBookings.status} = 'confirmed')`.mapWith(
                  Number,
                ),
            })
            .from(eventBookings)
            .innerJoin(events, eq(events.id, eventBookings.eventId))
            .innerJoin(hosts, eq(hosts.id, events.hostId))
            .where(and(eq(events.eventType, "parking_pass"), cityWhereHosts)),
          db.execute(sql`
            select
              count(*) filter (
                where rl.event_type in ('parking_pass_view', 'parking_pass_listing_view')
              )::int as "parkingPassViews",
              count(*) filter (
                where rl.event_type = 'parking_pass_click'
              )::int as "parkingPassClicks"
            from request_logs rl
            where rl.surface in ('public_profile', 'parking_pass')
              and rl.event_type in (
                'parking_pass_view',
                'parking_pass_listing_view',
                'parking_pass_click'
              )
              ${
                hasCityFilter
                  ? sql`and (
                      (rl.entity_type in ('restaurant', 'truck', 'bar')
                        and exists (
                          select 1
                          from restaurants r
                          where r.id = rl.entity_id
                            and lower(trim(coalesce(r.city, ''))) = ${cityKey}
                        ))
                      or
                      (rl.entity_type = 'host'
                        and exists (
                          select 1
                          from hosts h
                          where h.id = rl.entity_id
                            and lower(trim(coalesce(h.city, ''))) = ${cityKey}
                        ))
                      or
                      (rl.entity_type = 'event'
                        and exists (
                          select 1
                          from events e
                          join hosts h on h.id = e.host_id
                          where e.id = rl.entity_id
                            and lower(trim(coalesce(h.city, ''))) = ${cityKey}
                        ))
                      or lower(trim(coalesce(rl.metadata->>'city', ''))) = ${cityKey}
                    )`
                  : sql``
              }
          `),
          db
            .select({
              views: sql<number>`count(*)`.mapWith(Number),
            })
            .from(requestLogs)
            .where(
              and(
                eq(requestLogs.surface, "public_profile"),
                eq(requestLogs.eventType, "profile_view"),
                hasCityFilter
                  ? sql`(
                      (${requestLogs.entityType} in ('restaurant', 'truck', 'bar')
                        and exists (
                          select 1
                          from restaurants r
                          where r.id = ${requestLogs.entityId}
                            and lower(trim(coalesce(r.city, ''))) = ${cityKey}
                        ))
                      or
                      (${requestLogs.entityType} = 'host'
                        and exists (
                          select 1
                          from hosts h
                          where h.id = ${requestLogs.entityId}
                            and lower(trim(coalesce(h.city, ''))) = ${cityKey}
                        ))
                    )`
                  : sql`true`,
              ),
            ),
          db
            .select({
              actions: sql<number>`count(*)`.mapWith(Number),
            })
            .from(requestLogs)
            .where(
              and(
                eq(requestLogs.surface, "public_profile"),
                eq(requestLogs.eventType, "profile_action"),
                hasCityFilter
                  ? sql`(
                      (${requestLogs.entityType} in ('restaurant', 'truck', 'bar')
                        and exists (
                          select 1
                          from restaurants r
                          where r.id = ${requestLogs.entityId}
                            and lower(trim(coalesce(r.city, ''))) = ${cityKey}
                        ))
                      or
                      (${requestLogs.entityType} = 'host'
                        and exists (
                          select 1
                          from hosts h
                          where h.id = ${requestLogs.entityId}
                            and lower(trim(coalesce(h.city, ''))) = ${cityKey}
                        ))
                    )`
                  : sql`true`,
              ),
            ),
          db
            .select({
              opens: sql<number>`count(*)`.mapWith(Number),
            })
            .from(affiliateShareEvents)
            .where(
              hasCityFilter
                ? sql`lower(${affiliateShareEvents.destinationUrl}) like ${`%${cityKey}%`}`
                : sql`true`,
            ),
          db
            .select({
              claimPitchesCreated: sql<number>`count(*) filter (where ${truckImportListings.rawData} ? 'claimPitch')`.mapWith(
                Number,
              ),
              claimPitchesSent: sql<number>`count(*) filter (where (${truckImportListings.rawData}->'claimPitch'->>'sentAt') is not null)`.mapWith(
                Number,
              ),
              claimPitchesOpened: sql<number>`count(*) filter (where (${truckImportListings.rawData}->'claimPitch'->>'pitchOpenedAt') is not null)`.mapWith(
                Number,
              ),
              claimPitchesStarted: sql<number>`count(*) filter (where (${truckImportListings.rawData}->'claimPitch'->>'claimStartedAt') is not null)`.mapWith(
                Number,
              ),
              claimPitchesCompleted: sql<number>`count(*) filter (where (${truckImportListings.rawData}->'claimPitch'->>'claimCompletedAt') is not null)`.mapWith(
                Number,
              ),
            })
            .from(truckImportListings)
            .where(
              hasCityFilter
                ? sql`lower(trim(coalesce(${truckImportListings.city}, ''))) = ${cityKey}`
                : sql`true`,
            ),
          db.execute(sql`
            with pitched_claims as (
              select
                l.id as listing_id,
                r.id as restaurant_id,
                coalesce(
                  nullif(l.raw_data->'claimPitch'->>'claimCompletedAt', '')::timestamptz,
                  nullif(l.raw_data->'claimPitch'->>'claimStartedAt', '')::timestamptz
                ) as pitched_at
              from truck_import_listings l
              join restaurants r on r.claimed_from_import_id = l.id
              where (l.raw_data->'claimPitch'->>'claimCompletedAt') is not null
                 or (l.raw_data->'claimPitch'->>'claimStartedAt') is not null
              ${hasCityFilter ? sql`and lower(trim(coalesce(l.city, ''))) = ${cityKey}` : sql``}
            )
            select
              count(*) filter (
                where pc.pitched_at is not null
                  and r.updated_at >= pc.pitched_at
              )::int as "claimedProfilesUpdatedAfterPitch",
              count(*) filter (
                where pc.pitched_at is not null
                  and exists (select 1 from menu_items mi where mi.restaurant_id = r.id)
              )::int as "claimedProfilesWithMenuAfterPitch",
              count(*) filter (
                where pc.pitched_at is not null
                  and exists (select 1 from truck_manual_schedules tms where tms.truck_id = r.id)
              )::int as "claimedProfilesWithScheduleAfterPitch",
              count(*) filter (
                where pc.pitched_at is not null
                  and (coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> '')
              )::int as "claimedProfilesWithContactAfterPitch",
              count(*) filter (
                where pc.pitched_at is not null
                  and (coalesce(trim(r.logo_url), '') <> '' or coalesce(trim(r.cover_image_url), '') <> '')
              )::int as "claimedProfilesWithPhotoAfterPitch",
              count(*) filter (
                where pc.pitched_at is not null
                  and (coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> '')
                  and (
                    exists (select 1 from menu_items mi2 where mi2.restaurant_id = r.id)
                    or exists (select 1 from truck_manual_schedules tms2 where tms2.truck_id = r.id)
                  )
                  and (
                    coalesce(trim(r.logo_url), '') <> ''
                    or coalesce(trim(r.cover_image_url), '') <> ''
                    or exists (
                      select 1
                      from request_logs rl
                      where rl.entity_type = 'restaurant'
                        and rl.entity_id = r.id
                        and rl.surface = 'public_profile'
                        and rl.event_type = 'profile_action'
                    )
                  )
              )::int as "claimUsefulProfilesCount",
              count(*) filter (where pc.pitched_at is not null)::int as "claimTrackedProfilesCount"
            from pitched_claims pc
            join restaurants r on r.id = pc.restaurant_id
          `),
          db.execute(sql`
            with city_restaurants as (
              select r.*
              from restaurants r
              where r.is_active = true
              ${hasCityFilter ? sql`and lower(trim(coalesce(r.city, ''))) = ${cityKey}` : sql``}
            ),
            cohort_flags as (
              select
                r.id,
                (
                  (coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> '')
                  and (
                    exists (select 1 from menu_items mi where mi.restaurant_id = r.id)
                    or exists (select 1 from truck_manual_schedules tms where tms.truck_id = r.id)
                  )
                  and (
                    coalesce(trim(r.logo_url), '') <> ''
                    or coalesce(trim(r.cover_image_url), '') <> ''
                    or exists (
                      select 1
                      from request_logs rl
                      where rl.entity_type = 'restaurant'
                        and rl.entity_id = r.id
                        and rl.surface = 'public_profile'
                        and rl.event_type = 'profile_action'
                    )
                  )
                ) as is_useful
              from city_restaurants r
            ),
            profile_activity as (
              select
                cf.id,
                cf.is_useful,
                exists (
                  select 1
                  from request_logs rv
                  where rv.entity_type = 'restaurant'
                    and rv.entity_id = cf.id
                    and rv.surface = 'public_profile'
                    and rv.event_type = 'profile_view'
                ) as has_view,
                exists (
                  select 1
                  from request_logs ra
                  where ra.entity_type = 'restaurant'
                    and ra.entity_id = cf.id
                    and ra.surface = 'public_profile'
                    and ra.event_type = 'profile_action'
                ) as has_action,
                exists (
                  select 1
                  from request_logs rb
                  where rb.entity_type = 'restaurant'
                    and rb.entity_id = cf.id
                    and rb.surface = 'public_profile'
                    and rb.event_type in ('booking_click', 'menu_click', 'directions_click', 'call_click')
                ) as has_booking_click
              from cohort_flags cf
            )
            select
              count(*) filter (where pa.is_useful)::int as "usefulProfilesTotal",
              count(*) filter (where pa.is_useful and pa.has_view)::int as "usefulProfilesWithViews",
              count(*) filter (where pa.is_useful and pa.has_action)::int as "usefulProfilesWithActions",
              coalesce(avg(case when pa.is_useful then case when pa.has_view then 1.0 else 0.0 end end), 0)::numeric as "usefulViewRate",
              coalesce(avg(case when not pa.is_useful then case when pa.has_view then 1.0 else 0.0 end end), 0)::numeric as "nonUsefulViewRate",
              coalesce(avg(case when pa.is_useful then case when pa.has_action then 1.0 else 0.0 end end), 0)::numeric as "usefulActionRate",
              coalesce(avg(case when not pa.is_useful then case when pa.has_action then 1.0 else 0.0 end end), 0)::numeric as "nonUsefulActionRate",
              coalesce(avg(case when pa.is_useful then case when pa.has_booking_click then 1.0 else 0.0 end end), 0)::numeric as "usefulBookingClickRate",
              coalesce(avg(case when not pa.is_useful then case when pa.has_booking_click then 1.0 else 0.0 end end), 0)::numeric as "nonUsefulBookingClickRate"
            from profile_activity pa
          `),
          db.execute(sql`
            with city_restaurants as (
              select r.*
              from restaurants r
              where r.is_active = true
              ${hasCityFilter ? sql`and lower(trim(coalesce(r.city, ''))) = ${cityKey}` : sql``}
            ),
            booking_intent_cohorts as (
              select
                r.id,
                (
                  (coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> '')
                  and (
                    exists (select 1 from menu_items mi where mi.restaurant_id = r.id)
                    or exists (select 1 from truck_manual_schedules tms where tms.truck_id = r.id)
                  )
                  and (
                    coalesce(trim(r.logo_url), '') <> ''
                    or coalesce(trim(r.cover_image_url), '') <> ''
                    or exists (
                      select 1
                      from request_logs rl
                      where rl.entity_type = 'restaurant'
                        and rl.entity_id = r.id
                        and rl.surface = 'public_profile'
                        and rl.event_type = 'profile_action'
                    )
                  )
                ) as is_useful,
                exists (
                  select 1
                  from request_logs ri
                  where ri.entity_type = 'restaurant'
                    and ri.entity_id = r.id
                    and ri.surface = 'public_profile'
                    and ri.event_type in (
                      'truck_booking_click',
                      'booking_click',
                      'schedule_click',
                      'parking_pass_click',
                      'catering_click',
                      'call_click',
                      'directions_click'
                    )
                ) as has_booking_intent,
                exists (
                  select 1
                  from request_logs rp
                  where rp.entity_type = 'restaurant'
                    and rp.entity_id = r.id
                    and rp.surface = 'public_profile'
                    and rp.event_type = 'parking_pass_click'
                ) as has_parking_pass_click
              from city_restaurants r
            )
            select
              count(*) filter (where has_booking_intent)::int as "bookingIntentProfilesTotal",
              count(*) filter (where is_useful and has_booking_intent)::int as "bookingIntentFromUsefulProfiles",
              count(*) filter (where not is_useful and has_booking_intent)::int as "bookingIntentFromNonUsefulProfiles",
              coalesce(avg(case when is_useful then case when has_booking_intent then 1.0 else 0.0 end end), 0)::numeric as "bookingIntentUsefulProfileRate",
              coalesce(avg(case when not is_useful then case when has_booking_intent then 1.0 else 0.0 end end), 0)::numeric as "bookingIntentNonUsefulProfileRate",
              count(*) filter (where has_parking_pass_click)::int as "parkingPassClickProfilesTotal"
            from booking_intent_cohorts
          `),
          db.execute(sql`
            with active_parking_pass_listings as (
              select
                es.id as series_id,
                es.default_max_trucks,
                h.id as host_id,
                h.latitude,
                h.longitude,
                h.spot_count,
                h.stripe_connect_account_id,
                h.stripe_onboarding_completed,
                h.stripe_charges_enabled,
                h.stripe_payouts_enabled
              from event_series es
              join hosts h on h.id = es.host_id
              where es.series_type = 'parking_pass'
                and es.status = 'published'
                ${hasCityFilter ? sql`and lower(trim(coalesce(h.city, ''))) = ${cityKey}` : sql``}
            ),
            parking_pass_bookings_by_series as (
              select
                e.series_id,
                count(eb.id) filter (where eb.status = 'confirmed')::int as confirmed_bookings
              from events e
              left join event_bookings eb on eb.event_id = e.id
              where e.event_type = 'parking_pass'
              group by e.series_id
            ),
            missing_truck_profiles as (
              select count(*)::int as count
              from restaurants r
              where r.is_active = true
                ${hasCityFilter ? sql`and lower(trim(coalesce(r.city, ''))) = ${cityKey}` : sql``}
                and exists (
                  select 1
                  from request_logs ri
                  where ri.entity_type = 'restaurant'
                    and ri.entity_id = r.id
                    and ri.surface = 'public_profile'
                    and ri.event_type in (
                      'truck_booking_click',
                      'booking_click',
                      'schedule_click',
                      'parking_pass_click',
                      'catering_click',
                      'call_click',
                      'directions_click'
                    )
                )
                and not (
                  (coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> '')
                  and (
                    exists (select 1 from menu_items mi where mi.restaurant_id = r.id)
                    or exists (select 1 from truck_manual_schedules tms where tms.truck_id = r.id)
                  )
                  and (
                    coalesce(trim(r.logo_url), '') <> ''
                    or coalesce(trim(r.cover_image_url), '') <> ''
                    or exists (
                      select 1
                      from request_logs rl
                      where rl.entity_type = 'restaurant'
                        and rl.entity_id = r.id
                        and rl.surface = 'public_profile'
                        and rl.event_type = 'profile_action'
                    )
                  )
                )
            )
            select
              count(*) filter (
                where coalesce(appl.stripe_connect_account_id, '') = ''
                  or coalesce(appl.stripe_onboarding_completed, false) = false
                  or coalesce(appl.stripe_charges_enabled, false) = false
                  or coalesce(appl.stripe_payouts_enabled, false) = false
              )::int as "parkingPassPaymentDisabledLeak",
              count(*) filter (
                where coalesce(appl.default_max_trucks, 0) <= 0
                  or coalesce(appl.spot_count, 0) <= 0
                  or coalesce(pbbs.confirmed_bookings, 0) >= greatest(
                    coalesce(appl.default_max_trucks, 0),
                    coalesce(appl.spot_count, 0)
                  )
              )::int as "parkingPassHostCapacityLeak",
              count(*) filter (
                where appl.latitude is null
                  or appl.longitude is null
                  or coalesce(trim(appl.latitude::text), '') = ''
                  or coalesce(trim(appl.longitude::text), '') = ''
              )::int as "parkingPassMissingHostCoordinateLeak",
              coalesce((select count from missing_truck_profiles), 0)::int as "parkingPassMissingTruckProfileLeak"
            from active_parking_pass_listings appl
            left join parking_pass_bookings_by_series pbbs
              on pbbs.series_id = appl.series_id
          `),
          db.execute(sql`
            select distinct on (rl.metadata->>'fixId')
              rl.metadata->>'fixId' as "fixId",
              rl.metadata->>'status' as "status",
              rl.metadata->>'fixOutcomeStatus' as "fixOutcomeStatus",
              rl.metadata->>'fixOutcomeNotes' as "fixOutcomeNotes",
              rl.metadata->>'fixResolvedAt' as "fixResolvedAt",
              rl.metadata->>'fixResolvedByUserId' as "fixResolvedByUserId",
              nullif(rl.metadata->>'linkedMetricBefore', '')::numeric as "linkedMetricBefore",
              rl.created_at as "createdAt"
            from request_logs rl
            where rl.surface = 'launch_board'
              and rl.event_type = 'leak_fix_outcome'
              ${hasCityFilter ? sql`and lower(trim(coalesce(rl.metadata->>'marketCity', ''))) = ${cityKey}` : sql``}
            order by rl.metadata->>'fixId', rl.created_at desc
          `),
          db.execute(sql`
            select city from (
              select distinct trim(coalesce(r.city, '')) as city
              from restaurants r
              where coalesce(trim(r.city), '') <> ''
              union
              select distinct trim(coalesce(h.city, '')) as city
              from hosts h
              where coalesce(trim(h.city), '') <> ''
            ) city_pool
            order by city asc
            limit 200
          `),
        ]);

        const restaurantTotal = Number(restaurantTotalsRow?.total || 0);
        const claimedProfiles = Number(restaurantClaimStatsRow?.claimed || 0);
        const claimableProfiles = Math.max(0, restaurantTotal - claimedProfiles);
        const hostsTotal = Number(hostsTotalRow?.total || 0);
        const profilesTotal = restaurantTotal + hostsTotal;
        const profilesWithContact =
          Number(restaurantContactRow?.withContact || 0) +
          Number(hostsContactRow?.withContact || 0);
        const profilesWithPhotoLogo =
          Number(restaurantPhotoRow?.withPhoto || 0) +
          Number(hostsPhotoRow?.withPhoto || 0);
        const profilesWithMenu = Number(menuProfilesRow?.withMenu || 0);
        const profilesWithSchedule = Math.max(
          Number(manualScheduleProfilesRow?.withManualSchedule || 0),
          Number(bookedScheduleProfilesRow?.withBookedSchedule || 0),
        );
        const claimPitchesCreated = Number(
          claimPitchRollupRow?.claimPitchesCreated || 0,
        );
        const claimPitchesOpened = Number(
          claimPitchRollupRow?.claimPitchesOpened || 0,
        );
        const claimPitchesSent = Number(
          claimPitchRollupRow?.claimPitchesSent || 0,
        );
        const claimPitchesStarted = Number(
          claimPitchRollupRow?.claimPitchesStarted || 0,
        );
        const claimPitchesCompleted = Number(
          claimPitchRollupRow?.claimPitchesCompleted || 0,
        );
        const claimPitchOpenRate =
          claimPitchesCreated > 0
            ? Number((claimPitchesOpened / claimPitchesCreated).toFixed(4))
            : 0;
        const claimPitchSentRate =
          claimPitchesCreated > 0
            ? Number((claimPitchesSent / claimPitchesCreated).toFixed(4))
            : 0;
        const claimPitchStartRate =
          claimPitchesCreated > 0
            ? Number((claimPitchesStarted / claimPitchesCreated).toFixed(4))
            : 0;
        const claimPitchCompletionRate =
          claimPitchesCreated > 0
            ? Number((claimPitchesCompleted / claimPitchesCreated).toFixed(4))
            : 0;
        const claimProfileReconciliationRow = (
          (claimProfileReconciliationRows as any)?.rows?.[0] || {}
        ) as Record<string, any>;
        const claimedProfilesUpdatedAfterPitch = Number(
          claimProfileReconciliationRow.claimedProfilesUpdatedAfterPitch || 0,
        );
        const claimedProfilesWithMenuAfterPitch = Number(
          claimProfileReconciliationRow.claimedProfilesWithMenuAfterPitch || 0,
        );
        const claimedProfilesWithScheduleAfterPitch = Number(
          claimProfileReconciliationRow.claimedProfilesWithScheduleAfterPitch || 0,
        );
        const claimedProfilesWithContactAfterPitch = Number(
          claimProfileReconciliationRow.claimedProfilesWithContactAfterPitch || 0,
        );
        const claimedProfilesWithPhotoAfterPitch = Number(
          claimProfileReconciliationRow.claimedProfilesWithPhotoAfterPitch || 0,
        );
        const claimUsefulProfilesCount = Number(
          claimProfileReconciliationRow.claimUsefulProfilesCount || 0,
        );
        const claimTrackedProfilesCount = Number(
          claimProfileReconciliationRow.claimTrackedProfilesCount || 0,
        );
        const claimToUsefulProfileRate =
          claimTrackedProfilesCount > 0
            ? Number((claimUsefulProfilesCount / claimTrackedProfilesCount).toFixed(4))
            : 0;
        const usefulProfileDemandLiftRow = (
          (usefulProfileDemandLiftRows as any)?.rows?.[0] || {}
        ) as Record<string, any>;
        const usefulProfilesTotal = Number(
          usefulProfileDemandLiftRow.usefulProfilesTotal || 0,
        );
        const usefulProfilesWithViews = Number(
          usefulProfileDemandLiftRow.usefulProfilesWithViews || 0,
        );
        const usefulProfilesWithActions = Number(
          usefulProfileDemandLiftRow.usefulProfilesWithActions || 0,
        );
        const usefulViewRate = Number(usefulProfileDemandLiftRow.usefulViewRate || 0);
        const nonUsefulViewRate = Number(
          usefulProfileDemandLiftRow.nonUsefulViewRate || 0,
        );
        const usefulActionRate = Number(
          usefulProfileDemandLiftRow.usefulActionRate || 0,
        );
        const nonUsefulActionRate = Number(
          usefulProfileDemandLiftRow.nonUsefulActionRate || 0,
        );
        const usefulBookingClickRate = Number(
          usefulProfileDemandLiftRow.usefulBookingClickRate || 0,
        );
        const nonUsefulBookingClickRate = Number(
          usefulProfileDemandLiftRow.nonUsefulBookingClickRate || 0,
        );
        const usefulProfileViewLift = Number(
          (usefulViewRate - nonUsefulViewRate).toFixed(4),
        );
        const usefulProfileActionLift = Number(
          (usefulActionRate - nonUsefulActionRate).toFixed(4),
        );
        const usefulProfileBookingClickLift = Number(
          (usefulBookingClickRate - nonUsefulBookingClickRate).toFixed(4),
        );
        const bookingIntentLiftRow = (
          (bookingIntentLiftRows as any)?.rows?.[0] || {}
        ) as Record<string, any>;
        const bookingIntentProfilesTotal = Number(
          bookingIntentLiftRow.bookingIntentProfilesTotal || 0,
        );
        const bookingIntentFromUsefulProfiles = Number(
          bookingIntentLiftRow.bookingIntentFromUsefulProfiles || 0,
        );
        const bookingIntentFromNonUsefulProfiles = Number(
          bookingIntentLiftRow.bookingIntentFromNonUsefulProfiles || 0,
        );
        const bookingIntentUsefulProfileRate = Number(
          Number(bookingIntentLiftRow.bookingIntentUsefulProfileRate || 0).toFixed(4),
        );
        const bookingIntentNonUsefulProfileRate = Number(
          Number(bookingIntentLiftRow.bookingIntentNonUsefulProfileRate || 0).toFixed(4),
        );
        const bookingIntentUsefulLift = Number(
          (bookingIntentUsefulProfileRate - bookingIntentNonUsefulProfileRate).toFixed(4),
        );
        const parkingPassClickProfilesTotal = Number(
          bookingIntentLiftRow.parkingPassClickProfilesTotal || 0,
        );
        const bookingIntentToParkingPassClickRate =
          bookingIntentProfilesTotal > 0
            ? Number((parkingPassClickProfilesTotal / bookingIntentProfilesTotal).toFixed(4))
            : 0;
        const parkingPassRequestLogRow = (
          (parkingPassRequestLogRows as any)?.rows?.[0] || {}
        ) as Record<string, any>;
        const parkingPassViews = Number(parkingPassRequestLogRow.parkingPassViews || 0);
        const parkingPassClicks = Number(parkingPassRequestLogRow.parkingPassClicks || 0);
        const parkingPassBookingStarts = Number(bookingStartsRow?.bookingStarts || 0);
        const parkingPassBookingConfirmations = Number(
          bookingConfirmationsRow?.bookingConfirmations || 0,
        );
        const parkingPassClickToStartRate =
          parkingPassClicks > 0
            ? Number((parkingPassBookingStarts / parkingPassClicks).toFixed(4))
            : 0;
        const parkingPassStartToConfirmRate =
          parkingPassBookingStarts > 0
            ? Number(
                (parkingPassBookingConfirmations / parkingPassBookingStarts).toFixed(4),
              )
            : 0;
        const bookingIntentToBookingStartRate =
          bookingIntentProfilesTotal > 0
            ? Number((parkingPassBookingStarts / bookingIntentProfilesTotal).toFixed(4))
            : 0;
        const bookingIntentToBookingConfirmRate =
          bookingIntentProfilesTotal > 0
            ? Number(
                (parkingPassBookingConfirmations / bookingIntentProfilesTotal).toFixed(4),
              )
            : 0;
        const parkingPassLeakDiagnosticsRow = (
          (parkingPassLeakDiagnosticsRows as any)?.rows?.[0] || {}
        ) as Record<string, any>;
        const activeParkingPassListings = Number(parkingPassListingsRow?.listings || 0);
        const parkingPassNoListingLeak =
          bookingIntentProfilesTotal > 0 && activeParkingPassListings === 0 ? 1 : 0;
        const parkingPassClickNoStartLeak =
          parkingPassClicks > 0 && parkingPassBookingStarts === 0 ? 1 : 0;
        const parkingPassStartNoConfirmLeak =
          parkingPassBookingStarts > 0 && parkingPassBookingConfirmations === 0 ? 1 : 0;
        const parkingPassPaymentDisabledLeak = Number(
          parkingPassLeakDiagnosticsRow.parkingPassPaymentDisabledLeak || 0,
        );
        const parkingPassHostCapacityLeak = Number(
          parkingPassLeakDiagnosticsRow.parkingPassHostCapacityLeak || 0,
        );
        const parkingPassMissingHostCoordinateLeak = Number(
          parkingPassLeakDiagnosticsRow.parkingPassMissingHostCoordinateLeak || 0,
        );
        const parkingPassMissingTruckProfileLeak = Number(
          parkingPassLeakDiagnosticsRow.parkingPassMissingTruckProfileLeak || 0,
        );
        const parkingPassTopLeakReason =
          parkingPassNoListingLeak > 0
            ? "no_active_parking_pass_listing"
            : parkingPassClickNoStartLeak > 0
              ? "click_no_booking_start"
              : parkingPassStartNoConfirmLeak > 0
                ? "booking_start_no_confirmation"
                : parkingPassPaymentDisabledLeak > 0
                  ? "payment_disabled"
                  : parkingPassHostCapacityLeak > 0
                    ? "host_capacity"
                    : parkingPassMissingHostCoordinateLeak > 0
                      ? "missing_host_coordinates"
                      : parkingPassMissingTruckProfileLeak > 0
                        ? "missing_truck_profile"
                        : "none";
        const marketCity = cityFilter || "all";
        const getLeakFixLinkedMetricValue = (fixType: string) => {
          switch (fixType) {
            case "create_parking_pass_listing":
              return Number(parkingPassListingsRow?.listings || 0);
            case "enable_host_payments":
              return parkingPassPaymentDisabledLeak;
            case "add_host_coordinates":
              return parkingPassMissingHostCoordinateLeak;
            case "increase_or_open_capacity":
              return parkingPassHostCapacityLeak;
            case "complete_truck_profile":
            case "add_truck_schedule":
              return parkingPassMissingTruckProfileLeak;
            case "follow_up_booking_start_no_confirm":
              return parkingPassBookingConfirmations;
            case "review_missing_active_hosts":
              return parkingPassBookingStarts;
            default:
              return 0;
          }
        };
        const leakFixOutcomeById = new Map(
          (((leakFixOutcomeRows as any)?.rows || []) as Array<Record<string, any>>)
            .map((row) => [String(row.fixId || ""), row] as const)
            .filter(([fixId]) => Boolean(fixId)),
        );
        const defaultLeakFixQueueState = { status: "open" } as const;
        const buildLeakFix = (
          leakReason: string,
          fixType: string,
          priority: "high" | "medium" | "low",
          title: string,
          description: string,
          targetEntityType: string,
          targetEntityId: string | null,
          targetUrl: string,
        ) => {
          const fixId = `parking-pass:${marketCity}:${fixType}`;
          const outcome = leakFixOutcomeById.get(fixId);
          const linkedMetricAfter = getLeakFixLinkedMetricValue(fixType);
          const linkedMetricBefore =
            outcome?.linkedMetricBefore !== undefined && outcome?.linkedMetricBefore !== null
              ? Number(outcome.linkedMetricBefore)
              : linkedMetricAfter;
          return {
            fixId,
            marketCity,
            leakReason,
            fixType,
            priority,
            title,
            description,
            targetEntityType,
            targetEntityId,
            targetUrl,
            status: leakFixQueueStatuses.has(String(outcome?.status || ""))
              ? String(outcome?.status)
              : defaultLeakFixQueueState.status,
            createdAt: outcome?.createdAt
              ? new Date(outcome.createdAt).toISOString()
              : new Date().toISOString(),
            fixResolvedAt: outcome?.fixResolvedAt || null,
            fixResolvedByUserId: outcome?.fixResolvedByUserId || null,
            fixOutcomeStatus: leakFixOutcomeStatuses.has(
              String(outcome?.fixOutcomeStatus || ""),
            )
              ? String(outcome?.fixOutcomeStatus)
              : "needs_follow_up",
            fixOutcomeNotes: outcome?.fixOutcomeNotes || "",
            linkedMetricBefore,
            linkedMetricAfter,
            linkedMetricDelta: Number((linkedMetricAfter - linkedMetricBefore).toFixed(4)),
          };
        };
        const leakFixQueue = [
          parkingPassNoListingLeak > 0
            ? buildLeakFix(
                "no_active_parking_pass_listing",
                "create_parking_pass_listing",
                "high",
                "Create a Parking Pass listing",
                "Booking intent exists in this market, but there are no active Parking Pass listings to convert it.",
                "market",
                marketCity,
                `/admin-dashboard?tab=parking-pass&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassPaymentDisabledLeak > 0
            ? buildLeakFix(
                "payment_disabled",
                "enable_host_payments",
                "high",
                "Enable host payments",
                "Active Parking Pass listings exist, but one or more hosts are not ready to accept Stripe payments.",
                "host",
                null,
                `/admin-dashboard?tab=parking-pass&filter=payment-disabled&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassMissingHostCoordinateLeak > 0
            ? buildLeakFix(
                "missing_host_coordinates",
                "add_host_coordinates",
                "medium",
                "Add host coordinates",
                "Some Parking Pass hosts are missing usable latitude or longitude, which can suppress discovery and booking confidence.",
                "host",
                null,
                `/admin-dashboard?tab=parking-pass&filter=missing-coordinates&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassHostCapacityLeak > 0
            ? buildLeakFix(
                "host_capacity",
                "increase_or_open_capacity",
                "medium",
                "Increase or open host capacity",
                "Parking Pass listings exist, but capacity is closed, zero, or already filled by confirmed bookings.",
                "host",
                null,
                `/admin-dashboard?tab=parking-pass&filter=capacity&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassMissingTruckProfileLeak > 0
            ? buildLeakFix(
                "missing_truck_profile",
                "complete_truck_profile",
                "medium",
                "Complete truck profiles",
                "Booking intent exists from trucks or profiles that are still missing useful profile requirements.",
                "restaurant",
                null,
                `/admin-dashboard?tab=food-trucks&filter=incomplete&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassMissingTruckProfileLeak > 0
            ? buildLeakFix(
                "missing_truck_profile",
                "add_truck_schedule",
                "low",
                "Add truck schedules",
                "Truck profiles with booking intent need schedule data so customers and hosts can trust availability.",
                "restaurant",
                null,
                `/admin-dashboard?tab=food-trucks&filter=missing-schedule&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassStartNoConfirmLeak > 0
            ? buildLeakFix(
                "booking_start_no_confirmation",
                "follow_up_booking_start_no_confirm",
                "high",
                "Follow up on unconfirmed starts",
                "Parking Pass booking starts are happening, but none are converting into confirmed bookings.",
                "booking",
                null,
                `/admin-dashboard?tab=bookings&filter=unconfirmed&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
          parkingPassClickNoStartLeak > 0
            ? buildLeakFix(
                "click_no_booking_start",
                "review_missing_active_hosts",
                "high",
                "Review host booking path",
                "Customers are clicking Parking Pass, but no booking starts are recorded for this market.",
                "host",
                null,
                `/admin-dashboard?tab=parking-pass&filter=click-no-start&city=${encodeURIComponent(marketCity)}`,
              )
            : null,
        ].filter(Boolean);
        const leakFixesOpen = leakFixQueue.filter(
          (fix: any) => fix.status === "open",
        ).length;
        const leakFixesInProgress = leakFixQueue.filter(
          (fix: any) => fix.status === "in_progress",
        ).length;
        const leakFixesResolved = leakFixQueue.filter(
          (fix: any) => fix.status === "resolved",
        ).length;
        const leakFixesImproved = leakFixQueue.filter(
          (fix: any) => fix.fixOutcomeStatus === "resolved_improved",
        ).length;
        const leakFixResolutionRate =
          leakFixQueue.length > 0
            ? Number((leakFixesResolved / leakFixQueue.length).toFixed(4))
            : 0;
        const leakFixImprovementRate =
          leakFixesResolved > 0
            ? Number((leakFixesImproved / leakFixesResolved).toFixed(4))
            : 0;
        const openCriticalFixCount = leakFixQueue.filter(
          (fix: any) => fix.priority === "high" && fix.status !== "resolved",
        ).length;
        const highestPriorityFix =
          leakFixQueue.find(
            (fix: any) => fix.priority === "high" && fix.status !== "resolved",
          ) ||
          leakFixQueue.find(
            (fix: any) => fix.priority === "medium" && fix.status !== "resolved",
          ) ||
          leakFixQueue.find((fix: any) => fix.status !== "resolved") ||
          leakFixQueue[0] ||
          null;
        const readinessComponents = [
          usefulProfilesTotal > 0 ? 20 : 0,
          bookingIntentProfilesTotal > 0 ? 20 : 0,
          activeParkingPassListings > 0 ? 20 : 0,
          parkingPassBookingStarts > 0 ? 15 : 0,
          parkingPassBookingConfirmations > 0 ? 15 : 0,
          parkingPassPaymentDisabledLeak === 0 ? 5 : 0,
          parkingPassMissingHostCoordinateLeak === 0 ? 5 : 0,
          leakFixesOpen === 0 ? 5 : 0,
          leakFixesImproved > 0 ? 5 : 0,
        ];
        const bookingReadinessScore = Math.min(
          100,
          readinessComponents.reduce((total, value) => total + value, 0),
        );
        const marketHealthStatus =
          openCriticalFixCount > 0 || parkingPassTopLeakReason !== "none"
            ? "blocked"
            : bookingReadinessScore >= 85
              ? "scaling"
              : bookingReadinessScore >= 70
                ? "ready"
                : bookingReadinessScore >= 40
                  ? "building"
                  : "at_risk";
        const topGrowthConstraint =
          parkingPassTopLeakReason !== "none"
            ? parkingPassTopLeakReason
            : bookingIntentProfilesTotal === 0
              ? "booking_intent"
              : usefulProfilesTotal === 0
                ? "useful_profiles"
                : parkingPassBookingConfirmations === 0
                  ? "booking_confirmations"
                  : "none";
        const commandCenter = {
          marketHealthStatus,
          topGrowthConstraint,
          topRecommendedAction:
            highestPriorityFix?.title ||
            "Keep improving useful profiles and booking readiness",
          topRecommendedActionUrl:
            highestPriorityFix?.targetUrl ||
            `/admin-dashboard?tab=launch-board&city=${encodeURIComponent(marketCity)}`,
          highestPriorityFixType: highestPriorityFix?.fixType || "none",
          highestPriorityFixStatus: highestPriorityFix?.status || "none",
          openCriticalFixCount,
          resolvedFixCount: leakFixesResolved,
          improvingFixCount: leakFixesImproved,
          bookingReadinessScore,
        };

        const marketCities = ((cityOptionsRows as any)?.rows || [])
          .map((row: any) => String(row.city || "").trim())
          .filter(Boolean);

        res.json({
          market: {
            city: cityFilter || "all",
            cityFilterApplied: hasCityFilter,
            cityOptions: marketCities,
          },
          commandCenter,
          metrics: {
            profilesTotal,
            claimableProfiles,
            claimedProfiles,
            profilesWithMenu,
            profilesWithSchedule,
            profilesWithContact,
            profilesWithPhotoLogo,
            activeFoodTrucks: Number(activeTrucksRow?.activeFoodTrucks || 0),
            activeHosts: hostsTotal,
            parkingPassListings: Number(parkingPassListingsRow?.listings || 0),
            bookingStarts: Number(bookingStartsRow?.bookingStarts || 0),
            bookingConfirmations: Number(
              bookingConfirmationsRow?.bookingConfirmations || 0,
            ),
            parkingPassViews,
            parkingPassClicks,
            parkingPassBookingStarts,
            parkingPassBookingConfirmations,
            parkingPassClickToStartRate,
            parkingPassStartToConfirmRate,
            bookingIntentToBookingStartRate,
            bookingIntentToBookingConfirmRate,
            parkingPassNoListingLeak,
            parkingPassClickNoStartLeak,
            parkingPassStartNoConfirmLeak,
            parkingPassPaymentDisabledLeak,
            parkingPassHostCapacityLeak,
            parkingPassMissingHostCoordinateLeak,
            parkingPassMissingTruckProfileLeak,
            parkingPassTopLeakReason,
            leakFixesOpen,
            leakFixesInProgress,
            leakFixesResolved,
            leakFixesImproved,
            leakFixResolutionRate,
            leakFixImprovementRate,
            publicProfileViews: Number(publicViewsRow?.views || 0),
            publicProfileActions: Number(publicActionsRow?.actions || 0),
            affiliateLinkOpens: Number(affiliateOpensRow?.opens || 0),
            claimPitchesCreated,
            claimPitchesSent,
            claimPitchesOpened,
            claimPitchesStarted,
            claimPitchesCompleted,
            claimPitchSentRate,
            claimPitchOpenRate,
            claimPitchStartRate,
            claimPitchCompletionRate,
            claimedProfilesUpdatedAfterPitch,
            claimedProfilesWithMenuAfterPitch,
            claimedProfilesWithScheduleAfterPitch,
            claimedProfilesWithContactAfterPitch,
            claimedProfilesWithPhotoAfterPitch,
            claimToUsefulProfileRate,
            usefulProfilesTotal,
            usefulProfilesWithViews,
            usefulProfilesWithActions,
            usefulProfileViewLift,
            usefulProfileActionLift,
            usefulProfileBookingClickLift,
            bookingIntentProfilesTotal,
            bookingIntentFromUsefulProfiles,
            bookingIntentFromNonUsefulProfiles,
            bookingIntentUsefulProfileRate,
            bookingIntentNonUsefulProfileRate,
            bookingIntentUsefulLift,
            bookingIntentToParkingPassClickRate,
          },
          leakFixQueue,
          generatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error building one-market launch board:", error);
        res.status(500).json({ message: "Failed to build launch board" });
      }
    },
  );

  app.post(
    "/api/admin/launch-board/leak-fixes/:fixId/outcome",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const fixId = String(req.params?.fixId || "").trim();
        const status = String(req.body?.status || "").trim();
        const fixOutcomeStatus = String(req.body?.fixOutcomeStatus || "").trim();
        const marketCity = String(req.body?.marketCity || "all").trim() || "all";
        if (!fixId) {
          return res.status(400).json({ message: "fixId is required" });
        }
        if (!leakFixQueueStatuses.has(status)) {
          return res.status(400).json({ message: "Invalid leak fix status" });
        }
        if (!leakFixOutcomeStatuses.has(fixOutcomeStatus)) {
          return res.status(400).json({ message: "Invalid leak fix outcome status" });
        }
        const now = new Date();
        const resolved = status === "resolved" || status === "dismissed";
        const metadata = {
          fixId,
          marketCity,
          leakReason: String(req.body?.leakReason || ""),
          fixType: String(req.body?.fixType || ""),
          status,
          fixOutcomeStatus,
          fixOutcomeNotes: String(req.body?.fixOutcomeNotes || "").slice(0, 1000),
          fixResolvedAt: resolved ? now.toISOString() : null,
          fixResolvedByUserId: resolved ? String(req.user?.id || "") : null,
          linkedMetricBefore:
            req.body?.linkedMetricBefore === undefined
              ? null
              : Number(req.body.linkedMetricBefore),
          targetEntityType: String(req.body?.targetEntityType || ""),
          targetEntityId: req.body?.targetEntityId
            ? String(req.body.targetEntityId)
            : null,
        };
        await db.insert(requestLogs).values({
          method: "POST",
          path: `/api/admin/launch-board/leak-fixes/${encodeURIComponent(
            fixId,
          )}/outcome`,
          statusCode: 200,
          durationMs: 0,
          userId: req.user?.id || null,
          actorType: "human",
          sourceType: "internal",
          eventType: "leak_fix_outcome",
          surface: "launch_board",
          entityId: fixId,
          entityType: "leak_fix",
          ip: req.ip || null,
          userAgent: req.headers?.["user-agent"] || null,
          metadata,
        });
        res.json({ ok: true, mutationAllowed: true, outcome: metadata });
      } catch (error) {
        console.error("Error recording leak fix outcome:", error);
        res.status(500).json({ message: "Failed to record leak fix outcome" });
      }
    },
  );

  app.get(
    "/api/admin/food-trucks/inventory",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const q = normalizeSearch(req.query?.q);
        const filterMissingMenu = String(req.query?.missingMenu || "").toLowerCase() === "true";
        const filterMissingLogo = String(req.query?.missingLogo || "").toLowerCase() === "true";
        const filterMissingOwner = String(req.query?.missingOwner || "").toLowerCase() === "true";
        const filterQuarantined = String(req.query?.quarantined || "").toLowerCase() === "true";
        const filterVerified = String(req.query?.verified || "").toLowerCase() === "true";

        const truckRows = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            address: restaurants.address,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            ownerId: restaurants.ownerId,
            websiteUrl: restaurants.websiteUrl,
            logoUrl: restaurants.logoUrl,
            coverImageUrl: restaurants.coverImageUrl,
            instagramUrl: restaurants.instagramUrl,
            facebookPageUrl: restaurants.facebookPageUrl,
            isVerified: restaurants.isVerified,
            rawData: sql<any>`'{}'::jsonb`,
            updatedAt: restaurants.updatedAt,
            createdAt: restaurants.createdAt,
          })
          .from(restaurants)
          .where(
            and(
              eq(restaurants.isActive, true),
              or(
                eq(restaurants.isFoodTruck, true),
                eq(restaurants.businessType, "food_truck"),
              ),
            ),
          );

        const truckIds = truckRows
          .map((row: any) => String(row.id || "").trim())
          .filter(Boolean);
        const ownerIds = truckRows
          .map((row: any) => String(row.ownerId || "").trim())
          .filter(Boolean);

        const [menuCountRows, ownerRows] = await Promise.all([
          truckIds.length
            ? db
                .select({
                  restaurantId: menuItems.restaurantId,
                  count: sql<number>`count(*)`.mapWith(Number),
                })
                .from(menuItems)
                .where(inArray(menuItems.restaurantId, truckIds))
                .groupBy(menuItems.restaurantId)
            : Promise.resolve([]),
          ownerIds.length
            ? db
                .select({
                  id: users.id,
                  email: users.email,
                })
                .from(users)
                .where(inArray(users.id, ownerIds))
            : Promise.resolve([]),
        ]);

        const menuCountByTruck = new Map<string, number>();
        for (const row of menuCountRows as any[]) {
          menuCountByTruck.set(String(row.restaurantId || ""), Number(row.count || 0));
        }
        const ownerById = new Map<string, string | null>();
        for (const row of ownerRows as any[]) {
          ownerById.set(String(row.id || ""), String(row.email || "").trim() || null);
        }

        const toSlug = (value: string | null | undefined) =>
          String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "")
            .slice(0, 80);

        const trucks = truckRows
          .map((row: any) => {
            const id = String(row.id || "").trim();
            const name = String(row.name || "").trim();
            const menuItemCount = Number(menuCountByTruck.get(id) || 0);
            const hasMenu = menuItemCount > 0;
            const hasLogo = Boolean(String(row.logoUrl || "").trim());
            const hasCoverImage = Boolean(String(row.coverImageUrl || "").trim());
            const hasPhone = Boolean(String(row.phone || "").trim());
            const ownerUserId = String(row.ownerId || "").trim() || null;
            const rawOwnerEmail = ownerUserId ? ownerById.get(ownerUserId) || null : null;
            const ownerEmail = formatOwnerEmailDisplay(rawOwnerEmail);
            const hasOwner = Boolean(ownerUserId);
            const hasEmail = Boolean(rawOwnerEmail && ownerEmail !== "Deleted owner");
            const hasSocials =
              Boolean(String(row.instagramUrl || "").trim()) ||
              Boolean(String(row.facebookPageUrl || "").trim());
            const quarantineReview = buildQuarantineReview(row);
            const isQuarantined = Boolean(quarantineReview.isQuarantined);
            const isVerified = Boolean(row.isVerified);

            const missingFields: string[] = [];
            if (!hasLogo) missingFields.push("logo");
            if (!hasCoverImage) missingFields.push("cover_image");
            if (!hasMenu) missingFields.push("menu");
            if (!hasPhone) missingFields.push("phone");
            if (!hasEmail) missingFields.push("email");
            if (!hasSocials) missingFields.push("socials");
            if (!String(row.city || "").trim()) missingFields.push("city");
            if (!hasOwner) missingFields.push("owner");
            if (!isVerified) missingFields.push("verification");
            if (isQuarantined) missingFields.push("quarantine_review");

            return {
              id,
              name: name || "Unnamed truck",
              city: String(row.city || "").trim() || null,
              phone: String(row.phone || "").trim() || null,
              ownerUserId,
              ownerEmail,
              publicProfileUrl: `/p/truck/${id}/${toSlug(name) || id}`,
              hasLogo,
              logoUrl: String(row.logoUrl || "").trim() || null,
              hasCoverImage,
              coverImageUrl: String(row.coverImageUrl || "").trim() || null,
              menuItemCount,
              hasMenu,
              hasEmail,
              hasSocials,
              isVerified,
              isQuarantined,
              rowStatus: getAdminSmokeRowStatus({
                name,
                isQuarantined,
                isActive: true,
                ownerEmail: rawOwnerEmail,
                missingFields,
              }),
              missingFields,
              lastUpdatedAt: row.updatedAt || row.createdAt || null,
            };
          })
          .filter((truck: any) => {
            if (!q) return true;
            const haystack = [
              truck.name,
              truck.city || "",
              truck.phone || "",
              truck.ownerEmail || "",
            ]
              .join(" ")
              .toLowerCase();
            return haystack.includes(q);
          })
          .filter((truck: any) => (filterMissingMenu ? !truck.hasMenu : true))
          .filter((truck: any) => (filterMissingLogo ? !truck.hasLogo : true))
          .filter((truck: any) => (filterMissingOwner ? !truck.ownerUserId : true))
          .filter((truck: any) => (filterQuarantined ? truck.isQuarantined : true))
          .filter((truck: any) => (filterVerified ? truck.isVerified : true))
          .sort(
            (a: any, b: any) =>
              new Date(String(b.lastUpdatedAt || 0)).getTime() -
              new Date(String(a.lastUpdatedAt || 0)).getTime(),
          );

        const counts = {
          total: trucks.length,
          missingMenu: trucks.filter((truck: any) => !truck.hasMenu).length,
          missingLogo: trucks.filter((truck: any) => !truck.hasLogo).length,
          missingOwner: trucks.filter((truck: any) => !truck.ownerUserId).length,
          quarantined: trucks.filter((truck: any) => truck.isQuarantined).length,
        };

        res.json({ trucks, counts });
      } catch (error) {
        console.error("Error fetching admin food truck inventory:", error);
        res.status(500).json({ message: "Failed to fetch food truck inventory" });
      }
    },
  );

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
        const authDiagnosticsByUserId = new Map(
          allUsers.map((user: any) => [String(user.id), getSafeAuthDiagnostics(user)]),
        );
        const sanitized = sanitizeUsers(allUsers, { includeStripe: true });

        // Attach business name from restaurants table (left join by owner_id)
        const restaurantRows = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            name: restaurants.name,
            city: restaurants.city,
            state: restaurants.state,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            isActive: restaurants.isActive,
            isVerified: restaurants.isVerified,
            insuranceVerified: restaurants.insuranceVerified,
            insuranceVerifiedAt: restaurants.insuranceVerifiedAt,
            insuranceExpiresAt: restaurants.insuranceExpiresAt,
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

        const activityRows = await db
          .select({
            userId: telemetryEvents.userId,
            lastActiveAt: sql<Date>`max(${telemetryEvents.createdAt})`,
            activityCount: sql<number>`count(*)`.mapWith(Number),
          })
          .from(telemetryEvents)
          .where(isNotNull(telemetryEvents.userId))
          .groupBy(telemetryEvents.userId);
        const activityByUser = new Map<string, any>();
        for (const activity of activityRows) {
          if (activity.userId) {
            activityByUser.set(activity.userId, activity);
          }
        }

        const withBusiness = sanitized.map((u: any) => ({
          ...u,
          ...(authDiagnosticsByUserId.get(String(u.id)) || {
            authProvider: "unknown",
            hasPasswordLogin: false,
            hasGoogleAuth: false,
            hasFacebookAuth: false,
            requiresPasswordReset: false,
          }),
          businessName:
            u.businessName || restaurantByOwner.get(u.id)?.name || null,
          restaurantId: restaurantByOwner.get(u.id)?.id || null,
          businessCity: restaurantByOwner.get(u.id)?.city || null,
          businessState: restaurantByOwner.get(u.id)?.state || null,
          businessType: restaurantByOwner.get(u.id)?.businessType || null,
          businessIsFoodTruck:
            restaurantByOwner.get(u.id)?.isFoodTruck ?? null,
          businessIsActive: restaurantByOwner.get(u.id)?.isActive ?? null,
          businessIsVerified: restaurantByOwner.get(u.id)?.isVerified ?? null,
          insuranceVerified:
            restaurantByOwner.get(u.id)?.insuranceVerified === true &&
            (!restaurantByOwner.get(u.id)?.insuranceExpiresAt ||
              new Date(String(restaurantByOwner.get(u.id)?.insuranceExpiresAt)).getTime() >
                Date.now()),
          insuranceVerifiedAt:
            restaurantByOwner.get(u.id)?.insuranceVerifiedAt || null,
          insuranceExpiresAt:
            restaurantByOwner.get(u.id)?.insuranceExpiresAt || null,
          hasRestaurant: restaurantByOwner.has(u.id),
          defaultCity: defaultAddressByUser.get(u.id)?.city || null,
          defaultState: defaultAddressByUser.get(u.id)?.state || null,
          defaultPostalCode:
            defaultAddressByUser.get(u.id)?.postalCode || u.postalCode || null,
          lastActiveAt: activityByUser.get(u.id)?.lastActiveAt || null,
          activityEventCount: activityByUser.get(u.id)?.activityCount || 0,
        }));

        res.json(withBusiness);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    },
  );

  app.get(
    "/api/admin/profile-quarantine/suspects",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const q = normalizeSearch(req.query?.q);
        const limitRaw = Number.parseInt(String(req.query?.limit || "100"), 10);
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(limitRaw, 500))
          : 100;

        const rows = await db
          .select({
            id: restaurants.id,
            ownerId: restaurants.ownerId,
            name: restaurants.name,
            businessType: restaurants.businessType,
            isFoodTruck: restaurants.isFoodTruck,
            city: restaurants.city,
            state: restaurants.state,
            phone: restaurants.phone,
            email: users.email,
            websiteUrl: restaurants.websiteUrl,
            address: restaurants.address,
            isVerified: restaurants.isVerified,
            isActive: restaurants.isActive,
            rawData: sql<any>`coalesce(${restaurants}.raw_data, '{}'::jsonb)`,
            createdAt: restaurants.createdAt,
            updatedAt: restaurants.updatedAt,
          })
          .from(restaurants)
          .leftJoin(users, eq(users.id, restaurants.ownerId));

        const suspects = rows
          .map((row: any) => {
            const review = buildQuarantineReview(row);
            if (!review.isQuarantined) return null;
            const hiddenFields = [
              ...(review.hidePublicTrustFields
                ? ["verifiedProfile", "phonePublic", "addressPublicLabel", "websiteUrl", "socialLinks"]
                : []),
              ...(review.hideMedia ? ["logoUrl", "coverImageUrl", "galleryImages"] : []),
            ];
            return {
              id: row.id,
              ownerId: row.ownerId,
              name: row.name,
              businessType: row.businessType,
              isFoodTruck: row.isFoodTruck,
              city: row.city,
              state: row.state,
              isActive: row.isActive,
              isVerified: row.isVerified,
              reasons: review.reasons,
              hiddenFields,
              hidePublicTrustFields: review.hidePublicTrustFields,
              hideMedia: review.hideMedia,
              hasHardIdentityAnchor: review.hasHardIdentityAnchor,
              evidence: review.evidence,
              updatedAt: row.updatedAt,
              createdAt: row.createdAt,
            };
          })
          .filter(Boolean) as Array<Record<string, any>>;

        const filtered = q
          ? suspects.filter((item) => {
              const haystack = [
                item.name,
                item.businessType,
                item.city,
                item.state,
                item.reasons.join(" "),
                item.evidence?.externalBusinessName || "",
              ]
                .map((value) => String(value || "").toLowerCase())
                .join(" ");
              return haystack.includes(q);
            })
          : suspects;

        const sliced = filtered
          .sort(
            (a, b) =>
              new Date(b.updatedAt || b.createdAt || 0).getTime() -
              new Date(a.updatedAt || a.createdAt || 0).getTime(),
          )
          .slice(0, limit);

        res.json({
          total: filtered.length,
          rows: sliced,
        });
      } catch (error) {
        console.error("Error fetching profile quarantine suspects:", error);
        res.status(500).json({ message: "Failed to fetch quarantine suspects" });
      }
    },
  );

  app.post(
    "/api/admin/profile-quarantine/:profileId/evidence/:evidenceId/accept",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const profileId = String(req.params?.profileId || "").trim();
        const evidenceId = String(req.params?.evidenceId || "")
          .trim()
          .toLowerCase()
          .replace(/-/g, "_");
        if (!profileId) {
          return res.status(400).json({ message: "profileId is required" });
        }
        if (!QUARANTINE_EVIDENCE_IDS.has(evidenceId)) {
          return res.status(400).json({ message: "Unsupported evidenceId" });
        }

        const actorId = String(req.user?.id || "").trim() || null;
        const note = String(req.body?.note || "").trim() || null;
        const nowIso = new Date().toISOString();

        const targetRows = await db
          .select({
            id: restaurants.id,
            rawData: sql<any>`coalesce(${restaurants}.raw_data, '{}'::jsonb)`,
          })
          .from(restaurants)
          .where(eq(restaurants.id, profileId))
          .limit(1);
        const target = targetRows[0];
        if (!target) {
          return res.status(404).json({ message: "Profile not found" });
        }

        const rawData =
          target.rawData && typeof target.rawData === "object"
            ? { ...(target.rawData as Record<string, any>) }
            : {};
        const evidenceQuarantine =
          rawData.evidenceQuarantine && typeof rawData.evidenceQuarantine === "object"
            ? { ...(rawData.evidenceQuarantine as Record<string, any>) }
            : {};
        const decisions =
          evidenceQuarantine.decisions && typeof evidenceQuarantine.decisions === "object"
            ? { ...(evidenceQuarantine.decisions as Record<string, any>) }
            : {};

        decisions[evidenceId] = {
          status: "accepted",
          updatedAt: nowIso,
          updatedBy: actorId,
          note,
        };
        evidenceQuarantine.decisions = decisions;
        evidenceQuarantine.lastDecisionAt = nowIso;
        evidenceQuarantine.lastDecisionBy = actorId;
        rawData.evidenceQuarantine = evidenceQuarantine;

        await db
          .update(restaurants)
          .set({
            rawData: rawData as any,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, profileId));

        res.json({
          ok: true,
          profileId,
          evidenceId,
          decision: decisions[evidenceId],
        });
      } catch (error) {
        console.error("Error accepting quarantine evidence:", error);
        res.status(500).json({ message: "Failed to accept evidence decision" });
      }
    },
  );

  app.post(
    "/api/admin/profile-quarantine/:profileId/evidence/:evidenceId/reject",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const profileId = String(req.params?.profileId || "").trim();
        const evidenceId = String(req.params?.evidenceId || "")
          .trim()
          .toLowerCase()
          .replace(/-/g, "_");
        if (!profileId) {
          return res.status(400).json({ message: "profileId is required" });
        }
        if (!QUARANTINE_EVIDENCE_IDS.has(evidenceId)) {
          return res.status(400).json({ message: "Unsupported evidenceId" });
        }

        const actorId = String(req.user?.id || "").trim() || null;
        const reason = String(req.body?.reason || "").trim() || null;
        const nowIso = new Date().toISOString();

        const targetRows = await db
          .select({
            id: restaurants.id,
            rawData: sql<any>`coalesce(${restaurants}.raw_data, '{}'::jsonb)`,
          })
          .from(restaurants)
          .where(eq(restaurants.id, profileId))
          .limit(1);
        const target = targetRows[0];
        if (!target) {
          return res.status(404).json({ message: "Profile not found" });
        }

        const rawData =
          target.rawData && typeof target.rawData === "object"
            ? { ...(target.rawData as Record<string, any>) }
            : {};
        const evidenceQuarantine =
          rawData.evidenceQuarantine && typeof rawData.evidenceQuarantine === "object"
            ? { ...(rawData.evidenceQuarantine as Record<string, any>) }
            : {};
        const decisions =
          evidenceQuarantine.decisions && typeof evidenceQuarantine.decisions === "object"
            ? { ...(evidenceQuarantine.decisions as Record<string, any>) }
            : {};

        decisions[evidenceId] = {
          status: "rejected",
          updatedAt: nowIso,
          updatedBy: actorId,
          reason,
        };
        evidenceQuarantine.decisions = decisions;
        evidenceQuarantine.lastDecisionAt = nowIso;
        evidenceQuarantine.lastDecisionBy = actorId;
        rawData.evidenceQuarantine = evidenceQuarantine;

        await db
          .update(restaurants)
          .set({
            rawData: rawData as any,
            updatedAt: new Date(),
          })
          .where(eq(restaurants.id, profileId));

        res.json({
          ok: true,
          profileId,
          evidenceId,
          decision: decisions[evidenceId],
        });
      } catch (error) {
        console.error("Error rejecting quarantine evidence:", error);
        res.status(500).json({ message: "Failed to reject evidence decision" });
      }
    },
  );

  const buildAdminMessageRecipients = async (
    filters: Record<string, any>,
    explicitRecipientIds?: string[],
  ) => {
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
    const explicitSet =
      Array.isArray(explicitRecipientIds) && explicitRecipientIds.length > 0
        ? new Set(
            explicitRecipientIds
              .map((value) => String(value || "").trim())
              .filter(Boolean),
          )
        : null;

    const recipients = allUsers
      .map((user: any) => {
        const businesses = restaurantsByOwner.get(user.id) || [];
        const defaultAddress = defaultAddressByUser.get(user.id);
        return { user, businesses, defaultAddress };
      })
      .filter(({ user, businesses, defaultAddress }) => {
        if (explicitSet && !explicitSet.has(String(user.id || ""))) return false;
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
        const recipientIds = Array.isArray(req.body?.recipientIds)
          ? req.body.recipientIds
          : undefined;
        const { recipients, skippedOptOut } = await buildAdminMessageRecipients(
          req.body?.filters || {},
          recipientIds,
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

        const recipientIds = Array.isArray(req.body?.recipientIds)
          ? req.body.recipientIds
          : undefined;
        const { recipients, skippedOptOut } = await buildAdminMessageRecipients(
          req.body?.filters || {},
          recipientIds,
        );
        const maxRecipients = parseAdminBroadcastMaxRecipients(
          process.env.ADMIN_BROADCAST_MAX_RECIPIENTS,
        );
        const cappedRecipients = recipients.slice(0, maxRecipients);
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
            "marketing",
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
          maxRecipients,
        });
      } catch (error) {
        console.error("Error sending admin message:", error);
        res.status(500).json({ message: "Failed to send message" });
      }
    },
  );
}
