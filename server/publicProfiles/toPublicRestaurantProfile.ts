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

  const ctas = [
    buildPublicCta({ label: "View details", href: canonicalPath, type: "internal" }),
    buildPublicCta({ label: "View menu", href: row.menuUrl, type: "menu" }),
    buildPublicCta({
      label: "Get directions",
      href:
        row.latitude != null && row.longitude != null
          ? `https://maps.google.com/?q=${row.latitude},${row.longitude}`
          : null,
      type: "map",
    }),
    buildPublicCta({ label: "Call", href: phonePublic ? `tel:${phonePublic}` : null, type: "phone" }),
    buildPublicCta({ label: "Website", href: row.websiteUrl, type: "external" }),
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
    websiteUrl: String(row.websiteUrl || "").trim() || null,
    socialLinks: {
      instagramUrl: String(row.instagramUrl || "").trim() || null,
      facebookPageUrl: String(row.facebookPageUrl || "").trim() || null,
      xUrl: String(row.xUrl || "").trim() || null,
    },
    hours: null,
    openStatus: null,
    coverImageUrl,
    logoUrl,
    galleryImages: [
      imageAsset(coverImageUrl, "cover_image"),
      imageAsset(logoUrl, "logo"),
    ].filter(Boolean) as PublicRestaurantProfile["galleryImages"],
    menuUrl: String(row.menuUrl || "").trim() || null,
    featuredMenuItems: [],
    deals: { totalActive: 0 },
    reviewSummary: { count: 0, rating: null },
    recommendations: { total: 0, likes: 0, shares: 0 },
    truckSchedule:
      profileType === "truck" ? { nextWindowLabel: null, upcomingCount: 0 } : null,
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
