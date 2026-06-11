import type { PublicLocationProfile } from "@shared/publicProfiles";
import { toPublicProfileSeo } from "./toPublicProfileSeo";
import {
  buildPublicCta,
  buildPublicProfilePath,
  imageAsset,
  joinedAddressLabel,
  toSlug,
} from "./publicProfileUtils";

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
  const canonicalPath = buildPublicProfilePath({
    entityType: "location",
    name: displayName,
    id,
  });
  const spotImageUrl = String(row.spotImageUrl || "").trim() || null;
  const coverImageUrl = String(row.coverImageUrl || "").trim() || null;
  const logoUrl = String(row.logoUrl || "").trim() || null;
  const addressPublicLabel =
    input.showAddress === false
      ? null
      : joinedAddressLabel(row.address, row.city, row.state);
  const contactPhone =
    input.showContact === false ? null : String(row.contactPhone || "").trim() || null;
  const websiteUrl = String(row.websiteUrl || "").trim() || null;
  const instagramUrl = String(row.instagramUrl || "").trim() || null;
  const facebookPageUrl = String(row.facebookPageUrl || "").trim() || null;
  const xUrl = String(row.xUrl || "").trim() || null;

  const ctas = [
    buildPublicCta({ label: "View location", href: canonicalPath, type: "internal" }),
    buildPublicCta({ label: "See food here", href: canonicalPath, type: "internal", priority: 95 }),
    buildPublicCta({
      label: "Get directions",
      href:
        row.latitude != null && row.longitude != null
          ? `https://maps.google.com/?q=${row.latitude},${row.longitude}`
          : null,
      type: "map",
      priority: 100,
    }),
    buildPublicCta({ label: "Call", href: contactPhone ? `tel:${contactPhone}` : null, type: "phone", priority: 90 }),
    buildPublicCta({ label: "Website", href: websiteUrl, type: "external", priority: 86 }),
    buildPublicCta({ label: "Instagram", href: instagramUrl, type: "social", priority: 82 }),
    buildPublicCta({ label: "Facebook", href: facebookPageUrl, type: "social", priority: 81 }),
    buildPublicCta({ label: "X", href: xUrl, type: "social", priority: 78 }),
    buildPublicCta({
      label: "Share",
      href: `${input.baseUrl.replace(/\/$/, "")}${canonicalPath}`,
      type: "share",
      priority: 70,
    }),
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
    verifiedProfile: Boolean(
      row.verifiedProfile ??
        row.isVerified ??
        row.profileVerified ??
        row.claimVerified ??
        false,
    ),
    locallyOwned: Boolean(
      row.locallyOwned ?? row.isLocallyOwned ?? row.localOwned ?? false,
    ),
    amenities: [],
    publicParkingSummary: null,
    foodTrucksNow: null,
    foodTrucksTonight: null,
    upcomingFoodTruckSlots: null,
    publicRules: null,
    socialLinks: {
      instagramUrl,
      facebookPageUrl,
      xUrl,
    },
    websiteUrl,
    events: {
      totalUpcoming: Math.max(
        0,
        Number(row.upcomingEventCount ?? row.eventsCount ?? 0) || 0,
      ),
      items: Array.isArray(row.eventsItems) ? row.eventsItems.slice(0, 8) : [],
    },
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
