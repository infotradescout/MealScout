import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import {
  deals,
  events,
  hosts,
  menus,
  menuItems,
  restaurants,
  suppliers,
  users,
} from "@shared/schema";
import { shouldServePrerender } from "./botDetection";
import { buildOfficialSocialEntityMetaTags } from "./officialSocialEntity";

type PageLink = { label: string; href: string };

type PrerenderPage = {
  title: string;
  description: string;
  canonicalPath: string;
  imageUrl?: string | null;
  robots?: string;
  schema: object | object[];
  links: PageLink[];
  body: string[];
};

type PublicVideo = {
  title: string | null;
  description: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  createdAt: Date | null;
  isFeatured: boolean;
};

const escapeHtml = (value: string | null | undefined) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const defaultSocialImagePath = "/og-default.jpg?v=20260506";

const IMPORT_SYSTEM_EMAIL = (
  process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us"
).toLowerCase();

// Unclaimed, import-seeded listings should stay out of Google's index until a
// real owner claims them - indexing thousands of thin, identical-template
// pages en masse dilutes crawl budget and search quality for the pages that
// matter (claimed, real businesses).
async function isImportSystemOwner(ownerId: string | null): Promise<boolean> {
  if (!ownerId) return false;
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  return Boolean(owner?.email && owner.email.toLowerCase() === IMPORT_SYSTEM_EMAIL);
}

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const extractId = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const marker = raw.lastIndexOf("--");
  if (marker >= 0) return raw.slice(marker + 2);
  const uuid = raw.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return uuid?.[0] || raw;
};

const cleanText = (value: unknown, fallback = "") =>
  String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();

const cleanMultilineText = (value: unknown, fallback = "") =>
  String(value || fallback)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

const absoluteUrl = (baseUrl: string, pathOrUrl: string | null | undefined) => {
  const value = String(pathOrUrl || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${baseUrl}${value.startsWith("/") ? "" : "/"}${value}`;
};

const externalUrl = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
};

const isoDate = (value: unknown) => {
  if (!value) return undefined;
  const parsed = new Date(value as any);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
};

const paragraph = (value: string | null | undefined) => {
  const text = cleanMultilineText(value);
  if (!text) return "";
  return `<p>${escapeHtml(text).replace(/\n+/g, "<br>")}</p>`;
};

const employmentTypeForSchema = (value: string | null | undefined) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "full_time") return "FULL_TIME";
  if (normalized === "part_time") return "PART_TIME";
  if (normalized === "contract" || normalized === "gig") return "CONTRACTOR";
  if (normalized === "seasonal") return "TEMPORARY";
  return "OTHER";
};

const labelize = (value: string | null | undefined) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const indexableRobots =
  "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1";
const noindexRobots = "noindex,follow";

const friendlyLocationTypeLabel = (value: string | null | undefined) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "private_residence") return "Private event location";
  if (normalized === "business") return "Business";
  if (normalized === "other") return "Host location";
  return labelize(normalized);
};

const isSyntheticTestEntityName = (value: string | null | undefined) => {
  const normalized = cleanText(value).toLowerCase();
  return /^test (truck|restaurant|business|vendor)\b/.test(normalized);
};

const moneyFromCents = (value: unknown) => {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) / 100 : null;
};

const payRangeLabel = (row: {
  compensationLabel?: string | null;
  payMinCents?: number | null;
  payMaxCents?: number | null;
}) => {
  if (row.compensationLabel) return cleanText(row.compensationLabel);
  const min = moneyFromCents(row.payMinCents);
  const max = moneyFromCents(row.payMaxCents);
  if (min && max && min !== max) return `$${min}-$${max}/hr`;
  if (min) return `$${min}/hr`;
  if (max) return `Up to $${max}/hr`;
  return "";
};

const baseSalarySchema = (row: {
  payMinCents?: number | null;
  payMaxCents?: number | null;
}) => {
  const minValue = moneyFromCents(row.payMinCents);
  const maxValue = moneyFromCents(row.payMaxCents);
  if (!minValue && !maxValue) return undefined;
  return {
    "@type": "MonetaryAmount",
    currency: "USD",
    value: {
      "@type": "QuantitativeValue",
      ...(minValue ? { minValue } : {}),
      ...(maxValue ? { maxValue } : {}),
      ...(!maxValue && minValue ? { value: minValue } : {}),
      unitText: "HOUR",
    },
  };
};

const firstPhotoUrl = (value: unknown) => {
  if (!Array.isArray(value)) return "";
  const first = value.find((item) => item && typeof item === "object") as any;
  return String(first?.url || first?.src || first?.photoUrl || "");
};

const resolveRestaurantImage = (baseUrl: string, row: any) =>
  absoluteUrl(
    baseUrl,
    row.coverImageUrl ||
      row.facebookCoverUrl ||
      row.logoUrl ||
      firstPhotoUrl(row.googlePhotos) ||
      defaultSocialImagePath,
  );

const resolveHostImage = (baseUrl: string, row: any) =>
  absoluteUrl(
    baseUrl,
    row.spotImageUrl ||
      row.facebookCoverUrl ||
      firstPhotoUrl(row.googlePhotos) ||
      defaultSocialImagePath,
  );

async function publicVideosFor(
  _ownerType: string,
  _ownerId: string,
): Promise<PublicVideo[]> {
  return [];
}

const videoSchemas = (
  baseUrl: string,
  videos: PublicVideo[],
  fallbackName: string,
) =>
  videos.map((video: PublicVideo, index: number) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: cleanText(video.title, `${fallbackName} video ${index + 1}`),
    description: cleanText(
      video.description,
      `Public video from ${fallbackName}`,
    ),
    contentUrl: video.fileUrl,
    thumbnailUrl: absoluteUrl(
      baseUrl,
      video.thumbnailUrl || defaultSocialImagePath,
    ),
    uploadDate: video.createdAt
      ? new Date(video.createdAt as any).toISOString()
      : undefined,
    duration: video.durationSeconds
      ? `PT${Math.max(1, Number(video.durationSeconds || 0))}S`
      : undefined,
  }));

const menuSnippetForRestaurant = async (restaurantId: string) => {
  try {
    const [row] = await db
      .select({
        itemCount:
          sql<number>`count(${menuItems.id}) filter (where ${menuItems.isAvailable} = true)`.mapWith(
            Number,
          ),
        itemNames:
          sql<string>`string_agg(distinct ${menuItems.name}, ', ') filter (where ${menuItems.isAvailable} = true)`,
      })
      .from(menus)
      .leftJoin(menuItems, eq(menuItems.menuId, menus.id))
      .where(and(eq(menus.restaurantId, restaurantId), eq(menus.isActive, true)))
      .groupBy(menus.restaurantId);

    const itemNames = String(row?.itemNames || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    return {
      itemCount: Number(row?.itemCount || 0),
      itemNames,
    };
  } catch (error) {
    console.warn("[seo-prerender] menu snippet unavailable", {
      restaurantId,
      error,
    });
    return { itemCount: 0, itemNames: [] as string[] };
  }
};

const buildHtml = (baseUrl: string, page: PrerenderPage) => {
  const canonicalUrl = absoluteUrl(baseUrl, page.canonicalPath);
  const image = absoluteUrl(baseUrl, page.imageUrl || defaultSocialImagePath);
  const isDefaultSocialImage = /\/og-default\.jpg(?:$|\?)/i.test(image);
  const schema = Array.isArray(page.schema) ? page.schema : [page.schema];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <meta name="robots" content="${escapeHtml(page.robots || "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1")}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:url" content="${escapeHtml(image)}">
  <meta property="og:image:secure_url" content="${escapeHtml(image)}">
  ${isDefaultSocialImage ? '<meta property="og:image:type" content="image/jpeg">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">' : ""}
  <meta property="og:image:alt" content="${escapeHtml(page.title)}">
  <meta property="og:site_name" content="MealScout">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.title)}">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <meta name="twitter:image:alt" content="${escapeHtml(page.title)}">
  <link rel="image_src" href="${escapeHtml(image)}">
  ${buildOfficialSocialEntityMetaTags()}
  ${schema
    .map(
      (entry) =>
        `<script type="application/ld+json">${JSON.stringify(entry)}</script>`,
    )
    .join("\n  ")}
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; margin: 0; color: #111827; background: #fffaf2; }
    main { max-width: 860px; margin: 0 auto; padding: 28px 18px 44px; }
    h1 { font-size: 34px; line-height: 1.15; margin: 0 0 12px; }
    p { font-size: 16px; line-height: 1.65; margin: 0 0 14px; }
    img { max-width: 100%; border-radius: 12px; margin: 14px 0; }
    .links { margin-top: 20px; padding-top: 14px; border-top: 1px solid #fed7aa; }
    .links a { display: inline-block; margin: 8px 12px 0 0; color: #9a3412; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(page.title.replace(/\s+\|\s+MealScout$/, ""))}</h1>
    <p>${escapeHtml(page.description)}</p>
    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(page.title)}">` : ""}
    ${page.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n    ")}
    <div class="links">
      ${page.links
        .map(
          (link) =>
            `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
        )
        .join("\n      ")}
    </div>
  </main>
</body>
</html>`;
};

async function restaurantPage(baseUrl: string, restaurantId: string) {
  const [row] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!row || !row.isActive) return null;
  const isUnclaimed = await isImportSystemOwner(row.ownerId);

  const name = cleanText(row.name, "MealScout business");
  const isSyntheticTestEntity = isSyntheticTestEntityName(name);
  const cityState = [row.city, row.state]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const isTruck = Boolean(row.isFoodTruck) || row.businessType === "food_truck";
  const isBar = row.businessType === "bar";
  const isPrivateChef = row.businessType === "private_chef";
  const ownerType = isTruck ? "food_truck" : "restaurant";
  const rawCateringDetails =
    row.cateringDetails && typeof row.cateringDetails === "object"
      ? (row.cateringDetails as Record<string, any>)
      : {};
  const offersCatering = Boolean(
    row.offersCatering || row.businessType === "caterer" || isPrivateChef,
  );
  const cateringHeadline = cleanText(
    rawCateringDetails.headline || rawCateringDetails.title,
    isPrivateChef
      ? `${name} private chef bookings`
      : `${name} catering${isTruck ? " and events" : ""}`,
  );
  const cateringDescription = cleanText(
    rawCateringDetails.description || rawCateringDetails.notes,
    `${name} can support local catering, events, offices, private parties, and pop-ups through MealScout.`,
  );
  const cateringArea = cleanText(
    rawCateringDetails.serviceArea || rawCateringDetails.serviceAreaLabel,
    cityState,
  );
  const canonicalPath = isTruck
    ? `/truck/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`
    : isBar
      ? `/bar/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`
      : isPrivateChef
        ? `/chef/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`
      : `/restaurant/${encodeURIComponent(row.id)}/${encodeURIComponent(toSlug(name) || row.id)}`;
  const videos = await publicVideosFor(ownerType, row.id);
  const menuSnippet = await menuSnippetForRestaurant(row.id);
  const image = videos[0]?.thumbnailUrl || resolveRestaurantImage(baseUrl, row);
  const menuHighlights = menuSnippet.itemNames.slice(0, 5);
  const menuSentence = menuHighlights.length
    ? ` Menu highlights include ${menuHighlights.join(", ")}.`
    : "";
  const baseDescription = cleanText(
    row.description || row.facebookAbout,
    `${name}${cityState ? ` in ${cityState}` : ""} on MealScout. View profile details, specials, videos, menu information, and location updates.${menuSentence}`,
  );
  const cateringSentence = offersCatering
    ? isPrivateChef
      ? ` Private chef bookings, menus, service area, and booking details are available from this profile.`
      : ` Catering is available for local events and private bookings.`
    : "";
  const description = cleanText(
    `${baseDescription}${baseDescription.includes(menuHighlights[0] || "__none__") ? "" : menuSentence}${cateringSentence}`,
  );

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": isTruck
      ? "FoodTruck"
      : isBar
        ? "BarOrPub"
        : isPrivateChef
          ? "FoodEstablishment"
          : "Restaurant",
    name,
    description,
    url: absoluteUrl(baseUrl, canonicalPath),
    image,
    telephone: row.phone || row.googleFormattedPhone || undefined,
    servesCuisine: row.cuisineType || undefined,
    hasMenu: row.menuUrl
      ? externalUrl(row.menuUrl)
      : menuSnippet.itemNames.length
        ? {
            "@type": "Menu",
            name: `${name} menu`,
            hasMenuItem: menuSnippet.itemNames.slice(0, 8).map((item) => ({
              "@type": "MenuItem",
              name: item,
            })),
          }
        : undefined,
    makesOffer: offersCatering
      ? {
          "@type": "Offer",
          itemOffered: {
            "@type": "Service",
            name: cateringHeadline,
            description: cateringDescription,
            areaServed: cateringArea || cityState || undefined,
          },
        }
      : undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: row.address || undefined,
      addressLocality: row.city || undefined,
      addressRegion: row.state || undefined,
      addressCountry: "US",
    },
    sameAs: [
      row.websiteUrl,
      row.instagramUrl,
      row.facebookPageUrl,
      row.xUrl,
    ].filter(Boolean),
  };

  return {
    title: `${name}${cityState ? ` in ${cityState}` : ""} | MealScout`,
    description,
    canonicalPath,
    imageUrl: image,
    robots: isUnclaimed || isSyntheticTestEntity ? noindexRobots : indexableRobots,
    schema: [localBusiness, ...videoSchemas(baseUrl, videos, name)],
    links: [
      { label: "Open profile", href: canonicalPath },
      ...(offersCatering
        ? [{ label: "Catering", href: `${canonicalPath}?service=catering` }]
        : []),
      { label: "Find food nearby", href: "/search" },
      { label: "Open Scout", href: "/scout" },
    ],
    body: [
      row.cuisineType ? `Cuisine: ${row.cuisineType}` : "",
      cityState ? `Area: ${cityState}` : "",
      menuSnippet.itemCount
        ? `Menu on MealScout: ${menuSnippet.itemCount} item${menuSnippet.itemCount === 1 ? "" : "s"}${menuHighlights.length ? ` including ${menuHighlights.join(", ")}` : ""}.`
        : row.menuUrl
          ? "Menu link available on this MealScout profile."
          : "",
      offersCatering
        ? `${cateringHeadline}: ${cateringDescription}${cateringArea ? ` Area served: ${cateringArea}.` : ""}`
        : "",
      videos.length
        ? `${videos.length} public video${videos.length === 1 ? "" : "s"} available on this profile.`
        : "",
    ].filter(Boolean),
  } satisfies PrerenderPage;
}

async function hostPage(baseUrl: string, hostId: string) {
  const [row] = await db
    .select()
    .from(hosts)
    .where(eq(hosts.id, hostId))
    .limit(1);
  if (!row) return null;
  const name = cleanText(row.businessName, "MealScout host location");
  const cityState = [row.city, row.state]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const canonicalPath = `/location/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`;
  const videos = await publicVideosFor("host", row.id);
  const image = videos[0]?.thumbnailUrl || resolveHostImage(baseUrl, row);
  const description = cleanText(
    row.description || row.notes,
    `${name}${cityState ? ` in ${cityState}` : ""} is a MealScout host location for food truck parking and events.`,
  );
  const locationTypeLabel = friendlyLocationTypeLabel(row.locationType);

  return {
    title: `${name} Food Truck Location${cityState ? ` in ${cityState}` : ""} | MealScout`,
    description,
    canonicalPath,
    imageUrl: image,
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name,
        description,
        url: absoluteUrl(baseUrl, canonicalPath),
        image,
        telephone: row.contactPhone || row.googleFormattedPhone || undefined,
        address: {
          "@type": "PostalAddress",
          streetAddress: row.address || undefined,
          addressLocality: row.city || undefined,
          addressRegion: row.state || undefined,
          addressCountry: "US",
        },
      },
      ...videoSchemas(baseUrl, videos, name),
    ],
    links: [
      { label: "Open location", href: canonicalPath },
      { label: "Host food trucks", href: "/parking-pass" },
      { label: "Explore nearby food", href: "/scout" },
    ],
    body: [
      locationTypeLabel ? `Location type: ${locationTypeLabel}` : "",
      cityState ? `Area: ${cityState}` : "",
      videos.length
        ? `${videos.length} public video${videos.length === 1 ? "" : "s"} available for this location.`
        : "",
    ].filter(Boolean),
  } satisfies PrerenderPage;
}

async function eventPage(baseUrl: string, eventId: string) {
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
      hostId: events.hostId,
      bookedRestaurantId: events.bookedRestaurantId,
      hostName: hosts.businessName,
      hostCity: hosts.city,
      hostState: hosts.state,
      truckName: restaurants.name,
    })
    .from(events)
    .innerJoin(hosts, eq(events.hostId, hosts.id))
    .leftJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row || row.eventType === "private_event") return null;

  const title = cleanText(
    row.name || row.hostName,
    "MealScout food truck event",
  );
  const cityState = [row.hostCity, row.hostState]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const canonicalPath = `/event/${encodeURIComponent(`${toSlug(title) || row.id}--${row.id}`)}`;
  const videos = await publicVideosFor("event", row.id);
  const description = cleanText(
    row.description,
    `${title}${cityState ? ` in ${cityState}` : ""} on MealScout. See event details, host location, and food truck availability.`,
  );
  const eventDate = row.date ? new Date(row.date as any) : null;
  const ended = eventDate
    ? eventDate.getTime() < Date.now() - 24 * 60 * 60 * 1000
    : false;

  return {
    title: `${title}${cityState ? ` in ${cityState}` : ""} | MealScout`,
    description,
    canonicalPath,
    imageUrl: videos[0]?.thumbnailUrl || defaultSocialImagePath,
    robots:
      ended || row.status === "cancelled"
        ? "noindex,follow"
        : "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1",
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: title,
        description,
        url: absoluteUrl(baseUrl, canonicalPath),
        startDate: row.date
          ? new Date(row.date as any).toISOString()
          : undefined,
        eventStatus:
          row.status === "cancelled"
            ? "https://schema.org/EventCancelled"
            : "https://schema.org/EventScheduled",
        location: {
          "@type": "Place",
          name: row.hostName || undefined,
          address: cityState || undefined,
        },
        performer: row.truckName
          ? { "@type": "FoodTruck", name: row.truckName }
          : undefined,
      },
      ...videoSchemas(baseUrl, videos, title),
    ],
    links: [
      { label: "Open event", href: canonicalPath },
      { label: "Browse events", href: "/events" },
      { label: "Find food trucks", href: "/truck-discovery" },
    ],
    body: [
      eventDate ? `Date: ${eventDate.toDateString()}` : "",
      row.startTime && row.endTime
        ? `Time: ${row.startTime} - ${row.endTime}`
        : "",
      row.truckName ? `Booked truck: ${row.truckName}` : "",
    ].filter(Boolean),
  } satisfies PrerenderPage;
}

async function dealPage(baseUrl: string, dealId: string) {
  const now = new Date();
  const [row] = await db
    .select({
      id: deals.id,
      title: deals.title,
      description: deals.description,
      imageUrl: deals.imageUrl,
      startDate: deals.startDate,
      endDate: deals.endDate,
      isActive: deals.isActive,
      discountValue: deals.discountValue,
      dealType: deals.dealType,
      restaurantId: deals.restaurantId,
      restaurantName: restaurants.name,
      city: restaurants.city,
      state: restaurants.state,
      cuisineType: restaurants.cuisineType,
    })
    .from(deals)
    .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
    .where(eq(deals.id, dealId))
    .limit(1);
  if (!row) return null;
  const active =
    Boolean(row.isActive) &&
    (!row.startDate ||
      new Date(row.startDate as any).getTime() <= now.getTime()) &&
    (!row.endDate || new Date(row.endDate as any).getTime() >= now.getTime());
  const title = cleanText(row.title, "MealScout food deal");
  const canonicalPath = `/deal/${encodeURIComponent(`${toSlug(title) || row.id}--${row.id}`)}`;
  const cityState = [row.city, row.state]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const description = cleanText(
    row.description,
    `${title} from ${row.restaurantName || "a local MealScout restaurant"}${cityState ? ` in ${cityState}` : ""}.`,
  );

  return {
    title: `${title} - ${row.restaurantName || "MealScout"} | MealScout`,
    description,
    canonicalPath,
    imageUrl: row.imageUrl || defaultSocialImagePath,
    robots: active
      ? "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"
      : "noindex,follow",
    schema: {
      "@context": "https://schema.org",
      "@type": "Offer",
      name: title,
      description,
      url: absoluteUrl(baseUrl, canonicalPath),
      image: absoluteUrl(baseUrl, row.imageUrl || defaultSocialImagePath),
      validFrom: row.startDate
        ? new Date(row.startDate as any).toISOString()
        : undefined,
      validThrough: row.endDate
        ? new Date(row.endDate as any).toISOString()
        : undefined,
      availability: active
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      offeredBy: {
        "@type": "Restaurant",
        name: row.restaurantName || undefined,
        servesCuisine: row.cuisineType || undefined,
      },
    },
    links: [
      { label: "Open deal", href: canonicalPath },
      { label: "Featured deals", href: "/deals/featured" },
      { label: "Find food nearby", href: "/search" },
    ],
    body: [
      row.restaurantName ? `Restaurant: ${row.restaurantName}` : "",
      cityState ? `Area: ${cityState}` : "",
      row.discountValue
        ? `Discount: ${row.discountValue}${row.dealType === "percentage" ? "% off" : " off"}`
        : "",
    ].filter(Boolean),
  } satisfies PrerenderPage;
}

async function jobPage(_baseUrl: string, _jobId: string) {
  return null;
}

async function supplierPage(baseUrl: string, supplierId: string) {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);
  if (!row || !row.isActive) return null;
  const name = cleanText(row.businessName, "MealScout supplier");
  const cityState = [row.city, row.state]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const canonicalPath = `/supplier/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`;
  const description = `${name}${cityState ? ` in ${cityState}` : ""} is listed on MealScout Supply Scout for food businesses and operators.`;

  return {
    title: `${name}${cityState ? ` in ${cityState}` : ""} | MealScout Supplier`,
    description,
    canonicalPath,
    imageUrl: defaultSocialImagePath,
    schema: {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name,
      description,
      url: absoluteUrl(baseUrl, canonicalPath),
      telephone: row.contactPhone || undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: row.address || undefined,
        addressLocality: row.city || undefined,
        addressRegion: row.state || undefined,
        addressCountry: "US",
      },
    },
    links: [
      { label: "Open supplier", href: canonicalPath },
      { label: "Browse suppliers", href: "/suppliers" },
      { label: "Supply Scout", href: "/suppliers" },
    ],
    body: [
      cityState ? `Area: ${cityState}` : "",
      row.offersDelivery ? "Delivery available" : "",
    ].filter(Boolean),
  } satisfies PrerenderPage;
}

async function seoLandingPage(
  baseUrl: string,
  input: { path: string; title: string; description: string; links: PageLink[] },
) {
  return {
    title: `${input.title} | MealScout`,
    description: input.description,
    canonicalPath: input.path,
    imageUrl: defaultSocialImagePath,
    schema: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: input.title,
      description: input.description,
      url: absoluteUrl(baseUrl, input.path),
    },
    links: input.links,
    body: [input.description],
  } satisfies PrerenderPage;
}

const sendPage = (
  baseUrl: string,
  res: Response,
  page: PrerenderPage | null,
) => {
  if (!page) {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      '<!DOCTYPE html><html><head><title>Not found | MealScout</title><meta name="robots" content="noindex,follow"></head><body>Not found</body></html>',
    );
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, max-age=120, s-maxage=900, stale-while-revalidate=86400",
  );
  res.send(buildHtml(baseUrl, page));
};

export function registerPublicProfilePrerenderRoutes(
  app: Express,
  canonicalBaseUrl: string,
) {
  const gate =
    (handler: (req: Request) => Promise<PrerenderPage | null>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      if (!shouldServePrerender(req)) return next();
      try {
        sendPage(canonicalBaseUrl, res, await handler(req));
      } catch (error) {
        console.error("[seo-prerender] failed", error);
        next();
      }
    };

  app.get(
    ["/restaurant/:id", "/restaurant/:id/:slug"],
    gate((req) => restaurantPage(canonicalBaseUrl, extractId(req.params.id))),
  );
  app.get(
    "/truck/:slug",
    gate((req) => restaurantPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    "/bar/:slug",
    gate((req) => restaurantPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    "/chef/:slug",
    gate((req) => restaurantPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    "/location/:slug",
    gate((req) => hostPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    ["/event/:slug", "/events/:slug"],
    gate((req) => eventPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    "/deal/:slug",
    gate((req) => dealPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    ["/jobs/:jobId", "/jobs/:jobId/:jobSlug"],
    gate((req) => jobPage(canonicalBaseUrl, extractId(req.params.jobId))),
  );
  app.get(
    ["/supplier/:slug", "/suppliers/:supplierId"],
    gate((req) =>
      supplierPage(
        canonicalBaseUrl,
        extractId(req.params.slug || req.params.supplierId),
      ),
    ),
  );
  app.get(
    ["/p/:profileType/:profileId", "/p/:profileType/:profileId/:profileSlug"],
    gate((req) => {
      const type = String(req.params.profileType || "").toLowerCase();
      const id = extractId(req.params.profileId);
      if (type === "restaurant" || type === "food_truck" || type === "truck") {
        return restaurantPage(canonicalBaseUrl, id);
      }
      if (type === "host" || type === "location") {
        return hostPage(canonicalBaseUrl, id);
      }
      if (type === "supplier") {
        return supplierPage(canonicalBaseUrl, id);
      }
      if (type === "event") {
        return eventPage(canonicalBaseUrl, id);
      }
      return Promise.resolve(null);
    }),
  );
  app.get(
    "/food-trucks-today/:city",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path: `/food-trucks-today/${encodeURIComponent(String(req.params.city || ""))}`,
        title: `Food trucks today in ${String(req.params.city || "").replace(/-/g, " ")}`,
        description: "Find local food trucks active today. Browse local profiles, menus, and nearby stops.",
        links: [{ label: "Open city food", href: `/city/${encodeURIComponent(String(req.params.city || ""))}/food` }],
      }),
    ),
  );
  app.get(
    "/deals-today/:city",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path: `/deals-today/${encodeURIComponent(String(req.params.city || ""))}`,
        title: `Deals today in ${String(req.params.city || "").replace(/-/g, " ")}`,
        description: "See local food deals active today and open the related business profiles.",
        links: [{ label: "Open city food", href: `/city/${encodeURIComponent(String(req.params.city || ""))}/food` }],
      }),
    ),
  );
  app.get(
    "/events-today/:city",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path: `/events-today/${encodeURIComponent(String(req.params.city || ""))}`,
        title: `Food events today in ${String(req.params.city || "").replace(/-/g, " ")}`,
        description: "Find food events happening today and open local profile pages from each listing.",
        links: [{ label: "Browse events", href: "/events/public" }],
      }),
    ),
  );
  app.get(
    "/city/:city/food",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path: `/city/${encodeURIComponent(String(req.params.city || ""))}/food`,
        title: `Places to eat in ${String(req.params.city || "").replace(/-/g, " ")}`,
        description: "Browse local food businesses and open their canonical MealScout profile pages.",
        links: [
          { label: "Food trucks today", href: `/food-trucks-today/${encodeURIComponent(String(req.params.city || ""))}` },
          { label: "Deals today", href: `/deals-today/${encodeURIComponent(String(req.params.city || ""))}` },
          { label: "Events today", href: `/events-today/${encodeURIComponent(String(req.params.city || ""))}` },
        ],
      }),
    ),
  );
  app.get(
    "/cuisine/:cuisine/:city?",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path:
          req.params.city
            ? `/cuisine/${encodeURIComponent(String(req.params.cuisine || ""))}/${encodeURIComponent(String(req.params.city || ""))}`
            : `/cuisine/${encodeURIComponent(String(req.params.cuisine || ""))}`,
        title: `${String(req.params.cuisine || "").replace(/-/g, " ")} food`,
        description: "Explore local cuisine pages and open canonical MealScout profiles for nearby options.",
        links: req.params.city
          ? [{ label: "Open city food", href: `/city/${encodeURIComponent(String(req.params.city || ""))}/food` }]
          : [{ label: "Open search", href: "/search" }],
      }),
    ),
  );
  app.get(
    "/locations-with-trucks/:city",
    gate((req) =>
      seoLandingPage(canonicalBaseUrl, {
        path: `/locations-with-trucks/${encodeURIComponent(String(req.params.city || ""))}`,
        title: `Locations with food trucks in ${String(req.params.city || "").replace(/-/g, " ")}`,
        description: "Find host locations with active truck activity and open location profile pages.",
        links: [{ label: "Open city food", href: `/city/${encodeURIComponent(String(req.params.city || ""))}/food` }],
      }),
    ),
  );
}

