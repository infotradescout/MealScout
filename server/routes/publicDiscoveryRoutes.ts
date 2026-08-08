import type { Express } from "express";
import { createHash } from "crypto";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  isBarBusinessType,
  isTruckBusinessType,
  toCanonicalFoodBusinessType,
} from "@shared/businessTypes";
import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
} from "@shared/consumerEntity";

import { db } from "../db";
import { storage } from "../storage";
import {
  affiliateShareEvents,
  cities,
  deals,
  eventBookings,
  events,
  hosts,
  menuCategories,
  menuItemModifiers,
  menuItems,
  menuItemVariants,
  menuItemRecommendations,
  menuItemPhotos,
  menus,
  merchantPromotionPartners,
  merchantPromotionPolicies,
  requestLogs,
  restaurants,
  searchQueryEvents,
  socialPostQueue,
  supplierProducts,
  suppliers,
  truckImportListings,
  users,
  videoStories,
} from "@shared/schema";
import { promotionCandidateAllowed } from "@shared/merchantPromotion";
import { buildCleanAffiliateBusinessPath } from "@shared/cleanAffiliateLinks";
import {
  rankPublicCrossPromotions,
  type PublicCrossPromotionCandidate,
} from "@shared/publicCrossPromotion";
import {
  assertPublicResponseSafe,
  toPublicBarProfile,
  toPublicLocationProfile,
  toPublicRestaurantProfile,
  toPublicSupplierProfile,
  toPublicTruckProfile,
} from "../publicProfiles";
import {
  resolvePublicBusinessSlug,
  resolveUniqueCleanBusinessPathForEntity,
} from "../publicProfiles/publicBusinessSlugResolver";
import { buildPublicTruckOperatingPlan } from "../services/truckOperatingPlan";
import { createStructuredMenuRevision } from "../services/menuRevision";
import { loadConfirmedEventTrucks } from "../services/confirmedEventTrucks";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import { isSlotPublic } from "../services/publicSlotGate";
import { canExposeAnonymousEventDetail } from "../publicProfiles/publicEventDetailAccess";
import { buildPublicProfilePath } from "../publicProfiles/publicProfileUtils";
import { isAuthenticated } from "../unifiedAuth";
import { deriveProfileEvidenceQuarantineVisibility } from "../services/profileEvidenceQuarantine";
import { buildProfileAnalyticsDiscoveryMetadata } from "../services/discoveryObservatory";

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

const friendlyLocationTypeLabel = (value: string | null | undefined) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "private_residence") return "Private event location";
  if (normalized === "business") return "Business";
  if (normalized === "other") return "Host location";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const err = error as { code?: string; message?: string } | null;
  if (!err || err.code !== "42P01") return false;
  if (!relationName) return true;
  return err.message?.includes(`"${relationName}"`) ?? false;
};

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

const PUBLIC_PROFILE_ANALYTICS_ACTIONS = new Set([
  "profile_view",
  "menu_click",
  "directions_click",
  "call_click",
  "website_click",
  "order_click",
  "delivery_click",
  "deal_click",
  "event_click",
  "social_click",
  "share_click",
  "qr_profile_open",
  "qr_menu_open",
  "qr_specials_open",
  "catering_click",
  "truck_booking_click",
  "cross_promotion_click",
]);

const PUBLIC_PROFILE_ANALYTICS_SOURCES = new Set([
  "public_profile",
  "qr",
  "discovery_food_trucks_today",
  "discovery_deals_today",
  "discovery_events_today",
  "discovery_city_food",
  "discovery_cuisine",
  "discovery_locations_with_trucks",
  "owner_dashboard_preview",
  "profile_cross_promotion",
  "unknown",
]);

const DISCOVERY_ANALYTICS_EVENT_TYPES = new Set([
  "discovery_page_view",
  "discovery_card_click",
  "discovery_profile_click",
  "discovery_cta_click",
]);

const DISCOVERY_SOURCE_PAGE_TYPES = new Set([
  "food_trucks_today",
  "deals_today",
  "events_today",
  "city_food",
  "cuisine",
  "locations_with_trucks",
]);

const classifyActorTypeFromUserAgent = (ua: string) => {
  if (!ua) return "human";
  if (
    /gptbot|chatgpt-user|claudebot|anthropic-ai|perplexitybot|bytespider|ccbot|cohere-ai/i.test(
      ua,
    )
  ) {
    return "llm_bot";
  }
  if (
    /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|discordbot|telegrambot|linkedinbot/i.test(
      ua,
    )
  ) {
    return "bot";
  }
  return "human";
};

const sourceTypeFromActor = (actorType: string) => {
  if (actorType === "llm_bot") return "llm_crawler";
  if (actorType === "bot") return "crawler";
  return "human";
};

const classifyPublicDealType = (input: {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  isOngoing: boolean;
}) => {
  const haystack = `${input.title} ${input.description}`.toLowerCase();
  if (haystack.includes("happy hour")) return "happy_hour" as const;
  if (haystack.includes("lunch")) return "lunch" as const;
  if (haystack.includes("family")) return "family_meal" as const;
  if (haystack.includes("coupon")) return "coupon" as const;
  if (
    input.isOngoing ||
    haystack.includes("limited") ||
    haystack.includes("today")
  ) {
    return "limited_time" as const;
  }
  if (input.startTime || input.endTime) return "daily" as const;
  return "other" as const;
};

const normalizePublicProfileEntity = (value: string | null | undefined) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();
  if (
    normalized === "food_truck" ||
    normalized === "food-truck" ||
    normalized === "foodtruck"
  ) {
    return "truck";
  }
  if (normalized === "food_trucks") return "truck";
  return normalized;
};

const isTruckRestaurantRow = (row: any) =>
  Boolean(row && (row.isFoodTruck || isTruckBusinessType(row.businessType)));

const resolveTruckRestaurantForPublicId = async (id: string) => {
  const direct = await storage.getRestaurant(id);
  if (direct) return direct;

  // Some discovery/public links may still carry a truck import listing id.
  // Map listing id -> canonical restaurant profile id via claimedFromImportId.
  const [mapped] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.claimedFromImportId, id))
    .limit(1);
  return mapped || null;
};

const buildPublicDealsPayload = async (restaurantId: string, row?: any) => {
  const now = new Date();
  const dealsRows = await storage.getDealsByRestaurant(restaurantId);
  const activeDeals = (Array.isArray(dealsRows) ? dealsRows : [])
    .filter((deal: any) => Boolean(deal?.isActive !== false))
    .filter((deal: any) => {
      const startDate = deal?.startDate ? new Date(deal.startDate) : null;
      const endDate = deal?.endDate ? new Date(deal.endDate) : null;
      if (startDate && Number.isFinite(startDate.getTime()) && now < startDate)
        return false;
      if (endDate && Number.isFinite(endDate.getTime()) && now > endDate)
        return false;
      return true;
    });

  const dealItems = activeDeals
    .map((deal: any) => {
      const id = String(deal?.id || "").trim();
      const title = String(deal?.title || "").trim();
      if (!id || !title) return null;
      const description = String(deal?.description || "").trim();
      const startAt = deal?.startDate
        ? new Date(deal.startDate).toISOString()
        : null;
      const endAt = deal?.endDate ? new Date(deal.endDate).toISOString() : null;
      const startTime = String(deal?.startTime || "").trim();
      const endTime = String(deal?.endTime || "").trim();
      const timeWindowLabel =
        startTime && endTime
          ? `${startTime} - ${endTime}`
          : startTime || endTime || null;
      const imageUrl = String(deal?.imageUrl || "").trim() || null;
      const websiteUrl = String(row?.websiteUrl || "").trim() || null;
      const phone = String(row?.phone || "").trim() || null;
      let actionLabel = "Show this deal";
      let actionHref = `/deal/${encodeURIComponent(id)}`;
      let actionType:
        "call" | "show_this_deal" | "order" | "website" | "menu" | "internal" =
        "show_this_deal";
      if (websiteUrl) {
        actionLabel = "Order";
        actionHref = websiteUrl;
        actionType = "order";
      } else if (phone) {
        actionLabel = "Call";
        actionHref = `tel:${phone}`;
        actionType = "call";
      }
      return {
        id,
        title,
        description: description || null,
        dealType: classifyPublicDealType({
          title,
          description,
          startTime,
          endTime,
          isOngoing: Boolean(deal?.isOngoing),
        }),
        startAt,
        endAt,
        timeWindowLabel,
        imageUrl,
        actionLabel,
        actionHref,
        actionType,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  return {
    dealsItems: dealItems,
    activeDealCount: activeDeals.length,
  };
};

const classifyPublicEventType = (eventTypeRaw: unknown, titleRaw: unknown) => {
  const direct = String(eventTypeRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]/g, "_");
  const title = String(titleRaw || "").toLowerCase();
  if (
    [
      "live_music",
      "trivia",
      "karaoke",
      "pop_up",
      "food_truck_night",
      "watch_party",
      "holiday",
    ].includes(direct)
  ) {
    return direct as
      | "live_music"
      | "trivia"
      | "karaoke"
      | "pop_up"
      | "food_truck_night"
      | "watch_party"
      | "holiday";
  }
  if (title.includes("music")) return "live_music";
  if (title.includes("trivia")) return "trivia";
  if (title.includes("karaoke")) return "karaoke";
  if (title.includes("pop")) return "pop_up";
  if (title.includes("truck")) return "food_truck_night";
  if (title.includes("watch")) return "watch_party";
  if (title.includes("holiday")) return "holiday";
  return "other" as const;
};

const buildPublicEventsPayload = async (input: {
  restaurantId?: string;
  hostId?: string;
  restaurantRow?: any;
}) => {
  const now = new Date();
  const queryStart = new Date(now);
  queryStart.setUTCHours(0, 0, 0, 0);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const publicEventFields = {
    id: events.id,
    title: events.name,
    description: events.description,
    eventType: events.eventType,
    date: events.date,
    startTime: events.startTime,
    endTime: events.endTime,
    status: events.status,
    hostId: events.hostId,
    hostName: hosts.businessName,
    hostAddress: hosts.address,
    hostCity: hosts.city,
    hostState: hosts.state,
  };
  const rows = input.restaurantId
    ? await db
        .select(publicEventFields)
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .leftJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            eq(eventBookings.truckId, input.restaurantId),
            eq(eventBookings.status, "confirmed"),
            isNotNull(eventBookings.bookingConfirmedAt),
            inArray(events.status, ["open", "booked", "filled"]),
            gte(events.date, queryStart),
          ),
        )
    : await db
        .select(publicEventFields)
        .from(events)
        .leftJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          input.hostId
            ? and(eq(events.hostId, input.hostId), gte(events.date, queryStart))
            : gte(events.date, queryStart),
        );

  const upcoming = rows
    .filter(
      (row: any) => String(row.status || "").toLowerCase() !== "cancelled",
    )
    .sort(
      (a: any, b: any) =>
        new Date(a.date as any).getTime() - new Date(b.date as any).getTime(),
    )
    .map((row: any) => {
      const title = String(row.title || "").trim();
      const id = String(row.id || "").trim();
      if (!id || !title) return null;
      const dateObj = row.date ? new Date(row.date as any) : null;
      const startTime = String(row.startTime || "").trim();
      const endTime = String(row.endTime || "").trim();
      const timeZone = resolveCityTimeZoneSync({
        city: row.hostCity || null,
        state: row.hostState || null,
      });
      const interval =
        dateObj && Number.isFinite(dateObj.getTime())
          ? buildSlotDateTimes({
              timeZone,
              date: dateObj,
              startTime,
              endTime,
            })
          : null;
      if (!interval || interval.endUtc.getTime() < now.getTime()) return null;
      const dateLabel = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(interval.startUtc);
      const timeWindowLabel =
        startTime && endTime
          ? `${startTime} - ${endTime}`
          : startTime || endTime || null;
      const addressPublicLabel = [row.hostAddress, row.hostCity, row.hostState]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .join(", ");
      let actionLabel: string = "View event";
      let actionHref: string = `/event/${id}`;
      let actionType: "rsvp" | "share" | "website" | "directions" | "internal" =
        "internal";
      if (addressPublicLabel) {
        actionLabel = "Get directions";
        actionHref = `https://maps.google.com/?q=${encodeURIComponent(addressPublicLabel)}`;
        actionType = "directions";
      } else if (String(input.restaurantRow?.websiteUrl || "").trim()) {
        actionLabel = "Website";
        actionHref = String(input.restaurantRow.websiteUrl).trim();
        actionType = "website";
      }
      return {
        id,
        title,
        description: String(row.description || "").trim() || null,
        eventType: classifyPublicEventType(row.eventType, row.title),
        startsAt: interval.startUtc.toISOString(),
        endsAt: interval.endUtc.toISOString(),
        dateLabel,
        timeWindowLabel,
        locationName: String(row.hostName || "").trim() || null,
        addressPublicLabel: addressPublicLabel || null,
        imageUrl: null,
        actionLabel,
        actionHref,
        actionType,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  return {
    eventsItems: upcoming,
    upcomingEventCount: upcoming.length,
  };
};

const buildPublicMenuPayload = async (
  restaurantId: string,
  context?: {
    preferredMenuId?: string | null;
    eventId?: string | null;
    viewerUserId?: string | null;
  },
) => {
  // These exact structured rows feed both the rendered payload and its
  // revision. Computing the revision from a second query can pair content B
  // with revision A during a concurrent menu edit and falsely retain an owner
  // approval label.
  const menuRows = await db
    .select()
    .from(menus)
    .where(
      and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)),
    );

  const menuUrlFallback =
    [...menuRows]
      .filter((row: any) => String(row.importUrl || "").trim())
      .sort(
        (left: any, right: any) =>
          new Date(right.updatedAt || right.importedAt || 0).getTime() -
          new Date(left.updatedAt || left.importedAt || 0).getTime(),
      )
      .map((row: any) => String(row.importUrl || "").trim())
      .find(Boolean) || null;

  const [linkedListing] = await db
    .select({
      id: truckImportListings.id,
      rawData: truckImportListings.rawData,
      updatedAt: truckImportListings.updatedAt,
      createdAt: truckImportListings.createdAt,
    })
    .from(truckImportListings)
    .innerJoin(
      restaurants,
      eq(restaurants.claimedFromImportId, truckImportListings.id),
    )
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const listingMenuItems = Array.isArray(
    (linkedListing as any)?.rawData?.evidenceIngest?.extracted?.menuItems,
  )
    ? ((linkedListing as any).rawData.evidenceIngest.extracted
        .menuItems as any[])
    : [];

  const listingMenuSections =
    listingMenuItems.length > 0
      ? Object.values(
          listingMenuItems.reduce(
            (
              acc: Record<
                string,
                {
                  name: string;
                  items: Array<{
                    name: string;
                    priceCents: number | null;
                    description: string | null;
                    imageUrl: string | null;
                    featured: boolean;
                  }>;
                }
              >,
              item: any,
            ) => {
              const sectionName =
                String(item?.section || "Menu").trim() || "Menu";
              const itemName = String(
                item?.item_name || item?.name || "",
              ).trim();
              if (!itemName) return acc;
              const priceRaw = String(item?.price || "").trim();
              const numericPrice = Number(priceRaw.replace(/[^0-9.]/g, ""));
              const priceCents =
                priceRaw && Number.isFinite(numericPrice)
                  ? Math.round(numericPrice * 100)
                  : null;
              if (!acc[sectionName]) {
                acc[sectionName] = { name: sectionName, items: [] };
              }
              acc[sectionName].items.push({
                name: itemName,
                priceCents,
                description: String(item?.description || "").trim() || null,
                imageUrl: null,
                featured: false,
              });
              return acc;
            },
            {},
          ),
        ).map((section: any) => ({
          name: section.name,
          items: section.items.slice(0, 24),
        }))
      : [];

  if (!menuRows.length) {
    return {
      menuSections: listingMenuSections,
      menuVariants: [] as Array<{
        id: string;
        name: string;
        serviceType: string | null;
        menuSections: Array<{
          name: string;
          items: Array<{
            name: string;
            priceLabel: string | null;
            description: string | null;
            imageUrl: string | null;
            featured: boolean;
          }>;
        }>;
        menuLastUpdatedAt: Date | null;
        menuUrl: string | null;
      }>,
      activeMenuId: null as string | null,
      menuContextNote: null as string | null,
      menuLastUpdatedAt:
        listingMenuSections.length > 0
          ? (linkedListing as any)?.updatedAt ||
            (linkedListing as any)?.createdAt ||
            null
          : (null as Date | null),
      menuUrl: menuUrlFallback,
      hasStructuredMenu: listingMenuSections.length > 0,
      menuRevision: null as string | null,
      menuRevisionCoversRenderedMenu: false,
    };
  }

  const menuIds = menuRows.map((row: any) => row.id);
  const categoryRows = await db
    .select()
    .from(menuCategories)
    .where(
      and(
        inArray(menuCategories.menuId, menuIds),
        eq(menuCategories.isActive, true),
      ),
    );

  const itemRows = await db
    .select()
    .from(menuItems)
    .where(
      and(
        inArray(menuItems.menuId, menuIds),
        eq(menuItems.restaurantId, restaurantId),
        eq(menuItems.isAvailable, true),
      ),
    );

  const itemIds = itemRows
    .map((row: any) => String(row.id || ""))
    .filter(Boolean);
  const [revisionVariantRows, revisionModifierRows] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuItemVariants)
          .where(inArray(menuItemVariants.menuItemId, itemIds)),
        db
          .select()
          .from(menuItemModifiers)
          .where(inArray(menuItemModifiers.menuItemId, itemIds)),
      ])
    : [[], []];
  const menuRevisionEvidence = createStructuredMenuRevision({
    menus: menuRows as Array<Record<string, unknown>>,
    categories: categoryRows as Array<Record<string, unknown>>,
    items: itemRows as Array<Record<string, unknown>>,
    variants: revisionVariantRows as Array<Record<string, unknown>>,
    modifiers: revisionModifierRows as Array<Record<string, unknown>>,
  });
  let publicPhotoRows: Array<{
    menuItemId: string | null;
    imageUrl: string | null;
    status: string | null;
    featuredByBusiness: boolean | null;
    createdAt: Date | null;
  }> = [];
  if (itemIds.length) {
    try {
      publicPhotoRows = await db
        .select({
          menuItemId: menuItemPhotos.menuItemId,
          imageUrl: menuItemPhotos.imageUrl,
          status: menuItemPhotos.status,
          featuredByBusiness: menuItemPhotos.featuredByBusiness,
          createdAt: menuItemPhotos.createdAt,
        })
        .from(menuItemPhotos)
        .where(
          and(
            inArray(menuItemPhotos.menuItemId, itemIds),
            inArray(menuItemPhotos.status, ["accepted", "featured"] as any),
          ),
        );
    } catch (error) {
      if (isMissingRelationError(error, "menu_item_photos")) {
        console.warn(
          "[public-profile] menu_item_photos missing; continuing without menu photos",
        );
      } else {
        throw error;
      }
    }
  }
  const photosByMenuItem = new Map<string, Array<any>>();
  for (const photo of publicPhotoRows) {
    const key = String(photo.menuItemId || "");
    if (!key) continue;
    const existing = photosByMenuItem.get(key) || [];
    existing.push(photo);
    photosByMenuItem.set(key, existing);
  }

  const recommendationCountByItem = new Map<string, number>();
  const viewerRecommendedItemIds = new Set<string>();
  if (itemIds.length) {
    const recommendationRows = await db
      .select({
        menuItemId: menuItemRecommendations.menuItemId,
        recommendationCount: sql<number>`count(${menuItemRecommendations.id})`,
      })
      .from(menuItemRecommendations)
      .where(
        and(
          eq(menuItemRecommendations.restaurantId, restaurantId),
          inArray(menuItemRecommendations.menuItemId, itemIds),
        ),
      )
      .groupBy(menuItemRecommendations.menuItemId);
    for (const row of recommendationRows) {
      const menuItemId = String(row.menuItemId || "");
      if (!menuItemId) continue;
      recommendationCountByItem.set(
        menuItemId,
        Math.max(0, Number(row.recommendationCount || 0) || 0),
      );
    }

    const viewerUserId = String(context?.viewerUserId || "").trim();
    if (viewerUserId) {
      const viewerRows = await db
        .select({ menuItemId: menuItemRecommendations.menuItemId })
        .from(menuItemRecommendations)
        .where(
          and(
            eq(menuItemRecommendations.restaurantId, restaurantId),
            eq(menuItemRecommendations.userId, viewerUserId),
            inArray(menuItemRecommendations.menuItemId, itemIds),
          ),
        );
      for (const row of viewerRows) {
        const menuItemId = String(row.menuItemId || "");
        if (menuItemId) viewerRecommendedItemIds.add(menuItemId);
      }
    }
  }

  const categoryById = new Map(categoryRows.map((row: any) => [row.id, row]));
  const itemsByCategory = new Map<string, typeof itemRows>();
  const ungroupedItems: typeof itemRows = [];
  for (const item of itemRows) {
    if (item.categoryId && categoryById.has(item.categoryId)) {
      const existing = itemsByCategory.get(item.categoryId) || [];
      existing.push(item);
      itemsByCategory.set(item.categoryId, existing);
      continue;
    }
    ungroupedItems.push(item);
  }

  const orderedCategories = [...categoryRows].sort((a: any, b: any) => {
    if (a.sortOrder === b.sortOrder) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    }
    return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
  });

  const menuSectionsByMenu = new Map<
    string,
    Array<{
      name: string;
      items: Array<{
        menuItemId: string | null;
        name: string;
        priceCents: number | null;
        description: string | null;
        imageUrl: string | null;
        featured: boolean;
      }>;
    }>
  >();
  const menuSections: Array<{
    name: string;
    items: Array<{
      menuItemId: string | null;
      name: string;
      priceCents: number | null;
      description: string | null;
      imageUrl: string | null;
      featured: boolean;
    }>;
  }> = [];

  for (const category of orderedCategories) {
    const categoryItems = (itemsByCategory.get(category.id) || [])
      .sort(
        (a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
      )
      .slice(0, 24)
      .map((item: any) => ({
        menuItemId: String(item.id || ""),
        name: String(item.name || "").trim(),
        priceCents: Number.isFinite(Number(item.priceCents))
          ? Number(item.priceCents)
          : null,
        description: String(item.description || "").trim() || null,
        imageUrl: (() => {
          const restaurantOwned = String(item.imageUrl || "").trim() || null;
          if (restaurantOwned) return restaurantOwned;
          const photos = photosByMenuItem.get(String(item.id || "")) || [];
          const featured =
            photos.find(
              (photo: any) =>
                photo.featuredByBusiness || String(photo.status) === "featured",
            ) || null;
          if (featured?.imageUrl) return String(featured.imageUrl).trim();
          const accepted = photos
            .filter((photo: any) => String(photo.status) === "accepted")
            .sort(
              (a: any, b: any) =>
                new Date(b.createdAt || 0).getTime() -
                new Date(a.createdAt || 0).getTime(),
            );
          return accepted[0]?.imageUrl
            ? String(accepted[0].imageUrl).trim()
            : null;
        })(),
        featured: false,
        recommendationCount:
          recommendationCountByItem.get(String(item.id || "")) || 0,
        userRecommended: viewerRecommendedItemIds.has(String(item.id || "")),
      }))
      .filter((item: any) => item.name.length > 0);

    if (!categoryItems.length) continue;
    const sectionPayload = {
      name: String(category.name || "").trim() || "Menu",
      items: categoryItems,
    };
    menuSections.push(sectionPayload);
    const existingForMenu =
      menuSectionsByMenu.get(String(category.menuId)) || [];
    existingForMenu.push(sectionPayload);
    menuSectionsByMenu.set(String(category.menuId), existingForMenu);
  }

  if (ungroupedItems.length > 0) {
    const fallbackItems = [...ungroupedItems]
      .sort(
        (a: any, b: any) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
      )
      .slice(0, 24)
      .map((item: any) => ({
        menuItemId: String(item.id || ""),
        name: String(item.name || "").trim(),
        priceCents: Number.isFinite(Number(item.priceCents))
          ? Number(item.priceCents)
          : null,
        description: String(item.description || "").trim() || null,
        imageUrl: (() => {
          const restaurantOwned = String(item.imageUrl || "").trim() || null;
          if (restaurantOwned) return restaurantOwned;
          const photos = photosByMenuItem.get(String(item.id || "")) || [];
          const featured =
            photos.find(
              (photo: any) =>
                photo.featuredByBusiness || String(photo.status) === "featured",
            ) || null;
          if (featured?.imageUrl) return String(featured.imageUrl).trim();
          const accepted = photos
            .filter((photo: any) => String(photo.status) === "accepted")
            .sort(
              (a: any, b: any) =>
                new Date(b.createdAt || 0).getTime() -
                new Date(a.createdAt || 0).getTime(),
            );
          return accepted[0]?.imageUrl
            ? String(accepted[0].imageUrl).trim()
            : null;
        })(),
        featured: false,
        recommendationCount:
          recommendationCountByItem.get(String(item.id || "")) || 0,
        userRecommended: viewerRecommendedItemIds.has(String(item.id || "")),
      }))
      .filter((item) => item.name.length > 0);
    if (fallbackItems.length) {
      const fallbackSection = {
        name: "Menu",
        items: fallbackItems,
      };
      menuSections.push(fallbackSection);
      if (menuRows.length === 1) {
        const firstMenuId = String(menuRows[0]?.id || "");
        if (firstMenuId) {
          const existingForMenu = menuSectionsByMenu.get(firstMenuId) || [];
          existingForMenu.push(fallbackSection);
          menuSectionsByMenu.set(firstMenuId, existingForMenu);
        }
      }
    }
  }

  const latestTimestamps = [
    ...menuRows
      .map((row: any) => row.updatedAt || row.importedAt)
      .filter((value: any): value is Date => value instanceof Date),
    ...itemRows
      .map((row: any) => row.updatedAt)
      .filter((value: any): value is Date => value instanceof Date),
  ];
  const menuLastUpdatedAt =
    latestTimestamps.length > 0
      ? new Date(Math.max(...latestTimestamps.map((value) => value.getTime())))
      : null;

  const menuVariants = menuRows.map((row: any) => {
    const rowId = String(row.id || "");
    const sectionsForMenu = menuSectionsByMenu.get(rowId) || [];
    return {
      id: rowId,
      name: String(row.name || "").trim() || "Menu",
      serviceType: String((row as any).serviceType || "").trim() || null,
      menuSections: sectionsForMenu.map((section: any) => ({
        name: section.name,
        items: section.items.map((item: any) => ({
          menuItemId: String(item.menuItemId || "").trim() || null,
          name: item.name,
          priceLabel:
            Number.isFinite(Number(item.priceCents)) && item.priceCents != null
              ? `$${(Number(item.priceCents) / 100).toFixed(2)}`
              : null,
          description: item.description,
          imageUrl: item.imageUrl,
          featured: Boolean(item.featured),
          recommendationCount: Number(item.recommendationCount || 0),
          userRecommended: Boolean(item.userRecommended),
        })),
      })),
      menuLastUpdatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt
          : row.importedAt instanceof Date
            ? row.importedAt
            : null,
      menuUrl: menuUrlFallback,
    };
  });

  const preferredMenuId = String(context?.preferredMenuId || "").trim();
  const activeVariant =
    (preferredMenuId &&
      menuVariants.find((variant: any) => variant.id === preferredMenuId)) ||
    menuVariants[0] ||
    null;

  const activeSections = activeVariant
    ? activeVariant.menuSections.map((section: any) => ({
        name: section.name,
        items: section.items.map((item: any) => ({
          menuItemId: String(item.menuItemId || "").trim() || null,
          name: item.name,
          priceCents: item.priceLabel
            ? Math.round(
                Number(String(item.priceLabel).replace(/[^0-9.]/g, "")) * 100,
              )
            : null,
          description: item.description,
          imageUrl: item.imageUrl,
          featured: Boolean(item.featured),
          recommendationCount: Number(item.recommendationCount || 0),
          userRecommended: Boolean(item.userRecommended),
        })),
      }))
    : menuSections;

  return {
    menuSections: activeSections,
    menuVariants,
    activeMenuId: activeVariant ? String(activeVariant.id) : null,
    menuContextNote:
      context?.eventId && activeVariant
        ? "Event menu prices are shown for this event."
        : null,
    menuLastUpdatedAt: activeVariant?.menuLastUpdatedAt || menuLastUpdatedAt,
    menuUrl: menuUrlFallback,
    hasStructuredMenu: activeSections.length > 0,
    menuRevision: menuRevisionEvidence.revision,
    menuRevisionCoversRenderedMenu: true,
  };
};

export function registerPublicDiscoveryRoutes(app: Express) {
  app.post("/api/public/discovery-analytics", async (req, res) => {
    try {
      const schema = z.object({
        eventType: z.string().trim().min(1),
        sourcePageType: z.string().trim().min(1),
        city: z.string().trim().max(120).optional().nullable(),
        cuisine: z.string().trim().max(120).optional().nullable(),
        profileId: z.string().trim().max(80).optional().nullable(),
        profileType: z
          .enum([
            "restaurant",
            "truck",
            "bar",
            "caterer",
            "private_chef",
            "location",
          ])
          .optional()
          .nullable(),
        targetPath: z.string().trim().max(500).optional().nullable(),
        sourcePath: z.string().trim().max(500),
      });
      const parsed = schema.parse(req.body || {});
      if (!DISCOVERY_ANALYTICS_EVENT_TYPES.has(parsed.eventType)) {
        return res.status(400).json({ message: "Unsupported eventType" });
      }
      if (!DISCOVERY_SOURCE_PAGE_TYPES.has(parsed.sourcePageType)) {
        return res.status(400).json({ message: "Unsupported sourcePageType" });
      }

      const userAgent = String(req.get("user-agent") || "");
      const actorType = classifyActorTypeFromUserAgent(userAgent);
      const sourceType = sourceTypeFromActor(actorType);
      const anonymousActorId = createHash("sha256")
        .update(`${String(req.ip || "unknown")}|${userAgent.slice(0, 160)}`)
        .digest("hex")
        .slice(0, 20);

      await db.insert(requestLogs).values({
        method: "EVENT",
        path: parsed.sourcePath,
        statusCode: 202,
        durationMs: 0,
        userId: (req as any).user?.id || null,
        sessionId: (req as any).sessionID || null,
        anonymousActorId,
        actorType,
        sourceType,
        eventType: "discovery_event",
        surface: "public_discovery",
        entityId: parsed.profileId || null,
        entityType:
          parsed.profileType === "location"
            ? "host"
            : parsed.profileType || null,
        ip: req.ip || null,
        userAgent: userAgent || null,
        metadata: {
          discoveryEventType: parsed.eventType,
          sourcePageType: parsed.sourcePageType,
          city: parsed.city || null,
          cuisine: parsed.cuisine || null,
          profileId: parsed.profileId || null,
          profileType: parsed.profileType || null,
          targetPath: parsed.targetPath || null,
          sourcePath: parsed.sourcePath,
          referrer: String(req.get("referer") || ""),
          timestamp: new Date().toISOString(),
        },
      });

      return res.status(202).json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid analytics payload", errors: error.errors });
      }
      console.error("Error recording public discovery analytics:", error);
      return res
        .status(500)
        .json({ message: "Failed to record analytics event" });
    }
  });

  app.post("/api/public/profile-analytics", async (req, res) => {
    try {
      const schema = z.object({
        profileEntity: z.enum([
          "restaurant",
          "truck",
          "bar",
          "caterer",
          "private_chef",
          "location",
        ]),
        profileId: z.string().trim().min(1),
        actionType: z.string().trim().min(1),
        targetType: z.string().trim().max(80).optional().nullable(),
        targetHrefCategory: z.string().trim().max(200).optional().nullable(),
        source: z.string().trim().max(64).optional(),
      });
      const parsed = schema.parse(req.body || {});
      if (!PUBLIC_PROFILE_ANALYTICS_ACTIONS.has(parsed.actionType)) {
        return res.status(400).json({ message: "Unsupported actionType" });
      }

      const source = PUBLIC_PROFILE_ANALYTICS_SOURCES.has(
        String(parsed.source || ""),
      )
        ? String(parsed.source)
        : "unknown";

      const userType = String((req as any).user?.userType || "");
      if (
        source === "owner_dashboard_preview" ||
        [
          "admin",
          "duper_admin",
          "super_admin",
          "staff",
          "restaurant_owner",
          "food_truck",
          "host",
          "event_coordinator",
        ].includes(userType)
      ) {
        return res.status(202).json({ ok: true, ignored: true });
      }

      const profileEntityType =
        parsed.profileEntity === "location" ? "host" : parsed.profileEntity;
      if (parsed.profileEntity === "location") {
        const host = await storage.getHost(parsed.profileId);
        if (!host)
          return res.status(404).json({ message: "Profile not found" });
      } else {
        const row = await storage.getRestaurant(parsed.profileId);
        if (!row || !row.isActive)
          return res.status(404).json({ message: "Profile not found" });
        if (
          parsed.profileEntity === "truck" &&
          !isTruckRestaurantRow(row)
        ) {
          return res.status(404).json({ message: "Profile not found" });
        }
        if (
          parsed.profileEntity === "bar" &&
          !isBarBusinessType(row.businessType)
        ) {
          return res.status(404).json({ message: "Profile not found" });
        }
      }

      const userAgent = String(req.get("user-agent") || "");
      const actorType = classifyActorTypeFromUserAgent(userAgent);
      const sourceType = sourceTypeFromActor(actorType);
      const anonymousActorId = createHash("sha256")
        .update(`${String(req.ip || "unknown")}|${userAgent.slice(0, 160)}`)
        .digest("hex")
        .slice(0, 20);
      const profilePath = `/p/${parsed.profileEntity}/${parsed.profileId}`;
      const discoveryMetadata = buildProfileAnalyticsDiscoveryMetadata({
        req,
        actionType: parsed.actionType,
        entity: {
          type:
            parsed.profileEntity === "location"
              ? "host"
              : parsed.profileEntity === "truck"
                ? "truck"
                : "restaurant",
          id: parsed.profileId,
          name: null,
        },
        displayedPage: profilePath,
      });

      await db.insert(requestLogs).values({
        method: "EVENT",
        path: profilePath,
        statusCode: 200,
        durationMs: 0,
        userId: (req as any).user?.id || null,
        sessionId: (req as any).sessionID || null,
        anonymousActorId,
        actorType,
        sourceType,
        eventType:
          parsed.actionType === "profile_view"
            ? "profile_view"
            : parsed.actionType.startsWith("qr_")
              ? "qr_open"
              : "profile_action",
        surface: "public_profile",
        entityId: parsed.profileId,
        entityType: profileEntityType,
        ip: req.ip || null,
        userAgent: userAgent || null,
        metadata: {
          profileEntity: parsed.profileEntity,
          profileId: parsed.profileId,
          actionType: parsed.actionType,
          targetType: parsed.targetType || null,
          targetHrefCategory: parsed.targetHrefCategory || null,
          source,
          referrer: String(req.get("referer") || ""),
          timestamp: new Date().toISOString(),
          ...discoveryMetadata,
        },
      });

      return res.status(202).json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid analytics payload", errors: error.errors });
      }
      console.error("Error recording public profile analytics:", error);
      return res
        .status(500)
        .json({ message: "Failed to record analytics event" });
    }
  });

  app.get(
    "/api/admin/discovery-analytics",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userType = String(req.user?.userType || "");
        if (
          !["admin", "duper_admin", "super_admin", "staff"].includes(userType)
        ) {
          return res.status(403).json({ message: "Forbidden" });
        }

        const windowParam = String(req.query.window || "7d");
        if (windowParam !== "7d" && windowParam !== "30d") {
          return res.status(400).json({ message: "Invalid window" });
        }
        const now = new Date();
        const currentStart = new Date(now);
        currentStart.setHours(0, 0, 0, 0);
        currentStart.setDate(
          currentStart.getDate() - (windowParam === "30d" ? 30 : 7),
        );

        const baseWhere = [
          eq(requestLogs.surface, "public_discovery"),
          eq(requestLogs.eventType, "discovery_event"),
          gte(requestLogs.createdAt, currentStart),
        ];

        const [totalsRow] = await db
          .select({
            discoveryPageViews:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_page_view')`.mapWith(
                Number,
              ),
            cardClicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_card_click')`.mapWith(
                Number,
              ),
            profileClicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_profile_click')`.mapWith(
                Number,
              ),
            ctaClicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_cta_click')`.mapWith(
                Number,
              ),
          })
          .from(requestLogs)
          .where(and(...baseWhere));

        const topPagesRows = await db
          .select({
            sourcePageType: sql<string>`${requestLogs.metadata}->>'sourcePageType'`,
            city: sql<string | null>`${requestLogs.metadata}->>'city'`,
            cuisine: sql<string | null>`${requestLogs.metadata}->>'cuisine'`,
            sourcePath: sql<string>`${requestLogs.metadata}->>'sourcePath'`,
            views:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_page_view')`.mapWith(
                Number,
              ),
            clicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' in ('discovery_card_click','discovery_profile_click','discovery_cta_click'))`.mapWith(
                Number,
              ),
          })
          .from(requestLogs)
          .where(and(...baseWhere))
          .groupBy(
            sql`${requestLogs.metadata}->>'sourcePageType'`,
            sql`${requestLogs.metadata}->>'city'`,
            sql`${requestLogs.metadata}->>'cuisine'`,
            sql`${requestLogs.metadata}->>'sourcePath'`,
          )
          .orderBy(sql`count(*) desc`)
          .limit(20);

        const topProfilesRows = await db
          .select({
            profileId: sql<string>`${requestLogs.metadata}->>'profileId'`,
            profileType: sql<string>`${requestLogs.metadata}->>'profileType'`,
            profilePath: sql<string>`${requestLogs.metadata}->>'targetPath'`,
            displayName: sql<
              string | null
            >`${requestLogs.metadata}->>'displayName'`,
            clicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' in ('discovery_card_click','discovery_profile_click'))`.mapWith(
                Number,
              ),
          })
          .from(requestLogs)
          .where(
            and(
              ...baseWhere,
              sql`${requestLogs.metadata}->>'discoveryEventType' in ('discovery_card_click','discovery_profile_click')`,
            ),
          )
          .groupBy(
            sql`${requestLogs.metadata}->>'profileId'`,
            sql`${requestLogs.metadata}->>'profileType'`,
            sql`${requestLogs.metadata}->>'targetPath'`,
            sql`${requestLogs.metadata}->>'displayName'`,
          )
          .orderBy(sql`count(*) desc`)
          .limit(20);

        const topCitiesRows = await db
          .select({
            city: sql<string>`${requestLogs.metadata}->>'city'`,
            views:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' = 'discovery_page_view')`.mapWith(
                Number,
              ),
            clicks:
              sql<number>`count(*) filter (where ${requestLogs.metadata}->>'discoveryEventType' in ('discovery_card_click','discovery_profile_click','discovery_cta_click'))`.mapWith(
                Number,
              ),
          })
          .from(requestLogs)
          .where(and(...baseWhere))
          .groupBy(sql`${requestLogs.metadata}->>'city'`)
          .orderBy(sql`count(*) desc`)
          .limit(20);

        return res.json({
          window: windowParam as "7d" | "30d",
          generatedAt: now.toISOString(),
          totals: {
            discoveryPageViews: Number(totalsRow?.discoveryPageViews || 0),
            cardClicks: Number(totalsRow?.cardClicks || 0),
            profileClicks: Number(totalsRow?.profileClicks || 0),
            ctaClicks: Number(totalsRow?.ctaClicks || 0),
          },
          topPages: topPagesRows
            .filter(
              (row: any) => String(row.sourcePageType || "").trim().length > 0,
            )
            .map((row: any) => ({
              sourcePageType: String(row.sourcePageType || ""),
              city: row.city || undefined,
              cuisine: row.cuisine || undefined,
              sourcePath: String(row.sourcePath || ""),
              views: Number(row.views || 0),
              clicks: Number(row.clicks || 0),
            })),
          topProfilesFromDiscovery: topProfilesRows
            .filter((row: any) => String(row.profileId || "").trim().length > 0)
            .map((row: any) => ({
              profileId: String(row.profileId || ""),
              profileType: String(row.profileType || ""),
              profilePath: String(row.profilePath || ""),
              displayName: row.displayName || undefined,
              clicks: Number(row.clicks || 0),
            })),
          topCities: topCitiesRows
            .filter((row: any) => String(row.city || "").trim().length > 0)
            .map((row: any) => ({
              city: String(row.city || ""),
              views: Number(row.views || 0),
              clicks: Number(row.clicks || 0),
            })),
        });
      } catch (error) {
        console.error("Error fetching admin discovery analytics:", error);
        return res
          .status(500)
          .json({ message: "Failed to fetch discovery analytics" });
      }
    },
  );

  app.get("/api/public/resolve/:entity/:slug", async (req, res) => {
    try {
      const entity = normalizePublicProfileEntity(req.params.entity);
      const slugOrId = String(req.params.slug || "").trim();
      if (!entity || !slugOrId) {
        return res
          .status(400)
          .json({ exists: false, reason: "invalid_request" });
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

      if (["restaurant", "truck", "bar", "caterer", "private_chef"].includes(entity)) {
        let row: any =
          entity === "truck"
            ? await resolveTruckRestaurantForPublicId(idHint)
            : await storage.getRestaurant(idHint);
        if (!row || !row.isActive) {
          const allRows = (await storage.getAllRestaurants()).filter(
            (candidate: any) => Boolean(candidate?.isActive),
          );
          const slugKey = toSlug(slugOrId.replace(/--[0-9a-f-]{36}$/i, ""));
          row = allRows.find((candidate: any) => {
            if (entity === "truck" && !isTruckRestaurantRow(candidate))
              return false;
            if (
              entity === "bar" &&
              !isBarBusinessType(candidate?.businessType)
            )
              return false;
            if (
              (entity === "caterer" || entity === "private_chef") &&
              toCanonicalFoodBusinessType(candidate?.businessType) !== entity
            )
              return false;
            return toSlug(candidate?.name) === slugKey;
          });
        }
        if (!row) {
          return res.status(404).json({ exists: false, reason: "not_found" });
        }

        const rowSlug = toSlug(row.name) || String(row.id);
        const canonicalBusinessType = toCanonicalFoodBusinessType(row.businessType);
        const serviceEntity =
          canonicalBusinessType === "caterer" ||
          canonicalBusinessType === "private_chef"
            ? canonicalBusinessType
            : null;
        const routeEntity =
          entity === "truck"
            ? "truck"
            : entity === "bar"
              ? "bar"
              : isTruckRestaurantRow(row)
                ? "truck"
                : isBarBusinessType(row.businessType)
                  ? "bar"
                  : serviceEntity
                    ? serviceEntity
                    : "restaurant";
        const canonicalPath = buildPublicProfilePath({
          entityType: routeEntity,
          name: row.name,
          id: row.id,
        });
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
        const canonicalPath = buildPublicProfilePath({
          entityType: "location",
          name: row.businessName,
          id: row.id,
        });
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
        const canonicalPath = buildPublicProfilePath({
          entityType: "supplier",
          name: row.businessName,
          id: row.id,
        });
        return sendPublicJson(res, {
          exists: true,
          entityType: "supplier",
          id: String(row.id),
          slug: rowSlug,
          canonicalUrl: `${safeBase}${canonicalPath}`,
        });
      }

      return res
        .status(400)
        .json({ exists: false, reason: "unsupported_entity" });
    } catch (error) {
      console.error("Error resolving public profile slug:", error);
      res.status(500).json({ exists: false, reason: "server_error" });
    }
  });

  app.get("/api/public/resolve-business/:businessSlug", async (req, res) => {
    try {
      const businessSlug = String(req.params.businessSlug || "").trim();
      const resolved = await resolvePublicBusinessSlug(businessSlug);
      if (resolved.status === "not_found") {
        return res.status(404).json({ exists: false, reason: "not_found" });
      }
      if (resolved.status === "ambiguous") {
        return res.status(409).json({
          exists: false,
          reason: "ambiguous_slug",
          businessSlug: resolved.businessSlug,
          candidateCount: resolved.candidates.length,
        });
      }
      const baseUrl = resolvePublicBaseUrl();

      return sendPublicJson(res, {
        exists: true,
        entityType: resolved.match.entityType,
        id: resolved.match.id,
        businessSlug: resolved.businessSlug,
        canonicalUrl: `${baseUrl}/${encodeURIComponent(resolved.businessSlug)}`,
      });
    } catch (error) {
      console.error("Error resolving public business slug:", error);
      res.status(500).json({ exists: false, reason: "server_error" });
    }
  });

  app.get("/api/public/canonical/:entity/:id", async (req, res) => {
    try {
      const entity = normalizePublicProfileEntity(req.params.entity);
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
          !row.address || !row.city || !row.state
            ? "missing_location_context"
            : null,
          !row.cuisineType ? "missing_cuisine" : null,
          !row.isVerified ? "unverified_profile" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.description ? 1 : 0) +
          (row.websiteUrl ? 1 : 0) +
          (row.address && row.city && row.state ? 1 : 0) +
          (row.cuisineType ? 1 : 0) +
          (row.isVerified || row.mobileOnline || row.isFoodTruck ? 1 : 0);

        const canonicalPath = buildPublicProfilePath({
          entityType:
            isTruckRestaurantRow(row)
              ? "truck"
              : isBarBusinessType(row.businessType)
                ? "bar"
                : "restaurant",
          name: row.name,
          id: row.id,
        });
        const truckPresence = deriveTruckPresence(
          {
            mobileOnline: row.mobileOnline,
            currentLatitude: row.currentLatitude,
            currentLongitude: row.currentLongitude,
            lastBroadcastAt: row.lastBroadcastAt,
            liveUntilAt: row.liveUntilAt,
            locationSource: "owner_gps",
          },
          { freshnessMs: DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS },
        );
        const liveLocationActive =
          truckPresence.broadcastState === "live";

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
              ? activeDeals.filter((deal: any) => deal?.isActive !== false)
                  .length
              : 0,
            liveLocationActive,
            isFoodTruck: Boolean(
              isTruckRestaurantRow(row),
            ),
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
            liveLocationActive ? "Live location signal available" : null,
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
            requiresPayment: events.requiresPayment,
            hostId: events.hostId,
            hostName: hosts.businessName,
            hostAddress: hosts.address,
            hostCity: hosts.city,
            hostState: hosts.state,
          })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(eq(events.id, id))
          .limit(1);

        if (!row) {
          return res.status(404).json({ message: "Entity not found" });
        }

        const confirmedTrucks =
          (await loadConfirmedEventTrucks([String(row.id)])).get(
            String(row.id),
          ) || [];
        const primaryTruck = confirmedTrucks[0] || null;
        const latestBookingConfirmation = confirmedTrucks
          .map((truck) => truck.bookingConfirmedAt)
          .filter((value): value is Date => value instanceof Date)
          .sort((left, right) => right.getTime() - left.getTime())[0];
        const freshnessSource =
          latestBookingConfirmation || row.lastConfirmedAt || row.updatedAt || row.date;
        const timeZone = resolveCityTimeZoneSync({
          city: row.hostCity || null,
          state: row.hostState || null,
        });
        const interval = buildSlotDateTimes({
          timeZone,
          date: row.date,
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
        });
        const lastConfirmedAtUtc = freshnessSource
          ? new Date(freshnessSource as any)
          : null;
        const slotIsPublic = Boolean(
          interval &&
            lastConfirmedAtUtc &&
            Number.isFinite(lastConfirmedAtUtc.getTime()) &&
            isSlotPublic({
              slot: {
                source: "parking_pass_booking",
                status: primaryTruck ? "confirmed" : "tentative",
                startsAtUtc: interval.startUtc,
                endsAtUtc: interval.endUtc,
                lastConfirmedAtUtc,
              },
              ...(primaryTruck ? { ttlHours: 24 * 365 * 100 } : {}),
            }),
        );
        if (
          !canExposeAnonymousEventDetail({
            requiresPayment: row.requiresPayment,
            status: row.status,
            slotIsPublic,
          })
        ) {
          return res.status(404).json({ message: "Entity not found" });
        }
        const freshnessHours = hoursSince(freshnessSource);
        const knowledgeGaps = [
          !row.name ? "missing_event_name" : null,
          !row.date ? "missing_event_date" : null,
          !row.eventType ? "missing_event_type" : null,
          !row.description ? "missing_description" : null,
          confirmedTrucks.length === 0 ? "missing_confirmed_truck" : null,
        ].filter(Boolean) as string[];

        const readinessScore =
          (row.name ? 1 : 0) +
          (row.date && row.startTime ? 1 : 0) +
          (row.description ? 1 : 0) +
          (row.hostId ? 1 : 0) +
          (confirmedTrucks.length > 0 ? 1 : 0);

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
          updatedAt: freshnessSource || null,
          verified: false,
          active:
            ["open", "booked", "filled"].includes(
              String(row.status || "").toLowerCase(),
            ),
          evidenceSummary: {
            hasHost: Boolean(row.hostId),
            hasBookedTruck: confirmedTrucks.length > 0,
            confirmedTruckCount: confirmedTrucks.length,
            maxTrucks: Number(row.maxTrucks || 0),
          },
          sourceFields: {
            hasDescription: Boolean(row.description),
            hasDate: Boolean(row.date),
            hasTime: Boolean(row.startTime && row.endTime),
            hasHost: Boolean(row.hostId && row.hostName),
            hasBookedTruck: confirmedTrucks.length > 0,
          },
          knowledgeGaps,
          sourceTruthStatements: [
            row.hostName ? `Hosted by ${row.hostName}` : null,
            row.hostAddress || row.hostCity
              ? [row.hostAddress, row.hostCity, row.hostState]
                  .filter(Boolean)
                  .join(", ")
              : null,
            confirmedTrucks.length > 0
              ? confirmedTrucks.length === 1
                ? `Confirmed truck: ${primaryTruck?.name}`
                : `${confirmedTrucks.length} confirmed trucks: ${confirmedTrucks
                    .map((truck) => truck.name)
                    .join(", ")}`
              : "No confirmed truck booking yet",
            latestBookingConfirmation
              ? "Booking confirmed on MealScout"
              : null,
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
          !row.address || !row.city || !row.state
            ? "missing_location_context"
            : null,
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

        const canonicalPath = buildPublicProfilePath({
          entityType: "location",
          name: row.businessName,
          id: row.id,
        });
        const locationTypeLabel = friendlyLocationTypeLabel(row.locationType);

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
            locationTypeLabel ? `Location type: ${locationTypeLabel}` : null,
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
            row.isActive
              ? "Deal currently active on MealScout"
              : "Deal is not active",
          ].filter(Boolean),
        });
      }

      return res.status(400).json({ message: "Unsupported canonical entity" });
    } catch (error) {
      console.error("Error fetching public canonical entity:", error);
      res.status(500).json({ message: "Failed to fetch canonical entity" });
    }
  });

  app.get("/api/public/profiles/:entity/:id/related", async (req, res) => {
    try {
      const entity = normalizePublicProfileEntity(req.params.entity);
      const id = String(req.params.id || "").trim();
      if (
        !["restaurant", "truck", "bar", "caterer", "private_chef"].includes(entity) ||
        !id
      ) {
        return res.status(400).json({ message: "Invalid profile target" });
      }

      const source = await storage.getRestaurant(id);
      if (!source || !source.isActive) {
        return res.status(404).json({ message: "Profile not found" });
      }
      if (entity === "truck" && !isTruckRestaurantRow(source)) {
        return res.status(404).json({ message: "Profile not found" });
      }
      if (entity === "bar" && !isBarBusinessType(source.businessType)) {
        return res.status(404).json({ message: "Profile not found" });
      }
      if (
        (entity === "caterer" || entity === "private_chef") &&
        toCanonicalFoodBusinessType(source.businessType) !== entity
      ) {
        return res.status(404).json({ message: "Profile not found" });
      }

      const sourceCity = String(source.city || "").trim().toLowerCase();
      const sourceState = String(source.state || "").trim().toLowerCase();
      if (!sourceCity) {
        return sendPublicJson(res, {
          sourceProfileId: id,
          attributionApplied: false,
          businesses: [],
        });
      }

      const sourceOwner = await db
        .select({ affiliateTag: users.affiliateTag })
        .from(users)
        .where(eq(users.id, source.ownerId))
        .limit(1);
      const affiliateTag = String(sourceOwner[0]?.affiliateTag || "").trim();
      const [promotionPolicyRows, promotionPartnerRows] = await Promise.all([
        db
          .select()
          .from(merchantPromotionPolicies)
          .where(eq(merchantPromotionPolicies.restaurantId, id))
          .limit(1),
        db
          .select()
          .from(merchantPromotionPartners)
          .where(eq(merchantPromotionPartners.sourceRestaurantId, id)),
      ]);
      const promotionPolicy = promotionPolicyRows[0];
      const partnerStatusByTarget = new Map<
        string,
        "approved" | "excluded" | null
      >(
        promotionPartnerRows.map((partner: {
          targetRestaurantId: string;
          status: string;
        }) => [
          partner.targetRestaurantId,
          partner.status === "approved" || partner.status === "excluded"
            ? partner.status
            : null,
        ] as [string, "approved" | "excluded" | null]),
      );
      if (promotionPolicy?.enabled === false) {
        return sendPublicJson(res, {
          sourceProfileId: id,
          attributionApplied: false,
          businesses: [],
        });
      }
      const marketConditions = [
        eq(restaurants.isActive, true),
        sql`lower(trim(${restaurants.city})) = ${sourceCity}`,
      ];
      if (sourceState) {
        marketConditions.push(
          sql`lower(trim(${restaurants.state})) = ${sourceState}`,
        );
      }
      const rows = await db
        .select()
        .from(restaurants)
        .where(and(...marketConditions))
        .limit(32);

      const candidates: PublicCrossPromotionCandidate[] = [];
      for (const row of rows) {
        if (
          String(row.id) === id ||
          deriveProfileEvidenceQuarantineVisibility(row).isQuarantined ||
          !promotionCandidateAllowed({
            enabled: promotionPolicy?.enabled !== false,
            approvalMode:
              promotionPolicy?.approvalMode === "approved_only"
                ? "approved_only"
                : "automatic",
            partnerStatus: partnerStatusByTarget.get(String(row.id)),
          })
        ) {
          continue;
        }

        const profileType = isTruckRestaurantRow(row)
          ? "truck"
          : isBarBusinessType(row.businessType)
            ? "bar"
            : "restaurant";
        const profilePath = await resolveUniqueCleanBusinessPathForEntity({
          entityType: profileType,
          id: String(row.id),
          name: String(row.name || row.id),
        });
        if (!profilePath) continue;
        const attributedProfilePath =
          buildCleanAffiliateBusinessPath(profilePath, affiliateTag) ||
          profilePath;
        const promotionProfilePath = `${attributedProfilePath}${attributedProfilePath.includes("?") ? "&" : "?"}promoSource=${encodeURIComponent(id)}`;

        candidates.push({
          id: String(row.id),
          name: String(row.name || "Local food"),
          profileType,
          cuisineType: row.cuisineType ? String(row.cuisineType) : null,
          city: row.city ? String(row.city) : null,
          state: row.state ? String(row.state) : null,
          logoUrl: row.logoUrl ? String(row.logoUrl) : null,
          coverImageUrl: row.coverImageUrl
            ? String(row.coverImageUrl)
            : null,
          profilePath,
          attributedProfilePath: promotionProfilePath,
          attributionApplied: attributedProfilePath !== profilePath,
        });
      }

      const businesses = rankPublicCrossPromotions(
        { id, cuisineType: source.cuisineType },
        candidates,
        8,
      );
      res.setHeader("Cache-Control", "public, max-age=300");
      return sendPublicJson(res, {
        sourceProfileId: id,
        attributionApplied: businesses.some(
          (business) => business.attributionApplied,
        ),
        businesses,
      });
    } catch (error) {
      console.error("[public-profile] related businesses error:", error);
      return res
        .status(500)
        .json({ message: "Unable to load related businesses" });
    }
  });

  app.get("/api/public/profiles/:entity/:id", async (req, res) => {
    try {
      const entity = normalizePublicProfileEntity(req.params.entity);
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({ message: "Profile id is required" });
      }

      const baseUrl = resolvePublicBaseUrl();
      const queryPreferredMenuId = String(
        (req.query?.eventMenuId as string) ||
          (req.query?.menuId as string) ||
          "",
      ).trim();
      const queryEventId = String((req.query?.eventId as string) || "").trim();
      const viewerUserId = String((req as any)?.user?.id || "").trim() || null;

      if (entity === "truck") {
        const row = await resolveTruckRestaurantForPublicId(id);
        if (!row || !row.isActive || !isTruckRestaurantRow(row)) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [menuPayload, operatingPlanPayload, dealsPayload] =
          await Promise.all([
            buildPublicMenuPayload(String(row.id), {
              preferredMenuId: queryPreferredMenuId || null,
              eventId: queryEventId || null,
              viewerUserId,
            }),
            buildPublicTruckOperatingPlan(String(row.id)),
            buildPublicDealsPayload(String(row.id), row),
          ]);
        const mapped = toPublicTruckProfile({
          row: {
            ...row,
            ...menuPayload,
            ...operatingPlanPayload,
            ...dealsPayload,
          },
          baseUrl,
          showAddress,
          showContact,
        });
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "truck",
            id: String(row.id),
            name: String(
              (row as any).name || (row as any).businessName || row.id,
            ),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          entity: "truck",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Food Truck",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "bar") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive || !isBarBusinessType(row.businessType)) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [menuPayload, dealsPayload, eventsPayload] = await Promise.all([
          buildPublicMenuPayload(String(row.id), {
            preferredMenuId: queryPreferredMenuId || null,
            eventId: queryEventId || null,
            viewerUserId,
          }),
          buildPublicDealsPayload(String(row.id), row),
          buildPublicEventsPayload({
            restaurantId: String(row.id),
            restaurantRow: row,
          }),
        ]);
        const mapped = toPublicBarProfile({
          row: {
            ...row,
            ...menuPayload,
            ...dealsPayload,
            ...eventsPayload,
          },
          baseUrl,
          showAddress,
          showContact,
        });
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "bar",
            id: String(row.id),
            name: String(
              (row as any).name || (row as any).businessName || row.id,
            ),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          entity: "restaurant",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Bar",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
          canonicalUrl: mapped.seo.canonicalUrl,
          websiteUrl: mapped.websiteUrl,
          profileSettings,
          social: mapped.socialLinks,
        });
      }

      if (entity === "caterer" || entity === "private_chef") {
        const row = await storage.getRestaurant(id);
        if (
          !row ||
          !row.isActive ||
          toCanonicalFoodBusinessType(row.businessType) !== entity
        ) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress =
          entity === "private_chef" ? false : profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [menuPayload, dealsPayload, eventsPayload] = await Promise.all([
          buildPublicMenuPayload(String(row.id), {
            preferredMenuId: queryPreferredMenuId || null,
            eventId: queryEventId || null,
            viewerUserId,
          }),
          buildPublicDealsPayload(String(row.id), row),
          buildPublicEventsPayload({
            restaurantId: String(row.id),
            restaurantRow: row,
          }),
        ]);
        const mapped = toPublicRestaurantProfile({
          row: {
            ...row,
            ...menuPayload,
            ...dealsPayload,
            ...eventsPayload,
          },
          baseUrl,
          profileType: entity,
          showAddress,
          showContact,
        });
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity({
          entityType: entity,
          id: String(row.id),
          name: String((row as any).name || (row as any).businessName || row.id),
        });
        return sendPublicJson(res, {
          ...mapped,
          entity,
          title: mapped.displayName,
          subtitle: entity === "caterer" ? "Caterer" : "Private Chef",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
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
        const eventsPayload = await buildPublicEventsPayload({
          hostId: String(row.id),
        });
        const mapped = toPublicLocationProfile({
          row,
          baseUrl,
          showAddress,
          showContact,
        });
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "location",
            id: String(row.id),
            name: String(
              (row as any).businessName || (row as any).name || row.id,
            ),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          events: {
            totalUpcoming: Math.max(
              Number(mapped.events?.totalUpcoming || 0),
              Number(eventsPayload.upcomingEventCount || 0),
            ),
            items: Array.isArray(eventsPayload.eventsItems)
              ? eventsPayload.eventsItems
              : [],
          },
          entity: "host",
          title: mapped.displayName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          address: mapped.addressPublicLabel,
          phone: showContact
            ? String(row.contactPhone || "").trim() || null
            : null,
          imageUrl:
            mapped.spotImageUrl || mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
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
        const isTruckProfile = isTruckRestaurantRow(row);
        const [menuPayload, dealsPayload, profileActivityPayload] =
          await Promise.all([
            buildPublicMenuPayload(String(row.id), {
              preferredMenuId: queryPreferredMenuId || null,
              eventId: queryEventId || null,
              viewerUserId,
            }),
            buildPublicDealsPayload(String(row.id), row),
            isTruckProfile
              ? buildPublicTruckOperatingPlan(String(row.id))
              : buildPublicEventsPayload({
                  restaurantId: String(row.id),
                  restaurantRow: row,
                }),
          ]);
        if (isTruckProfile) {
          const mapped = toPublicTruckProfile({
            row: {
              ...row,
              ...menuPayload,
              ...dealsPayload,
              ...profileActivityPayload,
            },
            baseUrl,
            showAddress,
            showContact,
          });
          const cleanBusinessPath =
            await resolveUniqueCleanBusinessPathForEntity({
              entityType: "truck",
              id: String(row.id),
              name: String(
                (row as any).name || (row as any).businessName || row.id,
              ),
            });
          return sendPublicJson(res, {
            ...mapped,
            entity: "truck",
            title: mapped.displayName,
            subtitle: mapped.serviceType || "Food Truck",
            address: mapped.addressPublicLabel,
            phone: mapped.phonePublic,
            imageUrl: mapped.coverImageUrl || mapped.logoUrl,
            profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
            cleanBusinessPath,
            canonicalUrl: mapped.seo.canonicalUrl,
            websiteUrl: mapped.websiteUrl,
            profileSettings,
            social: mapped.socialLinks,
          });
        }
        if (isBarBusinessType(row.businessType)) {
          const mapped = toPublicBarProfile({
            row: {
              ...row,
              ...menuPayload,
              ...dealsPayload,
              ...profileActivityPayload,
            },
            baseUrl,
            showAddress,
            showContact,
          });
          const cleanBusinessPath =
            await resolveUniqueCleanBusinessPathForEntity({
              entityType: "bar",
              id: String(row.id),
              name: String(
                (row as any).name || (row as any).businessName || row.id,
              ),
            });
          return sendPublicJson(res, {
            ...mapped,
            entity: "bar",
            title: mapped.displayName,
            subtitle: mapped.serviceType || "Bar",
            address: mapped.addressPublicLabel,
            phone: mapped.phonePublic,
            imageUrl: mapped.coverImageUrl || mapped.logoUrl,
            profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
            cleanBusinessPath,
            canonicalUrl: mapped.seo.canonicalUrl,
            websiteUrl: mapped.websiteUrl,
            profileSettings,
            social: mapped.socialLinks,
          });
        }
        const mapped = toPublicRestaurantProfile({
          row: {
            ...row,
            ...menuPayload,
            ...dealsPayload,
            ...profileActivityPayload,
          },
          baseUrl,
          showAddress,
          showContact,
        });
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "restaurant",
            id: String(row.id),
            name: String(
              (row as any).name || (row as any).businessName || row.id,
            ),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          entity: "restaurant",
          title: mapped.displayName,
          subtitle: mapped.serviceType || "Restaurant",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
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
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "location",
            id: String(row.id),
            name: String(
              (row as any).businessName || (row as any).name || row.id,
            ),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          entity: "host",
          title: mapped.displayName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          address: mapped.addressPublicLabel,
          phone: showContact
            ? String(row.contactPhone || "").trim() || null
            : null,
          imageUrl:
            mapped.spotImageUrl || mapped.coverImageUrl || mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
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
        const cleanBusinessPath = await resolveUniqueCleanBusinessPathForEntity(
          {
            entityType: "supplier",
            id: String(row.id),
            name: String(row.businessName || row.name || row.id),
          },
        );
        return sendPublicJson(res, {
          ...mapped,
          entity: "supplier",
          title: mapped.displayName,
          subtitle: "Supplier",
          address: mapped.addressPublicLabel,
          phone: mapped.phonePublic,
          imageUrl: mapped.logoUrl,
          profilePath: mapped.seo.canonicalUrl.replace(baseUrl, ""),
          cleanBusinessPath,
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
      const entity = String(req.params.entity || "")
        .toLowerCase()
        .trim();
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
        const searchTokens = keywordTokens(
          [row.name, row.cuisineType].join(" "),
        );

        const [
          recentRequests,
          recentShares,
          recentPosts,
          recentQueries,
          stories,
        ] = await Promise.all([
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
              (candidate) =>
                path === candidate || path.startsWith(`${candidate}?`),
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
              (post: any) =>
                String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "")
                    .trim()
                    .toLowerCase(),
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
              (post: any) =>
                String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "")
                    .trim()
                    .toLowerCase(),
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
              (post: any) =>
                String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "")
                    .trim()
                    .toLowerCase(),
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
              (post: any) =>
                String(post.status || "").toLowerCase() === "posted",
            ).length,
          },
          demand: {
            matchingSearchQueries: matchingQueries.length,
            topQueries: Object.entries(
              countBy(
                matchingQueries.map((query: any) =>
                  String(query.query || "")
                    .trim()
                    .toLowerCase(),
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
        const cityName = String(row.city || "")
          .trim()
          .toLowerCase();
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
      const [city] = await db
        .select()
        .from(cities)
        .where(eq(cities.slug, slug));
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }

      const cityRestaurants = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.city, city.name));
      const trucks = cityRestaurants.filter((row: any) =>
        isTruckRestaurantRow(row),
      );
      const restaurantsOnly = cityRestaurants.filter(
        (row: any) => !isTruckRestaurantRow(row),
      );

      const hostRows = await db
        .select()
        .from(hosts)
        .where(eq(hosts.city, city.name));
      const hostIds = hostRows.map((row: any) => row.id);
      let upcomingEvents: any[] = [];
      if (hostIds.length) {
        const now = new Date();
        upcomingEvents = await db
          .select()
          .from(events)
          .where(eq(events.status, "open"));
        upcomingEvents = upcomingEvents.filter(
          (row: any) =>
            new Date(row.date) >= now && hostIds.includes(row.hostId),
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
          .filter(
            (row: any) =>
              row.restaurantId && restaurantIds.includes(row.restaurantId),
          )
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
