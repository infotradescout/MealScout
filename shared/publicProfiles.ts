export type PublicProfileType =
  | "restaurant"
  | "truck"
  | "bar"
  | "location"
  | "host"
  | "supplier";

export type PublicCtaType = "internal" | "external" | "phone" | "map" | "menu";

export type PublicImageAsset = {
  url: string;
  source:
    | "cover_image"
    | "logo"
    | "gallery"
    | "google_photo"
    | "spot_image"
    | "fallback";
  lastVerifiedAt: string | null;
  publicApproved: boolean;
};

export type PublicCta = {
  label: string;
  href: string;
  type: PublicCtaType;
  safe: boolean;
};

export type PublicProfileSeo = {
  canonicalUrl: string;
  seoTitle: string;
  seoDescription: string;
  ogImageUrl: string | null;
  entityType: PublicProfileType;
  entityId: string;
  slug: string;
};

export type PublicRecommendationSummary = {
  total: number;
  likes: number;
  shares: number;
};

export type PublicReviewSummary = {
  count: number;
  rating: number | null;
};

export type PublicDealSummary = {
  totalActive: number;
};

export type PublicMenuItem = {
  name: string;
  priceLabel: string | null;
  description: string | null;
  imageUrl: string | null;
  featured: boolean;
};

export type PublicMenuSection = {
  name: string;
  items: PublicMenuItem[];
};

export type PublicTruckScheduleSummary = {
  nextWindowLabel: string | null;
  upcomingCount: number;
};

export type PublicRestaurantProfile = {
  id: string;
  profileType: "restaurant" | "truck" | "bar";
  displayName: string;
  slug: string;
  description: string | null;
  cuisineTags: string[];
  serviceType: string | null;
  addressPublicLabel: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceLabel: string | null;
  phonePublic: string | null;
  websiteUrl: string | null;
  socialLinks: {
    instagramUrl: string | null;
    facebookPageUrl: string | null;
    xUrl: string | null;
  };
  hours: string | null;
  openStatus: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  galleryImages: PublicImageAsset[];
  menuSections: PublicMenuSection[];
  menuLastUpdatedAt: string | null;
  menuImageUrl: string | null;
  menuPdfUrl: string | null;
  menuUrl: string | null;
  featuredMenuItems: string[];
  deals: PublicDealSummary;
  reviewSummary: PublicReviewSummary;
  recommendations: PublicRecommendationSummary;
  truckSchedule: PublicTruckScheduleSummary | null;
  cta: PublicCta[];
  seo: PublicProfileSeo;
};

export type PublicLocationProfile = {
  id: string;
  profileType: "location" | "host";
  displayName: string;
  slug: string;
  description: string | null;
  addressPublicLabel: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  spotImageUrl: string | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  amenities: string[];
  publicParkingSummary: string | null;
  foodTrucksNow: number | null;
  foodTrucksTonight: number | null;
  upcomingFoodTruckSlots: number | null;
  publicRules: string | null;
  socialLinks: {
    instagramUrl: string | null;
    facebookPageUrl: string | null;
    xUrl: string | null;
  };
  websiteUrl: string | null;
  cta: PublicCta[];
  seo: PublicProfileSeo;
};

export type PublicSupplierProfile = {
  id: string;
  profileType: "supplier";
  displayName: string;
  slug: string;
  description: string | null;
  addressPublicLabel: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  phonePublic: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  cta: PublicCta[];
  seo: PublicProfileSeo;
  activeProductCount: number;
};
