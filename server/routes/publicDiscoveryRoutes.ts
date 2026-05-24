import type { Express } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import {
  affiliateShareEvents,
  cities,
  deals,
  events,
  hosts,
  requestLogs,
  restaurants,
  searchQueryEvents,
  socialPostQueue,
  supplierProducts,
  suppliers,
  videoStories,
} from "@shared/schema";
import {
  assertPublicResponseSafe,
  toPublicBarProfile,
  toPublicLocationProfile,
  toPublicRestaurantProfile,
  toPublicSupplierProfile,
  toPublicTruckProfile,
} from "../publicProfiles";

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const resolvePublicBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVICE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

const hoursSince = (value?: string | Date | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
};

const staleBucketFromHours = (hours: number | null) => {
  if (hours == null) return "unknown";
  if (hours <= 24) return "fresh";
  if (hours <= 24 * 7) return "recent";
  if (hours <= 24 * 30) return "aging";
  return "stale";
};

const machineReadinessBucket = (score: number) => {
  if (score >= 4) return "ready";
  if (score >= 2) return "developing";
  return "blocked";
};

const roundToWholeHours = (value: number | null) =>
  value == null ? null : Math.max(0, Math.round(value));

const normalizeLoose = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const keywordTokens = (value: unknown) =>
  normalizeLoose(value)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

const botSignatureLabel = (userAgent?: string | null) => {
  const ua = String(userAgent || "");
  if (/gptbot/i.test(ua)) return "GPTBot";
  if (/chatgpt-user/i.test(ua)) return "ChatGPT-User";
  if (/oai-searchbot/i.test(ua)) return "OAI-SearchBot";
  if (/claudebot|anthropic/i.test(ua)) return "Claude";
  if (/perplexity/i.test(ua)) return "Perplexity";
  if (/googlebot|google-inspectiontool/i.test(ua)) return "Googlebot";
  if (/bingbot/i.test(ua)) return "Bingbot";
  if (/bytespider/i.test(ua)) return "Bytespider";
  if (/bot|crawler|spider|fetcher/i.test(ua)) return "Bot";
  return null;
};

const countBy = <T extends string>(values: T[]) =>
  values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

const sendPublicJson = <T>(res: any, payload: T) =>
  res.json(assertPublicResponseSafe(payload));

export function registerPublicDiscoveryRoutes(app: Express) {
  app.get("/api/public/resolve/:entity/:slug", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase().trim();
      const slugOrId = String(req.params.slug || "").trim();
      if (!entity || !slugOrId) {
        return res.status(400).json({ exists: false, reason: "invalid_request" });
      }

      const extractId = (value: string) => {
        const marker = value.lastIndexOf("--");
        if (marker >= 0) return value.slice(marker + 2);
        const uuid = value.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        return uuid?.[0] || value;
      };
      const idHint = extractId(slugOrId);
      const safeBase = resolvePublicBaseUrl();

      if (["restaurant", "truck", "bar"].includes(entity)) {
        let row: any = await storage.getRestaurant(idHint);
        if (!row || !row.isActive) {
          const allRows = (await storage.getAllRestaurants()).filter(
            (candidate: any) => Boolean(candidate?.isActive),
          );
          const slugKey = toSlug(slugOrId.replace(/--[0-9a-f-]{36}$/i, ""));
          row = allRows.find((candidate: any) => toSlug(candidate?.name) === slugKey);
        }
        if (!row) {
          return res.status(404).json({ exists: false, reason: "not_found" });
        }

        const rowSlug = toSlug(row.name) || String(row.id);
        const routeEntity =
          entity === "truck"
            ? "truck"
            : entity === "bar"
              ? "bar"
              : row.isFoodTruck || row.businessType === "food_truck"
                ? "truck"
                : row.businessType === "bar"
                  ? "bar"
                  : "restaurant";
        const canonicalPath = `/p/${routeEntity}/${row.id}/${rowSlug}`;
        return sendPublicJson(res, {
          exists: true,
          entityType: routeEntity,
          id: String(row.id),
          slug: rowSlug,
          canonicalUrl: `${safeBase}${canonicalPath}`,
        });
      }

      if (["host", "location"].includes(entity)) {
        let row: any = await storage.getHost(idHint);
        if (!row) {
          const hostRows = await db.select().from(hosts);
          const slugKey = toSlug(slugOrId.replace(/--[0-9a-f-]{36}$/i, ""));
          row = hostRows.find(
            (candidate: any) => toSlug(candidate?.businessName) === slugKey,
          );
        }
        if (!row) {
          return res.status(404).json({ exists: false, reason: "not_found" });
        }
        const rowSlug = toSlug(row.businessName) || String(row.id);
        const canonicalPath = `/p/location/${row.id}/${rowSlug}`;
        return sendPublicJson(res, {
          exists: true,
          entityType: "location",
          id: String(row.id),
          slug: rowSlug,
          canonicalUrl: `${safeBase}${canonicalPath}`,
        });
      }

      if (entity === "supplier") {
        const [row] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, idHint), eq(suppliers.isActive, true)))
          .limit(1);
        if (!row) {
          return res.status(404).json({ exists: false, reason: "not_found" });
        }
        const rowSlug = toSlug(row.businessName) || String(row.id);
        const canonicalPath = `/p/supplier/${row.id}/${rowSlug}`;
        return sendPublicJson(res, {
          exists: true,
          entityType: "supplier",
          id: String(row.id),
          slug: rowSlug,
          canonicalUrl: `${safeBase}${canonicalPath}`,
        });
      }

      return res.status(400).json({ exists: false, reason: "unsupported_entity" });
    } catch (error) {
      console.error("Error resolving public profile slug:", error);
      res.status(500).json({ exists: false, reason: "server_error" });
    }
  });

  app.get("/api/public/canonical/:entity/:id", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase().trim();
      const id = String(req.params.id || "").trim();
      if (!entity || !id) {
        return res.status(400).json({ message: "Entity and id are required" });
      }

      const baseUrl = resolvePublicBaseUrl();

      if (entity === "restaurant") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const activeDeals = await storage.getDealsByRestaurant(row.id);
        const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
        const knowledgeGaps = [
          !row.description ? "missing_description" : null,
          !row.websiteUrl ? "missing_website" : null,
          !row.address || !row.city || !row.state ? "missing_location_context" : null,
          !row.cuisineType ? "missing_cuisine" : null,
          !row.isVerified ? "unverified_profile" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.description ? 1 : 0) +
          (row.websiteUrl ? 1 : 0) +
          (row.address && row.city && row.state ? 1 : 0) +
          (row.cuisineType ? 1 : 0) +
          ((row.isVerified || row.mobileOnline || row.isFoodTruck) ? 1 : 0);

        const canonicalPath = `/restaurant/${row.id}`;

        return sendPublicJson(res, {
          entityType: "restaurant",
          entityId: row.id,
          title: row.name,
          canonicalPath,
          canonicalUrl: `${baseUrl}${canonicalPath}`,
          freshness: staleBucketFromHours(freshnessHours),
          freshnessHours: roundToWholeHours(freshnessHours),
          machineReadiness: machineReadinessBucket(readinessScore),
          updatedAt: row.updatedAt || row.createdAt || null,
          verified: Boolean(row.isVerified),
          active: Boolean(row.isActive),
          evidenceSummary: {
            activeDealCount: Array.isArray(activeDeals)
              ? activeDeals.filter((deal: any) => deal?.isActive !== false).length
              : 0,
            liveLocationActive: Boolean(row.mobileOnline),
            isFoodTruck: Boolean(row.isFoodTruck || row.businessType === "food_truck"),
          },
          sourceFields: {
            hasDescription: Boolean(row.description),
            hasWebsite: Boolean(row.websiteUrl),
            hasCuisine: Boolean(row.cuisineType),
            hasAddress: Boolean(row.address && row.city && row.state),
            hasPhone: Boolean(row.phone),
          },
          knowledgeGaps,
          sourceTruthStatements: [
            row.isVerified ? "Verified profile on MealScout" : null,
            row.cuisineType ? `${row.cuisineType} category assigned` : null,
            row.mobileOnline ? "Live location signal available" : null,
            Array.isArray(activeDeals) && activeDeals.length > 0
              ? `${activeDeals.filter((deal: any) => deal?.isActive !== false).length} active deal signals`
              : "No active deal signals yet",
          ].filter(Boolean),
        });
      }

      if (entity === "event") {
        const [row] = await db
          .select({
            id: events.id,
            name: events.name,
            description: events.description,
            eventType: events.eventType,
            date: events.date,
            startTime: events.startTime,
            endTime: events.endTime,
            status: events.status,
            updatedAt: events.updatedAt,
            lastConfirmedAt: events.lastConfirmedAt,
            maxTrucks: events.maxTrucks,
            hostId: events.hostId,
            bookedRestaurantId: events.bookedRestaurantId,
            hostName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
            truckName: restaurants.name,
          })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .leftJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
          .where(eq(events.id, id))
          .limit(1);

        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const freshnessHours = hoursSince(
          row.lastConfirmedAt || row.updatedAt || row.date,
        );
        const knowledgeGaps = [
          !row.name ? "missing_event_name" : null,
          !row.date ? "missing_event_date" : null,
          !row.eventType ? "missing_event_type" : null,
          !row.description ? "missing_description" : null,
          !row.bookedRestaurantId ? "missing_restaurant_link" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.name ? 1 : 0) +
          (row.date && row.startTime ? 1 : 0) +
          (row.description ? 1 : 0) +
          (row.hostId ? 1 : 0) +
          (row.bookedRestaurantId ? 1 : 0);

        const canonicalPath = `/event/${row.id}`;

        return sendPublicJson(res, {
          entityType: "event",
          entityId: row.id,
          title: row.name || "Event",
          canonicalPath,
          canonicalUrl: `${baseUrl}${canonicalPath}`,
          freshness: staleBucketFromHours(freshnessHours),
          freshnessHours: roundToWholeHours(freshnessHours),
          machineReadiness: machineReadinessBucket(readinessScore),
          updatedAt: row.lastConfirmedAt || row.updatedAt || row.date || null,
          verified: false,
          active:
            String(row.status || "").toLowerCase() === "published" ||
            String(row.status || "").toLowerCase() === "active",
          evidenceSummary: {
            hasHost: Boolean(row.hostId),
            hasBookedTruck: Boolean(row.bookedRestaurantId),
            maxTrucks: Number(row.maxTrucks || 0),
          },
          sourceFields: {
            hasDescription: Boolean(row.description),
            hasDate: Boolean(row.date),
            hasTime: Boolean(row.startTime && row.endTime),
            hasHost: Boolean(row.hostId && row.hostName),
            hasBookedTruck: Boolean(row.bookedRestaurantId && row.truckName),
          },
          knowledgeGaps,
          sourceTruthStatements: [
            row.hostName ? `Hosted by ${row.hostName}` : null,
            row.hostAddress || row.hostCity
              ? [row.hostAddress, row.hostCity, row.hostState].filter(Boolean).join(", ")
              : null,
            row.bookedRestaurantId && row.truckName
              ? `Booked truck: ${row.truckName}`
              : "Truck not booked yet",
            row.lastConfirmedAt ? "Recently confirmed on MealScout" : null,
          ].filter(Boolean),
        });
      }

      if (entity === "host") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const freshnessHours = hoursSince(row.updatedAt || row.createdAt);
        const knowledgeGaps = [
          !row.notes ? "missing_description" : null,
          !row.address || !row.city || !row.state ? "missing_location_context" : null,
          !row.spotCount ? "missing_spot_capacity" : null,
          !row.isVerified ? "unverified_host" : null,
          !row.stripeOnboardingCompleted ? "stripe_not_ready" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.notes ? 1 : 0) +
          (row.address && row.city && row.state ? 1 : 0) +
          (row.spotCount ? 1 : 0) +
          (row.isVerified ? 1 : 0) +
          (row.stripeOnboardingCompleted ? 1 : 0);

        const canonicalPath = `/p/host/${row.id}`;

        return sendPublicJson(res, {
          entityType: "host",
          entityId: row.id,
          title: row.businessName,
          canonicalPath,
          canonicalUrl: `${baseUrl}${canonicalPath}`,
          freshness: staleBucketFromHours(freshnessHours),
          freshnessHours: roundToWholeHours(freshnessHours),
          machineReadiness: machineReadinessBucket(readinessScore),
          updatedAt: row.updatedAt || row.createdAt || null,
          verified: Boolean(row.isVerified),
          active: true,
          evidenceSummary: {
            spotCount: Number(row.spotCount || 0),
            stripeReady: Boolean(row.stripeOnboardingCompleted),
            locationType: row.locationType || null,
          },
          sourceFields: {
            hasDescription: Boolean(row.notes),
            hasAddress: Boolean(row.address && row.city && row.state),
            hasSpotCapacity: Boolean(row.spotCount),
            hasStripe: Boolean(row.stripeOnboardingCompleted),
            hasImage: Boolean(row.spotImageUrl),
          },
          knowledgeGaps,
          sourceTruthStatements: [
            row.locationType ? `Location type: ${row.locationType}` : null,
            row.spotCount ? `${row.spotCount} parking spots configured` : null,
            row.stripeOnboardingCompleted ? "Stripe onboarding complete" : null,
            row.isVerified ? "Verified host on MealScout" : null,
          ].filter(Boolean),
        });
      }

      if (entity === "deal") {
        const [row] = await db
          .select({
            id: deals.id,
            restaurantId: deals.restaurantId,
            title: deals.title,
            description: deals.description,
            dealType: deals.dealType,
            discountValue: deals.discountValue,
            startDate: deals.startDate,
            endDate: deals.endDate,
            startTime: deals.startTime,
            endTime: deals.endTime,
            isActive: deals.isActive,
            createdAt: deals.createdAt,
            restaurantName: restaurants.name,
          })
          .from(deals)
          .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
          .where(eq(deals.id, id))
          .limit(1);

        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const freshnessHours = hoursSince(row.createdAt || row.startDate);
        const knowledgeGaps = [
          !row.description ? "missing_description" : null,
          !row.startDate ? "missing_start_date" : null,
          !row.endDate ? "missing_end_date" : null,
          !row.restaurantId ? "missing_restaurant_link" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.title ? 1 : 0) +
          (row.description ? 1 : 0) +
          (row.startDate && row.endDate ? 1 : 0) +
          (row.startTime && row.endTime ? 1 : 0) +
          (row.restaurantId ? 1 : 0);

        const canonicalPath = `/deal/${row.id}`;

        return sendPublicJson(res, {
          entityType: "deal",
          entityId: row.id,
          title: row.title,
          canonicalPath,
          canonicalUrl: `${baseUrl}${canonicalPath}`,
          freshness: staleBucketFromHours(freshnessHours),
          freshnessHours: roundToWholeHours(freshnessHours),
          machineReadiness: machineReadinessBucket(readinessScore),
          updatedAt: row.createdAt || row.startDate || null,
          verified: false,
          active: Boolean(row.isActive),
          evidenceSummary: {
            dealType: row.dealType,
            discountValue: row.discountValue,
            restaurantName: row.restaurantName,
          },
          sourceFields: {
            hasDescription: Boolean(row.description),
            hasDateWindow: Boolean(row.startDate && row.endDate),
            hasTimeWindow: Boolean(row.startTime && row.endTime),
            hasRestaurant: Boolean(row.restaurantId && row.restaurantName),
          },
          knowledgeGaps,
          sourceTruthStatements: [
            row.restaurantName ? `Offered by ${row.restaurantName}` : null,
            row.dealType ? `Deal type: ${row.dealType}` : null,
            row.discountValue ? `Discount value: ${row.discountValue}` : null,
            row.isActive ? "Deal currently active on MealScout" : "Deal is not active",
          ].filter(Boolean),
        });
      }

      return res.status(400).json({ message: "Unsupported canonical entity" });
    } catch (error) {
      console.error("Error fetching public canonical entity:", error);
      res.status(500).json({ message: "Failed to fetch canonical entity" });
    }
  });

  app.get("/api/public/profiles/:entity/:id", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase();
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({ message: "Profile id is required" });
      }

      const baseUrl = resolvePublicBaseUrl();

      if (entity === "truck") {
        const row = await storage.getRestaurant(id);
        if (
          !row ||
          !row.isActive ||
          !(row.isFoodTruck || row.businessType === "food_truck")
        ) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const mapped = toPublicTruckProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "restaurant",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Food Truck",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: `/p/truck/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "bar") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive || row.businessType !== "bar") {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const mapped = toPublicBarProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "restaurant",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Bar",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: `/p/bar/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "location") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const mapped = toPublicLocationProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "host",
          title: mapped.displayName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          address: mapped.addressPublicLabel,
          phone: showContact ? String(row.contactPhone || "").trim() || null : null,
          imageUrl: mapped.spotImageUrl || mapped.coverImageUrl || mapped.logoUrl,
          profilePath: `/p/location/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "restaurant") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        if (row.isFoodTruck || row.businessType === "food_truck") {
          const mapped = toPublicTruckProfile({
            row,
            baseUrl,
            showAddress,
            showContact,
          });
          return sendPublicJson(res, {
            ...mapped,
            entity: "restaurant",
            title: mapped.displayName,
            subtitle: mapped.serviceType || "Food Truck",
            address: mapped.addressPublicLabel,
            phone: mapped.phonePublic,
            imageUrl: mapped.coverImageUrl || mapped.logoUrl,
            profilePath: `/p/truck/${mapped.id}/${mapped.slug}`,
            canonicalUrl: mapped.seo.canonicalUrl,
            websiteUrl: mapped.websiteUrl,
            profileSettings,
            social: mapped.socialLinks,
          });
        }
        if (row.businessType === "bar") {
          const mapped = toPublicBarProfile({
            row,
            baseUrl,
            showAddress,
            showContact,
          });
          return sendPublicJson(res, {
            ...mapped,
            entity: "restaurant",
            title: mapped.displayName,
            subtitle: mapped.serviceType || "Bar",
            address: mapped.addressPublicLabel,
            phone: mapped.phonePublic,
            imageUrl: mapped.coverImageUrl || mapped.logoUrl,
            profilePath: `/p/bar/${mapped.id}/${mapped.slug}`,
            canonicalUrl: mapped.seo.canonicalUrl,
            websiteUrl: mapped.websiteUrl,
            profileSettings,
            social: mapped.socialLinks,
          });
        }
        const mapped = toPublicRestaurantProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "restaurant",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Restaurant",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: `/p/restaurant/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "host") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const mapped = toPublicLocationProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "host",
          title: mapped.displayName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          address: mapped.addressPublicLabel,
          phone: showContact ? String(row.contactPhone || "").trim() || null : null,
          imageUrl: mapped.spotImageUrl || mapped.coverImageUrl || mapped.logoUrl,
          profilePath: `/p/location/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "supplier") {
        const [row] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, id), eq(suppliers.isActive, true)))
          .limit(1);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [counts] = await db
          .select({
            activeProductCount: sql<number>`count(*)`,
          })
          .from(supplierProducts)
          .where(
            and(
              eq(supplierProducts.supplierId, row.id),
              eq(supplierProducts.isActive, true),
            ),
          );
        const mapped = toPublicSupplierProfile({
          row,
          activeProductCount: Number(counts?.activeProductCount || 0),
          baseUrl,
          showAddress,
          showContact,
        });
        return sendPublicJson(res, {
          ...mapped,
          entity: "supplier",
          title: mapped.displayName,
          subtitle: "Supplier",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.logoUrl,
          profilePath: `/p/supplier/${mapped.id}/${mapped.slug}`,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          metrics: {
            activeProductCount: mapped.activeProductCount,
          },
          social: {
            instagramUrl: null,
            facebookPageUrl: null,
            xUrl: null,
          },
        });
      }

      return res.status(400).json({ message: "Unsupported profile entity" });
    } catch (error) {
      console.error("Error fetching public profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.get("/api/public/evidence/:entity/:id", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase().trim();
      const id = String(req.params.id || "").trim();
      const hoursRaw = Number(req.query.hours ?? 24 * 30);
      const hours = Number.isFinite(hoursRaw)
        ? Math.max(24, Math.min(24 * 90, Math.trunc(hoursRaw)))
        : 24 * 30;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      if (!entity || !id) {
        return res.status(400).json({ message: "Entity and id are required" });
      }

      if (entity === "restaurant") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const slug = `${toSlug(row.name) || row.id}--${row.id}`;
        const candidatePaths = [
          `/restaurant/${row.id}`,
          `/truck/${slug}`,
          `/bar/${slug}`,
          `/p/restaurant/${row.id}`,
        ];
        const searchTokens = keywordTokens([row.name, row.cuisineType].join(" "));

        const [recentRequests, recentShares, recentPosts, recentQueries, stories] =
          await Promise.all([
            db
              .select()
              .from(requestLogs)
              .where(gte(requestLogs.createdAt, since))
              .orderBy(desc(requestLogs.createdAt))
              .limit(5000),
            db
              .select()
              .from(affiliateShareEvents)
              .where(gte(affiliateShareEvents.createdAt, since))
              .orderBy(desc(affiliateShareEvents.createdAt))
              .limit(1500),
            db
              .select()
              .from(socialPostQueue)
              .where(gte(socialPostQueue.createdAt, since))
              .orderBy(desc(socialPostQueue.createdAt))
              .limit(1500),
            db
              .select()
              .from(searchQueryEvents)
              .where(gte(searchQueryEvents.createdAt, since))
              .orderBy(desc(searchQueryEvents.createdAt))
              .limit(3000),
            db
              .select({
                id: videoStories.id,
                title: videoStories.title,
                viewCount: videoStories.viewCount,
                impressionCount: videoStories.impressionCount,
                shareCount: videoStories.shareCount,
                createdAt: videoStories.createdAt,
              })
              .from(videoStories)
              .where(eq(videoStories.restaurantId, row.id))
              .orderBy(desc(videoStories.createdAt))
              .limit(12),
          ]);

        const matchingRequests = recentRequests.filter((request: any) => {
          const path = String(request.path || "");
          return (
            path.includes(row.id) ||
            candidatePaths.some(
              (candidate) => path === candidate || path.startsWith(`${candidate}?`),
            )
          );
        });
        const crawlerLabels = matchingRequests
          .map((request: any) => botSignatureLabel(request.userAgent))
          .filter(Boolean) as string[];
        const matchingShares = recentShares.filter((share: any) =>
          String(share.destinationUrl || "").includes(row.id),
        );
        const matchingPosts = recentPosts.filter((post: any) => {
          const haystack = normalizeLoose(
            `${post.link || ""} ${post.message || ""} ${post.target || ""}`,
          );
          return (
            String(post.link || "").includes(row.id) ||
            searchTokens.some((token) => haystack.includes(token))
          );
        });
        const matchingQueries = recentQueries.filter((query: any) => {
          const normalized = normalizeLoose(query.query);
          return searchTokens.some((token) => normalized.includes(token));
        });

        return sendPublicJson(res, {
          entityType: "restaurant",
          entityId: row.id,
          windowHours: hours,
          externalPressure: {
            crawlerHits: crawlerLabels.length,
            humanPageHits: matchingRequests.length - crawlerLabels.length,
            topBots: Object.entries(countBy(crawlerLabels))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([label, count]) => ({ label, count })),
          },
          distribution: {
            affiliateShares: matchingShares.length,
            outboundSocialPosts: matchingPosts.length,
            successfulSocialPosts: matchingPosts.filter(
              (post: any) => String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "").trim().toLowerCase(),
                ),
              ),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([query, count]) => ({ query, count })),
          },
          content: {
            storyCount: stories.length,
            totalViews: stories.reduce(
              (sum: number, story: any) => sum + Number(story.viewCount || 0),
              0,
            ),
            totalImpressions: stories.reduce(
              (sum: number, story: any) =>
                sum + Number(story.impressionCount || 0),
              0,
            ),
            totalShares: stories.reduce(
              (sum: number, story: any) => sum + Number(story.shareCount || 0),
              0,
            ),
          },
          recentEvidence: [
            ...matchingRequests.slice(0, 4).map((request: any) => ({
              type: botSignatureLabel(request.userAgent)
                ? "crawler_hit"
                : "page_hit",
              label:
                botSignatureLabel(request.userAgent) ||
                `${request.method} ${request.statusCode}`,
              detail: String(request.path || ""),
              createdAt: request.createdAt,
            })),
            ...matchingPosts.slice(0, 3).map((post: any) => ({
              type: "social_post",
              label: `${post.platform} ${post.status || "queued"}`,
              detail: String(post.link || post.target || "").slice(0, 140),
              createdAt: post.createdAt,
            })),
            ...matchingQueries.slice(0, 3).map((query: any) => ({
              type: "search_query",
              label: String(query.query || "").slice(0, 120),
              detail: String(query.source || "unknown"),
              createdAt: query.createdAt,
            })),
          ]
            .sort(
              (a, b) =>
                new Date(String(b.createdAt || 0)).getTime() -
                new Date(String(a.createdAt || 0)).getTime(),
            )
            .slice(0, 8),
        });
      }

      if (entity === "event") {
        const [row] = await db
          .select({
            id: events.id,
            name: events.name,
            description: events.description,
            hostName: hosts.businessName,
            bookedRestaurantId: events.bookedRestaurantId,
          })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(eq(events.id, id))
          .limit(1);

        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const slug = `${toSlug(row.name) || row.id}--${row.id}`;
        const searchTokens = keywordTokens(
          [row.name, row.hostName, row.description].filter(Boolean).join(" "),
        );

        const [recentRequests, recentShares, recentPosts, recentQueries] =
          await Promise.all([
            db
              .select()
              .from(requestLogs)
              .where(gte(requestLogs.createdAt, since))
              .orderBy(desc(requestLogs.createdAt))
              .limit(5000),
            db
              .select()
              .from(affiliateShareEvents)
              .where(gte(affiliateShareEvents.createdAt, since))
              .orderBy(desc(affiliateShareEvents.createdAt))
              .limit(1500),
            db
              .select()
              .from(socialPostQueue)
              .where(gte(socialPostQueue.createdAt, since))
              .orderBy(desc(socialPostQueue.createdAt))
              .limit(1500),
            db
              .select()
              .from(searchQueryEvents)
              .where(gte(searchQueryEvents.createdAt, since))
              .orderBy(desc(searchQueryEvents.createdAt))
              .limit(3000),
          ]);

        const matchingRequests = recentRequests.filter((request: any) => {
          const path = String(request.path || "");
          return (
            path.includes(row.id) ||
            path.includes(slug) ||
            path === `/event/${row.id}` ||
            path.startsWith(`/event/${slug}`)
          );
        });
        const crawlerLabels = matchingRequests
          .map((request: any) => botSignatureLabel(request.userAgent))
          .filter(Boolean) as string[];
        const matchingShares = recentShares.filter((share: any) =>
          String(share.destinationUrl || "").includes(row.id),
        );
        const matchingPosts = recentPosts.filter((post: any) => {
          const haystack = normalizeLoose(
            `${post.link || ""} ${post.message || ""} ${post.target || ""}`,
          );
          return (
            String(post.link || "").includes(row.id) ||
            haystack.includes(slug) ||
            searchTokens.some((token) => haystack.includes(token))
          );
        });
        const matchingQueries = recentQueries.filter((query: any) => {
          const normalized = normalizeLoose(query.query);
          return searchTokens.some((token) => normalized.includes(token));
        });

        return sendPublicJson(res, {
          entityType: "event",
          entityId: row.id,
          windowHours: hours,
          externalPressure: {
            crawlerHits: crawlerLabels.length,
            humanPageHits: matchingRequests.length - crawlerLabels.length,
            topBots: Object.entries(countBy(crawlerLabels))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([label, count]) => ({ label, count })),
          },
          distribution: {
            affiliateShares: matchingShares.length,
            outboundSocialPosts: matchingPosts.length,
            successfulSocialPosts: matchingPosts.filter(
              (post: any) => String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "").trim().toLowerCase(),
                ),
              ),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([query, count]) => ({ query, count })),
          },
          content: {
            storyCount: 0,
            totalViews: 0,
            totalImpressions: 0,
            totalShares: 0,
          },
          recentEvidence: [
            ...matchingRequests.slice(0, 4).map((request: any) => ({
              type: botSignatureLabel(request.userAgent)
                ? "crawler_hit"
                : "page_hit",
              label:
                botSignatureLabel(request.userAgent) ||
                `${request.method} ${request.statusCode}`,
              detail: String(request.path || ""),
              createdAt: request.createdAt,
            })),
            ...matchingPosts.slice(0, 3).map((post: any) => ({
              type: "social_post",
              label: `${post.platform} ${post.status || "queued"}`,
              detail: String(post.link || post.target || "").slice(0, 140),
              createdAt: post.createdAt,
            })),
            ...matchingQueries.slice(0, 3).map((query: any) => ({
              type: "search_query",
              label: String(query.query || "").slice(0, 120),
              detail: String(query.source || "unknown"),
              createdAt: query.createdAt,
            })),
          ]
            .sort(
              (a, b) =>
                new Date(String(b.createdAt || 0)).getTime() -
                new Date(String(a.createdAt || 0)).getTime(),
            )
            .slice(0, 8),
        });
      }

      if (entity === "host") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const slug = `${toSlug(row.businessName) || row.id}--${row.id}`;
        const searchTokens = keywordTokens(
          [row.businessName, row.locationType, row.city, row.state].join(" "),
        );

        const [recentRequests, recentShares, recentPosts, recentQueries] =
          await Promise.all([
            db
              .select()
              .from(requestLogs)
              .where(gte(requestLogs.createdAt, since))
              .orderBy(desc(requestLogs.createdAt))
              .limit(5000),
            db
              .select()
              .from(affiliateShareEvents)
              .where(gte(affiliateShareEvents.createdAt, since))
              .orderBy(desc(affiliateShareEvents.createdAt))
              .limit(1500),
            db
              .select()
              .from(socialPostQueue)
              .where(gte(socialPostQueue.createdAt, since))
              .orderBy(desc(socialPostQueue.createdAt))
              .limit(1500),
            db
              .select()
              .from(searchQueryEvents)
              .where(gte(searchQueryEvents.createdAt, since))
              .orderBy(desc(searchQueryEvents.createdAt))
              .limit(3000),
          ]);

        const matchingRequests = recentRequests.filter((request: any) => {
          const path = String(request.path || "");
          return (
            path.includes(row.id) ||
            path.includes(slug) ||
            path.startsWith(`/p/host/${row.id}`) ||
            path.includes(`/location/${slug}`)
          );
        });
        const crawlerLabels = matchingRequests
          .map((request: any) => botSignatureLabel(request.userAgent))
          .filter(Boolean) as string[];
        const matchingShares = recentShares.filter((share: any) =>
          String(share.destinationUrl || "").includes(row.id),
        );
        const matchingPosts = recentPosts.filter((post: any) => {
          const haystack = normalizeLoose(
            `${post.link || ""} ${post.message || ""} ${post.target || ""}`,
          );
          return searchTokens.some((token) => haystack.includes(token));
        });
        const matchingQueries = recentQueries.filter((query: any) => {
          const normalized = normalizeLoose(query.query);
          return searchTokens.some((token) => normalized.includes(token));
        });

        return sendPublicJson(res, {
          entityType: "host",
          entityId: row.id,
          windowHours: hours,
          externalPressure: {
            crawlerHits: crawlerLabels.length,
            humanPageHits: matchingRequests.length - crawlerLabels.length,
            topBots: Object.entries(countBy(crawlerLabels))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([label, count]) => ({ label, count })),
          },
          distribution: {
            affiliateShares: matchingShares.length,
            outboundSocialPosts: matchingPosts.length,
            successfulSocialPosts: matchingPosts.filter(
              (post: any) => String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "").trim().toLowerCase(),
                ),
              ),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([query, count]) => ({ query, count })),
          },
          content: {
            storyCount: 0,
            totalViews: 0,
            totalImpressions: 0,
            totalShares: 0,
          },
          recentEvidence: [],
        });
      }

      if (entity === "deal") {
        const [row] = await db
          .select({
            id: deals.id,
            title: deals.title,
            description: deals.description,
            restaurantId: deals.restaurantId,
            restaurantName: restaurants.name,
          })
          .from(deals)
          .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
          .where(eq(deals.id, id))
          .limit(1);

        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const searchTokens = keywordTokens(
          [row.title, row.description, row.restaurantName].join(" "),
        );

        const [recentRequests, recentShares, recentPosts, recentQueries] =
          await Promise.all([
            db
              .select()
              .from(requestLogs)
              .where(gte(requestLogs.createdAt, since))
              .orderBy(desc(requestLogs.createdAt))
              .limit(5000),
            db
              .select()
              .from(affiliateShareEvents)
              .where(gte(affiliateShareEvents.createdAt, since))
              .orderBy(desc(affiliateShareEvents.createdAt))
              .limit(1500),
            db
              .select()
              .from(socialPostQueue)
              .where(gte(socialPostQueue.createdAt, since))
              .orderBy(desc(socialPostQueue.createdAt))
              .limit(1500),
            db
              .select()
              .from(searchQueryEvents)
              .where(gte(searchQueryEvents.createdAt, since))
              .orderBy(desc(searchQueryEvents.createdAt))
              .limit(3000),
          ]);

        const matchingRequests = recentRequests.filter((request: any) => {
          const path = String(request.path || "");
          return path.includes(row.id) || path.startsWith(`/deal/${row.id}`);
        });
        const crawlerLabels = matchingRequests
          .map((request: any) => botSignatureLabel(request.userAgent))
          .filter(Boolean) as string[];
        const matchingShares = recentShares.filter((share: any) =>
          String(share.destinationUrl || "").includes(row.id),
        );
        const matchingPosts = recentPosts.filter((post: any) => {
          const haystack = normalizeLoose(
            `${post.link || ""} ${post.message || ""} ${post.target || ""}`,
          );
          return (
            String(post.link || "").includes(row.id) ||
            searchTokens.some((token) => haystack.includes(token))
          );
        });
        const matchingQueries = recentQueries.filter((query: any) => {
          const normalized = normalizeLoose(query.query);
          return searchTokens.some((token) => normalized.includes(token));
        });

        return sendPublicJson(res, {
          entityType: "deal",
          entityId: row.id,
          windowHours: hours,
          externalPressure: {
            crawlerHits: crawlerLabels.length,
            humanPageHits: matchingRequests.length - crawlerLabels.length,
            topBots: Object.entries(countBy(crawlerLabels))
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([label, count]) => ({ label, count })),
          },
          distribution: {
            affiliateShares: matchingShares.length,
            outboundSocialPosts: matchingPosts.length,
            successfulSocialPosts: matchingPosts.filter(
              (post: any) => String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "").trim().toLowerCase(),
                ),
              ),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([query, count]) => ({ query, count })),
          },
          content: {
            storyCount: 0,
            totalViews: 0,
            totalImpressions: 0,
            totalShares: 0,
          },
          recentEvidence: [],
        });
      }

      return res.status(400).json({ message: "Unsupported evidence entity" });
    } catch (error) {
      console.error("Error fetching public entity evidence:", error);
      res.status(500).json({ message: "Failed to fetch evidence" });
    }
  });

  app.get("/api/cities", async (_req, res) => {
    try {
      const cityRows = await db
        .select({
          id: cities.id,
          name: cities.name,
          slug: cities.slug,
          state: cities.state,
          createdAt: cities.createdAt,
        })
        .from(cities)
        .orderBy(desc(cities.createdAt));

      const restaurantRows = await db
        .select({
          city: restaurants.city,
          cuisineType: restaurants.cuisineType,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true));

      const cuisineByCity = new Map<string, Map<string, number>>();
      for (const row of restaurantRows as any[]) {
        const cityName = String(row.city || "").trim().toLowerCase();
        const cuisine = toSlug(row.cuisineType || "");
        if (!cityName || !cuisine) continue;
        if (!cuisineByCity.has(cityName)) {
          cuisineByCity.set(cityName, new Map());
        }
        const cityMap = cuisineByCity.get(cityName)!;
        cityMap.set(cuisine, (cityMap.get(cuisine) || 0) + 1);
      }

      const payload = cityRows.map((city: any) => {
        const cityCuisineMap =
          cuisineByCity.get(String(city.name || "").toLowerCase()) || new Map();
        const cuisines = Array.from(cityCuisineMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([slug, count]) => ({ slug, count }));
        return {
          id: city.id,
          name: city.name,
          slug: city.slug,
          state: city.state,
          updatedAt: city.createdAt,
          cuisines,
        };
      });

      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=600, stale-while-revalidate=1200",
      );
      sendPublicJson(res, payload);
    } catch (error) {
      console.error("Error loading cities index:", error);
      res.status(500).json({ message: "Failed to load cities" });
    }
  });

  app.get("/api/cities/:slug", async (req, res) => {
    try {
      const { slug } = req.params as { slug: string };
      const [city] = await db.select().from(cities).where(eq(cities.slug, slug));
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }

      const cityRestaurants = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.city, city.name));
      const trucks = cityRestaurants.filter((row: any) => row.isFoodTruck);
      const restaurantsOnly = cityRestaurants.filter(
        (row: any) => !row.isFoodTruck,
      );

      const hostRows = await db.select().from(hosts).where(eq(hosts.city, city.name));
      const hostIds = hostRows.map((row: any) => row.id);
      let upcomingEvents: any[] = [];
      if (hostIds.length) {
        const now = new Date();
        upcomingEvents = await db.select().from(events).where(eq(events.status, "open"));
        upcomingEvents = upcomingEvents.filter(
          (row: any) => new Date(row.date) >= now && hostIds.includes(row.hostId),
        );
      }

      const restaurantIds = cityRestaurants.map((row: any) => row.id);
      let stories: any[] = [];
      if (restaurantIds.length) {
        stories = await db
          .select()
          .from(videoStories)
          .orderBy(desc(videoStories.createdAt));
        stories = stories
          .filter((row: any) => row.restaurantId && restaurantIds.includes(row.restaurantId))
          .slice(0, 8);
      }

      const cuisineCounts: Record<string, number> = {};
      for (const row of cityRestaurants) {
        if ((row as any).cuisineType) {
          const cuisine = String((row as any).cuisineType).toLowerCase();
          cuisineCounts[cuisine] = (cuisineCounts[cuisine] || 0) + 1;
        }
      }

      sendPublicJson(res, {
        city: { name: city.name, slug: city.slug, state: city.state },
        stats: {
          restaurants: restaurantsOnly.length,
          trucks: trucks.length,
          events: upcomingEvents.length,
        },
        restaurants: restaurantsOnly,
        trucks,
        events: upcomingEvents,
        cuisines: Object.entries(cuisineCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        stories,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error building city page:", error);
      res.status(500).json({ message: "Failed to load city" });
    }
  });
}

