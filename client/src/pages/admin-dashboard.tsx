import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import { useEffectiveLocationContext } from "@/hooks/useEffectiveLocationContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/navigation";
import {
  Shield,
  Users,
  Store,
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Activity,
  Package,
  Settings,
  Eye,
  MapPin,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  UserMinus,
  ExternalLink,
  MessageSquare,
  Copy,
} from "lucide-react";
import { Link } from "wouter";
import QuickDashboardAccess from "@/components/quick-dashboard-access";
import HostLocationManager from "@/components/admin/host-location-manager";
import ShareHub from "@/components/share-hub";
import { getOptimizedImageUrl } from "@/lib/images";
import { toSeoSlug } from "@/lib/seo-slug";
import LongPressHelp from "@/components/long-press-help";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DashboardStats {
  totalUsers: number;
  totalRestaurants: number;
  totalRestaurantProfiles?: number;
  totalRestaurantOwners?: number;
  memberCountsTotal?: number;
  unclassifiedUsers?: number;
  totalDeals: number;
  activeDeals: number;
  totalClaims: number;
  todayClaims: number;
  revenue: number;
  newUsersToday: number;
  memberCounts?: {
    customer: number;
    restaurantOwner: number;
    foodTruck: number;
    host: number;
    eventCoordinator: number;
    staff: number;
    admin: number;
    duperAdmin: number;
    superAdmin: number;
    other: number;
  };
}

const isAdminFamilyUserType = (userType?: string | null) =>
  userType === "admin" ||
  userType === "duper_admin" ||
  userType === "super_admin";

const isDuperOrRootUserType = (userType?: string | null) =>
  userType === "duper_admin" || userType === "super_admin";

const isRootSuperAdminUserType = (userType?: string | null) =>
  userType === "super_admin";

const businessBearingUserTypes = new Set([
  "restaurant_owner",
  "food_truck",
  "host",
  "event_coordinator",
  "supplier",
]);

const monthlySubscriptionLinkUserTypes = new Set([
  "restaurant_owner",
  "food_truck",
]);

const isBusinessBearingUserType = (userType?: string | null) =>
  businessBearingUserTypes.has(String(userType || "").toLowerCase());

const isBusinessUserType = (userType?: string | null) => {
  const type = String(userType || "").toLowerCase();
  return type === "food_truck" || type === "restaurant_owner";
};

const canSendMonthlySubscriptionLink = (userType?: string | null) =>
  monthlySubscriptionLinkUserTypes.has(String(userType || "").toLowerCase());

const canonicalMealScoutOrigin = (
  import.meta.env.VITE_PUBLIC_BASE_URL ||
  import.meta.env.VITE_PUBLIC_ORIGIN ||
  "https://www.mealscout.us"
).replace(/\/+$/, "");

const isAffiliateEligibleUserType = (userType?: string | null) =>
  !isAdminFamilyUserType(String(userType || "").toLowerCase());

const getAdminUserPublicProfilePath = (
  user: any,
  attachedRestaurant?: any | null,
  attachedHostProfile?: any | null,
) => {
  const attachedCleanPath = String(
    attachedRestaurant?.cleanBusinessPath ||
      attachedHostProfile?.cleanBusinessPath ||
      "",
  ).trim();
  if (attachedCleanPath) return attachedCleanPath;

  const restaurantId = String(user?.restaurantId || "").trim();
  if (restaurantId) {
    const businessType = String(user?.businessType || "").toLowerCase();
    const profileType =
      user?.businessIsFoodTruck === true ||
      user?.userType === "food_truck" ||
      businessType === "food_truck"
        ? "truck"
        : "restaurant";
    const slug = toSeoSlug(
      user?.businessName ||
        `${String(user?.firstName || "").trim()} ${String(user?.lastName || "").trim()}` ||
        restaurantId,
    );
    return (
      buildPublicProfilePath({
        entityType: profileType,
        id: restaurantId,
        slug,
        name: user?.businessName,
      }) || "/"
    );
  }

  const hostId = String(attachedHostProfile?.id || "").trim();
  if (hostId) {
    const slug = toSeoSlug(
      attachedHostProfile?.businessName ||
        attachedHostProfile?.name ||
        user?.businessName ||
        hostId,
    );
    return (
      buildPublicProfilePath({
        entityType: "location",
        id: hostId,
        slug,
        name: attachedHostProfile?.businessName || attachedHostProfile?.name,
      }) || "/"
    );
  }

  return "/";
};

const buildCanonicalAffiliateLink = (
  affiliateTag?: string | null,
  user?: any,
  attachedRestaurant?: any | null,
  attachedHostProfile?: any | null,
) => {
  const tag = String(affiliateTag || "").trim();
  if (!tag) return null;
  const profilePath = getAdminUserPublicProfilePath(
    user,
    attachedRestaurant,
    attachedHostProfile,
  );
  if (!profilePath || profilePath === "/") return null;
  const url = new URL(profilePath, canonicalMealScoutOrigin);
  const normalizedPathname = url.pathname.replace(/\/+$/, "") || "/";
  url.pathname = normalizedPathname;
  url.searchParams.delete("to");
  url.searchParams.set("ref", tag);
  return url.toString();
};

const getSafeAuthProviderLabel = (user: any) => {
  const provider = String(user?.authProvider || "").toLowerCase();
  if (provider === "password") return "Password";
  if (provider === "google") return "Google";
  if (provider === "facebook") return "Facebook";
  return "Unknown";
};

const businessTypeOptions = [
  { value: "food_truck", label: "Food Truck" },
  { value: "restaurant", label: "Restaurant" },
  { value: "bar", label: "Bar" },
  { value: "brewery_taproom", label: "Brewery / Taproom" },
  { value: "caterer_private_chef", label: "Caterer / Private Chef" },
  { value: "host_venue", label: "Host / Venue" },
  { value: "supplier", label: "Supplier" },
];

const toIdentityRole = (userType?: string | null) => {
  const type = String(userType || "").toLowerCase();
  if (type === "customer") return "customer";
  if (type === "host") return "host_operator";
  if (type === "event_coordinator") return "event_coordinator";
  if (type === "staff") return "staff";
  if (type === "admin" || type === "duper_admin") return "admin";
  if (type === "super_admin") return "super_admin";
  if (type === "restaurant_owner") return "restaurant_owner";
  if (type === "food_truck") return "food_truck";
  return type || "unknown";
};

type BusinessTypeIntent =
  | "food_truck"
  | "restaurant"
  | "bar"
  | "brewery_taproom"
  | "caterer_private_chef"
  | "host_venue"
  | "supplier"
  | "unknown"
  | "conflict";

type BusinessAttachmentState =
  | "attached"
  | "not_required"
  | "pending_invite"
  | "pending_claim"
  | "admin_import_draft"
  | "orphan_needs_repair"
  | "needs_business_shell"
  | "invalid_missing_business";

function resolveBusinessAttachmentState(
  user: any,
  attachedBusiness: any | null,
): BusinessAttachmentState {
  if (attachedBusiness) return "attached";
  const linkState = String(user?.linkState || "").toLowerCase();
  if (linkState === "pending_invite") return "pending_invite";
  if (linkState === "pending_claim" || user?.claimStatus === "pending") {
    return "pending_claim";
  }
  if (user?.adminImportDraft || user?.importDraft) return "admin_import_draft";

  const userType = String(user?.userType || "").toLowerCase();
  if (!isBusinessBearingUserType(userType)) return "not_required";

  const businessName = String(user?.businessName || "").trim();
  if (businessName) return "needs_business_shell";
  return "invalid_missing_business";
}

function resolveAdminUserBusinessIdentity(
  user: any,
  attachedBusiness: any | null,
  journeySignals: string[],
) {
  const userType = String(user?.userType || "").toLowerCase();
  const attachedType = String(attachedBusiness?.businessType || "")
    .trim()
    .toLowerCase();
  const joinedSignals = journeySignals.join(" ").toLowerCase();

  const signalIntent: BusinessTypeIntent = joinedSignals.includes("truck")
    ? "food_truck"
    : joinedSignals.includes("bar")
      ? "bar"
      : joinedSignals.includes("brewery") || joinedSignals.includes("taproom")
        ? "brewery_taproom"
        : joinedSignals.includes("caterer") || joinedSignals.includes("chef")
          ? "caterer_private_chef"
          : joinedSignals.includes("host") || joinedSignals.includes("venue")
            ? "host_venue"
            : joinedSignals.includes("supplier")
              ? "supplier"
              : joinedSignals.includes("restaurant")
                ? "restaurant"
                : "unknown";

  const roleIntent: BusinessTypeIntent =
    userType === "food_truck"
      ? "food_truck"
      : userType === "host"
        ? "host_venue"
        : userType === "supplier"
          ? "supplier"
          : userType === "restaurant_owner"
            ? "restaurant"
            : "unknown";

  const attachedIntent: BusinessTypeIntent =
    attachedType === "food_truck" || attachedType === "truck"
      ? "food_truck"
      : attachedType === "bar"
        ? "bar"
        : attachedType === "brewery" || attachedType === "brewery_taproom"
          ? "brewery_taproom"
          : attachedType === "caterer" || attachedType === "private_chef"
            ? "caterer_private_chef"
            : attachedType === "venue" || attachedType === "host"
              ? "host_venue"
              : attachedType === "supplier"
                ? "supplier"
                : attachedType === "restaurant"
                  ? "restaurant"
                  : "unknown";

  const attachmentState = resolveBusinessAttachmentState(
    user,
    attachedBusiness,
  );

  const candidates = [attachedIntent, signalIntent, roleIntent].filter(
    (value) => value !== "unknown",
  );
  const unique = new Set(candidates);
  const businessTypeIntent: BusinessTypeIntent =
    unique.size > 1 ? "conflict" : candidates[0] || "unknown";

  return {
    userRole: toIdentityRole(userType),
    businessTypeIntent,
    attachmentState,
    onboardingSignals: journeySignals,
    conflict: businessTypeIntent === "conflict",
    roleIntent,
    signalIntent,
    attachedIntent,
  };
}

interface PendingRestaurant {
  id: string;
  name: string;
  email: string;
  cuisineType: string;
  createdAt: string;
  isActive: boolean;
}

interface MapPinAudit {
  sampleMissing?: Array<{
    id: string;
    source: "open_request" | "host_profile" | "host_address";
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }>;
  renderedHostLocationCandidates: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
  primaryHostProfiles: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
  additionalHostAddresses: {
    total: number;
    included: number;
    skippedDuplicates: number;
    mappable: number;
    missingCoords: number;
  };
  openLocationRequests: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
}

const toTitleCase = (value: string) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const buildBriefSentence = (item: {
  title: string;
  why: string;
  next: string;
}) => `${item.title}. ${item.why} ${item.next}`;

interface DashboardTotalsResponse {
  generatedAt: string;
  totals: DashboardStats;
  operations?: null | {
    parkingPass: {
      seriesTotal: number;
      seriesPublished: number;
      hostsPublished: number;
      spotCapacityPublished: number;
    };
    openCalls?: {
      acceptedNext7Days: number;
      capacityNext7Days: number;
      fillRateNext7DaysPct: number;
    };
    bookings: {
      parkingPassConfirmedToday: number;
      parkingPassConfirmedNext7Days: number;
      pendingCheckoutHolds?: number;
      staleCheckoutHolds?: number;
      failedPaymentsLast24h?: number;
      confirmedLast24h?: number;
    };
    trucks: {
      liveTrucks15m: number;
      activeSessions: number;
    };
  };
  consistency: {
    roleTotal: number;
    totalUsers: number;
    unclassifiedUsers: number;
    rolesWithinUserTotal: boolean;
  };
}

interface ParkingPassOnboardingQueueItem {
  hostId: string;
  userId: string;
  businessName: string | null;
  address: string | null;
  email: string | null;
  locationType: string | null;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  stripeReady: boolean;
  needsPricing: boolean;
  needsStripe: boolean;
  priority: "high" | "medium";
}

interface ParkingPassOnboardingQueueResponse {
  ok: boolean;
  total: number;
  highPriority: number;
  mediumPriority: number;
  items: ParkingPassOnboardingQueueItem[];
}

interface ParkingPassPricingAuditItem {
  hostId: string;
  userId: string;
  businessName: string | null;
  hostPricing: boolean;
  seriesPricing: boolean;
  eventPricing: boolean;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  mismatch: boolean;
}

interface ParkingPassPricingAuditResponse {
  ok: boolean;
  totalHosts: number;
  withHostPricing: number;
  withSeriesPricing: number;
  withEventPricing: number;
  mismatches: number;
  noPricing: number;
  items: ParkingPassPricingAuditItem[];
}

interface HostPayoutRequestItem {
  id: string;
  hostId: string;
  userId: string;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
  notes?: string | null;
  reviewedByUserId?: string | null;
  reviewedByEmail?: string | null;
  reviewedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  hostBusinessName?: string | null;
  hostAddress?: string | null;
  hostCity?: string | null;
  hostState?: string | null;
  requesterEmail?: string | null;
}

interface HostPayoutRequestsResponse {
  ok: boolean;
  totals: {
    pending: number;
    approved: number;
    paid: number;
    rejected: number;
  };
  rows: HostPayoutRequestItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters?: {
    status: string;
    q: string;
  };
}

interface LocationDemandFunnelSummary {
  total_requests: number;
  collecting_open: number;
  threshold_met_open: number;
  threshold_met_stuck_24h: number;
  threshold_met_stuck_72h: number;
  claimed_total: number;
  claimed_within_24h: number;
  claimed_with_published_slots: number;
  claimed_with_confirmed_booking: number;
  threshold_met_last_7d: number;
  claimRateFromThresholdOpen: number;
  publishRateFromClaimed: number;
  bookingRateFromClaimed: number;
}

interface LocationDemandFunnelResponse {
  ok: boolean;
  generatedAt: string;
  summary: LocationDemandFunnelSummary;
}

interface QuarantineSuspectItem {
  id: string;
  ownerId?: string | null;
  name?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  city?: string | null;
  state?: string | null;
  isActive?: boolean | null;
  isVerified?: boolean | null;
  reasons?: string[];
  hiddenFields?: string[];
  hidePublicTrustFields?: boolean;
  hideMedia?: boolean;
  hasHardIdentityAnchor?: boolean;
}

interface FoodTruckInventoryItem {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  publicProfileUrl: string;
  hasLogo: boolean;
  logoUrl: string | null;
  hasCoverImage: boolean;
  coverImageUrl: string | null;
  menuItemCount: number;
  hasMenu: boolean;
  hasEmail: boolean;
  hasSocials: boolean;
  isVerified: boolean;
  isQuarantined: boolean;
  rowStatus?: "operational" | "quarantined" | "test_smoke" | "deleted_system";
  missingFields: string[];
  lastUpdatedAt: string | null;
}

interface FoodTruckInventoryResponse {
  trucks: FoodTruckInventoryItem[];
  counts: {
    total: number;
    missingMenu: number;
    missingLogo: number;
    missingOwner: number;
    quarantined: number;
  };
}

interface OneMarketLaunchBoardResponse {
  market: {
    city: string;
    cityFilterApplied: boolean;
    cityOptions: string[];
  };
  commandCenter: {
    marketHealthStatus:
      | "blocked"
      | "at_risk"
      | "building"
      | "ready"
      | "scaling";
    topGrowthConstraint: string;
    topRecommendedAction: string;
    topRecommendedActionUrl: string;
    highestPriorityFixType: string;
    highestPriorityFixStatus: string;
    openCriticalFixCount: number;
    resolvedFixCount: number;
    improvingFixCount: number;
    bookingReadinessScore: number;
  };
  leakFixQueue: Array<{
    fixId: string;
    marketCity: string;
    leakReason: string;
    fixType: string;
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    targetEntityType: string;
    targetEntityId: string | null;
    targetUrl: string;
    status: "open" | "in_progress" | "resolved" | "dismissed";
    createdAt: string;
    fixResolvedAt: string | null;
    fixResolvedByUserId: string | null;
    fixOutcomeStatus:
      | "resolved_improved"
      | "resolved_no_change"
      | "resolved_regressed"
      | "dismissed_not_applicable"
      | "needs_follow_up";
    fixOutcomeNotes: string;
    linkedMetricBefore: number;
    linkedMetricAfter: number;
    linkedMetricDelta: number;
  }>;
  metrics: {
    profilesTotal: number;
    claimableProfiles: number;
    claimedProfiles: number;
    profilesWithMenu: number;
    profilesWithSchedule: number;
    profilesWithContact: number;
    profilesWithPhotoLogo: number;
    activeFoodTrucks: number;
    activeHosts: number;
    parkingPassListings: number;
    bookingStarts: number;
    bookingConfirmations: number;
    parkingPassViews: number;
    parkingPassClicks: number;
    parkingPassBookingStarts: number;
    parkingPassBookingConfirmations: number;
    parkingPassClickToStartRate: number;
    parkingPassStartToConfirmRate: number;
    bookingIntentToBookingStartRate: number;
    bookingIntentToBookingConfirmRate: number;
    parkingPassNoListingLeak: number;
    parkingPassClickNoStartLeak: number;
    parkingPassStartNoConfirmLeak: number;
    parkingPassPaymentDisabledLeak: number;
    parkingPassHostCapacityLeak: number;
    parkingPassMissingHostCoordinateLeak: number;
    parkingPassMissingTruckProfileLeak: number;
    parkingPassTopLeakReason: string;
    leakFixesOpen: number;
    leakFixesInProgress: number;
    leakFixesResolved: number;
    leakFixesImproved: number;
    leakFixResolutionRate: number;
    leakFixImprovementRate: number;
    publicProfileViews: number;
    publicProfileActions: number;
    affiliateLinkOpens: number;
    claimPitchesCreated: number;
    claimPitchesSent: number;
    claimPitchesOpened: number;
    claimPitchesStarted: number;
    claimPitchesCompleted: number;
    claimPitchSentRate: number;
    claimPitchOpenRate: number;
    claimPitchStartRate: number;
    claimPitchCompletionRate: number;
    claimedProfilesUpdatedAfterPitch: number;
    claimedProfilesWithMenuAfterPitch: number;
    claimedProfilesWithScheduleAfterPitch: number;
    claimedProfilesWithContactAfterPitch: number;
    claimedProfilesWithPhotoAfterPitch: number;
    claimToUsefulProfileRate: number;
    usefulProfilesTotal: number;
    usefulProfilesWithViews: number;
    usefulProfilesWithActions: number;
    usefulProfileViewLift: number;
    usefulProfileActionLift: number;
    usefulProfileBookingClickLift: number;
    bookingIntentProfilesTotal: number;
    bookingIntentFromUsefulProfiles: number;
    bookingIntentFromNonUsefulProfiles: number;
    bookingIntentUsefulProfileRate: number;
    bookingIntentNonUsefulProfileRate: number;
    bookingIntentUsefulLift: number;
    bookingIntentToParkingPassClickRate: number;
  };
  generatedAt: string;
}

const FOOT_TRAFFIC_OPTIONS = [
  { value: "50", label: "Low (1-50/day)", min: 1, max: 50 },
  { value: "200", label: "Medium (51-200/day)", min: 51, max: 200 },
  { value: "500", label: "High (201+/day)", min: 201, max: 10000 },
];

const resolveFootTrafficValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const match = FOOT_TRAFFIC_OPTIONS.find(
    (option) => numeric >= option.min && numeric <= option.max,
  );
  return (
    match?.value ?? FOOT_TRAFFIC_OPTIONS[FOOT_TRAFFIC_OPTIONS.length - 1].value
  );
};

function TruckImportPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [listingQuery, setListingQuery] = useState("");
  const [listingResults, setListingResults] = useState<any[]>([]);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingEdits, setListingEdits] = useState<Record<string, any>>({});
  const [purgeForce, setPurgeForce] = useState(false);
  const [includePurgedBatches, setIncludePurgedBatches] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const detailLimit = 50;

  const { data: batches = [] } = useQuery<any[]>({
    queryKey: [
      "/api/admin/truck-imports",
      includePurgedBatches ? "includePurged" : "activeOnly",
    ],
    enabled,
    queryFn: async () => {
      const qs = includePurgedBatches ? "?includePurged=1" : "";
      const res = await fetch(`/api/admin/truck-imports${qs}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load import batches.");
      }
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: batchDetails, isLoading: batchDetailsLoading } = useQuery<any>({
    queryKey: [
      "/api/admin/truck-imports",
      detailBatchId,
      "details",
      detailOffset,
      detailLimit,
    ],
    enabled: enabled && !!detailBatchId,
    queryFn: async () => {
      if (!detailBatchId) return null;
      const res = await fetch(
        `/api/admin/truck-imports/${detailBatchId}?limit=${detailLimit}&offset=${detailOffset}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load batch details.");
      }
      return data;
    },
  });

  const uploadImport = useMutation({
    mutationFn: async () => {
      if (!file) {
        throw new Error("Please select a file to upload.");
      }
      const formData = new FormData();
      formData.append("file", file);
      if (source.trim()) {
        formData.append("source", source.trim());
      }

      const res = await fetch("/api/admin/truck-imports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          throw new Error(
            json?.message || json?.error || "Failed to upload import file.",
          );
        } catch {
          throw new Error(text || "Failed to upload import file.");
        }
      }
      return await res.json();
    },
    onSuccess: (data: any) => {
      setLastResult(data);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/truck-imports"] });
      const imported = Number(data?.importedRows ?? 0);
      if (imported > 0) {
        toast({
          title: "Import complete",
          description: `Imported ${imported} rows.`,
        });
      } else {
        toast({
          title: "Import uploaded, 0 rows imported",
          description:
            "This usually means the file headers/delimiter didn’t match. Check the results panel for header preview.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message || "Unable to import file.",
        variant: "destructive",
      });
    },
  });

  const searchListings = async () => {
    const q = listingQuery.trim();
    if (!q) {
      setListingResults([]);
      return;
    }
    setListingLoading(true);
    try {
      const res = await fetch(
        `/api/admin/truck-import-listings/search?q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to search import listings.");
      }
      const rows = Array.isArray(data) ? data : [];
      setListingResults(rows);
      const nextEdits: Record<string, any> = {};
      rows.forEach((row: any) => {
        nextEdits[row.id] = {
          externalId: row.externalId || "",
          email: row.email || "",
          name: row.name || "",
          address: row.address || "",
          city: row.city || "",
          state: row.state || "",
          phone: row.phone || "",
          cuisineType: row.cuisineType || "",
          websiteUrl: row.websiteUrl || "",
          instagramUrl: row.instagramUrl || "",
          facebookPageUrl: row.facebookPageUrl || "",
          latitude: row.latitude || "",
          longitude: row.longitude || "",
        };
      });
      setListingEdits(nextEdits);
    } catch (error: any) {
      toast({
        title: "Search failed",
        description: error.message || "Unable to search import listings.",
        variant: "destructive",
      });
    } finally {
      setListingLoading(false);
    }
  };

  const saveListing = useMutation({
    mutationFn: async (payload: { id: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/truck-import-listings/${payload.id}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Import listing updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.message || "Unable to update listing.",
        variant: "destructive",
      });
    },
  });

  const sendInviteForListing = useMutation({
    mutationFn: async (payload: { id: string; email: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-import-listings/${payload.id}/invite`,
        { email: payload.email },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Setup email sent",
        description: "The truck received a setup link to finish their account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Invite failed",
        description: error.message || "Unable to send setup email.",
        variant: "destructive",
      });
    },
  });

  const purgeBatch = useMutation({
    mutationFn: async (payload: { batchId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-imports/${payload.batchId}/purge`,
        { force: purgeForce },
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/truck-imports"] });
      const blockedCount = Array.isArray(data?.blocked)
        ? data.blocked.length
        : 0;
      toast({
        title: "Import purged",
        description:
          `Deleted ${data.deletedListings} listings and ${data.deletedRestaurants} trucks.` +
          (blockedCount ? ` Blocked: ${blockedCount}.` : ""),
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.message || "Unable to purge this import.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          Food Truck Imports
        </CardTitle>
        <CardDescription>
          Upload CSV/TSV/XLSX to seed food truck profiles for the claim flow
          (not user accounts). They’ll appear under Restaurants → Pending and in
          “Claim an Existing Food Truck” search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="State registry, county export, etc."
            />
          </div>
          <div>
            <label className="text-sm font-medium">File</label>
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.html,.htm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <Button
            type="button"
            onClick={() => uploadImport.mutate()}
            disabled={uploadImport.isPending}
            data-testid="button-import-trucks"
          >
            {uploadImport.isPending ? "Uploading..." : "Upload Import"}
          </Button>
        </div>

        {lastResult && (
          <div className="p-3 rounded-md bg-muted/40 text-sm">
            <div>Batch: {lastResult.batchId}</div>
            <div>Imported: {lastResult.importedRows}</div>
            {"seededRestaurants" in lastResult && (
              <div>Seeded Accounts: {lastResult.seededRestaurants}</div>
            )}
            <div>Duplicates: {lastResult.duplicateRows}</div>
            <div>Missing Name: {lastResult.missingRows}</div>
            {Array.isArray(lastResult.headers) &&
              lastResult.headers.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Headers: {lastResult.headers.slice(0, 12).join(" • ")}
                  {lastResult.headers.length > 12 ? " • ..." : ""}
                </div>
              )}
          </div>
        )}

        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm font-semibold">Edit Imported Trucks</div>
          <div className="text-xs text-muted-foreground">
            Search by license ID, name, email, city, address. Add an email here
            to create an invited owner account and send a setup link.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={listingQuery}
              onChange={(e) => setListingQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Search imported trucks..."
            />
            <Button
              type="button"
              variant="outline"
              onClick={searchListings}
              disabled={listingLoading}
            >
              {listingLoading ? "Searching..." : "Search"}
            </Button>
          </div>

          {listingResults.length > 0 && (
            <div className="space-y-3">
              {listingResults.map((row: any) => {
                const edits = listingEdits[row.id];
                if (!edits) return null;
                return (
                  <div
                    key={row.id}
                    className="rounded-md border bg-background/40 p-3 space-y-2"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs">
                        <div className="font-semibold">{row.name}</div>
                        <div className="text-muted-foreground">
                          License: {row.externalId || "(none)"} • Status:{" "}
                          {row.status}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            saveListing.mutate({ id: row.id, updates: edits })
                          }
                          disabled={saveListing.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            sendInviteForListing.mutate({
                              id: row.id,
                              email: String(edits.email || ""),
                            })
                          }
                          disabled={
                            sendInviteForListing.isPending ||
                            !String(edits.email || "").trim()
                          }
                        >
                          Send setup email
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Email"
                        value={edits.email}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, email: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="License ID"
                        value={edits.externalId}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, externalId: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                        placeholder="Name"
                        value={edits.name}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, name: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                        placeholder="Address"
                        value={edits.address}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, address: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="City"
                        value={edits.city}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, city: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="State"
                        value={edits.state}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, state: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Phone"
                        value={edits.phone}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, phone: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Cuisine"
                        value={edits.cuisineType}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, cuisineType: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Website"
                        value={edits.websiteUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, websiteUrl: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Instagram"
                        value={edits.instagramUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: {
                              ...edits,
                              instagramUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Facebook"
                        value={edits.facebookPageUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: {
                              ...edits,
                              facebookPageUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Latitude"
                        value={edits.latitude}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, latitude: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Longitude"
                        value={edits.longitude}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, longitude: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Recent Imports</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={purgeForce}
              onChange={(e) => setPurgeForce(e.target.checked)}
            />
            Force purge (also deletes claim requests; still blocks anything with
            bookings)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includePurgedBatches}
              onChange={(e) => setIncludePurgedBatches(e.target.checked)}
            />
            Show purged batches (history)
          </label>
          {batches.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No import batches yet.
            </div>
          ) : (
            <div className="space-y-2">
              {batches.slice(0, 5).map((batch: any) => (
                <div key={batch.id} className="space-y-2">
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                    <div>
                      <div className="font-semibold">
                        {batch.fileName}
                        {batch.purgedAt ? (
                          <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            Purged
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        {batch.source || "Unspecified source"}
                      </div>
                      <div className="text-muted-foreground">
                        Batch: {batch.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div>Imported: {batch.importedRows}</div>
                        <div className="text-muted-foreground">
                          Skipped: {batch.skippedRows}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetailOffset(0);
                          setDetailBatchId((current) =>
                            current === batch.id ? null : batch.id,
                          );
                        }}
                      >
                        {detailBatchId === batch.id ? "Hide" : "Details"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={purgeBatch.isPending || !!batch.purgedAt}
                        onClick={() => {
                          const ok = window.confirm(
                            `Permanently delete everything seeded by “${batch.fileName}”? This deletes unclaimed rows (and claim requests if force-purge is enabled).`,
                          );
                          if (!ok) return;
                          purgeBatch.mutate({ batchId: batch.id });
                        }}
                      >
                        Purge
                      </Button>
                    </div>
                  </div>

                  {detailBatchId === batch.id && (
                    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
                      {batchDetailsLoading ? (
                        <div className="text-muted-foreground">
                          Loading details...
                        </div>
                      ) : batchDetails ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <span>Total listings: {batchDetails.total}</span>
                            <span>
                              Seeded profiles: {batchDetails.seededRestaurants}
                            </span>
                            <span>
                              Claim requests: {batchDetails.claimRequests}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            Status counts:{" "}
                            {Array.isArray(batchDetails.statusCounts)
                              ? batchDetails.statusCounts
                                  .map(
                                    (row: any) => `${row.status}:${row.count}`,
                                  )
                                  .join(" • ")
                              : "(none)"}
                          </div>
                          {Array.isArray(batchDetails.rows) &&
                          batchDetails.rows.length > 0 ? (
                            <div className="space-y-1">
                              {batchDetails.rows
                                .slice(0, 20)
                                .map((row: any) => (
                                  <div
                                    key={row.id}
                                    className="flex items-center justify-between rounded border bg-background/40 px-2 py-1"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-semibold truncate">
                                        {row.name}
                                      </div>
                                      <div className="text-muted-foreground truncate">
                                        {row.city || ""} {row.state || ""} •{" "}
                                        {row.status}
                                      </div>
                                    </div>
                                    <div className="text-muted-foreground">
                                      {row.restaurantId
                                        ? "claimed"
                                        : "unclaimed"}
                                    </div>
                                  </div>
                                ))}
                              {batchDetails.total > detailLimit && (
                                <div className="flex items-center gap-2 pt-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={detailOffset <= 0}
                                    onClick={() =>
                                      setDetailOffset((prev) =>
                                        Math.max(0, prev - detailLimit),
                                      )
                                    }
                                  >
                                    Prev
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      detailOffset + detailLimit >=
                                      batchDetails.total
                                    }
                                    onClick={() =>
                                      setDetailOffset(
                                        (prev) => prev + detailLimit,
                                      )
                                    }
                                  >
                                    Next
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-muted-foreground">
                              No listings found.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-muted-foreground">No details.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

let profileEvidenceIntakeSequence = 0;

const createProfileEvidenceIntakeRequestId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `profile-intake:${uuid}`;
  profileEvidenceIntakeSequence += 1;
  return `profile-intake:${Date.now().toString(36)}:${profileEvidenceIntakeSequence.toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
};

function ProfileEvidenceApplyPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [payloadText, setPayloadText] = useState(`{
  "mode": "dry_run",
  "profileType": "food_truck",
  "existingProfileId": "",
  "match": {
    "name": "",
    "phone": "",
    "email": "",
    "city": "",
    "state": "",
    "facebook": "",
    "instagram": "",
    "website": ""
  },
  "fillIfBlank": {},
  "descriptionOnlyIfBlank": "",
  "evidenceFieldProposals": [],
  "menuItems": [],
  "scheduleItems": [],
  "sourceNotes": [],
  "missingInfo": [],
  "approvals": {
    "menuOverwrite": false,
    "logoOverwrite": false
  },
  "logoUpload": { "enabled": true, "fileField": "image" }
}`);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [profileEvidenceFiles, setProfileEvidenceFiles] = useState<File[]>([]);
  const [menuEvidenceFiles, setMenuEvidenceFiles] = useState<File[]>([]);
  const [hoursEvidenceFiles, setHoursEvidenceFiles] = useState<File[]>([]);
  const [contactEvidenceFiles, setContactEvidenceFiles] = useState<File[]>([]);
  const [result, setResult] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [intakeRequestId, setIntakeRequestId] = useState(() =>
    createProfileEvidenceIntakeRequestId(),
  );
  const intakeRevisionRef = useRef(0);
  const [validatedTarget, setValidatedTarget] = useState<{
    revision: number;
    profile: {
      id: string;
      name: string;
      ownerUserId: string;
      businessType: string;
    };
  } | null>(null);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const invalidateDryRun = () => {
    intakeRevisionRef.current += 1;
    setValidatedTarget(null);
    setTargetConfirmed(false);
  };
  const parsedPayload = (() => {
    try {
      return JSON.parse(payloadText);
    } catch {
      return null;
    }
  })();

  const submit = async (targetMode: "dry_run" | "queue_owner_review") => {
    if (!enabled || isSubmitting) return;
    let parsed: any;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Fix JSON before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (
      targetMode === "queue_owner_review" &&
      (!validatedTarget ||
        validatedTarget.revision !== intakeRevisionRef.current ||
        !targetConfirmed)
    ) {
      toast({
        title: "Fresh target confirmation required",
        description:
          "Run Dry Run for the current JSON and files, then confirm the returned business before queueing.",
        variant: "destructive",
      });
      return;
    }

    const submissionRevision = intakeRevisionRef.current;
    setIsSubmitting(true);
    try {
      const bodyPayload = {
        ...parsed,
        mode: targetMode,
        ...(targetMode === "queue_owner_review"
          ? {
              intakeRequestId,
              existingProfileId: validatedTarget?.profile.id,
              expectedOwnerUserId: validatedTarget?.profile.ownerUserId,
            }
          : {}),
      };

      const formData = new FormData();
      formData.append("payload", JSON.stringify(bodyPayload));
      if (logoFile) {
        formData.append("profileImages", logoFile);
      }
      profileEvidenceFiles.forEach((file) =>
        formData.append("profileImages", file),
      );
      menuEvidenceFiles.forEach((file) => formData.append("menuImages", file));
      hoursEvidenceFiles.forEach((file) =>
        formData.append("hoursImages", file),
      );
      contactEvidenceFiles.forEach((file) =>
        formData.append("contactImages", file),
      );

      const res = await fetch("/api/admin/profile-evidence/apply", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to apply profile evidence.");
      }
      if (submissionRevision !== intakeRevisionRef.current) {
        toast({
          title: "Stale intake result discarded",
          description:
            "The JSON or selected files changed while this request was running. Run Dry Run again.",
          variant: "destructive",
        });
        return;
      }
      setResult(data);
      if (targetMode === "dry_run") {
        const targetProfile = data?.targetProfile;
        const target = {
          id: String(targetProfile?.id || "").trim(),
          name: String(targetProfile?.name || "").trim(),
          ownerUserId: String(targetProfile?.ownerUserId || "").trim(),
          businessType: String(targetProfile?.businessType || "").trim(),
        };
        if (
          target.id &&
          target.name &&
          target.ownerUserId &&
          target.businessType &&
          target.id === String(parsed.existingProfileId || "").trim()
        ) {
          setValidatedTarget({ revision: submissionRevision, profile: target });
          setTargetConfirmed(false);
        } else {
          setValidatedTarget(null);
          setTargetConfirmed(false);
          toast({
            title: "Dry run did not verify an exact target",
            description:
              "The server must return the same profile ID plus its name, owner, and business type before queueing is allowed.",
            variant: "destructive",
          });
        }
      } else {
        // Preserve this key through failures so a response-loss retry replays
        // safely. Rotate only after the server confirms completion/replay.
        setIntakeRequestId(createProfileEvidenceIntakeRequestId());
        invalidateDryRun();
      }
      toast({
        title:
          targetMode === "queue_owner_review"
              ? data?.idempotentReplay
                ? "Evidence intake already saved"
                : data?.ownerReviewStatus === "queued" &&
                    data?.evidenceBacklogStatus === "queued"
                  ? "Owner suggestions and admin evidence saved"
                  : data?.ownerReviewStatus === "queued"
                    ? "Owner suggestions queued"
                    : String(data?.evidenceBacklogStatus || "").startsWith(
                          "queued",
                        )
                      ? "Admin evidence backlog saved"
                      : "Evidence intake completed with no new owner task"
              : "Dry run complete",
        description:
          targetMode === "queue_owner_review"
            ? `Status: ${String(data?.status || "unknown").replace(/_/g, " ")}`
            : undefined,
      });
    } catch (error: any) {
      toast({
        title: "Profile evidence request failed",
        description: error?.message || "Request failed.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          Profile Evidence Review Intake
        </CardTitle>
        <CardDescription>
          Run a dry check first. Queue for owner review stores bounded evidence
          and proposed safe-field changes against the explicit canonical profile
          ID without publishing them. Menu, schedule, and media artifacts remain
          in the admin evidence backlog until an explicit review workflow acts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="w-full min-h-[260px] rounded-md border p-3 font-mono text-xs"
          value={payloadText}
          disabled={isSubmitting}
          onChange={(event) => {
            setPayloadText(event.target.value);
            invalidateDryRun();
          }}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            accept="image/*"
            aria-label="Logo evidence image"
            disabled={isSubmitting}
            onChange={(event) => {
              setLogoFile(event.target.files?.[0] || null);
              invalidateDryRun();
            }}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Profile evidence images"
            disabled={isSubmitting}
            onChange={(event) => {
              setProfileEvidenceFiles(Array.from(event.target.files || []));
              invalidateDryRun();
            }}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Menu evidence images"
            disabled={isSubmitting}
            onChange={(event) => {
              setMenuEvidenceFiles(Array.from(event.target.files || []));
              invalidateDryRun();
            }}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Hours evidence images"
            disabled={isSubmitting}
            onChange={(event) => {
              setHoursEvidenceFiles(Array.from(event.target.files || []));
              invalidateDryRun();
            }}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Contact evidence images"
            disabled={isSubmitting}
            onChange={(event) => {
              setContactEvidenceFiles(Array.from(event.target.files || []));
              invalidateDryRun();
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => submit("dry_run")}
            >
              {isSubmitting ? "Working..." : "Dry Run"}
            </Button>
            <Button
              disabled={
                isSubmitting ||
                !validatedTarget ||
                validatedTarget.revision !== intakeRevisionRef.current ||
                !targetConfirmed
              }
              onClick={() => submit("queue_owner_review")}
              data-testid="queue-owner-review"
            >
              {isSubmitting ? "Working..." : "Queue for Owner Review"}
            </Button>
          </div>
        </div>

        {validatedTarget ? (
          <div
            className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
            data-testid="profile-evidence-validated-target"
          >
            <p className="font-semibold">Dry-run target verified</p>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-emerald-800">Business</dt>
                <dd>{validatedTarget.profile.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-emerald-800">Business type</dt>
                <dd>{validatedTarget.profile.businessType}</dd>
              </div>
              <div>
                <dt className="text-xs text-emerald-800">Profile ID</dt>
                <dd className="break-all font-mono text-xs">
                  {validatedTarget.profile.id}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-emerald-800">Owner user ID</dt>
                <dd className="break-all font-mono text-xs">
                  {validatedTarget.profile.ownerUserId}
                </dd>
              </div>
            </dl>
            <label className="mt-3 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                className="mt-1"
                checked={targetConfirmed}
                disabled={isSubmitting}
                onChange={(event) => setTargetConfirmed(event.target.checked)}
                data-testid="confirm-profile-evidence-target"
              />
              <span>
                I confirm this evidence belongs to the exact business shown
                above.
              </span>
            </label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Queueing stays locked until the current JSON and file selection
            completes a dry run with an exact target profile summary.
          </p>
        )}

        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            {(() => {
              const debug = (result?.debug || {}) as any;
              const existingTruckId = String(
                result?.existingTruckId || debug?.existingTruckId || "",
              ).trim();
              const matchStrength = String(
                result?.matchStrength || debug?.matchStrength || "none",
              ).trim();
              const matchedBy = Array.isArray(result?.matchedBy)
                ? result.matchedBy
                : Array.isArray(debug?.matchedBy)
                  ? debug.matchedBy
                  : [];
              const classification = String(
                debug?.classification || result?.status || "unknown",
              );
              const classificationReasons = Array.isArray(
                debug?.classificationReasons,
              )
                ? debug.classificationReasons
                : [];
              const identitySignals =
                debug?.identitySignals &&
                typeof debug.identitySignals === "object"
                  ? debug.identitySignals
                  : {};
              const menuSignals =
                debug?.menuSignals && typeof debug.menuSignals === "object"
                  ? debug.menuSignals
                  : {};
              const missingFields = Array.isArray(debug?.missingFields)
                ? debug.missingFields
                : Array.isArray(result?.missingInfo)
                  ? result.missingInfo
                  : [];
              const publishWarnings = Array.isArray(debug?.publishWarnings)
                ? debug.publishWarnings
                : Array.isArray(result?.publishWarnings)
                  ? result.publishWarnings
                  : [];
              const publishAuditNotes = Array.isArray(debug?.publishAuditNotes)
                ? debug.publishAuditNotes
                : Array.isArray(result?.publishAuditNotes)
                  ? result.publishAuditNotes
                  : [];
              const whyUnknown = Array.isArray(debug?.whyUnknown)
                ? debug.whyUnknown
                : [];
              const ocrTextSnippet = String(debug?.ocrTextSnippet || "").trim();
              const ocrConfidence = Number(debug?.ocrConfidence || 0);
              return (
                <>
                  <div>
                    <strong>Status:</strong> {result.status || "unknown"}
                  </div>
                  <div>
                    <strong>Existing truck:</strong>{" "}
                    {existingTruckId || "(none)"}
                  </div>
                  <div>
                    <strong>Match strength:</strong> {matchStrength || "none"}
                  </div>
                  <div>
                    <strong>Matched by:</strong>{" "}
                    {matchedBy.length ? matchedBy.join(", ") : "(none)"}
                  </div>
                  <div>
                    <strong>Classification:</strong> {classification}
                  </div>
                  <div>
                    <strong>Classification reasons:</strong>{" "}
                    {classificationReasons.length
                      ? classificationReasons.join(", ")
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Matched restaurant:</strong>{" "}
                    {result.matchedRestaurantId || "(none)"}
                  </div>
                  <div>
                    <strong>Matched import listing:</strong>{" "}
                    {result.matchedImportListingId || "(none)"}
                  </div>
                  <div>
                    <strong>Created draft:</strong>{" "}
                    {result.createdDraftId || "(none)"}
                  </div>
                  <div>
                    <strong>Menu:</strong> {result.menuStatus || "none"} |{" "}
                    <strong>Schedule:</strong> {result.scheduleStatus || "none"}{" "}
                    | <strong>Logo:</strong> {result.logoStatus || "none"}
                  </div>
                  <div>
                    <strong>Evidence:</strong> {result.evidenceStatus || "none"}{" "}
                    | <strong>Menu evidence:</strong>{" "}
                    {result.menuEvidenceStatus || "none"}
                  </div>
                  <div>
                    <strong>Applied:</strong>{" "}
                    {Array.isArray(result.fieldsApplied)
                      ? result.fieldsApplied.join(", ") || "(none)"
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Skipped:</strong>{" "}
                    {Array.isArray(result.fieldsSkipped)
                      ? result.fieldsSkipped.join(", ") || "(none)"
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Conflicts:</strong>{" "}
                    {Array.isArray(result.conflicts)
                      ? result.conflicts.length
                      : 0}
                  </div>
                  <div>
                    <strong>Review queue:</strong>{" "}
                    {Array.isArray(result.reviewQueueItems)
                      ? result.reviewQueueItems.length
                      : 0}
                  </div>
                  <div>
                    <strong>Uploaded evidence:</strong>{" "}
                    {Array.isArray(result.uploadedEvidence)
                      ? result.uploadedEvidence.length
                      : 0}
                  </div>
                  <div>
                    <strong>Identity signals:</strong>{" "}
                    {Object.keys(identitySignals).length
                      ? JSON.stringify(identitySignals)
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Menu signals:</strong>{" "}
                    {Object.keys(menuSignals).length
                      ? JSON.stringify(menuSignals)
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Missing fields:</strong>{" "}
                    {missingFields.length ? missingFields.join(", ") : "(none)"}
                  </div>
                  <div>
                    <strong>Publish warnings:</strong>{" "}
                    {publishWarnings.length
                      ? publishWarnings.join(" | ")
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Publish audit notes:</strong>{" "}
                    {publishAuditNotes.length
                      ? publishAuditNotes.join(" | ")
                      : "(none)"}
                  </div>
                  <div>
                    <strong>Why unknown:</strong>{" "}
                    {whyUnknown.length ? whyUnknown.join(", ") : "(none)"}
                  </div>
                  <div>
                    <strong>OCR text snippet:</strong>{" "}
                    {ocrTextSnippet || "(none)"}
                  </div>
                  <div>
                    <strong>OCR confidence:</strong>{" "}
                    {Number.isFinite(ocrConfidence) ? ocrConfidence : 0}
                  </div>
                  <div className="pt-2 flex flex-wrap gap-2">
                    <p className="w-full text-xs text-muted-foreground">
                      Direct publication is disabled. Use Dry Run, then queue
                      evidence against the exact existing profile for owner or
                      admin review. This intake never creates a new truck draft.
                    </p>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled
                      title="Use existing review/apply path and keep as dry run to reject weak or unknown evidence."
                    >
                      Reject weak/unknown evidence
                    </Button>
                  </div>
                  {result.matchedRestaurantId && (
                    <div>
                      <a
                        className="underline"
                        href={`/restaurant/${result.matchedRestaurantId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open matched restaurant
                      </a>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UnclaimedImportedTrucksTab({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [editsById, setEditsById] = useState<Record<string, any>>({});

  const limit = 50;

  const loadPage = async (nextOffset: number, mode: "replace" | "append") => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/admin/truck-import-listings/unclaimed?limit=${limit}&offset=${nextOffset}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load unclaimed trucks.");
      }
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setTotal(Number(data?.total ?? 0));
      setOffset(nextOffset);
      setItems((prev) => (mode === "append" ? [...prev, ...rows] : rows));
      const nextEdits: Record<string, any> = {};
      rows.forEach((row: any) => {
        nextEdits[row.id] = {
          email: row.email || "",
          externalId: row.externalId || "",
          name: row.name || "",
          address: row.address || "",
          city: row.city || "",
          state: row.state || "",
          phone: row.phone || "",
        };
      });
      setEditsById((prev) => ({ ...prev, ...nextEdits }));
    } catch (error: any) {
      toast({
        title: "Load failed",
        description: error.message || "Unable to load unclaimed trucks.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void loadPage(0, "replace");
  }, [enabled]);

  const saveListing = useMutation({
    mutationFn: async (payload: { id: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/truck-import-listings/${payload.id}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.message || "Unable to save changes.",
        variant: "destructive",
      });
    },
  });

  const sendInvite = useMutation({
    mutationFn: async (payload: { id: string; email: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-import-listings/${payload.id}/invite`,
        { email: payload.email },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Setup email sent" });
    },
    onError: (error: any) => {
      toast({
        title: "Invite failed",
        description: error.message || "Unable to send setup email.",
        variant: "destructive",
      });
    },
  });

  const createClaimPitch = useMutation({
    mutationFn: async (payload: { listingId: string; source: string }) => {
      const res = await apiRequest("POST", "/api/admin/claim-pitches", payload);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Claim pitch created" });
      void loadPage(offset, "replace");
    },
    onError: (error: any) => {
      toast({
        title: "Claim pitch failed",
        description: error.message || "Unable to create claim pitch.",
        variant: "destructive",
      });
    },
  });

  const updateClaimPitchStatus = useMutation({
    mutationFn: async (payload: {
      listingId: string;
      status: "sent" | "opened" | "claim_started" | "claim_completed";
      sentChannel?:
        | "sms"
        | "email"
        | "facebook"
        | "instagram"
        | "manual"
        | "other";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/claim-pitches/${payload.listingId}/status`,
        { status: payload.status, sentChannel: payload.sentChannel },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Claim pitch status updated" });
      void loadPage(offset, "replace");
    },
    onError: (error: any) => {
      toast({
        title: "Status update failed",
        description: error.message || "Unable to update claim pitch status.",
        variant: "destructive",
      });
    },
  });

  const canLoadMore = items.length < total;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Unclaimed Imported Trucks</div>
          <div className="text-xs text-muted-foreground">
            Scroll these. They disappear automatically once claimed + business
            verification is approved.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            onClick={() => loadPage(0, "replace")}
          >
            Refresh
          </Button>
          <div className="text-xs text-muted-foreground">
            {items.length}/{total}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {isLoading ? "Loading..." : "No unclaimed imported trucks."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((row) => {
            const edits = editsById[row.id];
            if (!edits) return null;
            const claimPitch =
              row?.rawData && typeof row.rawData === "object"
                ? (row.rawData as any).claimPitch || null
                : null;
            const sentChannelValue = String(
              edits.claimPitchSentChannel ||
                claimPitch?.sentChannel ||
                "manual",
            );
            return (
              <Card key={row.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-muted-foreground">
                        License: {row.externalId || "(none)"} • {row.city || ""}{" "}
                        {row.state || ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saveListing.isPending}
                        onClick={() =>
                          saveListing.mutate({ id: row.id, updates: edits })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          sendInvite.isPending ||
                          !String(edits.email || "").trim()
                        }
                        onClick={() =>
                          sendInvite.mutate({
                            id: row.id,
                            email: String(edits.email || ""),
                          })
                        }
                      >
                        Send setup email
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={createClaimPitch.isPending}
                        onClick={() =>
                          createClaimPitch.mutate({
                            listingId: row.id,
                            source: "admin_inventory",
                          })
                        }
                      >
                        Create claim pitch
                      </Button>
                    </div>
                  </div>

                  {claimPitch ? (
                    <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1">
                      <div className="font-medium">
                        Claim pitch status:{" "}
                        {String(claimPitch.pitchStatus || "created")}
                      </div>
                      <div className="text-muted-foreground">
                        {String(
                          claimPitch.claimPitchMessage ||
                            claimPitch.pitchMessage ||
                            "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const message = String(
                              claimPitch.claimPitchMessage ||
                                claimPitch.pitchMessage ||
                                "Your MealScout profile is already live. Claim it to update your menu, schedule, photos, and booking info.",
                            );
                            try {
                              await navigator.clipboard.writeText(message);
                              toast({ title: "Claim pitch message copied" });
                            } catch {
                              toast({
                                title: "Copy failed",
                                description: "Unable to copy pitch message.",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Copy message
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !String(
                              claimPitch.claimPitchUrl ||
                                claimPitch.claimUrl ||
                                "",
                            ).trim()
                          }
                          onClick={async () => {
                            const url = String(
                              claimPitch.claimPitchUrl ||
                                claimPitch.claimUrl ||
                                "",
                            ).trim();
                            if (!url) return;
                            try {
                              await navigator.clipboard.writeText(url);
                              toast({ title: "Claim URL copied" });
                            } catch {
                              toast({
                                title: "Copy failed",
                                description: "Unable to copy claim URL.",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Copy claim URL
                        </Button>
                        {claimPitch.profileUrl ? (
                          <a
                            className="underline"
                            href={String(claimPitch.profileUrl)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open profile URL
                          </a>
                        ) : null}
                        {claimPitch.claimPitchUrl || claimPitch.claimUrl ? (
                          <a
                            className="underline"
                            href={String(
                              claimPitch.claimPitchUrl || claimPitch.claimUrl,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open claim URL
                          </a>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        Created:{" "}
                        {claimPitch.pitchCreatedAt
                          ? new Date(claimPitch.pitchCreatedAt).toLocaleString()
                          : "-"}{" "}
                        • Sent:{" "}
                        {claimPitch.sentAt
                          ? new Date(claimPitch.sentAt).toLocaleString()
                          : "-"}{" "}
                        • Send Count: {Number(claimPitch.sendCount || 0)} •
                        Opened:{" "}
                        {claimPitch.pitchOpenedAt
                          ? new Date(claimPitch.pitchOpenedAt).toLocaleString()
                          : "-"}{" "}
                        • Started:{" "}
                        {claimPitch.claimStartedAt
                          ? new Date(claimPitch.claimStartedAt).toLocaleString()
                          : "-"}{" "}
                        • Completed:{" "}
                        {claimPitch.claimCompletedAt
                          ? new Date(
                              claimPitch.claimCompletedAt,
                            ).toLocaleString()
                          : "-"}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={sentChannelValue}
                          onChange={(e) =>
                            setEditsById({
                              ...editsById,
                              [row.id]: {
                                ...edits,
                                claimPitchSentChannel: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="sms">sms</option>
                          <option value="email">email</option>
                          <option value="facebook">facebook</option>
                          <option value="instagram">instagram</option>
                          <option value="manual">manual</option>
                          <option value="other">other</option>
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateClaimPitchStatus.isPending}
                          onClick={() =>
                            updateClaimPitchStatus.mutate({
                              listingId: row.id,
                              status: "sent",
                              sentChannel: String(
                                edits.claimPitchSentChannel || sentChannelValue,
                              ) as
                                | "sms"
                                | "email"
                                | "facebook"
                                | "instagram"
                                | "manual"
                                | "other",
                            })
                          }
                        >
                          Mark sent
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateClaimPitchStatus.isPending}
                          onClick={() =>
                            updateClaimPitchStatus.mutate({
                              listingId: row.id,
                              status: "opened",
                            })
                          }
                        >
                          Mark opened
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateClaimPitchStatus.isPending}
                          onClick={() =>
                            updateClaimPitchStatus.mutate({
                              listingId: row.id,
                              status: "claim_started",
                            })
                          }
                        >
                          Mark claim started
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateClaimPitchStatus.isPending}
                          onClick={() =>
                            updateClaimPitchStatus.mutate({
                              listingId: row.id,
                              status: "claim_completed",
                            })
                          }
                        >
                          Mark claim completed
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                      placeholder="Name"
                      value={edits.name}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, name: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="Email"
                      value={edits.email}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, email: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="Phone"
                      value={edits.phone}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, phone: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="License ID"
                      value={edits.externalId}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, externalId: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                      placeholder="Address"
                      value={edits.address}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, address: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="City"
                      value={edits.city}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, city: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="State"
                      value={edits.state}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, state: e.target.value },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {canLoadMore && (
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={() => loadPage(offset + limit, "append")}
            >
              {isLoading ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Manual User/Host Creation Component (Combined)
function ManualUserCreation({ adminUser }: { adminUser?: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  type AccountType =
    | "customer"
    | "food_truck_owner"
    | "restaurant_owner"
    | "bar_owner"
    | "brewery_taproom_owner"
    | "caterer_owner"
    | "private_chef_owner"
    | "host_venue_operator"
    | "supplier"
    | "event_coordinator"
    | "staff"
    | "admin"
    | "duper_admin"
    | "super_admin";

  const accountTypeConfig: Record<
    AccountType,
    { userType: string; businessType?: string | null }
  > = {
    customer: { userType: "customer" },
    food_truck_owner: { userType: "food_truck", businessType: "food_truck" },
    restaurant_owner: {
      userType: "restaurant_owner",
      businessType: "restaurant",
    },
    bar_owner: { userType: "restaurant_owner", businessType: "bar" },
    brewery_taproom_owner: {
      userType: "restaurant_owner",
      businessType: "brewery_taproom",
    },
    caterer_owner: {
      userType: "restaurant_owner",
      businessType: "caterer",
    },
    private_chef_owner: {
      userType: "restaurant_owner",
      businessType: "private_chef",
    },
    host_venue_operator: { userType: "host", businessType: "host_venue" },
    supplier: { userType: "supplier", businessType: "supplier" },
    event_coordinator: { userType: "event_coordinator" },
    staff: { userType: "staff" },
    admin: { userType: "admin" },
    duper_admin: { userType: "duper_admin" },
    super_admin: { userType: "super_admin" },
  };

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    businessName: "",
    address: "",
    cuisineType: "",
    latitude: "",
    longitude: "",
    locationType: "private_residence",
    footTraffic: "low",
    amenities: [] as string[],
    servesFood: true,
    hostsFoodTrucks: false,
    wantsFoodTrucks: false,
    runsEvents: false,
    postsSpecials: false,
    allowsPrivateEvents: false,
    hasFeaturedStaff: false,
    useBusinessAddressForHost: true,
    hostBusinessName: "",
    hostAddress: "",
    hostLocationType: "bar_venue",
    hostLatitude: "",
    hostLongitude: "",
    staffBusinessId: "",
    staffInviteMode: "attach_existing",
    accountType: "customer" as AccountType,
  });
  const [geocoding, setGeocoding] = useState(false);
  const [inviteSentEmail, setInviteSentEmail] = useState("");
  const canAssignAdminRole = isAdminFamilyUserType(adminUser?.userType);
  const canAssignDuperAdminRole = isDuperOrRootUserType(adminUser?.userType);
  const canAssignSuperAdminRole = isRootSuperAdminUserType(adminUser?.userType);

  const createUser = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/admin/users/create", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setInviteSentEmail(formData.email);
      toast({
        title: "Account Created",
        description:
          "Setup link sent. The user will complete their profile and password.",
      });
      // Reset form
      setFormData({
        email: "",
        firstName: "",
        lastName: "",
        phone: "",
        businessName: "",
        address: "",
        cuisineType: "",
        latitude: "",
        longitude: "",
        locationType: "private_residence",
        footTraffic: "low",
        amenities: [],
        servesFood: true,
        hostsFoodTrucks: false,
        wantsFoodTrucks: false,
        runsEvents: false,
        postsSpecials: false,
        allowsPrivateEvents: false,
        hasFeaturedStaff: false,
        useBusinessAddressForHost: true,
        hostBusinessName: "",
        hostAddress: "",
        hostLocationType: "bar_venue",
        hostLatitude: "",
        hostLongitude: "",
        staffBusinessId: "",
        staffInviteMode: "attach_existing",
        accountType: "customer",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create account.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Auto-geocode for hosts if address provided
    const selectedConfig = accountTypeConfig[formData.accountType];
    if (
      selectedConfig.userType === "host" &&
      formData.address &&
      !formData.latitude
    ) {
      setGeocoding(true);
      try {
        const response = await fetch(
          `/api/location/search?q=${encodeURIComponent(
            formData.address,
          )}&limit=1`,
        );
        const data = await response.json();

        if (data && data[0]) {
          formData.latitude = data[0].lat;
          formData.longitude = data[0].lon;
        }
      } catch (error) {
        console.error("Failed to geocode:", error);
      } finally {
        setGeocoding(false);
      }
    }

    const useHostOverride =
      formData.accountType === "bar_owner" &&
      !formData.useBusinessAddressForHost &&
      formData.hostAddress.trim().length > 0;

    createUser.mutate({
      ...formData,
      hostBusinessName: useHostOverride ? formData.hostBusinessName : "",
      hostAddress: useHostOverride ? formData.hostAddress : "",
      hostLocationType: useHostOverride ? formData.hostLocationType : "",
      hostLatitude: useHostOverride ? formData.hostLatitude : "",
      hostLongitude: useHostOverride ? formData.hostLongitude : "",
      userType: selectedConfig.userType as any,
      businessType: selectedConfig.businessType || null,
    } as any);
  };

  const handleUserTypeChange = (newType: AccountType) => {
    // Reset conditional fields when type changes
    setFormData({
      ...formData,
      accountType: newType,
      businessName: "",
      address: "",
      cuisineType: "",
      latitude: "",
      longitude: "",
      locationType: "private_residence",
      footTraffic: "low",
      amenities: [],
      servesFood: true,
      hostsFoodTrucks: false,
      wantsFoodTrucks: false,
      runsEvents: false,
      postsSpecials: false,
      allowsPrivateEvents: false,
      hasFeaturedStaff: false,
      useBusinessAddressForHost: true,
      hostBusinessName: "",
      hostAddress: "",
      hostLocationType: "bar_venue",
      hostLatitude: "",
      hostLongitude: "",
      staffBusinessId: "",
      staffInviteMode: "attach_existing",
    });
  };

  const handleGeocode = async () => {
    if (!formData.address) return;

    setGeocoding(true);
    try {
      const response = await fetch(
        `/api/location/search?q=${encodeURIComponent(
          formData.address,
        )}&limit=1`,
      );
      const data = await response.json();

      if (data && data[0]) {
        setFormData({
          ...formData,
          latitude: data[0].lat,
          longitude: data[0].lon,
        });
        toast({
          title: "Coordinates Found",
          description: "Location has been geocoded successfully.",
        });
      } else {
        toast({
          title: "Not Found",
          description:
            "Could not find coordinates for this address. Please enter manually.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to geocode address.",
        variant: "destructive",
      });
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="space-y-4">
      {inviteSentEmail && (
        <div className="p-4 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg space-y-2">
          <p className="font-semibold text-[color:var(--status-success)]">
            Setup Email Sent
          </p>
          <p className="text-sm text-[color:var(--status-success)]">
            Invite sent to {inviteSentEmail}. The user will finish their profile
            and set a password from the link.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInviteSentEmail("")}
          >
            Dismiss
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* User Type - First Field */}
        <div>
          <label className="text-sm font-medium">Account Type</label>
          <select
            value={formData.accountType}
            onChange={(e) => handleUserTypeChange(e.target.value as any)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="food_truck_owner">Food Truck Owner</option>
            <option value="restaurant_owner">Restaurant Owner</option>
            <option value="bar_owner">Bar Owner</option>
            <option value="brewery_taproom_owner">
              Brewery / Taproom Owner
            </option>
            <option value="caterer_owner">Caterer</option>
            <option value="private_chef_owner">Private Chef</option>
            <option value="host_venue_operator">Host / Venue Operator</option>
            <option value="supplier">Supplier</option>
            <option value="customer">Customer</option>
            <option value="event_coordinator">Event Coordinator</option>
            <option value="staff">Staff</option>
            {canAssignAdminRole && <option value="admin">Admin</option>}
            {canAssignDuperAdminRole && (
              <option value="duper_admin">Duper Admin</option>
            )}
            {canAssignSuperAdminRole && (
              <option value="super_admin">Super Admin</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Role/account type is separate from business category and discovery
            filters.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formData.accountType === "food_truck_owner" &&
              "Food truck owner - mobile restaurant, create deals, manage location"}
            {formData.accountType === "customer" &&
              "Regular customer - can claim deals and browse restaurants"}
            {formData.accountType === "restaurant_owner" &&
              "Business owner - manage restaurant and create deals"}
            {formData.accountType === "bar_owner" &&
              "Bar owner - set up bar profile, menu, and specials"}
            {formData.accountType === "brewery_taproom_owner" &&
              "Brewery/taproom owner - publish menu, events, and updates"}
            {formData.accountType === "caterer_owner" &&
              "Caterer - manage catering profile, offers, and bookings"}
            {formData.accountType === "private_chef_owner" &&
              "Private chef - manage chef profile, services, and availability"}
            {formData.accountType === "host_venue_operator" &&
              "Host/venue operator - rent parking/event space to trucks"}
            {formData.accountType === "supplier" &&
              "Supplier - manage products and supplier marketplace presence"}
            {formData.accountType === "staff" &&
              "Business staff - attach to an existing business or send pending invite"}
            {formData.accountType === "event_coordinator" &&
              "Event coordinator - manage event operations and event workflows"}
            {formData.accountType === "admin" &&
              "Admin - manage platform operations and internal workflows"}
            {formData.accountType === "duper_admin" &&
              "Duper Admin - elevated admin access without super admin grants"}
            {formData.accountType === "super_admin" &&
              "Super Admin - root platform administration"}
          </p>
        </div>

        {/* Common Fields */}
        <div>
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full px-3 py-2 border rounded-md"
            placeholder="user@example.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">First Name</label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) =>
                setFormData({ ...formData, firstName: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Last Name</label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) =>
                setFormData({ ...formData, lastName: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) =>
              setFormData({ ...formData, phone: e.target.value })
            }
            className="w-full px-3 py-2 border rounded-md"
            placeholder="+1234567890"
          />
        </div>

        {/* Restaurant Owner & Food Truck Specific Fields */}
        {(formData.accountType === "restaurant_owner" ||
          formData.accountType === "food_truck_owner" ||
          formData.accountType === "bar_owner" ||
          formData.accountType === "brewery_taproom_owner" ||
          formData.accountType === "caterer_owner" ||
          formData.accountType === "private_chef_owner" ||
          formData.accountType === "event_coordinator") && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                Business Information
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Business Name</label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Business name"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="123 Main St, City, State 12345"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Cuisine Type</label>
                  <input
                    type="text"
                    required
                    value={formData.cuisineType}
                    onChange={(e) =>
                      setFormData({ ...formData, cuisineType: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Type/category for internal admin context"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-md">
              <p className="text-xs text-[color:var(--accent-text)]">
                <strong>Provisioning:</strong> This creates a user account, a
                business shell with the selected business type, and links that
                owner to the business.
              </p>
            </div>
            {formData.accountType === "bar_owner" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Bar Capabilities</label>
                {[
                  ["servesFood", "Serves food"],
                  ["hostsFoodTrucks", "Hosts food trucks"],
                  ["wantsFoodTrucks", "Wants food trucks"],
                  ["runsEvents", "Runs events"],
                  ["postsSpecials", "Posts specials"],
                  ["allowsPrivateEvents", "Allows private events"],
                  ["hasFeaturedStaff", "Has featured staff"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean((formData as any)[key])}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          [key]: e.target.checked,
                        } as any)
                      }
                    />
                    {label}
                  </label>
                ))}
                <div className="pt-2 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.useBusinessAddressForHost)}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          useBusinessAddressForHost: e.target.checked,
                        } as any)
                      }
                    />
                    Use business address for parking-pass host profile
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Uncheck to set a different host parking-pass address.
                  </p>
                  {!formData.useBusinessAddressForHost && (
                    <div className="space-y-2 rounded-md border p-3">
                      <div>
                        <label className="text-sm font-medium">
                          Host Display Name (optional)
                        </label>
                        <input
                          type="text"
                          value={formData.hostBusinessName}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              hostBusinessName: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border rounded-md"
                          placeholder="Parking-pass venue name"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">
                          Host Address
                        </label>
                        <input
                          type="text"
                          value={formData.hostAddress}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              hostAddress: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border rounded-md"
                          placeholder="456 Host Lot Ave, City, State"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Staff Specific Fields */}
        {formData.accountType === "staff" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">Staff Information</h4>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Target Business ID
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.staffBusinessId}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        staffBusinessId: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Existing business id to attach staff"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Staff Provisioning Mode
                  </label>
                  <select
                    value={formData.staffInviteMode}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        staffInviteMode: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="attach_existing">
                      Attach to existing business
                    </option>
                    <option value="pending_invite">
                      Pending invite (target required)
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-md">
              <p className="text-xs text-[color:var(--accent-text)]">
                <strong>Note:</strong> Staff member will need to be assigned to
                a restaurant after creation.
              </p>
            </div>
          </>
        )}

        {/* Event Coordinator Specific Fields */}
        {formData.accountType === "event_coordinator" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                Event Coordinator Information
              </h4>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-md">
                <p className="text-xs text-purple-800">
                  <strong>Event Coordinator:</strong> Organizes food truck
                  events and coordinates logistics.
                  <br />
                  <strong className="text-[color:var(--status-error)]">
                    IMPORTANT: NO payments go through us. They handle all
                    payments directly.
                  </strong>
                </p>
              </div>
            </div>
          </>
        )}

        {/* Host Specific Fields */}
        {formData.accountType === "host_venue_operator" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                Host Location Information
              </h4>

              <div className="p-3 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-md mb-3">
                <p className="text-xs text-[color:var(--status-success)]">
                  <strong>Host Model:</strong> Hosts create lots with 1+ spots.
                  They set rental prices (hourly/daily/weekly/monthly).
                  <br />
                  <strong>
                    We add $10/day to every booking - host gets their price, we
                    get $10 per day.
                  </strong>
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Location/Business Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Park name, business name, etc."
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Full Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="123 Main St, City, State 12345"
                  />
                  <p className="text-xs text-[color:var(--text-muted)] mt-1">
                    Coordinates will be automatically geocoded from this address
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium">Location Type</label>
                  <select
                    value={formData.locationType}
                    onChange={(e) =>
                      setFormData({ ...formData, locationType: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="private_residence">Private Residence</option>
                    <option value="business">Business</option>
                    <option value="parking_lot">Parking Lot</option>
                    <option value="event_space">Event Space</option>
                    <option value="public_park">Public Park</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">Foot Traffic</label>
                  <select
                    value={formData.footTraffic}
                    onChange={(e) =>
                      setFormData({ ...formData, footTraffic: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="low">Low (Quiet area)</option>
                    <option value="medium">Medium (Moderate activity)</option>
                    <option value="high">High (Busy area)</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Amenities (Optional)
                  </label>
                  <div className="space-y-2">
                    {["Power", "Water", "Restrooms", "Wifi", "Seating"].map(
                      (amenity) => (
                        <label
                          key={amenity}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={formData.amenities.includes(
                              amenity.toLowerCase(),
                            )}
                            onChange={(e) => {
                              const value = amenity.toLowerCase();
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  amenities: [...formData.amenities, value],
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  amenities: formData.amenities.filter(
                                    (a) => a !== value,
                                  ),
                                });
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm">{amenity}</span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-md">
              <p className="text-xs text-[color:var(--status-success)]">
                <strong>Host Account:</strong> Can list parking spots and event
                spaces for food trucks to use. Will have access to host
                dashboard.
              </p>
            </div>
          </>
        )}

        <Button
          type="submit"
          disabled={createUser.isPending}
          className="w-full"
        >
          {createUser.isPending ? "Creating..." : "Create Account"}
        </Button>
      </form>
    </div>
  );
}

// Staff Management Tab Component
function StaffManagementTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [eligibleUserSearch, setEligibleUserSearch] = useState("");

  const { data: staffMembers = [], isLoading: loadingStaff } = useQuery<any[]>({
    queryKey: ["/api/admin/staff"],
  });

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
  });

  const promoteToStaff = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/staff/${userId}/promote`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUserId("");
      toast({
        title: "Staff Promoted",
        description: "User has been promoted to staff role.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to promote user to staff.",
        variant: "destructive",
      });
    },
  });

  const demoteStaff = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/staff/${userId}/demote`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Staff Demoted",
        description: "Staff member has been demoted to customer role.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to demote staff member.",
        variant: "destructive",
      });
    },
  });

  const eligibleUsers = allUsers.filter(
    (user) =>
      user.userType !== "admin" &&
      user.userType !== "staff" &&
      user.userType !== "duper_admin" &&
      user.userType !== "super_admin",
  );

  // Filter out elevated admins from staff members list (they should never appear here)
  const displayStaffMembers = staffMembers.filter(
    (staff) =>
      staff.userType !== "duper_admin" && staff.userType !== "super_admin",
  );

  const filteredStaffMembers = useMemo(() => {
    const search = staffSearch.trim().toLowerCase();
    if (!search) return displayStaffMembers;
    return displayStaffMembers.filter((staff: any) => {
      const firstName = String(staff?.firstName || "").toLowerCase();
      const lastName = String(staff?.lastName || "").toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = String(staff?.email || "").toLowerCase();
      return (
        firstName.includes(search) ||
        lastName.includes(search) ||
        fullName.includes(search) ||
        email.includes(search)
      );
    });
  }, [displayStaffMembers, staffSearch]);

  const filteredEligibleUsers = useMemo(() => {
    const search = eligibleUserSearch.trim().toLowerCase();
    if (!search) return eligibleUsers;
    return eligibleUsers.filter((user: any) => {
      const firstName = String(user?.firstName || "").toLowerCase();
      const lastName = String(user?.lastName || "").toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = String(user?.email || "").toLowerCase();
      const userType = String(user?.userType || "").toLowerCase();
      return (
        firstName.includes(search) ||
        lastName.includes(search) ||
        fullName.includes(search) ||
        email.includes(search) ||
        userType.includes(search)
      );
    });
  }, [eligibleUsers, eligibleUserSearch]);

  return (
    <div className="space-y-6">
      {/* Current Staff */}
      <div>
        <h3 className="font-semibold mb-3">Current Staff Members</h3>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background mb-3"
          placeholder="Search current staff by name or email..."
          value={staffSearch}
          onChange={(e) => setStaffSearch(e.target.value)}
        />
        {loadingStaff ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : displayStaffMembers.length === 0 ? (
          <p className="text-muted-foreground">No staff members yet.</p>
        ) : filteredStaffMembers.length === 0 ? (
          <p className="text-muted-foreground">No matching staff members.</p>
        ) : (
          <div className="space-y-2">
            {filteredStaffMembers.map((staff) => (
              <div
                key={staff.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">
                    {staff.firstName} {staff.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {staff.email}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (
                      window.confirm(`Remove ${staff.email} from staff role?`)
                    ) {
                      demoteStaff.mutate(staff.id);
                    }
                  }}
                  disabled={demoteStaff.isPending}
                >
                  <UserMinus className="w-4 h-4 mr-1" />
                  Remove Staff
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote User */}
      <div>
        <h3 className="font-semibold mb-3">Promote User to Staff</h3>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background mb-3"
          placeholder="Search users by name, email, or role..."
          value={eligibleUserSearch}
          onChange={(e) => setEligibleUserSearch(e.target.value)}
        />
        <div className="flex gap-3">
          <select
            className="flex-1 px-3 py-2 border rounded-md bg-background"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">Select user...</option>
            {filteredEligibleUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email} ({user.firstName} {user.lastName}) -{" "}
                {user.userType}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              if (selectedUserId) {
                promoteToStaff.mutate(selectedUserId);
              }
            }}
            disabled={!selectedUserId || promoteToStaff.isPending}
          >
            Promote to Staff
          </Button>
        </div>
      </div>

      {/* Quick Link */}
      <div className="pt-4 border-t">
        <Link href="/staff">
          <Button variant="outline">Go to Staff Dashboard -&gt;</Button>
        </Link>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("overview");
  const [launchBoardCity, setLaunchBoardCity] = useState("all");
  const { effectiveLocationContext } = useEffectiveLocationContext();
  const [briefStatus, setBriefStatus] = useState<
    Record<string, { until: number }>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("lisa-dashboard-brief-state-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(parsed || {}).filter(
          ([, value]: any) => Number(value?.until || 0) > now,
        ),
      ) as Record<string, { until: number }>;
    } catch {
      return {};
    }
  });
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userDetailsOpen, setUserDetailsOpen] = useState(false);
  const [userSortKey, setUserSortKey] = useState<"name" | "type" | "created">(
    "type",
  );
  const [userSortDir, setUserSortDir] = useState<"asc" | "desc">("asc");
  const [userSearch, setUserSearch] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("all");
  const [userEmailFilter, setUserEmailFilter] = useState("all");
  const [userStatusFilter, setUserStatusFilter] = useState("active");
  const [userBusinessOnly, setUserBusinessOnly] = useState(false);
  const [userCityFilter, setUserCityFilter] = useState("");
  const [userStateFilter, setUserStateFilter] = useState("");
  const [truckInventorySearch, setTruckInventorySearch] = useState("");
  const [truckFilterMissingMenu, setTruckFilterMissingMenu] = useState(false);
  const [truckFilterMissingLogo, setTruckFilterMissingLogo] = useState(false);
  const [truckFilterMissingOwner, setTruckFilterMissingOwner] = useState(false);
  const [truckFilterQuarantined, setTruckFilterQuarantined] = useState(false);
  const [truckFilterVerified, setTruckFilterVerified] = useState(false);
  const [attachBusinessSearch, setAttachBusinessSearch] = useState("");
  const [attachBusinessSelectedId, setAttachBusinessSelectedId] = useState("");
  const [businessIntentByUserId, setBusinessIntentByUserId] = useState<
    Record<string, string>
  >({});
  const [verificationSearch, setVerificationSearch] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messagePreview, setMessagePreview] = useState<any>(null);
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [dealDetailsOpen, setDealDetailsOpen] = useState(false);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<
    "all" | "pending" | "approved" | "paid" | "rejected" | "cancelled"
  >("all");
  const [payoutSearch, setPayoutSearch] = useState("");
  const [payoutFromDate, setPayoutFromDate] = useState("");
  const [payoutToDate, setPayoutToDate] = useState("");
  const [activePendingPayoutRowId, setActivePendingPayoutRowId] = useState<
    string | null
  >(null);
  const [payoutPage, setPayoutPage] = useState(1);
  const [isExportingPayouts, setIsExportingPayouts] = useState(false);
  const payoutPageSize = 12;
  const [extendDays, setExtendDays] = useState(7);
  const [userEdits, setUserEdits] = useState<any>(null);
  const [affiliateEdits, setAffiliateEdits] = useState<any>(null);
  const [parkingPassEdits, setParkingPassEdits] = useState<Record<string, any>>(
    {},
  );
  const [addressEdits, setAddressEdits] = useState<Record<string, any>>({});
  const [hostEdits, setHostEdits] = useState<Record<string, any>>({});
  const [spotImageFilesByHostId, setSpotImageFilesByHostId] = useState<
    Record<string, File | null>
  >({});
  const [restaurantEdits, setRestaurantEdits] = useState<Record<string, any>>(
    {},
  );
  const [dealEdits, setDealEdits] = useState<Record<string, any>>({});
  const [eventEdits, setEventEdits] = useState<Record<string, any>>({});
  const [seriesEdits, setSeriesEdits] = useState<Record<string, any>>({});
  const [bookingEdits, setBookingEdits] = useState<Record<string, any>>({});
  const [newAddress, setNewAddress] = useState<any>({
    label: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    type: "other",
    isDefault: false,
  });
  const [newHostLocation, setNewHostLocation] = useState<any>({
    businessName: "",
    address: "",
    city: "",
    state: "",
    locationType: "other",
    expectedFootTraffic: "",
    contactPhone: "",
    notes: "",
  });

  const formatDateInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const setPayoutDateRange = (from: string, to: string) => {
    if (from && to && from > to) {
      setPayoutFromDate(to);
      setPayoutToDate(from);
      return;
    }
    setPayoutFromDate(from);
    setPayoutToDate(to);
  };

  const handlePayoutFromDateChange = (value: string) => {
    setPayoutDateRange(value, payoutToDate);
  };

  const handlePayoutToDateChange = (value: string) => {
    setPayoutDateRange(payoutFromDate, value);
  };

  const applyPayoutDatePreset = (
    preset: "last7" | "thisMonth" | "lastMonth" | "clear",
  ) => {
    const today = new Date();

    if (preset === "clear") {
      setPayoutDateRange("", "");
      return;
    }

    if (preset === "last7") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      setPayoutDateRange(formatDateInput(from), formatDateInput(today));
      return;
    }

    if (preset === "thisMonth") {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      setPayoutDateRange(formatDateInput(from), formatDateInput(today));
      return;
    }

    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    setPayoutDateRange(formatDateInput(from), formatDateInput(to));
  };

  const payoutDateRangeError = useMemo(() => {
    if (!payoutFromDate || !payoutToDate) {
      return "";
    }
    return payoutFromDate > payoutToDate
      ? "From date must be on or before To date."
      : "";
  }, [payoutFromDate, payoutToDate]);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } finally {
      window.location.href = "/";
    }
  };

  // Check admin authentication
  const { data: adminUser, isLoading: isAuthLoading } = useQuery<any>({
    queryKey: ["/api/auth/admin/verify"],
    retry: false,
  });
  const isStaff = adminUser?.userType === "staff";
  const isAdminOrSuper = isAdminFamilyUserType(adminUser?.userType);
  const isDuperOrSuper = isDuperOrRootUserType(adminUser?.userType);
  const isSuperAdmin = isRootSuperAdminUserType(adminUser?.userType);

  // Fetch dashboard stats
  const { data: dashboardTotals, isLoading: statsLoading } =
    useQuery<DashboardTotalsResponse>({
      queryKey: ["/api/admin/dashboard-totals"],
      enabled: !!adminUser,
    });

  // Fetch pending restaurants
  const { data: pendingRestaurants = [] } = useQuery<PendingRestaurant[]>({
    queryKey: ["/api/admin/restaurants/pending"],
    enabled: !!adminUser && selectedTab === "restaurants",
  });

  // Fetch all users (normalize payload shape and surface load failures)
  const {
    data: usersPayload,
    isLoading: usersLoading,
    error: usersError,
    refetch: refetchUsers,
  } = useQuery<any>({
    queryKey: ["/api/admin/users"],
    enabled: !!adminUser && selectedTab === "users",
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/users");
      return await res.json();
    },
  });

  const users = useMemo<any[]>(() => {
    if (Array.isArray(usersPayload)) return usersPayload;
    if (Array.isArray(usersPayload?.users)) return usersPayload.users;
    return [];
  }, [usersPayload]);

  const {
    data: foodTruckInventoryPayload,
    isLoading: foodTruckInventoryLoading,
    error: foodTruckInventoryError,
    refetch: refetchFoodTruckInventory,
  } = useQuery<FoodTruckInventoryResponse>({
    queryKey: [
      "/api/admin/food-trucks/inventory",
      truckInventorySearch,
      truckFilterMissingMenu,
      truckFilterMissingLogo,
      truckFilterMissingOwner,
      truckFilterQuarantined,
      truckFilterVerified,
    ],
    enabled: !!adminUser && selectedTab === "food-trucks",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (truckInventorySearch.trim())
        params.set("q", truckInventorySearch.trim());
      if (truckFilterMissingMenu) params.set("missingMenu", "true");
      if (truckFilterMissingLogo) params.set("missingLogo", "true");
      if (truckFilterMissingOwner) params.set("missingOwner", "true");
      if (truckFilterQuarantined) params.set("quarantined", "true");
      if (truckFilterVerified) params.set("verified", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await apiRequest(
        "GET",
        `/api/admin/food-trucks/inventory${suffix}`,
      );
      return (await res.json()) as FoodTruckInventoryResponse;
    },
  });

  const foodTruckInventoryRows = useMemo<FoodTruckInventoryItem[]>(() => {
    if (Array.isArray(foodTruckInventoryPayload?.trucks))
      return foodTruckInventoryPayload.trucks;
    return [];
  }, [foodTruckInventoryPayload]);

  const {
    data: quarantinePayload,
    isLoading: quarantineLoading,
    error: quarantineError,
    refetch: refetchQuarantine,
  } = useQuery<any>({
    queryKey: ["/api/admin/profile-quarantine/suspects"],
    enabled: !!adminUser && selectedTab === "quarantine",
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/admin/profile-quarantine/suspects",
      );
      return await res.json();
    },
  });

  const quarantineSuspects = useMemo<QuarantineSuspectItem[]>(() => {
    if (Array.isArray(quarantinePayload)) return quarantinePayload;
    if (Array.isArray(quarantinePayload?.suspects))
      return quarantinePayload.suspects;
    if (Array.isArray(quarantinePayload?.items)) return quarantinePayload.items;
    if (Array.isArray(quarantinePayload?.profiles))
      return quarantinePayload.profiles;
    return [];
  }, [quarantinePayload]);

  const { data: launchBoardData, isLoading: launchBoardLoading } =
    useQuery<OneMarketLaunchBoardResponse>({
      queryKey: ["/api/admin/launch-board", launchBoardCity],
      enabled: !!adminUser && selectedTab === "launch-board",
      queryFn: async () => {
        const params = new URLSearchParams();
        if (launchBoardCity !== "all") params.set("city", launchBoardCity);
        const suffix = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(apiUrl(`/api/admin/launch-board${suffix}`), {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to fetch launch board");
        return res.json();
      },
      staleTime: 30 * 1000,
    });

  const updateLeakFixOutcome = useMutation({
    mutationFn: async ({
      fix,
      status,
      fixOutcomeStatus,
      fixOutcomeNotes,
    }: {
      fix: OneMarketLaunchBoardResponse["leakFixQueue"][number];
      status: "in_progress" | "resolved";
      fixOutcomeStatus: OneMarketLaunchBoardResponse["leakFixQueue"][number]["fixOutcomeStatus"];
      fixOutcomeNotes?: string;
    }) => {
      const res = await fetch(
        apiUrl(
          `/api/admin/launch-board/leak-fixes/${encodeURIComponent(
            fix.fixId,
          )}/outcome`,
        ),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            fixOutcomeStatus,
            fixOutcomeNotes: fixOutcomeNotes || "",
            marketCity: fix.marketCity,
            leakReason: fix.leakReason,
            fixType: fix.fixType,
            linkedMetricBefore:
              fix.linkedMetricBefore ?? fix.linkedMetricAfter ?? 0,
            targetEntityType: fix.targetEntityType,
            targetEntityId: fix.targetEntityId,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to update leak fix outcome");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/launch-board"] });
      toast({
        title: "Leak fix updated",
        description: "Outcome tracking was recorded on the Launch Board.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not update leak fix",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const openAdminUserProfile = (userId: string, inNewTab = false) => {
    const href = `/admin?tab=users&focusUser=${encodeURIComponent(userId)}`;
    if (inNewTab) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(href);
  };

  const userById = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of users) {
      const id = String(u?.id || "").trim();
      if (id) map.set(id, u);
    }
    return map;
  }, [users]);

  const { data: mapPinAudit } = useQuery<MapPinAudit>({
    queryKey: ["/api/admin/map-pin-audit"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "lisa-dashboard-brief-state-v1",
      JSON.stringify(briefStatus),
    );
  }, [briefStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = String(params.get("tab") || "").trim();
    if (requestedTab) {
      setSelectedTab(requestedTab);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedTab !== "users") return;
    if (!Array.isArray(users) || users.length === 0) return;

    const url = new URL(window.location.href);
    const focusUserId = String(url.searchParams.get("focusUser") || "").trim();
    if (!focusUserId) return;

    const matchedUser = users.find(
      (entry: any) => String(entry?.id) === focusUserId,
    );
    if (!matchedUser) return;

    setSelectedUser(matchedUser);
    setUserDetailsOpen(true);

    url.searchParams.delete("focusUser");
    window.history.replaceState({}, "", url.toString());
  }, [selectedTab, users]);
  const { data: lisaMarketIntel } = useQuery<any>({
    queryKey: [
      "/api/admin/lisa/market-intel",
      "dashboard-tab",
      effectiveLocationContext?.marketKey || "",
    ],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (effectiveLocationContext?.marketKey) {
        query.set("market", effectiveLocationContext.marketKey);
      }
      const endpoint = query.toString()
        ? `/api/admin/lisa/market-intel?${query.toString()}`
        : "/api/admin/lisa/market-intel";
      const res = await fetch(apiUrl(endpoint), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch LISA market intel");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaSignals } = useQuery<any>({
    queryKey: [
      "/api/admin/lisa/signals",
      "dashboard-tab",
      effectiveLocationContext?.marketKey || "",
    ],
    queryFn: async () => {
      const query = new URLSearchParams({
        limit: "16",
        hours: "72",
      });
      if (effectiveLocationContext?.marketKey) {
        query.set("market", effectiveLocationContext.marketKey);
      }
      const res = await fetch(
        apiUrl(`/api/admin/lisa/signals?${query.toString()}`),
        {
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error("Failed to fetch LISA signals");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaPriorities } = useQuery<any>({
    queryKey: [
      "/api/admin/lisa/priorities",
      "dashboard-tab",
      effectiveLocationContext?.marketKey || "",
    ],
    queryFn: async () => {
      const query = new URLSearchParams({ limit: "6" });
      if (effectiveLocationContext?.marketKey) {
        query.set("market", effectiveLocationContext.marketKey);
      }
      const res = await fetch(
        apiUrl(`/api/admin/lisa/priorities?${query.toString()}`),
        {
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error("Failed to fetch LISA priorities");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaBriefActions } = useQuery<any>({
    queryKey: [
      "/api/admin/lisa/brief-actions",
      "dashboard-tab",
      effectiveLocationContext?.marketKey || "",
    ],
    queryFn: async () => {
      const query = new URLSearchParams({ hours: "720" });
      if (effectiveLocationContext?.marketKey) {
        query.set("market", effectiveLocationContext.marketKey);
      }
      const res = await fetch(
        apiUrl(`/api/admin/lisa/brief-actions?${query.toString()}`),
        {
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error("Failed to fetch LISA brief actions");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const briefActionMutation = useMutation({
    mutationFn: async (payload: {
      briefKey: string;
      action: "done" | "snooze" | "dismiss";
      title: string;
      href: string;
    }) => {
      const res = await fetch("/api/admin/lisa/brief-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to log brief action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/lisa/brief-actions", "dashboard-tab"],
      });
    },
  });
  const isTruthOnlyMode =
    lisaMarketIntel?.signalContract?.mode === "truth_only";
  const promoteNowItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const momentum = Array.isArray(lisaMarketIntel?.contentMomentum)
      ? lisaMarketIntel.contentMomentum
      : [];
    return momentum.slice(0, 4).map((item: any) => ({
      id: item.id,
      title: item.title || "Untitled content",
      why: `${Number(item.viewCount ?? 0)} views and ${Number(item.impressionCount ?? 0)} impressions signal current attention.`,
      next: item.restaurantId
        ? `Promote this restaurant now and attach a deal or event while attention is active.`
        : "Promote this story now while attention is active.",
      changed: lisaMarketIntel?.dailyBriefChanges?.promotion,
      rankReason:
        "Ranked #1 because it has the strongest live content momentum right now.",
      href: item.restaurantId
        ? `/restaurant/${item.restaurantId}`
        : "/admin/control-center",
      actionLabel: item.restaurantId ? "Open restaurant" : "Open stream",
    }));
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const demandSpikeItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const trends = Array.isArray(lisaMarketIntel?.trendWatch)
      ? lisaMarketIntel.trendWatch
      : [];
    const cityDemand = Array.isArray(
      lisaMarketIntel?.advertiserSignals?.cityDemand,
    )
      ? lisaMarketIntel.advertiserSignals.cityDemand
      : [];
    const demandRows = [
      ...trends.slice(0, 2).map((item: any) => ({
        id: item.id,
        title: item.label || "Unnamed food trend",
        why: item.summary || `This food trend is moving right now.`,
        next:
          item.next ||
          "Build content, deals, or landing pages around this demand before it cools off.",
        changed: lisaMarketIntel?.dailyBriefChanges?.demand,
        rankReason:
          "Ranked #1 because this food trend is currently the strongest visible demand signal.",
        href: "/admin/control-center",
        actionLabel: "Open stream",
      })),
      ...cityDemand.slice(0, 2).map((item: any, index: number) => ({
        id: `city:${index}:${item.address || item.businessName || "unknown"}`,
        title:
          item.businessName ||
          item.address ||
          item.locationType ||
          "Location demand cluster",
        why: `${Number(item.requestCount ?? 0)} requests and ${Number(item.interestCount ?? 0)} interest signals point to local demand.`,
        next: "Sell ads here, recruit inventory here, or create a city page that captures the traffic.",
        changed: lisaMarketIntel?.changeSinceYesterday?.summary,
        rankReason:
          "Ranked highly because this location cluster is showing the strongest local demand mix.",
        href: "/admin/control-center",
        actionLabel: "Open stream",
      })),
    ];
    return demandRows.slice(0, 4);
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const acquisitionWatchItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const targets = Array.isArray(lisaMarketIntel?.acquisitionTargets)
      ? lisaMarketIntel.acquisitionTargets
      : [];
    return targets.slice(0, 4).map((item: any) => ({
      id: item.id,
      title: item.title || "Untitled target",
      why: `${Number(item.crawlerHits ?? 0)} crawler hits with ${item.quality || "unknown"} quality suggests outside interest is ahead of asset quality.`,
      next:
        (Array.isArray(item.reasons) && item.reasons[0]) ||
        "Review this asset for acquisition, partnership, or cleanup.",
      changed: lisaMarketIntel?.dailyBriefChanges?.acquisition,
      rankReason:
        "Ranked #1 because outside attention is ahead of quality more than the other current targets.",
      href: item.canonicalPath || "/admin/control-center",
      actionLabel: "Open target",
    }));
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const authorityGapItems = useMemo(() => {
    const items = Array.isArray(lisaPriorities?.items)
      ? lisaPriorities.items
      : [];
    return items.slice(0, 4).map((item: any) => ({
      id: `${item.entityType}:${item.entityId}`,
      title: item.title || `${item.entityType} ${item.entityId}`,
      why: `${item.quality || "unknown"} quality and ${item.freshness || "unknown"} freshness are limiting how trustworthy this page feels.`,
      next: (Array.isArray(item.reasons) && item.reasons.length > 0
        ? item.reasons.map((reason: string) => toTitleCase(reason)).join(" • ")
        : "Improve the page, data completeness, and freshness."
      ).slice(0, 180),
      changed: lisaMarketIntel?.changeSinceYesterday?.summary,
      rankReason:
        "Ranked highly because page weakness is limiting authority on a high-interest entity.",
      href: "/admin/control-center",
      actionLabel: "Open stream",
    }));
  }, [lisaMarketIntel, lisaPriorities]);

  const machineAttentionItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const items = Array.isArray(lisaSignals?.items) ? lisaSignals.items : [];
    return items
      .filter((signal: any) => signal.visibility === "off_platform")
      .slice(0, 4)
      .map((signal: any, index: number) => ({
        id: `${signal.id || "signal"}:${index}`,
        title: signal.title || "Observed machine attention",
        why:
          signal.summary ||
          "Outside systems are interacting with a MealScout page.",
        next:
          signal.subjectType === "path"
            ? `Strengthen ${signal.subjectId || "this page"} so outside machines find something worth citing.`
            : "Strengthen the related public entity page and attach fresher information.",
        changed: lisaMarketIntel?.dailyBriefChanges?.machineAttention,
        rankReason:
          "Ranked #1 because it is the strongest current off-platform attention signal.",
        href:
          signal.subjectType === "path" &&
          String(signal.subjectId || "").startsWith("/")
            ? String(signal.subjectId)
            : "/admin/control-center",
        actionLabel:
          signal.subjectType === "path" &&
          String(signal.subjectId || "").startsWith("/")
            ? "Open page"
            : "Open stream",
      }));
  }, [isTruthOnlyMode, lisaMarketIntel, lisaSignals]);

  const yesterdayChangeItems = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.changeSinceYesterday?.items)
        ? lisaMarketIntel.changeSinceYesterday.items
        : [],
    [lisaMarketIntel],
  );

  const foodTrendItems = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.trendWatch)
        ? lisaMarketIntel.trendWatch
        : [],
    [lisaMarketIntel],
  );

  const priceScoutDeals = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.priceScout?.bestDeals)
        ? lisaMarketIntel.priceScout.bestDeals
        : [],
    [lisaMarketIntel],
  );

  const priceScoutSupplySummary = useMemo(
    () => lisaMarketIntel?.priceScout?.supplyLaneSummary ?? null,
    [lisaMarketIntel],
  );

  const priceScoutSupplySpotlight = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.priceScout?.supplyLaneSummary?.spotlight)
        ? lisaMarketIntel.priceScout.supplyLaneSummary.spotlight
        : [],
    [lisaMarketIntel],
  );

  const deferBrief = (
    briefKey: string,
    mode: "dismiss" | "snooze" | "done",
  ) => {
    const hours = mode === "done" ? 24 * 7 : mode === "snooze" ? 4 : 16;
    setBriefStatus((current) => ({
      ...current,
      [briefKey]: { until: Date.now() + hours * 60 * 60 * 1000 },
    }));
  };

  const latestBriefActionByKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of lisaBriefActions?.latest ?? []) {
      map.set(String(item.briefKey || ""), item);
    }
    return map;
  }, [lisaBriefActions]);

  const pickVisibleBrief = (items: any[], prefix: string) =>
    items.find((item: any) => {
      const briefKey = `${prefix}:${item.id}`;
      const localUntil = briefStatus[briefKey]?.until ?? 0;
      const latestAction = latestBriefActionByKey.get(briefKey);
      const actionUntil =
        latestAction?.action === "done"
          ? new Date(latestAction.createdAt).getTime() + 24 * 7 * 60 * 60 * 1000
          : latestAction?.action === "snooze"
            ? new Date(latestAction.createdAt).getTime() + 4 * 60 * 60 * 1000
            : latestAction?.action === "dismiss"
              ? new Date(latestAction.createdAt).getTime() + 16 * 60 * 60 * 1000
              : 0;
      return Math.max(localUntil, actionUntil) <= Date.now();
    }) || null;

  const handleBriefAction = (
    briefKey: string,
    action: "done" | "snooze" | "dismiss",
    title: string,
    href: string,
  ) => {
    deferBrief(briefKey, action);
    briefActionMutation.mutate({ briefKey, action, title, href });
  };

  const topPromotionItem = pickVisibleBrief(promoteNowItems, "promote");
  const topDemandItem = pickVisibleBrief(demandSpikeItems, "demand");
  const topAcquisitionItem = pickVisibleBrief(acquisitionWatchItems, "acquire");
  const topMachineAttentionItem = pickVisibleBrief(
    machineAttentionItems,
    "machine",
  );
  const retryMapPinGeocode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/map-pin-audit/retry-geocode",
        {
          limit: 50,
        },
      );
      return res.json();
    },
    onSuccess: async (result: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/map-pin-audit"],
      });
      toast({
        title: "Map geocode retry complete",
        description: `Updated ${result?.updated?.total ?? 0} locations.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Map geocode retry failed",
        description: error?.message || "Unable to retry geocoding.",
        variant: "destructive",
      });
    },
  });
  const retryMapPinGeocodeItem = useMutation({
    mutationFn: async (payload: {
      source: "open_request" | "host_profile" | "host_address";
      id: string;
    }) => {
      const res = await apiRequest(
        "POST",
        "/api/admin/map-pin-audit/retry-geocode-item",
        payload,
      );
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/map-pin-audit"],
      });
      toast({
        title: "Location updated",
        description: "Geocode retried for the selected location.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Location retry failed",
        description: error?.message || "Unable to retry this location.",
        variant: "destructive",
      });
    },
  });

  const { data: emailStatus } = useQuery<any>({
    queryKey: ["/api/admin/email/status"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 60 * 1000,
  });
  const { data: emailAttempts } = useQuery<any>({
    queryKey: ["/api/admin/email/attempts?limit=25"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 30 * 1000,
  });
  const { data: duplicateEmailAudit } = useQuery<any>({
    queryKey: ["/api/admin/users/duplicate-emails?limit=50"],
    enabled: !!adminUser && selectedTab === "users",
    staleTime: 30 * 1000,
  });

  const { data: parkingPassOnboardingQueue, isLoading: queueLoading } =
    useQuery<ParkingPassOnboardingQueueResponse>({
      queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: parkingPassPricingAudit } =
    useQuery<ParkingPassPricingAuditResponse>({
      queryKey: ["/api/admin/parking-pass/pricing-audit"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: locationDemandFunnel, isLoading: demandFunnelLoading } =
    useQuery<LocationDemandFunnelResponse>({
      queryKey: ["/api/admin/location-demand/funnel"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: hostPayoutRequests, isLoading: payoutQueueLoading } =
    useQuery<HostPayoutRequestsResponse>({
      queryKey: [
        "/api/admin/host-payout-requests",
        payoutStatusFilter,
        payoutSearch,
        payoutFromDate,
        payoutToDate,
        payoutPage,
        payoutPageSize,
      ],
      enabled:
        !!adminUser && selectedTab === "overview" && !payoutDateRangeError,
      staleTime: 30 * 1000,
      queryFn: async () => {
        const params = new URLSearchParams();
        params.set("status", payoutStatusFilter);
        params.set("page", String(payoutPage));
        params.set("pageSize", String(payoutPageSize));
        if (payoutSearch.trim()) {
          params.set("q", payoutSearch.trim());
        }
        if (payoutFromDate) {
          params.set("from", payoutFromDate);
        }
        if (payoutToDate) {
          params.set("to", payoutToDate);
        }
        const res = await fetch(
          `/api/admin/host-payout-requests?${params.toString()}`,
          {
            credentials: "include",
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.message || "Failed to load host payout requests.",
          );
        }
        return data as HostPayoutRequestsResponse;
      },
    });

  const orderedPendingPayoutRowIds = useMemo(() => {
    const rows = Array.isArray(hostPayoutRequests?.rows)
      ? hostPayoutRequests.rows
      : [];
    const pendingRows = rows.filter((row) => row.status === "pending");
    if (pendingRows.length === 0) {
      return [];
    }

    return pendingRows
      .slice()
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      })
      .map((row) => row.id);
  }, [hostPayoutRequests?.rows]);

  const activePendingPayoutRow = useMemo(() => {
    if (!activePendingPayoutRowId) {
      return null;
    }
    const rows = Array.isArray(hostPayoutRequests?.rows)
      ? hostPayoutRequests.rows
      : [];
    return (
      rows.find(
        (row) =>
          row.id === activePendingPayoutRowId && row.status === "pending",
      ) || null
    );
  }, [activePendingPayoutRowId, hostPayoutRequests?.rows]);

  useEffect(() => {
    if (
      activePendingPayoutRowId &&
      !orderedPendingPayoutRowIds.includes(activePendingPayoutRowId)
    ) {
      setActivePendingPayoutRowId(null);
    }
  }, [activePendingPayoutRowId, orderedPendingPayoutRowIds]);

  const jumpToPendingPayout = (rowId: string) => {
    const node = document.getElementById(`payout-row-${rowId}`);
    if (!node) {
      toast({
        title: "Row not found",
        description: "Refresh the queue and try again.",
        variant: "destructive",
      });
      return;
    }

    setActivePendingPayoutRowId(rowId);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const jumpToNextPendingPayout = () => {
    if (orderedPendingPayoutRowIds.length === 0) {
      toast({
        title: "No pending requests",
        description:
          "There are no pending payout requests in the current view.",
      });
      return;
    }

    const currentIndex = activePendingPayoutRowId
      ? orderedPendingPayoutRowIds.indexOf(activePendingPayoutRowId)
      : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) % orderedPendingPayoutRowIds.length
        : 0;
    const nextId = orderedPendingPayoutRowIds[nextIndex];

    if (nextId) {
      jumpToPendingPayout(nextId);
    }
  };

  const jumpToPreviousPendingPayout = () => {
    if (orderedPendingPayoutRowIds.length === 0) {
      toast({
        title: "No pending requests",
        description:
          "There are no pending payout requests in the current view.",
      });
      return;
    }

    const currentIndex = activePendingPayoutRowId
      ? orderedPendingPayoutRowIds.indexOf(activePendingPayoutRowId)
      : 0;
    const prevIndex =
      currentIndex > 0
        ? currentIndex - 1
        : orderedPendingPayoutRowIds.length - 1;
    const prevId = orderedPendingPayoutRowIds[prevIndex];

    if (prevId) {
      jumpToPendingPayout(prevId);
    }
  };

  const isTypingTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  };

  const handlePayoutCardKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.key.toLowerCase() === "a" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      approveCurrentPendingPayout();
      return;
    }

    if (
      event.key.toLowerCase() !== "n" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTypingTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) {
      jumpToPreviousPendingPayout();
      return;
    }
    jumpToNextPendingPayout();
  };

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailCategory, setTestEmailCategory] = useState<
    "general" | "account"
  >("general");
  const sendTestEmail = useMutation({
    mutationFn: async () => {
      const payload: any = { category: testEmailCategory };
      if (testEmailTo.trim()) payload.to = testEmailTo.trim();
      const res = await apiRequest("POST", "/api/admin/email/test", payload);
      return await res.json();
    },
    onSuccess: (result: any) => {
      if (result?.success) {
        toast({ title: "Test email sent" });
      } else {
        toast({
          title: "Test email failed",
          description:
            "Email provider may be disabled or filtered by EMAIL_NOTIFICATIONS_MODE.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Test email failed",
        description: error?.message || "Unable to send test email.",
        variant: "destructive",
      });
    },
  });
  const runParkingPassReminders = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/reminders/run",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      toast({
        title: "Reminder campaign started",
        description: `Sent ${Number(data?.stats?.sent ?? 0)} reminder(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reminder campaign failed",
        description: error?.message || "Unable to run parking pass reminders.",
        variant: "destructive",
      });
    },
  });
  const sendSingleParkingPassReminder = useMutation({
    mutationFn: async (hostId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/parking-pass/reminders/${hostId}/send`,
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      toast({
        title: "Reminder sent",
        description: data?.host?.businessName
          ? `Sent to ${data.host.businessName}.`
          : "Host reminder sent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Send failed",
        description: error?.message || "Unable to send host reminder.",
        variant: "destructive",
      });
    },
  });
  const repairParkingPassPricingAudit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/pricing-audit/repair",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/pricing-audit"],
      });
      toast({
        title: "Pricing repair completed",
        description: `Updated ${Number(data?.updatedHosts ?? 0)} host(s), remaining mismatches ${Number(data?.remainingMismatches ?? 0)}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Pricing repair failed",
        description: error?.message || "Unable to repair pricing drift.",
        variant: "destructive",
      });
    },
  });
  const runLocationDemandActivation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/location-demand/activation/run",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/location-demand/funnel"],
      });
      toast({
        title: "Demand activation run completed",
        description: `Sent ${Number(data?.stats?.sent ?? 0)} reminder(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Demand activation run failed",
        description: error?.message || "Unable to run demand activation.",
        variant: "destructive",
      });
    },
  });
  const updateHostPayoutRequest = useMutation({
    mutationFn: async ({
      requestId,
      status,
    }: {
      requestId: string;
      status: "approved" | "rejected" | "paid" | "cancelled";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/host-payout-requests/${requestId}`,
        { status },
      );
      return await res.json();
    },
    onSuccess: async (_data: any, vars: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/host-payout-requests"],
      });
      toast({
        title: "Payout request updated",
        description: `Request marked as ${vars?.status || "updated"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Unable to update payout request.",
        variant: "destructive",
      });
    },
  });

  const approveCurrentPendingPayout = () => {
    if (!activePendingPayoutRow) {
      toast({
        title: "No selected pending request",
        description:
          "Use Next pending first, then approve the highlighted request.",
      });
      return;
    }

    updateHostPayoutRequest.mutate({
      requestId: activePendingPayoutRow.id,
      status: "approved",
    });
  };

  const exportHostPayoutRequestsCsv = async () => {
    if (payoutDateRangeError) {
      toast({
        title: "Invalid date range",
        description: payoutDateRangeError,
        variant: "destructive",
      });
      return;
    }

    setIsExportingPayouts(true);
    try {
      const params = new URLSearchParams();
      params.set("status", payoutStatusFilter);
      if (payoutSearch.trim()) {
        params.set("q", payoutSearch.trim());
      }
      if (payoutFromDate) {
        params.set("from", payoutFromDate);
      }
      if (payoutToDate) {
        params.set("to", payoutToDate);
      }

      const response = await fetch(
        `/api/admin/host-payout-requests/export.csv?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.message || "Failed to export host payout requests.",
        );
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);
      anchor.href = downloadUrl;
      anchor.download = `host-payout-requests-${payoutStatusFilter}-${dateStamp}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: "Export ready",
        description: "Downloaded payout requests CSV.",
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error?.message || "Unable to export payout requests.",
        variant: "destructive",
      });
    } finally {
      setIsExportingPayouts(false);
    }
  };
  const clearMapCaches = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/map/locations-cache/clear");
      await apiRequest("POST", "/api/admin/parking-pass/cache/clear");
      try {
        localStorage.removeItem("mealscout:map:locations:v1");
        localStorage.removeItem("mealscout:map:bookableHostIds:v1");
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key) keys.push(key);
        }
        keys.forEach((key) => {
          if (key.startsWith("mealscout:map:parkingPassHostStatus:")) {
            localStorage.removeItem(key);
          }
        });
      } catch {
        // ignore localStorage issues
      }
      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: "Cleared map caches",
        description: "Server + browser caches cleared. Map pins will rebuild.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cache clear failed",
        description: error?.message || "Unable to clear caches.",
        variant: "destructive",
      });
    },
  });
  const backfillParkingPasses = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/parking-pass/backfill");
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Backfill complete",
        description: `Created ${Number(data?.created ?? 0)} draft parking pass series.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Backfill failed",
        description: error?.message || "Unable to backfill parking passes.",
        variant: "destructive",
      });
    },
  });
  const normalizeParkingPassSeries = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/normalize-series",
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Normalization complete",
        description: `Updated ${Number(data?.updated ?? 0)} series statuses.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Normalization failed",
        description: error?.message || "Unable to normalize series statuses.",
        variant: "destructive",
      });
    },
  });
  const runParkingPassIntegrity = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/integrity/run",
        {
          dryRun: false,
        },
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Integrity job complete",
        description: `Series created: ${Number(data?.createdDraftSeries ?? 0)}. Defaults updated: ${Number(data?.updatedDefaults ?? 0)}. Status updated: ${Number(data?.updatedStatus ?? 0)}.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Integrity job failed",
        description: error?.message || "Unable to run integrity job.",
        variant: "destructive",
      });
    },
  });

  const uploadHostSpotImage = useMutation({
    mutationFn: async (payload: { hostId: string; file: File }) => {
      const formData = new FormData();
      formData.append("image", payload.file);
      const res = await fetch(`/api/hosts/${payload.hostId}/spot-image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(
          data?.message || text || "Failed to upload spot photo.",
        );
      }
      return data;
    },
    onSuccess: (data: any, vars) => {
      const nextUrl = String(data?.spotImageUrl || "").trim();
      if (nextUrl) {
        setHostEdits((prev) => ({
          ...prev,
          [vars.hostId]: {
            ...prev[vars.hostId],
            spotImageUrl: nextUrl,
          },
        }));
      }
      setSpotImageFilesByHostId((prev) => ({ ...prev, [vars.hostId]: null }));
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      toast({ title: "Uploaded", description: "Spot photo updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Upload failed",
        description: error?.message || "Unable to upload spot photo.",
        variant: "destructive",
      });
    },
  });

  const userContextEnabled =
    !!adminUser && !!selectedUser?.id && userDetailsOpen;

  const { data: parkingPasses = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
    enabled: userContextEnabled,
  });

  const { data: userHosts = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
    enabled: userContextEnabled,
  });

  const { data: userRestaurants = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "restaurants"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: attachBusinessCandidates = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/restaurants/pending", "attach-candidates"],
    enabled:
      !!adminUser &&
      !!selectedUser?.id &&
      userDetailsOpen &&
      isBusinessUserType(selectedUser?.userType),
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/restaurants/pending");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: userDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "deals"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userEvents = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "events"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userEventSeries = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "event-series"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userParkingBookings } = useQuery<any>({
    queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass-bookings"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });
  const { data: userAddresses = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });
  const { data: userActivity } = useQuery<any>({
    queryKey: ["/api/admin/users", selectedUser?.id, "activity"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const selectedUserIdentity = useMemo(() => {
    if (!selectedUser) return null;
    const attachedBusiness = Array.isArray(userRestaurants)
      ? userRestaurants[0]
      : null;
    const journeySignals = [
      ...(Array.isArray(userActivity?.journeySummary)
        ? userActivity.journeySummary.map((entry: any) =>
            String(entry?.category || ""),
          )
        : []),
      ...(Array.isArray(userActivity?.eventCounts)
        ? userActivity.eventCounts.map((entry: any) =>
            String(entry?.eventName || ""),
          )
        : []),
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    return resolveAdminUserBusinessIdentity(
      selectedUser,
      attachedBusiness,
      journeySignals,
    );
  }, [selectedUser, userRestaurants, userActivity]);

  const selectedUserPublicProfilePath = useMemo(() => {
    if (!selectedUser) return null;
    const attachedBusiness = Array.isArray(userRestaurants)
      ? userRestaurants[0]
      : null;
    const path = getAdminUserPublicProfilePath(
      selectedUser,
      attachedBusiness,
      Array.isArray(userHosts) && userHosts.length > 0 ? userHosts[0] : null,
    );
    return path && path !== "/" ? path : null;
  }, [selectedUser, userHosts, userRestaurants]);

  const selectedUserPublicProfileUrl = useMemo(() => {
    if (!selectedUserPublicProfilePath) return null;
    return `${canonicalMealScoutOrigin}${selectedUserPublicProfilePath}`;
  }, [selectedUserPublicProfilePath]);

  const sortedUsers = useMemo(() => {
    const typeOrder = [
      "super_admin",
      "duper_admin",
      "admin",
      "staff",
      "restaurant_owner",
      "food_truck",
      "host",
      "event_coordinator",
      "customer",
    ];
    const orderMap = new Map(typeOrder.map((type, index) => [type, index]));

    const normalized = [...users];
    normalized.sort((a, b) => {
      const dir = userSortDir === "asc" ? 1 : -1;
      if (userSortKey === "type") {
        const aRank = orderMap.get(a.userType) ?? 999;
        const bRank = orderMap.get(b.userType) ?? 999;
        if (aRank !== bRank) return (aRank - bRank) * dir;
      }
      if (userSortKey === "created") {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (aTime !== bTime) return (aTime - bTime) * dir;
      }

      const aName = `${a.firstName || ""} ${a.lastName || ""}`
        .trim()
        .toLowerCase();
      const bName = `${b.firstName || ""} ${b.lastName || ""}`
        .trim()
        .toLowerCase();
      return aName.localeCompare(bName) * dir;
    });

    return normalized;
  }, [users, userSortDir, userSortKey]);

  const userTypeTabs = useMemo(() => {
    const base = [
      { value: "all", label: "All" },
      { value: "customer", label: "Customers" },
      { value: "food_truck", label: "Food Trucks" },
      { value: "restaurant_owner", label: "Restaurants" },
      { value: "host", label: "Hosts" },
      { value: "event_coordinator", label: "Events" },
      { value: "staff", label: "Staff" },
    ];

    if (isAdminOrSuper) {
      base.push({ value: "admin", label: "Admins" });
    }
    if (isDuperOrSuper) {
      base.push({ value: "duper_admin", label: "Duper Admins" });
    }
    if (isSuperAdmin) {
      base.push({ value: "super_admin", label: "Super Admins" });
    }

    return base;
  }, [isAdminOrSuper, isDuperOrSuper, isSuperAdmin]);

  const userCountsByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of users) {
      const type = String(u?.userType || "unknown");
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [users]);
  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    const city = userCityFilter.trim().toLowerCase();
    const state = userStateFilter.trim().toLowerCase();
    return sortedUsers.filter((user: any) => {
      if (userTypeFilter !== "all" && user.userType !== userTypeFilter) {
        return false;
      }
      if (userEmailFilter === "verified" && user.emailVerified !== true) {
        return false;
      }
      if (userEmailFilter === "unverified" && user.emailVerified === true) {
        return false;
      }
      if (userStatusFilter === "active" && user.isDisabled === true) {
        return false;
      }
      if (userStatusFilter === "disabled" && user.isDisabled !== true) {
        return false;
      }
      if (userBusinessOnly && !user.hasRestaurant && !user.businessName) {
        return false;
      }
      if (city) {
        const cityValues = [
          user.city,
          user.defaultCity,
          user.businessCity,
          user.postalCode,
          user.defaultPostalCode,
        ]
          .map((value) => `${value || ""}`.toLowerCase())
          .join(" ");
        if (!cityValues.includes(city)) return false;
      }
      if (state) {
        const stateValues = [user.state, user.defaultState, user.businessState]
          .map((value) => `${value || ""}`.toLowerCase())
          .join(" ");
        if (!stateValues.includes(state)) return false;
      }
      if (!search) return true;
      const name = `${user.firstName || ""} ${user.lastName || ""}`
        .trim()
        .toLowerCase();
      const email = `${user.email || ""}`.toLowerCase();
      const phone = `${user.phone || ""}`.toLowerCase();
      const business =
        `${user.businessName || ""} ${user.businessType || ""}`.toLowerCase();
      const location = `${user.defaultCity || ""} ${user.defaultState || ""} ${
        user.businessCity || ""
      } ${user.businessState || ""} ${user.defaultPostalCode || ""}`.toLowerCase();
      return (
        name.includes(search) ||
        email.includes(search) ||
        phone.includes(search) ||
        business.includes(search) ||
        location.includes(search)
      );
    });
  }, [
    sortedUsers,
    userBusinessOnly,
    userCityFilter,
    userEmailFilter,
    userSearch,
    userStateFilter,
    userStatusFilter,
    userTypeFilter,
  ]);

  const adminMessageFilters = useMemo(
    () => ({
      q: userSearch,
      userType: userTypeFilter,
      emailVerified: userEmailFilter,
      status: userStatusFilter,
      businessOnly: userBusinessOnly,
      city: userCityFilter,
      state: userStateFilter,
      hasEmail: true,
      optInOnly: true,
      excludeInternal: true,
    }),
    [
      userBusinessOnly,
      userCityFilter,
      userEmailFilter,
      userSearch,
      userStateFilter,
      userStatusFilter,
      userTypeFilter,
    ],
  );

  const renderHostLocationsEditor = () => {
    if (!selectedUser) return null;
    if (!(selectedUser?.userType === "host" || userHosts.length > 0))
      return null;

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div>
        <h3 className="font-semibold mb-2 flex items-center text-sm text-muted-foreground">
          <MapPin className="w-4 h-4 mr-2" />
          HOST LOCATIONS (PARKING PASS) ({userHosts.length})
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          These addresses power Parking Pass listings. Edit here to update them
          everywhere.
        </p>
        <div className="space-y-4">
          {userHosts.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No host locations yet.
            </div>
          )}
          {userHosts.map((host: any) => {
            const edits = hostEdits[host.id];
            if (!edits) return null;
            const pass = parkingPasses.find(
              (item) => (item.host?.id ?? item.hostId) === host.id,
            );
            const passEdits = pass ? parkingPassEdits[pass.id] : null;
            return (
              <div
                key={host.id}
                className="border rounded-lg p-3 bg-muted/30 space-y-3"
              >
                <div className="text-sm font-medium">{host.businessName}</div>
                {pass &&
                  Array.isArray((pass as any).qualityFlags) &&
                  (pass as any).qualityFlags.length > 0 && (
                    <div className="text-xs text-destructive">
                      Data quality: {(pass as any).qualityFlags.join(", ")}
                    </div>
                  )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    value={edits.businessName}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          businessName: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    value={edits.address}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          address: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="City"
                    value={edits.city}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          city: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="State"
                    value={edits.state}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          state: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Latitude"
                    value={edits.latitude}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          latitude: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Longitude"
                    value={edits.longitude}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          longitude: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Spot image URL"
                    value={edits.spotImageUrl}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          spotImageUrl: e.target.value,
                        },
                      })
                    }
                  />
                  <div className="sm:col-span-2 flex flex-col gap-2 rounded-md border border-dashed p-3">
                    <div className="text-xs text-muted-foreground">
                      Upload spot photo (preferred). This will show on all maps.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setSpotImageFilesByHostId((prev) => ({
                            ...prev,
                            [host.id]: e.target.files?.[0] ?? null,
                          }))
                        }
                        className="w-full text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          uploadHostSpotImage.isPending ||
                          !spotImageFilesByHostId[host.id]
                        }
                        onClick={() => {
                          const file = spotImageFilesByHostId[host.id];
                          if (!file) return;
                          uploadHostSpotImage.mutate({ hostId: host.id, file });
                        }}
                      >
                        {uploadHostSpotImage.isPending
                          ? "Uploading..."
                          : "Upload"}
                      </Button>
                    </div>
                  </div>
                  <select
                    className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                    value={edits.locationType}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          locationType: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="private_residence">Private Residence</option>
                    <option value="business">Business</option>
                    <option value="parking_lot">Parking Lot</option>
                    <option value="event_space">Event Space</option>
                    <option value="public_park">Public Park</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                    value={resolveFootTrafficValue(edits.expectedFootTraffic)}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          expectedFootTraffic: e.target.value,
                          expectedFootTrafficTouched: true,
                        },
                      })
                    }
                  >
                    <option value="">Foot Traffic</option>
                    {FOOT_TRAFFIC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Contact Phone"
                    value={edits.contactPhone}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          contactPhone: e.target.value,
                        },
                      })
                    }
                  />
                  <textarea
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Amenities JSON"
                    value={edits.amenitiesText}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          amenitiesText: e.target.value,
                        },
                      })
                    }
                  />
                  <textarea
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Notes"
                    value={edits.notes}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          notes: e.target.value,
                        },
                      })
                    }
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={edits.isVerified}
                      onChange={(e) =>
                        setHostEdits({
                          ...hostEdits,
                          [host.id]: {
                            ...edits,
                            isVerified: e.target.checked,
                          },
                        })
                      }
                    />
                    Verified
                  </label>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Parking Pass defaults (host)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These control pins/bookability. Saving the host will sync
                    the derived Parking Pass listing immediately.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Start Time
                      </p>
                      <input
                        type="time"
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={edits.parkingPassStartTime}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassStartTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">End Time</p>
                      <input
                        type="time"
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={edits.parkingPassEndTime}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassEndTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Days</p>
                      <div className="flex flex-wrap gap-2">
                        {dayLabels.map((label, idx) => {
                          const days: number[] = Array.isArray(
                            edits.parkingPassDaysOfWeek,
                          )
                            ? edits.parkingPassDaysOfWeek
                            : [];
                          const checked = days.includes(idx);
                          return (
                            <label
                              key={label}
                              className="flex items-center gap-1 text-xs text-muted-foreground select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set<number>(days);
                                  if (e.target.checked) next.add(idx);
                                  else next.delete(idx);
                                  setHostEdits({
                                    ...hostEdits,
                                    [host.id]: {
                                      ...edits,
                                      parkingPassDaysOfWeek: Array.from(
                                        next,
                                      ).sort((a, b) => a - b),
                                    },
                                  });
                                }}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Breakfast ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassBreakfastPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassBreakfastPriceCents: toCents(
                              e.target.value,
                            ),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Lunch ($)</p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassLunchPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassLunchPriceCents: toCents(e.target.value),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Dinner ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassDinnerPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassDinnerPriceCents: toCents(
                              e.target.value,
                            ),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Daily ($)</p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassDailyPriceCents)}
                        onChange={(e) => {
                          const cents = toCents(e.target.value);
                          const nextWeekly =
                            edits._parkingPassWeeklyManuallyEdited
                              ? Number(edits.parkingPassWeeklyPriceCents || 0)
                              : cents * 7;
                          const nextMonthly =
                            edits._parkingPassMonthlyManuallyEdited
                              ? Number(edits.parkingPassMonthlyPriceCents || 0)
                              : cents * 30;
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassDailyPriceCents: cents,
                              parkingPassWeeklyPriceCents: nextWeekly,
                              parkingPassMonthlyPriceCents: nextMonthly,
                              _parkingPassDailyManuallyEdited: true,
                            },
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Weekly ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassWeeklyPriceCents)}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassWeeklyPriceCents: toCents(
                                e.target.value,
                              ),
                              _parkingPassWeeklyManuallyEdited:
                                toCents(e.target.value) > 0,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Monthly ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassMonthlyPriceCents)}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassMonthlyPriceCents: toCents(
                                e.target.value,
                              ),
                              _parkingPassMonthlyManuallyEdited:
                                toCents(e.target.value) > 0,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  {pass && passEdits ? (
                    <>
                      <div className="pt-2 border-t">
                        <p className="text-xs font-semibold text-muted-foreground">
                          Parking Pass listing override (optional)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Use this only if you need to override a specific
                          listing; host defaults are the source of truth.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Start Time
                          </p>
                          <input
                            type="time"
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.startTime}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  startTime: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            End Time
                          </p>
                          <input
                            type="time"
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.endTime}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  endTime: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Max Trucks
                          </p>
                          <input
                            type="number"
                            min={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.maxTrucks}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  maxTrucks: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
                          <select
                            className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                            value={passEdits.status}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  status: e.target.value,
                                },
                              })
                            }
                          >
                            <option value="open">Open</option>
                            <option value="booked">Booked</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="completed">Completed</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Breakfast ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.breakfastPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                breakfastPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Lunch ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.lunchPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                lunchPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Dinner ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.dinnerPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                dinnerPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Daily ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.dailyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  dailyPriceCents: toCents(e.target.value),
                                  weeklyPriceCents:
                                    passEdits._weeklyManuallyEdited
                                      ? Number(passEdits.weeklyPriceCents || 0)
                                      : toCents(e.target.value) * 7,
                                  monthlyPriceCents:
                                    passEdits._monthlyManuallyEdited
                                      ? Number(passEdits.monthlyPriceCents || 0)
                                      : toCents(e.target.value) * 30,
                                  _dailyManuallyEdited: true,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Weekly ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.weeklyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  weeklyPriceCents: toCents(e.target.value),
                                  _weeklyManuallyEdited:
                                    toCents(e.target.value) > 0,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Monthly ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.monthlyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  monthlyPriceCents: toCents(e.target.value),
                                  _monthlyManuallyEdited:
                                    toCents(e.target.value) > 0,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateParkingPass.mutate({
                            eventId: pass.id,
                            updates: passEdits,
                          })
                        }
                        disabled={updateParkingPass.isPending}
                      >
                        Save Parking Pass
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No parking pass listing yet.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      let amenities: any = undefined;
                      if (edits.amenitiesText) {
                        try {
                          amenities = JSON.parse(edits.amenitiesText);
                        } catch {
                          toast({
                            title: "Invalid JSON",
                            description: "Amenities must be valid JSON.",
                            variant: "destructive",
                          });
                          return;
                        }
                      }
                      updateHost.mutate({
                        hostId: host.id,
                        updates: {
                          ...edits,
                          latitude: String(edits.latitude ?? "").trim()
                            ? String(edits.latitude).trim()
                            : null,
                          longitude: String(edits.longitude ?? "").trim()
                            ? String(edits.longitude).trim()
                            : null,
                          spotImageUrl: edits.spotImageUrl?.trim()
                            ? edits.spotImageUrl.trim()
                            : null,
                          expectedFootTraffic: edits.expectedFootTrafficTouched
                            ? edits.expectedFootTraffic === ""
                              ? null
                              : Number(edits.expectedFootTraffic)
                            : edits.expectedFootTrafficOriginal,
                          amenities,
                        },
                      });
                    }}
                  >
                    Save Host
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      deleteHostLocation.mutate({ hostId: host.id })
                    }
                  >
                    Delete Location
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium">Add Host Location</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Location name"
                value={newHostLocation.businessName}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    businessName: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Address"
                value={newHostLocation.address}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    address: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="City"
                value={newHostLocation.city}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    city: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="State"
                value={newHostLocation.state}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    state: e.target.value,
                  })
                }
              />
              <select
                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                value={newHostLocation.locationType}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    locationType: e.target.value,
                  })
                }
              >
                <option value="private_residence">Private Residence</option>
                <option value="business">Business</option>
                <option value="parking_lot">Parking Lot</option>
                <option value="event_space">Event Space</option>
                <option value="public_park">Public Park</option>
                <option value="other">Other</option>
              </select>
              <select
                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                value={resolveFootTrafficValue(
                  newHostLocation.expectedFootTraffic,
                )}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    expectedFootTraffic: e.target.value,
                  })
                }
              >
                <option value="">Foot Traffic</option>
                {FOOT_TRAFFIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Contact Phone"
                value={newHostLocation.contactPhone}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    contactPhone: e.target.value,
                  })
                }
              />
              <textarea
                className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                placeholder="Notes"
                value={newHostLocation.notes}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    notes: e.target.value,
                  })
                }
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (
                  !newHostLocation.businessName.trim() ||
                  !newHostLocation.address.trim()
                ) {
                  toast({
                    title: "Missing fields",
                    description: "Location name and address are required.",
                    variant: "destructive",
                  });
                  return;
                }
                createHostLocation.mutate({
                  userId: selectedUser.id,
                  data: newHostLocation,
                });
              }}
              disabled={createHostLocation.isPending}
            >
              Add Location
            </Button>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!selectedUser) {
      setUserEdits(null);
      setAffiliateEdits(null);
      return;
    }
    setUserEdits({
      email: selectedUser.email || "",
      firstName: selectedUser.firstName || "",
      lastName: selectedUser.lastName || "",
      phone: selectedUser.phone || "",
      postalCode: selectedUser.postalCode || "",
      birthYear: selectedUser.birthYear || "",
      gender: selectedUser.gender || "",
      isActive: !selectedUser.isDisabled,
      emailVerified: !!selectedUser.emailVerified,
      userType: selectedUser.userType || "unknown",
    });
    setAffiliateEdits({
      affiliatePercent: selectedUser.affiliatePercent ?? 5,
      affiliateCloserUserId: selectedUser.affiliateCloserUserId || "",
      affiliateBookerUserId: selectedUser.affiliateBookerUserId || "",
    });
  }, [selectedUser]);

  useEffect(() => {
    setPayoutPage(1);
  }, [payoutStatusFilter, payoutSearch, payoutFromDate, payoutToDate]);

  useEffect(() => {
    if (!parkingPasses.length) {
      setParkingPassEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    parkingPasses.forEach((pass: any) => {
      const breakfast = Number(pass.breakfastPriceCents ?? 0) || 0;
      const lunch = Number(pass.lunchPriceCents ?? 0) || 0;
      const dinner = Number(pass.dinnerPriceCents ?? 0) || 0;
      const slotSum = breakfast + lunch + dinner;
      const daily = Number(pass.dailyPriceCents ?? 0) || 0;
      const weekly = Number(pass.weeklyPriceCents ?? 0) || 0;
      const monthly = Number(pass.monthlyPriceCents ?? 0) || 0;
      const baseDaily = daily > 0 ? daily : slotSum;
      const derivedWeekly = baseDaily > 0 ? baseDaily * 7 : 0;
      const derivedMonthly = baseDaily > 0 ? baseDaily * 30 : 0;
      nextEdits[pass.id] = {
        startTime: pass.startTime || "",
        endTime: pass.endTime || "",
        maxTrucks: pass.maxTrucks ?? 1,
        status: pass.status || "open",
        breakfastPriceCents: pass.breakfastPriceCents ?? 0,
        lunchPriceCents: pass.lunchPriceCents ?? 0,
        dinnerPriceCents: pass.dinnerPriceCents ?? 0,
        dailyPriceCents: baseDaily,
        weeklyPriceCents: weekly > 0 ? weekly : derivedWeekly,
        monthlyPriceCents: monthly > 0 ? monthly : derivedMonthly,
        _dailyManuallyEdited:
          daily > 0 && slotSum > 0 ? daily !== slotSum : false,
        _weeklyManuallyEdited:
          weekly > 0 && derivedWeekly > 0 ? weekly !== derivedWeekly : false,
        _monthlyManuallyEdited:
          monthly > 0 && derivedMonthly > 0
            ? monthly !== derivedMonthly
            : false,
      };
    });
    setParkingPassEdits(nextEdits);
  }, [parkingPasses]);

  useEffect(() => {
    if (!userAddresses.length) {
      setAddressEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userAddresses.forEach((address: any) => {
      nextEdits[address.id] = {
        label: address.label || "",
        address: address.address || "",
        city: address.city || "",
        state: address.state || "",
        postalCode: address.postalCode || "",
        type: address.type || "other",
        isDefault: !!address.isDefault,
      };
    });
    setAddressEdits(nextEdits);
  }, [userAddresses]);

  useEffect(() => {
    if (!userHosts.length) {
      setHostEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userHosts.forEach((host: any) => {
      const originalFootTraffic =
        host.expectedFootTraffic === undefined
          ? null
          : host.expectedFootTraffic;
      const breakfast = Number(host.parkingPassBreakfastPriceCents ?? 0) || 0;
      const lunch = Number(host.parkingPassLunchPriceCents ?? 0) || 0;
      const dinner = Number(host.parkingPassDinnerPriceCents ?? 0) || 0;
      const slotSum = breakfast + lunch + dinner;
      const daily = Number(host.parkingPassDailyPriceCents ?? 0) || 0;
      const weekly = Number(host.parkingPassWeeklyPriceCents ?? 0) || 0;
      const monthly = Number(host.parkingPassMonthlyPriceCents ?? 0) || 0;
      const baseDaily = daily > 0 ? daily : slotSum;
      const derivedWeekly = baseDaily > 0 ? baseDaily * 7 : 0;
      const derivedMonthly = baseDaily > 0 ? baseDaily * 30 : 0;
      nextEdits[host.id] = {
        businessName: host.businessName || "",
        address: host.address || "",
        city: host.city || "",
        state: host.state || "",
        latitude: host.latitude || "",
        longitude: host.longitude || "",
        spotImageUrl: host.spotImageUrl || "",
        locationType: host.locationType || "other",
        expectedFootTraffic: resolveFootTrafficValue(originalFootTraffic),
        expectedFootTrafficOriginal: originalFootTraffic,
        expectedFootTrafficTouched: false,
        contactPhone: host.contactPhone || "",
        notes: host.notes || "",
        isVerified: !!host.isVerified,
        amenitiesText: host.amenities ? JSON.stringify(host.amenities) : "",
        // Parking Pass defaults (host-level source of truth)
        parkingPassStartTime: host.parkingPassStartTime || "",
        parkingPassEndTime: host.parkingPassEndTime || "",
        parkingPassDaysOfWeek: Array.isArray(host.parkingPassDaysOfWeek)
          ? host.parkingPassDaysOfWeek
          : [],
        parkingPassBreakfastPriceCents:
          host.parkingPassBreakfastPriceCents ?? 0,
        parkingPassLunchPriceCents: host.parkingPassLunchPriceCents ?? 0,
        parkingPassDinnerPriceCents: host.parkingPassDinnerPriceCents ?? 0,
        parkingPassDailyPriceCents: baseDaily,
        parkingPassWeeklyPriceCents: weekly > 0 ? weekly : derivedWeekly,
        parkingPassMonthlyPriceCents: monthly > 0 ? monthly : derivedMonthly,
        _parkingPassDailyManuallyEdited:
          daily > 0 && slotSum > 0 ? daily !== slotSum : false,
        _parkingPassWeeklyManuallyEdited:
          weekly > 0 && derivedWeekly > 0 ? weekly !== derivedWeekly : false,
        _parkingPassMonthlyManuallyEdited:
          monthly > 0 && derivedMonthly > 0
            ? monthly !== derivedMonthly
            : false,
      };
    });
    setHostEdits(nextEdits);
  }, [userHosts]);

  useEffect(() => {
    if (!userRestaurants.length) {
      setRestaurantEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userRestaurants.forEach((restaurant: any) => {
      nextEdits[restaurant.id] = {
        name: restaurant.name || "",
        address: restaurant.address || "",
        phone: restaurant.phone || "",
        businessType: restaurant.businessType || "restaurant",
        cuisineType: restaurant.cuisineType || "",
        promoCode: restaurant.promoCode || "",
        city: restaurant.city || "",
        state: restaurant.state || "",
        latitude: restaurant.latitude || "",
        longitude: restaurant.longitude || "",
        description: restaurant.description || "",
        websiteUrl: restaurant.websiteUrl || "",
        instagramUrl: restaurant.instagramUrl || "",
        facebookPageUrl: restaurant.facebookPageUrl || "",
        isActive: !!restaurant.isActive,
        isVerified: !!restaurant.isVerified,
        amenitiesText: restaurant.amenities
          ? JSON.stringify(restaurant.amenities)
          : "",
      };
    });
    setRestaurantEdits(nextEdits);
  }, [userRestaurants]);

  useEffect(() => {
    if (!userDeals.length) {
      setDealEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userDeals.forEach((deal: any) => {
      nextEdits[deal.id] = {
        title: deal.title || "",
        description: deal.description || "",
        dealType: deal.dealType || "percentage",
        discountValue: deal.discountValue ?? "",
        minOrderAmount: deal.minOrderAmount ?? "",
        imageUrl: deal.imageUrl || "",
        startDate: deal.startDate ? deal.startDate.slice(0, 10) : "",
        endDate: deal.endDate ? deal.endDate.slice(0, 10) : "",
        startTime: deal.startTime || "",
        endTime: deal.endTime || "",
        availableDuringBusinessHours: !!deal.availableDuringBusinessHours,
        isOngoing: !!deal.isOngoing,
        totalUsesLimit: deal.totalUsesLimit ?? "",
        perCustomerLimit: deal.perCustomerLimit ?? "",
        isActive: !!deal.isActive,
      };
    });
    setDealEdits(nextEdits);
  }, [userDeals]);

  useEffect(() => {
    if (!userEvents.length) {
      setEventEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userEvents.forEach((event: any) => {
      nextEdits[event.id] = {
        name: event.name || "",
        description: event.description || "",
        date: event.date ? event.date.slice(0, 10) : "",
        startTime: event.startTime || "",
        endTime: event.endTime || "",
        maxTrucks: event.maxTrucks ?? 1,
        status: event.status || "open",
        hardCapEnabled: !!event.hardCapEnabled,
        requiresPayment: !!event.requiresPayment,
        breakfastPriceCents: event.breakfastPriceCents ?? 0,
        lunchPriceCents: event.lunchPriceCents ?? 0,
        dinnerPriceCents: event.dinnerPriceCents ?? 0,
      };
    });
    setEventEdits(nextEdits);
  }, [userEvents]);

  useEffect(() => {
    if (!userEventSeries.length) {
      setSeriesEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userEventSeries.forEach((series: any) => {
      nextEdits[series.id] = {
        name: series.name || "",
        description: series.description || "",
        timezone: series.timezone || "America/New_York",
        recurrenceRule: series.recurrenceRule || "",
        startDate: series.startDate ? series.startDate.slice(0, 10) : "",
        endDate: series.endDate ? series.endDate.slice(0, 10) : "",
        defaultStartTime: series.defaultStartTime || "",
        defaultEndTime: series.defaultEndTime || "",
        defaultMaxTrucks: series.defaultMaxTrucks ?? 1,
        defaultHardCapEnabled: !!series.defaultHardCapEnabled,
        status: series.status || "draft",
      };
    });
    setSeriesEdits(nextEdits);
  }, [userEventSeries]);

  useEffect(() => {
    const bookingRows = [
      ...(userParkingBookings?.bookingsAsTruck || []),
      ...(userParkingBookings?.bookingsAsHost || []),
    ];
    if (!bookingRows.length) {
      setBookingEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    bookingRows.forEach((row: any) => {
      const booking = row.event_bookings || row;
      nextEdits[booking.id] = {
        status: booking.status || "pending",
        refundStatus: booking.refundStatus || "none",
        refundAmountCents: booking.refundAmountCents ?? "",
        cancellationReason: booking.cancellationReason || "",
        refundReason: booking.refundReason || "",
      };
    });
    setBookingEdits(nextEdits);
  }, [userParkingBookings]);

  // Fetch selected deal's performance stats
  const { data: dealStats } = useQuery<any>({
    queryKey: ["/api/admin/deals", selectedDeal?.id, "stats"],
    enabled: !!adminUser && !!selectedDeal?.id && dealDetailsOpen,
  });

  // Fetch all deals
  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/deals"],
    enabled: !!adminUser && selectedTab === "deals",
  });

  // Fetch verification requests
  const { data: verificationRequests = [], isLoading: loadingVerifications } =
    useQuery<any[]>({
      queryKey: ["/api/admin/verifications"],
      enabled: !!adminUser && selectedTab === "verifications",
    });

  const filteredVerificationRequests = useMemo(() => {
    const search = verificationSearch.trim().toLowerCase();
    if (!search) return verificationRequests;
    return verificationRequests.filter((request: any) => {
      const restaurantName = `${request?.restaurant?.name || ""}`.toLowerCase();
      const address = `${request?.restaurant?.address || ""}`.toLowerCase();
      const status = `${request?.status || ""}`.toLowerCase();
      const ownerEmail = `${request?.restaurant?.email || ""}`.toLowerCase();
      return (
        restaurantName.includes(search) ||
        address.includes(search) ||
        status.includes(search) ||
        ownerEmail.includes(search)
      );
    });
  }, [verificationRequests, verificationSearch]);

  // Approve restaurant mutation
  const approveRestaurant = useMutation({
    mutationFn: async (restaurantId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/restaurants/${restaurantId}/approve`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/restaurants/pending"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Restaurant Approved",
        description: "The restaurant has been activated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve restaurant. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject restaurant mutation
  const rejectRestaurant = useMutation({
    mutationFn: async (restaurantId: string) => {
      return await apiRequest(
        "DELETE",
        `/api/admin/restaurants/${restaurantId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/restaurants/pending"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Restaurant Rejected",
        description: "The restaurant application has been rejected.",
      });
    },
  });

  // Toggle deal featured status
  const toggleDealFeatured = useMutation({
    mutationFn: async ({
      dealId,
      isFeatured,
    }: {
      dealId: string;
      isFeatured: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/featured`, {
        isFeatured,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      toast({
        title: "Deal Updated",
        description: "Featured status has been updated.",
      });
    },
  });

  // Delete deal
  const deleteDeal = useMutation({
    mutationFn: async (dealId: string) => {
      return await apiRequest("DELETE", `/api/admin/deals/${dealId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDealDetailsOpen(false);
      toast({
        title: "Deal Deleted",
        description: "The deal has been permanently deleted.",
      });
    },
  });

  // Clone deal
  const cloneDeal = useMutation({
    mutationFn: async (dealId: string) => {
      return await apiRequest("POST", `/api/admin/deals/${dealId}/clone`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      toast({
        title: "Deal Cloned",
        description: "A copy of the deal has been created (inactive).",
      });
    },
  });

  // Toggle deal active status
  const toggleDealStatus = useMutation({
    mutationFn: async ({
      dealId,
      isActive,
    }: {
      dealId: string;
      isActive: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/status`, {
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Deal Status Updated",
        description: "The deal has been activated/deactivated.",
      });
    },
  });

  // Extend deal
  const extendDeal = useMutation({
    mutationFn: async ({ dealId, days }: { dealId: string; days: number }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/extend`, {
        days,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      setDealDetailsOpen(false);
      toast({
        title: "Deal Extended",
        description: `Deal extended by ${extendDays} days successfully.`,
      });
    },
  });

  // Toggle user status
  const toggleUserStatus = useMutation({
    mutationFn: async ({
      userId,
      isActive,
    }: {
      userId: string;
      isActive: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/status`, {
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Status Updated",
        description: "User account status has been updated.",
      });
    },
  });

  const previewAdminMessage = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/users/message-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: adminMessageFilters }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to preview recipients");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setMessagePreview(data);
      toast({
        title: "Recipient preview ready",
        description: `${data.count} opted-in recipients match these filters.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Preview failed",
        description: error.message || "Unable to preview recipients.",
        variant: "destructive",
      });
    },
  });

  const sendAdminMessage = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/users/message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: adminMessageFilters,
          subject: messageSubject,
          body: messageBody,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to send message");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setMessagePreview(data);
      toast({
        title: "Message sent",
        description: `Sent ${data.sent} emails. ${data.failed} failed.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Send failed",
        description: error.message || "Unable to send message.",
        variant: "destructive",
      });
    },
  });

  const sendIndividualAdminMessage = useMutation({
    mutationFn: async ({
      userId,
      subject,
      body,
    }: {
      userId: string;
      subject: string;
      body: string;
    }) => {
      const res = await fetch("/api/admin/users/message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientIds: [userId],
          filters: {},
          subject,
          body,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to send user message");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Message sent",
        description: `Sent ${data.sent} message${data.sent === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Send failed",
        description: error.message || "Unable to send message.",
        variant: "destructive",
      });
    },
  });

  // Update user type
  const updateUserType = useMutation({
    mutationFn: async ({
      userId,
      userType,
    }: {
      userId: string;
      userType: string;
    }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/type`, {
        userType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Type Updated",
        description: "User type has been changed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user type.",
        variant: "destructive",
      });
    },
  });

  const resendVerificationEmail = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/resend-verification`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Verification Sent",
        description: "Verification email has been resent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend verification email.",
        variant: "destructive",
      });
    },
  });

  const sendPasswordResetLink = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/send-password-reset`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Password Reset Sent",
        description:
          "If the account supports password reset, a reset link has been sent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send password reset link.",
        variant: "destructive",
      });
    },
  });

  const forcePasswordReset = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/force-password-reset`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Password Reset Required",
        description:
          "If the account supports password login, reset will be required on next login.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to force password reset.",
        variant: "destructive",
      });
    },
  });

  const verifyUserEmail = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/verify`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Verified",
        description: "Email verification marked as complete.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to verify user.",
        variant: "destructive",
      });
    },
  });

  const sendSubscriptionLink = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/send-subscription-link`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Subscription Link Sent",
        description: "Monthly subscription link has been emailed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send subscription link.",
        variant: "destructive",
      });
    },
  });

  const updateUserInfo = useMutation({
    mutationFn: async (payload: { userId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/users/${payload.userId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUser(updatedUser);
      toast({
        title: "User Updated",
        description: "User information has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user.",
        variant: "destructive",
      });
    },
  });

  const updateUserAffiliateSettings = useMutation({
    mutationFn: async (payload: { userId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/affiliates/users/${payload.userId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: (updatedAffiliate) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-affiliates"] });
      setSelectedUser((current: any) =>
        current
          ? {
              ...current,
              affiliatePercent: updatedAffiliate.affiliatePercent,
              affiliateCloserUserId: updatedAffiliate.affiliateCloserUserId,
              affiliateBookerUserId: updatedAffiliate.affiliateBookerUserId,
            }
          : current,
      );
      toast({
        title: "Affiliate Settings Updated",
        description: "Supported affiliate settings were saved for this user.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update affiliate settings.",
        variant: "destructive",
      });
    },
  });

  const updateUserBusinessType = useMutation({
    mutationFn: async ({
      restaurantId,
      businessType,
    }: {
      restaurantId: string;
      businessType: string;
    }) => {
      return await apiRequest(
        "PATCH",
        `/api/admin/restaurants/${restaurantId}`,
        {
          businessType,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Business Type Updated",
        description: "Business profile type has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update business type.",
        variant: "destructive",
      });
    },
  });

  const verifyUserInsurance = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${userId}/verify-insurance`,
      );
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (selectedUser?.id === data?.userId) {
        setSelectedUser((current: any) =>
          current
            ? {
                ...current,
                insuranceVerified: true,
                insuranceVerifiedAt: data?.insuranceVerifiedAt,
                insuranceExpiresAt: data?.insuranceExpiresAt,
              }
            : current,
        );
      }
      toast({
        title: "Insurance Verified",
        description: "Auto insurance verification is valid for 365 days.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to verify insurance.",
        variant: "destructive",
      });
    },
  });

  const attachBusinessToUser = useMutation({
    mutationFn: async (payload: { userId: string; restaurantId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/business-users/${payload.userId}/attach-restaurant`,
        {
          restaurantId: payload.restaurantId,
        },
      );
      return await res.json();
    },
    onSuccess: async (data: any, payload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", payload.userId, "restaurants"],
      });
      const refreshedUser = users.find((u: any) => u?.id === payload.userId);
      if (refreshedUser) {
        setSelectedUser(refreshedUser);
      }
      setAttachBusinessSelectedId("");
      setAttachBusinessSearch("");
      toast({
        title: "Business attached",
        description: data?.accessContext?.primaryRestaurant?.name
          ? `Attached to ${data.accessContext.primaryRestaurant.name}.`
          : "Business user linked successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Attach failed",
        description: error?.message || "Unable to attach business user.",
        variant: "destructive",
      });
    },
  });

  const createAndAttachBusinessForUser = useMutation({
    mutationFn: async (payload: {
      userId: string;
      businessName: string;
      address: string;
      city: string;
      state: string;
      phone?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/business-users/${payload.userId}/create-and-attach`,
        payload,
      );
      return await res.json();
    },
    onSuccess: async (_data: any, payload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", payload.userId, "restaurants"],
      });
      toast({
        title: "Business created and attached",
        description: "New business profile is now linked to this user.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Create failed",
        description:
          error?.message || "Unable to create and attach business profile.",
        variant: "destructive",
      });
    },
  });

  const updateParkingPass = useMutation({
    mutationFn: async (payload: { eventId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/parking-pass/${payload.eventId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({
        title: "Parking Pass Updated",
        description: "Parking pass listing updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update parking pass.",
        variant: "destructive",
      });
    },
  });

  const createAddress = useMutation({
    mutationFn: async (payload: { userId: string; data: any }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/addresses`,
        payload.data,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      setNewAddress({
        label: "",
        address: "",
        city: "",
        state: "",
        postalCode: "",
        type: "other",
        isDefault: false,
      });
      toast({ title: "Address Added" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add address.",
        variant: "destructive",
      });
    },
  });

  const updateAddress = useMutation({
    mutationFn: async (payload: {
      userId: string;
      addressId: string;
      updates: any;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Address Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update address.",
        variant: "destructive",
      });
    },
  });

  const deleteAddress = useMutation({
    mutationFn: async (payload: { userId: string; addressId: string }) => {
      return await apiRequest(
        "DELETE",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Address Deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete address.",
        variant: "destructive",
      });
    },
  });

  const setDefaultAddress = useMutation({
    mutationFn: async (payload: { userId: string; addressId: string }) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}/default`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Default Address Updated" });
    },
  });

  const updateHost = useMutation({
    mutationFn: async (payload: { hostId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/hosts/${payload.hostId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({ title: "Host Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update host.",
        variant: "destructive",
      });
    },
  });

  const createHostLocation = useMutation({
    mutationFn: async (payload: { userId: string; data: any }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/hosts`,
        payload.data,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      setNewHostLocation({
        businessName: "",
        address: "",
        city: "",
        state: "",
        locationType: "other",
        expectedFootTraffic: "",
        contactPhone: "",
        notes: "",
      });
      toast({ title: "Host Location Added" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add host location.",
        variant: "destructive",
      });
    },
  });

  const deleteHostLocation = useMutation({
    mutationFn: async (payload: { hostId: string }) => {
      return await apiRequest("DELETE", `/api/admin/hosts/${payload.hostId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({ title: "Host Location Deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete host location.",
        variant: "destructive",
      });
    },
  });

  const updateRestaurant = useMutation({
    mutationFn: async (payload: { restaurantId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/restaurants/${payload.restaurantId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "restaurants"],
      });
      toast({ title: "Restaurant Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update restaurant.",
        variant: "destructive",
      });
    },
  });

  const updateDeal = useMutation({
    mutationFn: async (payload: { dealId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/deals/${payload.dealId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "deals"],
      });
      toast({ title: "Deal Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update deal.",
        variant: "destructive",
      });
    },
  });

  const updateEvent = useMutation({
    mutationFn: async (payload: { eventId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/events/${payload.eventId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "events"],
      });
      toast({ title: "Event Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event.",
        variant: "destructive",
      });
    },
  });

  const updateEventSeries = useMutation({
    mutationFn: async (payload: { seriesId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/event-series/${payload.seriesId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "event-series"],
      });
      toast({ title: "Open Call Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update open call.",
        variant: "destructive",
      });
    },
  });

  const updateBooking = useMutation({
    mutationFn: async (payload: { bookingId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/parking-pass-bookings/${payload.bookingId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "/api/admin/users",
          selectedUser?.id,
          "parking-pass-bookings",
        ],
      });
      toast({ title: "Booking Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update booking.",
        variant: "destructive",
      });
    },
  });

  // Delete user
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUserDetailsOpen(false);
      toast({
        title: "User Deleted",
        description: "User account has been permanently deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user.",
        variant: "destructive",
      });
    },
  });

  // Delete user (super admin only)
  const deleteUserPermanently = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUserDetailsOpen(false);
      toast({
        title: "User Deleted",
        description: "User has been permanently deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to delete user. You may need super admin permissions.",
        variant: "destructive",
      });
    },
  });

  // Approve verification request
  const approveVerification = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/verifications/${requestId}/approve`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Verification Approved",
        description: "Restaurant verification has been approved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve verification. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject verification request
  const rejectVerification = useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: string;
      reason: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/admin/verifications/${requestId}/reject`,
        { reason },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Verification Rejected",
        description: "Restaurant verification has been rejected.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject verification. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!adminUser) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex items-center justify-center p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="w-6 h-6 text-destructive" />
              <span>Access Denied</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You need admin privileges to access this page.
            </p>
            <Link href="/login">
              <Button className="w-full">Go to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const defaultStats: DashboardStats = {
    totalUsers: 0,
    totalRestaurants: 0,
    totalDeals: 0,
    activeDeals: 0,
    totalClaims: 0,
    todayClaims: 0,
    revenue: 0,
    newUsersToday: 0,
    memberCounts: {
      customer: 0,
      restaurantOwner: 0,
      foodTruck: 0,
      host: 0,
      eventCoordinator: 0,
      staff: 0,
      admin: 0,
      duperAdmin: 0,
      superAdmin: 0,
      other: 0,
    },
  };

  const dashboardStats = dashboardTotals?.totals || defaultStats;
  const operations = dashboardTotals?.operations || null;
  const toDollars = (value: number | string | null | undefined) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return parsed / 100;
  };
  const toCents = (value: string | number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100);
  };

  const applyHostDailyAutoIfAllowed = (edits: any) => {
    const slotSum =
      (Number(edits?.parkingPassBreakfastPriceCents ?? 0) || 0) +
      (Number(edits?.parkingPassLunchPriceCents ?? 0) || 0) +
      (Number(edits?.parkingPassDinnerPriceCents ?? 0) || 0);
    if (slotSum <= 0) return edits;
    const nextDaily = edits?._parkingPassDailyManuallyEdited
      ? Number(edits?.parkingPassDailyPriceCents ?? 0) || 0
      : slotSum;
    const nextWeekly = edits?._parkingPassWeeklyManuallyEdited
      ? Number(edits?.parkingPassWeeklyPriceCents ?? 0) || 0
      : nextDaily * 7;
    const nextMonthly = edits?._parkingPassMonthlyManuallyEdited
      ? Number(edits?.parkingPassMonthlyPriceCents ?? 0) || 0
      : nextDaily * 30;
    return {
      ...edits,
      parkingPassDailyPriceCents: nextDaily,
      parkingPassWeeklyPriceCents: nextWeekly,
      parkingPassMonthlyPriceCents: nextMonthly,
    };
  };

  const applyListingDailyAutoIfAllowed = (edits: any) => {
    const slotSum =
      (Number(edits?.breakfastPriceCents ?? 0) || 0) +
      (Number(edits?.lunchPriceCents ?? 0) || 0) +
      (Number(edits?.dinnerPriceCents ?? 0) || 0);
    if (slotSum <= 0) return edits;
    const nextDaily = edits?._dailyManuallyEdited
      ? Number(edits?.dailyPriceCents ?? 0) || 0
      : slotSum;
    const nextWeekly = edits?._weeklyManuallyEdited
      ? Number(edits?.weeklyPriceCents ?? 0) || 0
      : nextDaily * 7;
    const nextMonthly = edits?._monthlyManuallyEdited
      ? Number(edits?.monthlyPriceCents ?? 0) || 0
      : nextDaily * 30;
    return {
      ...edits,
      dailyPriceCents: nextDaily,
      weeklyPriceCents: nextWeekly,
      monthlyPriceCents: nextMonthly,
    };
  };

  const demandSummary = locationDemandFunnel?.summary;
  const demandStuck24h = Number(demandSummary?.threshold_met_stuck_24h ?? 0);
  const demandStuck72h = Number(demandSummary?.threshold_met_stuck_72h ?? 0);
  const demandAlertLevel =
    demandStuck72h > 0
      ? "critical"
      : demandStuck24h > 0
        ? "warning"
        : "healthy";
  const demandAlertBadgeVariant =
    demandAlertLevel === "critical"
      ? "destructive"
      : demandAlertLevel === "warning"
        ? "secondary"
        : "outline";
  const demandAlertText =
    demandAlertLevel === "critical"
      ? "SLA breach: 72h+ threshold backlog requires immediate intervention."
      : demandAlertLevel === "warning"
        ? "Warning: 24h+ threshold backlog needs host follow-up."
        : "Healthy: no threshold backlog breaches.";

  return (
    <div className="admin-dashboard max-w-7xl mx-auto min-h-screen bg-background pb-20">
      {/* Header */}
      <header className="px-4 sm:px-6 py-8 bg-black/20 backdrop-blur-md border-b border-white/5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-2xl bg-primary/10 shadow-[0_0_20px_rgba(245,158,11,0.2)]">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-serif font-bold text-white tracking-tight">
                Admin Dashboard
              </h1>
              <p className="text-primary text-sm font-medium uppercase tracking-[0.2em] mt-1">
                Platform Control & Intelligence
              </p>
              <p className="mt-2 text-xs text-white/70 max-w-2xl">
                You are here as Admin. Use this space to fix user and business
                links, review quarantined profile evidence, and keep public data
                trustworthy.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="border-white/10 hover:bg-white/5 text-white/60"
            data-testid="button-logout-admin"
          >
            Logout
          </Button>
        </div>
      </header>

      {/* Dashboard Switcher */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6">
        <QuickDashboardAccess />
      </div>

      {/* Stats Overview */}
      <div className="px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="col-span-2 md:col-span-4 border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/5">
            <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    LISA
                  </span>
                </div>
                <h2 className="text-lg font-semibold">
                  Livestream is in Control Center
                </h2>
                <p className="text-sm text-muted-foreground">
                  Open the live MealScout signal feed, truth registry, bot
                  traffic, and market intelligence from the admin control
                  center.
                </p>
              </div>
              <Link href="/admin/control-center">
                <Button>Open LISA Livestream</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="col-span-2 md:col-span-4 border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/5">
            <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    MODERATION
                  </span>
                </div>
                <h2 className="text-lg font-semibold">
                  Review Flagged Content
                </h2>
                <p className="text-sm text-muted-foreground">
                  Review flagged recommendations and profile content, assign
                  cases, and resolve reports.
                </p>
              </div>
              <Link href="/admin/moderation/queue">
                <Button variant="outline">Open Moderation Queue</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/5 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-white/60 uppercase tracking-wider">
                Total Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-white">
                  {dashboardStats.totalUsers}
                </div>
                <div className="p-2 rounded-full bg-primary/10 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Users className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-primary mt-2 font-medium">
                +{dashboardStats.newUsersToday} today
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/5 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-white/60 uppercase tracking-wider">
                Restaurant Profiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-white">
                  {dashboardStats.totalRestaurantProfiles ??
                    dashboardStats.totalRestaurants}
                </div>
                <div className="p-2 rounded-full bg-primary/10 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Store className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-white/40 mt-2">
                {dashboardStats.totalRestaurantOwners ??
                  dashboardStats.memberCounts?.restaurantOwner ??
                  0}{" "}
                owners • {pendingRestaurants.length} pending
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/5 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-white/60 uppercase tracking-wider">
                Active Deals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-white">
                  {dashboardStats.activeDeals}
                </div>
                <div className="p-2 rounded-full bg-primary/10 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Package className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-white/40 mt-2">
                of {dashboardStats.totalDeals} total
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black/40 border-white/5 backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-white/60 uppercase tracking-wider">
                Claims Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-white">
                  {dashboardStats.todayClaims}
                </div>
                <div className="p-2 rounded-full bg-primary/10 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Activity className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-white/40 mt-2">
                {dashboardStats.totalClaims} total
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Member Counts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Role total {dashboardStats.memberCountsTotal ?? 0} of{" "}
              {dashboardStats.totalUsers} users
              {dashboardStats.unclassifiedUsers
                ? ` - ${dashboardStats.unclassifiedUsers} unclassified`
                : ""}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Customers</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.customer ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Restaurant Owners</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.restaurantOwner ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Food Trucks</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.foodTruck ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Hosts</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.host ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Event Coordinators</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.eventCoordinator ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Staff</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.staff ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Admins</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.admin ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Duper Admins</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.duperAdmin ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Super Admin</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.superAdmin ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Other</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.other ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Operations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Parking Passes (Live)</p>
                <p className="font-semibold">
                  {operations?.parkingPass?.seriesPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Parking Pass Hosts (Live)
                </p>
                <p className="font-semibold">
                  {operations?.parkingPass?.hostsPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Parking Pass Spots (Capacity)
                </p>
                <p className="font-semibold">
                  {operations?.parkingPass?.spotCapacityPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Bookings (Today)</p>
                <p className="font-semibold">
                  {operations?.bookings?.parkingPassConfirmedToday ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Bookings Confirmed (24h)
                </p>
                <p className="font-semibold">
                  {operations?.bookings?.confirmedLast24h ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Bookings (Next 7d)</p>
                <p className="font-semibold">
                  {operations?.bookings?.parkingPassConfirmedNext7Days ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Open Call Accepted (7d)</p>
                <p className="font-semibold">
                  {operations?.openCalls?.acceptedNext7Days ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Open Call Fill Rate (7d)
                </p>
                <p className="font-semibold">
                  {operations?.openCalls?.fillRateNext7DaysPct?.toFixed?.(1) ??
                    0}
                  %
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {operations?.openCalls?.capacityNext7Days ?? 0} total capacity
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Checkout Holds (Pending)
                </p>
                <p className="font-semibold">
                  {operations?.bookings?.pendingCheckoutHolds ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Checkout Holds (Stale)</p>
                <p
                  className={`font-semibold ${
                    (operations?.bookings?.staleCheckoutHolds ?? 0) > 0
                      ? "text-[color:var(--status-error)]"
                      : ""
                  }`}
                >
                  {operations?.bookings?.staleCheckoutHolds ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Failed Payments (24h)</p>
                <p
                  className={`font-semibold ${
                    (operations?.bookings?.failedPaymentsLast24h ?? 0) > 0
                      ? "text-[color:var(--status-error)]"
                      : ""
                  }`}
                >
                  {operations?.bookings?.failedPaymentsLast24h ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Live Trucks (15m)</p>
                <p className="font-semibold">
                  {operations?.trucks?.liveTrucks15m ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {operations?.trucks?.activeSessions ?? 0} active sessions
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {mapPinAudit && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Map Pin Parity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryMapPinGeocode.mutate()}
                  disabled={retryMapPinGeocode.isPending}
                >
                  {retryMapPinGeocode.isPending
                    ? "Retrying..."
                    : "Retry Missing Geocodes"}
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Rendered host pins</p>
                  <p className="font-semibold">
                    {mapPinAudit.renderedHostLocationCandidates.mappable}/
                    {mapPinAudit.renderedHostLocationCandidates.total}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Primary hosts mapped</p>
                  <p className="font-semibold">
                    {mapPinAudit.primaryHostProfiles.mappable}/
                    {mapPinAudit.primaryHostProfiles.total}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    Extra addresses mapped
                  </p>
                  <p className="font-semibold">
                    {mapPinAudit.additionalHostAddresses.mappable}/
                    {mapPinAudit.additionalHostAddresses.included}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Open requests mapped</p>
                  <p className="font-semibold">
                    {mapPinAudit.openLocationRequests.mappable}/
                    {mapPinAudit.openLocationRequests.total}
                  </p>
                </div>
              </div>
              {!!mapPinAudit.sampleMissing?.length && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Sample missing locations
                  </p>
                  {mapPinAudit.sampleMissing.map((missing) => (
                    <div
                      key={`${missing.source}:${missing.id}`}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-[color:var(--border-subtle)] p-2"
                    >
                      <div className="text-xs">
                        <div className="font-medium text-foreground">
                          {[missing.address, missing.city, missing.state]
                            .filter(Boolean)
                            .join(", ") || "(no address)"}
                        </div>
                        <div className="text-muted-foreground">
                          {missing.source}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryMapPinGeocodeItem.isPending}
                        onClick={() =>
                          retryMapPinGeocodeItem.mutate({
                            source: missing.source,
                            id: missing.id,
                          })
                        }
                      >
                        Retry row
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="mb-4 border-primary/30 bg-background/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Admin Quick Tools</CardTitle>
            <CardDescription>
              Jump straight to verification review, user search, or business
              search.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedTab("verifications")}
            >
              Open Verification Queue
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedTab("users")}
            >
              Search Users
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedTab("quarantine")}
            >
              Review Quarantine
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedTab("users");
                setUserBusinessOnly(true);
                setUserTypeFilter("all");
              }}
            >
              Search Businesses
            </Button>
          </CardContent>
        </Card>

        {/* Main Content Tabs */}
        <Tabs
          value={selectedTab}
          onValueChange={setSelectedTab}
          className="w-full"
        >
          <TabsList className="mb-8 flex flex-wrap h-auto gap-2 bg-black/20 backdrop-blur-md p-2 rounded-2xl border border-white/5 overflow-x-auto">
            <TabsTrigger
              value="overview"
              data-testid="tab-overview"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="launch-board"
              data-testid="tab-launch-board"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Launch Board
            </TabsTrigger>
            <TabsTrigger
              value="restaurants"
              data-testid="tab-restaurants"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Restaurants
            </TabsTrigger>
            <TabsTrigger
              value="lisa"
              data-testid="tab-lisa"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              LISA
            </TabsTrigger>
            <TabsTrigger
              value="users"
              data-testid="tab-users"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Users
            </TabsTrigger>
            <TabsTrigger
              value="food-trucks"
              data-testid="tab-food-trucks"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Food Trucks
            </TabsTrigger>
            <TabsTrigger
              value="quarantine"
              data-testid="tab-quarantine"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Quarantine
            </TabsTrigger>
            <TabsTrigger
              value="staff"
              data-testid="tab-staff"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Staff
            </TabsTrigger>
            <TabsTrigger
              value="deals"
              data-testid="tab-deals"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Deals
            </TabsTrigger>
            <TabsTrigger
              value="verifications"
              data-testid="tab-verifications"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Verifications
            </TabsTrigger>
            <TabsTrigger
              value="onboarding"
              data-testid="tab-onboarding"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Manual Onboarding
            </TabsTrigger>
            <TabsTrigger
              value="imports"
              data-testid="tab-imports"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Admin Uploads
            </TabsTrigger>
            <TabsTrigger
              value="host-locations"
              data-testid="tab-host-locations"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Host Locations
            </TabsTrigger>
            <TabsTrigger
              value="share-portal"
              data-testid="tab-share-portal"
              className="px-6 py-2.5 rounded-xl transition-all data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-[0_0_20px_rgba(245,158,11,0.4)] text-white/60 hover:text-white"
            >
              Share Portal
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Platform Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[color:var(--status-success)]/10 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="w-5 h-5 text-[color:var(--status-success)]" />
                    <span className="font-medium">System Status</span>
                  </div>
                  <Badge variant="default">Operational</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Conversion Rate
                    </div>
                    <div className="text-xl font-bold">
                      {dashboardStats.totalClaims > 0
                        ? (
                            (dashboardStats.todayClaims /
                              dashboardStats.totalClaims) *
                            100
                          ).toFixed(1)
                        : "0"}
                      %
                    </div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Monthly Revenue
                    </div>
                    <div className="text-xl font-bold">
                      {(() => {
                        const revenue = Number(dashboardStats?.revenue ?? 0);
                        return `$${revenue.toFixed(2)}`;
                      })()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Email Delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <div className="font-medium">
                      Provider: {emailStatus?.provider || "unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      From: {emailStatus?.fromName || "MealScout"} &lt;
                      {emailStatus?.fromEmail || "unknown"}&gt;
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Mode: {emailStatus?.mode || "unknown"}
                    </div>
                  </div>
                  <Badge
                    variant={
                      emailStatus?.configured ? "default" : "destructive"
                    }
                  >
                    {emailStatus?.configured ? "Configured" : "Not configured"}
                  </Badge>
                </div>

                {emailStatus?.disabled ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Email sending is disabled by `EMAIL_NOTIFICATIONS_MODE=
                    {String(emailStatus?.mode || "")}`.
                  </div>
                ) : null}

                {!emailStatus?.configured ? (
                  <div className="rounded-md border border-[color:var(--status-error)]/30 bg-[color:var(--status-error)]/10 p-3 text-xs text-[color:var(--status-error)]">
                    Email provider is not configured. Missing:{" "}
                    {Array.isArray(emailStatus?.missing) &&
                    emailStatus.missing.length
                      ? emailStatus.missing.join(", ")
                      : "BREVO_API_KEY"}
                  </div>
                ) : Array.isArray(emailStatus?.missing) &&
                  emailStatus.missing.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Email config warnings: {emailStatus.missing.join(", ")}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="Send test email to (blank = your admin email)"
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                  />
                  <select
                    className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                    value={testEmailCategory}
                    onChange={(e) =>
                      setTestEmailCategory(
                        e.target.value === "account" ? "account" : "general",
                      )
                    }
                  >
                    <option value="general">General</option>
                    <option value="account">Account</option>
                  </select>
                  <Button
                    disabled={sendTestEmail.isPending || !adminUser}
                    onClick={() => sendTestEmail.mutate()}
                  >
                    Send test
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <div className="text-xs font-semibold">Recent attempts</div>
                  {Array.isArray(emailAttempts?.rows) &&
                  emailAttempts.rows.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {emailAttempts.rows.slice(0, 10).map((row: any) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-1 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="truncate">
                              <span className="font-semibold">
                                {row.status}
                              </span>{" "}
                              {row.category ? `(${row.category})` : ""} -{" "}
                              {row.to}
                            </div>
                            <div className="truncate text-muted-foreground">
                              {row.subject}
                            </div>
                            {row.error ? (
                              <div className="truncate text-[color:var(--status-error)]">
                                {row.error}
                              </div>
                            ) : row.skipReason ? (
                              <div className="truncate text-muted-foreground">
                                {row.skipReason}
                              </div>
                            ) : null}
                            {row.providerStatusCode ? (
                              <div className="truncate text-muted-foreground">
                                Provider status: {row.providerStatusCode}
                                {row.providerErrorCode
                                  ? ` (${row.providerErrorCode})`
                                  : ""}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-muted-foreground">
                            {row.createdAt
                              ? new Date(row.createdAt).toLocaleString()
                              : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No email attempts recorded yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Location Demand Funnel</CardTitle>
                    <CardDescription>
                      Track threshold to claimed to published to booked
                      conversion.
                    </CardDescription>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={demandAlertBadgeVariant}>
                        {demandAlertLevel === "critical"
                          ? "Critical"
                          : demandAlertLevel === "warning"
                            ? "Warning"
                            : "Healthy"}
                      </Badge>
                      <Badge
                        variant={demandStuck72h > 0 ? "destructive" : "outline"}
                      >
                        72h stuck: {demandStuck72h}
                      </Badge>
                      <Badge
                        variant={demandStuck24h > 0 ? "secondary" : "outline"}
                      >
                        24h stuck: {demandStuck24h}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={runLocationDemandActivation.isPending}
                    onClick={() => runLocationDemandActivation.mutate()}
                  >
                    {runLocationDemandActivation.isPending
                      ? "Running..."
                      : "Run Activation"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Threshold open
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary?.threshold_met_open ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Claimed</div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary?.claimed_total ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Published
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary
                          ?.claimed_with_published_slots ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Confirmed booking
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary
                          ?.claimed_with_confirmed_booking ?? 0,
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Claim rate from threshold open
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.claimRateFromThresholdOpen ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Publish rate from claimed
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.publishRateFromClaimed ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Booking rate from claimed
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.bookingRateFromClaimed ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                </div>

                <div
                  className={`text-xs ${
                    demandAlertLevel === "critical"
                      ? "text-[color:var(--status-error)]"
                      : demandAlertLevel === "warning"
                        ? "text-[color:var(--status-warning)]"
                        : "text-muted-foreground"
                  }`}
                >
                  {demandFunnelLoading
                    ? "Loading demand funnel..."
                    : demandAlertText}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Parking Pass Onboarding Queue</CardTitle>
                    <CardDescription>
                      Prioritized hosts missing Stripe onboarding or pricing.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={repairParkingPassPricingAudit.isPending}
                      onClick={() => repairParkingPassPricingAudit.mutate()}
                    >
                      {repairParkingPassPricingAudit.isPending
                        ? "Repairing..."
                        : "Repair Pricing"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={runParkingPassReminders.isPending}
                      onClick={() => runParkingPassReminders.mutate()}
                    >
                      {runParkingPassReminders.isPending
                        ? "Running..."
                        : "Run All Reminders"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent
                className="space-y-3"
                tabIndex={0}
                onKeyDown={handlePayoutCardKeyDown}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Total queued
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.total ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      High priority (Stripe)
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.highPriority ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Medium priority (Pricing)
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.mediumPriority ?? 0)}
                    </div>
                  </div>
                </div>

                {parkingPassPricingAudit ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Host pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withHostPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Series pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withSeriesPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Event pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withEventPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Pricing mismatches
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.mismatches ?? 0)}
                      </div>
                    </div>
                  </div>
                ) : null}

                {queueLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading queue...
                  </div>
                ) : Array.isArray(parkingPassOnboardingQueue?.items) &&
                  parkingPassOnboardingQueue.items.length > 0 ? (
                  <div className="space-y-2">
                    {parkingPassOnboardingQueue.items
                      .slice(0, 12)
                      .map((item) => (
                        <div
                          key={item.hostId}
                          className="rounded-md border px-3 py-2 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {item.businessName || "Unnamed host"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.address || "No address"}
                              {item.email ? ` • ${item.email}` : " • No email"}
                            </div>
                            <div className="mt-1 flex gap-2">
                              <Badge
                                variant={
                                  item.priority === "high"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {item.priority}
                              </Badge>
                              {item.needsStripe ? (
                                <Badge variant="outline">Needs Stripe</Badge>
                              ) : null}
                              {item.needsPricing ? (
                                <Badge variant="outline">Needs Pricing</Badge>
                              ) : (
                                <Badge variant="outline">
                                  Pricing: {item.pricingSource}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              sendSingleParkingPassReminder.isPending ||
                              !item.email
                            }
                            onClick={() =>
                              sendSingleParkingPassReminder.mutate(item.hostId)
                            }
                          >
                            {sendSingleParkingPassReminder.isPending
                              ? "Sending..."
                              : "Send Reminder"}
                          </Button>
                        </div>
                      ))}
                    {parkingPassOnboardingQueue.items.length > 12 ? (
                      <div className="text-xs text-muted-foreground">
                        Showing first 12 of{" "}
                        {parkingPassOnboardingQueue.items.length} hosts.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No hosts currently need onboarding reminders.
                  </div>
                )}

                {Array.isArray(parkingPassPricingAudit?.items) &&
                parkingPassPricingAudit.items.length > 0 ? (
                  <div className="pt-2 border-t">
                    <div className="text-xs font-semibold mb-2">
                      Pricing audit exceptions
                    </div>
                    <div className="space-y-2">
                      {parkingPassPricingAudit.items.slice(0, 8).map((item) => (
                        <div
                          key={`pricing-audit-${item.hostId}`}
                          className="rounded-md border px-3 py-2 text-xs"
                        >
                          <div className="font-medium">
                            {item.businessName || item.hostId}
                          </div>
                          <div className="text-muted-foreground">
                            source={item.pricingSource} host=
                            {item.hostPricing ? "yes" : "no"} series=
                            {item.seriesPricing ? "yes" : "no"} event=
                            {item.eventPricing ? "yes" : "no"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Host Payout Requests</CardTitle>
                <CardDescription>
                  Review and process host cash-out requests.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutStatusFilter}
                        onChange={(e) =>
                          setPayoutStatusFilter(
                            e.target.value as
                              | "all"
                              | "pending"
                              | "approved"
                              | "paid"
                              | "rejected"
                              | "cancelled",
                          )
                        }
                      >
                        <option value="all">All statuses</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="paid">Paid</option>
                        <option value="rejected">Rejected</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={
                            payoutStatusFilter === "pending"
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setPayoutStatusFilter("pending")}
                        >
                          Pending only
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            payoutStatusFilter === "all" ? "default" : "outline"
                          }
                          onClick={() => setPayoutStatusFilter("all")}
                        >
                          All
                        </Button>
                      </div>
                      <input
                        className="w-full sm:w-64 px-3 py-2 border rounded-md text-sm"
                        placeholder="Search host/email/address"
                        value={payoutSearch}
                        onChange={(e) => setPayoutSearch(e.target.value)}
                      />
                      <input
                        type="date"
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutFromDate}
                        onChange={(e) =>
                          handlePayoutFromDateChange(e.target.value)
                        }
                      />
                      <input
                        type="date"
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutToDate}
                        onChange={(e) =>
                          handlePayoutToDateChange(e.target.value)
                        }
                      />
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("last7")}
                        >
                          Last 7 Days
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("thisMonth")}
                        >
                          This Month
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("lastMonth")}
                        >
                          Last Month
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("clear")}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    {payoutDateRangeError && (
                      <div className="text-xs text-destructive">
                        {payoutDateRangeError}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">
                      {Number(hostPayoutRequests?.pagination?.total ?? 0)}{" "}
                      matching request(s)
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={jumpToNextPendingPayout}
                      disabled={
                        payoutQueueLoading ||
                        orderedPendingPayoutRowIds.length === 0
                      }
                      title="Shortcuts: N / Shift+N"
                    >
                      Next pending
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={approveCurrentPendingPayout}
                      disabled={
                        updateHostPayoutRequest.isPending ||
                        !activePendingPayoutRow
                      }
                      title="Shortcut: A"
                    >
                      Approve current
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      N / Shift+N / A
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={exportHostPayoutRequestsCsv}
                      disabled={
                        isExportingPayouts ||
                        payoutQueueLoading ||
                        Boolean(payoutDateRangeError)
                      }
                    >
                      {isExportingPayouts ? "Exporting..." : "Export CSV"}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Pending</div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.pending ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Approved
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.approved ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Paid</div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.paid ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Rejected
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.rejected ?? 0)}
                    </div>
                  </div>
                </div>

                {payoutQueueLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading payout requests...
                  </div>
                ) : Array.isArray(hostPayoutRequests?.rows) &&
                  hostPayoutRequests.rows.length > 0 ? (
                  <div className="space-y-2">
                    {hostPayoutRequests.rows.map((row) => {
                      const canApprove = row.status === "pending";
                      const canMarkPaid = row.status === "approved";
                      return (
                        <div
                          key={row.id}
                          id={`payout-row-${row.id}`}
                          className={`rounded-md border px-3 py-2 text-sm flex flex-col gap-2 ${
                            row.id === activePendingPayoutRowId
                              ? "ring-2 ring-primary/40"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                {row.hostBusinessName || "Unnamed host"}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {row.requesterEmail || "No requester email"}
                                {row.hostAddress
                                  ? ` • ${row.hostAddress}${row.hostCity ? `, ${row.hostCity}` : ""}${row.hostState ? `, ${row.hostState}` : ""}`
                                  : ""}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                Requested:{" "}
                                {row.createdAt
                                  ? new Date(row.createdAt).toLocaleString()
                                  : "-"}
                                {row.reviewedAt
                                  ? ` • Reviewed: ${new Date(row.reviewedAt).toLocaleString()}`
                                  : ""}
                                {row.reviewedByEmail
                                  ? ` • By: ${row.reviewedByEmail}`
                                  : row.reviewedByUserId
                                    ? ` • By: ${row.reviewedByUserId}`
                                    : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{row.status}</Badge>
                              <span className="font-semibold">
                                $
                                {(Number(row.amountCents || 0) / 100).toFixed(
                                  2,
                                )}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                updateHostPayoutRequest.isPending || !canApprove
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "approved",
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                updateHostPayoutRequest.isPending ||
                                !canMarkPaid
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "paid",
                                })
                              }
                            >
                              Mark Paid
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                updateHostPayoutRequest.isPending ||
                                row.status === "paid" ||
                                row.status === "rejected"
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "rejected",
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-2">
                      <div className="text-xs text-muted-foreground">
                        Page {Number(hostPayoutRequests?.pagination?.page ?? 1)}{" "}
                        of{" "}
                        {Number(
                          hostPayoutRequests?.pagination?.totalPages ?? 1,
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            payoutQueueLoading ||
                            !hostPayoutRequests?.pagination?.hasPrev
                          }
                          onClick={() =>
                            setPayoutPage((prev) => Math.max(1, prev - 1))
                          }
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            payoutQueueLoading ||
                            !hostPayoutRequests?.pagination?.hasNext
                          }
                          onClick={() => setPayoutPage((prev) => prev + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No host payout requests yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="launch-board" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>One-Market Launch Board</CardTitle>
                <CardDescription>
                  City-level launch metrics for supply, activation, and booking
                  momentum.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-muted-foreground">
                    Generated:{" "}
                    {launchBoardData?.generatedAt
                      ? new Date(launchBoardData.generatedAt).toLocaleString()
                      : "—"}
                  </div>
                  <Select
                    value={launchBoardCity}
                    onValueChange={setLaunchBoardCity}
                  >
                    <SelectTrigger className="w-full sm:w-[240px]">
                      <SelectValue placeholder="Select market city" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Cities</SelectItem>
                      {(launchBoardData?.market?.cityOptions || []).map(
                        (city) => (
                          <SelectItem key={city} value={city}>
                            {city}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {launchBoardLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading launch board...
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-4 text-white shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
                            Launch Board Priority Command Center
                          </div>
                          <div className="text-2xl font-semibold">
                            {launchBoardData?.commandCenter
                              ?.topRecommendedAction ||
                              "Keep improving useful profiles and booking readiness"}
                          </div>
                          <div className="text-sm text-slate-200">
                            Top growth constraint:{" "}
                            <span className="font-medium text-white">
                              {(
                                launchBoardData?.commandCenter
                                  ?.topGrowthConstraint || "none"
                              ).replaceAll("_", " ")}
                            </span>
                          </div>
                          <a
                            className="inline-flex text-sm font-semibold text-emerald-200 underline"
                            href={
                              launchBoardData?.commandCenter
                                ?.topRecommendedActionUrl || "#"
                            }
                          >
                            Open recommended action
                          </a>
                        </div>
                        <div className="grid min-w-full gap-2 sm:grid-cols-2 lg:min-w-[520px]">
                          {[
                            [
                              "Market Health Status",
                              (
                                launchBoardData?.commandCenter
                                  ?.marketHealthStatus || "blocked"
                              ).replaceAll("_", " "),
                            ],
                            [
                              "Booking Readiness Score",
                              `${Number(
                                launchBoardData?.commandCenter
                                  ?.bookingReadinessScore || 0,
                              ).toFixed(0)}/100`,
                            ],
                            [
                              "Highest Priority Fix Type",
                              (
                                launchBoardData?.commandCenter
                                  ?.highestPriorityFixType || "none"
                              ).replaceAll("_", " "),
                            ],
                            [
                              "Highest Priority Fix Status",
                              (
                                launchBoardData?.commandCenter
                                  ?.highestPriorityFixStatus || "none"
                              ).replaceAll("_", " "),
                            ],
                            [
                              "Open Critical Fix Count",
                              launchBoardData?.commandCenter
                                ?.openCriticalFixCount,
                            ],
                            [
                              "Resolved Fix Count",
                              launchBoardData?.commandCenter?.resolvedFixCount,
                            ],
                            [
                              "Improving Fix Count",
                              launchBoardData?.commandCenter?.improvingFixCount,
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={String(label)}
                              className="rounded-lg border border-white/15 bg-white/10 p-3"
                            >
                              <div className="text-[11px] uppercase tracking-wide text-emerald-100">
                                {label}
                              </div>
                              <div className="mt-1 text-lg font-semibold">
                                {typeof value === "number"
                                  ? Number(value || 0).toLocaleString()
                                  : value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                      {[
                        [
                          "Profiles Total",
                          launchBoardData?.metrics?.profilesTotal,
                        ],
                        [
                          "Claimable Profiles",
                          launchBoardData?.metrics?.claimableProfiles,
                        ],
                        [
                          "Claimed Profiles",
                          launchBoardData?.metrics?.claimedProfiles,
                        ],
                        [
                          "Profiles w/ Menu",
                          launchBoardData?.metrics?.profilesWithMenu,
                        ],
                        [
                          "Profiles w/ Schedule",
                          launchBoardData?.metrics?.profilesWithSchedule,
                        ],
                        [
                          "Profiles w/ Contact",
                          launchBoardData?.metrics?.profilesWithContact,
                        ],
                        [
                          "Profiles w/ Photo/Logo",
                          launchBoardData?.metrics?.profilesWithPhotoLogo,
                        ],
                        [
                          "Active Food Trucks",
                          launchBoardData?.metrics?.activeFoodTrucks,
                        ],
                        ["Active Hosts", launchBoardData?.metrics?.activeHosts],
                        [
                          "Parking Pass Listings",
                          launchBoardData?.metrics?.parkingPassListings,
                        ],
                        [
                          "Booking Starts",
                          launchBoardData?.metrics?.bookingStarts,
                        ],
                        [
                          "Booking Confirmations",
                          launchBoardData?.metrics?.bookingConfirmations,
                        ],
                        [
                          "Parking Pass Views",
                          launchBoardData?.metrics?.parkingPassViews,
                        ],
                        [
                          "Parking Pass Clicks",
                          launchBoardData?.metrics?.parkingPassClicks,
                        ],
                        [
                          "Parking Pass Booking Starts",
                          launchBoardData?.metrics?.parkingPassBookingStarts,
                        ],
                        [
                          "Parking Pass Booking Confirmations",
                          launchBoardData?.metrics
                            ?.parkingPassBookingConfirmations,
                        ],
                        [
                          "Parking Pass Click to Start Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.parkingPassClickToStartRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Parking Pass Start to Confirm Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.parkingPassStartToConfirmRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent to Booking Start Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentToBookingStartRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent to Booking Confirm Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentToBookingConfirmRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Parking Pass No Listing Leak",
                          launchBoardData?.metrics?.parkingPassNoListingLeak,
                        ],
                        [
                          "Parking Pass Click No Start Leak",
                          launchBoardData?.metrics?.parkingPassClickNoStartLeak,
                        ],
                        [
                          "Parking Pass Start No Confirm Leak",
                          launchBoardData?.metrics
                            ?.parkingPassStartNoConfirmLeak,
                        ],
                        [
                          "Parking Pass Payment Disabled Leak",
                          launchBoardData?.metrics
                            ?.parkingPassPaymentDisabledLeak,
                        ],
                        [
                          "Parking Pass Host Capacity Leak",
                          launchBoardData?.metrics?.parkingPassHostCapacityLeak,
                        ],
                        [
                          "Parking Pass Missing Host Coordinate Leak",
                          launchBoardData?.metrics
                            ?.parkingPassMissingHostCoordinateLeak,
                        ],
                        [
                          "Parking Pass Missing Truck Profile Leak",
                          launchBoardData?.metrics
                            ?.parkingPassMissingTruckProfileLeak,
                        ],
                        [
                          "Parking Pass Top Leak Reason",
                          launchBoardData?.metrics?.parkingPassTopLeakReason ||
                            "none",
                        ],
                        [
                          "Leak Fixes Open",
                          launchBoardData?.metrics?.leakFixesOpen,
                        ],
                        [
                          "Leak Fixes In Progress",
                          launchBoardData?.metrics?.leakFixesInProgress,
                        ],
                        [
                          "Leak Fixes Resolved",
                          launchBoardData?.metrics?.leakFixesResolved,
                        ],
                        [
                          "Leak Fixes Improved",
                          launchBoardData?.metrics?.leakFixesImproved,
                        ],
                        [
                          "Leak Fix Resolution Rate %",
                          Number(
                            (launchBoardData?.metrics?.leakFixResolutionRate ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Leak Fix Improvement Rate %",
                          Number(
                            (launchBoardData?.metrics?.leakFixImprovementRate ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Public Profile Views",
                          launchBoardData?.metrics?.publicProfileViews,
                        ],
                        [
                          "Public Profile Actions",
                          launchBoardData?.metrics?.publicProfileActions,
                        ],
                        [
                          "Affiliate Link Opens",
                          launchBoardData?.metrics?.affiliateLinkOpens,
                        ],
                        [
                          "Claim Pitches Created",
                          launchBoardData?.metrics?.claimPitchesCreated,
                        ],
                        [
                          "Claim Pitches Sent",
                          launchBoardData?.metrics?.claimPitchesSent,
                        ],
                        [
                          "Claim Pitches Opened",
                          launchBoardData?.metrics?.claimPitchesOpened,
                        ],
                        [
                          "Claim Pitches Started",
                          launchBoardData?.metrics?.claimPitchesStarted,
                        ],
                        [
                          "Claim Pitches Completed",
                          launchBoardData?.metrics?.claimPitchesCompleted,
                        ],
                        [
                          "Claim Pitch Sent Rate %",
                          Number(
                            (launchBoardData?.metrics?.claimPitchSentRate ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Claim Pitch Open Rate %",
                          Number(
                            (launchBoardData?.metrics?.claimPitchOpenRate ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Claim Pitch Start Rate %",
                          Number(
                            (launchBoardData?.metrics?.claimPitchStartRate ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Claim Pitch Completion Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.claimPitchCompletionRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Claimed Profiles Updated After Pitch",
                          launchBoardData?.metrics
                            ?.claimedProfilesUpdatedAfterPitch,
                        ],
                        [
                          "Claimed Profiles w/ Menu After Pitch",
                          launchBoardData?.metrics
                            ?.claimedProfilesWithMenuAfterPitch,
                        ],
                        [
                          "Claimed Profiles w/ Schedule After Pitch",
                          launchBoardData?.metrics
                            ?.claimedProfilesWithScheduleAfterPitch,
                        ],
                        [
                          "Claimed Profiles w/ Contact After Pitch",
                          launchBoardData?.metrics
                            ?.claimedProfilesWithContactAfterPitch,
                        ],
                        [
                          "Claimed Profiles w/ Photo After Pitch",
                          launchBoardData?.metrics
                            ?.claimedProfilesWithPhotoAfterPitch,
                        ],
                        [
                          "Claim to Useful Profile Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.claimToUsefulProfileRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Useful Profiles Total",
                          launchBoardData?.metrics?.usefulProfilesTotal,
                        ],
                        [
                          "Useful Profiles With Views",
                          launchBoardData?.metrics?.usefulProfilesWithViews,
                        ],
                        [
                          "Useful Profiles With Actions",
                          launchBoardData?.metrics?.usefulProfilesWithActions,
                        ],
                        [
                          "Useful Profile View Lift %",
                          Number(
                            (launchBoardData?.metrics?.usefulProfileViewLift ||
                              0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Useful Profile Action Lift %",
                          Number(
                            (launchBoardData?.metrics
                              ?.usefulProfileActionLift || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Useful Profile Booking Click Lift %",
                          Number(
                            (launchBoardData?.metrics
                              ?.usefulProfileBookingClickLift || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent Profiles Total",
                          launchBoardData?.metrics?.bookingIntentProfilesTotal,
                        ],
                        [
                          "Booking Intent From Useful Profiles",
                          launchBoardData?.metrics
                            ?.bookingIntentFromUsefulProfiles,
                        ],
                        [
                          "Booking Intent From Non-Useful Profiles",
                          launchBoardData?.metrics
                            ?.bookingIntentFromNonUsefulProfiles,
                        ],
                        [
                          "Booking Intent Useful Profile Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentUsefulProfileRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent Non-Useful Profile Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentNonUsefulProfileRate || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent Useful Lift %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentUsefulLift || 0) * 100,
                          ).toFixed(1),
                        ],
                        [
                          "Booking Intent to Parking Pass Click Rate %",
                          Number(
                            (launchBoardData?.metrics
                              ?.bookingIntentToParkingPassClickRate || 0) * 100,
                          ).toFixed(1),
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="rounded-lg border p-3"
                        >
                          <div className="text-xs text-muted-foreground">
                            {label}
                          </div>
                          <div className="text-2xl font-semibold">
                            {typeof value === "string"
                              ? value.replaceAll("_", " ")
                              : Number(value || 0).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {(launchBoardData?.leakFixQueue || []).length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">
                          Leak Fix Queue
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Top fix priority:{" "}
                          {launchBoardData?.leakFixQueue?.[0]?.priority ||
                            "none"}
                        </div>
                      </div>
                      <Badge variant="outline">
                        {launchBoardData?.leakFixQueue?.length || 0} open
                      </Badge>
                    </div>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {(launchBoardData?.leakFixQueue || []).map((fix) => (
                        <div
                          key={fix.fixId}
                          className="rounded-lg border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-medium">{fix.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {fix.fixType.replaceAll("_", " ")} -{" "}
                                {fix.leakReason.replaceAll("_", " ")}
                              </div>
                            </div>
                            <Badge
                              variant={
                                fix.priority === "high"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {fix.priority}
                            </Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {fix.description}
                          </div>
                          <div className="mt-3 grid gap-2 rounded-md bg-muted/40 p-2 text-xs">
                            <div>
                              Outcome status:{" "}
                              <span className="font-medium text-foreground">
                                {fix.fixOutcomeStatus.replaceAll("_", " ")}
                              </span>
                            </div>
                            <div>
                              Linked metric:{" "}
                              <span className="font-medium text-foreground">
                                {Number(
                                  fix.linkedMetricBefore || 0,
                                ).toLocaleString()}{" "}
                                -&gt;{" "}
                                {Number(
                                  fix.linkedMetricAfter || 0,
                                ).toLocaleString()}{" "}
                                (
                                {Number(
                                  fix.linkedMetricDelta || 0,
                                ).toLocaleString()}
                                )
                              </span>
                            </div>
                            {fix.fixOutcomeNotes ? (
                              <div>Notes: {fix.fixOutcomeNotes}</div>
                            ) : null}
                            {fix.fixResolvedAt ? (
                              <div>
                                Resolved:{" "}
                                {new Date(fix.fixResolvedAt).toLocaleString()}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <Badge variant="secondary">{fix.status}</Badge>
                            <a
                              className="text-xs font-medium underline"
                              href={fix.targetUrl}
                            >
                              Open target
                            </a>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={updateLeakFixOutcome.isPending}
                              onClick={() =>
                                updateLeakFixOutcome.mutate({
                                  fix,
                                  status: "in_progress",
                                  fixOutcomeStatus: "needs_follow_up",
                                  fixOutcomeNotes:
                                    "Operator started this leak fix from the Launch Board.",
                                })
                              }
                            >
                              Mark in progress
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={updateLeakFixOutcome.isPending}
                              onClick={() =>
                                updateLeakFixOutcome.mutate({
                                  fix,
                                  status: "resolved",
                                  fixOutcomeStatus: "resolved_improved",
                                  fixOutcomeNotes:
                                    "Marked resolved from the Launch Board.",
                                })
                              }
                            >
                              Mark resolved
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lisa" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>LISA Opportunity Console</CardTitle>
                <CardDescription>
                  First-party truth now, with recommendation cards only when
                  signal density is sufficient
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isTruthOnlyMode ? (
                  <div className="text-xs text-muted-foreground">
                    {lisaMarketIntel?.signalContract?.reason ||
                      "Not enough recent first-party signal to rank recommendation cards safely."}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/admin/control-center">
                    <Button>Open Full Stream</Button>
                  </Link>
                  <Badge variant="outline">
                    {(promoteNowItems ?? []).length} promotion ideas
                  </Badge>
                  <Badge variant="outline">
                    {(acquisitionWatchItems ?? []).length} acquisition targets
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Human sessions now
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.humanSessionsNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Intent actions now
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.intentActionsNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Repeated interest
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters
                          ?.repeatedBusinessInterestNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Machine discovery
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.machineDiscoveryNow ??
                          0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Friction cases
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.frictionCasesNow ?? 0,
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Top content promotion candidate
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topPromotionItem
                        ? buildBriefSentence(topPromotionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topPromotionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topPromotionItem.rankReason}
                        </div>
                      ) : null}
                      {topPromotionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topPromotionItem.changed}
                        </div>
                      ) : null}
                      {topPromotionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topPromotionItem.href}>
                            <Button size="sm" variant="outline">
                              {topPromotionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "snooze",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "done",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "dismiss",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Biggest demand spike
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topDemandItem
                        ? buildBriefSentence(topDemandItem)
                        : "No clear demand spike yet."}
                      {topDemandItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topDemandItem.rankReason}
                        </div>
                      ) : null}
                      {topDemandItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday: {topDemandItem.changed}
                        </div>
                      ) : null}
                      {topDemandItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topDemandItem.href}>
                            <Button size="sm" variant="outline">
                              {topDemandItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "snooze",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "done",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "dismiss",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Strongest supply/acquisition watch target
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topAcquisitionItem
                        ? buildBriefSentence(topAcquisitionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topAcquisitionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topAcquisitionItem.rankReason}
                        </div>
                      ) : null}
                      {topAcquisitionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topAcquisitionItem.changed}
                        </div>
                      ) : null}
                      {topAcquisitionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topAcquisitionItem.href}>
                            <Button size="sm" variant="outline">
                              {topAcquisitionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "snooze",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "done",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "dismiss",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Machine discovery pressure to address
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topMachineAttentionItem
                        ? buildBriefSentence(topMachineAttentionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topMachineAttentionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topMachineAttentionItem.rankReason}
                        </div>
                      ) : null}
                      {topMachineAttentionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topMachineAttentionItem.changed}
                        </div>
                      ) : null}
                      {topMachineAttentionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topMachineAttentionItem.href}>
                            <Button size="sm" variant="outline">
                              {topMachineAttentionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "snooze",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "done",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "dismiss",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        What Changed Since Yesterday
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {yesterdayChangeItems.length ? (
                        yesterdayChangeItems.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.title}</div>
                              <Badge variant="outline">
                                {item.delta > 0 ? "+" : ""}
                                {item.delta}
                              </Badge>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.summary}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Yesterday-to-today movement is still too light to
                          summarize yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Food Trend Watch
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {foodTrendItems.length ? (
                        foodTrendItems.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.label}</div>
                              <div className="flex gap-2">
                                <Badge variant="outline">
                                  {item.currentCount} now
                                </Badge>
                                <Badge variant="outline">
                                  {item.delta > 0 ? "+" : ""}
                                  {item.delta}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.summary}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No clear food trend movement is visible yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Promote Now</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {promoteNowItems.length ? (
                        promoteNowItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No immediate promotion opportunities are clear yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Demand Spikes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {demandSpikeItems.length ? (
                        demandSpikeItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No clear demand spikes detected yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">Price Scout</CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=json"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Export JSON
                          </a>
                          <a
                            href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=csv"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Export CSV
                          </a>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {priceScoutSupplySummary ? (
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">
                            {priceScoutSupplySummary.totalRecentRecords} supply
                            records
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.snapshotCount} snapshots
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.alertCount} alerts
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.watchCount} watches
                          </Badge>
                        </div>
                      ) : null}
                      {priceScoutDeals.length ? (
                        priceScoutDeals.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">
                                {item.restaurantName}
                              </div>
                              <Badge variant="outline">
                                value {item.valueScore}
                              </Badge>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.title}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.priceSignal}
                              {item.cuisineType
                                ? ` in ${item.cuisineType}.`
                                : "."}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: Promote this offer, fold it into
                              advertiser packages, and use it as proof of local
                              value coverage.
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Price Scout needs more active deals before it can rank
                          value cleanly.
                        </div>
                      )}
                      {priceScoutSupplySpotlight.length ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            Supply lane spotlight
                          </div>
                          {priceScoutSupplySpotlight
                            .slice(0, 2)
                            .map((signal: any) => (
                              <div
                                key={`${signal.lane}:${signal.itemKey}:${signal.createdAt}`}
                                className="rounded-lg border px-3 py-2 text-xs"
                              >
                                <div className="font-medium">
                                  {signal.itemName}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {String(
                                    signal.signalType || "signal",
                                  ).replace(/_/g, " ")}{" "}
                                  in {signal.areaKey}
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Machine Attention
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {machineAttentionItems.length ? (
                        machineAttentionItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No meaningful outside machine attention is visible
                          yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Acquisition Targets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {acquisitionWatchItems.length ? (
                        acquisitionWatchItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No acquisition targets stand out yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Pages To Improve
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {authorityGapItems.length ? (
                        authorityGapItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No obvious authority gaps are showing yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Restaurants Tab */}
          <TabsContent value="restaurants" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Pending Restaurant Approvals</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingRestaurants.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No pending approvals
                  </p>
                ) : (
                  <div className="space-y-3">
                    {pendingRestaurants.map((restaurant: PendingRestaurant) => (
                      <div
                        key={restaurant.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <div className="font-medium">{restaurant.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {restaurant.cuisineType} - {restaurant.email}
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              approveRestaurant.mutate(restaurant.id)
                            }
                            disabled={approveRestaurant.isPending}
                            data-testid={`button-approve-${restaurant.id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              rejectRestaurant.mutate(restaurant.id)
                            }
                            disabled={rejectRestaurant.isPending}
                            data-testid={`button-reject-${restaurant.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Food Trucks Tab */}
          <TabsContent value="food-trucks" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Food Truck Profile Inventory</CardTitle>
                <CardDescription>
                  Operational completeness snapshot for truck public profiles.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="text-lg font-semibold">
                      {Number(foodTruckInventoryPayload?.counts?.total || 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      Missing Menu
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        foodTruckInventoryPayload?.counts?.missingMenu || 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      Missing Logo
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        foodTruckInventoryPayload?.counts?.missingLogo || 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      Missing Owner
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        foodTruckInventoryPayload?.counts?.missingOwner || 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      Quarantined
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        foodTruckInventoryPayload?.counts?.quarantined || 0,
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <input
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    value={truckInventorySearch}
                    onChange={(event) =>
                      setTruckInventorySearch(event.target.value)
                    }
                    placeholder="Search truck, owner email, phone, city"
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={truckFilterMissingMenu}
                      onChange={(event) =>
                        setTruckFilterMissingMenu(event.target.checked)
                      }
                    />
                    Missing menu
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={truckFilterMissingLogo}
                      onChange={(event) =>
                        setTruckFilterMissingLogo(event.target.checked)
                      }
                    />
                    Missing logo
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={truckFilterMissingOwner}
                      onChange={(event) =>
                        setTruckFilterMissingOwner(event.target.checked)
                      }
                    />
                    Missing owner
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={truckFilterQuarantined}
                      onChange={(event) =>
                        setTruckFilterQuarantined(event.target.checked)
                      }
                    />
                    Quarantined
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={truckFilterVerified}
                      onChange={(event) =>
                        setTruckFilterVerified(event.target.checked)
                      }
                    />
                    Verified
                  </label>
                </div>

                {foodTruckInventoryLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading food truck inventory...
                  </div>
                ) : null}
                {foodTruckInventoryError ? (
                  <div className="text-sm text-red-500">
                    Failed to load food truck inventory.{" "}
                    <button
                      className="underline"
                      onClick={() => refetchFoodTruckInventory()}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}

                {!foodTruckInventoryLoading && !foodTruckInventoryError ? (
                  <>
                    <div
                      className="hidden overflow-x-auto rounded-lg border md:block"
                      data-admin-truck-inventory-desktop-table
                    >
                      <table className="w-full min-w-[1200px] text-sm">
                        <thead className="bg-muted/30 text-left">
                          <tr>
                            <th className="px-3 py-2">Truck</th>
                            <th className="px-3 py-2">Owner</th>
                            <th className="px-3 py-2">City</th>
                            <th className="px-3 py-2">Logo</th>
                            <th className="px-3 py-2">Cover</th>
                            <th className="px-3 py-2">Menu</th>
                            <th className="px-3 py-2">Phone</th>
                            <th className="px-3 py-2">Email / Socials</th>
                            <th className="px-3 py-2">Verification</th>
                            <th className="px-3 py-2">Updated</th>
                            <th className="px-3 py-2">Missing</th>
                            <th className="px-3 py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {foodTruckInventoryRows.map((truck) => (
                            <tr key={truck.id} className="border-t align-top">
                              <td className="px-3 py-2">
                                <div className="font-medium">{truck.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {truck.id}
                                </div>
                                {truck.rowStatus &&
                                truck.rowStatus !== "operational" ? (
                                  <Badge variant="secondary" className="mt-1">
                                    {truck.rowStatus.replace(/_/g, " ")}
                                  </Badge>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                {truck.ownerEmail || (
                                  <span className="text-muted-foreground">
                                    Missing owner
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {truck.city || "Missing"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={
                                      truck.hasLogo ? "default" : "secondary"
                                    }
                                  >
                                    {truck.hasLogo ? "Yes" : "No"}
                                  </Badge>
                                  {truck.logoUrl ? (
                                    <img
                                      src={getOptimizedImageUrl(
                                        truck.logoUrl,
                                        40,
                                      )}
                                      alt=""
                                      className="h-8 w-8 rounded object-cover"
                                    />
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant={
                                      truck.hasCoverImage
                                        ? "default"
                                        : "secondary"
                                    }
                                  >
                                    {truck.hasCoverImage ? "Yes" : "No"}
                                  </Badge>
                                  {truck.coverImageUrl ? (
                                    <img
                                      src={getOptimizedImageUrl(
                                        truck.coverImageUrl,
                                        40,
                                      )}
                                      alt=""
                                      className="h-8 w-8 rounded object-cover"
                                    />
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {truck.menuItemCount}{" "}
                                {truck.hasMenu ? "" : "(Missing)"}
                              </td>
                              <td className="px-3 py-2">
                                {truck.phone || "Missing"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-1">
                                  <Badge
                                    variant={
                                      truck.hasEmail ? "default" : "secondary"
                                    }
                                  >
                                    {truck.hasEmail ? "Email" : "No email"}
                                  </Badge>
                                  <Badge
                                    variant={
                                      truck.hasSocials ? "default" : "secondary"
                                    }
                                  >
                                    {truck.hasSocials
                                      ? "Socials"
                                      : "No socials"}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col gap-1">
                                  <Badge
                                    variant={
                                      truck.isVerified ? "default" : "secondary"
                                    }
                                  >
                                    {truck.isVerified ? "Verified" : "Pending"}
                                  </Badge>
                                  <Badge
                                    variant={
                                      truck.isQuarantined
                                        ? "destructive"
                                        : "outline"
                                    }
                                  >
                                    {truck.isQuarantined
                                      ? "Quarantined"
                                      : "Clear"}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {truck.lastUpdatedAt
                                  ? new Date(
                                      truck.lastUpdatedAt,
                                    ).toLocaleString()
                                  : "Unknown"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap gap-1">
                                  {truck.missingFields.length ? (
                                    truck.missingFields
                                      .slice(0, 4)
                                      .map((field) => (
                                        <Badge
                                          key={`${truck.id}:${field}`}
                                          variant="secondary"
                                        >
                                          {field}
                                        </Badge>
                                      ))
                                  ) : (
                                    <Badge variant="outline">Complete</Badge>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-col items-start gap-1">
                                  <a
                                    className="underline"
                                    href={truck.publicProfileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View
                                  </a>
                                  <a
                                    className="underline"
                                    href={`/restaurant/${encodeURIComponent(truck.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Edit
                                  </a>
                                  <a
                                    className="underline"
                                    href={`/admin?tab=users`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Attach owner
                                  </a>
                                  <a
                                    className="underline"
                                    href={`/admin?tab=quarantine`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Review evidence
                                  </a>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {foodTruckInventoryRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={12}
                                className="px-3 py-8 text-center text-muted-foreground"
                              >
                                No food trucks match the current filters.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    <div
                      className="grid gap-3 md:hidden"
                      data-admin-truck-inventory-mobile-cards
                    >
                      {foodTruckInventoryRows.map((truck) => (
                        <div
                          key={truck.id}
                          className="rounded-lg border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium break-words">
                                {truck.name}
                              </div>
                              <div className="text-xs text-muted-foreground break-all">
                                {truck.id}
                              </div>
                            </div>
                            <Badge
                              variant={
                                truck.isQuarantined ? "destructive" : "outline"
                              }
                              className="shrink-0"
                            >
                              {truck.rowStatus &&
                              truck.rowStatus !== "operational"
                                ? truck.rowStatus.replace(/_/g, " ")
                                : "operational"}
                            </Badge>
                          </div>
                          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
                            <div>
                              <dt className="text-muted-foreground">Owner</dt>
                              <dd className="break-all">
                                {truck.ownerEmail || "No active owner"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">City</dt>
                              <dd>{truck.city || "Missing"}</dd>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <dt className="text-muted-foreground">Menu</dt>
                                <dd>{truck.menuItemCount} items</dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">
                                  Updated
                                </dt>
                                <dd>
                                  {truck.lastUpdatedAt
                                    ? new Date(
                                        truck.lastUpdatedAt,
                                      ).toLocaleDateString()
                                    : "Unknown"}
                                </dd>
                              </div>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Missing</dt>
                              <dd className="mt-1 flex flex-wrap gap-1">
                                {truck.missingFields.length ? (
                                  truck.missingFields
                                    .slice(0, 4)
                                    .map((field) => (
                                      <Badge
                                        key={`${truck.id}:mobile:${field}`}
                                        variant="secondary"
                                      >
                                        {field}
                                      </Badge>
                                    ))
                                ) : (
                                  <Badge variant="outline">Complete</Badge>
                                )}
                              </dd>
                            </div>
                          </dl>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                  Search users, filter audiences, send admin messages, and audit
                  activity history.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    Use the filters to build an audience, then use{" "}
                    <span className="font-semibold text-foreground">
                      Message filtered users
                    </span>{" "}
                    below before the user list. Staff/admin accounts and
                    opted-out users are protected by default.
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setUserBusinessOnly(false);
                        setUserSearch("");
                      }}
                    >
                      User search mode
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setUserBusinessOnly(true);
                        setUserSearch("");
                      }}
                    >
                      Business search mode
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search name, email, phone, business, city"
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    />
                    <input
                      value={userCityFilter}
                      onChange={(e) => setUserCityFilter(e.target.value)}
                      placeholder="City / ZIP"
                      className="text-xs px-2 py-1 border rounded-md bg-background w-24"
                    />
                    <input
                      value={userStateFilter}
                      onChange={(e) => setUserStateFilter(e.target.value)}
                      placeholder="State"
                      className="text-xs px-2 py-1 border rounded-md bg-background w-20"
                    />
                    <select
                      value={userEmailFilter}
                      onChange={(e) => setUserEmailFilter(e.target.value)}
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="all">Any email status</option>
                      <option value="verified">Verified email</option>
                      <option value="unverified">Unverified email</option>
                    </select>
                    <select
                      value={userStatusFilter}
                      onChange={(e) => setUserStatusFilter(e.target.value)}
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="active">Active users</option>
                      <option value="disabled">Disabled users</option>
                      <option value="all">Any account status</option>
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs px-2 py-1 border rounded-md bg-background">
                      <input
                        type="checkbox"
                        checked={userBusinessOnly}
                        onChange={(e) => setUserBusinessOnly(e.target.checked)}
                      />
                      Has business
                    </label>
                    <select
                      value={userSortKey}
                      onChange={(e) =>
                        setUserSortKey(e.target.value as typeof userSortKey)
                      }
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="type">Sort by Type</option>
                      <option value="name">Sort by Name</option>
                      <option value="created">Sort by Created</option>
                    </select>
                    <select
                      value={userSortDir}
                      onChange={(e) =>
                        setUserSortDir(e.target.value as typeof userSortDir)
                      }
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </div>
                </div>

                {usersError && (
                  <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span>
                      Failed to load users.{" "}
                      {String((usersError as any)?.message || "").trim() ||
                        "Please retry."}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchUsers()}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                <Tabs value={userTypeFilter} onValueChange={setUserTypeFilter}>
                  <TabsList className="mt-3 w-full justify-start overflow-x-auto flex-nowrap">
                    {userTypeTabs.map((tab) => {
                      const count =
                        tab.value === "all"
                          ? users.length
                          : (userCountsByType.get(tab.value) ?? 0);
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="whitespace-nowrap"
                        >
                          {tab.label}
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {count}
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>
                {Array.isArray(duplicateEmailAudit?.groups) &&
                  duplicateEmailAudit.groups.length > 0 && (
                    <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-500" />
                            Possible duplicate accounts
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Read-only audit grouped by normalized email. Review
                            before any manual merge. Do not merge accounts
                            automatically without checking ownership and linked
                            business data.
                          </p>
                        </div>
                        <Badge variant="outline">
                          {duplicateEmailAudit.groups.length} email group
                          {duplicateEmailAudit.groups.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      <div className="space-y-2">
                        {duplicateEmailAudit.groups
                          .slice(0, 5)
                          .map((group: any) => (
                            <div
                              key={group.normalizedEmail}
                              className="rounded-lg border bg-background/80 p-3"
                            >
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-semibold">
                                  {group.normalizedEmail}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Badge
                                    variant={
                                      group.riskLevel === "high"
                                        ? "destructive"
                                        : "secondary"
                                    }
                                  >
                                    {group.riskLevel || "review"} risk
                                  </Badge>
                                  <Badge variant="secondary">
                                    {Array.isArray(group.users)
                                      ? group.users.length
                                      : 0}{" "}
                                    accounts
                                  </Badge>
                                </div>
                              </div>
                              {Array.isArray(group.reasons) &&
                                group.reasons.length > 0 && (
                                  <div className="mb-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                                    {group.reasons.join(" · ")}
                                  </div>
                                )}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mb-2"
                                onClick={() => {
                                  window.open(
                                    `/api/admin/users/duplicate-emails/${encodeURIComponent(
                                      group.normalizedEmail,
                                    )}/merge-plan`,
                                    "_blank",
                                  );
                                }}
                              >
                                Open dry-run merge plan
                              </Button>
                              <div className="space-y-2">
                                {(Array.isArray(group.users)
                                  ? group.users
                                  : []
                                ).map((candidate: any) => (
                                  <div
                                    key={candidate.id}
                                    className="rounded-md border px-3 py-2 text-xs"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">
                                          {candidate.email || "No email"}
                                        </span>
                                        {candidate.id ===
                                          group.recommendedPrimaryId && (
                                          <Badge variant="default">
                                            likely primary
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="text-muted-foreground">
                                        {candidate.userType || "unknown"}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-muted-foreground">
                                      {candidate.firstName || ""}{" "}
                                      {candidate.lastName || ""} · ID{" "}
                                      {candidate.id}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      <Badge variant="outline">
                                        {candidate.emailVerified
                                          ? "verified"
                                          : "unverified"}
                                      </Badge>
                                      {candidate.hasPassword && (
                                        <Badge variant="outline">
                                          password
                                        </Badge>
                                      )}
                                      {candidate.hasGoogle && (
                                        <Badge variant="outline">google</Badge>
                                      )}
                                      {candidate.hasFacebook && (
                                        <Badge variant="outline">
                                          facebook
                                        </Badge>
                                      )}
                                      {candidate.hasTradeScout && (
                                        <Badge variant="outline">
                                          tradescout
                                        </Badge>
                                      )}
                                      <Badge variant="outline">
                                        restaurants{" "}
                                        {Number(candidate.restaurantCount || 0)}
                                      </Badge>
                                      <Badge variant="outline">
                                        hosts {Number(candidate.hostCount || 0)}
                                      </Badge>
                                      <Badge variant="outline">
                                        activity{" "}
                                        {Number(candidate.telemetryCount || 0)}
                                      </Badge>
                                      <Badge variant="outline">
                                        score{" "}
                                        {Number(candidate.auditScore || 0)}
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                {isAdminOrSuper && (
                  <div className="mt-4 rounded-xl border bg-muted/20 p-4 space-y-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          <Mail className="w-4 h-4" />
                          Message filtered users
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Uses the filters above. Excludes staff/admins and
                          users who turned email off. Keep language clear and
                          avoid sensitive personal data. Platform admin support
                          accounts are trusted contacts; user/business
                          connection requests still require accept or deny.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {filteredUsers.length} visible matches
                      </Badge>
                    </div>
                    <input
                      value={messageSubject}
                      onChange={(e) => setMessageSubject(e.target.value)}
                      placeholder="Subject"
                      maxLength={140}
                      className="w-full text-sm px-3 py-2 border rounded-md bg-background"
                    />
                    <textarea
                      value={messageBody}
                      onChange={(e) => setMessageBody(e.target.value)}
                      placeholder="Message body. Tell users why they are receiving it and what action to take."
                      rows={5}
                      maxLength={5000}
                      className="w-full text-sm px-3 py-2 border rounded-md bg-background"
                    />
                    {messagePreview && (
                      <div className="rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
                        Recipients:{" "}
                        <span className="font-semibold text-foreground">
                          {messagePreview.count}
                        </span>
                        {typeof messagePreview.skippedOptOut === "number" && (
                          <>
                            {" "}
                            · opted out skipped:{" "}
                            <span className="font-semibold text-foreground">
                              {messagePreview.skippedOptOut}
                            </span>
                          </>
                        )}
                        {messagePreview.capped && (
                          <> · capped at 1,000 sends for safety</>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => previewAdminMessage.mutate()}
                        disabled={previewAdminMessage.isPending}
                      >
                        Preview recipients
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (
                            !confirm(
                              `Send this email to the currently filtered opted-in recipients?`,
                            )
                          ) {
                            return;
                          }
                          sendAdminMessage.mutate();
                        }}
                        disabled={
                          sendAdminMessage.isPending ||
                          messageSubject.trim().length < 4 ||
                          messageBody.trim().length < 10
                        }
                      >
                        Send message
                      </Button>
                    </div>
                  </div>
                )}
                <div className="space-y-3 mt-3">
                  {!usersLoading && !usersError && users.length === 0 && (
                    <div className="rounded-lg border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                      No users returned for this view yet.
                    </div>
                  )}
                  {filteredUsers.map((user: any) => (
                    <div
                      key={user.id}
                      className="flex flex-col gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex-1">
                        <div className="font-medium">
                          {user.firstName} {user.lastName}
                        </div>
                        {user.businessName && (
                          <div className="text-xs font-semibold text-amber-400 mt-0.5">
                            {user.businessName}
                          </div>
                        )}
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </div>
                        {user.phone && (
                          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                            <Phone className="w-3 h-3" />
                            {user.phone}
                          </div>
                        )}
                        {user.postalCode && (
                          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                            <MapPin className="w-3 h-3" />
                            {user.postalCode}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                          <span className="flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            Last active:{" "}
                            {user.lastActiveAt
                              ? new Date(user.lastActiveAt).toLocaleString()
                              : "No tracked activity"}
                          </span>
                          <span>
                            {Number(user.activityEventCount || 0)} tracked
                            events
                          </span>
                          <Badge variant="outline">
                            role:{toIdentityRole(user.userType)}
                          </Badge>
                          {isBusinessBearingUserType(user.userType) && (
                            <Badge variant="outline">
                              attachment:
                              {user.hasRestaurant
                                ? "attached"
                                : user.businessName
                                  ? "needs_business_shell"
                                  : "invalid_missing_business"}
                            </Badge>
                          )}
                          {user.hasRestaurant && (
                            <Badge variant="outline">
                              business:{String(user.businessType || "unknown")}
                            </Badge>
                          )}
                          <Badge variant="outline">
                            email:
                            {user.emailVerified ? "verified" : "unverified"}
                          </Badge>
                          {user.hasRestaurant && (
                            <Badge
                              variant={
                                user.businessIsVerified
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              business:
                              {user.businessIsVerified ? "verified" : "pending"}
                            </Badge>
                          )}
                          {user.hasRestaurant && (
                            <Badge
                              variant={
                                user.businessIsActive ? "default" : "secondary"
                              }
                            >
                              adminApproved:
                              {user.businessIsActive ? "yes" : "no"}
                            </Badge>
                          )}
                          {isBusinessBearingUserType(user.userType) &&
                            !user.hasRestaurant && (
                              <Badge variant="destructive">
                                {user.businessName
                                  ? "needs_business_shell"
                                  : "invalid_missing_business"}
                              </Badge>
                            )}
                        </div>
                      </div>
                      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex flex-col gap-2">
                          <select
                            value={user.userType}
                            onChange={(e) =>
                              updateUserType.mutate({
                                userId: user.id,
                                userType: e.target.value,
                              })
                            }
                            className="text-xs px-2 py-1 border rounded-md"
                            disabled={updateUserType.isPending || isStaff}
                          >
                            <option value="unknown">Needs review</option>
                            <option value="customer">Customer</option>
                            <option value="restaurant_owner">
                              Restaurant Owner
                            </option>
                            <option value="food_truck">Food Truck</option>
                            <option value="host">Host</option>
                            <option value="event_coordinator">
                              Event Coordinator
                            </option>
                            <option value="supplier">Supplier</option>
                            <option value="staff">Staff</option>
                            {isAdminFamilyUserType(adminUser?.userType) && (
                              <option value="admin">Admin</option>
                            )}
                            {isDuperOrRootUserType(adminUser?.userType) && (
                              <option value="duper_admin">Duper Admin</option>
                            )}
                            {isRootSuperAdminUserType(adminUser?.userType) && (
                              <option value="super_admin">Super Admin</option>
                            )}
                          </select>
                          {user.hasRestaurant &&
                            isBusinessUserType(user.userType) && (
                              <select
                                value={String(
                                  user.businessType || "restaurant",
                                )}
                                onChange={(e) =>
                                  updateUserBusinessType.mutate({
                                    restaurantId: String(
                                      user.restaurantId || "",
                                    ),
                                    businessType: e.target.value,
                                  })
                                }
                                className="text-xs px-2 py-1 border rounded-md"
                                disabled={
                                  updateUserBusinessType.isPending ||
                                  isStaff ||
                                  !user.restaurantId
                                }
                              >
                                {businessTypeOptions.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              resendVerificationEmail.mutate(user.id)
                            }
                            disabled={
                              resendVerificationEmail.isPending ||
                              isStaff ||
                              !user.email ||
                              user.emailVerified
                            }
                            data-testid={`button-resend-verify-${user.id}`}
                          >
                            <Mail className="w-3 h-3 mr-1" />
                            {user.emailVerified ? "Verified" : "Resend Verify"}
                          </Button>
                          {isAdminOrSuper && !user.emailVerified && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => verifyUserEmail.mutate(user.id)}
                              disabled={verifyUserEmail.isPending}
                              data-testid={`button-verify-user-${user.id}`}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Auto Verify
                            </Button>
                          )}
                          {isAdminOrSuper && user.hasRestaurant && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                verifyUserInsurance.mutate(user.id)
                              }
                              disabled={
                                verifyUserInsurance.isPending ||
                                user.insuranceVerified
                              }
                              data-testid={`button-verify-insurance-${user.id}`}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              {user.insuranceVerified
                                ? "Insurance Verified"
                                : "Verify Insurance"}
                            </Button>
                          )}
                          {canSendMonthlySubscriptionLink(user.userType) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                sendSubscriptionLink.mutate(user.id)
                              }
                              disabled={
                                sendSubscriptionLink.isPending ||
                                isStaff ||
                                !user.email
                              }
                              data-testid={`button-send-subscription-${user.id}`}
                            >
                              <DollarSign className="w-3 h-3 mr-1" />
                              Send Monthly Link
                            </Button>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const subject = window
                              .prompt("Message subject", "")
                              ?.trim();
                            if (!subject) return;
                            const body = window
                              .prompt("Message body", "")
                              ?.trim();
                            if (!body) return;
                            await sendIndividualAdminMessage.mutateAsync({
                              userId: user.id,
                              subject,
                              body,
                            });
                          }}
                          disabled={
                            sendIndividualAdminMessage.isPending || !user.email
                          }
                          data-testid={`button-message-user-${user.id}`}
                        >
                          <MessageSquare className="w-4 h-4 mr-1" />
                          Message
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedUser(user);
                            setUserDetailsOpen(true);
                            if (
                              isBusinessUserType(user.userType) &&
                              !user.hasRestaurant
                            ) {
                              setAttachBusinessSearch("");
                              setAttachBusinessSelectedId("");
                            }
                          }}
                          data-testid={`button-view-user-${user.id}`}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Details
                        </Button>
                        {isBusinessUserType(user.userType) &&
                          !user.hasRestaurant && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedUser(user);
                                  setUserDetailsOpen(true);
                                  setAttachBusinessSearch("");
                                  setAttachBusinessSelectedId("");
                                }}
                                data-testid={`button-attach-business-${user.id}`}
                              >
                                Attach Business
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  createAndAttachBusinessForUser.mutate({
                                    userId: user.id,
                                    businessName:
                                      String(user.businessName || "").trim() ||
                                      `${String(user.firstName || "").trim()} ${String(user.lastName || "").trim()}`.trim() ||
                                      "Business Profile",
                                    address: "Address pending",
                                    city: String(
                                      user.defaultCity || "Unknown",
                                    ).trim(),
                                    state: String(
                                      user.defaultState || "NA",
                                    ).trim(),
                                    phone:
                                      String(user.phone || "").trim() ||
                                      undefined,
                                  })
                                }
                                data-testid={`button-create-business-shell-${user.id}`}
                                disabled={
                                  createAndAttachBusinessForUser.isPending
                                }
                              >
                                Create Business Shell
                              </Button>
                            </>
                          )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openAdminUserProfile(user.id, true)}
                          data-testid={`button-open-user-profile-${user.id}`}
                        >
                          <ExternalLink className="w-4 h-4 mr-1" />
                          Open Admin
                        </Button>
                        {!isStaff && (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={!user.isDisabled}
                              onCheckedChange={(checked) =>
                                toggleUserStatus.mutate({
                                  userId: user.id,
                                  isActive: checked,
                                })
                              }
                              data-testid={`switch-user-${user.id}`}
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Are you sure you want to permanently delete ${user.firstName} ${user.lastName}? This cannot be undone.`,
                                  )
                                ) {
                                  deleteUser.mutate(user.id);
                                }
                              }}
                              disabled={deleteUser.isPending}
                            >
                              <UserMinus className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quarantine" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Profile Quarantine Review</CardTitle>
                <CardDescription>
                  Review suspect profiles and why trust/media fields are hidden
                  on public pages.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {quarantineLoading && (
                  <div className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
                    Loading quarantined profiles...
                  </div>
                )}

                {quarantineError && (
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs flex items-center justify-between gap-2">
                    <span>
                      Failed to load quarantine suspects.{" "}
                      {String((quarantineError as any)?.message || "").trim() ||
                        "Please retry."}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetchQuarantine()}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {!quarantineLoading &&
                  !quarantineError &&
                  quarantineSuspects.length === 0 && (
                    <div className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
                      No suspect profiles in quarantine right now.
                    </div>
                  )}

                {!quarantineLoading &&
                  !quarantineError &&
                  quarantineSuspects.length > 0 && (
                    <div className="space-y-3">
                      {quarantineSuspects.map((profile) => (
                        <div
                          key={profile.id}
                          className="rounded-lg border p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-medium">
                                {profile.name || "Unnamed business"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                ID: {profile.id}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="secondary">
                                {toTitleCase(
                                  profile.businessType ||
                                    (profile.isFoodTruck
                                      ? "food_truck"
                                      : "restaurant"),
                                )}
                              </Badge>
                              <Badge
                                variant={
                                  profile.isActive ? "default" : "outline"
                                }
                              >
                                {profile.isActive ? "active" : "inactive"}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[profile.city, profile.state]
                              .filter(Boolean)
                              .join(", ") || "Location unknown"}
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs font-semibold">
                              Quarantine reasons
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(profile.reasons || []).length > 0 ? (
                                (profile.reasons || []).map((reason) => (
                                  <Badge key={reason} variant="outline">
                                    {toTitleCase(reason)}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No explicit reason provided.
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-xs font-semibold">
                              Hidden public fields
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(profile.hiddenFields || []).length > 0 ? (
                                (profile.hiddenFields || []).map((field) => (
                                  <Badge key={field} variant="outline">
                                    {toTitleCase(field)}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No hidden field summary provided.
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Hard identity anchor:{" "}
                            <span className="font-medium">
                              {profile.hasHardIdentityAnchor ? "yes" : "no"}
                            </span>{" "}
                            • Trust fields hidden:{" "}
                            <span className="font-medium">
                              {profile.hidePublicTrustFields ? "yes" : "no"}
                            </span>{" "}
                            • Media hidden:{" "}
                            <span className="font-medium">
                              {profile.hideMedia ? "yes" : "no"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Staff Tab (Admin Only) */}
          <TabsContent value="staff" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Staff Management</CardTitle>
                <CardDescription>
                  Promote users to staff role or remove staff access
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StaffManagementTab />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Deals Tab */}
          <TabsContent value="deals" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Deal Management</CardTitle>
                <CardDescription>
                  View, edit, and manage all deals
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {deals.map((deal: any) => (
                    <div
                      key={deal.id}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="font-medium text-lg">
                            {deal.title}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {deal.restaurant?.name} - {deal.discountValue}% off
                            - Ends {new Date(deal.endDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={deal.isActive ? "default" : "secondary"}
                          >
                            {deal.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {deal.isFeatured && (
                            <Badge variant="outline">Featured</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Activity className="w-4 h-4" />
                            {deal.currentUses || 0} uses
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {deal.startTime} - {deal.endTime}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedDeal(deal);
                              setDealDetailsOpen(true);
                            }}
                            data-testid={`button-view-deal-${deal.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Details
                          </Button>

                          <Link href={`/deal-edit/${deal.id}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-edit-deal-${deal.id}`}
                            >
                              <Settings className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                          </Link>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cloneDeal.mutate(deal.id)}
                            disabled={cloneDeal.isPending}
                            data-testid={`button-clone-deal-${deal.id}`}
                          >
                            <Package className="w-4 h-4 mr-1" />
                            Clone
                          </Button>

                          <Switch
                            checked={deal.isActive}
                            onCheckedChange={(checked) =>
                              toggleDealStatus.mutate({
                                dealId: deal.id,
                                isActive: checked,
                              })
                            }
                            data-testid={`switch-deal-active-${deal.id}`}
                          />

                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Are you sure you want to delete this deal? This action cannot be undone.",
                                )
                              ) {
                                deleteDeal.mutate(deal.id);
                              }
                            }}
                            disabled={deleteDeal.isPending}
                            data-testid={`button-delete-deal-${deal.id}`}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Verifications Tab */}
          <TabsContent value="verifications" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Business Verification Requests</span>
                </CardTitle>
                <CardDescription>
                  Review and approve restaurant verification documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    value={verificationSearch}
                    onChange={(e) => setVerificationSearch(e.target.value)}
                    placeholder="Search business, email, address, status"
                    className="text-xs px-2 py-1 border rounded-md bg-background sm:min-w-[320px]"
                  />
                  <div className="text-xs text-muted-foreground">
                    {filteredVerificationRequests.length} visible
                    {verificationSearch.trim()
                      ? ` (filtered from ${verificationRequests.length})`
                      : ""}
                  </div>
                </div>
                {loadingVerifications ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : filteredVerificationRequests.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground">
                    <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {verificationSearch.trim()
                        ? "No verification requests match your search"
                        : "No verification requests found"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredVerificationRequests.map((request: any) => {
                      const documentCount = Array.isArray(request.documents)
                        ? request.documents.filter(
                            (doc: unknown) =>
                              typeof doc === "string" && doc.trim().length > 0,
                          ).length
                        : 0;
                      const missingDocuments = documentCount === 0;
                      return (
                        <div key={request.id} className="border rounded-lg p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="font-semibold text-lg">
                                {request.restaurant?.name}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {request.restaurant?.address}
                              </p>
                            </div>
                            <Badge
                              variant={
                                request.status === "pending"
                                  ? "secondary"
                                  : request.status === "approved"
                                    ? "default"
                                    : "destructive"
                              }
                              className="flex items-center space-x-1"
                            >
                              {request.status === "pending" && (
                                <Clock className="w-3 h-3" />
                              )}
                              {request.status === "approved" && (
                                <CheckCircle className="w-3 h-3" />
                              )}
                              {request.status === "rejected" && (
                                <XCircle className="w-3 h-3" />
                              )}
                              <span className="capitalize">
                                {request.status}
                              </span>
                            </Badge>
                          </div>

                          <div className="mb-4">
                            <p className="text-sm text-muted-foreground mb-2">
                              Submitted:{" "}
                              {new Date(
                                request.submittedAt,
                              ).toLocaleDateString()}
                            </p>
                            {request.documents && documentCount > 0 && (
                              <div>
                                <p className="text-sm font-medium mb-2">
                                  Documents ({documentCount}):
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {request.documents.map(
                                    (doc: string, index: number) => (
                                      <div key={index} className="relative">
                                        {doc.startsWith("data:image") ? (
                                          <img
                                            src={doc}
                                            alt={`Document ${index + 1}`}
                                            className="w-20 h-20 object-cover rounded cursor-pointer border"
                                            onClick={() =>
                                              window.open(doc, "_blank")
                                            }
                                            data-testid={`img-document-${request.id}-${index}`}
                                          />
                                        ) : (
                                          <div
                                            className="w-20 h-20 bg-[var(--bg-surface-muted)] rounded flex items-center justify-center cursor-pointer border"
                                            onClick={() =>
                                              window.open(doc, "_blank")
                                            }
                                            data-testid={`doc-document-${request.id}-${index}`}
                                          >
                                            <i className="fas fa-file-pdf text-2xl text-[color:var(--status-error)]"></i>
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                            {missingDocuments && (
                              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                                Missing verification documents. Reject and ask
                                the business to resubmit with files.
                              </div>
                            )}
                          </div>

                          {request.rejectionReason && (
                            <div className="mb-4 p-3 bg-destructive/10 rounded-md">
                              <p className="text-sm font-medium text-destructive mb-1">
                                Rejection Reason:
                              </p>
                              <p className="text-sm text-destructive">
                                {request.rejectionReason}
                              </p>
                            </div>
                          )}

                          {request.status === "pending" && (
                            <div className="flex items-center space-x-2">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() =>
                                  approveVerification.mutate(request.id)
                                }
                                disabled={
                                  approveVerification.isPending ||
                                  missingDocuments
                                }
                                data-testid={`button-approve-verification-${request.id}`}
                                className="flex items-center space-x-1"
                              >
                                <CheckCircle className="w-4 h-4" />
                                <span>Approve</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  const reason = window.prompt(
                                    "Please provide a reason for rejection:",
                                  );
                                  if (reason && reason.trim()) {
                                    rejectVerification.mutate({
                                      requestId: request.id,
                                      reason: reason.trim(),
                                    });
                                  }
                                }}
                                disabled={rejectVerification.isPending}
                                data-testid={`button-reject-verification-${request.id}`}
                                className="flex items-center space-x-1"
                              >
                                <XCircle className="w-4 h-4" />
                                <span>Reject</span>
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manual Onboarding Tab */}
          <TabsContent value="onboarding" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Create User Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Provision User + Business Access
                  </CardTitle>
                  <CardDescription>
                    Users are people accounts. Businesses are separate entities.
                    Provisioning creates the right account and, for business
                    owners, the linked business shell and access relationship.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ManualUserCreation adminUser={adminUser} />
                </CardContent>
              </Card>

              <TruckImportPanel enabled={selectedTab === "onboarding"} />
            </div>
            <ProfileEvidenceApplyPanel enabled={selectedTab === "onboarding"} />
          </TabsContent>

          {/* Admin Uploads Tab */}
          <TabsContent value="imports" className="space-y-4">
            <UnclaimedImportedTrucksTab enabled={selectedTab === "imports"} />
          </TabsContent>

          {/* Host Locations Tab */}
          <TabsContent value="host-locations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Manage Host Locations
                </CardTitle>
                <CardDescription>
                  View and update geocoded locations for existing hosts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HostLocationManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="share-portal" className="space-y-4">
            <ShareHub
              mode="admin"
              title="Share Portal"
              description="One-click growth and onboarding links for owners, food trucks, and host-location partners."
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* User Details Dialog */}
      <Dialog open={userDetailsOpen} onOpenChange={setUserDetailsOpen}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Users className="w-5 h-5" />
              <span>User Details</span>
            </DialogTitle>
            <DialogDescription>
              Account identity, recovery, linked entities, and support actions
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6 mt-4">
              {/* Edit User */}
              {!isStaff && userEdits && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Settings className="w-4 h-4 mr-2" />
                    EDIT USER
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <input
                        type="email"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.email}
                        onChange={(e) =>
                          setUserEdits({ ...userEdits, email: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">User Type</p>
                      <select
                        className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                        value={userEdits.userType}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            userType: e.target.value,
                          })
                        }
                      >
                        <option value="unknown">Needs review</option>
                        <option value="customer">Customer</option>
                        <option value="food_truck">Food Truck</option>
                        <option value="restaurant_owner">
                          Restaurant Owner
                        </option>
                        <option value="host">Host</option>
                        <option value="event_coordinator">
                          Event Coordinator
                        </option>
                        <option value="supplier">Supplier</option>
                        <option value="staff">Staff</option>
                        {isAdminFamilyUserType(adminUser?.userType) && (
                          <option value="admin">Admin</option>
                        )}
                        {isDuperOrRootUserType(adminUser?.userType) && (
                          <option value="duper_admin">Duper Admin</option>
                        )}
                        {isRootSuperAdminUserType(adminUser?.userType) && (
                          <option value="super_admin">Super Admin</option>
                        )}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        First Name
                      </p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.firstName}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            firstName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Last Name</p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.lastName}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            lastName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.phone}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            phone: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Postal Code
                      </p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.postalCode}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            postalCode: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Birth Year
                      </p>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.birthYear}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            birthYear: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Gender</p>
                      <select
                        className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                        value={userEdits.gender}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            gender: e.target.value,
                          })
                        }
                      >
                        <option value="">Unspecified</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="non_binary">Non-binary</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Active
                      </label>
                      <Switch
                        checked={!!userEdits.isActive}
                        onCheckedChange={(checked) =>
                          setUserEdits({ ...userEdits, isActive: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Email Verified
                      </label>
                      <Switch
                        checked={!!userEdits.emailVerified}
                        onCheckedChange={(checked) =>
                          setUserEdits({
                            ...userEdits,
                            emailVerified: checked,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateUserInfo.mutate({
                          userId: selectedUser.id,
                          updates: userEdits,
                        })
                      }
                      disabled={updateUserInfo.isPending || isStaff}
                      data-testid="button-save-user"
                    >
                      Save User Changes
                    </Button>
                  </div>
                </div>
              )}
              {/* Basic Information */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Users className="w-4 h-4 mr-2" />
                  ACCOUNT IDENTITY
                </h3>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openAdminUserProfile(selectedUser.id, true)}
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Open Admin User View
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p className="font-medium">
                      {selectedUser.firstName} {selectedUser.lastName}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">User Type</p>
                    <Badge
                      variant={
                        selectedUser.userType === "admin" ||
                        selectedUser.userType === "duper_admin" ||
                        selectedUser.userType === "super_admin"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {selectedUser.userType}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {selectedUser.email}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">User ID</p>
                    <p className="text-xs font-mono break-all">
                      {selectedUser.id}
                    </p>
                  </div>
                  <div className="space-y-2 col-span-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">
                        Affiliate Management
                      </p>
                      <Badge variant="outline">
                        {isAffiliateEligibleUserType(selectedUser.userType)
                          ? selectedUser.affiliateTag
                            ? "Affiliate active"
                            : "No affiliate link"
                          : "Internal account"}
                      </Badge>
                    </div>
                    {(() => {
                      if (!isAffiliateEligibleUserType(selectedUser.userType)) {
                        return (
                          <p className="text-sm text-muted-foreground">
                            Not applicable for internal admin accounts.
                          </p>
                        );
                      }
                      const rawAffiliateToken = String(
                        selectedUser.affiliateTag || "",
                      ).trim();
                      const affiliateLink = buildCanonicalAffiliateLink(
                        selectedUser.affiliateTag,
                        selectedUser,
                        Array.isArray(userRestaurants) && userRestaurants.length > 0
                          ? userRestaurants[0]
                          : null,
                        Array.isArray(userHosts) && userHosts.length > 0
                          ? userHosts[0]
                          : null,
                      );
                      const slugGovernanceTarget =
                        (Array.isArray(userRestaurants) && userRestaurants[0]) ||
                        (Array.isArray(userHosts) && userHosts[0]) ||
                        null;
                      return (
                        <div className="space-y-3">
                          <div className="grid gap-2 rounded-md border bg-muted/30 p-2 text-xs sm:grid-cols-2">
                            <div>
                              <p className="text-muted-foreground">Public slug</p>
                              <p className="font-mono">
                                {String(slugGovernanceTarget?.cleanBusinessPath || "")
                                  .replace(/^\/+/, "") || "Unassigned"}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Slug status</p>
                              <Badge variant="outline">
                                {slugGovernanceTarget?.publicSlugStatus || "unassigned"}
                              </Badge>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              Affiliate Link
                            </p>
                            {affiliateLink ? (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <p className="text-xs font-mono break-all">
                                  {affiliateLink}
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={async () => {
                                      await navigator.clipboard.writeText(
                                        affiliateLink,
                                      );
                                      toast({ title: "Affiliate link copied" });
                                    }}
                                    data-testid={`button-copy-affiliate-link-${selectedUser.id}`}
                                  >
                                    <Copy className="w-3 h-3 mr-1" />
                                    Copy Link
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      window.open(
                                        affiliateLink,
                                        "_blank",
                                        "noopener,noreferrer",
                                      )
                                    }
                                    data-testid={`button-open-affiliate-link-${selectedUser.id}`}
                                  >
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    Open Link
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No affiliate link assigned
                              </p>
                            )}
                          </div>
                          {rawAffiliateToken && (
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Internal token
                              </p>
                              <p className="text-xs font-mono text-muted-foreground break-all">
                                {rawAffiliateToken}
                              </p>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Commission Percent
                              </p>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                value={affiliateEdits?.affiliatePercent ?? ""}
                                onChange={(event) =>
                                  setAffiliateEdits({
                                    ...affiliateEdits,
                                    affiliatePercent: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Closer User ID
                              </p>
                              <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                value={
                                  affiliateEdits?.affiliateCloserUserId ?? ""
                                }
                                onChange={(event) =>
                                  setAffiliateEdits({
                                    ...affiliateEdits,
                                    affiliateCloserUserId: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Booker User ID
                              </p>
                              <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                value={
                                  affiliateEdits?.affiliateBookerUserId ?? ""
                                }
                                onChange={(event) =>
                                  setAffiliateEdits({
                                    ...affiliateEdits,
                                    affiliateBookerUserId: event.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                isStaff ||
                                updateUserAffiliateSettings.isPending ||
                                !affiliateEdits
                              }
                              onClick={() =>
                                updateUserAffiliateSettings.mutate({
                                  userId: selectedUser.id,
                                  updates: {
                                    affiliatePercent: Number(
                                      affiliateEdits?.affiliatePercent ?? 5,
                                    ),
                                    affiliateCloserUserId:
                                      affiliateEdits?.affiliateCloserUserId ||
                                      null,
                                    affiliateBookerUserId:
                                      affiliateEdits?.affiliateBookerUserId ||
                                      null,
                                  },
                                })
                              }
                              data-testid={`button-save-affiliate-settings-${selectedUser.id}`}
                            >
                              {updateUserAffiliateSettings.isPending
                                ? "Saving..."
                                : "Save Affiliate Settings"}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Tag creation, regeneration, and removal are not
                              supported by the current backend.
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {(selectedUser.affiliateCloserUserId ||
                    selectedUser.affiliateBookerUserId) && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Referral Attribution
                      </p>
                      <div className="text-sm space-y-1">
                        {selectedUser.affiliateCloserUserId && (
                          <div>
                            <span className="text-xs text-muted-foreground">
                              Ref link (closer):{" "}
                            </span>
                            {(() => {
                              const ref = userById.get(
                                String(selectedUser.affiliateCloserUserId),
                              );
                              const label = ref
                                ? `${ref.firstName || ""} ${ref.lastName || ""}`.trim() ||
                                  ref.email ||
                                  ref.id
                                : String(selectedUser.affiliateCloserUserId);
                              const tag = ref?.affiliateTag
                                ? ` (ref=${ref.affiliateTag})`
                                : "";
                              return (
                                <span>
                                  {label}
                                  {tag}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                        {selectedUser.affiliateBookerUserId && (
                          <div>
                            <span className="text-xs text-muted-foreground">
                              Booker affiliate:{" "}
                            </span>
                            {(() => {
                              const ref = userById.get(
                                String(selectedUser.affiliateBookerUserId),
                              );
                              const label = ref
                                ? `${ref.firstName || ""} ${ref.lastName || ""}`.trim() ||
                                  ref.email ||
                                  ref.id
                                : String(selectedUser.affiliateBookerUserId);
                              const tag = ref?.affiliateTag
                                ? ` (ref=${ref.affiliateTag})`
                                : "";
                              return (
                                <span>
                                  {label}
                                  {tag}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedUser.phone && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="text-sm flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {selectedUser.phone}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Account Created
                    </p>
                    <p className="text-sm">
                      {selectedUser.createdAt
                        ? new Date(selectedUser.createdAt).toLocaleString()
                        : "Unknown"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Last Active</p>
                    <p className="text-sm">
                      {userActivity?.summary?.lastActiveAt
                        ? new Date(
                            userActivity.summary.lastActiveAt,
                          ).toLocaleString()
                        : selectedUser.lastActiveAt
                          ? new Date(selectedUser.lastActiveAt).toLocaleString()
                          : "No tracked activity yet"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Email Verified
                    </p>
                    <Badge
                      variant={
                        selectedUser.emailVerified ? "default" : "secondary"
                      }
                    >
                      {selectedUser.emailVerified ? "Verified" : "Not Verified"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Account Status
                    </p>
                    <Badge
                      variant={
                        !selectedUser.isDisabled ? "default" : "destructive"
                      }
                    >
                      {!selectedUser.isDisabled ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  PUBLIC + SUPPORT LINKS
                </h3>
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        openAdminUserProfile(selectedUser.id, true)
                      }
                    >
                      <ExternalLink className="w-4 h-4 mr-1" />
                      Open Admin User View
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Internal operator link only.
                    </p>
                  </div>

                  {selectedUserPublicProfileUrl ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Public Profile Link
                      </p>
                      <p className="text-xs font-mono break-all">
                        {selectedUserPublicProfileUrl}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              selectedUserPublicProfileUrl,
                            );
                            toast({ title: "Public profile link copied" });
                          }}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy Public Link
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              selectedUserPublicProfileUrl,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          Open Public Link
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Public profile link is not currently supported for this
                      account type.
                    </p>
                  )}

                  {String(selectedUser?.userType || "").toLowerCase() ===
                    "customer" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href="/scout">
                        <Button size="sm" variant="outline">
                          Scout as a diner
                        </Button>
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        Customer accounts use discovery and customer surfaces.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Location & Demographics */}
              {(selectedUser.postalCode ||
                selectedUser.birthYear ||
                selectedUser.gender) && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    LOCATION & DEMOGRAPHICS
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedUser.postalCode && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Postal Code
                        </p>
                        <p className="text-sm flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {selectedUser.postalCode}
                        </p>
                      </div>
                    )}
                    {selectedUser.birthYear && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Birth Year
                        </p>
                        <p className="text-sm">{selectedUser.birthYear}</p>
                      </div>
                    )}
                    {selectedUser.gender && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Gender</p>
                        <p className="text-sm capitalize">
                          {selectedUser.gender}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subscription Information */}
              {(selectedUser.stripeCustomerId ||
                selectedUser.stripeSubscriptionId) && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <CreditCard className="w-4 h-4 mr-2" />
                    SUBSCRIPTION
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedUser.stripeCustomerId && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Stripe Customer ID
                        </p>
                        <p className="text-sm font-mono text-xs">
                          {selectedUser.stripeCustomerId}
                        </p>
                      </div>
                    )}
                    {selectedUser.stripeSubscriptionId && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Subscription ID
                        </p>
                        <p className="text-sm font-mono text-xs">
                          {selectedUser.stripeSubscriptionId}
                        </p>
                      </div>
                    )}
                    {selectedUser.subscriptionBillingInterval && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Billing Interval
                        </p>
                        <Badge variant="outline">
                          {selectedUser.subscriptionBillingInterval}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Account Recovery */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Shield className="w-4 h-4 mr-2" />
                  ACCOUNT RECOVERY
                </h3>
                <div
                  className="space-y-3 rounded-md border p-3"
                  data-testid={`account-recovery-status-${selectedUser.id}`}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Auth Provider
                      </p>
                      <Badge variant="outline">
                        {getSafeAuthProviderLabel(selectedUser)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Password Login
                      </p>
                      <Badge
                        variant={
                          selectedUser.hasPasswordLogin
                            ? "default"
                            : "secondary"
                        }
                      >
                        {selectedUser.hasPasswordLogin
                          ? "Enabled"
                          : "Not enabled"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Force Reset
                      </p>
                      <Badge
                        variant={
                          selectedUser.requiresPasswordReset
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {selectedUser.requiresPasswordReset ? "Required" : "No"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Email Verified
                      </p>
                      <Badge
                        variant={
                          selectedUser.emailVerified ? "default" : "secondary"
                        }
                      >
                        {selectedUser.emailVerified ? "Yes" : "No"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        sendPasswordResetLink.mutate(selectedUser.id)
                      }
                      disabled={
                        sendPasswordResetLink.isPending ||
                        isStaff ||
                        !selectedUser.email ||
                        !selectedUser.hasPasswordLogin
                      }
                      data-testid={`button-send-password-reset-${selectedUser.id}`}
                    >
                      <Mail className="w-3 h-3 mr-1" />
                      Send Password Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => forcePasswordReset.mutate(selectedUser.id)}
                      disabled={
                        forcePasswordReset.isPending ||
                        isStaff ||
                        !selectedUser.hasPasswordLogin ||
                        selectedUser.requiresPasswordReset
                      }
                      data-testid={`button-force-password-reset-${selectedUser.id}`}
                    >
                      <Shield className="w-3 h-3 mr-1" />
                      Force Password Reset
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        resendVerificationEmail.mutate(selectedUser.id)
                      }
                      disabled={
                        resendVerificationEmail.isPending ||
                        isStaff ||
                        !selectedUser.email ||
                        selectedUser.emailVerified
                      }
                      data-testid={`button-card-resend-verification-${selectedUser.id}`}
                    >
                      <Mail className="w-3 h-3 mr-1" />
                      {selectedUser.emailVerified
                        ? "Email Verified"
                        : "Resend Verification"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Passwords, password hashes, reset tokens, OAuth tokens, and
                    session secrets are never shown here.
                  </p>
                </div>
              </div>

              {/* Account Activity */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  ACCOUNT ACTIVITY
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Account Created
                    </p>
                    <p className="text-sm">
                      {new Date(selectedUser.createdAt).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </p>
                  </div>
                  {selectedUser.updatedAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Last Updated
                      </p>
                      <p className="text-sm">
                        {new Date(selectedUser.updatedAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Last Active</p>
                    <p className="text-sm">
                      {userActivity?.summary?.lastActiveAt
                        ? new Date(
                            userActivity.summary.lastActiveAt,
                          ).toLocaleString()
                        : selectedUser.lastActiveAt
                          ? new Date(selectedUser.lastActiveAt).toLocaleString()
                          : "No tracked activity yet"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Activity Volume
                    </p>
                    <p className="text-sm">
                      {Number(
                        userActivity?.summary?.totalEvents ??
                          selectedUser.activityEventCount ??
                          0,
                      )}{" "}
                      total / {Number(userActivity?.summary?.eventsLast7d ?? 0)}{" "}
                      last 7d
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Recent verification/reset email delivery attempts are not
                  currently exposed by a dedicated admin endpoint.
                </p>
                {Array.isArray(userActivity?.signalSummary) &&
                  userActivity.signalSummary.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Preference and conversation signals
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {userActivity.signalSummary
                          .slice(0, 9)
                          .map((signal: any) => (
                            <div
                              key={signal.key}
                              className="rounded-lg border bg-muted/20 p-3"
                            >
                              <p className="text-sm font-semibold capitalize">
                                {signal.key}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {Number(signal.count || 0)} tracked
                                {signal.lastSeenAt
                                  ? ` · last ${new Date(
                                      signal.lastSeenAt,
                                    ).toLocaleString()}`
                                  : ""}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(userActivity?.journeySummary) &&
                  userActivity.journeySummary.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Journey summary
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {userActivity.journeySummary
                          .slice(0, 10)
                          .map((journey: any) => (
                            <Badge key={journey.category} variant="secondary">
                              {journey.category}: {journey.count}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(userActivity?.eventCounts) &&
                  userActivity.eventCounts.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Top activity types
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {userActivity.eventCounts
                          .slice(0, 8)
                          .map((event: any) => (
                            <Badge key={event.eventName} variant="outline">
                              {event.eventName}: {event.count}
                            </Badge>
                          ))}
                      </div>
                    </div>
                  )}
                {Array.isArray(userActivity?.recentEvents) &&
                  userActivity.recentEvents.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Recent activity history
                      </p>
                      <div className="max-h-72 overflow-y-auto rounded-lg border">
                        {userActivity.recentEvents
                          .slice(0, 30)
                          .map((event: any) => {
                            const props =
                              event.properties &&
                              typeof event.properties === "object"
                                ? event.properties
                                : {};
                            const detail = [
                              props.surface,
                              props.layerId,
                              props.restaurantId,
                              props.itemId,
                              props.action,
                            ]
                              .filter(Boolean)
                              .slice(0, 3)
                              .join(" · ");
                            return (
                              <div
                                key={event.id}
                                className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {event.eventName}
                                  </p>
                                  {detail && (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {detail}
                                    </p>
                                  )}
                                </div>
                                <p className="shrink-0 text-xs text-muted-foreground">
                                  {event.createdAt
                                    ? new Date(event.createdAt).toLocaleString()
                                    : ""}
                                </p>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                {selectedUserIdentity && (
                  <div className="mt-4 rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Identity Resolver
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline">
                        Role: {selectedUserIdentity.userRole}
                      </Badge>
                      <Badge variant="outline">
                        Business intent:{" "}
                        {selectedUserIdentity.businessTypeIntent}
                      </Badge>
                      <Badge
                        variant={
                          selectedUserIdentity.attachmentState === "attached" ||
                          selectedUserIdentity.attachmentState ===
                            "not_required"
                            ? "default"
                            : "destructive"
                        }
                      >
                        Business attachment:{" "}
                        {selectedUserIdentity.attachmentState}
                      </Badge>
                      <Badge variant="outline">
                        Onboarding signal: {selectedUserIdentity.signalIntent}
                      </Badge>
                      <Badge variant="outline">
                        Email:{" "}
                        {selectedUser?.emailVerified
                          ? "verified"
                          : "unverified"}
                      </Badge>
                      <Badge variant="outline">
                        Business verification:{" "}
                        {selectedUser?.businessIsVerified
                          ? "verified"
                          : "pending"}
                      </Badge>
                      <Badge variant="outline">
                        Insurance:{" "}
                        {selectedUser?.insuranceVerified
                          ? "verified"
                          : "unknown"}
                        {selectedUser?.insuranceExpiresAt
                          ? ` until ${new Date(selectedUser.insuranceExpiresAt).toLocaleDateString()}`
                          : ""}
                      </Badge>
                      <Badge variant="outline">
                        Admin approved:{" "}
                        {selectedUser?.businessIsActive ? "yes" : "no"}
                      </Badge>
                    </div>
                    {selectedUserIdentity.conflict && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                        Conflict detected: account role intent (
                        {selectedUserIdentity.roleIntent}) does not match
                        onboarding signal ({selectedUserIdentity.signalIntent}).
                        Resolve business type intent before continuing.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Store className="w-4 h-4 mr-2" />
                  LINKED ENTITIES
                </h3>
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      Restaurants/Trucks: {userRestaurants.length}
                    </Badge>
                    <Badge variant="outline">Hosts: {userHosts.length}</Badge>
                    <Badge variant="outline">
                      Parking Pass Listings: {parkingPasses.length}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Relationship context:{" "}
                    {String(selectedUser?.userType || "unknown")} account
                    {isBusinessUserType(selectedUser?.userType)
                      ? userRestaurants.length > 0
                        ? " is linked to a business profile."
                        : " requires business linkage for owner tooling."
                      : " does not require business linkage by default."}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {String(selectedUser?.userType || "").toLowerCase() ===
                      "food_truck" && (
                      <>
                        <Link href="/restaurant-owner-dashboard?setup=schedule">
                          <Button size="sm" variant="outline">
                            Open Truck Setup Target
                          </Button>
                        </Link>
                        <Link href="/parking-pass">
                          <Button size="sm" variant="outline">
                            Open Parking Pass
                          </Button>
                        </Link>
                        <p className="text-xs text-muted-foreground w-full">
                          Food truck accounts use truck setup and public Parking
                          Pass flows, not host-only management.
                        </p>
                      </>
                    )}
                    {String(selectedUser?.userType || "").toLowerCase() ===
                      "host" && (
                      <>
                        <Link href="/host/dashboard">
                          <Button size="sm" variant="outline">
                            Open Host Dashboard
                          </Button>
                        </Link>
                        <p className="text-xs text-muted-foreground w-full">
                          Host management remains host/account-bound.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Saved Addresses */}
              {selectedUser?.userType !== "host" && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    SAVED ADDRESSES ({userAddresses.length})
                  </h3>
                  <div className="space-y-3">
                    {userAddresses.map((address: any) => {
                      const edits = addressEdits[address.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={address.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize">
                                {address.type}
                              </Badge>
                              {address.isDefault && (
                                <Badge variant="default" className="text-xs">
                                  Default
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setDefaultAddress.mutate({
                                    userId: selectedUser.id,
                                    addressId: address.id,
                                  })
                                }
                                disabled={isStaff}
                              >
                                Set Default
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  deleteAddress.mutate({
                                    userId: selectedUser.id,
                                    addressId: address.id,
                                  })
                                }
                                disabled={isStaff}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Label"
                              value={edits.label}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    label: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.type}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    type: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="home">Home</option>
                              <option value="work">Work</option>
                              <option value="other">Other</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Address"
                              value={edits.address}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    address: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="City"
                              value={edits.city}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    city: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="State"
                              value={edits.state}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    state: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Postal Code"
                              value={edits.postalCode}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    postalCode: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateAddress.mutate({
                                  userId: selectedUser.id,
                                  addressId: address.id,
                                  updates: edits,
                                })
                              }
                              disabled={isStaff}
                            >
                              Save Address
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="border rounded-lg p-3 space-y-3">
                      <div className="text-sm font-medium">Add New Address</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Label"
                          value={newAddress.label}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              label: e.target.value,
                            })
                          }
                        />
                        <select
                          className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                          value={newAddress.type}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              type: e.target.value,
                            })
                          }
                        >
                          <option value="home">Home</option>
                          <option value="work">Work</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Address"
                          value={newAddress.address}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              address: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="City"
                          value={newAddress.city}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              city: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="State"
                          value={newAddress.state}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              state: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Postal Code"
                          value={newAddress.postalCode}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              postalCode: e.target.value,
                            })
                          }
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={newAddress.isDefault}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              isDefault: e.target.checked,
                            })
                          }
                        />
                        Set as default
                      </label>
                      <Button
                        size="sm"
                        onClick={() =>
                          createAddress.mutate({
                            userId: selectedUser.id,
                            data: newAddress,
                          })
                        }
                        disabled={createAddress.isPending || isStaff}
                      >
                        Add Address
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {(selectedUser?.userType === "host" || userHosts.length > 0) && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  Parking Pass + Host Location editing lives in the{" "}
                  <span className="font-semibold">Host Locations</span> tab.
                </div>
              )}

              {isBusinessUserType(selectedUser?.userType) && (
                <div className="rounded-lg border p-3 space-y-3">
                  <h3 className="font-semibold flex items-center text-sm text-muted-foreground">
                    <Store className="w-4 h-4 mr-2" />
                    BUSINESS LINK
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Link state:</span>
                    <Badge
                      variant={
                        userRestaurants.length > 0 ? "default" : "destructive"
                      }
                    >
                      {userRestaurants.length > 0
                        ? "linked"
                        : "needs_business_shell"}
                    </Badge>
                  </div>

                  {userRestaurants.length === 0 &&
                    isDuperOrRootUserType(adminUser?.userType) && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Attach existing business, create a business shell, or
                          correct business type intent before continuing.
                        </p>
                        <select
                          value={businessIntentByUserId[selectedUser.id] || ""}
                          onChange={(e) =>
                            setBusinessIntentByUserId({
                              ...businessIntentByUserId,
                              [selectedUser.id]: e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                        >
                          <option value="">Select business type intent</option>
                          {businessTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const intent =
                              businessIntentByUserId[selectedUser.id] || "";
                            if (!intent) return;
                            updateUserType.mutate({
                              userId: selectedUser.id,
                              userType:
                                intent === "food_truck"
                                  ? "food_truck"
                                  : intent === "host_venue"
                                    ? "host"
                                    : intent === "supplier"
                                      ? "supplier"
                                      : "restaurant_owner",
                            });
                          }}
                          disabled={
                            updateUserType.isPending ||
                            !businessIntentByUserId[selectedUser.id]
                          }
                          data-testid={`button-correct-business-intent-${selectedUser.id}`}
                        >
                          Correct business type intent
                        </Button>
                        <input
                          value={attachBusinessSearch}
                          onChange={(e) =>
                            setAttachBusinessSearch(e.target.value)
                          }
                          placeholder="Search pending business name"
                          className="w-full px-2 py-1 border rounded-md text-sm"
                        />
                        <select
                          value={attachBusinessSelectedId}
                          onChange={(e) =>
                            setAttachBusinessSelectedId(e.target.value)
                          }
                          className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                        >
                          <option value="">Select restaurant/truck</option>
                          {attachBusinessCandidates
                            .filter((row: any) => {
                              const q = attachBusinessSearch
                                .trim()
                                .toLowerCase();
                              if (!q) return true;
                              const haystack =
                                `${row?.name || ""} ${row?.email || ""} ${row?.cuisineType || ""}`.toLowerCase();
                              return haystack.includes(q);
                            })
                            .slice(0, 50)
                            .map((row: any) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                                {row.email ? ` (${row.email})` : ""}
                              </option>
                            ))}
                        </select>
                        <LongPressHelp description="Connect this user account to the selected restaurant or truck profile.">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (!attachBusinessSelectedId) {
                                toast({
                                  title: "Select a business",
                                  description:
                                    "Choose a restaurant/truck before attaching.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              attachBusinessToUser.mutate({
                                userId: selectedUser.id,
                                restaurantId: attachBusinessSelectedId,
                              });
                            }}
                            disabled={attachBusinessToUser.isPending}
                            data-testid={`button-attach-selected-business-${selectedUser.id}`}
                          >
                            {attachBusinessToUser.isPending
                              ? "Attaching..."
                              : "Attach selected business"}
                          </Button>
                        </LongPressHelp>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const defaultAddress = (userAddresses.find(
                              (row: any) => row?.isDefault,
                            ) ||
                              userAddresses[0] ||
                              {}) as any;
                            const seedBusinessName =
                              String(selectedUser?.businessName || "").trim() ||
                              `${selectedUser?.firstName || ""} ${selectedUser?.lastName || ""}`.trim() ||
                              "";
                            const businessName = window
                              .prompt("Business name", seedBusinessName)
                              ?.trim();
                            if (!businessName) return;
                            const address = window
                              .prompt(
                                "Address",
                                String(defaultAddress?.address || "").trim(),
                              )
                              ?.trim();
                            if (!address) return;
                            const city = window
                              .prompt(
                                "City",
                                String(defaultAddress?.city || "").trim(),
                              )
                              ?.trim();
                            if (!city) return;
                            const state = window
                              .prompt(
                                "State",
                                String(defaultAddress?.state || "").trim(),
                              )
                              ?.trim();
                            if (!state) return;
                            createAndAttachBusinessForUser.mutate({
                              userId: selectedUser.id,
                              businessName,
                              address,
                              city,
                              state,
                              phone:
                                String(selectedUser?.phone || "").trim() ||
                                undefined,
                            });
                          }}
                          disabled={createAndAttachBusinessForUser.isPending}
                          data-testid={`button-create-business-from-user-${selectedUser.id}`}
                        >
                          {createAndAttachBusinessForUser.isPending
                            ? "Creating..."
                            : "Create business shell"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateUserType.mutate({
                              userId: selectedUser.id,
                              userType: "customer",
                            })
                          }
                          data-testid={`button-mark-customer-only-${selectedUser.id}`}
                          disabled={updateUserType.isPending}
                        >
                          Mark as customer only
                        </Button>
                      </div>
                    )}
                </div>
              )}

              {/* Restaurants */}
              {userRestaurants.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Store className="w-4 h-4 mr-2" />
                    RESTAURANTS ({userRestaurants.length})
                  </h3>
                  <div className="space-y-4">
                    {userRestaurants.map((restaurant: any) => {
                      const edits = restaurantEdits[restaurant.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={restaurant.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="text-sm font-medium">
                              {restaurant.name}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Link href={`/restaurant/${restaurant.id}`}>
                                <Button size="sm" variant="outline">
                                  View details
                                </Button>
                              </Link>
                              <Link
                                href={`/menu-builder?restaurantId=${encodeURIComponent(restaurant.id)}&src=admin-user`}
                              >
                                <Button size="sm" variant="outline">
                                  Edit menu
                                </Button>
                              </Link>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.name}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    name: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.address}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    address: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Phone"
                              value={edits.phone}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    phone: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Cuisine Type"
                              value={edits.cuisineType}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    cuisineType: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.businessType}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    businessType: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="restaurant">Restaurant</option>
                              <option value="bar">Bar</option>
                              <option value="food_truck">Food Truck</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Promo Code"
                              value={edits.promoCode}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    promoCode: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="City"
                              value={edits.city}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    city: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="State"
                              value={edits.state}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    state: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Description"
                              value={edits.description}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    description: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Website URL"
                              value={edits.websiteUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    websiteUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Instagram URL"
                              value={edits.instagramUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    instagramUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Facebook Page URL"
                              value={edits.facebookPageUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    facebookPageUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Amenities JSON"
                              value={edits.amenitiesText}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    amenitiesText: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isActive}
                                onChange={(e) =>
                                  setRestaurantEdits({
                                    ...restaurantEdits,
                                    [restaurant.id]: {
                                      ...edits,
                                      isActive: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Active
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isVerified}
                                onChange={(e) =>
                                  setRestaurantEdits({
                                    ...restaurantEdits,
                                    [restaurant.id]: {
                                      ...edits,
                                      isVerified: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Verified
                            </label>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              let amenities: any = undefined;
                              if (edits.amenitiesText) {
                                try {
                                  amenities = JSON.parse(edits.amenitiesText);
                                } catch {
                                  toast({
                                    title: "Invalid JSON",
                                    description:
                                      "Amenities must be valid JSON.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                              }
                              updateRestaurant.mutate({
                                restaurantId: restaurant.id,
                                updates: {
                                  ...edits,
                                  amenities,
                                },
                              });
                            }}
                            disabled={isStaff}
                          >
                            Save Restaurant
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deals */}
              {userDeals.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <DollarSign className="w-4 h-4 mr-2" />
                    DEALS ({userDeals.length})
                  </h3>
                  <div className="space-y-4">
                    {userDeals.map((deal: any) => {
                      const edits = dealEdits[deal.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={deal.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="text-sm font-medium">
                            {deal.title}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.title}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    title: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.dealType}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    dealType: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="percentage">Percentage</option>
                              <option value="fixed">Fixed</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Discount Value"
                              value={edits.discountValue}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    discountValue: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Min Order Amount"
                              value={edits.minOrderAmount}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    minOrderAmount: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Image URL"
                              value={edits.imageUrl}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    imageUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="date"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.startDate}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    startDate: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="date"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.endDate}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    endDate: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="time"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.startTime}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    startTime: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="time"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.endTime}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    endTime: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Description"
                              value={edits.description}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    description: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.availableDuringBusinessHours}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      availableDuringBusinessHours:
                                        e.target.checked,
                                    },
                                  })
                                }
                              />
                              Business Hours Only
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isOngoing}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      isOngoing: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Ongoing
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isActive}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      isActive: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Active
                            </label>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateDeal.mutate({
                                dealId: deal.id,
                                updates: edits,
                              })
                            }
                            disabled={isStaff}
                          >
                            Save Deal
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Profile Image */}
              {selectedUser.profileImageUrl && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Users className="w-4 h-4 mr-2" />
                    PROFILE IMAGE
                  </h3>
                  <img
                    src={getOptimizedImageUrl(
                      selectedUser.profileImageUrl,
                      "large",
                    )}
                    alt="Profile"
                    className="w-24 h-24 rounded-full object-cover border-2"
                    data-testid="img-user-profile"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              {/* Parking Pass Listings */}
              {parkingPasses.length > 0 && userHosts.length === 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    PARKING PASS LISTINGS ({parkingPasses.length})
                  </h3>
                  <div className="space-y-4">
                    {parkingPasses.map((pass: any) => {
                      const edits = parkingPassEdits[pass.id];
                      if (!edits) return null;
                      const hostName =
                        pass.host?.businessName ?? pass.name ?? "Parking Pass";
                      const nextDate = pass.nextDate ?? pass.date;
                      return (
                        <div
                          key={pass.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="text-sm font-medium">{hostName}</div>
                          <div className="text-xs text-muted-foreground">
                            Applies to all upcoming dates
                            {nextDate
                              ? ` Â· Next date ${new Date(
                                  nextDate,
                                ).toLocaleDateString()}`
                              : ""}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Start Time
                              </p>
                              <input
                                type="time"
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.startTime}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      startTime: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                End Time
                              </p>
                              <input
                                type="time"
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.endTime}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      endTime: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Max Trucks
                              </p>
                              <input
                                type="number"
                                min={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.maxTrucks}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      maxTrucks: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Status
                              </p>
                              <select
                                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                                value={edits.status}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      status: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="open">Open</option>
                                <option value="booked">Booked</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="completed">Completed</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Breakfast ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.breakfastPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    breakfastPriceCents: toCents(
                                      e.target.value,
                                    ),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Lunch ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.lunchPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    lunchPriceCents: toCents(e.target.value),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Dinner ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.dinnerPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    dinnerPriceCents: toCents(e.target.value),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Daily ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.dailyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      dailyPriceCents: toCents(e.target.value),
                                      weeklyPriceCents:
                                        edits._weeklyManuallyEdited
                                          ? Number(edits.weeklyPriceCents || 0)
                                          : toCents(e.target.value) * 7,
                                      monthlyPriceCents:
                                        edits._monthlyManuallyEdited
                                          ? Number(edits.monthlyPriceCents || 0)
                                          : toCents(e.target.value) * 30,
                                      _dailyManuallyEdited: true,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Weekly ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.weeklyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      weeklyPriceCents: toCents(e.target.value),
                                      _weeklyManuallyEdited:
                                        toCents(e.target.value) > 0,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Monthly ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.monthlyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      monthlyPriceCents: toCents(
                                        e.target.value,
                                      ),
                                      _monthlyManuallyEdited:
                                        toCents(e.target.value) > 0,
                                    },
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateParkingPass.mutate({
                                  eventId: pass.id,
                                  updates: edits,
                                })
                              }
                              disabled={updateParkingPass.isPending}
                              data-testid={`button-save-parking-pass-${pass.id}`}
                            >
                              Save Parking Pass
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Danger Zone - elevated admins only */}
              {isDuperOrRootUserType(adminUser?.userType) && (
                <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
                  <h3 className="font-semibold mb-2 text-destructive flex items-center">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Danger Zone
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Permanently delete this user account. This action cannot be
                    undone and will remove all associated data.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Are you absolutely sure you want to delete ${selectedUser.email}? This will permanently delete the account and all associated data. This action cannot be undone.`,
                        )
                      ) {
                        deleteUser.mutate(selectedUser.id);
                      }
                    }}
                    disabled={deleteUser.isPending}
                  >
                    <UserMinus className="w-4 h-4 mr-1" />
                    Delete User Permanently
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deal Details Dialog */}
      <Dialog open={dealDetailsOpen} onOpenChange={setDealDetailsOpen}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Package className="w-5 h-5" />
              <span>Deal Details & Performance</span>
            </DialogTitle>
            <DialogDescription>
              Comprehensive information and analytics for this deal
            </DialogDescription>
          </DialogHeader>

          {selectedDeal && (
            <div className="space-y-6 mt-4">
              {/* Deal Information */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Package className="w-4 h-4 mr-2" />
                  DEAL INFORMATION
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Title</p>
                    <p className="font-medium text-lg">{selectedDeal.title}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="text-sm">{selectedDeal.description}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Restaurant</p>
                    <p className="font-medium">
                      {selectedDeal.restaurant?.name}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Discount</p>
                    <p className="font-medium">
                      {selectedDeal.discountValue}% off
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Validity Period
                    </p>
                    <p className="text-sm">
                      {new Date(selectedDeal.startDate).toLocaleDateString()} -{" "}
                      {new Date(selectedDeal.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Time Window</p>
                    <p className="text-sm">
                      {selectedDeal.startTime} - {selectedDeal.endTime}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge
                      variant={selectedDeal.isActive ? "default" : "secondary"}
                    >
                      {selectedDeal.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Featured</p>
                    <Badge
                      variant={selectedDeal.isFeatured ? "default" : "outline"}
                    >
                      {selectedDeal.isFeatured ? "Yes" : "No"}
                    </Badge>
                  </div>
                  {selectedDeal.totalUsesLimit && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Total Uses Limit
                      </p>
                      <p className="text-sm">
                        {selectedDeal.currentUses} /{" "}
                        {selectedDeal.totalUsesLimit}
                      </p>
                    </div>
                  )}
                  {selectedDeal.perCustomerLimit && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Per Customer Limit
                      </p>
                      <p className="text-sm">{selectedDeal.perCustomerLimit}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Performance Metrics */}
              {dealStats && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    PERFORMANCE METRICS
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.views || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total Views
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.claims || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total Claims
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.views > 0
                            ? (
                                (dealStats.claims / dealStats.views) *
                                100
                              ).toFixed(1)
                            : 0}
                          %
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Conversion Rate
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {dealStats.totalFeedback > 0 && (
                    <div className="mt-4 text-xs text-muted-foreground">
                      {dealStats.totalFeedback} feedback response
                      {dealStats.totalFeedback === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Actions */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Settings className="w-4 h-4 mr-2" />
                  QUICK ACTIONS
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Extend Deal Duration
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        value={extendDays}
                        onChange={(e) =>
                          setExtendDays(parseInt(e.target.value) || 1)
                        }
                        className="w-20 px-2 py-1 border rounded text-sm"
                        placeholder="Days"
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          extendDeal.mutate({
                            dealId: selectedDeal.id,
                            days: extendDays,
                          })
                        }
                        disabled={extendDeal.isPending}
                      >
                        Extend by {extendDays} days
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Deal Actions
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDealDetailsOpen(false);
                          window.location.href = `/deal-edit/${selectedDeal.id}`;
                        }}
                      >
                        <Settings className="w-4 h-4 mr-1" />
                        Edit Deal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          cloneDeal.mutate(selectedDeal.id);
                          setDealDetailsOpen(false);
                        }}
                        disabled={cloneDeal.isPending}
                      >
                        <Package className="w-4 h-4 mr-1" />
                        Clone
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
                <h3 className="font-semibold mb-2 text-destructive flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Danger Zone
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Permanently delete this deal. This action cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Are you absolutely sure? This will permanently delete the deal and all associated data.",
                      )
                    ) {
                      deleteDeal.mutate(selectedDeal.id);
                    }
                  }}
                  disabled={deleteDeal.isPending}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Delete Deal Permanently
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Navigation />
    </div>
  );
}
