import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "../db";
import {
  deals,
  events,
  hosts,
  jobPostings,
  mediaAssets,
  restaurants,
  suppliers,
} from "@shared/schema";
import { shouldServePrerender } from "./botDetection";

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
      "/og-default.jpg",
  );

const resolveHostImage = (baseUrl: string, row: any) =>
  absoluteUrl(
    baseUrl,
    row.spotImageUrl ||
      row.facebookCoverUrl ||
      firstPhotoUrl(row.googlePhotos) ||
      "/og-default.jpg",
  );

async function publicVideosFor(
  ownerType: string,
  ownerId: string,
): Promise<PublicVideo[]> {
  try {
    return await db
      .select({
        title: mediaAssets.title,
        description: mediaAssets.description,
        fileUrl: mediaAssets.fileUrl,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        durationSeconds: mediaAssets.durationSeconds,
        createdAt: mediaAssets.createdAt,
        isFeatured: mediaAssets.isFeatured,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.ownerType, ownerType as any),
          eq(mediaAssets.ownerId, ownerId),
          eq(mediaAssets.mediaType, "video"),
          eq(mediaAssets.status, "active"),
          eq(mediaAssets.visibility, "public"),
          isNull(mediaAssets.deletedAt),
        ),
      )
      .orderBy(desc(mediaAssets.isFeatured), desc(mediaAssets.createdAt))
      .limit(3);
  } catch (error) {
    console.warn("[seo-prerender] media_assets unavailable", error);
    return [];
  }
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
    thumbnailUrl: absoluteUrl(baseUrl, video.thumbnailUrl || "/og-default.jpg"),
    uploadDate: video.createdAt
      ? new Date(video.createdAt as any).toISOString()
      : undefined,
    duration: video.durationSeconds
      ? `PT${Math.max(1, Number(video.durationSeconds || 0))}S`
      : undefined,
  }));

const buildHtml = (baseUrl: string, page: PrerenderPage) => {
  const canonicalUrl = absoluteUrl(baseUrl, page.canonicalPath);
  const image = absoluteUrl(baseUrl, page.imageUrl || "/og-default.jpg");
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
  <meta property="og:site_name" content="MealScout">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.title)}">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
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

  const name = cleanText(row.name, "MealScout business");
  const cityState = [row.city, row.state]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(", ");
  const isTruck = Boolean(row.isFoodTruck) || row.businessType === "food_truck";
  const isBar = row.businessType === "bar";
  const ownerType = isTruck ? "food_truck" : "restaurant";
  const canonicalPath = isTruck
    ? `/truck/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`
    : isBar
      ? `/bar/${encodeURIComponent(`${toSlug(name) || row.id}--${row.id}`)}`
      : `/restaurant/${encodeURIComponent(row.id)}/${encodeURIComponent(toSlug(name) || row.id)}`;
  const videos = await publicVideosFor(ownerType, row.id);
  const image = videos[0]?.thumbnailUrl || resolveRestaurantImage(baseUrl, row);
  const description = cleanText(
    row.description || row.facebookAbout,
    `${name}${cityState ? ` in ${cityState}` : ""} on MealScout. View profile details, specials, videos, and location information.`,
  );

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": isTruck ? "FoodTruck" : isBar ? "BarOrPub" : "Restaurant",
    name,
    description,
    url: absoluteUrl(baseUrl, canonicalPath),
    image,
    telephone: row.phone || row.googleFormattedPhone || undefined,
    servesCuisine: row.cuisineType || undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: row.address || undefined,
      addressLocality: row.city || undefined,
      addressRegion: row.state || undefined,
      addressCountry: "US",
    },
    aggregateRating:
      row.googleRating && row.googleReviewCount
        ? {
            "@type": "AggregateRating",
            ratingValue: Number(row.googleRating),
            reviewCount: Number(row.googleReviewCount),
          }
        : undefined,
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
    schema: [localBusiness, ...videoSchemas(baseUrl, videos, name)],
    links: [
      { label: "Open profile", href: canonicalPath },
      { label: "Find food nearby", href: "/find-food" },
      { label: "MealScout map", href: "/map" },
    ],
    body: [
      row.cuisineType ? `Cuisine: ${row.cuisineType}` : "",
      cityState ? `Area: ${cityState}` : "",
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
      { label: "Book parking", href: "/parking-pass" },
      { label: "Find food trucks", href: "/map" },
    ],
    body: [
      row.locationType ? `Location type: ${row.locationType}` : "",
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
    imageUrl: videos[0]?.thumbnailUrl || "/og-default.jpg",
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
    imageUrl: row.imageUrl || "/og-default.jpg",
    robots: active
      ? "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"
      : "noindex,follow",
    schema: {
      "@context": "https://schema.org",
      "@type": "Offer",
      name: title,
      description,
      url: absoluteUrl(baseUrl, canonicalPath),
      image: absoluteUrl(baseUrl, row.imageUrl || "/og-default.jpg"),
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
      { label: "Find food nearby", href: "/find-food" },
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

async function jobPage(baseUrl: string, jobId: string) {
  const [row] = await db
    .select({
      id: jobPostings.id,
      restaurantId: jobPostings.restaurantId,
      title: jobPostings.title,
      roleType: jobPostings.roleType,
      employmentType: jobPostings.employmentType,
      description: jobPostings.description,
      requirements: jobPostings.requirements,
      scheduleDescription: jobPostings.scheduleDescription,
      compensationLabel: jobPostings.compensationLabel,
      payMinCents: jobPostings.payMinCents,
      payMaxCents: jobPostings.payMaxCents,
      locationLabel: jobPostings.locationLabel,
      city: jobPostings.city,
      state: jobPostings.state,
      positionsAvailable: jobPostings.positionsAvailable,
      createdAt: jobPostings.createdAt,
      updatedAt: jobPostings.updatedAt,
      expiresAt: jobPostings.expiresAt,
      restaurantName: restaurants.name,
      restaurantBusinessType: restaurants.businessType,
      restaurantAddress: restaurants.address,
      restaurantCity: restaurants.city,
      restaurantState: restaurants.state,
      restaurantWebsiteUrl: restaurants.websiteUrl,
      restaurantLogoUrl: restaurants.logoUrl,
    })
    .from(jobPostings)
    .innerJoin(restaurants, eq(restaurants.id, jobPostings.restaurantId))
    .where(
      and(
        eq(jobPostings.id, jobId),
        eq(jobPostings.status, "open"),
        or(isNull(jobPostings.expiresAt), gt(jobPostings.expiresAt, new Date())),
        eq(restaurants.isActive, true),
      ),
    )
    .limit(1);

  if (!row) return null;

  const title = cleanText(row.title, "MealScout job");
  const restaurantName = cleanText(row.restaurantName, "MealScout business");
  const city = cleanText(row.city || row.restaurantCity);
  const state = cleanText(row.state || row.restaurantState);
  const cityState = [city, state].filter(Boolean).join(", ");
  const pay = payRangeLabel(row);
  const canonicalPath = `/jobs/${encodeURIComponent(row.id)}/${encodeURIComponent(
    toSlug(`${restaurantName} ${title}`) || row.id,
  )}`;
  const description = cleanText(
    row.description,
    `Apply for ${title} at ${restaurantName}${cityState ? ` in ${cityState}` : ""}.`,
  );
  const descriptionHtml = [
    paragraph(description),
    paragraph(
      row.requirements ? `Helpful experience: ${row.requirements}` : null,
    ),
    paragraph(
      row.scheduleDescription ? `Schedule: ${row.scheduleDescription}` : null,
    ),
    paragraph(pay ? `Pay: ${pay}` : null),
    paragraph(
      row.positionsAvailable && row.positionsAvailable > 1
        ? `Openings: ${row.positionsAvailable}`
        : null,
    ),
    "<p>Apply directly on this MealScout job page.</p>",
  ]
    .filter(Boolean)
    .join("");

  return {
    title: `${title} at ${restaurantName}${cityState ? ` in ${cityState}` : ""} | MealScout Jobs`,
    description: `${description}${pay ? ` ${pay}.` : ""}`,
    canonicalPath,
    imageUrl: row.restaurantLogoUrl || "/og-default.jpg",
    schema: {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title,
      description: descriptionHtml,
      identifier: {
        "@type": "PropertyValue",
        name: "MealScout",
        value: row.id,
      },
      datePosted: isoDate(row.createdAt || row.updatedAt),
      validThrough: isoDate(row.expiresAt),
      directApply: true,
      employmentType: employmentTypeForSchema(row.employmentType),
      occupationalCategory: labelize(row.roleType) || "Food service",
      industry: "Food service",
      hiringOrganization: {
        "@type": "Organization",
        name: restaurantName,
        sameAs:
          externalUrl(row.restaurantWebsiteUrl) ||
          absoluteUrl(
            baseUrl,
            `/restaurant/${encodeURIComponent(row.restaurantId)}/${encodeURIComponent(
              toSlug(restaurantName) || row.restaurantId,
            )}`,
          ),
        logo: row.restaurantLogoUrl
          ? absoluteUrl(baseUrl, row.restaurantLogoUrl)
          : undefined,
      },
      jobLocation: {
        "@type": "Place",
        name: row.locationLabel || restaurantName,
        address: {
          "@type": "PostalAddress",
          streetAddress: row.restaurantAddress || undefined,
          addressLocality: city || undefined,
          addressRegion: state || undefined,
          addressCountry: "US",
        },
      },
      baseSalary: baseSalarySchema(row),
      url: absoluteUrl(baseUrl, canonicalPath),
    },
    links: [
      { label: "Apply for this job", href: canonicalPath },
      { label: "Browse MealScout jobs", href: "/jobs" },
      {
        label: `Open ${restaurantName}`,
        href: `/restaurant/${encodeURIComponent(row.restaurantId)}/${encodeURIComponent(
          toSlug(restaurantName) || row.restaurantId,
        )}`,
      },
    ],
    body: [
      `Business: ${restaurantName}`,
      cityState ? `Location: ${cityState}` : row.locationLabel || "",
      labelize(row.employmentType)
        ? `Employment type: ${labelize(row.employmentType)}`
        : "",
      pay ? `Pay: ${pay}` : "",
      row.scheduleDescription ? `Schedule: ${row.scheduleDescription}` : "",
      row.requirements ? `Helpful experience: ${row.requirements}` : "",
      row.positionsAvailable && row.positionsAvailable > 1
        ? `Openings: ${row.positionsAvailable}`
        : "",
      "Applications are accepted directly on MealScout.",
    ].filter(Boolean),
  } satisfies PrerenderPage;
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
    imageUrl: "/og-default.jpg",
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
    "/location/:slug",
    gate((req) => hostPage(canonicalBaseUrl, extractId(req.params.slug))),
  );
  app.get(
    "/event/:slug",
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
}
