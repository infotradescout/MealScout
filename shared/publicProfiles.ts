export type PublicProfileType =
  | "restaurant"
  | "truck"
  | "bar"
  | "location"
  | "host"
  | "supplier";

export type PublicCtaType =
  | "internal"
  | "external"
  | "phone"
  | "map"
  | "menu"
  | "order"
  | "social"
  | "catering"
  | "booking"
  | "share";

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
  priority?: number;
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
  items: PublicDealItem[];
};

export type PublicDealItem = {
  id: string;
  title: string;
  description: string | null;
  dealType:
    | "daily"
    | "happy_hour"
    | "lunch"
    | "family_meal"
    | "limited_time"
    | "coupon"
    | "other";
  startAt: string | null;
  endAt: string | null;
  timeWindowLabel: string | null;
  imageUrl: string | null;
  actionLabel: string;
  actionHref: string;
  actionType: "call" | "show_this_deal" | "order" | "website" | "menu" | "internal";
};

export type PublicEventSummary = {
  totalUpcoming: number;
  items: PublicEventItem[];
};

export type PublicEventItem = {
  id: string;
  title: string;
  description: string | null;
  eventType:
    | "live_music"
    | "trivia"
    | "karaoke"
    | "pop_up"
    | "food_truck_night"
    | "watch_party"
    | "holiday"
    | "other";
  startsAt: string | null;
  endsAt: string | null;
  dateLabel: string | null;
  timeWindowLabel: string | null;
  locationName: string | null;
  addressPublicLabel: string | null;
  imageUrl: string | null;
  actionLabel: string;
  actionHref: string;
  actionType: "rsvp" | "share" | "website" | "directions" | "internal";
};

export type PublicMenuItem = {
  menuItemId?: string | null;
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

export type PublicMenuVariant = {
  id: string;
  name: string;
  serviceType: string | null;
  menuSections: PublicMenuSection[];
  menuLastUpdatedAt: string | null;
  menuUrl: string | null;
};

export type PublicTruckScheduleSummary = {
  status:
    | "scheduled"
    | "here_now"
    | "completed"
    | "canceled"
    | "moved"
    | "sold_out"
    | "closed_early"
    | "unknown";
  statusLabel: string | null;
  lastUpdatedAt: string | null;
  notice: string | null;
  currentStop: PublicTruckScheduleStop | null;
  todayStop: PublicTruckScheduleStop | null;
  nextStop: PublicTruckScheduleStop | null;
  upcomingStops: PublicTruckScheduleStop[];
  nextWindowLabel: string | null;
  upcomingCount: number;
};

export type PublicTruckScheduleStop = {
  stopId: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  timeWindowLabel: string | null;
  locationName: string | null;
  addressPublicLabel: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  hostProfilePath: string | null;
  directionsUrl: string | null;
  status:
    | "scheduled"
    | "here_now"
    | "completed"
    | "canceled"
    | "moved"
    | "sold_out"
    | "closed_early";
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
  verifiedProfile: boolean;
  locallyOwned: boolean;
  menuSections: PublicMenuSection[];
  menuVariants: PublicMenuVariant[];
  activeMenuId: string | null;
  menuContextNote: string | null;
  menuLastUpdatedAt: string | null;
  menuImageUrl: string | null;
  menuPdfUrl: string | null;
  menuUrl: string | null;
  featuredMenuItems: string[];
  deals: PublicDealSummary;
  events: PublicEventSummary;
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
  verifiedProfile: boolean;
  locallyOwned: boolean;
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
  events: PublicEventSummary;
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
