import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { trackDealViewOnce } from "@/lib/dealViewTracking";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import DealClaimModal from "@/components/deal-claim-modal";
import DealShareModal from "@/components/deal-share-modal";
import { BackHeader } from "@/components/back-header";
import { Tag, ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { extractUuidFromSlug } from "@/lib/seo-slug";

interface Deal {
  id: string;
  restaurantId: string;
  title: string;
  description: string;
  dealType: string;
  discountValue: string;
  minOrderAmount?: string;
  imageUrl?: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  perCustomerLimit: number;
  currentUses: number;
  distance?: number;
}

interface Restaurant {
  id: string;
  name: string;
  address: string;
  phone?: string;
  cuisineType?: string;
}

export default function DealDetail() {
  const params = useParams() as Record<string, string | undefined>;
  const dealParam = params.id || params.slug || "";
  const dealId = extractUuidFromSlug(dealParam) || dealParam;
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const viewTimerRef = useRef<number | null>(null);

  const { data: deal, isLoading: dealLoading } = useQuery({
    queryKey: ["/api/deals", dealId],
    enabled: !!dealId,
  });

  const { data: restaurant, isLoading: restaurantLoading } = useQuery({
    queryKey: ["/api/restaurants", (deal as Deal)?.restaurantId],
    enabled: !!(deal as Deal)?.restaurantId,
  });

  const { data: reviews } = useQuery({
    queryKey: ["/api/reviews/restaurant", (deal as Deal)?.restaurantId],
    enabled: !!(deal as Deal)?.restaurantId,
  });

  const { data: rating } = useQuery({
    queryKey: [
      "/api/reviews/restaurant",
      (deal as Deal)?.restaurantId,
      "rating",
    ],
    enabled: !!(deal as Deal)?.restaurantId,
  });

  const { data: canonical } = useQuery({
    queryKey: ["/api/public/canonical", "deal", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const res = await fetch(`/api/public/canonical/deal/${dealId}`);
      if (!res.ok) {
        throw new Error("Failed to load canonical deal data");
      }
      return res.json();
    },
  });

  const { data: evidence } = useQuery({
    queryKey: ["/api/public/evidence", "deal", dealId],
    enabled: !!dealId,
    queryFn: async () => {
      const res = await fetch(`/api/public/evidence/deal/${dealId}`);
      if (!res.ok) {
        throw new Error("Failed to load deal evidence");
      }
      return res.json();
    },
  });

  // Track deal view when deal is loaded
  useEffect(() => {
    if (!dealId || !deal || dealLoading) return;
    if (viewTimerRef.current !== null) return;

    viewTimerRef.current = window.setTimeout(() => {
      trackDealViewOnce(dealId).catch(() => {});
      viewTimerRef.current = null;
    }, 1000);

    return () => {
      if (viewTimerRef.current !== null) {
        window.clearTimeout(viewTimerRef.current);
        viewTimerRef.current = null;
      }
    };
  }, [dealId, deal, dealLoading]);

  const claimDealMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/deals/${dealId}/claim`, {});
    },
    onSuccess: () => {
      toast({
        title: "Special Claimed!",
        description:
          "You have successfully claimed this deal. Show this to the restaurant.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/auth/google/customer";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to claim deal",
        variant: "destructive",
      });
    },
  });

  if (dealLoading || restaurantLoading) {
    return (
      <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen">
        <div className="animate-pulse">
          <div className="w-full h-64 bg-[var(--bg-surface-muted)]"></div>
          <div className="p-4 space-y-4">
            <div className="h-6 bg-[var(--bg-surface-muted)] rounded w-3/4"></div>
            <div className="h-4 bg-[var(--bg-surface-muted)] rounded w-1/2"></div>
            <div className="h-20 bg-[var(--bg-surface-muted)] rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <i className="fas fa-exclamation-triangle text-muted-foreground text-3xl mb-4"></i>
            <p className="text-muted-foreground mb-4">Special not found</p>
            <Link href="/">
              <Button>Back to Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatDiscount = (deal: Deal) => {
    if (deal.dealType === "percentage") {
      return `${deal.discountValue}% OFF`;
    } else {
      return `$${deal.discountValue} OFF`;
    }
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const dealTitle = (deal as Deal)?.title || "Food Special";
  const restaurantName = (restaurant as Restaurant)?.name || "Restaurant";
  const dealDescription =
    (deal as Deal)?.description ||
    "Exclusive food special from a local restaurant";
  const discountValue = (deal as Deal)?.discountValue || "";
  const dealType = (deal as Deal)?.dealType || "";
  const distance = (deal as Deal)?.distance;

  const offerSchema = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: dealTitle,
    description: dealDescription,
    url: `https://www.mealscout.us/deals/${dealId}`,
    priceCurrency: "USD",
    price: dealType === "percentage" ? "0" : discountValue,
    discount:
      dealType === "percentage" ? `${discountValue}%` : `$${discountValue}`,
    seller: {
      "@type": "Restaurant",
      name: restaurantName,
      address: (restaurant as Restaurant)?.address || "",
    },
    validFrom: (deal as Deal)?.startDate,
    validThrough: (deal as Deal)?.endDate,
    availability: "https://schema.org/InStock",
  };

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen">
      <SEOHead
        title={`${dealTitle} - ${restaurantName} | MealScout`}
        description={`${dealDescription}. ${
          dealType === "percentage"
            ? `Get ${discountValue}% off`
            : `Save $${discountValue}`
        } at ${restaurantName}. Claim this exclusive special now on MealScout!`}
        keywords={`${restaurantName}, ${dealTitle}, food special, restaurant discount, ${
          (restaurant as Restaurant)?.cuisineType || "food"
        }`}
        canonicalUrl={`https://www.mealscout.us/deals/${dealId}`}
        schemaData={offerSchema}
      />
      <BackHeader
        title="Special Details"
        fallbackHref="/"
        icon={Tag}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean sticky top-0 z-10"
      />

      {/* Action Buttons */}
      <div className="bg-[hsl(var(--background))/0.94] px-4 py-2 border-b border-[color:var(--border-subtle)] sticky top-16 z-10">
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowShareModal(true)}
            data-testid="button-share"
            aria-label="Share special"
          >
            <i className="fas fa-share text-foreground"></i>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-testid="button-favorite"
            aria-label="Save special"
          >
            <i className="fas fa-heart text-muted-foreground hover:text-[color:var(--accent-text)]"></i>
          </Button>
        </div>
      </div>

      {/* Deal Image */}
      <div className="relative">
        <div className="w-full h-64 bg-gradient-to-r from-[color:var(--accent-text)]/12 to-[color:var(--status-warning)]/12 flex items-center justify-center">
          {(deal as Deal)?.imageUrl ? (
            <img
              src={(deal as Deal).imageUrl}
              alt={(deal as Deal).title}
              className="w-full h-full object-cover"
              data-testid="img-deal"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <i className="fas fa-utensils text-[color:var(--accent-text)] text-4xl"></i>
          )}
        </div>
        <div
          className="absolute top-4 left-4 bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)] px-3 py-1 rounded-full font-bold text-sm"
          data-testid="text-discount-badge"
        >
          {formatDiscount(deal as Deal)}
        </div>
      </div>

      {/* Deal Content */}
      <div className="px-4 py-6 pb-32">
        {/* Restaurant Info */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1
              className="text-xl font-bold text-foreground mb-1"
              data-testid="text-restaurant-name"
            >
              {(restaurant as Restaurant)?.name || "Restaurant"}
            </h1>
            <div className="flex items-center space-x-4 text-sm text-muted-foreground">
              {distance !== undefined && (
                <div className="flex items-center space-x-1">
                  <i className="fas fa-map-marker-alt"></i>
                  <span data-testid="text-restaurant-distance">
                    {distance.toFixed(1)} mi away
                  </span>
                </div>
              )}
              <div className="flex items-center space-x-1">
                <i className="fas fa-star text-[color:var(--status-warning)]"></i>
                <span data-testid="text-restaurant-rating">
                  {(rating as any)?.rating &&
                  typeof (rating as any).rating === "number"
                    ? (rating as any).rating.toFixed(1)
                    : (rating as any)?.rating &&
                      !isNaN(Number((rating as any).rating))
                    ? Number((rating as any).rating).toFixed(1)
                    : "New"}
                  {Array.isArray(reviews) && ` (${reviews.length} reviews)`}
                </span>
              </div>
            </div>
          </div>
          <div className="w-16 h-16 bg-[color:var(--accent-text)] rounded-full flex items-center justify-center">
            <i className="fas fa-utensils text-white text-xl"></i>
          </div>
        </div>

        {/* Deal Description */}
        <Card className="bg-[var(--bg-surface-muted)] mb-6 border-[color:var(--border-subtle)] shadow-clean">
          <CardContent className="p-4">
            <h2
              className="font-semibold text-foreground mb-2"
              data-testid="text-deal-title"
            >
              {(deal as Deal)?.title}
            </h2>
            <p
              className="text-muted-foreground text-sm mb-3"
              data-testid="text-deal-description"
            >
              {(deal as Deal)?.description}
            </p>

            <div className="flex items-center space-x-4 text-xs">
              <div className="flex items-center space-x-1">
                <i className="fas fa-clock text-muted-foreground"></i>
                <span data-testid="text-deal-time">
                  Valid {formatTime((deal as Deal)?.startTime || "11:00")} -{" "}
                  {formatTime((deal as Deal)?.endTime || "15:00")}
                </span>
              </div>
              {(deal as Deal)?.minOrderAmount && (
                <div className="flex items-center space-x-1">
                  <i className="fas fa-dollar-sign text-muted-foreground"></i>
                  <span data-testid="text-min-order">
                    Min. order ${(deal as Deal).minOrderAmount}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {canonical ? (
          <Card className="bg-[var(--bg-surface-muted)] mb-6 border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Source of Truth
                  </p>
                  <h2 className="text-sm font-semibold text-foreground">
                    Canonical MealScout deal record
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Badge variant="outline">{canonical.machineReadiness}</Badge>
                  <Badge variant="secondary">{canonical.freshness}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  Freshness{" "}
                  <span className="text-foreground font-medium">
                    {canonical.freshnessHours != null
                      ? `${canonical.freshnessHours}h ago`
                      : "Unknown"}
                  </span>
                </div>
                <div>
                  Active{" "}
                  <span className="text-foreground font-medium">
                    {canonical.active ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(canonical.knowledgeGaps || []).slice(0, 4).map((gap: string) => (
                  <Badge key={gap} variant="outline" className="text-[11px]">
                    gap: {gap.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {evidence ? (
          <Card className="bg-[var(--bg-surface-muted)] mb-6 border-[color:var(--border-subtle)] shadow-clean">
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
                  Search demand{" "}
                  <span className="text-foreground font-medium">
                    {evidence.demand?.matchingSearchQueries ?? 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <Card className="bg-[var(--bg-layered)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="text-center p-3">
              <i className="fas fa-clock text-secondary text-lg mb-1"></i>
              <p
                className="text-xs font-medium text-foreground"
                data-testid="text-pickup-time"
              >
                15-25 min
              </p>
              <p className="text-xs text-muted-foreground">Pickup time</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--bg-layered)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="text-center p-3">
              <i className="fas fa-phone text-[color:var(--accent-text)] text-lg mb-1"></i>
              <p className="text-xs font-medium text-foreground">Call Now</p>
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-restaurant-phone"
              >
                {(restaurant as Restaurant)?.phone || "(555) 123-4567"}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--bg-layered)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="text-center p-3">
              <i className="fas fa-directions text-[color:var(--accent-text)] text-lg mb-1"></i>
              <p className="text-xs font-medium text-foreground">Directions</p>
              {(restaurant as Restaurant)?.address && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-directions"
                >
                  {(restaurant as Restaurant).address.split(",")[0]}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Reviews */}
        {Array.isArray(reviews) && reviews.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3
                className="font-semibold text-foreground"
                data-testid="text-reviews-title"
              >
                Recent Reviews
              </h3>
              <button
                className="text-[color:var(--accent-text)] text-sm font-medium"
                data-testid="button-see-all-reviews"
              >
                See all
              </button>
            </div>

            <div className="space-y-4">
              {(reviews as any[])
                .slice(0, 2)
                .map((review: any, index: number) => (
                  <Card key={review.id} className="bg-[var(--bg-layered)] border-[color:var(--border-subtle)] shadow-clean">
                    <CardContent className="p-4">
                      <div className="flex items-center space-x-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-muted)] flex items-center justify-center">
                          <i className="fas fa-user text-muted-foreground text-xs"></i>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <p
                              className="font-medium text-sm text-foreground"
                              data-testid={`text-reviewer-name-${index}`}
                            >
                              {review.user?.firstName || "Anonymous"}
                            </p>
                            <div className="flex text-[color:var(--status-warning)]">
                              {[...Array(5)].map((_, i) => (
                                <i
                                  key={i}
                                  className={`fas fa-star text-xs ${
                                    i < review.rating
                                      ? "text-[color:var(--status-warning)]"
                                      : "text-muted-foreground"
                                  }`}
                                ></i>
                              ))}
                            </div>
                          </div>
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid={`text-review-date-${index}`}
                          >
                            {new Date(review.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <p
                        className="text-sm text-foreground"
                        data-testid={`text-review-comment-${index}`}
                      >
                        {review.comment || "Great special!"}
                      </p>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-md bg-[hsl(var(--background))/0.94] border-t border-[color:var(--border-subtle)] px-4 py-4 shadow-clean">
        <div className="flex items-center space-x-3">
          <Button
            className="flex-1 py-3 font-semibold text-sm food-gradient-primary border-0 shadow-clean"
            onClick={() => setShowClaimModal(true)}
            disabled={!isAuthenticated}
            data-testid="button-claim-deal"
          >
            <i className="fab fa-facebook-f mr-2"></i>
            Claim & Post to Facebook
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11"
            data-testid="button-save-deal"
          >
            <i className="fas fa-heart text-muted-foreground"></i>
          </Button>
        </div>
        <p
          className="text-center text-xs text-muted-foreground mt-2"
          data-testid="text-deal-expires"
        >
          Special expires in{" "}
          {Math.ceil(
            (new Date((deal as Deal)?.endDate || Date.now()).getTime() -
              Date.now()) /
              (1000 * 60 * 60 * 24)
          )}{" "}
          days
        </p>
      </div>

      {/* Deal Claim Modal */}
      <DealClaimModal
        dealId={dealId || ""}
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
      />

      {/* Deal Share Modal */}
      <DealShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        deal={{
          id: (deal as Deal)?.id || "",
          title: (deal as Deal)?.title || "",
          description: (deal as Deal)?.description || "",
          discountValue: (deal as Deal)?.discountValue || "0",
          minOrderAmount: (deal as Deal)?.minOrderAmount,
          restaurant: {
            name: (restaurant as Restaurant)?.name || "Restaurant",
            cuisineType: (restaurant as Restaurant)?.cuisineType,
          },
        }}
      />
    </div>
  );
}









