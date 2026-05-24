import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { toPublicProfileSeo } from "./toPublicProfileSeo";
import { buildPublicCta, imageAsset, joinedAddressLabel, toSlug } from "./publicProfileUtils";

export function toPublicRestaurantProfile(input: {
  row: any;
  baseUrl: string;
  profileType?: "restaurant" | "truck" | "bar";
  showAddress?: boolean;
  showContact?: boolean;
}): PublicRestaurantProfile {
  const row = input.row || {};
  const profileType =
    input.profileType ||
    (row.isFoodTruck || row.businessType === "food_truck"
      ? "truck"
      : row.businessType === "bar"
        ? "bar"
        : "restaurant");
  const id = String(row.id || "");
  const displayName = String(row.name || "MealScout business");
  const slug = toSlug(displayName) || id;
  const canonicalPath = `/p/${profileType}/${id}/${slug}`;
  const coverImageUrl = String(row.coverImageUrl || "").trim() || null;
  const logoUrl = String(row.logoUrl || "").trim() || null;
  const addressPublicLabel =
    input.showAddress === false
      ? null
      : joinedAddressLabel(row.address, row.city, row.state);
  const phonePublic =
    input.showContact === false ? null : String(row.phone || "").trim() || null;
  const menuUrl = String(row.menuUrl || "").trim() || null;
  const menuImageUrl = String(row.menuImageUrl || "").trim() || null;
  const menuPdfUrl = String(row.menuPdfUrl || "").trim() || null;
  const websiteUrl = String(row.websiteUrl || "").trim() || null;
  const instagramUrl = String(row.instagramUrl || "").trim() || null;
  const facebookPageUrl = String(row.facebookPageUrl || "").trim() || null;
  const xUrl = String(row.xUrl || "").trim() || null;
  const hoursValue =
    String(
      row.hours ||
        row.businessHours ||
        row.hoursSummary ||
        row.openHours ||
        "",
    ).trim() || null;
  const openStatusValue =
    String(
      row.openStatus ||
        row.currentOpenStatus ||
        row.statusLabel ||
        row.businessOpenStatus ||
        "",
    ).trim() || null;
  const nextWindowLabelValue =
    String(
      row.nextWindowLabel ||
        row.nextServiceWindow ||
        row.truckNextWindowLabel ||
        "",
    ).trim() || null;
  const upcomingCountValue = Number(
    row.upcomingCount ?? row.upcomingScheduleCount ?? row.truckUpcomingCount ?? 0,
  );
  const featuredMenuItemsRaw = Array.isArray(row.featuredMenuItems)
    ? row.featuredMenuItems
    : Array.isArray(row.menuHighlights)
      ? row.menuHighlights
      : Array.isArray(row.featuredItems)
        ? row.featuredItems
        : [];
  const featuredMenuItems = featuredMenuItemsRaw
    .map((item: unknown) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const menuSectionsRaw = Array.isArray(row.menuSections) ? row.menuSections : [];
  const menuSections = menuSectionsRaw
    .map((section: any) => {
      const sectionName = String(section?.name || "").trim();
      const itemsRaw = Array.isArray(section?.items) ? section.items : [];
      const items = itemsRaw
        .map((item: any) => {
          const itemName = String(item?.name || "").trim();
          if (!itemName) return null;
          const priceValue = Number(item?.priceCents);
          const priceLabel = Number.isFinite(priceValue)
            ? `$${(priceValue / 100).toFixed(2)}`
            : null;
          return {
            name: itemName,
            priceLabel,
            description: String(item?.description || "").trim() || null,
            imageUrl: String(item?.imageUrl || "").trim() || null,
            featured: Boolean(item?.featured),
          };
        })
        .filter(Boolean)
        .slice(0, 24) as PublicRestaurantProfile["menuSections"][number]["items"];
      if (!sectionName || items.length === 0) return null;
      return {
        name: sectionName,
        items,
      };
    })
    .filter(Boolean) as PublicRestaurantProfile["menuSections"];
  const menuLastUpdatedAt = row.menuLastUpdatedAt
    ? new Date(row.menuLastUpdatedAt).toISOString()
    : null;
  const dealCount = Math.max(
    0,
    Number(
      row.dealCount ??
        row.activeDealCount ??
        row.totalActiveDeals ??
        row.dealsCount ??
        0,
    ) || 0,
  );
  const dealItemsRaw = Array.isArray(row.dealsItems) ? row.dealsItems : [];
  const dealItems = dealItemsRaw
    .map((item: any) => {
      const id = String(item?.id || "").trim();
      const title = String(item?.title || "").trim();
      const actionHref = String(item?.actionHref || "").trim();
      if (!id || !title || !actionHref) return null;
      const dealTypeRaw = String(item?.dealType || "other")
        .trim()
        .toLowerCase()
        .replace(/[^a-z_]/g, "_");
      const normalizedDealType = (
        [
          "daily",
          "happy_hour",
          "lunch",
          "family_meal",
          "limited_time",
          "coupon",
          "other",
        ] as const
      ).includes(dealTypeRaw as any)
        ? (dealTypeRaw as
            | "daily"
            | "happy_hour"
            | "lunch"
            | "family_meal"
            | "limited_time"
            | "coupon"
            | "other")
        : "other";
      const actionTypeRaw = String(item?.actionType || "show_this_deal")
        .trim()
        .toLowerCase()
        .replace(/[^a-z_]/g, "_");
      const normalizedActionType = (
        ["call", "show_this_deal", "order", "website", "menu", "internal"] as const
      ).includes(actionTypeRaw as any)
        ? (actionTypeRaw as
            | "call"
            | "show_this_deal"
            | "order"
            | "website"
            | "menu"
            | "internal")
        : "show_this_deal";
      return {
        id,
        title,
        description: String(item?.description || "").trim() || null,
        dealType: normalizedDealType,
        startAt: String(item?.startAt || "").trim() || null,
        endAt: String(item?.endAt || "").trim() || null,
        timeWindowLabel: String(item?.timeWindowLabel || "").trim() || null,
        imageUrl: String(item?.imageUrl || "").trim() || null,
        actionLabel: String(item?.actionLabel || "").trim() || "View deal",
        actionHref,
        actionType: normalizedActionType,
      };
    })
    .filter(Boolean)
    .slice(0, 8) as PublicRestaurantProfile["deals"]["items"];
  const reviewCount = Math.max(
    0,
    Number(
      row.reviewCount ??
        row.totalReviews ??
        row.ratingsCount ??
        row.googleReviewCount ??
        0,
    ) || 0,
  );
  const reviewRatingRaw = Number(
    row.reviewRating ??
      row.rating ??
      row.avgRating ??
      row.googleRating ??
      Number.NaN,
  );
  const reviewRating = Number.isFinite(reviewRatingRaw) ? reviewRatingRaw : null;
  const recommendationTotal = Math.max(
    0,
    Number(
      row.recommendationCount ??
        row.totalRecommendations ??
        row.recommendationsCount ??
        0,
    ) || 0,
  );
  const recommendationLikes = Math.max(
    0,
    Number(row.recommendationLikeCount ?? row.recommendationLikes ?? 0) || 0,
  );
  const recommendationShares = Math.max(
    0,
    Number(row.recommendationShareCount ?? row.recommendationShares ?? 0) || 0,
  );

  const ctas = [
    buildPublicCta({ label: "Profile", href: canonicalPath, type: "internal" }),
    buildPublicCta({ label: "Menu", href: menuUrl, type: "menu" }),
    buildPublicCta({
      label: "Get directions",
      href:
        row.latitude != null && row.longitude != null
          ? `https://maps.google.com/?q=${row.latitude},${row.longitude}`
          : null,
      type: "map",
    }),
    buildPublicCta({ label: "Call", href: phonePublic ? `tel:${phonePublic}` : null, type: "phone" }),
    buildPublicCta({ label: "Website", href: websiteUrl, type: "external" }),
    buildPublicCta({ label: "Instagram", href: instagramUrl, type: "external" }),
    buildPublicCta({ label: "Facebook", href: facebookPageUrl, type: "external" }),
    buildPublicCta({ label: "X", href: xUrl, type: "external" }),
  ].filter(Boolean) as PublicRestaurantProfile["cta"];

  return {
    id,
    profileType,
    displayName,
    slug,
    description: String(row.description || "").trim() || null,
    cuisineTags: String(row.cuisineType || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    serviceType: String(row.businessType || "").trim() || null,
    addressPublicLabel,
    city: String(row.city || "").trim() || null,
    state: String(row.state || "").trim() || null,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
    distanceLabel: null,
    phonePublic,
    websiteUrl,
    socialLinks: {
      instagramUrl,
      facebookPageUrl,
      xUrl,
    },
    hours: hoursValue,
    openStatus: openStatusValue,
    coverImageUrl,
    logoUrl,
    galleryImages: [
      imageAsset(coverImageUrl, "cover_image"),
      imageAsset(logoUrl, "logo"),
    ].filter(Boolean) as PublicRestaurantProfile["galleryImages"],
    menuSections,
    menuLastUpdatedAt,
    menuImageUrl,
    menuPdfUrl,
    menuUrl,
    featuredMenuItems,
    deals: {
      totalActive: Math.max(dealCount, dealItems.length),
      items: dealItems,
    },
    reviewSummary: { count: reviewCount, rating: reviewRating },
    recommendations: {
      total: recommendationTotal,
      likes: recommendationLikes,
      shares: recommendationShares,
    },
    truckSchedule:
      profileType === "truck"
        ? {
            status: String(row?.truckSchedule?.status || "unknown") as any,
            statusLabel:
              String(row?.truckSchedule?.statusLabel || "").trim() || null,
            lastUpdatedAt:
              String(row?.truckSchedule?.lastUpdatedAt || "").trim() || null,
            notice: String(row?.truckSchedule?.notice || "").trim() || null,
            currentStop: row?.truckSchedule?.currentStop || null,
            todayStop: row?.truckSchedule?.todayStop || null,
            nextStop: row?.truckSchedule?.nextStop || null,
            upcomingStops: Array.isArray(row?.truckSchedule?.upcomingStops)
              ? row.truckSchedule.upcomingStops
              : [],
            nextWindowLabel:
              String(row?.truckSchedule?.nextWindowLabel || "").trim() ||
              nextWindowLabelValue ||
              null,
            upcomingCount: Math.max(
              0,
              Number(
                row?.truckSchedule?.upcomingCount ??
                  upcomingCountValue ??
                  0,
              ) || 0,
            ),
          }
        : null,
    cta: ctas,
    seo: toPublicProfileSeo({
      baseUrl: input.baseUrl,
      entityType: profileType,
      entityId: id,
      slug,
      canonicalPath,
      title: displayName,
      description: String(row.description || "").trim() || null,
      ogImageUrl: coverImageUrl || logoUrl,
    }),
  };
}
