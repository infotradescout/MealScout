import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, Link } from "wouter";
import Navigation from "@/components/navigation";
import DealCard from "@/components/deal-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RestaurantTrustPanel } from "@/components/RestaurantTrustPanel";
import {
  FlagRecommendationDialog,
  FlagProfileContentDialog,
} from "@/components/moderation/FlagDialogs";
import { BackHeader } from "@/components/back-header";
import {
  MapPin,
  Mail,
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
  const restaurantId = params.id || extractUuidFromSlug(params.slug);
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
  const [isSendingBusinessMessage, setIsSendingBusinessMessage] =
    useState(false);
  const [businessMessage, setBusinessMessage] = useState({
    name: "",
    email: "",
    topic: "Question",
    phone: "",
    preferredReply: "email",
    message: "",
  });
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
      queryFn: async () => {
        const response = await fetch(
          `/api/restaurants/${restaurantId}/recommendations/public?limit=16`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("Failed to fetch recommendations");
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      },
    });

  const { data: canonical } = useQuery({
    queryKey: ["/api/public/canonical", "restaurant", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/canonical/restaurant/${restaurantId}`,
      );
      if (!res.ok) {
        throw new Error("Failed to load canonical restaurant data");
      }
      return res.json();
    },
  });

  const { data: evidence } = useQuery({
    queryKey: ["/api/public/evidence", "restaurant", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/evidence/restaurant/${restaurantId}`,
      );
      if (!res.ok) {
        throw new Error("Failed to load restaurant evidence");
      }
      return res.json();
    },
  });

  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "duper_admin" ||
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

  const handleSendBusinessMessage = async () => {
    if (!restaurantId) return;
    setIsSendingBusinessMessage(true);
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/message`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(businessMessage),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to send message");
      }

      toast({
        title: "Message sent",
        description: `${restaurantName} can reply directly to your email.`,
      });
      setBusinessMessage((prev) => ({
        name: user ? "" : prev.name,
        email: user ? "" : prev.email,
        phone: "",
        preferredReply: "email",
        topic: "Question",
        message: "",
      }));
    } catch (error: any) {
      toast({
        title: "Message failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingBusinessMessage(false);
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
      <div className="max-w-md mx-auto bg-black min-h-screen relative pb-20">
        <div className="animate-pulse">
          <div className="w-full h-72 bg-white/5"></div>
          <div className="p-6 space-y-4">
            <div className="h-8 bg-white/5 rounded-2xl w-3/4"></div>
            <div className="h-4 bg-white/5 rounded-2xl w-1/2"></div>
            <div className="h-20 bg-white/5 rounded-2xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="max-w-md mx-auto bg-black min-h-screen relative pb-20">
        <div className="text-center py-20 px-8">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
            <Store className="w-8 h-8 text-white/30" />
          </div>
          <h2 className="text-2xl font-serif font-bold text-white mb-3">
            Not Found
          </h2>
          <p className="text-white/50 text-sm mb-8">
            This spot doesn't exist or may have moved.
          </p>
          <Link href="/">
            <Button className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-8 py-6">
              Back to Scout
            </Button>
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
    dateModified:
      canonical?.updatedAt || (restaurant as any)?.updatedAt || undefined,
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
    <div className="max-w-md mx-auto bg-black min-h-screen relative pb-20">
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
        className="bg-black/80 backdrop-blur-xl border-b border-white/5"
      />

      {/* Hero */}
      <div className="relative h-64 overflow-hidden bg-[#0a0a0a]">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/30 via-black to-black" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute bottom-6 left-6 right-6">
          <div className="flex items-center gap-2 mb-2">
            {(restaurant as any)?.cuisineType && (
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                {(restaurant as any).cuisineType}
              </span>
            )}
            {isFoodTruck && (
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                · Food Truck
              </span>
            )}
          </div>
          <h1
            className="text-3xl font-serif font-bold text-white leading-tight"
            data-testid="text-restaurant-name"
          >
            {(restaurant as any)?.name}
            {(restaurant as any)?.isVerified && (
              <CheckCircle
                className="inline w-5 h-5 text-primary ml-2 align-middle"
                data-testid="icon-verified-restaurant"
              />
            )}
          </h1>
        </div>
      </div>

      {/* Info + Actions */}
      <div className="px-6 py-6">
        <div className="mb-8">
          {/* Quick meta row */}
          <div className="flex items-center gap-4 mb-6">
            {currentRating > 0 && (
              <div className="flex items-center gap-1.5">
                <Star className="w-4 h-4 fill-primary text-primary" />
                <span
                  className="text-sm font-bold text-white"
                  data-testid="text-rating"
                >
                  {currentRating.toFixed(1)}
                </span>
                <span
                  className="text-xs text-white/40"
                  data-testid="text-review-count"
                >
                  ({reviewCount})
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Clock className="w-3.5 h-3.5" />
              <span className="font-semibold uppercase tracking-wider">
                Open now
              </span>
            </div>
            <div className="ml-auto">
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
          </div>

          {/* Address */}
          {(restaurant as any)?.address && (
            <div className="flex items-start gap-3 mb-3">
              <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <p
                className="text-sm text-white/70 font-medium"
                data-testid="text-restaurant-address"
              >
                {(restaurant as any)?.address}
              </p>
            </div>
          )}

          {/* Phone */}
          {(restaurant as any)?.phone && (
            <div className="flex items-center gap-3 mb-6">
              <Phone className="w-4 h-4 text-primary flex-shrink-0" />
              <p
                className="text-sm text-white/70 font-medium"
                data-testid="text-restaurant-phone"
              >
                {(restaurant as any)?.phone}
              </p>
            </div>
          )}

          {canonical ? (
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
                    <Badge variant="outline">
                      {canonical.machineReadiness}
                    </Badge>
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
                      {canonical.evidenceSummary?.liveLocationActive
                        ? "Yes"
                        : "No"}
                    </span>
                  </div>
                </div>

                {Array.isArray(canonical.sourceTruthStatements) &&
                canonical.sourceTruthStatements.length > 0 ? (
                  <div className="space-y-1">
                    {canonical.sourceTruthStatements
                      .slice(0, 4)
                      .map((item: string) => (
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
                      <Badge
                        key={gap}
                        variant="outline"
                        className="text-[11px]"
                      >
                        gap: {gap.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {evidence ? (
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
                    {evidence.windowHours
                      ? `${Math.round(evidence.windowHours / 24)}d window`
                      : "window"}
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
                      <Badge
                        key={bot.label}
                        variant="secondary"
                        className="text-[11px]"
                      >
                        {bot.label}: {bot.count}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(evidence.demand?.topQueries) &&
                evidence.demand.topQueries.length > 0 ? (
                  <div className="space-y-1">
                    {evidence.demand.topQueries
                      .slice(0, 3)
                      .map((query: any) => (
                        <p
                          key={query.query}
                          className="text-sm text-foreground"
                        >
                          demand: {query.query} ({query.count})
                        </p>
                      ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Primary CTAs */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="flex-1 bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-2xl py-6 hover:bg-amber-400 transition-all"
              data-testid="button-directions"
            >
              <DirectionsIcon className="w-4 h-4 mr-2" />
              Get Directions
            </Button>
            <Button
              className="flex-1 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-2xl py-6 hover:bg-white/10 transition-all"
              data-testid="button-call-restaurant"
            >
              <Phone className="w-4 h-4 mr-2" />
              Call
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:flex-1"
                  data-testid="button-message-business"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Contact
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Contact {restaurantName}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <p className="text-sm text-muted-foreground">
                    Pick a topic and we will help shape a useful message. No
                    account is required. MealScout sends this to the business
                    owner and shares your chosen reply info so they can respond.
                    We do not include your live location.
                  </p>
                  <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    Do not send payment details, passwords, or sensitive medical
                    information here.
                  </p>
                  <div className="grid gap-2">
                    {!user && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="grid gap-2">
                          <Label htmlFor="business-message-name">
                            Your name
                          </Label>
                          <Input
                            id="business-message-name"
                            value={businessMessage.name}
                            onChange={(e) =>
                              setBusinessMessage((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            placeholder="Name"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="business-message-email">
                            Reply email
                          </Label>
                          <Input
                            id="business-message-email"
                            type="email"
                            value={businessMessage.email}
                            onChange={(e) =>
                              setBusinessMessage((prev) => ({
                                ...prev,
                                email: e.target.value,
                              }))
                            }
                            placeholder="you@example.com"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label>Best way to reply</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        ["email", "Email"],
                        ["phone", "Phone"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                            businessMessage.preferredReply === value
                              ? "border-amber-300 bg-amber-300 text-black"
                              : "border-white/10 bg-white/5 text-white/70"
                          }`}
                          onClick={() =>
                            setBusinessMessage((prev) => ({
                              ...prev,
                              preferredReply: value,
                            }))
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {businessMessage.preferredReply === "phone" && (
                      <Input
                        value={businessMessage.phone}
                        onChange={(e) =>
                          setBusinessMessage((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        placeholder="Best callback number"
                      />
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="business-message-topic">Topic</Label>
                    <Input
                      id="business-message-topic"
                      value={businessMessage.topic}
                      onChange={(e) =>
                        setBusinessMessage((prev) => ({
                          ...prev,
                          topic: e.target.value,
                        }))
                      }
                      placeholder="Question, catering, hours, menu..."
                    />
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Question",
                        "Menu",
                        "Catering",
                        "Booking",
                        "Dietary need",
                      ].map((topic) => (
                        <button
                          key={topic}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            businessMessage.topic === topic
                              ? "border-amber-300 bg-amber-300 text-black"
                              : "border-white/10 bg-white/5 text-white/70"
                          }`}
                          onClick={() =>
                            setBusinessMessage((prev) => ({
                              ...prev,
                              topic,
                              message:
                                prev.message.trim().length > 0
                                  ? prev.message
                                  : topic === "Menu"
                                    ? "Hi, I had a menu question. Could you tell me what you recommend today?"
                                    : topic === "Catering"
                                      ? "Hi, I am interested in catering. Could you share availability, minimums, and the best next step?"
                                      : topic === "Booking"
                                        ? "Hi, I would like to ask about booking you for a date. Could you tell me what information you need?"
                                        : topic === "Dietary need"
                                          ? "Hi, I have a dietary question. Could you let me know what options are available?"
                                          : prev.message,
                            }))
                          }
                        >
                          {topic}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="business-message-body">Message</Label>
                    <Textarea
                      id="business-message-body"
                      value={businessMessage.message}
                      onChange={(e) =>
                        setBusinessMessage((prev) => ({
                          ...prev,
                          message: e.target.value,
                        }))
                      }
                      placeholder="Example: Hi, do you have gluten-free options today? If so, what would you recommend?"
                      rows={5}
                      maxLength={2000}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Reply by {businessMessage.preferredReply}:{" "}
                        {businessMessage.preferredReply === "phone"
                          ? businessMessage.phone || "enter a callback number"
                          : user?.email ||
                            businessMessage.email ||
                            "the email you enter"}
                        .
                      </span>
                      <span>{businessMessage.message.length}/2000</span>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleSendBusinessMessage}
                    disabled={
                      isSendingBusinessMessage ||
                      businessMessage.message.trim().length < 10 ||
                      (!user &&
                        (!businessMessage.name.trim() ||
                          !businessMessage.email.trim())) ||
                      (businessMessage.preferredReply === "phone" &&
                        businessMessage.phone.trim().length < 7)
                    }
                  >
                    {isSendingBusinessMessage ? "Sending..." : "Send Message"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Parking Schedule
              </span>
            </div>
            {scheduleLoading ? (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 text-center text-white/40 text-sm">
                Loading schedule...
              </div>
            ) : parkingScheduleItems.length > 0 ? (
              <ParkingScheduleCalendar
                items={parkingScheduleItems}
                subtitle="Auto-updated by Parking Pass bookings and public manual stops."
              />
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
                <p className="text-white/40 text-sm">
                  No upcoming stops scheduled yet.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Current Specials */}
        <div className="mb-10" id="restaurant-specials">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Tonight's Specials
            </span>
          </div>
          {restaurantDeals.length > 0 ? (
            <div className="space-y-4">
              {restaurantDeals.map((deal: any) => (
                <DealCard key={deal.id} deal={deal} />
              ))}
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
              <p className="text-white/40 text-sm">
                No specials right now — check back soon.
              </p>
            </div>
          )}
        </div>

        {/* Reviews */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Community Reviews
            </span>
            <Button
              className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-white/10 transition-all"
              size="sm"
              data-testid="button-write-review"
            >
              Write Review
            </Button>
          </div>

          {Array.isArray(reviews) && reviews.length > 0 ? (
            <div className="space-y-3">
              {reviews.slice(0, 3).map((review: any) => (
                <div
                  key={review.id}
                  className="bg-white/5 border border-white/10 rounded-2xl p-5"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">U</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-white">
                          Community Member
                        </span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`w-3 h-3 ${star <= (review.rating || 0) ? "fill-primary text-primary" : "text-white/20"}`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-white/60">{review.comment}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
              <Star className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/40 text-sm">
                No reviews yet — be the first to stop by and share.
              </p>
            </div>
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
          <div className="flex items-center justify-between mb-5">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Community Recommendations
            </span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{recommendationRows.length} total</Badge>
              {restaurantId && (
                <FlagProfileContentDialog restaurantId={restaurantId} />
              )}
            </div>
          </div>
          {recommendationRows.length > 0 ? (
            <div className="space-y-3">
              {recommendationRows.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-white/5 border border-white/10 rounded-2xl p-4"
                >
                  <div className="p-0">
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
                            rec.viewerReaction === "like"
                              ? "default"
                              : "outline"
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
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
              <p className="text-white/40 text-sm">
                No recommendations yet. Stop by and be the first.
              </p>
            </div>
          )}
        </div>

        {/* FAQ Section - SEO optimized, minimal UI */}
        <div className="mt-12 pt-8 border-t border-white/5">
          <MinimalFAQ
            items={[
              {
                question: `Does ${restaurantName} offer delivery?`,
                answer: `Contact ${restaurantName} directly at ${(restaurant as any)?.phone || "their phone number"} to inquire about delivery options and availability in your area.`,
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
