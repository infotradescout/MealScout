import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import {
  User,
  Heart,
  Receipt,
  TrendingUp,
  MapPin,
  Clock,
  Star,
  DollarSign,
  Calendar,
  Gift,
  Utensils,
  Navigation as NavigationIcon,
  ChefHat,
  Video,
  Eye,
  ThumbsUp,
  MessageCircle,
  Trash2,
  Loader2,
  Award,
  Plus,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { VideoUploadModal } from "@/components/video-upload-modal";
import type { Deal, Restaurant, DealClaim } from "@shared/schema";
import { SEOHead } from "@/components/seo-head";
import ShareHub from "@/components/share-hub";

interface UserStats {
  totalDealsUsed: number;
  totalSavings: number;
  favoriteRestaurants: number;
  averageRating: number;
  dealsThisMonth: number;
}

export default function UserDashboard() {
  const { user } = useAuth();
  const [routeLocation] = useLocation();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locationName, setLocationName] = useState("Getting location...");
  const [activeTab, setActiveTab] = useState<
    "recent" | "nearby" | "favorites" | "recommended" | "videos" | "share"
  >("recent");

  useEffect(() => {
    const tabParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("tab")
        : null;
    setActiveTab(tabParam === "share" ? "share" : "recent");
  }, [routeLocation]);

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
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
            });
        },
        () => {
          setLocationName("Location unavailable");
        },
      );
    }
  }, []);

  // Fetch user stats
  const { data: userStats } = useQuery<UserStats>({
    queryKey: ["/api/users/stats"],
    enabled: !!user,
  });

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
    (Deal & { restaurant: Restaurant })[]
  >({
    queryKey: ["/api/deals/nearby", location?.lat, location?.lng],
    enabled: !!location,
  });

  // Fetch recommended deals based on user preferences
  const { data: recommendedDeals = [] } = useQuery<
    (Deal & { restaurant: Restaurant })[]
  >({
    queryKey: ["/api/deals/recommended"],
    enabled: !!user,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getDealTypeColor = (type: string) => {
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
        <h2 className="text-2xl font-serif font-bold text-white mb-3">Sign In Required</h2>
        <p className="text-white/50 text-sm mb-8">Sign in to access your flavor trail, saved spots, and videos.</p>
        <Button asChild className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-8 py-6" data-testid="button-sign-in">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-black min-h-screen pb-20">
      <SEOHead
        title="My Dashboard - MealScout | Track Your Specials & Savings"
        description="View your personal dashboard with special history, savings tracker, favorite restaurants, and personalized recommendations. Track your food special journey on MealScout."
        keywords="user dashboard, my specials, savings tracker, special history, favorite restaurants"
        canonicalUrl="https://www.mealscout.us/user-dashboard"
        noIndex={true}
      />
      {/* Header */}
      <header className="px-6 pt-8 pb-6 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Your Flavor Trail</p>
            <h1 className="text-3xl font-serif font-bold text-white" data-testid="text-user-welcome">
              {user?.firstName ? `Hey, ${user.firstName}.` : "Hey, Scout."}
            </h1>
            <div className="flex items-center gap-1.5 mt-2 text-xs text-white/40">
              <MapPin className="h-3.5 w-3.5" />
              <span>{locationName}</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-6 h-6 text-primary" />
          </div>
        </div>
      </header>

      {/* Stats Strip */}
      <div className="px-6 py-6 border-b border-white/5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Receipt, label: "Specials Used", value: userStats?.totalDealsUsed || 0, color: "text-white" },
            { icon: DollarSign, label: "Total Saved", value: formatCurrency(userStats?.totalSavings || 0), color: "text-emerald-400" },
            { icon: Heart, label: "Saved Spots", value: userStats?.favoriteRestaurants || 0, color: "text-white" },
            { icon: Calendar, label: "This Month", value: userStats?.dealsThisMonth || 0, color: "text-white" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</span>
              </div>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="px-6 pt-6">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(
              value as
                | "recent"
                | "nearby"
                | "favorites"
                | "recommended"
                | "videos"
                | "share",
            )
          }
          className="space-y-6"
        >
          <TabsList className="flex w-full gap-1 overflow-x-auto bg-white/5 border border-white/10 rounded-2xl p-1 h-auto">
            {["recent","nearby","favorites","recommended","videos","share"].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="flex-1 min-w-fit text-[10px] font-bold uppercase tracking-widest rounded-xl py-2.5 px-3 text-white/40 data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-none transition-all"
              >
                {tab === "recent" ? "Recent" : tab === "nearby" ? "Nearby" : tab === "favorites" ? "Favorites" : tab === "recommended" ? "For You" : tab === "videos" ? "Videos" : "Share"}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="recent" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Recent Activity</span>
              <Button className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-white/10" size="sm" asChild data-testid="button-view-all-orders">
                <Link href="/orders">View All</Link>
              </Button>
            </div>
            {claimedLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : claimedDeals.length > 0 ? (
              <div className="space-y-3">
                {claimedDeals.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-bold text-sm text-white truncate">{claim.deal.title}</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getDealTypeColor(claim.deal.dealType)}`}>{claim.deal.dealType}</span>
                      </div>
                      <p className="text-xs text-white/50 mb-2">{claim.restaurant.name}</p>
                      <div className="flex items-center gap-4 text-[10px] text-white/30">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{claim.claimedAt ? new Date(claim.claimedAt).toLocaleDateString() : "Unknown"}</span>
                        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{claim.deal.discountValue}</span>
                      </div>
                    </div>
                    <Button className="bg-white/5 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl px-3 py-2 hover:bg-white/10 flex-shrink-0" size="sm" asChild data-testid={`button-view-deal-${claim.deal.id}`}>
                      <Link href={`/deal/${claim.deal.id}`}>View</Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
                <Gift className="h-10 w-10 mx-auto text-white/20 mb-4" />
                <h3 className="text-lg font-serif font-bold text-white mb-2">No specials claimed yet</h3>
                <p className="text-white/40 text-sm mb-6">Start discovering amazing specials near you.</p>
                <Button className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-6 py-5" asChild data-testid="button-explore-deals">
                  <Link href="/">Scout Specials</Link>
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="nearby" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Specials Near You</span>
              <Button className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-white/10" size="sm" asChild data-testid="button-view-map">
                <Link href="/map">View Map</Link>
              </Button>
            </div>
            {nearbyLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : nearbyDeals.length > 0 ? (
              <div className="space-y-3">
                {nearbyDeals.slice(0, 5).map((deal) => (
                  <div key={deal.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-bold text-sm text-white truncate">{deal.title}</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getDealTypeColor(deal.dealType)}`}>{deal.dealType}</span>
                      </div>
                      <p className="text-xs text-white/50 mb-2">{deal.restaurant.name}</p>
                      <div className="flex items-center gap-4 text-[10px] text-white/30">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{deal.availableDuringBusinessHours ? "Business hours" : deal.startTime && deal.endTime ? `${formatTime(deal.startTime)} - ${formatTime(deal.endTime)}` : "All day"}</span>
                        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{deal.discountValue}</span>
                        {(deal as any).distance !== undefined && <span className="flex items-center gap-1"><NavigationIcon className="h-3 w-3" />{(deal as any).distance.toFixed(1)}mi</span>}
                      </div>
                    </div>
                    <Button className="bg-white/5 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl px-3 py-2 hover:bg-white/10 flex-shrink-0" size="sm" asChild data-testid={`button-view-nearby-${deal.id}`}>
                      <Link href={`/deal/${deal.id}`}>View</Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
                <MapPin className="h-10 w-10 mx-auto text-white/20 mb-4" />
                <h3 className="text-lg font-serif font-bold text-white mb-2">No nearby specials</h3>
                <p className="text-white/40 text-sm">Check back later for specials in your area.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="favorites" className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Saved Spots</span>
              <Button className="bg-white/5 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-white/10" size="sm" asChild data-testid="button-view-all-favorites">
                <Link href="/favorites">View All</Link>
              </Button>
            </div>
            {favoritesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : favoriteRestaurants.length > 0 ? (
              <div className="space-y-3">
                {favoriteRestaurants.slice(0, 5).map((restaurant) => (
                  <div key={restaurant.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Utensils className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-white">{restaurant.name}</h4>
                        <p className="text-xs text-white/40">{restaurant.cuisineType}</p>
                        {(restaurant as any).averageRating && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star className="h-3 w-3 text-primary fill-primary" />
                            <span className="text-[10px] text-white/40">{(restaurant as any).averageRating.toFixed(1)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button className="bg-white/5 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl px-3 py-2 hover:bg-white/10 flex-shrink-0" size="sm" asChild data-testid={`button-view-restaurant-${restaurant.id}`}>
                      <Link href={`/restaurant/${restaurant.id}`}>Pull Up</Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
                <Heart className="h-10 w-10 mx-auto text-white/20 mb-4" />
                <h3 className="text-lg font-serif font-bold text-white mb-2">No saved spots yet</h3>
                <p className="text-white/40 text-sm">Scout local places and save the ones worth coming back to.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="recommended" className="space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary block">For You</span>
            {recommendedDeals.length > 0 ? (
              <div className="space-y-3">
                {recommendedDeals.slice(0, 5).map((deal) => (
                  <div key={deal.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-bold text-sm text-white truncate">{deal.title}</h4>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getDealTypeColor(deal.dealType)}`}>{deal.dealType}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/20 text-primary flex items-center gap-1"><TrendingUp className="h-2.5 w-2.5" />Recommended</span>
                      </div>
                      <p className="text-xs text-white/50 mb-2">{deal.restaurant.name}</p>
                      <div className="flex items-center gap-4 text-[10px] text-white/30">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{deal.availableDuringBusinessHours ? "Business hours" : deal.startTime && deal.endTime ? `${formatTime(deal.startTime)} - ${formatTime(deal.endTime)}` : "All day"}</span>
                        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{deal.discountValue}</span>
                      </div>
                    </div>
                    <Button className="bg-white/5 border border-white/10 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl px-3 py-2 hover:bg-white/10 flex-shrink-0" size="sm" asChild data-testid={`button-view-recommended-${deal.id}`}>
                      <Link href={`/deal/${deal.id}`}>View</Link>
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center">
                <ChefHat className="h-10 w-10 mx-auto text-white/20 mb-4" />
                <h3 className="text-lg font-serif font-bold text-white mb-2">Building recommendations</h3>
                <p className="text-white/40 text-sm">Use more specials to get personalized picks.</p>
              </div>
            )}
          </TabsContent>

          {/* ── My Videos Tab ── */}
          <TabsContent value="videos" className="space-y-4">
            <VideoCreatorSection userId={user?.id} />
          </TabsContent>

          <TabsContent value="share" className="space-y-4">
            <ShareHub
              mode="user"
              title="Share Hub"
              description="Useful links you can share in one tap to help grow MealScout."
            />
          </TabsContent>
        </Tabs>
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
      {/* Reviewer level card */}
      {reviewerLevel && (
        <div className="bg-gradient-to-r from-amber-900/30 to-black border border-primary/20 rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-amber-400 flex items-center justify-center text-black font-bold text-lg">
              {reviewerLevel.level}
            </div>
            <div>
              <p className="font-bold text-white">{LEVEL_LABELS[reviewerLevel.level] ?? `Level ${reviewerLevel.level}`}</p>
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

      {/* Upload button */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">My Videos ({stories.length})</span>
        <Button className="bg-primary text-black font-bold uppercase tracking-widest text-[10px] rounded-xl px-4 py-2 hover:bg-amber-400" size="sm" onClick={() => setIsUploadOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Upload
        </Button>
      </div>

      {/* Video list */}
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
                {/* Thumbnail */}
                <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-white/5 relative">
                  {story.thumbnailUrl ? (
                    <img src={story.thumbnailUrl} alt={story.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Video className="h-8 w-8 text-white/20" />
                    </div>
                  )}
                  {story.duration && (
                    <span className="absolute bottom-1 right-1 text-[10px] bg-black/80 text-white px-1.5 rounded-md font-bold">{story.duration}s</span>
                  )}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-white truncate">{story.title}</p>
                  {story.description && <p className="text-xs text-white/40 line-clamp-1 mt-0.5">{story.description}</p>}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-white/30">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{(story.viewCount ?? 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{(story.likeCount ?? 0).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{(story.commentCount ?? 0).toLocaleString()}</span>
                  </div>
                  <p className="text-[10px] text-white/20 mt-1">{new Date(story.createdAt).toLocaleDateString()}{story.expiresAt && <> · expires {new Date(story.expiresAt).toLocaleDateString()}</>}</p>
                </div>
                {/* Delete */}
                <button
                  className="shrink-0 self-start p-1.5 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  onClick={() => handleDelete(story.id)}
                  disabled={deletingId === story.id}
                  title="Delete video"
                >
                  {deletingId === story.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload modal */}
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
