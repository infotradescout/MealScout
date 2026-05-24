import type { PublicLocationProfile } from "@shared/publicProfiles";
import { toPublicProfileSeo } from "./toPublicProfileSeo";
import { buildPublicCta, imageAsset, joinedAddressLabel, toSlug } from "./publicProfileUtils";

export function toPublicLocationProfile(input: {
  row: any;
  baseUrl: string;
  showAddress?: boolean;
  showContact?: boolean;
}): PublicLocationProfile {
  const row = input.row || {};
  const id = String(row.id || "");
  const displayName = String(row.businessName || "MealScout location");
  const slug = toSlug(displayName) || id;
  const canonicalPath = `/p/location/${id}/${slug}`;
  const spotImageUrl = String(row.spotImageUrl || "").trim() || null;
  const coverImageUrl = String(row.coverImageUrl || "").trim() || null;
  const logoUrl = String(row.logoUrl || "").trim() || null;
  const addressPublicLabel =
    input.showAddress === false
      ? null
      : joinedAddressLabel(row.address, row.city, row.state);
  const contactPhone =
    input.showContact === false ? null : String(row.contactPhone || "").trim() || null;

  const ctas = [
    buildPublicCta({ label: "View location", href: canonicalPath, type: "internal" }),
    buildPublicCta({
      label: "Get directions",
      href:
        row.latitude != null && row.longitude != null
          ? `https://maps.google.com/?q=${row.latitude},${row.longitude}`
          : null,
      type: "map",
    }),
    buildPublicCta({ label: "Call", href: contactPhone ? `tel:${contactPhone}` : null, type: "phone" }),
  ].filter(Boolean) as PublicLocationProfile["cta"];

  return {
    id,
    profileType: "location",
    displayName,
    slug,
    description: String(row.notes || row.description || "").trim() || null,
    addressPublicLabel,
    city: String(row.city || "").trim() || null,
    state: String(row.state || "").trim() || null,
    latitude: Number.isFinite(Number(row.latitude)) ? Number(row.latitude) : null,
    longitude: Number.isFinite(Number(row.longitude)) ? Number(row.longitude) : null,
    spotImageUrl,
    coverImageUrl,
    logoUrl,
    amenities: [],
    publicParkingSummary: null,
    foodTrucksNow: null,
    foodTrucksTonight: null,
    upcomingFoodTruckSlots: null,
    publicRules: null,
    socialLinks: {
      instagramUrl: null,
      facebookPageUrl: null,
      xUrl: null,
    },
    websiteUrl: String(row.websiteUrl || "").trim() || null,
    cta: ctas,
    seo: toPublicProfileSeo({
      baseUrl: input.baseUrl,
      entityType: "location",
      entityId: id,
      slug,
      canonicalPath,
      title: displayName,
      description: String(row.notes || row.description || "").trim() || null,
      ogImageUrl: spotImageUrl || coverImageUrl || logoUrl,
    }),
  };
}
