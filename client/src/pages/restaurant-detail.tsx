import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { RestaurantTrustPanel } from "@/components/RestaurantTrustPanel";
import {
  FlagRecommendationDialog,
  FlagProfileContentDialog,
} from "@/components/moderation/FlagDialogs";
import {
  ArrowLeft,
  Flame,
  List,
  MapPin,
  Phone,
  Clock,
  Shield,
  Navigation as DirectionsIcon,
  Heart,
  CheckCircle,
  Store,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Star,
  Globe,
  ExternalLink,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { MinimalFAQ } from "@/components/seo-faq";
import {
  AdminEditableText,
  AdminEditButton,
} from "@/components/admin-inline-copy";
import { generateRestaurantSchema } from "@/lib/schema-helpers";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ShareButton from "@/components/share-button";
import DocumentUpload from "@/components/document-upload";
import {
  ParkingScheduleCalendar,
  type ParkingScheduleItem,
} from "@/components/parking-schedule-calendar";
import PublicVideoGallery from "@/components/PublicVideoGallery";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { resolveBusinessImageUrl } from "@/lib/business-images";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PublicRecommendation = {
  id: string;
  userId: string;
  createdAt?: string;
  updatedAt?: string;
  sentimentScore100: number;
  menuItemName: string | null;
  authorName: string;
  likeCount: number;
  dislikeCount: number;
  shareCount: number;
  viewerReaction: "like" | "dislike" | null;
};

type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
};

type PublicMenuCategory = {
  id: string;
  name: string;
  items: PublicMenuItem[];
};

type PublicMenu = {
  id: string;
  name: string;
  isActive: boolean;
  categories: PublicMenuCategory[];
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const toExternalUrl = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return raw;
  return `https://${raw}`;
};

const parseCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toPhoneHref = (value: string | null | undefined) => {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : "";
};

const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

export default function RestaurantDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const [location, setLocation] = useLocation();
  const restaurantId = params.id || extractUuidFromSlug(params.slug);
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
  const [failedHeroImageSrc, setFailedHeroImageSrc] = useState<string | null>(
    null,
  );
  const [bookingForm, setBookingForm] = useState({
    name: "",
    email: user?.email || "",
    phone: "",
    expectedGuests: "",
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    notes: "",
  });
  const [claimDocuments, setClaimDocuments] = useState<string[]>([]);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);

  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants", restaurantId],
    enabled: !!restaurantId,
  });

  const { data: trustStats } = useQuery({
    queryKey: ["restaurant-trust", restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/restaurants/${restaurantId}/trust-stats`,
      );
      if (!response.ok) return null;
      return response.json() as Promise<{
        profileAccuracyScore?: number;
      }>;
    },
  });

  const { data: featuredDeals = [] } = useQuery({
    queryKey: ["/api/deals/restaurant", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const res = await fetch(
        `/api/deals/restaurant/${encodeURIComponent(String(restaurantId || ""))}`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
  });
  const { data: publicMenusData } = useQuery<{
    menus: PublicMenu[];
    orderingEnabled: boolean;
  }>({
    queryKey: ["/api/menus", restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/menus/${encodeURIComponent(String(restaurantId || ""))}`,
      );
      if (!res.ok) return { menus: [], orderingEnabled: false };
      const data = await res.json();
      return {
        menus: Array.isArray(data?.menus) ? data.menus : [],
        orderingEnabled: Boolean(data?.orderingEnabled),
      };
    },
  });
  const { data: recommendationRows = [], refetch: refetchRecommendations } =
    useQuery<PublicRecommendation[]>({
      queryKey: ["/api/restaurants", restaurantId, "recommendations-public"],
      enabled: !!restaurantId,
      retry: false,
      queryFn: async () => {
        const response = await fetch(
          `/api/restaurants/${restaurantId}/recommendations/public?limit=16`,
          { credentials: "include" },
        );
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      },
    });

  const claimGeneratedProfileMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Missing restaurant");
      const response = await apiRequest(
        "POST",
        `/api/restaurants/${encodeURIComponent(String(restaurantId))}/claim-generated`,
        { documents: claimDocuments, source: "restaurant-detail" },
      );
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      await queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/restaurants", restaurantId],
      });
      toast({
        title: "Profile claimed",
        description:
          "This page is now attached to your MealScout account. Verification is queued for review.",
      });
      setClaimDocuments([]);
      window.location.assign(
        `/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(String(restaurantId || ""))}&src=claim&showOnboardingPrompt=1&goLive=1`,
      );
    },
    onError: (error: any) => {
      toast({
        title: "Could not claim profile",
        description:
          error?.message ||
          "This profile may already be attached to another owner.",
        variant: "destructive",
      });
    },
  });

  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";

  const isFoodTruck =
    (restaurant as any)?.isFoodTruck ||
    (restaurant as any)?.businessType === "food_truck";

  const restaurantNameForSlug = String((restaurant as any)?.name || "").trim();
  const expectedRestaurantSlug = toSlug(restaurantNameForSlug);

  useEffect(() => {
    if (!restaurantId || !restaurant || !expectedRestaurantSlug) return;

    const canonicalPath = `/restaurant/${restaurantId}/${expectedRestaurantSlug}`;
    const currentPath = window.location.pathname.replace(/\/+$/, "");
    const legacyPath = `/restaurant/${restaurantId}`;
    const normalizedCanonicalPath = canonicalPath.replace(/\/+$/, "");

    if (currentPath === normalizedCanonicalPath) return;
    if (
      currentPath === legacyPath ||
      currentPath.startsWith(`${legacyPath}/`)
    ) {
      setLocation(`${canonicalPath}${window.location.search || ""}`);
    }
  }, [restaurantId, restaurant, expectedRestaurantSlug, setLocation]);

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery({
    queryKey: ["/api/bookings/truck", restaurantId, "schedule"],
    enabled: !!restaurantId && !!isFoodTruck,
    queryFn: async () => {
      const res = await fetch(`/api/bookings/truck/${restaurantId}/schedule`);
      if (!res.ok) {
        throw new Error("Failed to load schedule");
      }
      return res.json();
    },
  });

  const scheduleItems = Array.isArray(scheduleData?.schedule)
    ? scheduleData.schedule
    : [];
  const parkingScheduleItems: ParkingScheduleItem[] = scheduleItems
    .filter(
      (item: any) =>
        item.type === "manual" ||
        (item.type === "booking" && item.event?.requiresPayment),
    )
    .map((item: any) => {
      if (item.type === "manual") {
        return {
          id: `manual-${item.manual.id}`,
          manualId: item.manual.id,
          date: item.manual.date,
          startTime: item.manual.startTime,
          endTime: item.manual.endTime,
          title: item.manual.locationName || "Manual stop",
          subtitle: [item.manual.address, item.manual.city, item.manual.state]
            .filter(Boolean)
            .join(", "),
          type: "manual" as const,
          isPublic: true,
          lastConfirmedAt:
            item.manual.lastConfirmedAt || item.createdAt || null,
        };
      }

      return {
        id: `booking-${item.event.id}-${item.slotType || "slot"}`,
        date: item.event.date,
        startTime: item.event.startTime,
        endTime: item.event.endTime,
        title: item.host?.businessName || "Parking Pass",
        subtitle: item.host?.address || "",
        type: "booking" as const,
        slotLabel: item.slotType
          ? formatSlotSummary(String(item.slotType))
          : null,
        isPublic: true,
        lastConfirmedAt:
          item.event.lastConfirmedAt ||
          item.bookingConfirmedAt ||
          item.createdAt ||
          null,
      };
    });
  const formatSlotSummary = (value: string) =>
    value
      .split(",")
      .map((slot) => slot.trim())
      .filter(Boolean)
      .map((slot) => slot.charAt(0).toUpperCase() + slot.slice(1))
      .join(", ");

  const handleBookingFieldChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setBookingForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmitBookingRequest = async () => {
    if (!restaurantId) return;
    setIsSubmittingBooking(true);
    try {
      const res = await fetch(`/api/trucks/${restaurantId}/booking-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to send request");
      }

      toast({
        title: "Request sent",
        description: "The truck owner will follow up by email.",
      });

      setBookingForm({
        name: "",
        email: user?.email || "",
        phone: "",
        expectedGuests: "",
        date: "",
        startTime: "",
        endTime: "",
        location: "",
        notes: "",
      });
    } catch (error: any) {
      toast({
        title: "Request failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  const handleRecommendationReaction = async (
    recommendationId: string,
    current: "like" | "dislike" | null,
    next: "like" | "dislike",
  ) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    try {
      await apiRequest(
        "POST",
        `/api/recommendations/${recommendationId}/reaction`,
        {
          reaction: current === next ? "clear" : next,
        },
      );
      await refetchRecommendations();
    } catch (error: any) {
      toast({
        title: "Could not save reaction",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRecommendationShare = async (recommendationId: string) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    try {
      const shareUrl = `${window.location.origin}${profilePath}?rec=${recommendationId}`;
      const shareText = `Check out this community recommendation for ${restaurantName} on MealScout`;
      if (navigator.share) {
        await navigator.share({
          title: `${restaurantName} recommendation`,
          text: shareText,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      }

      await apiRequest(
        "POST",
        `/api/recommendations/${recommendationId}/share`,
        {},
      );
      await refetchRecommendations();
    } catch {
      // Ignore user-cancelled share actions.
    }
  };

  if (restaurantLoading) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="animate-pulse">
          <div className="w-full h-64 bg-muted"></div>
          <div className="p-6 space-y-4">
            <div className="h-8 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-20 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <h2 className="text-xl font-bold mb-4">Restaurant not found</h2>
          <Link href="/">
            <Button>Back to Home</Button>
          </Link>
        </div>
        <Navigation />
      </div>
    );
  }

  // Deals endpoint is restaurant-scoped already.
  const restaurantDeals = Array.isArray(featuredDeals) ? featuredDeals : [];
  const activeOnsiteMenus = Array.isArray(publicMenusData?.menus)
    ? publicMenusData.menus.filter((menu) => menu?.isActive)
    : [];
  const primaryOnsiteMenu = activeOnsiteMenus[0] || null;
  const onsiteMenuCategories = Array.isArray(primaryOnsiteMenu?.categories)
    ? primaryOnsiteMenu.categories
    : [];
  const hasOnsiteMenu = onsiteMenuCategories.length > 0;
  const onsiteMenuUrl = hasOnsiteMenu
    ? `/menu/${encodeURIComponent(String(restaurantId || ""))}`
    : "";
  const onsiteOrderingEnabled = Boolean(
    publicMenusData?.orderingEnabled && hasOnsiteMenu,
  );
  const isVerifiedMemberProfile =
    Boolean((restaurant as any)?.isVerified) &&
    Boolean((restaurant as any)?.isActive);
  const isGeneratedProfile =
    String((restaurant as any)?.profileSource || "") === "google" ||
    Boolean((restaurant as any)?.googlePlaceId);

  const cvsScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(Number((trustStats as any)?.profileAccuracyScore ?? 50)),
    ),
  );
  const recommendationCount = recommendationRows.length;

  const rightActions = (
    <Button
      variant="ghost"
      size="icon"
      className="bg-[var(--bg-card)]/90 backdrop-blur-sm"
      data-testid="button-save-restaurant"
    >
      <Heart className="w-4 h-4" />
    </Button>
  );

  const restaurantName = (restaurant as any)?.name || "Restaurant";
  const profileSlug = toSlug(restaurantName) || String(restaurantId || "");
  const profilePath = `/restaurant/${restaurantId}/${profileSlug}`;
  const claimBusinessPath = `/restaurant-signup?businessType=${encodeURIComponent(
    isFoodTruck ? "food_truck" : "restaurant",
  )}&claim=1&claimRestaurantId=${encodeURIComponent(String(restaurantId || ""))}&q=${encodeURIComponent(restaurantName)}&redirect=${encodeURIComponent(
    profilePath,
  )}`;
  const editRestaurantPath = `/edit-restaurant/${restaurantId}`;
  const editRestaurantFocusPath = (focus: string) =>
    `${editRestaurantPath}?src=concierge&focus=${encodeURIComponent(focus)}`;
  const dealCreationPath = `/deal-creation?restaurantId=${encodeURIComponent(String(restaurantId || ""))}&src=concierge`;
  const cuisineType = (restaurant as any)?.cuisineType || "food";
  const address = (restaurant as any)?.address || "";
  const phoneNumber =
    (restaurant as any)?.phone ||
    (restaurant as any)?.googleFormattedPhone ||
    "";
  const city = String((restaurant as any)?.city || "").trim();
  const state = String((restaurant as any)?.state || "").trim();
  const locationLabel = [city, state].filter(Boolean).join(", ");
  const customDomainHost = String((restaurant as any)?.customDomainHost || "")
    .trim()
    .toLowerCase();
  const canonicalProfileUrl = customDomainHost
    ? `https://${customDomainHost}`
    : `https://www.mealscout.us${profilePath}`;
  const orderPrimaryUrl = toExternalUrl(
    (restaurant as any)?.orderUrl ||
      (restaurant as any)?.orderURL ||
      (restaurant as any)?.onlineOrderUrl ||
      (restaurant as any)?.onlineOrderingUrl,
  );
  const externalMenuUrl = toExternalUrl(
    (restaurant as any)?.menuUrl || (restaurant as any)?.menuURL,
  );
  const menuPrimaryUrl = onsiteMenuUrl || externalMenuUrl;
  const menuPrimaryIsInternal = Boolean(onsiteMenuUrl);
  const websitePrimaryUrl = toExternalUrl(
    (restaurant as any)?.websiteUrl || (restaurant as any)?.website,
  );
  const googleRating = Number((restaurant as any)?.googleRating || 0);
  const googleReviewCount = Number((restaurant as any)?.googleReviewCount || 0);
  const canClaimGeneratedProfile =
    !isVerifiedMemberProfile && isGeneratedProfile;

  useEffect(() => {
    if (!user || !canClaimGeneratedProfile) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("claim") === "1") {
        setClaimDialogOpen(true);
      }
    } catch {
      // ignore malformed query strings
    }
  }, [canClaimGeneratedProfile, location, user]);
  const phoneHref = toPhoneHref(phoneNumber);
  const profileTypeLabel = isFoodTruck
    ? "Food Truck"
    : String(cuisineType || "Restaurant");
  const normalizedAddress = String(address || "").toLowerCase();
  const addressAlreadyIncludesCity = city
    ? normalizedAddress.includes(city.toLowerCase())
    : false;
  const addressAlreadyIncludesState = state
    ? normalizedAddress.includes(state.toLowerCase())
    : false;
  const locationDisplay = [
    address,
    addressAlreadyIncludesCity ? "" : city,
    addressAlreadyIncludesState ? "" : state,
  ]
    .filter(Boolean)
    .join(", ");
  const lat = parseCoordinate(
    (restaurant as any)?.currentLatitude ?? (restaurant as any)?.latitude,
  );
  const lng = parseCoordinate(
    (restaurant as any)?.currentLongitude ?? (restaurant as any)?.longitude,
  );
  const hasCoords = lat !== null && lng !== null;
  const locationImageQuery = [restaurantName, locationDisplay || address]
    .filter(Boolean)
    .join(", ");
  const heroImageSrc = resolveBusinessImageUrl({
    uploaded: [
      (restaurant as any)?.coverImageUrl,
      (restaurant as any)?.facebookCoverUrl,
      (restaurant as any)?.logoUrl,
    ],
    googlePhotos: (restaurant as any)?.googlePhotos,
    locationQuery: locationImageQuery,
  });
  const hasHeroImage = Boolean(
    heroImageSrc && failedHeroImageSrc !== heroImageSrc,
  );
  const mapsDestination = (restaurant as any)?.googlePlaceId
    ? `place_id:${(restaurant as any).googlePlaceId}`
    : hasCoords
      ? `${lat},${lng}`
      : [restaurantName, locationDisplay || address].filter(Boolean).join(", ");
  const directionsUrl = mapsDestination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        mapsDestination,
      )}${(restaurant as any)?.googlePlaceId ? `&destination_place_id=${encodeURIComponent((restaurant as any).googlePlaceId)}` : ""}`
    : "";
  const primaryDeal = restaurantDeals[0] as any | undefined;
  const popularMenuItems = onsiteMenuCategories
    .flatMap((category) =>
      Array.isArray(category.items) ? category.items : [],
    )
    .filter((item) => item?.isAvailable !== false)
    .slice(0, 3);
  const nextStop = parkingScheduleItems[0];
  const locationTitle = isFoodTruck ? "Today's Location" : "Location";
  const locationName = nextStop?.title || locationDisplay || locationLabel;
  const locationSubtitle = nextStop?.subtitle || "";
  const hoursLabel =
    nextStop?.startTime && nextStop?.endTime
      ? `${nextStop.startTime} - ${nextStop.endTime}`
      : "";
  const description = `${restaurantName}${locationLabel ? ` in ${locationLabel}` : ""} offers ${cuisineType} with live specials, current hours, and direct links for menu and ordering. ${restaurantDeals.length} active special${restaurantDeals.length === 1 ? "" : "s"} listed on MealScout.`;

  const getPopularItemAction = (itemName: string) => {
    const normalizedName = itemName.toLowerCase().trim();
    if (normalizedName.includes("full menu")) {
      if (menuPrimaryUrl) {
        return {
          type: menuPrimaryIsInternal ? "internal" : "external",
          href: menuPrimaryUrl,
        };
      }
      return { type: "scroll", targetId: "restaurant-specials" };
    }
    if (normalizedName.includes("special")) {
      return { type: "scroll", targetId: "restaurant-specials-list" };
    }
    if (normalizedName.includes("visit") || normalizedName.includes("order")) {
      if (orderPrimaryUrl) return { type: "external", href: orderPrimaryUrl };
      if (onsiteOrderingEnabled && onsiteMenuUrl) {
        return { type: "internal", href: onsiteMenuUrl };
      }
      if (websitePrimaryUrl)
        return { type: "external", href: websitePrimaryUrl };
      if (directionsUrl) return { type: "external", href: directionsUrl };
      if (phoneHref) return { type: "external", href: phoneHref };
    }
    return null;
  };

  const popularItemRowClass =
    "flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-text)]";

  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: restaurantName,
    description: description,
    address: {
      "@type": "PostalAddress",
      streetAddress: address,
    },
    telephone: (restaurant as any)?.phone || "",
    servesCuisine: cuisineType,
    url: canonicalProfileUrl,
    additionalProperty: isVerifiedMemberProfile
      ? [
          {
            "@type": "PropertyValue",
            name: "Community Verification Score",
            value: cvsScore,
            unitText: "out of 100",
          },
        ]
      : [],
  };

  const profileWebPageSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${restaurantName} profile`,
    url: canonicalProfileUrl,
    dateModified: (restaurant as any)?.updatedAt || undefined,
    about: {
      "@type": isFoodTruck ? "FoodTruck" : "Restaurant",
      name: restaurantName,
      identifier: restaurantId,
    },
    isPartOf: {
      "@type": "WebSite",
      name: "MealScout",
      url: "https://www.mealscout.us",
    },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "MealScout",
        item: "https://www.mealscout.us/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: locationLabel ? `${locationLabel} Food & Trucks` : "Restaurants",
        item: locationLabel
          ? `https://www.mealscout.us/search?location=${encodeURIComponent(locationLabel)}`
          : "https://www.mealscout.us/search",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: restaurantName,
        item: canonicalProfileUrl,
      },
    ],
  };

  return (
    <div className="max-w-md lg:max-w-3xl mx-auto min-h-screen relative pb-24 text-white">
      <SEOHead
        title={`${restaurantName}${locationLabel ? ` in ${locationLabel}` : ""} | Menu, Deals & Hours`}
        description={description}
        keywords={`${restaurantName}, ${cuisineType}, ${locationLabel || "local"} restaurant, menu, specials, order online, food truck`}
        canonicalUrl={canonicalProfileUrl}
        allowCanonicalHostOverride={Boolean(customDomainHost)}
        ogType="restaurant"
        ogImage={heroImageSrc || undefined}
        schemaData={[
          localBusinessSchema,
          profileWebPageSchema,
          breadcrumbSchema,
        ]}
      />
      {isStaffOrAdmin ? (
        <div className="sticky top-0 z-40 border-b border-amber-400/30 bg-zinc-950/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-xs text-white">
            <div className="flex min-w-0 items-center gap-2">
              <Shield className="h-4 w-4 shrink-0 text-amber-300" />
              <span className="shrink-0 font-semibold text-amber-200">
                Admin preview
              </span>
              <span className="truncate text-white/70">
                Public restaurant profile
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href={editRestaurantPath as any}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-white/15 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
                >
                  Edit
                </Button>
              </Link>
              <Link href="/admin/dashboard?tab=restaurants">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-white/15 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
                >
                  Admin
                </Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
      <section
        className={`relative overflow-hidden ${hasHeroImage ? "min-h-[24rem] bg-black" : "bg-transparent"}`}
      >
        {hasHeroImage ? (
          <img
            src={heroImageSrc}
            alt={`${restaurantName} exterior or food photo`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            onError={() => setFailedHeroImageSrc(heroImageSrc || null)}
          />
        ) : null}
        {hasHeroImage ? (
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.25)_32%,rgba(0,0,0,0.94)_100%)]" />
        ) : null}

        <div
          className={`relative z-10 flex flex-col px-5 pb-5 pt-[calc(1rem+env(safe-area-inset-top))] ${hasHeroImage ? "min-h-[24rem] justify-between" : "gap-6"}`}
        >
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/15 bg-black/40 text-white backdrop-blur hover:bg-black/55"
              onClick={() =>
                window.history.length > 1
                  ? window.history.back()
                  : setLocation("/")
              }
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full border border-white/15 bg-black/40 text-white backdrop-blur hover:bg-black/55"
              data-testid="button-save-restaurant"
              aria-label="Save restaurant"
            >
              <Heart className="h-5 w-5" />
            </Button>
          </div>

          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[color:var(--accent-text)]/45 bg-black/35 px-3 py-2 text-xs font-bold text-[color:var(--accent-text)] backdrop-blur">
              <Star className="h-4 w-4" />
              {isVerifiedMemberProfile ? "Crowd Favorite" : "Local listing"}
            </div>
            <h1
              className="max-w-[22rem] text-3xl font-black uppercase leading-[0.95] tracking-normal sm:text-5xl"
              data-testid="text-restaurant-name"
            >
              {restaurantName}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-white/85">
              <span>{profileTypeLabel}</span>
              {cuisineType && cuisineType !== profileTypeLabel ? (
                <>
                  <span>•</span>
                  <span>{cuisineType}</span>
                </>
              ) : null}
              {hasCoords ? (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-[color:var(--accent-text)]" />
                    Nearby
                  </span>
                </>
              ) : null}
              {hoursLabel ? (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1 text-[color:var(--status-success)]">
                    <span className="h-2 w-2 rounded-full bg-[color:var(--status-success)]" />
                    {hoursLabel}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 -mt-2 space-y-4 px-4 pb-8 sm:px-5">
        <div className="grid grid-cols-3 gap-3">
          <Button
            asChild={Boolean(directionsUrl)}
            variant="outline"
            disabled={!directionsUrl}
            className="h-12 rounded-full border-white/15 bg-black/35 text-white hover:bg-white/10"
            data-testid="button-directions"
          >
            {directionsUrl ? (
              <a href={directionsUrl} target="_blank" rel="noreferrer">
                <DirectionsIcon className="mr-2 h-4 w-4" />
                Directions
              </a>
            ) : (
              <>
                <DirectionsIcon className="mr-2 h-4 w-4" />
                Directions
              </>
            )}
          </Button>
          {menuPrimaryUrl ? (
            menuPrimaryIsInternal ? (
              <Link href={menuPrimaryUrl}>
                <Button className="h-12 w-full rounded-full bg-[color:var(--accent-text)] font-black text-black hover:bg-[color:var(--accent-text)]/90">
                  <List className="mr-2 h-4 w-4" />
                  Menu
                </Button>
              </Link>
            ) : (
              <a href={menuPrimaryUrl} target="_blank" rel="noreferrer">
                <Button className="h-12 w-full rounded-full bg-[color:var(--accent-text)] font-black text-black hover:bg-[color:var(--accent-text)]/90">
                  <List className="mr-2 h-4 w-4" />
                  Menu
                </Button>
              </a>
            )
          ) : (
            <Button
              className="h-12 rounded-full bg-[color:var(--accent-text)] font-black text-black hover:bg-[color:var(--accent-text)]/90"
              onClick={() =>
                document
                  .getElementById("restaurant-specials")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              <List className="mr-2 h-4 w-4" />
              Menu
            </Button>
          )}
          <ShareButton
            url={profilePath}
            title={`Check out ${restaurantName} on MealScout`}
            description={
              (restaurant as any)?.description ||
              "Discover this location on MealScout."
            }
            size="default"
            variant="outline"
            className="h-12 rounded-full border-white/15 bg-black/35 text-white hover:bg-white/10"
          />
        </div>

        {!isVerifiedMemberProfile ? (
          <div className="rounded-2xl border border-amber-500/45 bg-amber-500/10 p-4">
            <p className="text-sm font-black text-amber-300">
              Unclaimed listing
            </p>
            <p className="mt-1 text-xs text-amber-100/85">
              Business details may be incomplete until the owner claims and
              verifies this page.
            </p>
            <div className="mt-3">
              {user && canClaimGeneratedProfile ? (
                <Dialog
                  open={claimDialogOpen}
                  onOpenChange={setClaimDialogOpen}
                >
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      className="bg-amber-500 font-semibold text-black hover:bg-amber-600"
                    >
                      Request to Claim
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Verify your business claim</DialogTitle>
                      <DialogDescription>
                        Upload a business license, health permit, seller permit,
                        insurance certificate, tax document, or other document
                        that connects you to this business.
                      </DialogDescription>
                    </DialogHeader>
                    <DocumentUpload
                      onDocumentsChange={setClaimDocuments}
                      maxFiles={5}
                      maxFileSize={10 * 1024 * 1024}
                    />
                    <DialogFooter>
                      <Button
                        className="bg-amber-500 font-semibold text-black hover:bg-amber-600"
                        disabled={
                          claimGeneratedProfileMutation.isPending ||
                          claimDocuments.length === 0
                        }
                        onClick={() => claimGeneratedProfileMutation.mutate()}
                      >
                        {claimGeneratedProfileMutation.isPending
                          ? "Submitting..."
                          : "Submit Claim for Review"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : (
                <Link
                  href={claimBusinessPath as any}
                  onClick={() => {
                    try {
                      window.sessionStorage.setItem(
                        "mealscout:pending-claim-path",
                        `${profilePath}?claim=1`,
                      );
                    } catch {
                      // ignore storage errors
                    }
                  }}
                >
                  <Button
                    size="sm"
                    className="bg-amber-500 font-semibold text-black hover:bg-amber-600"
                  >
                    Request to Claim
                  </Button>
                </Link>
              )}
            </div>
          </div>
        ) : null}

        {locationName || locationSubtitle ? (
          <section className="rounded-3xl border border-white/10 bg-[#111112] p-4 shadow-clean">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem] sm:items-center">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[color:var(--accent-text)]">
                  <MapPin className="h-5 w-5" />
                  <h2 className="text-lg font-black uppercase tracking-normal">
                    {locationTitle}
                  </h2>
                </div>
                {locationName ? (
                  <p className="text-lg font-semibold text-white">
                    {locationName}
                  </p>
                ) : null}
                {locationSubtitle ? (
                  <p className="mt-1 text-sm text-white/70">
                    {locationSubtitle}
                  </p>
                ) : null}
                {hoursLabel ? (
                  <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[color:var(--status-success)]">
                    <Clock className="h-4 w-4 text-[color:var(--accent-text)]" />
                    {hoursLabel}
                  </p>
                ) : null}
              </div>
              {hasCoords ? (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative min-h-[7.5rem] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(30,41,59,0.95),rgba(2,6,23,0.95))]"
                >
                  <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.09)_1px,transparent_1px)] [background-size:22px_22px]" />
                  <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[color:var(--accent-text)] text-black shadow-xl">
                    <MapPin className="h-7 w-7 fill-current" />
                  </div>
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {primaryDeal ? (
          <section className="rounded-3xl border border-white/10 bg-[#111112] p-4 shadow-clean">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem] sm:items-center">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[color:var(--accent-text)]">
                  <Star className="h-5 w-5" />
                  <h2 className="text-lg font-black uppercase tracking-normal">
                    Tonight's Special
                  </h2>
                </div>
                <p className="text-lg font-semibold text-white">
                  {primaryDeal.title || "Special"}
                </p>
                {primaryDeal.discountValue || primaryDeal.description ? (
                  <p className="mt-1 text-sm text-white/75">
                    {primaryDeal.discountValue
                      ? primaryDeal.dealType === "percentage"
                        ? `${primaryDeal.discountValue}% off`
                        : `$${primaryDeal.discountValue} off`
                      : primaryDeal.description}
                  </p>
                ) : null}
              </div>
              {primaryDeal.imageUrl ? (
                <div className="min-h-[6.5rem] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                  <img
                    src={primaryDeal.imageUrl}
                    alt={primaryDeal.title || `${restaurantName} special`}
                    className="h-full min-h-[6.5rem] w-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {popularMenuItems.length > 0 ? (
          <section className="rounded-3xl border border-white/10 bg-[#111112] p-4 shadow-clean">
            <div className="mb-3 flex items-center gap-2 text-[color:var(--accent-text)]">
              <Flame className="h-5 w-5" />
              <h2 className="text-lg font-black uppercase tracking-normal">
                Popular Items
              </h2>
            </div>
            <div className="divide-y divide-white/10">
              {popularMenuItems.map((item) => {
                const itemAction = getPopularItemAction(item.name);
                const rowContent = (
                  <>
                    <div>
                      <p className="font-semibold text-white">{item.name}</p>
                      {item.description ? (
                        <p className="text-xs text-white/55">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                    {itemAction ? (
                      <ExternalLink className="h-4 w-4 shrink-0 text-white/55" />
                    ) : (
                      <p className="text-sm font-semibold text-white/70">
                        {formatMoney(item.priceCents)}
                      </p>
                    )}
                  </>
                );

                if (itemAction?.type === "internal" && itemAction.href) {
                  return (
                    <Link
                      key={item.id}
                      href={itemAction.href as any}
                      className={popularItemRowClass}
                    >
                      {rowContent}
                    </Link>
                  );
                }

                if (itemAction?.type === "external" && itemAction.href) {
                  return (
                    <a
                      key={item.id}
                      href={itemAction.href}
                      target={
                        itemAction.href.startsWith("http")
                          ? "_blank"
                          : undefined
                      }
                      rel={
                        itemAction.href.startsWith("http")
                          ? "noreferrer noopener"
                          : undefined
                      }
                      className={popularItemRowClass}
                    >
                      {rowContent}
                    </a>
                  );
                }

                if (itemAction?.type === "scroll") {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={popularItemRowClass}
                      onClick={() =>
                        document
                          .getElementById(itemAction.targetId || "")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      {rowContent}
                    </button>
                  );
                }

                return (
                  <div key={item.id} className={popularItemRowClass}>
                    {rowContent}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {isStaffOrAdmin ? (
          <details className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-amber-100">
              Admin tools
            </summary>
            <p className="mt-1 text-xs text-amber-100/70">
              Public page preview for {restaurantName}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={editRestaurantFocusPath("description") as any}>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/15 bg-black/35 text-white hover:bg-white/10"
                >
                  Edit profile
                </Button>
              </Link>
              {isFoodTruck ? (
                <Link href={editRestaurantFocusPath("parking") as any}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/15 bg-black/35 text-white hover:bg-white/10"
                  >
                    Edit parking schedule
                  </Button>
                </Link>
              ) : null}
              <Link href={dealCreationPath as any}>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/15 bg-black/35 text-white hover:bg-white/10"
                >
                  Edit specials
                </Button>
              </Link>
            </div>
          </details>
        ) : null}

        {isFoodTruck ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button className="h-12 w-full rounded-full bg-[color:var(--accent-text)] font-black text-black hover:bg-[color:var(--accent-text)]/90">
                Book This Truck
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Book {restaurantName}</DialogTitle>
                <DialogDescription>
                  Share your event details and the truck owner will follow up.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label htmlFor="name">Your Name</Label>
                  <Input
                    id="name"
                    name="name"
                    value={bookingForm.name}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={bookingForm.email}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    value={bookingForm.phone}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="expectedGuests">Expected Guests</Label>
                  <Input
                    id="expectedGuests"
                    name="expectedGuests"
                    value={bookingForm.expectedGuests}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    name="date"
                    type="date"
                    value={bookingForm.date}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="startTime">Start Time</Label>
                  <Input
                    id="startTime"
                    name="startTime"
                    type="time"
                    value={bookingForm.startTime}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    name="endTime"
                    type="time"
                    value={bookingForm.endTime}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    name="location"
                    value={bookingForm.location}
                    onChange={handleBookingFieldChange}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={bookingForm.notes}
                    onChange={handleBookingFieldChange}
                    rows={4}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleSubmitBookingRequest}
                  disabled={isSubmittingBooking}
                >
                  {isSubmittingBooking ? "Sending..." : "Send Request"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}

        {phoneHref ? (
          <Button
            asChild
            variant="outline"
            className="h-12 w-full rounded-full border-white/15 bg-black/35 text-white hover:bg-white/10"
          >
            <a href={phoneHref}>
              <Phone className="mr-2 h-4 w-4" />
              Call
            </a>
          </Button>
        ) : null}
      </div>

      {/* Menu + Specials */}
      <section
        className="mb-8 rounded-3xl border border-[color:var(--border-subtle)] bg-[linear-gradient(160deg,rgba(10,10,14,0.98),rgba(17,17,22,0.96))] p-5 sm:p-6 shadow-clean"
        id="restaurant-specials"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] uppercase text-[color:var(--accent-text)]">
              Start Here
            </p>
            <div className="mt-1 inline-flex items-center gap-2">
              <h2 className="text-2xl font-black text-white">
                <AdminEditableText
                  textKey="restaurant.detail.menu.title"
                  defaultText="Menu"
                />
              </h2>
              <AdminEditButton
                textKey="restaurant.detail.menu.title"
                defaultText="Menu"
                label="Menu section title"
              />
            </div>
            <p className="mt-1 text-sm text-white/70">
              See signature dishes and pricing before you visit.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:w-auto w-full">
            {orderPrimaryUrl ? (
              <a href={orderPrimaryUrl} target="_blank" rel="noreferrer">
                <Button className="w-full sm:w-auto min-w-[13rem] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  Order Online
                </Button>
              </a>
            ) : onsiteOrderingEnabled ? (
              <Link href={onsiteMenuUrl}>
                <Button className="w-full sm:w-auto min-w-[13rem] bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                  Order Online
                </Button>
              </Link>
            ) : null}
            {menuPrimaryUrl ? (
              menuPrimaryIsInternal ? (
                <Link href={menuPrimaryUrl}>
                  <Button className="w-full sm:w-auto min-w-[13rem] bg-orange-600 hover:bg-orange-700 text-white font-semibold">
                    View Full Menu
                  </Button>
                </Link>
              ) : (
                <a href={menuPrimaryUrl} target="_blank" rel="noreferrer">
                  <Button className="w-full sm:w-auto min-w-[13rem] bg-orange-600 hover:bg-orange-700 text-white font-semibold">
                    View Full Menu
                  </Button>
                </a>
              )
            ) : websitePrimaryUrl ? (
              <a href={websitePrimaryUrl} target="_blank" rel="noreferrer">
                <Button className="w-full sm:w-auto min-w-[13rem] bg-orange-600 hover:bg-orange-700 text-white font-semibold">
                  <Globe className="mr-2 h-4 w-4" />
                  Visit Website
                </Button>
              </a>
            ) : (
              <Button
                variant="outline"
                disabled
                className="w-full sm:w-auto min-w-[13rem] font-semibold"
              >
                Menu Coming Soon
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full sm:w-auto border-white/20 bg-white/5 text-white hover:bg-white/10"
              onClick={() =>
                document
                  .getElementById("restaurant-specials-list")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Browse Current Specials
            </Button>
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/80">
              Deals & Specials
            </h3>
            {restaurantDeals.length > 0 ? (
              <Badge
                variant="outline"
                className="border-white/20 text-white/80"
              >
                {restaurantDeals.length} live
              </Badge>
            ) : null}
          </div>

          {restaurantDeals.length > 0 ? (
            <Carousel
              opts={{ align: "start", loop: restaurantDeals.length > 2 }}
              className="w-full"
            >
              <CarouselContent className="-ml-3">
                {restaurantDeals.map((deal: any) => (
                  <CarouselItem
                    key={deal.id}
                    className="pl-3 basis-[88%] sm:basis-1/2 lg:basis-1/3"
                  >
                    <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-[color:var(--accent-text)]">
                        {String(deal.category || "deal").toLowerCase() ===
                        "special"
                          ? "Special"
                          : "Deal"}
                      </p>
                      <h4 className="mt-1 line-clamp-2 text-base font-semibold text-white">
                        {deal.title || "Special offer"}
                      </h4>
                      {deal.description ? (
                        <p className="mt-2 line-clamp-3 text-sm text-white/70">
                          {deal.description}
                        </p>
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {deal.discountValue ? (
                          <Badge className="bg-[color:var(--accent-text)] text-black hover:bg-[color:var(--accent-text)]">
                            {deal.dealType === "percentage"
                              ? `${deal.discountValue}% off`
                              : `$${deal.discountValue} off`}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-white/20 text-white/75"
                          >
                            Limited time
                          </Badge>
                        )}
                        <Link href={`/deal/${deal.id}`}>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs"
                          >
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {restaurantDeals.length > 1 ? (
                <>
                  <CarouselPrevious className="left-2 h-8 w-8 border-white/20 bg-black/60 text-white hover:bg-black/80" />
                  <CarouselNext className="right-2 h-8 w-8 border-white/20 bg-black/60 text-white hover:bg-black/80" />
                </>
              ) : null}
            </Carousel>
          ) : (
            <Card className="border-white/10 bg-white/[0.03]">
              <CardContent className="p-4 text-sm text-white/70">
                No current specials available. Check back soon.
              </CardContent>
            </Card>
          )}
        </div>

        {hasOnsiteMenu ? (
          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/80">
                Full Onsite Menu
              </h3>
              <Link
                href={`/menu/${encodeURIComponent(String(restaurantId || ""))}`}
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                >
                  Open Menu Page
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {onsiteMenuCategories.map((category) => (
                <div
                  key={category.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <h4 className="text-base font-semibold text-white">
                    {category.name}
                  </h4>
                  <div className="mt-3 space-y-3">
                    {(Array.isArray(category.items) ? category.items : []).map(
                      (item) => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">
                              {item.name}
                            </p>
                            {item.description ? (
                              <p className="mt-0.5 text-xs text-white/65">
                                {item.description}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-[color:var(--accent-text)]">
                              {formatMoney(item.priceCents)}
                            </p>
                            {!item.isAvailable ? (
                              <p className="text-[11px] text-amber-300">
                                Unavailable
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {isFoodTruck && (
        <div className="mb-8 rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-clean">
          <div className="mb-4 inline-flex items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">
              <AdminEditableText
                textKey="restaurant.detail.parking.title"
                defaultText="Parking Schedule"
              />
            </h2>
            {isStaffOrAdmin ? (
              <Link href={editRestaurantFocusPath("parking") as any}>
                <Button size="sm" variant="outline">
                  Manage Schedule
                </Button>
              </Link>
            ) : (
              <AdminEditButton
                textKey="restaurant.detail.parking.title"
                defaultText="Parking Schedule"
                label="Parking schedule title"
              />
            )}
          </div>
          {scheduleLoading ? (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-6 text-center text-muted-foreground">
                Loading schedule...
              </CardContent>
            </Card>
          ) : parkingScheduleItems.length > 0 ? (
            <ParkingScheduleCalendar
              items={parkingScheduleItems}
              subtitle="Auto-updated by Parking Pass bookings and public manual stops."
            />
          ) : (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-6 text-center text-muted-foreground">
                <AdminEditableText
                  textKey="restaurant.detail.parking.empty"
                  defaultText="No upcoming parking schedule yet."
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {restaurantId ? (
        <div className="mb-8">
          <PublicVideoGallery
            ownerType={isFoodTruck ? "food_truck" : "restaurant"}
            ownerId={String(restaurantId)}
            title={isFoodTruck ? "Truck Videos" : "Restaurant Videos"}
            description={`Watch featured videos from ${restaurantName}.`}
          />
        </div>
      ) : null}

      {/* Current Specials */}
      <div
        className="mb-8 rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-clean"
        id="restaurant-specials-list"
      >
        <div className="mb-4 inline-flex items-center gap-2">
          <h2 className="text-xl font-bold text-foreground">
            <AdminEditableText
              textKey="restaurant.detail.specials.title"
              defaultText="Current Specials"
            />
          </h2>
          {isStaffOrAdmin ? (
            <Link href={dealCreationPath as any}>
              <Button size="sm" variant="outline">
                Manage Specials
              </Button>
            </Link>
          ) : (
            <AdminEditButton
              textKey="restaurant.detail.specials.title"
              defaultText="Current Specials"
              label="Current specials title"
            />
          )}
        </div>
        {restaurantDeals.length > 0 ? (
          <div className="space-y-4">
            {restaurantDeals.map((deal: any) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        ) : (
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="p-6 text-center">
              <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">-</span>
              </div>
              <p className="text-muted-foreground">
                No current specials available
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Check back soon!
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Restaurant Trust Panel */}
      {restaurantId && isVerifiedMemberProfile && (
        <div className="mt-10">
          <RestaurantTrustPanel restaurantId={restaurantId} />
        </div>
      )}

      {/* Community Recommendations */}
      <div className="mt-10 rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 sm:p-6 shadow-clean">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-foreground">
              Community Recommendations
            </h2>
            {isStaffOrAdmin ? (
              <Link href={editRestaurantFocusPath("recommendations") as any}>
                <Button size="sm" variant="outline">
                  Manage Content
                </Button>
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{recommendationCount} total</Badge>
            {restaurantId && (
              <FlagProfileContentDialog restaurantId={restaurantId} />
            )}
          </div>
        </div>
        {recommendationRows.length > 0 ? (
          <div className="space-y-3">
            {recommendationRows.map((rec) => (
              <Card
                key={rec.id}
                className="border border-[color:var(--border-subtle)]"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        Recommended by {rec.authorName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {rec.createdAt
                          ? new Date(rec.createdAt).toLocaleDateString()
                          : "Recent"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {rec.menuItemName
                          ? `Menu pick: ${rec.menuItemName} · `
                          : ""}
                        {rec.sentimentScore100 >= 75
                          ? "Very positive"
                          : rec.sentimentScore100 >= 50
                            ? "Positive"
                            : rec.sentimentScore100 >= 30
                              ? "Mixed"
                              : "Negative"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={
                          rec.viewerReaction === "like" ? "default" : "outline"
                        }
                        className="h-8 px-2"
                        onClick={() =>
                          handleRecommendationReaction(
                            rec.id,
                            rec.viewerReaction,
                            "like",
                          )
                        }
                      >
                        <ThumbsUp className="w-3.5 h-3.5 mr-1" />
                        {rec.likeCount}
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          rec.viewerReaction === "dislike"
                            ? "destructive"
                            : "outline"
                        }
                        className="h-8 px-2"
                        onClick={() =>
                          handleRecommendationReaction(
                            rec.id,
                            rec.viewerReaction,
                            "dislike",
                          )
                        }
                      >
                        <ThumbsDown className="w-3.5 h-3.5 mr-1" />
                        {rec.dislikeCount}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => handleRecommendationShare(rec.id)}
                      >
                        <Share2 className="w-3.5 h-3.5 mr-1" />
                        {rec.shareCount}
                      </Button>
                      <FlagRecommendationDialog recommendationId={rec.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border border-[color:var(--border-subtle)]">
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No community recommendations yet. Be the first to recommend this
              spot.
            </CardContent>
          </Card>
        )}
      </div>

      {/* FAQ Section - SEO optimized, minimal UI */}
      <div className="mt-10">
        <MinimalFAQ
          items={[
            {
              question: "How do I order?",
              answer: phoneNumber
                ? `Use the menu and business links on this profile, or call ${phoneNumber} for pickup and ordering options.`
                : "Use the menu, directions, and business links on this profile to plan pickup or ordering.",
            },
            {
              question: "Are there current specials?",
              answer:
                restaurantDeals.length > 0
                  ? `${restaurantDeals.length} active special${restaurantDeals.length === 1 ? " is" : "s are"} listed right now. View and claim offers from this page.`
                  : "No active specials are listed right now. Check back for new offers from this spot.",
            },
            {
              question: "What type of food is this?",
              answer: `${cuisineType} is the current category for this profile. Menus and community recommendations will add more detail as the listing fills out.`,
            },
            {
              question: "How do I get there?",
              answer: address
                ? `The listed location is ${locationDisplay || address}. Use Directions to open navigation in your maps app.`
                : "Use Directions to open the best available map location for this profile.",
            },
          ]}
        />
      </div>
      <Navigation />
    </div>
  );
}
