import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RestaurantTrustPanel } from "@/components/RestaurantTrustPanel";
import { FlagRecommendationDialog, FlagProfileContentDialog } from "@/components/moderation/FlagDialogs";
import { BackHeader } from "@/components/back-header";
import {
  MapPin,
  Phone,
  Star,
  Clock,
  Navigation as DirectionsIcon,
  Heart,
  CheckCircle,
  Store,
  ThumbsUp,
  ThumbsDown,
  Share2,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { MinimalFAQ } from "@/components/seo-faq";
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
import {
  ParkingScheduleCalendar,
  type ParkingScheduleItem,
} from "@/components/parking-schedule-calendar";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { apiRequest } from "@/lib/queryClient";

type PublicRecommendation = {
  id: string;
  userId: string;
  createdAt?: string;
  authorName: string;
  likeCount: number;
  dislikeCount: number;
  shareCount: number;
  viewerReaction: "like" | "dislike" | null;
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

export default function RestaurantDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const [, setLocation] = useLocation();
  const restaurantId = params.id || extractUuidFromSlug(params.slug);
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
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

  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants", restaurantId],
    enabled: !!restaurantId,
  });

  const { data: reviews } = useQuery({
    queryKey: ["/api/reviews/restaurant", restaurantId],
    enabled: !!restaurantId,
  });

  const { data: rating } = useQuery({
    queryKey: ["/api/reviews/restaurant", restaurantId, "rating"],
    enabled: !!restaurantId,
  });

  const { data: featuredDeals } = useQuery({
    queryKey: ["/api/deals/featured"],
    enabled: true,
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

  const { data: canonical } = useQuery({
    queryKey: ["/api/public/canonical", "restaurant", restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/public/canonical/restaurant/${restaurantId}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: evidence } = useQuery({
    queryKey: ["/api/public/evidence", "restaurant", restaurantId],
    enabled: !!restaurantId,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/public/evidence/restaurant/${restaurantId}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";

  const isFoodTruck =
    (restaurant as any)?.isFoodTruck ||
    (restaurant as any)?.businessType === "food_truck";

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
          lastConfirmedAt: item.manual.lastConfirmedAt || item.createdAt || null,
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
      await apiRequest("POST", `/api/recommendations/${recommendationId}/reaction`, {
        reaction: current === next ? "clear" : next,
      });
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

      await apiRequest("POST", `/api/recommendations/${recommendationId}/share`, {});
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

  // Filter deals for this restaurant
  const allDeals = Array.isArray(featuredDeals) ? featuredDeals : [];
  const restaurantDeals = allDeals.filter(
    (deal: any) => deal.restaurantId === restaurantId,
  );

  const currentRating = (rating as any)?.rating || 0;
  const reviewCount = Array.isArray(reviews) ? reviews.length : 0;

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
  const profilePath = `/p/restaurant/${restaurantId}/${profileSlug}`;
  const cleanRestaurantPath = `/restaurant/${restaurantId}/${profileSlug}`;

  useEffect(() => {
    if (!restaurantId) return;
    const currentPath = window.location.pathname.replace(/\/+$/, "");
    const legacyPath = `/restaurant/${restaurantId}`;
    const normalizedCleanPath = cleanRestaurantPath.replace(/\/+$/, "");

    if (currentPath === normalizedCleanPath) return;
    if (currentPath === legacyPath || currentPath.startsWith(`${legacyPath}/`)) {
      setLocation(cleanRestaurantPath);
    }
  }, [restaurantId, cleanRestaurantPath, setLocation]);
  const cuisineType = (restaurant as any)?.cuisineType || "food";
  const address = (restaurant as any)?.address || "";
  const description = `Visit ${restaurantName} and discover exclusive food deals. ${cuisineType} restaurant with ${restaurantDeals.length} active deals. ${currentRating > 0 ? `Rated ${currentRating.toFixed(1)} stars by ${reviewCount} customers.` : ""}`;

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
    url: `https://www.mealscout.us${profilePath}`,
    ...(currentRating > 0 && reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: currentRating.toFixed(1),
            reviewCount: reviewCount,
          },
        }
      : {}),
  };

  const sourceOfTruthSchema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${restaurantName} source of truth`,
    url: `https://www.mealscout.us${profilePath}`,
    dateModified: canonical?.updatedAt || (restaurant as any)?.updatedAt || undefined,
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

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title={`${restaurantName} - ${cuisineType} Restaurant | MealScout`}
        description={description}
        keywords={`${restaurantName}, ${cuisineType} restaurant, restaurant deals, ${address}, food discounts`}
        canonicalUrl={`https://www.mealscout.us${profilePath}`}
        schemaData={[localBusinessSchema, sourceOfTruthSchema]}
      />
      <BackHeader
        title={restaurantName}
        fallbackHref="/"
        icon={Store}
        rightActions={rightActions}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      {/* Header Image */}
      <div className="relative h-48 bg-[linear-gradient(110deg,rgba(255,77,46,0.12),rgba(245,158,11,0.12))] overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>

        {/* Restaurant Image Placeholder */}
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center text-white/80">
            <div className="w-20 h-20 bg-[var(--bg-card)]/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">--</span>
            </div>
          </div>
        </div>
      </div>

      {/* Restaurant Info */}
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-start justify-between mb-2">
            <h1
              className="text-2xl font-bold text-foreground flex items-center space-x-2"
              data-testid="text-restaurant-name"
            >
              <span>{(restaurant as any)?.name}</span>
              {(restaurant as any)?.isVerified && (
                <CheckCircle
                  className="w-5 h-5 text-[color:var(--status-success)]"
                  data-testid="icon-verified-restaurant"
                />
              )}
            </h1>
            {(restaurant as any)?.cuisineType && (
              <Badge variant="secondary" data-testid="badge-cuisine-type">
                {(restaurant as any)?.cuisineType}
              </Badge>
            )}
          </div>
          <div className="mb-3">
            <ShareButton
              url={profilePath}
              title={`Check out ${(restaurant as any)?.name || "this spot"} on MealScout`}
              description={
                (restaurant as any)?.description ||
                "Discover this location on MealScout."
              }
              size="sm"
              variant="outline"
            />
          </div>

          {/* Rating */}
          <div className="flex items-center space-x-4 mb-4">
            <div className="flex items-center space-x-1">
              <Star className="w-4 h-4 fill-[color:var(--status-warning)] text-[color:var(--status-warning)]" />
              <span className="font-semibold" data-testid="text-rating">
                {currentRating.toFixed(1)}
              </span>
              <span
                className="text-muted-foreground text-sm"
                data-testid="text-review-count"
              >
                ({reviewCount} reviews)
              </span>
            </div>
            <div className="flex items-center space-x-1 text-sm text-[color:var(--status-success)]">
              <Clock className="w-4 h-4" />
              <span>Open now</span>
            </div>
          </div>

          {/* Address */}
          <div className="flex items-start space-x-2 mb-4">
            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
            <div>
              <p
                className="text-sm text-foreground"
                data-testid="text-restaurant-address"
              >
                {(restaurant as any)?.address}
              </p>
            </div>
          </div>

          {/* Contact Info */}
          {(restaurant as any)?.phone && (
            <div className="flex items-center space-x-2 mb-6">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <p
                className="text-sm text-foreground"
                data-testid="text-restaurant-phone"
              >
                {(restaurant as any)?.phone}
              </p>
            </div>
          )}

          {isStaffOrAdmin && canonical ? (
            <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)]/80">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      Source of Truth
                    </p>
                    <h2 className="text-sm font-semibold text-foreground">
                      Canonical MealScout record
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Badge variant="outline">{canonical.machineReadiness}</Badge>
                    <Badge variant="secondary">{canonical.freshness}</Badge>
                    {canonical.verified ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        verified
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    Last updated{" "}
                    <span className="text-foreground font-medium">
                      {canonical.updatedAt
                        ? new Date(canonical.updatedAt).toLocaleString()
                        : "Unknown"}
                    </span>
                  </div>
                  <div>
                    Freshness window{" "}
                    <span className="text-foreground font-medium">
                      {canonical.freshnessHours != null
                        ? `${canonical.freshnessHours}h ago`
                        : "Unknown"}
                    </span>
                  </div>
                  <div>
                    Active deal signals{" "}
                    <span className="text-foreground font-medium">
                      {canonical.evidenceSummary?.activeDealCount ?? 0}
                    </span>
                  </div>
                  <div>
                    Live location{" "}
                    <span className="text-foreground font-medium">
                      {canonical.evidenceSummary?.liveLocationActive ? "Yes" : "No"}
                    </span>
                  </div>
                </div>

                {Array.isArray(canonical.sourceTruthStatements) &&
                canonical.sourceTruthStatements.length > 0 ? (
                  <div className="space-y-1">
                    {canonical.sourceTruthStatements.slice(0, 4).map((item: string) => (
                      <p key={item} className="text-sm text-foreground">
                        {item}
                      </p>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(canonical.knowledgeGaps) &&
                canonical.knowledgeGaps.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {canonical.knowledgeGaps.slice(0, 4).map((gap: string) => (
                      <Badge key={gap} variant="outline" className="text-[11px]">
                        gap: {gap.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {isStaffOrAdmin && evidence ? (
            <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)]/80">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      External Evidence
                    </p>
                    <h2 className="text-sm font-semibold text-foreground">
                      Discovery and distribution signals
                    </h2>
                  </div>
                  <Badge variant="outline">
                    {evidence.windowHours ? `${Math.round(evidence.windowHours / 24)}d window` : "window"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    Crawler hits{" "}
                    <span className="text-foreground font-medium">
                      {evidence.externalPressure?.crawlerHits ?? 0}
                    </span>
                  </div>
                  <div>
                    Human page hits{" "}
                    <span className="text-foreground font-medium">
                      {evidence.externalPressure?.humanPageHits ?? 0}
                    </span>
                  </div>
                  <div>
                    Search demand{" "}
                    <span className="text-foreground font-medium">
                      {evidence.demand?.matchingSearchQueries ?? 0}
                    </span>
                  </div>
                  <div>
                    Outbound posts{" "}
                    <span className="text-foreground font-medium">
                      {evidence.distribution?.outboundSocialPosts ?? 0}
                    </span>
                  </div>
                  <div>
                    Affiliate shares{" "}
                    <span className="text-foreground font-medium">
                      {evidence.distribution?.affiliateShares ?? 0}
                    </span>
                  </div>
                  <div>
                    Story views{" "}
                    <span className="text-foreground font-medium">
                      {evidence.content?.totalViews ?? 0}
                    </span>
                  </div>
                </div>

                {Array.isArray(evidence.externalPressure?.topBots) &&
                evidence.externalPressure.topBots.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {evidence.externalPressure.topBots.map((bot: any) => (
                      <Badge key={bot.label} variant="secondary" className="text-[11px]">
                        {bot.label}: {bot.count}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(evidence.demand?.topQueries) &&
                evidence.demand.topQueries.length > 0 ? (
                  <div className="space-y-1">
                    {evidence.demand.topQueries.slice(0, 3).map((query: any) => (
                      <p key={query.query} className="text-sm text-foreground">
                        demand: {query.query} ({query.count})
                      </p>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="w-full sm:flex-1"
              data-testid="button-directions"
            >
              <DirectionsIcon className="w-4 h-4 mr-2" />
              Directions
            </Button>
            <Button
              variant="outline"
              className="w-full sm:flex-1"
              data-testid="button-call-restaurant"
            >
              <Phone className="w-4 h-4 mr-2" />
              Call
            </Button>
            {isFoodTruck && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:flex-1"
                    data-testid="button-book-truck"
                  >
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
            )}
            {!isFoodTruck && (
              <Button
                variant="outline"
                className="w-full sm:flex-1"
                data-testid="button-view-specials"
                onClick={() =>
                  document
                    .getElementById("restaurant-specials")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                View Specials
              </Button>
            )}
          </div>
        </div>

        {isFoodTruck && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-foreground mb-4">
              Parking Schedule
            </h2>
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
                  No upcoming parking schedule yet.
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Current Specials */}
        <div className="mb-8" id="restaurant-specials">
          <h2 className="text-xl font-bold text-foreground mb-4">
            Current Specials
          </h2>
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

        {/* Reviews */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-foreground">Reviews</h2>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-write-review"
            >
              Write Review
            </Button>
          </div>

          {Array.isArray(reviews) && reviews.length > 0 ? (
            <div className="space-y-4">
              {reviews.slice(0, 3).map((review: any) => (
                <Card key={review.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-[color:var(--accent-text)]/12 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium">U</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="font-medium text-sm">User</span>
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-3 h-3 ${star <= (review.rating || 0) ? "fill-[color:var(--status-warning)] text-[color:var(--status-warning)]" : "text-[color:var(--border-strong)]"}`}
                              />
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {review.comment}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-6 text-center">
                <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Star className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">No reviews yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Be the first to review this restaurant!
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Restaurant Trust Panel */}
        {restaurantId && (
          <div className="mt-10">
            <RestaurantTrustPanel restaurantId={restaurantId} />
          </div>
        )}

        {/* Community Recommendations */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-foreground">
              Community Recommendations
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {recommendationRows.length} total
              </Badge>
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
                No recommendations yet. Be the first to recommend this spot.
              </CardContent>
            </Card>
          )}
        </div>

        {/* FAQ Section - SEO optimized, minimal UI */}
        <div className="mt-12 pt-8 border-t border-[color:var(--border-subtle)]">
          <MinimalFAQ
            items={[
              {
                question: `How do I order from ${restaurantName}?`,
                answer: `Check ${restaurantName}'s menu and current MealScout profile details, or contact them directly at ${(restaurant as any)?.phone || "their phone number"} for pickup and ordering options.`,
              },
              {
                question: `What are the current specials at ${restaurantName}?`,
                answer: `${restaurantName} has ${restaurantDeals.length} active specials available on MealScout. View all current specials and claim offers directly from this page.`,
              },
              {
                question: `What type of cuisine does ${restaurantName} serve?`,
                answer: `${restaurantName} specializes in ${cuisineType} cuisine. Check the menu and reviews above for specific dishes and customer favorites.`,
              },
              {
                question: `How do I get directions to ${restaurantName}?`,
                answer: `${restaurantName} is located at ${address}. Click the Directions button above to open navigation in your maps app.`,
              },
            ]}
            className="mt-6"
          />
        </div>
      </div>

      <Navigation />
    </div>
  );
}
