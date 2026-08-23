import type { PublicLocationProfile } from "@shared/publicProfiles";
import { toPublicProfileSeo } from "./toPublicProfileSeo";
import {
  buildPublicCta,
  buildPublicDirectionsUrl,
  buildPublicProfilePath,
  imageAsset,
  joinedAddressLabel,
  normalizePublicUrl,
  resolvePublicCoordinatePair,
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
  const spotImageUrl = normalizePublicUrl(row.spotImageUrl, {
    allowInternalPath: true,
  });
  const coverImageUrl = normalizePublicUrl(row.coverImageUrl, {
    allowInternalPath: true,
  });
  const logoUrl = normalizePublicUrl(row.logoUrl, {
    allowInternalPath: true,
  });
  const addressPublicLabel =
    input.showAddress === false
      ? null
      : joinedAddressLabel(row.address, row.city, row.state);
  const publicCoordinatePair =
    input.showAddress !== false
      ? resolvePublicCoordinatePair(row.latitude, row.longitude)
      : null;
  const publicLatitude = publicCoordinatePair?.latitude ?? null;
  const publicLongitude = publicCoordinatePair?.longitude ?? null;
  const contactPhone =
    input.showContact === false ? null : String(row.contactPhone || "").trim() || null;
  const websiteUrl =
    input.showContact === false ? null : normalizePublicUrl(row.websiteUrl);
  const instagramUrl =
    input.showContact === false ? null : normalizePublicUrl(row.instagramUrl);
  const facebookPageUrl =
    input.showContact === false
      ? null
      : normalizePublicUrl(row.facebookPageUrl);
  const xUrl =
    input.showContact === false ? null : normalizePublicUrl(row.xUrl);
  const cityState = [row.city, row.state]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  const publicDescription = `${displayName}${cityState ? ` in ${cityState}` : ""} is a MealScout host location for food truck parking and events.`;

  const ctas = [
    buildPublicCta({ label: "View location", href: canonicalPath, type: "internal" }),
    buildPublicCta({ label: "See food here", href: canonicalPath, type: "internal", priority: 95 }),
    buildPublicCta({
      label: "Get directions",
      href: buildPublicDirectionsUrl({
        latitude: publicLatitude,
        longitude: publicLongitude,
        addressPublicLabel: String(row.address || "").trim()
          ? addressPublicLabel
          : null,
      }),
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
    description: publicDescription,
    addressPublicLabel,
    city: String(row.city || "").trim() || null,
    state: String(row.state || "").trim() || null,
    latitude: publicLatitude,
    longitude: publicLongitude,
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
      description: publicDescription,
      ogImageUrl: spotImageUrl || coverImageUrl || logoUrl,
    }),
  };
}
