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
import { Link } from "wouter";
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
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [locationName, setLocationName] = useState("Getting location...");

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
      <div className="max-w-md mx-auto text-center py-12">
        <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">Sign In Required</h2>
        <p className="text-muted-foreground mb-4">
          Please sign in to view your dashboard.
        </p>
        <Button asChild data-testid="button-sign-in">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen pb-20">
      <SEOHead
        title="My Dashboard - MealScout | Track Your Specials & Savings"
        description="View your personal dashboard with special history, savings tracker, favorite restaurants, and personalized recommendations. Track your food special journey on MealScout."
        keywords="user dashboard, my specials, savings tracker, special history, favorite restaurants"
        canonicalUrl="https://www.mealscout.us/user-dashboard"
        noIndex={true}
      />
      {/* Header */}
      <header className="px-4 sm:px-6 py-6 bg-[linear-gradient(110deg,rgba(255,77,46,0.10),rgba(245,158,11,0.08))] border-b border-[color:var(--border-subtle)] shadow-clean">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Dashboard</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{locationName}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Welcome back</div>
            <div className="font-semibold" data-testid="text-user-welcome">
              {user?.firstName ? `${user.firstName}!` : "Food Explorer!"}
            </div>
          </div>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="px-4 sm:px-6 py-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                Specials Used
              </CardDescription>
              <CardTitle className="text-2xl">
                {userStats?.totalDealsUsed || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Total Saved
              </CardDescription>
              <CardTitle className="text-2xl text-[color:var(--status-success)]">
                {formatCurrency(userStats?.totalSavings || 0)}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Heart className="h-4 w-4" />
                Favorites
              </CardDescription>
              <CardTitle className="text-2xl">
                {userStats?.favoriteRestaurants || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                This Month
              </CardDescription>
              <CardTitle className="text-2xl">
                {userStats?.dealsThisMonth || 0}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="px-4 sm:px-6">
        <Tabs defaultValue="recent" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-6">
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="nearby">Nearby</TabsTrigger>
            <TabsTrigger value="favorites">Favorites</TabsTrigger>
            <TabsTrigger value="recommended">For You</TabsTrigger>
            <TabsTrigger value="videos">My Videos</TabsTrigger>
            <TabsTrigger value="share">Share Hub</TabsTrigger>
          </TabsList>

          <TabsContent value="recent" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Recent Activity</h3>
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="button-view-all-orders"
              >
                <Link href="/orders">View All</Link>
              </Button>
            </div>

            {claimedLoading ? (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                </CardContent>
              </Card>
            ) : claimedDeals.length > 0 ? (
              <div className="space-y-3">
                {claimedDeals.slice(0, 5).map((claim) => (
                  <Card
                    key={claim.id}
                    className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">
                              {claim.deal.title}
                            </h4>
                            <Badge
                              className={getDealTypeColor(claim.deal.dealType)}
                            >
                              {claim.deal.dealType}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">
                            {claim.restaurant.name}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {claim.claimedAt
                                ? new Date(claim.claimedAt).toLocaleDateString()
                                : "Unknown"}
                            </span>
                            <span className="flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              {claim.deal.discountValue}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          data-testid={`button-view-deal-${claim.deal.id}`}
                        >
                          <Link href={`/deal/${claim.deal.id}`}>View</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="text-center py-12">
                  <Gift className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No specials claimed yet
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Start discovering amazing specials near you!
                  </p>
                  <Button asChild data-testid="button-explore-deals">
                    <Link href="/">Explore Specials</Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="nearby" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Specials Near You</h3>
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="button-view-map"
              >
                <Link href="/map">View Map</Link>
              </Button>
            </div>

            {nearbyLoading ? (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                </CardContent>
              </Card>
            ) : nearbyDeals.length > 0 ? (
              <div className="space-y-3">
                {nearbyDeals.slice(0, 5).map((deal) => (
                  <Card
                    key={deal.id}
                    className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{deal.title}</h4>
                            <Badge className={getDealTypeColor(deal.dealType)}>
                              {deal.dealType}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">
                            {deal.restaurant.name}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {deal.availableDuringBusinessHours
                                ? "During business hours"
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
                            {(deal as any).distance !== undefined && (
                              <span className="flex items-center gap-1">
                                <NavigationIcon className="h-3 w-3" />
                                {(deal as any).distance.toFixed(1)}mi
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          data-testid={`button-view-nearby-${deal.id}`}
                        >
                          <Link href={`/deal/${deal.id}`}>View</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="text-center py-12">
                  <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No nearby specials
                  </h3>
                  <p className="text-muted-foreground">
                    Check back later for specials in your area.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="favorites" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Favorite Restaurants</h3>
              <Button
                variant="outline"
                size="sm"
                asChild
                data-testid="button-view-all-favorites"
              >
                <Link href="/favorites">View All</Link>
              </Button>
            </div>

            {favoritesLoading ? (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                </CardContent>
              </Card>
            ) : favoriteRestaurants.length > 0 ? (
              <div className="space-y-3">
                {favoriteRestaurants.slice(0, 5).map((restaurant) => (
                  <Card
                    key={restaurant.id}
                    className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-[color:var(--accent-text)]/12 rounded-lg flex items-center justify-center">
                            <Utensils className="h-6 w-6 text-[color:var(--accent-text)]" />
                          </div>
                          <div>
                            <h4 className="font-semibold">{restaurant.name}</h4>
                            <p className="text-sm text-muted-foreground">
                              {restaurant.cuisineType}
                            </p>
                            <div className="flex items-center gap-1 mt-1">
                              <Star className="h-3 w-3 text-[color:var(--status-warning)] fill-current" />
                              <span className="text-xs text-muted-foreground">
                                {(restaurant as any).averageRating?.toFixed(
                                  1,
                                ) || "New"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          data-testid={`button-view-restaurant-${restaurant.id}`}
                        >
                          <Link href={`/restaurant/${restaurant.id}`}>
                            View
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="text-center py-12">
                  <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    No favorites yet
                  </h3>
                  <p className="text-muted-foreground">
                    Start exploring and save your favorite restaurants!
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="recommended" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Recommended For You</h3>
            </div>

            {recommendedDeals.length > 0 ? (
              <div className="space-y-3">
                {recommendedDeals.slice(0, 5).map((deal) => (
                  <Card
                    key={deal.id}
                    className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{deal.title}</h4>
                            <Badge className={getDealTypeColor(deal.dealType)}>
                              {deal.dealType}
                            </Badge>
                            <Badge variant="secondary">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              Recommended
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">
                            {deal.restaurant.name}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {deal.availableDuringBusinessHours
                                ? "During business hours"
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
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          data-testid={`button-view-recommended-${deal.id}`}
                        >
                          <Link href={`/deal/${deal.id}`}>View</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="text-center py-12">
                  <ChefHat className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    Building recommendations
                  </h3>
                  <p className="text-muted-foreground">
                    Use more specials to get personalized recommendations!
                  </p>
                </CardContent>
              </Card>
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
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading your videos...
      </div>
    );
  }

  const totalViews = stories.reduce((sum, s) => sum + (s.viewCount ?? 0), 0);
  const totalLikes = stories.reduce((sum, s) => sum + (s.likeCount ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Reviewer level card */}
      {reviewerLevel && (
        <Card className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-200/30 shadow-clean">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white font-bold text-lg shadow">
                {reviewerLevel.level}
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {LEVEL_LABELS[reviewerLevel.level] ?? `Level ${reviewerLevel.level}`}
                </p>
                <p className="text-xs text-muted-foreground">Reviewer Level</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 sm:ml-auto text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Video className="h-4 w-4 text-orange-500" />
                <span className="font-semibold text-foreground">{reviewerLevel.totalStories}</span> videos
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Eye className="h-4 w-4 text-blue-500" />
                <span className="font-semibold text-foreground">{totalViews.toLocaleString()}</span> views
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <ThumbsUp className="h-4 w-4 text-pink-500" />
                <span className="font-semibold text-foreground">{totalLikes.toLocaleString()}</span> likes
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">My Videos ({stories.length})</h3>
        <Button size="sm" onClick={() => setIsUploadOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Upload Video
        </Button>
      </div>

      {/* Video list */}
      {stories.length === 0 ? (
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardContent className="text-center py-12">
            <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-40" />
            <h3 className="text-lg font-semibold mb-2">No videos yet</h3>
            <p className="text-muted-foreground mb-4">
              Share your food recommendations with the community!
            </p>
            <Button onClick={() => setIsUploadOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Upload Your First Video
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {stories.map((story) => (
            <Card
              key={story.id}
              className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean overflow-hidden"
            >
              <CardContent className="p-0">
                <div className="flex gap-3 p-3">
                  {/* Thumbnail */}
                  <div className="shrink-0 w-20 h-20 rounded-md overflow-hidden bg-muted relative">
                    {story.thumbnailUrl ? (
                      <img
                        src={story.thumbnailUrl}
                        alt={story.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Video className="h-8 w-8 text-muted-foreground opacity-40" />
                      </div>
                    )}
                    {story.duration && (
                      <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 text-white px-1 rounded">
                        {story.duration}s
                      </span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{story.title}</p>
                    {story.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                        {story.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
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
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(story.createdAt).toLocaleDateString()}
                      {story.expiresAt && (
                        <> · expires {new Date(story.expiresAt).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  {/* Delete */}
                  <button
                    className="shrink-0 self-start p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
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
              </CardContent>
            </Card>
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
