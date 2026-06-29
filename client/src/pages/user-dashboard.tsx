import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import {
  ArrowRight,
  Clock,
  Gift,
  Heart,
  MapPin,
  User,
  Utensils,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Video,
  Eye,
  MessageCircle,
  ThumbsUp,
  Trash2,
  DollarSign,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { VideoUploadModal } from "@/components/video-upload-modal";
import type { Deal, Restaurant, DealClaim } from "@shared/schema";
import { SEOHead } from "@/components/seo-head";
import ShareHub from "@/components/share-hub";

type NearbyDeal = Deal & { restaurant: Restaurant; distance?: number };
type TrailDeal = Deal & { restaurant: Restaurant };

export default function UserDashboard() {
  const { user } = useAuth();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locationName, setLocationName] = useState("Getting location...");
  const [showVideos, setShowVideos] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isLocationBusy, setIsLocationBusy] = useState(true);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationName("Location unavailable");
      setIsLocationBusy(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lng: longitude });

        fetch(
          `/api/location/reverse?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`,
        )
          .then((res) => res.json())
          .then((data) => {
            const nextName = String(data?.label || "").trim();
            setLocationName(nextName || "Your Location");
          })
          .catch(() => {
            setLocationName("Your Location");
          })
          .finally(() => {
            setIsLocationBusy(false);
          });
      },
      () => {
        setLocationName("Location unavailable");
        setIsLocationBusy(false);
      },
    );
  }, []);

  // Fetch user's claimed deals
  const { data: claimedDeals = [], isLoading: claimedLoading } = useQuery<
    (DealClaim & { deal: Deal; restaurant: Restaurant })[]
  >({
    queryKey: ["/api/users/claimed-deals"],
    enabled: !!user,
  });

  // Fetch user's favorite restaurants
  const { data: favoriteRestaurants = [], isLoading: favoritesLoading } =
    useQuery<Restaurant[]>({
      queryKey: ["/api/users/favorites"],
      enabled: !!user,
    });

  // Fetch nearby deals
  const { data: nearbyDeals = [], isLoading: nearbyLoading } = useQuery<
    NearbyDeal[]
  >({
    queryKey: ["/api/deals/nearby", location?.lat, location?.lng],
    enabled: !!location,
    queryFn: async () => {
      if (!location) return [];
      const res = await fetch(`/api/deals/nearby/${location.lat}/${location.lng}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as NearbyDeal[]) : (data.deals ?? []);
    },
  });

  // Fetch recommended deals based on user preferences
  const { data: recommendedDeals = [] } = useQuery<TrailDeal[]>({
    queryKey: ["/api/deals/recommended"],
    enabled: !!user,
  });

  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    const places: {
      id: string;
      name: string;
      cuisineType?: string | null;
      restaurantId?: string;
      lastVisitedAt?: string | null;
    }[] = [];

    for (const claim of claimedDeals) {
      const restaurantId = claim.restaurant?.id;
      if (!restaurantId || seen.has(restaurantId)) continue;
      seen.add(restaurantId);
      places.push({
        id: claim.id,
        name: claim.restaurant.name,
        cuisineType: claim.restaurant.cuisineType,
        restaurantId,
        lastVisitedAt: claim.claimedAt
          ? new Date(claim.claimedAt).toISOString()
          : null,
      });
      if (places.length >= 4) break;
    }

    return places;
  }, [claimedDeals]);

  const savedSpots = favoriteRestaurants.slice(0, 4);
  const nearbyNow = nearbyDeals.slice(0, 4);
  const dealsNearYou = recommendedDeals.length > 0 ? recommendedDeals.slice(0, 4) : nearbyDeals.slice(0, 4);

  const nextAction = useMemo(() => {
    if (favoriteRestaurants.length === 0 && recentPlaces.length === 0) {
      return {
        title: "Find food near you",
        description:
          "Save places you want to try so your home screen starts getting useful suggestions.",
        ctaLabel: "Discover places",
        ctaHref: "/scout",
      };
    }

    if (favoriteRestaurants.length === 0) {
      return {
        title: "Your saved list is empty",
        description:
          "Recent places are showing, but saved spots make your next move faster.",
        ctaLabel: "Save a few favorites",
        ctaHref: "/favorites",
      };
    }

    if (nearbyNow.length === 0) {
      return {
        title: "Open Scout to refresh nearby options",
        description: "Deals you use will appear here as soon as nearby spots load.",
        ctaLabel: "Check nearby food now",
        ctaHref: "/scout",
      };
    }

    return {
      title: "What would you like to try next?",
      description: "Open one spot now and decide whether to go, call, or order.",
      ctaLabel: "Open Scout",
      ctaHref: "/scout",
    };
  }, [favoriteRestaurants.length, nearbyNow.length, recentPlaces.length]);

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const formatDistance = (distance?: number) => {
    if (typeof distance !== "number" || Number.isNaN(distance)) return null;
    if (distance < 1) {
      return `${Math.round(distance * 5280)} ft`;
    }
    return `${distance.toFixed(1)} mi`;
  };

  const getDealTypeBadge = (type: string) => {
    switch (type) {
      case "breakfast":
        return "bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]";
      case "lunch":
        return "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]";
      case "dinner":
        return "bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]";
      default:
        return "bg-[color:var(--border-subtle)]/50 text-[color:var(--text-secondary)]";
    }
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto bg-black min-h-screen flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-6">
          <User className="w-8 h-8 text-white/30" />
        </div>
        <h2 className="text-2xl font-serif font-bold text-white mb-3">
          Sign In Required
        </h2>
        <p className="text-white/50 text-sm mb-8">
          Sign in to resume your food trail and save places you want to try.
        </p>
        <Button
          asChild
          className="bg-primary text-black font-bold uppercase tracking-[0.2em] text-[10px] rounded-xl px-8 py-6"
          data-testid="button-sign-in"
        >
          <Link href="/login?redirect=%2Fuser-dashboard">Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-black min-h-screen pb-20">
      <SEOHead
        title="Your Flavor Trail - MealScout"
        description="Your MealScout dashboard for saved places, nearby food, recent activity, and what to try next."
        keywords="user dashboard, saved spots, nearby deals, mealscout"
        canonicalUrl="https://www.mealscout.us/user-dashboard"
        noIndex={true}
      />

      <header className="px-6 pt-8 pb-5 border-b border-white/5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-2">
          Your Flavor Trail
        </p>
        <div className="space-y-1">
          <h1 className="text-3xl font-serif font-bold text-white">
            {user?.firstName ? `Hey, ${user.firstName}.` : "Hey, Scout."}
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <MapPin className="h-3.5 w-3.5" />
            <span>{locationName}</span>
          </div>
        </div>
      </header>

      <section className="px-6 pt-4 pb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            asChild
            className="bg-primary text-black font-bold uppercase tracking-[0.2em] text-[10px] rounded-xl h-12"
          >
            <Link href="/scout">
              Open Scout
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button
            asChild
            className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-[0.2em] text-[10px] rounded-xl h-12"
          >
            <Link href="/map">Open Map</Link>
          </Button>
        </div>
      </section>

      <div className="px-6 pt-6 pb-24 space-y-7">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Saved spots
            </h2>
            <Button
              asChild
              variant="outline"
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
            >
              <Link href="/favorites">All saved</Link>
            </Button>
          </div>
          {favoritesLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : savedSpots.length > 0 ? (
            <div className="space-y-3">
              {savedSpots.map((restaurant) => (
                <Link
                  href={`/restaurant/${restaurant.id}`}
                  key={restaurant.id}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.08] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0">
                      <Utensils className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-white">
                        {restaurant.name}
                      </p>
                      <p className="text-xs text-white/45">
                        {restaurant.cuisineType || "Saved spot"}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6 text-center">
              <Heart className="h-8 w-8 text-white/25 mx-auto mb-3" />
              <p className="text-sm font-bold text-white">Save places you want to try</p>
              <p className="text-xs text-white/45 mt-2">
                Open Scout, explore once, and save your favorites for next time.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Nearby now
            </h2>
            <Button
              asChild
              variant="outline"
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              disabled={isLocationBusy}
            >
              <Link href="/scout">Explore now</Link>
            </Button>
          </div>
          {!location ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6">
              <p className="text-sm font-bold text-white">
                Find food near you
              </p>
              <p className="text-xs text-white/45 mt-2">
                Turn on location so nearby spots can show up on this page.
              </p>
            </div>
          ) : nearbyLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : nearbyNow.length > 0 ? (
            <div className="space-y-3">
              {nearbyNow.map((deal) => (
                <Link
                  href={`/deal/${deal.id}`}
                  key={deal.id}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.08] transition-colors"
                >
                  <p className="font-bold text-sm text-white">
                    {deal.title}
                  </p>
                  <p className="text-xs text-white/45 mt-1">
                    {deal.restaurant.name}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/35">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {deal.availableDuringBusinessHours
                        ? "Business hours"
                        : deal.startTime && deal.endTime
                          ? `${formatTime(deal.startTime)} - ${formatTime(
                              deal.endTime,
                            )}`
                          : "All day"}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {deal.discountValue}
                    </span>
                    {deal.distance !== undefined && (
                      <span>{formatDistance(deal.distance)}</span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-full ${getDealTypeBadge(
                        deal.dealType,
                      )}`}
                    >
                      {deal.dealType}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6">
              <Gift className="h-8 w-8 text-white/25 mx-auto mb-3" />
              <p className="text-sm font-bold text-white">
                No nearby deals yet
              </p>
              <p className="text-xs text-white/45 mt-2">
                Check back soon or open Scout to scan the neighborhood.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Deals near you
            </h2>
            <Button
              asChild
              variant="outline"
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
            >
              <Link href="/orders">Recent deals</Link>
            </Button>
          </div>
          {dealsNearYou.length > 0 ? (
            <div className="space-y-3">
              {dealsNearYou.map((deal) => (
                <Link
                  href={`/deal/${deal.id}`}
                  key={`${deal.id}-nearby`}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.08] transition-colors"
                >
                  <p className="font-bold text-sm text-white">
                    {deal.title}
                  </p>
                  <p className="text-xs text-white/45 mt-1">
                    {deal.restaurant.name}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6">
              <p className="text-sm font-bold text-white">Deals you use will appear here</p>
              <p className="text-xs text-white/45 mt-2">
                Keep saving spots and claiming food deals to build this section.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Recent places
          </h2>
          {claimedLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : recentPlaces.length > 0 ? (
            <div className="space-y-3">
              {recentPlaces.map((place) => (
                <Link
                  href={`/restaurant/${place.restaurantId}`}
                  key={place.id}
                  className="flex flex-wrap items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/[0.08] transition-colors"
                >
                  <div>
                    <p className="font-bold text-sm text-white">{place.name}</p>
                    <p className="text-xs text-white/45">
                      {place.cuisineType || "Recently visited spot"}
                    </p>
                  </div>
                  <span className="text-[10px] text-white/35">
                    {place.lastVisitedAt
                      ? new Date(place.lastVisitedAt).toLocaleDateString()
                      : "Recent"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-6">
              <p className="text-sm font-bold text-white">
                Recent places will show up after you explore
              </p>
              <p className="text-xs text-white/45 mt-2">
                Go on Scout and open a few spots, then this list will fill quickly.
              </p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-primary/30 bg-primary/10 p-4 space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
            Recommended next action
          </p>
          <div>
            <h3 className="text-lg font-bold text-white">{nextAction.title}</h3>
            <p className="text-sm text-white/65 mt-1.5">
              {nextAction.description}
            </p>
          </div>
          <Button
            asChild
            className="bg-primary text-black font-bold uppercase tracking-[0.2em] text-[10px] rounded-xl"
          >
            <Link href={nextAction.ctaHref}>
              {nextAction.ctaLabel}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Food community
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              onClick={() => setShowShare((value) => !value)}
            >
              {showShare ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 mr-1" />
                  Hide share
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />
                  Share links
                </>
              )}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="secondary"
              className="justify-start h-auto py-3 px-4 rounded-xl bg-white/5 border border-white/10 text-white"
              onClick={() => setShowVideos((value) => !value)}
            >
              <span className="text-left">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary block">
                  My videos
                </span>
                <span className="text-sm">
                  {showVideos ? "Hide recent videos" : "Upload or watch community clips"}
                </span>
              </span>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="justify-start h-auto py-3 px-4 rounded-xl bg-white/5 border border-white/10 text-white"
            >
              <Link href="/trending">
                <span className="text-left">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary block">
                    What&apos;s hot
                  </span>
                  <span className="text-sm">See food moments nearby</span>
                </span>
              </Link>
            </Button>
          </div>
          {showVideos && <VideoCreatorSection userId={user?.id} />}
          {showShare && (
            <ShareHub
              mode="user"
              title="Share Hub"
              description="Useful links you can share in one tap to help grow MealScout."
            />
          )}
        </section>
      </div>

      <Navigation />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideoCreatorSection — My Videos tab content
// ---------------------------------------------------------------------------

interface VideoStoryItem {
  id: string;
  title: string;
  description?: string | null;
  videoUrl: string;
  thumbnailUrl?: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  duration?: number | null;
  createdAt: string;
  expiresAt?: string | null;
  status: string;
}

interface ReviewerLevel {
  level: number;
  totalFavorites: number;
  totalStories: number;
  topStoryFavorites: number;
}

const LEVEL_LABELS: Record<number, string> = {
  1: "Newcomer",
  2: "Regular",
  3: "Foodie",
  4: "Critic",
  5: "Influencer",
  6: "Legend",
};

function VideoCreatorSection({ userId }: { userId?: string }) {
  const [stories, setStories] = useState<VideoStoryItem[]>([]);
  const [reviewerLevel, setReviewerLevel] = useState<ReviewerLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [storiesRes, levelRes] = await Promise.all([
        fetch(`/api/stories/user/${userId}`, { credentials: "include" }),
        fetch(`/api/stories/reviewer-level/${userId}`, { credentials: "include" }),
      ]);
      if (storiesRes.ok) {
        const data = await storiesRes.json();
        setStories(Array.isArray(data.stories) ? data.stories : []);
      }
      if (levelRes.ok) {
        setReviewerLevel(await levelRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async (storyId: string) => {
    if (!confirm("Delete this video? This cannot be undone.")) return;
    setDeletingId(storyId);
    try {
      const res = await fetch(`/api/stories/${storyId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setStories((prev) => prev.filter((s) => s.id !== storyId));
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-white/40">
        <Loader2 className="h-6 w-6 animate-spin mr-2 text-primary" />
        <span className="text-sm">Loading your videos...</span>
      </div>
    );
  }

  const totalViews = stories.reduce((sum, s) => sum + (s.viewCount ?? 0), 0);
  const totalLikes = stories.reduce((sum, s) => sum + (s.likeCount ?? 0), 0);

  return (
    <div className="space-y-5">
      {reviewerLevel && (
        <div className="bg-gradient-to-r from-amber-900/30 to-black border border-primary/20 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-amber-400 flex items-center justify-center text-black font-bold text-lg">
              {reviewerLevel.level}
            </div>
            <div>
              <p className="font-bold text-white">
                {LEVEL_LABELS[reviewerLevel.level] ?? `Level ${reviewerLevel.level}`}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Reviewer Level</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 sm:ml-auto text-sm">
            <div className="flex items-center gap-1.5 text-white/40">
              <Video className="h-4 w-4 text-primary" />
              <span className="font-bold text-white">{reviewerLevel.totalStories}</span> videos
            </div>
            <div className="flex items-center gap-1.5 text-white/40">
              <Eye className="h-4 w-4 text-primary" />
              <span className="font-bold text-white">{totalViews.toLocaleString()}</span> views
            </div>
            <div className="flex items-center gap-1.5 text-white/40">
              <ThumbsUp className="h-4 w-4 text-primary" />
              <span className="font-bold text-white">{totalLikes.toLocaleString()}</span> likes
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">My Videos ({stories.length})</span>
        <Button
          className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-amber-400"
          size="sm"
          onClick={() => setIsUploadOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Upload
        </Button>
      </div>

      {stories.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
          <Video className="h-10 w-10 mx-auto text-white/20 mb-4" />
          <h3 className="text-lg font-serif font-bold text-white mb-2">No videos yet</h3>
          <p className="text-white/40 text-sm mb-6">Share your food recommendations with the community.</p>
          <Button className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-6 py-5" onClick={() => setIsUploadOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Upload Your First Video
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {stories.map((story) => (
            <div key={story.id} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
              <div className="flex gap-3 p-3">
                <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/5 relative">
                  {story.thumbnailUrl ? (
                    <img src={story.thumbnailUrl} alt={story.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="h-8 w-8 text-white/20" />
                    </div>
                  )}
                  {story.duration && (
                    <span className="absolute bottom-1 right-1 text-[10px] bg-black/80 text-white px-1.5 rounded-md font-bold">
                      {story.duration}s
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-white truncate">{story.title}</p>
                  {story.description && (
                    <p className="text-xs text-white/40 line-clamp-1 mt-0.5">{story.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-white/30">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {(story.viewCount ?? 0).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <ThumbsUp className="h-3 w-3" />
                      {(story.likeCount ?? 0).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {(story.commentCount ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/20 mt-1">
                    {new Date(story.createdAt).toLocaleDateString()}
                    {story.expiresAt && <> · expires {new Date(story.expiresAt).toLocaleDateString()}</>}
                  </p>
                </div>
                <button
                  className="shrink-0 self-start p-1.5 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  onClick={() => handleDelete(story.id)}
                  disabled={deletingId === story.id}
                  title="Delete video"
                >
                  {deletingId === story.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <VideoUploadModal
        isOpen={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false);
          loadData();
        }}
      />
    </div>
  );
}
