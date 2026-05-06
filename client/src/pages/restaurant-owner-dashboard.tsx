import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import DocumentUpload from "@/components/document-upload";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation } from "wouter";
import ShareButton from "@/components/share-button";
import {
  Store,
  Plus,
  TrendingUp,
  Users,
  DollarSign,
  Eye,
  ShoppingCart,
  Star,
  Calendar,
  Settings,
  CreditCard,
  BarChart3,
  MapPin,
  Clock,
  Edit,
  Download,
  Calendar as CalendarIcon,
  RefreshCw,
  Truck,
  Navigation as NavigationIcon,
  Radio,
  Power,
  PowerOff,
  Wifi,
  WifiOff,
  Activity,
  AlertCircle,
  CheckCircle,
  MessageCircle,
  Play,
  Square,
  Loader2,
  Zap,
  Smartphone,
  Satellite,
  Save,
  RotateCcw,
  ShieldCheck,
  Briefcase,
  ExternalLink,
  UtensilsCrossed,
} from "lucide-react";
import Navigation from "@/components/navigation";
import RestaurantCreditRedemptionForm from "@/components/RestaurantCreditRedemptionForm";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { useFoodTruckSocket } from "@/hooks/useFoodTruckSocket";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { z } from "zod";
import type { Deal, Restaurant } from "@shared/schema";
import { BackHeader } from "@/components/back-header";
import OwnerOnboardingChecklist from "@/components/OwnerOnboardingChecklist";
import { SEOHead } from "@/components/seo-head";
import { HelpWantedQuickAction } from "@/components/HelpWantedQuickAction";

interface DashboardStats {
  totalDeals: number;
  activeDeals: number;
  totalViews: number;
  totalClaims: number;
  conversionRate: number;
  averageRating: number;
}

interface FavoritesAnalytics {
  totalFavorites: number;
  newFavorites: number;
  favoritesGrowth: number;
}

interface RecommendationsAnalytics {
  totalRecommendations: number;
  clickThroughRate: number;
  impressions: number;
  clicks: number;
}

interface TruckBookingItem {
  id: string;
  eventId: string;
  truckId: string;
  status: string;
  totalCents: number;
  hostPriceCents: number;
  platformFeeCents: number;
  bookingConfirmedAt?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
  event?: {
    id: string;
    date?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    status?: string | null;
    host?: {
      businessName?: string | null;
      address?: string | null;
      locationType?: string | null;
    };
  } | null;
}

interface OnboardingCompletion {
  restaurantId: string;
  overallPct: number;
  required: {
    done: number;
    total: number;
    missing: Array<{ key: string; label: string; ok: boolean }>;
  };
  recommended: {
    done: number;
    total: number;
    missing: Array<{ key: string; label: string; ok: boolean }>;
  };
  verification: {
    status: "verified" | "pending" | "not_submitted";
    isVerified: boolean;
    needsSubmission: boolean;
    snoozed?: boolean;
    snoozedAt?: string | null;
    snoozedUntil?: string | null;
  };
  insurance?: {
    required: boolean;
    status: "valid" | "pending" | "rejected" | "expired" | "not_submitted";
    valid: boolean;
  };
}

interface OwnerMenuSummary {
  id: string;
  name: string;
  isActive: boolean;
}

type AnalyticsDateRange = {
  start: string;
  end: string;
};

const DEAL_IMAGE_FALLBACK = "/og-default.jpg";

const buildRestaurantAnalyticsUrl = (
  restaurantId: string,
  segment: string,
  range: AnalyticsDateRange,
) => {
  const params = new URLSearchParams({
    startDate: range.start,
    endDate: range.end,
  });
  return `/api/restaurants/${encodeURIComponent(
    restaurantId,
  )}/analytics/${segment}?${params.toString()}`;
};

const fetchRestaurantAnalytics = async <T,>(
  restaurantId: string,
  segment: string,
  range: AnalyticsDateRange,
): Promise<T> => {
  const res = await apiRequest(
    "GET",
    buildRestaurantAnalyticsUrl(restaurantId, segment, range),
  );
  return (await res.json()) as T;
};

const normalizeDealImageUrl = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return DEAL_IMAGE_FALLBACK;
  if (/^(data:|blob:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("uploads/") || raw.startsWith("api/")) return `/${raw}`;
  return `https://${raw}`;
};

const getDealImageUrl = (deal: any): string => {
  const candidate = [
    deal?.imageUrl,
    deal?.image_url,
    deal?.photoUrl,
    deal?.thumbnailUrl,
    deal?.mediaUrl,
  ].find((value) => String(value || "").trim().length > 0);

  return normalizeDealImageUrl(candidate);
};

export default function RestaurantOwnerDashboard() {
  const LAST_RESTAURANT_KEY = "mealscout:last-selected-restaurant-id";
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const requestedRestaurantId = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      return (
        new URLSearchParams(window.location.search)
          .get("restaurantId")
          ?.trim() || ""
      );
    } catch {
      return "";
    }
  }, []);
  const [selectedRestaurant, setSelectedRestaurant] = useState<string>("");
  const [analyticsDateRange, setAnalyticsDateRange] = useState({
    start: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    end: format(new Date(), "yyyy-MM-dd"),
  });
  const [comparisonPeriod, setComparisonPeriod] = useState<
    "week" | "month" | "quarter"
  >("month");
  const [onboardingDocuments, setOnboardingDocuments] = useState<string[]>([]);
  const [onboardingLicenseNumber, setOnboardingLicenseNumber] = useState("");
  const [insuranceForm, setInsuranceForm] = useState({
    carrierName: "",
    policyNumber: "",
    expiresAt: "",
    coverageAmount: "",
    attestedCommercialCoverage: false,
    attestedJurisdictionCompliance: false,
  });
  const [verificationUploadOpen, setVerificationUploadOpen] = useState(false);
  const [verificationSkippedToday, setVerificationSkippedToday] =
    useState(false);
  const [cateringForm, setCateringForm] = useState({
    headline: "",
    description: "",
    serviceArea: "",
    minimumGuests: "",
    leadTimeDays: "",
    contactPreference: "",
  });

  // Food truck state
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
    timestamp?: number;
  } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [gpsWatchId, setGpsWatchId] = useState<number | null>(null);
  const [lastBroadcast, setLastBroadcast] = useState<Date | null>(null);
  const [broadcastCount, setBroadcastCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "connecting"
  >("disconnected");
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const isRestaurantOwner =
    user?.userType === "restaurant_owner" ||
    user?.userType === "caterer" ||
    user?.userType === "private_chef";
  const isFoodTruck = user?.userType === "food_truck";
  const isHost = user?.userType === "host";
  const isAdmin =
    user?.userType === "admin" || user?.userType === "super_admin";
  const isStaff = user?.userType === "staff";
  const { data: businessAccess } = useQuery<{
    hasAnyAccess: boolean;
    permissions: {
      manageDeals: boolean;
      manageParkingPass: boolean;
      viewAnalytics: boolean;
      manageProfile: boolean;
    };
  }>({
    queryKey: ["/api/business-access/me"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const canManageDeals =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.manageDeals === true;
  const canManageParkingPass =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.manageParkingPass === true;
  const canViewAnalytics =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.viewAnalytics === true;
  const canManageProfile =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.manageProfile === true;

  useEffect(() => {
    if (!user) return;

    // Restaurant owners and food trucks share this dashboard, plus staff/admin access.
    const hasTeamAccess = Boolean(businessAccess?.hasAnyAccess);
    if (
      !isRestaurantOwner &&
      !isFoodTruck &&
      !isHost &&
      !isAdmin &&
      !isStaff &&
      !hasTeamAccess
    ) {
      setLocation("/");
    }
  }, [
    user,
    isRestaurantOwner,
    isFoodTruck,
    isHost,
    isAdmin,
    isStaff,
    businessAccess?.hasAnyAccess,
    setLocation,
  ]);

  // Location update state
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);
  const [locationUpdateError, setLocationUpdateError] = useState<string | null>(
    null,
  );

  // WebSocket integration for real-time updates
  const {
    isConnected,
    connectionError: wsError,
    subscribeToRestaurant,
    connect: connectWS,
    disconnect: disconnectWS,
  } = useFoodTruckSocket({
    onLocationUpdate: (location) => {
      console.log("Received location update:", location);
      // Update UI with real-time location data from other sources if needed
    },
    onStatusUpdate: (status) => {
      console.log("Received status update:", status);
      // Handle status updates from server
    },
    autoConnect: true,
  });

  // Fetch user's restaurants
  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery<
    Restaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: !!user,
  });

  // Fetch subscription status (no aggressive retries to avoid 503 spam)
  const { data: subscription } = useQuery<{
    status: string;
    hasAccess: boolean;
  }>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const isOwnerOrFoodTruck = isRestaurantOwner || isFoodTruck;
  const subscriptionHasAccess =
    (subscription as any)?.status === "active" ||
    (subscription as any)?.hasAccess === true;
  const hasManagedDealAccess =
    !isOwnerOrFoodTruck && businessAccess?.permissions?.manageDeals === true;
  const canCreateDealsNow =
    isAdmin || isStaff || subscriptionHasAccess || hasManagedDealAccess;

  const { data: onboardingCompletion, isLoading: loadingOnboardingCompletion } =
    useQuery<OnboardingCompletion>({
      queryKey: [
        `/api/restaurants/${selectedRestaurant}/onboarding/completion`,
      ],
      enabled: !!selectedRestaurant,
      retry: false,
      refetchOnWindowFocus: false,
    });
  const hasPremiumLocationTools =
    canManageParkingPass &&
    (isAdmin ||
      isStaff ||
      isRestaurantOwner ||
      isFoodTruck ||
      Boolean(subscription?.hasAccess));
  const hasAnalyticsAccess =
    canViewAnalytics &&
    (isAdmin || isStaff || Boolean(subscription?.hasAccess));
  const canManageBilling =
    isAdmin || isStaff || isRestaurantOwner || isFoodTruck;

  // Fetch favorites analytics for paid users
  const { data: favoritesAnalytics, isLoading: loadingFavorites } =
    useQuery<FavoritesAnalytics>({
      queryKey: [
        "restaurant-analytics-favorites",
        selectedRestaurant,
        analyticsDateRange.start,
        analyticsDateRange.end,
      ],
      queryFn: () =>
        fetchRestaurantAnalytics<FavoritesAnalytics>(
          selectedRestaurant,
          "favorites",
          analyticsDateRange,
        ),
      enabled: !!selectedRestaurant && hasAnalyticsAccess,
      retry: false,
      refetchOnWindowFocus: false,
    });

  // Fetch recommendations analytics for paid users
  const { data: recommendationsAnalytics, isLoading: loadingRecommendations } =
    useQuery<RecommendationsAnalytics>({
      queryKey: [
        "restaurant-analytics-recommendations",
        selectedRestaurant,
        analyticsDateRange.start,
        analyticsDateRange.end,
      ],
      queryFn: () =>
        fetchRestaurantAnalytics<RecommendationsAnalytics>(
          selectedRestaurant,
          "recommendations",
          analyticsDateRange,
        ),
      enabled: !!selectedRestaurant && hasAnalyticsAccess,
      retry: false,
      refetchOnWindowFocus: false,
    });

  // Fetch deals for selected restaurant
  const { data: deals = [], isLoading: loadingDeals } = useQuery<Deal[]>({
    queryKey: [`/api/deals/restaurant/${selectedRestaurant}`],
    queryFn: async () => {
      if (!selectedRestaurant) return [];
      const res = await fetch(
        `/api/deals/restaurant/${encodeURIComponent(selectedRestaurant)}?includeInactive=1`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      const payload = await res.json();
      return Array.isArray(payload) ? payload : [];
    },
    enabled: !!selectedRestaurant && canManageDeals,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: truckBookings = [], isLoading: loadingTruckBookings } =
    useQuery<TruckBookingItem[]>({
      queryKey: ["/api/bookings/my-truck"],
      enabled: !!user && canManageParkingPass,
    });

  // Fetch dashboard stats
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: [`/api/restaurants/${selectedRestaurant}/stats`],
    enabled: !!selectedRestaurant,
  });

  const { data: ownerMenus = [] } = useQuery<OwnerMenuSummary[]>({
    queryKey: ["/api/owner/menus", selectedRestaurant],
    queryFn: async () => {
      if (!selectedRestaurant) return [];
      const res = await fetch(
        `/api/owner/menus/${encodeURIComponent(selectedRestaurant)}`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      const payload = await res.json();
      return Array.isArray(payload) ? payload : (payload?.menus ?? []);
    },
    enabled: !!selectedRestaurant && (canManageDeals || canManageParkingPass),
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Fetch advanced analytics
  const { data: analyticsSummary, isLoading: loadingAnalytics } = useQuery({
    queryKey: [
      "restaurant-analytics-summary",
      selectedRestaurant,
      analyticsDateRange.start,
      analyticsDateRange.end,
    ],
    queryFn: () =>
      fetchRestaurantAnalytics(selectedRestaurant, "summary", analyticsDateRange),
    enabled: !!selectedRestaurant && hasAnalyticsAccess,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: analyticsTimeseries } = useQuery({
    queryKey: [
      "restaurant-analytics-timeseries",
      selectedRestaurant,
      analyticsDateRange.start,
      analyticsDateRange.end,
    ],
    queryFn: () =>
      fetchRestaurantAnalytics(
        selectedRestaurant,
        "timeseries",
        analyticsDateRange,
      ),
    enabled: !!selectedRestaurant && hasAnalyticsAccess,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: customerInsights } = useQuery({
    queryKey: [
      "restaurant-analytics-customers",
      selectedRestaurant,
      analyticsDateRange.start,
      analyticsDateRange.end,
    ],
    queryFn: () =>
      fetchRestaurantAnalytics(
        selectedRestaurant,
        "customers",
        analyticsDateRange,
      ),
    enabled: !!selectedRestaurant && hasAnalyticsAccess,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: comparison } = useQuery({
    queryKey: [
      "/api/restaurants",
      selectedRestaurant,
      "analytics/compare",
      analyticsDateRange.start,
      analyticsDateRange.end,
      comparisonPeriod,
    ],
    queryFn: async () => {
      const currentEnd = new Date(analyticsDateRange.end);
      const currentStart = new Date(analyticsDateRange.start);
      const daysDiff = Math.ceil(
        (currentEnd.getTime() - currentStart.getTime()) / (1000 * 60 * 60 * 24),
      );
      const previousStart = new Date(
        currentStart.getTime() - daysDiff * 24 * 60 * 60 * 1000,
      );
      const previousEnd = new Date(
        currentStart.getTime() - 24 * 60 * 60 * 1000,
      );

      const res = await apiRequest(
        "GET",
        `/api/restaurants/${encodeURIComponent(
          selectedRestaurant,
        )}/analytics/compare?currentStart=${currentStart.toISOString()}&currentEnd=${currentEnd.toISOString()}&previousStart=${previousStart.toISOString()}&previousEnd=${previousEnd.toISOString()}`,
      );
      return await res.json();
    },
    enabled: !!selectedRestaurant && hasAnalyticsAccess,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Calculate distance between two GPS coordinates
  const getDistance = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  // Food truck mutations - declared early to avoid hoisting issues
  const updateLocationMutation = useMutation({
    mutationFn: async (location: {
      lat: number;
      lng: number;
      accuracy?: number;
      heading?: number;
      speed?: number;
    }) => {
      return await apiRequest(
        "POST",
        `/api/restaurants/${selectedRestaurant}/location`,
        {
          sessionId,
          latitude: location.lat,
          longitude: location.lng,
          accuracy: location.accuracy,
          heading: location.heading,
          speed: location.speed,
          source: "gps",
        },
      );
    },
    onSuccess: () => {
      setBroadcastCount((prev) => prev + 1);
      setLastBroadcast(new Date());
    },
    onError: (error: any) => {
      console.error("Location update failed:", error);
      setLocationError("Failed to update location");
    },
  });

  const stopFoodTruckSessionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(
        "POST",
        `/api/restaurants/${selectedRestaurant}/truck-session/end`,
        {
          sessionId,
        },
      );
    },
    onSuccess: () => {
      setIsBroadcasting(false);
      setSessionId(null);
      setConnectionStatus("disconnected");

      // Disconnect WebSocket
      disconnectWS();

      if (gpsWatchId) {
        navigator.geolocation.clearWatch(gpsWatchId);
        setGpsWatchId(null);
      }
      toast({
        title: "Broadcasting Stopped",
        description: "Your food truck is no longer visible to customers.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error Stopping Broadcast",
        description: error.message || "Failed to stop broadcasting.",
        variant: "destructive",
      });
    },
  });

  // Set default restaurant
  useEffect(() => {
    if (requestedRestaurantId && selectedRestaurant !== requestedRestaurantId) {
      setSelectedRestaurant(requestedRestaurantId);
      return;
    }
    if (selectedRestaurant) return;
    if (restaurants.length > 0) {
      let storedRestaurantId = "";
      try {
        storedRestaurantId =
          window.localStorage.getItem(LAST_RESTAURANT_KEY)?.trim() || "";
      } catch {
        storedRestaurantId = "";
      }
      const storedRestaurant = restaurants.find(
        (restaurant) => restaurant.id === storedRestaurantId,
      );
      if (storedRestaurant) {
        setSelectedRestaurant(storedRestaurant.id);
        return;
      }
      const firstTruck = restaurants.find(
        (restaurant) =>
          restaurant.isFoodTruck ||
          String((restaurant as any).businessType || "").toLowerCase() ===
            "food_truck",
      );
      setSelectedRestaurant((isFoodTruck && firstTruck ? firstTruck : restaurants[0]).id);
    }
  }, [restaurants, selectedRestaurant, requestedRestaurantId, isFoodTruck]);

  useEffect(() => {
    if (!selectedRestaurant) return;
    try {
      window.localStorage.setItem(LAST_RESTAURANT_KEY, selectedRestaurant);
    } catch {
      // ignore localStorage failures
    }
  }, [selectedRestaurant]);

  // Get current restaurant data
  const currentRestaurant = restaurants.find(
    (r) => r.id === selectedRestaurant,
  );
  const isFoodTruckBusiness = (restaurant: Partial<Restaurant> | null | undefined) =>
    Boolean(
      restaurant?.isFoodTruck ||
        String((restaurant as any)?.businessType || "").toLowerCase() ===
          "food_truck",
    );
  const foodTruckRestaurants = restaurants.filter(isFoodTruckBusiness);
  const selectedBusinessIndex = restaurants.findIndex(
    (restaurant) => restaurant.id === selectedRestaurant,
  );
  const selectedBusinessType = String(
    (currentRestaurant as any)?.businessType || "",
  ).toLowerCase();
  const ownerBusinessLabel = currentRestaurant
    ? isFoodTruckBusiness(currentRestaurant)
      ? "truck"
      : String((currentRestaurant as any).businessType || "business").replace(
          "_",
          " ",
        )
    : "business";
  const selectedDisplayNumber =
    selectedBusinessIndex >= 0 ? selectedBusinessIndex + 1 : 1;
  const selectedRestaurantIsFoodTruck = Boolean(
    isFoodTruck ||
    currentRestaurant?.isFoodTruck ||
    selectedBusinessType === "food_truck",
  );
  const selectedInsuranceEntityType = selectedRestaurantIsFoodTruck
    ? "food_truck"
    : selectedBusinessType === "caterer"
      ? "caterer"
      : selectedBusinessType === "private_chef"
        ? "private_chef"
        : "restaurant";
  const visibleActiveDeals = deals.filter(
    (deal: any) => deal?.isActive !== false,
  );
  const showOnboardingPrompt = Boolean(
    !isAdmin &&
    !isStaff &&
    onboardingCompletion &&
    (onboardingCompletion.overallPct < 100 ||
      onboardingCompletion.insurance?.valid !== true),
  );
  const insuranceStatus =
    onboardingCompletion?.insurance?.status || "not_submitted";
  const needsInsuranceSubmission = Boolean(
    onboardingCompletion?.insurance?.required &&
      !["valid", "pending"].includes(insuranceStatus),
  );
  const verificationSnoozed = Boolean(onboardingCompletion?.verification.snoozed);
  const isClaimedImport = Boolean((currentRestaurant as any)?.claimedFromImportId);
  const visibleTruckBookings = truckBookings.filter(
    (booking) => !selectedRestaurant || booking.truckId === selectedRestaurant,
  );
  const upcomingTruckRequests = visibleTruckBookings.filter((booking) =>
    ["pending", "confirmed", "accepted", "approved"].includes(
      String(booking.status || "").toLowerCase(),
    ),
  );
  const liveShareUrl = selectedRestaurant
    ? `/restaurant/${selectedRestaurant}?live=1`
    : "/map";
  const dealCreationPath = selectedRestaurant
    ? `/deal-creation?restaurantId=${encodeURIComponent(selectedRestaurant)}`
    : "/deal-creation";
  const hiringPath = selectedRestaurant
    ? `/hiring?restaurantId=${encodeURIComponent(selectedRestaurant)}`
    : "/hiring";
  const addTruckPath = "/truck-onboarding?claim=1&flow=truck-owner&src=owner-dashboard";
  const subscribeDealCreationPath = selectedRestaurant
    ? `/subscribe?next=${encodeURIComponent(
        `/deal-creation?restaurantId=${selectedRestaurant}`,
      )}&reason=create_deals`
    : "/subscribe?next=/deal-creation&reason=create_deals";
  const liveShareTitle = currentRestaurant?.name
    ? `${currentRestaurant.name} is live on MealScout`
    : "We are live on MealScout";
  const liveShareDescription = "Find us live right now on the MealScout map.";
  const currentBusinessType = String(
    (currentRestaurant as any)?.businessType || "",
  ).toLowerCase();
  const isPrivateChefBusiness = currentBusinessType === "private_chef";
  const offersCatering = Boolean(
    (currentRestaurant as any)?.offersCatering ||
    currentBusinessType === "caterer" ||
    currentBusinessType === "private_chef",
  );
  const cateringDetails =
    ((currentRestaurant as any)?.cateringDetails as Record<string, any> | null) ||
    {};
  const cateringProfilePath = selectedRestaurant
    ? isPrivateChefBusiness
      ? `/chef/${selectedRestaurant}?service=private-chef`
      : `/restaurant/${selectedRestaurant}?service=catering`
    : "/map";
  const cateringUi = isPrivateChefBusiness
    ? {
        tab: "Chef Services",
        title: "Private chef services",
        description:
          "Publish menus, service area, lead time, and booking preferences for private dinners, events, tastings, and recurring service.",
        badgeOn: "Chef services on",
        badgeOff: "Chef services off",
        promote: `Promote private chef bookings for ${currentRestaurant?.name || "this profile"}`,
        helper:
          "Use this for private dinners, events, tastings, meal prep, recurring service, and chef-led experiences.",
        headlinePlaceholder: "Private dinners, events, and recurring chef service",
        detailsPlaceholder:
          "Tell people what you cook, which events fit best, your service style, and how to start a booking.",
        save: "Save chef services",
        turnedOn: "Chef services turned on",
        turnedOff: "Chef services turned off",
        savedDescription:
          "Your private chef service details are saved for this profile.",
        offDescription:
          "Private chef services are no longer promoted from this profile.",
        errorTitle: "Unable to save chef services",
        menu: "Chef menus",
      }
    : {
        tab: "Catering",
        title: "Catering",
        description:
          "Offer catering from this profile without changing the business type customers already recognize.",
        badgeOn: "Catering on",
        badgeOff: "Catering off",
        promote: `Promote catering for ${currentRestaurant?.name || "this profile"}`,
        helper:
          "Use this for office meals, private events, parties, pop-ups, recurring service, and large orders.",
        headlinePlaceholder: "Catering for offices, parties, and private events",
        detailsPlaceholder:
          "Tell people what you cater, what events fit best, and how to start.",
        save: "Save catering",
        turnedOn: "Catering turned on",
        turnedOff: "Catering turned off",
        savedDescription: "Your catering details are saved for this business.",
        offDescription:
          "The catering section is no longer promoted from this profile.",
        errorTitle: "Unable to save catering",
        menu: "Catering menu",
      };
  const setSelectedBusiness = (restaurantId: string) => {
    setSelectedRestaurant(restaurantId);
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("restaurantId", restaurantId);
      const nextUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // URL sync is a convenience only.
    }
  };

  const getProfileCompletion = (restaurant: Partial<Restaurant>) => {
    const fields = [
      restaurant.name,
      restaurant.address || (restaurant as any).city,
      restaurant.phone || (restaurant as any).contactPhone,
      (restaurant as any).description,
      (restaurant as any).logoUrl || (restaurant as any).imageUrl,
    ];
    const done = fields.filter((value) => String(value || "").trim()).length;
    return Math.round((done / fields.length) * 100);
  };

  useEffect(() => {
    setCateringForm({
      headline: String(cateringDetails.headline || ""),
      description: String(cateringDetails.description || ""),
      serviceArea: String(cateringDetails.serviceArea || ""),
      minimumGuests:
        cateringDetails.minimumGuests === undefined ||
        cateringDetails.minimumGuests === null
          ? ""
          : String(cateringDetails.minimumGuests),
      leadTimeDays:
        cateringDetails.leadTimeDays === undefined ||
        cateringDetails.leadTimeDays === null
          ? ""
          : String(cateringDetails.leadTimeDays),
      contactPreference: String(cateringDetails.contactPreference || ""),
    });
  }, [selectedRestaurant, currentRestaurant?.updatedAt]);

  useEffect(() => {
    if (!selectedRestaurant || !needsInsuranceSubmission) {
      setVerificationSkippedToday(false);
      setVerificationUploadOpen(false);
      return;
    }

    setVerificationSkippedToday(verificationSnoozed);
    if (verificationSnoozed) {
      setVerificationUploadOpen(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("goLive") === "1") {
      setVerificationUploadOpen(true);
    }
  }, [needsInsuranceSubmission, selectedRestaurant, verificationSnoozed]);

  // GPS fallback function using IP geolocation
  const tryFallbackLocation = async (): Promise<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null> => {
    try {
      // Try IP-based geolocation as fallback
      const response = await fetch("https://ipapi.co/json/");
      if (response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude) {
          return {
            lat: parseFloat(data.latitude),
            lng: parseFloat(data.longitude),
            accuracy: 10000, // IP location is less accurate
          };
        }
      }
    } catch (error) {
      console.warn("IP geolocation fallback failed:", error);
    }

    // Final fallback: use restaurant's base location if available
    if (currentRestaurant?.latitude && currentRestaurant?.longitude) {
      return {
        lat: parseFloat(currentRestaurant.latitude),
        lng: parseFloat(currentRestaurant.longitude),
        accuracy: 5000, // Restaurant location accuracy estimate
      };
    }

    return null;
  };

  // GPS tracking effect with fallback
  useEffect(() => {
    if (isBroadcasting && sessionId) {
      if (!navigator.geolocation) {
        setLocationError("GPS not supported. Trying fallback location...");

        // Use fallback location when GPS is not supported
        tryFallbackLocation().then((fallbackLocation) => {
          if (fallbackLocation) {
            setCurrentLocation(fallbackLocation);
            setGpsAccuracy(fallbackLocation.accuracy || 10000);
            setLocationError("Using approximate location (GPS unavailable)");
            setConnectionStatus("connected");

            updateLocationMutation.mutate({
              lat: fallbackLocation.lat,
              lng: fallbackLocation.lng,
              accuracy: fallbackLocation.accuracy || 10000,
            });
          } else {
            setLocationError(
              "Unable to determine location. Please check your settings.",
            );
            setConnectionStatus("disconnected");
          }
        });
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };

          // Update location state
          setCurrentLocation(newLocation);
          setGpsAccuracy(position.coords.accuracy);
          setLocationError(null);
          setConnectionStatus("connected");

          // Only send updates if location changed significantly (50m threshold)
          if (
            !lastBroadcast ||
            Date.now() - lastBroadcast.getTime() > 30000 || // 30 seconds minimum
            (currentLocation &&
              getDistance(
                currentLocation.lat,
                currentLocation.lng,
                newLocation.lat,
                newLocation.lng,
              ) > 50)
          ) {
            updateLocationMutation.mutate({
              lat: newLocation.lat,
              lng: newLocation.lng,
              accuracy: position.coords.accuracy,
              heading: position.coords.heading || undefined,
              speed: position.coords.speed || undefined,
            });
          }
        },
        async (error) => {
          console.error("GPS error:", error);

          // Try fallback location when GPS fails
          let fallbackMessage = "GPS error. ";
          if (error.code === error.PERMISSION_DENIED) {
            fallbackMessage += "Location access denied. ";
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            fallbackMessage += "Location unavailable. ";
          } else if (error.code === error.TIMEOUT) {
            fallbackMessage += "Location timeout. ";
          }

          setLocationError(fallbackMessage + "Trying fallback...");
          setConnectionStatus("connecting");

          const fallbackLocation = await tryFallbackLocation();
          if (fallbackLocation) {
            setCurrentLocation(fallbackLocation);
            setGpsAccuracy(fallbackLocation.accuracy || 10000);
            setLocationError(fallbackMessage + "Using approximate location.");
            setConnectionStatus("connected");

            updateLocationMutation.mutate({
              lat: fallbackLocation.lat,
              lng: fallbackLocation.lng,
              accuracy: fallbackLocation.accuracy || 10000,
            });
          } else {
            setLocationError(fallbackMessage + "Unable to determine location.");
            setConnectionStatus("disconnected");
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        },
      );

      setGpsWatchId(watchId);

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [
    isBroadcasting,
    sessionId,
    lastBroadcast,
    currentLocation,
    updateLocationMutation,
    currentRestaurant,
  ]);

  // Auto-stop broadcasting after 2 minutes of inactivity
  useEffect(() => {
    if (isBroadcasting && lastBroadcast) {
      const timeout = setTimeout(() => {
        if (Date.now() - lastBroadcast.getTime() > 120000) {
          // 2 minutes
          stopFoodTruckSessionMutation.mutate();
          setLocationError("Session timed out due to inactivity");
        }
      }, 125000); // Check after 2 minutes 5 seconds

      return () => clearTimeout(timeout);
    }
  }, [lastBroadcast, isBroadcasting, stopFoodTruckSessionMutation]);

  // Operating hours form schema
  const operatingHoursSchema = z.object({
    mon: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    tue: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    wed: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    thu: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    fri: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    sat: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
    sun: z
      .array(
        z.object({
          open: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
          close: z
            .string()
            .regex(
              /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
              "Time must be in HH:MM format",
            ),
        }),
      )
      .optional(),
  });

  type OperatingHoursFormData = z.infer<typeof operatingHoursSchema>;

  // Operating hours form
  const operatingHoursForm = useForm<OperatingHoursFormData>({
    resolver: zodResolver(operatingHoursSchema),
    defaultValues: {
      mon: (currentRestaurant?.operatingHours as any)?.mon || [],
      tue: (currentRestaurant?.operatingHours as any)?.tue || [],
      wed: (currentRestaurant?.operatingHours as any)?.wed || [],
      thu: (currentRestaurant?.operatingHours as any)?.thu || [],
      fri: (currentRestaurant?.operatingHours as any)?.fri || [],
      sat: (currentRestaurant?.operatingHours as any)?.sat || [],
      sun: (currentRestaurant?.operatingHours as any)?.sun || [],
    },
  });

  // Reset form when restaurant changes
  useEffect(() => {
    if (currentRestaurant) {
      operatingHoursForm.reset({
        mon: (currentRestaurant.operatingHours as any)?.mon || [],
        tue: (currentRestaurant.operatingHours as any)?.tue || [],
        wed: (currentRestaurant.operatingHours as any)?.wed || [],
        thu: (currentRestaurant.operatingHours as any)?.thu || [],
        fri: (currentRestaurant.operatingHours as any)?.fri || [],
        sat: (currentRestaurant.operatingHours as any)?.sat || [],
        sun: (currentRestaurant.operatingHours as any)?.sun || [],
      });
    }
  }, [currentRestaurant, operatingHoursForm]);

  // Start broadcasting handler
  const handleStartBroadcasting = () => {
    if (!hasPremiumLocationTools) {
      toast({
        title: "Premium required",
        description: "Upgrade to use live location broadcasting.",
        variant: "destructive",
      });
      setLocation("/subscription");
      return;
    }

    if (!navigator.geolocation) {
      toast({
        title: "GPS Not Available",
        description: "Your device doesn't support GPS location.",
        variant: "destructive",
      });
      return;
    }

    setConnectionStatus("connecting");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setCurrentLocation({
          ...location,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });

        startFoodTruckSessionMutation.mutate(location);
      },
      (error) => {
        setLocationError(error.message);
        setConnectionStatus("disconnected");
        toast({
          title: "Location Error",
          description:
            "Unable to get your current location. Please check your GPS settings.",
          variant: "destructive",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  // Stop broadcasting handler
  const handleStopBroadcasting = () => {
    stopFoodTruckSessionMutation.mutate();
  };

  // Handle restaurant location update
  const handleUpdateRestaurantLocation = () => {
    if (!hasPremiumLocationTools) {
      toast({
        title: "Premium required",
        description: "Upgrade to use one-click live location updates.",
        variant: "destructive",
      });
      setLocation("/subscription");
      return;
    }

    if (!navigator.geolocation) {
      toast({
        title: "GPS Not Available",
        description: "Your device doesn't support GPS location.",
        variant: "destructive",
      });
      return;
    }

    setIsUpdatingLocation(true);
    setLocationUpdateError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };

        updateRestaurantLocationMutation.mutate(location);
      },
      (error) => {
        setLocationUpdateError(error.message);
        setIsUpdatingLocation(false);
        toast({
          title: "Location Error",
          description:
            "Unable to get your current location. Please check your GPS settings.",
          variant: "destructive",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  };

  // Handle operating hours form submission
  const handleOperatingHoursSubmit = (data: OperatingHoursFormData) => {
    updateOperatingHoursMutation.mutate(data);
  };

  // Helper function to add time slot
  const addTimeSlot = (day: keyof OperatingHoursFormData) => {
    const currentSlots = operatingHoursForm.getValues(day) || [];
    if (currentSlots.length < 3) {
      operatingHoursForm.setValue(day, [
        ...currentSlots,
        { open: "09:00", close: "17:00" },
      ]);
    }
  };

  // Helper function to remove time slot
  const removeTimeSlot = (day: keyof OperatingHoursFormData, index: number) => {
    const currentSlots = operatingHoursForm.getValues(day) || [];
    const newSlots = currentSlots.filter((_, i) => i !== index);
    operatingHoursForm.setValue(day, newSlots);
  };

  // Toggle deal status
  const toggleDealMutation = useMutation({
    mutationFn: async ({
      dealId,
      isActive,
    }: {
      dealId: string;
      isActive: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/deals/${dealId}`, {
        isActive: !isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/deals/restaurant/${selectedRestaurant}`],
      });
      toast({
        title: "Deal Updated",
        description: "Deal status has been updated successfully.",
      });
    },
  });

  // Delete deal
  const deleteDealMutation = useMutation({
    mutationFn: async (dealId: string) => {
      return await apiRequest("DELETE", `/api/deals/${dealId}`);
    },
    onMutate: async (dealId: string) => {
      const key = [`/api/deals/restaurant/${selectedRestaurant}`] as const;
      await queryClient.cancelQueries({ queryKey: key });
      const previousDeals = queryClient.getQueryData<Deal[]>(key);

      if (previousDeals) {
        queryClient.setQueryData<Deal[]>(
          key,
          previousDeals.filter((deal) => deal.id !== dealId),
        );
      }

      return { previousDeals, key };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/deals/restaurant/${selectedRestaurant}`],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/deals/restaurant"],
      });
      toast({
        title: "Deal Deleted",
        description: "Deal has been deleted successfully.",
      });
    },
    onError: (error: any, _dealId, context) => {
      if (context?.previousDeals && context?.key) {
        queryClient.setQueryData(context.key, context.previousDeals);
      }
      toast({
        title: "Delete failed",
        description: error?.message || "Unable to delete this deal right now.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/deals/restaurant/${selectedRestaurant}`],
      });
    },
  });

  // Update deal
  const updateDealMutation = useMutation({
    mutationFn: async ({
      dealId,
      updates,
    }: {
      dealId: string;
      updates: any;
    }) => {
      return await apiRequest("PATCH", `/api/deals/${dealId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/deals/restaurant/${selectedRestaurant}`],
      });
      toast({
        title: "Deal Updated",
        description: "Deal has been updated successfully.",
      });
    },
  });

  // Food truck mutations
  const startFoodTruckSessionMutation = useMutation({
    mutationFn: async (location: { lat: number; lng: number }) => {
      return await apiRequest(
        "POST",
        `/api/restaurants/${selectedRestaurant}/truck-session/start`,
        {
          latitude: location.lat,
          longitude: location.lng,
          deviceId: navigator.userAgent || "web-browser",
        },
      );
    },
    onSuccess: (data: any) => {
      setSessionId(data?.session?.id || null);
      setIsBroadcasting(true);
      setConnectionStatus("connected");

      // Connect to WebSocket and subscribe to restaurant updates
      connectWS();
      setTimeout(() => {
        subscribeToRestaurant(selectedRestaurant);
      }, 1000);

      toast({
        title: "Broadcasting Started",
        description: "Your food truck is now visible to customers nearby.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Start Broadcasting",
        description: error.message || "Unable to start food truck session.",
        variant: "destructive",
      });
    },
  });

  const toggleFoodTruckMutation = useMutation({
    mutationFn: async (isFoodTruck: boolean) => {
      return await apiRequest(
        "PATCH",
        `/api/restaurants/${selectedRestaurant}`,
        {
          isFoodTruck,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      toast({
        title: "Restaurant Updated",
        description: "Food truck settings have been saved.",
      });
    },
  });

  // Restaurant location update mutation (different from food truck location)
  const updateRestaurantLocationMutation = useMutation({
    mutationFn: async (location: { latitude: number; longitude: number }) => {
      return await apiRequest(
        "PATCH",
        `/api/restaurants/${selectedRestaurant}/location`,
        location,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      setLocationUpdateError(null);
      setIsUpdatingLocation(false);
      toast({
        title: "Location Updated",
        description: "Your restaurant location has been updated successfully.",
      });
    },
    onError: (error: any) => {
      setLocationUpdateError(error.message || "Failed to update location");
      setIsUpdatingLocation(false);
      toast({
        title: "Error Updating Location",
        description: error.message || "Failed to update restaurant location.",
        variant: "destructive",
      });
    },
  });

  // Operating hours update mutation
  const updateOperatingHoursMutation = useMutation({
    mutationFn: async (operatingHours: OperatingHoursFormData) => {
      return await apiRequest(
        "PATCH",
        `/api/restaurants/${selectedRestaurant}/operating-hours`,
        {
          operatingHours,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      toast({
        title: "Operating Hours Updated",
        description:
          "Your restaurant operating hours have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error Updating Operating Hours",
        description: error.message || "Failed to update operating hours.",
        variant: "destructive",
      });
    },
  });

  const updateCateringMutation = useMutation({
    mutationFn: async (offers: boolean) => {
      const details = {
        headline: cateringForm.headline.trim(),
        description: cateringForm.description.trim(),
        serviceArea: cateringForm.serviceArea.trim(),
        minimumGuests: cateringForm.minimumGuests
          ? Number(cateringForm.minimumGuests)
          : null,
        leadTimeDays: cateringForm.leadTimeDays
          ? Number(cateringForm.leadTimeDays)
          : null,
        contactPreference: cateringForm.contactPreference.trim(),
      };

      return await apiRequest(
        "PATCH",
        `/api/restaurants/${selectedRestaurant}/profile`,
        {
          offersCatering: offers,
          cateringDetails: details,
        },
      );
    },
    onSuccess: (_data, offers) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      toast({
        title: offers ? cateringUi.turnedOn : cateringUi.turnedOff,
        description: offers ? cateringUi.savedDescription : cateringUi.offDescription,
      });
    },
    onError: (error: any) => {
      toast({
        title: cateringUi.errorTitle,
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const submitVerificationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurant) {
        throw new Error("Select a restaurant first");
      }
      if (onboardingDocuments.length === 0) {
        throw new Error("Upload at least one insurance document");
      }
      if (!insuranceForm.expiresAt) {
        throw new Error("Add the policy expiration date");
      }
      if (
        !insuranceForm.attestedCommercialCoverage ||
        !insuranceForm.attestedJurisdictionCompliance
      ) {
        throw new Error("Confirm the two insurance attestations");
      }
      const coverageAmountCents = insuranceForm.coverageAmount.trim()
        ? Math.round(Number(insuranceForm.coverageAmount) * 100)
        : null;
      return await apiRequest(
        "POST",
        "/api/business/insurance/submit",
        {
          entityType: selectedInsuranceEntityType,
          entityId: selectedRestaurant,
          documents: onboardingDocuments,
          carrierName: insuranceForm.carrierName.trim() || undefined,
          policyNumber: insuranceForm.policyNumber.trim() || undefined,
          coverageAmountCents: Number.isFinite(coverageAmountCents)
            ? coverageAmountCents
            : null,
          expiresAt: insuranceForm.expiresAt,
          attestedCommercialCoverage:
            insuranceForm.attestedCommercialCoverage,
          attestedJurisdictionCompliance:
            insuranceForm.attestedJurisdictionCompliance,
          notes: onboardingLicenseNumber.trim()
            ? `Permit or registry number: ${onboardingLicenseNumber.trim()}`
            : undefined,
        },
      );
    },
    onSuccess: async () => {
      setOnboardingDocuments([]);
      setOnboardingLicenseNumber("");
      setInsuranceForm({
        carrierName: "",
        policyNumber: "",
        expiresAt: "",
        coverageAmount: "",
        attestedCommercialCoverage: false,
        attestedJurisdictionCompliance: false,
      });
      setVerificationUploadOpen(false);
      setVerificationSkippedToday(false);
      await queryClient.invalidateQueries({
        queryKey: [
          `/api/restaurants/${selectedRestaurant}/onboarding/completion`,
        ],
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
      toast({
        title: "Insurance submitted",
        description:
          "Your proof is in the review queue. We will check it shortly.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Insurance upload failed",
        description: error?.message || "Unable to submit insurance proof",
        variant: "destructive",
      });
    },
  });

  const snoozeVerificationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurant) {
        throw new Error("Select a restaurant first");
      }
      const response = await apiRequest(
        "POST",
        `/api/restaurants/${selectedRestaurant}/verification/snooze`,
        { source: "dashboard" },
      );
      return response.json().catch(() => ({}));
    },
    onSuccess: async () => {
      setVerificationUploadOpen(false);
      setVerificationSkippedToday(true);
      await queryClient.invalidateQueries({
        queryKey: [
          `/api/restaurants/${selectedRestaurant}/onboarding/completion`,
        ],
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
      toast({
        title: "Verification skipped for today",
        description: "We will remind you again tomorrow if it is still missing.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not skip verification",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getDealTypeColor = (type?: string | null) => {
    switch (type) {
      case "breakfast":
        return "bg-yellow-100 text-yellow-800";
      case "lunch":
        return "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]";
      case "dinner":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-[var(--bg-surface-muted)] text-[color:var(--text-secondary)]";
    }
  };

  const bookingCancelMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const response = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "Cancelled by truck owner" }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message || "Failed to cancel booking");
      }

      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/bookings/my-truck"],
      });
      toast({
        title: "Booking cancelled",
        description: "Your booking was cancelled. No refund was issued.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Unable to cancel booking",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });
  const availableTabs = [
    ...(canManageDeals ? (["active", "inactive"] as const) : []),
    ...(canManageProfile ? (["catering"] as const) : []),
    ...(canViewAnalytics ? (["analytics"] as const) : []),
    ...(canManageBilling ? (["credits"] as const) : []),
    ...(canManageParkingPass ? (["bookings", "foodtruck"] as const) : []),
  ];
  const defaultTab =
    selectedRestaurantIsFoodTruck && availableTabs.includes("foodtruck")
      ? "foodtruck"
      : (availableTabs[0] ?? "analytics");
  const [activeTab, setActiveTab] = useState<string>(defaultTab);

  useEffect(() => {
    if (!availableTabs.includes(activeTab as any)) {
      setActiveTab(defaultTab);
    }
  }, [activeTab, availableTabs, defaultTab]);

  const prioritizedMissingKey =
    onboardingCompletion?.required?.missing?.[0]?.key ||
    onboardingCompletion?.recommended?.missing?.[0]?.key ||
    null;

  const handleQuickFixMissingField = () => {
    const focus = encodeURIComponent(prioritizedMissingKey || "profile");
    setLocation(
      `/edit-restaurant/${selectedRestaurant}?src=onboarding&focus=${focus}`,
    );
  };

  const openVerificationUpload = () => {
    if (!selectedRestaurant) return;
    setVerificationSkippedToday(false);
    setVerificationUploadOpen(true);
  };

  const skipVerificationToday = () => {
    if (!selectedRestaurant) return;
    snoozeVerificationMutation.mutate();
  };

  if (loadingRestaurants) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg-layered)]">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (restaurants.length === 0) {
    const emptyStateIsTruck = isFoodTruck || user?.userType === "food_truck";
    return (
      <div className="container mx-auto px-4 py-8 bg-[var(--bg-layered)] min-h-screen">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          {emptyStateIsTruck ? (
            <Truck className="h-16 w-16 mx-auto text-muted-foreground" />
          ) : (
            <Store className="h-16 w-16 mx-auto text-muted-foreground" />
          )}
          <h1 className="text-3xl font-bold">
            {emptyStateIsTruck ? "No Truck Found" : "No Restaurant Found"}
          </h1>
          <p className="text-muted-foreground">
            {emptyStateIsTruck
              ? "Create or claim your first truck, then add every truck you operate from the same dashboard."
              : "Register your business first to manage specials, hiring, menus, and profile tools."}
          </p>
          <Link href={emptyStateIsTruck ? addTruckPath : "/restaurant-signup"}>
            <Button size="lg" data-testid="button-register-restaurant">
              {emptyStateIsTruck ? "Add Your First Truck" : "Register Your Business"}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 bg-[var(--bg-layered)] min-h-screen">
      <SEOHead
        title="Restaurant Dashboard - MealScout | Manage Your Specials"
        description="Manage your restaurant specials, view analytics, track performance, and engage with customers. Access insights on special claims, views, conversion rates, and customer feedback."
        keywords="restaurant dashboard, manage specials, restaurant analytics, special performance, customer insights"
        canonicalUrl="https://www.mealscout.us/restaurant-owner-dashboard"
        noIndex={true}
      />
      {/* Header with Back Button */}
      <BackHeader
        title="Restaurant Dashboard"
        fallbackHref="/"
        icon={Store}
        rightActions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {canManageDeals ? (
              canCreateDealsNow ? (
                <Link href={dealCreationPath}>
                  <Button
                    data-testid="button-create-deal"
                    className="w-full sm:w-auto"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Special
                  </Button>
                </Link>
              ) : (
                <Link href={subscribeDealCreationPath}>
                  <Button
                    variant="default"
                    data-testid="button-subscribe"
                    className="w-full sm:w-auto"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Subscribe to Create Specials
                  </Button>
                </Link>
              )
            ) : null}
            {canManageProfile ? (
              <Link href={hiringPath}>
                <Button
                  variant="outline"
                  data-testid="button-owner-hiring"
                  className="w-full sm:w-auto"
                >
                  <Briefcase className="mr-2 h-4 w-4" />
                  Hiring
                </Button>
              </Link>
            ) : null}
            {canManageBilling ? (
              <Link href="/subscription">
                <Button
                  variant="outline"
                  data-testid="button-manage-subscription"
                  className="w-full sm:w-auto"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Manage Subscription
                </Button>
              </Link>
            ) : null}
          </div>
        }
        className="bg-[var(--bg-card)] border-b border-border mb-8"
      />

      {/* Owner-facing setup progress (auto-hides when complete) */}
      <OwnerOnboardingChecklist />

      {/* Restaurant Selector */}
      {restaurants.length > 1 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-[color:var(--text-secondary)] mb-2">
            Select business
          </label>
          <select
            value={selectedRestaurant}
            onChange={(e) => setSelectedBusiness(e.target.value)}
            className="w-full max-w-md rounded-lg border bg-[var(--bg-card)] px-3 py-2"
            data-testid="select-restaurant"
          >
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
                {isFoodTruckBusiness(restaurant) ? " - Food truck" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {restaurants.length > 1 ? (
        <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Truck className="h-5 w-5 text-[color:var(--accent-text)]" />
                  Multi-location command center
                </CardTitle>
                <CardDescription>
                  Manage every truck or location from one place. Pick the one
                  you are working on, then jump straight to the right tool.
                </CardDescription>
              </div>
              <Link href={addTruckPath}>
                <Button variant="outline" className="w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Add another truck
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Businesses
                </div>
                <div className="mt-1 text-2xl font-black">
                  {restaurants.length}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Trucks
                </div>
                <div className="mt-1 text-2xl font-black">
                  {foodTruckRestaurants.length}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Active
                </div>
                <div className="mt-1 text-2xl font-black">
                  {
                    restaurants.filter(
                      (restaurant) => (restaurant as any).isActive !== false,
                    ).length
                  }
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {restaurants.map((restaurant, index) => {
                const isSelected = restaurant.id === selectedRestaurant;
                const isTruck = isFoodTruckBusiness(restaurant);
                const completion = getProfileCompletion(restaurant);
                return (
                  <div
                    key={restaurant.id}
                    className={`rounded-xl border p-4 transition ${
                      isSelected
                        ? "border-[color:var(--accent-text)] bg-[color:var(--accent-muted)]/20"
                        : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black uppercase text-[color:var(--text-secondary)]">
                            #{index + 1}
                          </span>
                          <Badge variant={isTruck ? "default" : "outline"}>
                            {isTruck ? "Truck" : "Business"}
                          </Badge>
                          {isSelected ? <Badge variant="secondary">Selected</Badge> : null}
                        </div>
                        <h3 className="mt-2 truncate text-lg font-black">
                          {restaurant.name || "Unnamed business"}
                        </h3>
                        <p className="mt-1 line-clamp-1 text-sm text-[color:var(--text-secondary)]">
                          {restaurant.address ||
                            [restaurant.city, restaurant.state]
                              .filter(Boolean)
                              .join(", ") ||
                            "No public location yet"}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="text-xs font-semibold text-[color:var(--text-secondary)]">
                          Profile
                        </div>
                        <div className="text-xl font-black">{completion}%</div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Button
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => setSelectedBusiness(restaurant.id)}
                      >
                        {isSelected ? "Managing" : "Manage"}
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href={`/menu-builder/${restaurant.id}`}>
                          <Store className="mr-2 h-4 w-4" />
                          Menu
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link
                          href={`/hiring?restaurantId=${encodeURIComponent(
                            restaurant.id,
                          )}`}
                        >
                          <Briefcase className="mr-2 h-4 w-4" />
                          Jobs
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href={`/restaurant/${restaurant.id}`}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Profile
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {currentRestaurant ? (
        <div className="mb-4 text-sm text-[color:var(--text-secondary)]">
          Managing {ownerBusinessLabel} {selectedDisplayNumber} of{" "}
          {restaurants.length}:{" "}
          <span className="font-semibold text-[color:var(--text-primary)]">
            {currentRestaurant.name}
          </span>
        </div>
      ) : null}

      {selectedRestaurant && currentRestaurant && canManageProfile ? (
        <div className="mb-6">
          <HelpWantedQuickAction
            restaurantId={selectedRestaurant}
            restaurantName={currentRestaurant.name}
            compact
          />
        </div>
      ) : null}

      {selectedRestaurantIsFoodTruck && currentRestaurant && (
        <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Truck className="h-5 w-5 text-[color:var(--accent-text)]" />
                  Food Truck Quick Start
                </CardTitle>
                <CardDescription>
                  Get listed, visible, and ready for today without digging
                  through admin tools.
                </CardDescription>
              </div>
              <Badge
                variant={isBroadcasting ? "default" : "outline"}
                className="w-fit"
              >
                {isBroadcasting ? "Live on map" : "Not live yet"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Button
                size="lg"
                className="h-auto justify-start gap-2 py-4 lg:col-span-2"
                onClick={() => {
                  if (!currentRestaurant.isFoodTruck) {
                    toggleFoodTruckMutation.mutate(true);
                    return;
                  }
                  if (isBroadcasting) {
                    handleStopBroadcasting();
                  } else {
                    handleStartBroadcasting();
                  }
                }}
                disabled={
                  toggleFoodTruckMutation.isPending ||
                  startFoodTruckSessionMutation.isPending ||
                  stopFoodTruckSessionMutation.isPending
                }
                data-testid="button-owner-go-live"
              >
                {isBroadcasting ? (
                  <PowerOff className="h-4 w-4" />
                ) : (
                  <Radio className="h-4 w-4" />
                )}
                {currentRestaurant.isFoodTruck
                  ? isBroadcasting
                    ? "Stop Live Location"
                    : "Go Live / Update Location"
                  : "Enable Truck & Go Live"}
              </Button>

              <Link href={dealCreationPath}>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-auto w-full justify-start gap-2 py-4"
                  data-testid="button-owner-post-special"
                >
                  <Plus className="h-4 w-4" />
                  Post Special
                </Button>
              </Link>

              <Link href="/messages">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-auto w-full justify-start gap-2 py-4"
                  data-testid="button-owner-messages"
                >
                  <MessageCircle className="h-4 w-4" />
                  Messages
                </Button>
              </Link>

              <Link href={`/menu-builder/${selectedRestaurant}`}>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-auto w-full justify-start gap-2 py-4"
                  data-testid="button-owner-update-menu"
                >
                  <Store className="h-4 w-4" />
                  Update Menu
                </Button>
              </Link>

              <Link
                href={`/parking-pass?truckId=${encodeURIComponent(selectedRestaurant)}`}
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="h-auto w-full justify-start gap-2 py-4"
                  data-testid="button-owner-find-parking"
                >
                  <MapPin className="h-4 w-4" />
                  Find Parking
                </Button>
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setActiveTab("bookings")}
                className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left"
              >
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Upcoming Requests
                </div>
                <div className="mt-1 text-2xl font-black">
                  {upcomingTruckRequests.length}
                </div>
              </button>
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Active Specials
                </div>
                <div className="mt-1 text-2xl font-black">
                  {visibleActiveDeals.length}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Menus
                </div>
                <div className="mt-1 text-2xl font-black">
                  {ownerMenus.length}
                </div>
              </div>
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="text-xs font-semibold uppercase text-[color:var(--text-secondary)]">
                  Views
                </div>
                <div className="mt-1 text-2xl font-black">
                  {stats?.totalViews || 0}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isAdmin &&
        !isStaff &&
        (loadingOnboardingCompletion || showOnboardingPrompt) && (
          <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Onboarding Progress</CardTitle>
              <CardDescription>
                Complete only what is missing so your business can go live
                faster.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingOnboardingCompletion && (
                <div className="text-sm text-[color:var(--text-secondary)]">
                  Loading onboarding status...
                </div>
              )}
              {!loadingOnboardingCompletion && onboardingCompletion && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {onboardingCompletion.overallPct}% complete
                    </Badge>
                    <Badge variant="outline">
                      Required {onboardingCompletion.required.done}/
                      {onboardingCompletion.required.total}
                    </Badge>
                    <Badge variant="outline">
                      Recommended {onboardingCompletion.recommended.done}/
                      {onboardingCompletion.recommended.total}
                    </Badge>
                    <Badge
                      variant={
                        onboardingCompletion.insurance?.valid
                          ? "default"
                          : "outline"
                      }
                    >
                      Insurance:{" "}
                      {(onboardingCompletion.insurance?.status || "not_submitted").replace(
                        "_",
                        " ",
                      )}
                    </Badge>
                  </div>

                  {onboardingCompletion.required.missing.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Missing required fields
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {onboardingCompletion.required.missing.map((item) => (
                          <Badge key={item.key} variant="outline">
                            {item.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleQuickFixMissingField}
                      data-testid="button-onboarding-quick-fix"
                    >
                      Fix next missing field
                    </Button>
                  </div>

                  {onboardingCompletion.recommended.missing.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Recommended improvements
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {onboardingCompletion.recommended.missing
                          .slice(0, 4)
                          .map((item) => (
                            <Badge key={item.key} variant="secondary">
                              {item.label}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  )}

                  {needsInsuranceSubmission && (
                    <div className="space-y-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex gap-3">
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                          <div>
                            <p className="text-sm font-semibold">
                              Submit commercial insurance when you have it nearby
                            </p>
                            <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                              You can keep setting up today. Verification stays
                              on the checklist and we will send a friendly
                              reminder once per day until proof is submitted.
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          Daily reminder
                        </Badge>
                      </div>

                      {verificationSkippedToday && !verificationUploadOpen ? (
                        <div className="flex flex-col gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-[color:var(--text-secondary)]">
                            Snoozed for today. It will come back tomorrow if no
                            proof is submitted.
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={openVerificationUpload}
                          >
                            Submit now
                          </Button>
                        </div>
                      ) : null}

                      {!verificationSkippedToday || verificationUploadOpen ? (
                        verificationUploadOpen ? (
                          <div className="space-y-3">
                            {isClaimedImport ? (
                              <Input
                                value={onboardingLicenseNumber}
                                onChange={(e) =>
                                  setOnboardingLicenseNumber(e.target.value)
                                }
                                placeholder="Permit or registry number (optional)"
                                data-testid="input-dashboard-license-number"
                              />
                            ) : null}
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                value={insuranceForm.carrierName}
                                onChange={(e) =>
                                  setInsuranceForm((prev) => ({
                                    ...prev,
                                    carrierName: e.target.value,
                                  }))
                                }
                                placeholder="Insurance carrier (optional)"
                                data-testid="input-dashboard-insurance-carrier"
                              />
                              <Input
                                value={insuranceForm.policyNumber}
                                onChange={(e) =>
                                  setInsuranceForm((prev) => ({
                                    ...prev,
                                    policyNumber: e.target.value,
                                  }))
                                }
                                placeholder="Policy number (optional)"
                                data-testid="input-dashboard-insurance-policy"
                              />
                              <Input
                                type="date"
                                value={insuranceForm.expiresAt}
                                onChange={(e) =>
                                  setInsuranceForm((prev) => ({
                                    ...prev,
                                    expiresAt: e.target.value,
                                  }))
                                }
                                data-testid="input-dashboard-insurance-expiry"
                              />
                              <Input
                                type="number"
                                min="0"
                                step="1000"
                                value={insuranceForm.coverageAmount}
                                onChange={(e) =>
                                  setInsuranceForm((prev) => ({
                                    ...prev,
                                    coverageAmount: e.target.value,
                                  }))
                                }
                                placeholder="Coverage amount (optional)"
                                data-testid="input-dashboard-insurance-coverage"
                              />
                            </div>
                            <DocumentUpload
                              onDocumentsChange={setOnboardingDocuments}
                              maxFiles={3}
                              maxFileSize={10 * 1024 * 1024}
                              uploadEndpoint="/api/business/insurance/upload-document"
                            />
                            <div className="space-y-3 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3">
                              <label className="flex items-start gap-2 text-sm text-[color:var(--text-secondary)]">
                                <Checkbox
                                  checked={
                                    insuranceForm.attestedCommercialCoverage
                                  }
                                  onCheckedChange={(checked) =>
                                    setInsuranceForm((prev) => ({
                                      ...prev,
                                      attestedCommercialCoverage:
                                        checked === true,
                                    }))
                                  }
                                />
                                <span>
                                  This is current commercial coverage for this
                                  business.
                                </span>
                              </label>
                              <label className="flex items-start gap-2 text-sm text-[color:var(--text-secondary)]">
                                <Checkbox
                                  checked={
                                    insuranceForm.attestedJurisdictionCompliance
                                  }
                                  onCheckedChange={(checked) =>
                                    setInsuranceForm((prev) => ({
                                      ...prev,
                                      attestedJurisdictionCompliance:
                                        checked === true,
                                    }))
                                  }
                                />
                                <span>
                                  This coverage meets the requirements where
                                  this business operates.
                                </span>
                              </label>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Button
                                onClick={() =>
                                  submitVerificationMutation.mutate()
                                }
                                disabled={
                                  submitVerificationMutation.isPending ||
                                  onboardingDocuments.length === 0 ||
                                  !insuranceForm.expiresAt ||
                                  !insuranceForm.attestedCommercialCoverage ||
                                  !insuranceForm.attestedJurisdictionCompliance
                                }
                                data-testid="button-submit-dashboard-verification"
                              >
                                {submitVerificationMutation.isPending ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Submitting...
                                  </>
                                ) : (
                                  "Submit insurance"
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={skipVerificationToday}
                                disabled={snoozeVerificationMutation.isPending}
                              >
                                {snoozeVerificationMutation.isPending ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Skipping...
                                  </>
                                ) : (
                                  "Skip for today"
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              onClick={openVerificationUpload}
                            >
                              Upload document
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={skipVerificationToday}
                              disabled={snoozeVerificationMutation.isPending}
                            >
                              {snoozeVerificationMutation.isPending
                                ? "Skipping..."
                                : "Skip for today"}
                            </Button>
                          </div>
                        )
                      ) : null}
                    </div>
                  )}

                  {onboardingCompletion.insurance?.status === "pending" && (
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      Insurance proof is pending review. No action needed right now.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

      {/* Post-Upgrade Onboarding Checklist — shown to subscribed users until all items are complete */}
      {!isAdmin &&
        !isStaff &&
        subscription?.hasAccess &&
        currentRestaurant &&
        (() => {
          const hasPhoto = Boolean(
            (currentRestaurant as any).imageUrl ||
            (currentRestaurant as any).logoUrl,
          );
          const hasMenu = ownerMenus.length > 0;
          const hasAddress = Boolean(
            (currentRestaurant as any).address ||
            (currentRestaurant as any).city,
          );
          const hasPhone = Boolean(
            (currentRestaurant as any).phone ||
            (currentRestaurant as any).contactPhone,
          );
          const hasDeal = (stats?.activeDeals || 0) > 0;
          const checklistItems = [
            {
              label: "Profile photo or logo uploaded",
              done: hasPhoto,
              href: `/edit-restaurant/${selectedRestaurant}?focus=logoUrl`,
            },
            {
              label: "Address or service area set",
              done: hasAddress,
              href: `/edit-restaurant/${selectedRestaurant}?focus=address`,
            },
            {
              label: "Phone number added",
              done: hasPhone,
              href: `/edit-restaurant/${selectedRestaurant}?focus=phone`,
            },
            {
              label: "Online menu linked or built",
              done: hasMenu,
              href: `/menu-builder/${selectedRestaurant}`,
            },
            {
              label: "First special or deal created",
              done: hasDeal,
              href: dealCreationPath,
            },
          ];
          const completedCount = checklistItems.filter((i) => i.done).length;
          if (completedCount === checklistItems.length) return null;
          return (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-blue-900">
                    Get the most out of your subscription
                  </h2>
                  <p className="text-xs text-blue-700 mt-0.5">
                    {completedCount} of {checklistItems.length} steps complete
                  </p>
                </div>
                <span className="text-xs font-medium text-blue-600">
                  {Math.round((completedCount / checklistItems.length) * 100)}%
                </span>
              </div>
              <div className="mb-3 h-1.5 w-full rounded-full bg-blue-200">
                <div
                  className="h-1.5 rounded-full bg-blue-500 transition-all"
                  style={{
                    width: `${Math.round((completedCount / checklistItems.length) * 100)}%`,
                  }}
                />
              </div>
              <ul className="space-y-2">
                {checklistItems.map((item) => (
                  <li key={item.label} className="flex items-center gap-3">
                    {item.done ? (
                      <CheckCircle className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                    ) : (
                      <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-blue-400" />
                    )}
                    {item.done ? (
                      <span className="text-sm text-blue-700 line-through opacity-60">
                        {item.label}
                      </span>
                    ) : (
                      <Link href={item.href}>
                        <span className="text-sm font-medium text-blue-800 underline underline-offset-2 hover:text-blue-600 cursor-pointer">
                          {item.label}
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

      {/* Stats Cards */}
      {(canManageDeals || canViewAnalytics) && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Active Specials
              </CardDescription>
              <CardTitle className="text-3xl">
                {stats?.activeDeals || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Total Views
              </CardDescription>
              <CardTitle className="text-3xl">
                {stats?.totalViews || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Claims
              </CardDescription>
              <CardTitle className="text-3xl">
                {stats?.totalClaims || 0}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Conversion Rate
              </CardDescription>
              <CardTitle className="text-3xl">
                {stats?.conversionRate?.toFixed(1) || 0}%
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Deals Management */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList className="w-full h-auto justify-start overflow-x-auto whitespace-nowrap">
          {canManageDeals ? (
            <TabsTrigger value="active" className="px-3 text-xs sm:text-sm">
              Active Specials
            </TabsTrigger>
          ) : null}
          {canManageDeals ? (
            <TabsTrigger value="inactive" className="px-3 text-xs sm:text-sm">
              Inactive Specials
            </TabsTrigger>
          ) : null}
          {canManageProfile ? (
            <TabsTrigger value="catering" className="px-3 text-xs sm:text-sm">
              <UtensilsCrossed className="mr-1 hidden h-4 w-4 sm:block" />
              {cateringUi.tab}
            </TabsTrigger>
          ) : null}
          {canViewAnalytics ? (
            <TabsTrigger value="analytics" className="px-3 text-xs sm:text-sm">
              Analytics
            </TabsTrigger>
          ) : null}
          {canManageBilling ? (
            <TabsTrigger value="credits" className="px-3 text-xs sm:text-sm">
              <CreditCard className="mr-1 hidden h-4 w-4 sm:block" />
              MealScout Credits
            </TabsTrigger>
          ) : null}
          {canManageParkingPass ? (
            <TabsTrigger value="bookings" className="px-3 text-xs sm:text-sm">
              Bookings
            </TabsTrigger>
          ) : null}
          {canManageParkingPass ? (
            <TabsTrigger
              value="foodtruck"
              className="px-3 text-xs sm:text-sm"
              data-testid="tab-food-truck"
            >
              <Truck className="mr-1 hidden h-4 w-4 sm:block" />
              Food Truck
            </TabsTrigger>
          ) : null}
        </TabsList>

        {canManageDeals ? (
          <TabsContent value="active" className="space-y-4">
            {loadingDeals ? (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                </CardContent>
              </Card>
            ) : (
              deals
                .filter((deal) => deal.isActive)
                .map((deal) => (
                  <Card key={deal.id}>
                    <CardContent className="p-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-1 items-start gap-4 min-w-0">
                          <img
                            src={getDealImageUrl(deal)}
                            alt={`${deal.title} image`}
                            loading="lazy"
                            className="h-20 w-20 flex-none rounded-xl object-cover border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)]"
                            onError={(event) => {
                              event.currentTarget.src = DEAL_IMAGE_FALLBACK;
                            }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <h3 className="text-lg font-semibold min-w-0 break-words">
                                {deal.title}
                              </h3>
                              <Badge
                                className={getDealTypeColor(deal.dealType)}
                              >
                                {deal.dealType || "special"}
                              </Badge>
                            </div>

                            <p className="text-muted-foreground mb-3">
                              {deal.description}
                            </p>

                            <div className="flex flex-wrap gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <DollarSign className="h-4 w-4" />
                                <span className="font-medium">
                                  {deal.discountValue ?? "Limited Time"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span>
                                  {deal.availableDuringBusinessHours
                                    ? "During business hours"
                                    : deal.startTime && deal.endTime
                                      ? `${formatTime(deal.startTime)} - ${formatTime(
                                          deal.endTime,
                                        )}`
                                      : "All day"}
                                </span>
                              </div>
                              {deal.totalUsesLimit && (
                                <div className="flex items-center gap-1">
                                  <Users className="h-4 w-4" />
                                  <span>
                                    {deal.currentUses || 0} /{" "}
                                    {deal.totalUsesLimit} claimed
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                          <Link href={`/deal/${deal.id}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`button-view-${deal.id}`}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </Link>
                          <Link href={`/deal-edit/${deal.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`button-edit-${deal.id}`}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleDealMutation.mutate({
                                dealId: deal.id,
                                isActive: Boolean(deal.isActive),
                              })
                            }
                            data-testid={`button-deactivate-${deal.id}`}
                          >
                            {deal.isActive ? "Pause" : "Activate"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                confirm(
                                  `Are you sure you want to delete "${deal.title}"? This cannot be undone.`,
                                )
                              ) {
                                deleteDealMutation.mutate(deal.id);
                              }
                            }}
                            data-testid={`button-delete-${deal.id}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
            )}

            {deals.filter((deal) => deal.isActive).length === 0 &&
              !loadingDeals && (
                <Card>
                  <CardContent className="text-center py-12">
                    <p className="text-muted-foreground mb-4">
                      No active specials
                    </p>
                    <Link href={dealCreationPath}>
                      <Button data-testid="button-create-first-deal">
                        <Plus className="h-4 w-4 mr-2" />
                        Create Your First Special
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
          </TabsContent>
        ) : null}

        {canManageDeals ? (
          <TabsContent value="inactive" className="space-y-4">
            {deals
              .filter((deal) => !deal.isActive)
              .map((deal) => (
                <Card key={deal.id} className="opacity-75">
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex flex-1 items-start gap-4 min-w-0">
                        <img
                          src={getDealImageUrl(deal)}
                          alt={`${deal.title} image`}
                          loading="lazy"
                          className="h-20 w-20 flex-none rounded-xl object-cover border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)]"
                          onError={(event) => {
                            event.currentTarget.src = DEAL_IMAGE_FALLBACK;
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-lg font-semibold min-w-0 break-words">
                              {deal.title}
                            </h3>
                            <Badge variant="secondary">Inactive</Badge>
                          </div>
                          <p className="text-muted-foreground mb-3">
                            {deal.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            toggleDealMutation.mutate({
                              dealId: deal.id,
                              isActive: Boolean(deal.isActive),
                            })
                          }
                          data-testid={`button-activate-${deal.id}`}
                        >
                          Activate
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteDealMutation.mutate(deal.id)}
                          data-testid={`button-delete-inactive-${deal.id}`}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

            {deals.filter((deal) => !deal.isActive).length === 0 &&
              !loadingDeals && (
                <Card>
                  <CardContent className="text-center py-12">
                    <p className="text-muted-foreground">
                      No inactive specials
                    </p>
                  </CardContent>
                </Card>
              )}
          </TabsContent>
        ) : null}

        {canManageProfile ? (
          <TabsContent value="catering" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <UtensilsCrossed className="h-5 w-5" />
                      {cateringUi.title}
                    </CardTitle>
                    <CardDescription>
                      {cateringUi.description}
                    </CardDescription>
                  </div>
                  <Badge variant={offersCatering ? "default" : "outline"}>
                    {offersCatering ? cateringUi.badgeOn : cateringUi.badgeOff}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold">
                        {cateringUi.promote}
                      </h3>
                      <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                        {cateringUi.helper}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={offersCatering ? "outline" : "default"}
                      onClick={() =>
                        updateCateringMutation.mutate(!offersCatering)
                      }
                      disabled={
                        !selectedRestaurant || updateCateringMutation.isPending
                      }
                      data-testid="button-toggle-catering"
                    >
                      {updateCateringMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <UtensilsCrossed className="mr-2 h-4 w-4" />
                      )}
                      {offersCatering ? "Turn off" : "Turn on"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium">Headline</label>
                    <Input
                      value={cateringForm.headline}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          headline: event.target.value,
                        }))
                      }
                      placeholder={cateringUi.headlinePlaceholder}
                      data-testid="input-catering-headline"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium">Details</label>
                    <textarea
                      value={cateringForm.description}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      rows={4}
                      maxLength={800}
                      placeholder={cateringUi.detailsPlaceholder}
                      className="w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
                      data-testid="textarea-catering-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Service area</label>
                    <Input
                      value={cateringForm.serviceArea}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          serviceArea: event.target.value,
                        }))
                      }
                      placeholder="Pensacola, Gulf Breeze, Milton"
                      data-testid="input-catering-service-area"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Contact preference
                    </label>
                    <Input
                      value={cateringForm.contactPreference}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          contactPreference: event.target.value,
                        }))
                      }
                      placeholder="Call, text, email, or MealScout message"
                      data-testid="input-catering-contact-preference"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Minimum guests
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={cateringForm.minimumGuests}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          minimumGuests: event.target.value,
                        }))
                      }
                      placeholder="25"
                      data-testid="input-catering-minimum-guests"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Lead time in days
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={cateringForm.leadTimeDays}
                      onChange={(event) =>
                        setCateringForm((prev) => ({
                          ...prev,
                          leadTimeDays: event.target.value,
                        }))
                      }
                      placeholder="3"
                      data-testid="input-catering-lead-time"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    onClick={() => updateCateringMutation.mutate(true)}
                    disabled={
                      !selectedRestaurant || updateCateringMutation.isPending
                    }
                    data-testid="button-save-catering"
                  >
                    {updateCateringMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {cateringUi.save}
                  </Button>
                  {offersCatering ? (
                    <>
                      <Button variant="outline" asChild>
                        <Link href={cateringProfilePath}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          View public profile
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href={`/menu-builder/${selectedRestaurant}`}>
                          <Store className="mr-2 h-4 w-4" />
                          {cateringUi.menu}
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/messages">
                          <MessageCircle className="mr-2 h-4 w-4" />
                          Messages
                        </Link>
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canViewAnalytics ? (
          <TabsContent value="analytics">
            <div className="space-y-6">
              {/* Analytics Header with Date Range */}
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Performance Analytics
                      </CardTitle>
                      <CardDescription>
                        Comprehensive insights into your specials performance
                        and customer engagement
                      </CardDescription>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={analyticsDateRange.start}
                          onChange={(e) =>
                            setAnalyticsDateRange((prev) => ({
                              ...prev,
                              start: e.target.value,
                            }))
                          }
                          className="px-3 py-2 border rounded-md text-sm"
                          data-testid="input-analytics-start-date"
                        />
                        <input
                          type="date"
                          value={analyticsDateRange.end}
                          onChange={(e) =>
                            setAnalyticsDateRange((prev) => ({
                              ...prev,
                              end: e.target.value,
                            }))
                          }
                          className="px-3 py-2 border rounded-md text-sm"
                          data-testid="input-analytics-end-date"
                        />
                      </div>
                      {hasAnalyticsAccess && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const url = `/api/restaurants/${selectedRestaurant}/analytics/export?startDate=${analyticsDateRange.start}&endDate=${analyticsDateRange.end}&format=csv`;
                            window.open(url, "_blank");
                          }}
                          data-testid="button-export-analytics"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Export CSV
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Performance Overview Cards */}
              {loadingAnalytics ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Card key={i}>
                      <CardContent className="p-6">
                        <div className="animate-pulse space-y-2">
                          <div className="h-4 bg-muted rounded w-3/4"></div>
                          <div className="h-8 bg-muted rounded w-1/2"></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Total Views
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-total-views"
                          >
                            {(
                              analyticsSummary as any
                            )?.totalViews?.toLocaleString() || 0}
                          </p>
                        </div>
                        <Eye className="h-8 w-8 text-[color:var(--accent-text)]" />
                      </div>
                      {comparison &&
                        (comparison as any)?.changes &&
                        typeof (comparison as any).changes.viewsChange ===
                          "number" && (
                          <div className="mt-2 flex items-center text-xs">
                            <TrendingUp
                              className={`h-3 w-3 mr-1 ${
                                (comparison as any).changes.viewsChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }`}
                            />
                            <span
                              className={
                                (comparison as any).changes.viewsChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }
                            >
                              {(comparison as any).changes.viewsChange >= 0
                                ? "+"
                                : ""}
                              {(comparison as any).changes.viewsChange.toFixed(
                                1,
                              )}
                              %
                            </span>
                            <span className="text-muted-foreground ml-1">
                              vs previous period
                            </span>
                          </div>
                        )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Total Claims
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-total-claims"
                          >
                            {(
                              analyticsSummary as any
                            )?.totalClaims?.toLocaleString() || 0}
                          </p>
                        </div>
                        <ShoppingCart className="h-8 w-8 text-[color:var(--status-success)]" />
                      </div>
                      {comparison &&
                        (comparison as any)?.changes &&
                        typeof (comparison as any).changes.claimsChange ===
                          "number" && (
                          <div className="mt-2 flex items-center text-xs">
                            <TrendingUp
                              className={`h-3 w-3 mr-1 ${
                                (comparison as any).changes.claimsChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }`}
                            />
                            <span
                              className={
                                (comparison as any).changes.claimsChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }
                            >
                              {(comparison as any).changes.claimsChange >= 0
                                ? "+"
                                : ""}
                              {(comparison as any).changes.claimsChange.toFixed(
                                1,
                              )}
                              %
                            </span>
                            <span className="text-muted-foreground ml-1">
                              vs previous period
                            </span>
                          </div>
                        )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Total Revenue
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-total-revenue"
                          >
                            $
                            {(
                              analyticsSummary as any
                            )?.totalRevenue?.toLocaleString() || 0}
                          </p>
                        </div>
                        <DollarSign className="h-8 w-8 text-yellow-500" />
                      </div>
                      {comparison &&
                        (comparison as any)?.changes &&
                        typeof (comparison as any).changes.revenueChange ===
                          "number" && (
                          <div className="mt-2 flex items-center text-xs">
                            <TrendingUp
                              className={`h-3 w-3 mr-1 ${
                                (comparison as any).changes.revenueChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }`}
                            />
                            <span
                              className={
                                (comparison as any).changes.revenueChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }
                            >
                              {(comparison as any).changes.revenueChange >= 0
                                ? "+"
                                : ""}
                              {(
                                comparison as any
                              ).changes.revenueChange.toFixed(1)}
                              %
                            </span>
                            <span className="text-muted-foreground ml-1">
                              vs previous period
                            </span>
                          </div>
                        )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">
                            Conversion Rate
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-conversion-rate"
                          >
                            {(analyticsSummary as any)?.conversionRate?.toFixed(
                              1,
                            ) || 0}
                            %
                          </p>
                        </div>
                        <TrendingUp className="h-8 w-8 text-purple-500" />
                      </div>
                      {comparison &&
                        (comparison as any)?.changes &&
                        typeof (comparison as any).changes
                          .conversionRateChange === "number" && (
                          <div className="mt-2 flex items-center text-xs">
                            <TrendingUp
                              className={`h-3 w-3 mr-1 ${
                                (comparison as any).changes
                                  .conversionRateChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }`}
                            />
                            <span
                              className={
                                (comparison as any).changes
                                  .conversionRateChange >= 0
                                  ? "text-[color:var(--status-success)]"
                                  : "text-[color:var(--status-error)]"
                              }
                            >
                              {(comparison as any).changes
                                .conversionRateChange >= 0
                                ? "+"
                                : ""}
                              {(
                                comparison as any
                              ).changes.conversionRateChange.toFixed(1)}
                              %
                            </span>
                            <span className="text-muted-foreground ml-1">
                              vs previous period
                            </span>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Premium Analytics Cards - Favorites & Recommendations */}
              {hasAnalyticsAccess ? (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <Card className="border-yellow-200 dark:border-yellow-800">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Star className="h-3 w-3" />
                            Total Favorites
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-total-favorites"
                          >
                            {loadingFavorites ? (
                              <div className="animate-pulse bg-muted rounded w-16 h-8"></div>
                            ) : (
                              favoritesAnalytics?.totalFavorites?.toLocaleString() ||
                              0
                            )}
                          </p>
                        </div>
                        <Star className="h-8 w-8 text-yellow-500" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Users who favorited your restaurant
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-[color:var(--border-subtle)] dark:border-blue-800">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Zap className="h-3 w-3" />
                            Recommendations
                          </p>
                          <p
                            className="text-2xl font-bold"
                            data-testid="text-total-recommendations"
                          >
                            {loadingRecommendations ? (
                              <div className="animate-pulse bg-muted rounded w-16 h-8"></div>
                            ) : (
                              recommendationsAnalytics?.totalRecommendations?.toLocaleString() ||
                              0
                            )}
                          </p>
                        </div>
                        <Zap className="h-8 w-8 text-[color:var(--accent-text)]" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Times shown in recommendations •{" "}
                        {recommendationsAnalytics?.clickThroughRate?.toFixed(
                          1,
                        ) || 0}
                        % CTR
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="mt-4 border-dashed border-2">
                  <CardContent className="p-6 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CreditCard className="h-5 w-5" />
                        <span className="text-sm font-medium">
                          Premium Analytics
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Upgrade for premium analytics on special performance and
                        growth trends.
                      </p>
                      <Link href="/subscribe">
                        <Button
                          size="sm"
                          className="mt-2"
                          data-testid="button-upgrade-for-analytics"
                        >
                          <TrendingUp className="h-4 w-4 mr-2" />
                          Upgrade Plan
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Revenue Timeline Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Revenue Over Time</CardTitle>
                    <CardDescription>
                      Daily revenue and special performance trends
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analyticsTimeseries &&
                    (analyticsTimeseries as any[]).length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={analyticsTimeseries as any[]}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Line
                            type="monotone"
                            dataKey="revenue"
                            stroke="#8884d8"
                            strokeWidth={2}
                          />
                          <Line
                            type="monotone"
                            dataKey="claims"
                            stroke="#82ca9d"
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No data available for selected period
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Views vs Claims Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Views vs Claims</CardTitle>
                    <CardDescription>
                      Daily views and conversion tracking
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {analyticsTimeseries &&
                    (analyticsTimeseries as any[]).length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={analyticsTimeseries as any[]}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="views" fill="#8884d8" />
                          <Bar dataKey="claims" fill="#82ca9d" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        No data available for selected period
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Top Deals Performance */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    Top Performing Specials
                  </CardTitle>
                  <CardDescription>
                    Your most successful specials ranked by views and revenue
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {(analyticsSummary as any)?.topDeals?.length > 0 ? (
                    <div className="space-y-4">
                      {(analyticsSummary as any).topDeals.map(
                        (deal: any, index: number) => (
                          <div
                            key={deal.dealId}
                            className="flex items-center justify-between p-4 border rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                                {index + 1}
                              </div>
                              <div>
                                <p className="font-medium">{deal.title}</p>
                                <p className="text-sm text-muted-foreground">
                                  Deal ID: {deal.dealId}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-6 text-sm">
                              <div className="text-center">
                                <p className="font-medium">{deal.views}</p>
                                <p className="text-muted-foreground">Views</p>
                              </div>
                              <div className="text-center">
                                <p className="font-medium">{deal.claims}</p>
                                <p className="text-muted-foreground">Claims</p>
                              </div>
                              <div className="text-center">
                                <p className="font-medium">${deal.revenue}</p>
                                <p className="text-muted-foreground">Revenue</p>
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No special performance data available
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Customer Insights */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Customer Insights</CardTitle>
                    <CardDescription>
                      Understanding your customer behavior
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Repeat Customers
                        </p>
                        <p className="text-2xl font-bold">
                          {(customerInsights as any)?.repeatCustomers || 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Avg Order Value
                        </p>
                        <p className="text-2xl font-bold">
                          $
                          {(
                            customerInsights as any
                          )?.averageOrderValue?.toFixed(2) || 0}
                        </p>
                      </div>
                    </div>

                    {(customerInsights as any)?.peakHours?.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">
                          Peak Hours
                        </p>
                        <div className="space-y-1">
                          {(customerInsights as any).peakHours
                            .slice(0, 3)
                            .map((hour: any, index: number) => (
                              <div
                                key={hour.hour}
                                className="flex justify-between items-center"
                              >
                                <span className="text-sm">
                                  {hour.hour}:00 - {hour.hour + 1}:00
                                </span>
                                <span className="text-sm font-medium">
                                  {hour.count} orders
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Demographics</CardTitle>
                    <CardDescription>
                      Customer age and gender breakdown
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {(customerInsights as any)?.demographics ? (
                      <div className="space-y-4">
                        {(customerInsights as any).demographics.ageGroups
                          .length > 0 && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-2">
                              Age Groups
                            </p>
                            <div className="space-y-1">
                              {(
                                customerInsights as any
                              ).demographics.ageGroups.map((group: any) => (
                                <div
                                  key={group.range}
                                  className="flex justify-between items-center"
                                >
                                  <span className="text-sm">{group.range}</span>
                                  <span className="text-sm font-medium">
                                    {group.count}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {(customerInsights as any).demographics.genderBreakdown
                          .length > 0 && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-2">
                              Gender Distribution
                            </p>
                            <div className="space-y-1">
                              {(
                                customerInsights as any
                              ).demographics.genderBreakdown.map(
                                (gender: any) => (
                                  <div
                                    key={gender.gender}
                                    className="flex justify-between items-center"
                                  >
                                    <span className="text-sm capitalize">
                                      {gender.gender}
                                    </span>
                                    <span className="text-sm font-medium">
                                      {gender.count}
                                    </span>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No demographic data available
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        ) : null}

        {/* PHASE R1: MealScout Credits Redemption */}
        {canManageBilling ? (
          <TabsContent value="credits" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Accept MealScout Credits
                </CardTitle>
                <CardDescription>
                  Accept MealScout credits from users as payment. Credits are
                  settled weekly via Stripe.
                </CardDescription>
              </CardHeader>
            </Card>

            {selectedRestaurant && (
              <RestaurantCreditRedemptionForm
                restaurantId={selectedRestaurant}
                onSuccess={(redemption) => {
                  toast({
                    title: "Success",
                    description: `Credit redeemed successfully! Redemption ID: ${redemption.redemption?.id}`,
                  });
                  // Optionally refresh data or update UI
                }}
              />
            )}
          </TabsContent>
        ) : null}

        {canManageParkingPass ? (
          <TabsContent value="bookings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Event Bookings
                </CardTitle>
                <CardDescription>
                  Track upcoming paid event bookings for your selected truck and
                  cancel when needed. Confirmed cancellations do not issue
                  refunds.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">
                      Total bookings
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {visibleTruckBookings.length}
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">Confirmed</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {
                        visibleTruckBookings.filter(
                          (booking) => booking.status === "confirmed",
                        ).length
                      }
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-sm text-muted-foreground">
                      Upcoming spend
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      $
                      {(
                        visibleTruckBookings
                          .filter(
                            (booking) =>
                              booking.status === "confirmed" ||
                              booking.status === "pending",
                          )
                          .reduce(
                            (sum, booking) =>
                              sum + Number(booking.totalCents || 0),
                            0,
                          ) / 100
                      ).toFixed(2)}
                    </p>
                  </div>
                </div>

                {loadingTruckBookings ? (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                    Loading bookings...
                  </div>
                ) : visibleTruckBookings.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No event bookings yet for this truck.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleTruckBookings.map((booking) => {
                      const canCancel =
                        booking.status === "pending" ||
                        booking.status === "confirmed";
                      const eventDate = booking.event?.date
                        ? new Date(booking.event.date)
                        : null;

                      return (
                        <div key={booking.id} className="rounded-lg border p-4">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold">
                                  {booking.event?.host?.businessName ||
                                    "Host venue"}
                                </p>
                                <Badge
                                  variant={
                                    booking.status === "confirmed"
                                      ? "default"
                                      : booking.status === "pending"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {booking.status}
                                </Badge>
                              </div>
                              {booking.event?.host?.address ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <MapPin className="h-4 w-4" />
                                  <span>{booking.event.host.address}</span>
                                </div>
                              ) : null}
                              {eventDate ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Clock className="h-4 w-4" />
                                  <span>
                                    {format(eventDate, "EEE, MMM d")}
                                    {booking.event?.startTime
                                      ? ` at ${booking.event.startTime}`
                                      : ""}
                                    {booking.event?.endTime
                                      ? ` - ${booking.event.endTime}`
                                      : ""}
                                  </span>
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-2 text-sm lg:text-right">
                              <p className="font-semibold">
                                $
                                {(
                                  Number(booking.totalCents || 0) / 100
                                ).toFixed(2)}{" "}
                                total
                              </p>
                              <p className="text-muted-foreground">
                                Host fee $
                                {(
                                  Number(booking.hostPriceCents || 0) / 100
                                ).toFixed(2)}{" "}
                                + platform fee $
                                {(
                                  Number(booking.platformFeeCents || 0) / 100
                                ).toFixed(2)}
                              </p>
                              {canCancel ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={bookingCancelMutation.isPending}
                                  onClick={() => {
                                    if (
                                      confirm(
                                        "Cancel this booking? No refund will be issued.",
                                      )
                                    ) {
                                      bookingCancelMutation.mutate(booking.id);
                                    }
                                  }}
                                >
                                  Cancel Booking
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {canManageParkingPass ? (
          <TabsContent value="foodtruck" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  Food Truck Management
                </CardTitle>
                <CardDescription>
                  Manage your mobile restaurant and broadcast live location to
                  customers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Food Truck Toggle */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <Truck className="h-6 w-6" />
                    <div>
                      <h3 className="font-medium">This is a Food Truck</h3>
                      <p className="text-sm text-muted-foreground">
                        Enable mobile location broadcasting for customers to
                        find you
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={
                      currentRestaurant?.isFoodTruck ? "default" : "outline"
                    }
                    onClick={() =>
                      toggleFoodTruckMutation.mutate(
                        !currentRestaurant?.isFoodTruck,
                      )
                    }
                    data-testid="button-toggle-food-truck"
                  >
                    {currentRestaurant?.isFoodTruck ? "Enabled" : "Enable"}
                  </Button>
                </div>

                {/* Broadcasting Controls */}
                {currentRestaurant?.isFoodTruck && (
                  <div className="space-y-4">
                    <div className="p-4 border rounded-lg">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`p-2 rounded-lg ${
                              connectionStatus === "connected"
                                ? "bg-[color:var(--status-success)]/12"
                                : connectionStatus === "connecting"
                                  ? "bg-yellow-100"
                                  : "bg-[var(--bg-surface-muted)]"
                            }`}
                          >
                            {connectionStatus === "connected" ? (
                              <Radio className="h-5 w-5 text-[color:var(--status-success)]" />
                            ) : connectionStatus === "connecting" ? (
                              <Loader2 className="h-5 w-5 text-yellow-600 animate-spin" />
                            ) : (
                              <WifiOff className="h-5 w-5 text-[color:var(--text-secondary)]" />
                            )}
                          </div>
                          <div>
                            <h3 className="font-medium">
                              Live Location Broadcasting
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {connectionStatus === "connected"
                                ? "Broadcasting your location to customers"
                                : connectionStatus === "connecting"
                                  ? "Connecting to GPS..."
                                  : "Start broadcasting to appear on customer maps"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {!isBroadcasting ? (
                            <Button
                              onClick={handleStartBroadcasting}
                              disabled={
                                startFoodTruckSessionMutation.isPending ||
                                !hasPremiumLocationTools
                              }
                              className="bg-[color:var(--status-success)] hover:bg-[color:var(--status-success)]"
                              data-testid="button-start-broadcasting"
                            >
                              {startFoodTruckSessionMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4 mr-2" />
                              )}
                              Start Broadcasting
                            </Button>
                          ) : (
                            <Button
                              onClick={handleStopBroadcasting}
                              disabled={stopFoodTruckSessionMutation.isPending}
                              variant="destructive"
                              data-testid="button-stop-broadcasting"
                            >
                              {stopFoodTruckSessionMutation.isPending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Square className="h-4 w-4 mr-2" />
                              )}
                              Stop Broadcasting
                            </Button>
                          )}
                          <ShareButton
                            url={liveShareUrl}
                            title={liveShareTitle}
                            description={liveShareDescription}
                            variant="outline"
                            size="sm"
                          />
                        </div>
                      </div>

                      {/* Status Indicators */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center justify-center mb-1">
                            {connectionStatus === "connected" && isConnected ? (
                              <Wifi className="h-4 w-4 text-[color:var(--status-success)]" />
                            ) : connectionStatus === "connected" &&
                              !isConnected ? (
                              <Zap className="h-4 w-4 text-yellow-500" />
                            ) : (
                              <WifiOff className="h-4 w-4 text-[color:var(--status-error)]" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Connection
                          </p>
                          <p
                            className="text-sm font-medium capitalize"
                            data-testid="text-connection-status"
                          >
                            {connectionStatus === "connected" && isConnected
                              ? "Real-time"
                              : connectionStatus === "connected" && !isConnected
                                ? "GPS Only"
                                : connectionStatus}
                          </p>
                          {wsError && (
                            <p className="text-xs text-[color:var(--status-error)] mt-1">
                              WS: {wsError}
                            </p>
                          )}
                        </div>

                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center justify-center mb-1">
                            <Activity className="h-4 w-4 text-[color:var(--accent-text)]" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Updates Sent
                          </p>
                          <p
                            className="text-sm font-medium"
                            data-testid="text-broadcast-count"
                          >
                            {broadcastCount}
                          </p>
                        </div>

                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center justify-center mb-1">
                            <Satellite className="h-4 w-4 text-orange-500" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            GPS Accuracy
                          </p>
                          <p
                            className="text-sm font-medium"
                            data-testid="text-gps-accuracy"
                          >
                            {gpsAccuracy
                              ? `${Math.round(gpsAccuracy)}m`
                              : "N/A"}
                          </p>
                        </div>

                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center justify-center mb-1">
                            <Clock className="h-4 w-4 text-purple-500" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Last Update
                          </p>
                          <p
                            className="text-sm font-medium"
                            data-testid="text-last-broadcast"
                          >
                            {lastBroadcast
                              ? format(lastBroadcast, "HH:mm:ss")
                              : "Never"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Current Location Display */}
                    {currentLocation && (
                      <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-medium flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            Current Location
                          </h3>
                          <div className="flex items-center text-xs text-muted-foreground">
                            <NavigationIcon className="h-3 w-3 mr-1" />
                            Live GPS
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">
                              Latitude:
                            </span>
                            <p
                              className="font-mono"
                              data-testid="text-current-lat"
                            >
                              {currentLocation.lat.toFixed(6)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              Longitude:
                            </span>
                            <p
                              className="font-mono"
                              data-testid="text-current-lng"
                            >
                              {currentLocation.lng.toFixed(6)}
                            </p>
                          </div>
                        </div>
                        {currentLocation.timestamp && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Recorded:{" "}
                            {format(
                              new Date(currentLocation.timestamp),
                              "PPpp",
                            )}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Error Display */}
                    {locationError && (
                      <div className="p-4 border border-[color:var(--status-error)]/30 bg-[color:var(--status-error)]/10 rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-[color:var(--status-error)]" />
                          <span className="text-sm font-medium text-[color:var(--status-error)]">
                            Location Error
                          </span>
                        </div>
                        <p
                          className="text-sm text-[color:var(--status-error)] mt-1"
                          data-testid="text-location-error"
                        >
                          {locationError}
                        </p>
                      </div>
                    )}

                    {/* Tips and Information */}
                    <div className="p-4 bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-lg">
                      <h4 className="font-medium text-[color:var(--accent-text)] mb-2 flex items-center gap-2">
                        <Smartphone className="h-4 w-4" />
                        Broadcasting Tips
                      </h4>
                      <ul className="text-sm text-[color:var(--accent-text)] space-y-1">
                        <li>
                          • Keep GPS enabled for accurate location tracking
                        </li>
                        <li>
                          • Location updates every 30 seconds or when you move
                          50+ meters
                        </li>
                        <li>
                          • Sessions auto-stop after 2 minutes of inactivity
                        </li>
                        <li>
                          • Customers can see your live location and active
                          specials
                        </li>
                        <li>• Works best with mobile internet connection</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* Restaurant Location Update */}
                <Separator />
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-[color:var(--accent-text)]/12">
                          <MapPin className="h-5 w-5 text-[color:var(--accent-text)]" />
                        </div>
                        <div>
                          <h3 className="font-medium">
                            Update Restaurant Location
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Update your restaurant's permanent address location
                            using GPS
                          </p>
                        </div>
                      </div>
                      <Button
                        onClick={handleUpdateRestaurantLocation}
                        disabled={
                          isUpdatingLocation ||
                          updateRestaurantLocationMutation.isPending ||
                          !hasPremiumLocationTools
                        }
                        variant="outline"
                        data-testid="button-update-location"
                      >
                        {isUpdatingLocation ||
                        updateRestaurantLocationMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Update Location
                      </Button>
                    </div>

                    {/* Current Restaurant Location */}
                    {(currentRestaurant?.city || currentRestaurant?.state) && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">
                          Current Location:
                        </span>
                        <p
                          className="font-medium"
                          data-testid="text-restaurant-location"
                        >
                          {currentRestaurant.city || "Unknown Location"}
                          {currentRestaurant.state
                            ? `, ${currentRestaurant.state}`
                            : ""}
                        </p>
                      </div>
                    )}

                    {/* Location Update Error */}
                    {locationUpdateError && (
                      <div className="mt-3 p-3 border border-[color:var(--status-error)]/30 bg-[color:var(--status-error)]/10 rounded-lg">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-[color:var(--status-error)]" />
                          <span className="text-sm font-medium text-[color:var(--status-error)]">
                            Update Error
                          </span>
                        </div>
                        <p
                          className="text-sm text-[color:var(--status-error)] mt-1"
                          data-testid="text-location-update-error"
                        >
                          {locationUpdateError}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Operating Hours Management */}
                <Separator />
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-[color:var(--status-success)]/12">
                          <Clock className="h-5 w-5 text-[color:var(--status-success)]" />
                        </div>
                        <div>
                          <h3 className="font-medium">Operating Hours</h3>
                          <p className="text-sm text-muted-foreground">
                            Set your restaurant's opening and closing hours for
                            each day
                          </p>
                        </div>
                      </div>
                    </div>

                    <Form {...operatingHoursForm}>
                      <form
                        onSubmit={operatingHoursForm.handleSubmit(
                          handleOperatingHoursSubmit,
                        )}
                        className="space-y-4"
                      >
                        {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(
                          (day) => {
                            const dayName = {
                              mon: "Monday",
                              tue: "Tuesday",
                              wed: "Wednesday",
                              thu: "Thursday",
                              fri: "Friday",
                              sat: "Saturday",
                              sun: "Sunday",
                            }[day];

                            const timeSlots =
                              operatingHoursForm.watch(
                                day as keyof OperatingHoursFormData,
                              ) || [];

                            return (
                              <div key={day} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <FormLabel className="text-sm font-medium">
                                    {dayName}
                                  </FormLabel>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      addTimeSlot(
                                        day as keyof OperatingHoursFormData,
                                      )
                                    }
                                    disabled={timeSlots.length >= 3}
                                    data-testid={`button-add-${day}-hours`}
                                  >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Add Hours
                                  </Button>
                                </div>

                                {timeSlots.length === 0 ? (
                                  <p
                                    className="text-sm text-muted-foreground pl-2"
                                    data-testid={`text-${day}-closed`}
                                  >
                                    Closed
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {timeSlots.map((slot, index) => (
                                      <div
                                        key={index}
                                        className="flex items-center gap-2"
                                      >
                                        <FormField
                                          control={operatingHoursForm.control}
                                          name={`${day}.${index}.open` as any}
                                          render={({ field }) => (
                                            <FormItem className="flex-1">
                                              <FormControl>
                                                <Input
                                                  {...field}
                                                  type="time"
                                                  placeholder="09:00"
                                                  data-testid={`input-${day}-${index}-open`}
                                                />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <span className="text-sm text-muted-foreground">
                                          to
                                        </span>
                                        <FormField
                                          control={operatingHoursForm.control}
                                          name={`${day}.${index}.close` as any}
                                          render={({ field }) => (
                                            <FormItem className="flex-1">
                                              <FormControl>
                                                <Input
                                                  {...field}
                                                  type="time"
                                                  placeholder="17:00"
                                                  data-testid={`input-${day}-${index}-close`}
                                                />
                                              </FormControl>
                                              <FormMessage />
                                            </FormItem>
                                          )}
                                        />
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() =>
                                            removeTimeSlot(
                                              day as keyof OperatingHoursFormData,
                                              index,
                                            )
                                          }
                                          data-testid={`button-remove-${day}-${index}-hours`}
                                        >
                                          <RotateCcw className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          },
                        )}

                        <div className="flex items-center gap-3 pt-4">
                          <Button
                            type="submit"
                            disabled={updateOperatingHoursMutation.isPending}
                            data-testid="button-save-operating-hours"
                          >
                            {updateOperatingHoursMutation.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4 mr-2" />
                            )}
                            Save Operating Hours
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => operatingHoursForm.reset()}
                            data-testid="button-reset-operating-hours"
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      {/* Bottom Navigation */}
      <Navigation />
    </div>
  );
}
