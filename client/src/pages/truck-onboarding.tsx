import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  MapPin,
  MenuSquare,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { BackHeader } from "@/components/back-header";
import DocumentUpload from "@/components/document-upload";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { authUrl } from "@/lib/api";
import { trackMetaEvent } from "@/lib/meta-pixel";
import { apiRequest, ApiError } from "@/lib/queryClient";
import {
  PASSWORD_REGEX,
  PASSWORD_REQUIREMENTS,
} from "@/utils/passwordPolicy";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";

type Stage = "account" | "truck" | "basics" | "finish";
type AuthMode = "signup" | "login";
type TruckMode = "claim" | "create";

type ClaimRow = {
  id: string;
  status?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  externalId?: string | null;
  confidenceScore?: number | null;
  invited?: boolean;
  hasEmail?: boolean;
  canClaim?: boolean;
  canRequest?: boolean;
  requestCooldownMinutes?: number;
};

type OwnedRestaurant = {
  id: string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  businessType?: string | null;
  cuisineType?: string | null;
  isFoodTruck?: boolean | null;
  isVerified?: boolean | null;
  isActive?: boolean | null;
};

type OnboardingStep = {
  id: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
  why: string;
};

type OwnerOnboardingStatus = {
  completed: number;
  total: number;
  percent: number;
  allDone: boolean;
  nextStep: OnboardingStep | null;
  steps: OnboardingStep[];
  counts: {
    restaurants: number;
    menus: number;
    items: number;
  };
  isDiscoverable: boolean;
  publicPreviewUrl: string | null;
  visibilityBlockers: string[];
  verification?: {
    status: "verified" | "pending" | "not_submitted";
    isVerified: boolean;
    needsSubmission: boolean;
    snoozed: boolean;
    snoozedAt: string | null;
    snoozedUntil: string | null;
  };
};

type SignupFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

type LoginFields = {
  email: string;
  password: string;
};

type TruckProfileFields = {
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  cuisineType: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookPageUrl: string;
};

const emptySignup: SignupFields = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

const emptyLogin: LoginFields = {
  email: "",
  password: "",
};

const emptyProfile: TruckProfileFields = {
  name: "",
  address: "",
  city: "",
  state: "",
  phone: "",
  cuisineType: "",
  description: "",
  websiteUrl: "",
  instagramUrl: "",
  facebookPageUrl: "",
};

const cuisineOptions = [
  "American",
  "BBQ",
  "Breakfast",
  "Burgers",
  "Cajun",
  "Coffee",
  "Dessert",
  "Healthy",
  "Mexican",
  "Seafood",
  "Tacos",
  "Other",
];

const stageOrder: Array<{ id: Stage; label: string }> = [
  { id: "account", label: "Owner" },
  { id: "truck", label: "Truck" },
  { id: "basics", label: "Basics" },
  { id: "finish", label: "Done" },
];

const isTruckRestaurant = (restaurant: OwnedRestaurant) =>
  Boolean(restaurant?.isFoodTruck) ||
  String(restaurant?.businessType || "").toLowerCase() === "food_truck";

const normalizeState = (value: string) => String(value || "").trim().toUpperCase();

const compactPhone = (value: string) => String(value || "").replace(/\D/g, "");

const getSafeCurrentOnboardingPath = () => {
  if (typeof window === "undefined") return "/truck-onboarding";
  const query = window.location.search || "";
  return `/truck-onboarding${query}`;
};

const makeVerifyEmailUrl = () => {
  const params = new URLSearchParams();
  params.set("next", getSafeCurrentOnboardingPath());
  params.set("source", "truck-onboarding");
  params.set("accountType", "business");
  params.set("businessType", "food_truck");
  return `/verify-email?${params.toString()}`;
};

const getIncomingClaimQuery = (params: URLSearchParams) =>
  String(params.get("q") || params.get("listingId") || "").trim();

export default function TruckOnboardingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading, refetch } = useAuth();

  const initialParams = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const incomingClaimQuery = useMemo(
    () => getIncomingClaimQuery(initialParams),
    [initialParams],
  );
  const incomingIntent = String(initialParams.get("intent") || "general").trim();
  const incomingSource = String(
    initialParams.get("source") || initialParams.get("src") || "direct",
  ).trim();
  const incomingFlow = String(initialParams.get("flow") || "truck-owner").trim();
  const hasClaimIntent =
    incomingClaimQuery.length > 0 || initialParams.get("claim") === "1";

  const [stage, setStage] = useState<Stage>("account");
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [signup, setSignup] = useState<SignupFields>(emptySignup);
  const [login, setLogin] = useState<LoginFields>(emptyLogin);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [submittingAuth, setSubmittingAuth] = useState(false);

  const [truckMode, setTruckMode] = useState<TruckMode>("claim");
  const [claimQuery, setClaimQuery] = useState(incomingClaimQuery);
  const [claimResults, setClaimResults] = useState<ClaimRow[]>([]);
  const [claimSelection, setClaimSelection] = useState<ClaimRow | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<TruckProfileFields>(emptyProfile);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [createdRestaurant, setCreatedRestaurant] =
    useState<OwnedRestaurant | null>(null);
  const [addingAnother, setAddingAnother] = useState(false);
  const [verificationDocuments, setVerificationDocuments] = useState<string[]>([]);
  const [verificationUploadOpen, setVerificationUploadOpen] = useState(false);
  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [snoozingVerification, setSnoozingVerification] = useState(false);
  const autoSearchRan = useRef(false);
  const funnelContext = useMemo(
    () => ({
      page: "truck-onboarding",
      audience: "food_truck_owner",
      source: incomingSource || "direct",
      flow: incomingFlow || "truck-owner",
      intent: incomingIntent || "general",
      hasClaimIntent,
      claimQueryProvided: incomingClaimQuery.length > 0,
    }),
    [
      hasClaimIntent,
      incomingClaimQuery.length,
      incomingFlow,
      incomingIntent,
      incomingSource,
    ],
  );

  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery<
    OwnedRestaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: isAuthenticated,
    retry: false,
  });
  const onboardingRestaurantId = String(
    (createdRestaurant || restaurants.find(isTruckRestaurant))?.id || "",
  );
  const { data: onboardingStatus, isLoading: loadingOnboardingStatus } =
    useQuery<OwnerOnboardingStatus>({
      queryKey: ["owner-onboarding", onboardingRestaurantId],
      queryFn: async () => {
        const suffix = onboardingRestaurantId
          ? `?restaurantId=${encodeURIComponent(onboardingRestaurantId)}`
          : "";
        const res = await apiRequest("GET", `/api/owner/onboarding${suffix}`);
        return res.json();
      },
      enabled: isAuthenticated && stage === "finish",
      retry: false,
      staleTime: 15_000,
    });

  const existingTruck = useMemo(
    () => restaurants.find(isTruckRestaurant) || null,
    [restaurants],
  );
  const hasExistingTruck = Boolean(existingTruck);

  useEffect(() => {
    trackFunnelEventOncePerSession(
      FUNNEL_EVENTS.truckOnboardingView,
      `${funnelContext.source}:${funnelContext.flow}:${funnelContext.intent}`,
      funnelContext,
    );
  }, [funnelContext]);

  useEffect(() => {
    trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingStageView, {
      ...funnelContext,
      stage,
      authMode,
      truckMode,
      isAuthenticated,
      hasExistingTruck,
    });
  }, [authMode, funnelContext, hasExistingTruck, isAuthenticated, stage, truckMode]);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setStage("account");
      return;
    }

    if (createdRestaurant) {
      setStage("finish");
      return;
    }

    if (existingTruck && !addingAnother && !hasClaimIntent) {
      setCreatedRestaurant(existingTruck);
      setStage("finish");
      return;
    }

    if (stage === "account") {
      setStage("truck");
    }
  }, [
    addingAnother,
    createdRestaurant,
    existingTruck,
    hasClaimIntent,
    isAuthenticated,
    isLoading,
    stage,
  ]);

  useEffect(() => {
    if (!isAuthenticated || stage !== "truck") return;
    if (!incomingClaimQuery || autoSearchRan.current) return;
    autoSearchRan.current = true;
    setClaimQuery(incomingClaimQuery);
    void searchClaims(incomingClaimQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingClaimQuery, isAuthenticated, stage]);

  const currentStepIndex = stageOrder.findIndex((item) => item.id === stage);
  const progress = Math.max(25, ((currentStepIndex + 1) / stageOrder.length) * 100);
  const activeRestaurant = createdRestaurant || existingTruck;
  const activeRestaurantId = String(activeRestaurant?.id || "");
  const dashboardHref = activeRestaurantId
    ? `/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(
        activeRestaurantId,
      )}&src=truck-onboarding&intent=${encodeURIComponent(
        incomingIntent || "general",
      )}&goLive=1`
    : "/restaurant-owner-dashboard?src=truck-onboarding&goLive=1";
  const menuHref = activeRestaurantId
    ? `/menu-builder/${encodeURIComponent(
        activeRestaurantId,
      )}?src=truck-onboarding&next=${encodeURIComponent(dashboardHref)}`
    : "/restaurant-owner-dashboard?src=truck-onboarding";
  const previewHref = activeRestaurantId
    ? `/restaurant/${encodeURIComponent(activeRestaurantId)}`
    : "/restaurant-owner-dashboard";

  const refreshOnboardingStatus = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
  };

  const submitVerification = async () => {
    if (!activeRestaurantId) {
      toast({
        title: "Truck profile missing",
        description: "Finish the truck profile before submitting verification.",
        variant: "destructive",
      });
      return;
    }
    if (verificationDocuments.length === 0) {
      toast({
        title: "Upload a document",
        description: "Add a permit, license, or official business document first.",
        variant: "destructive",
      });
      return;
    }

    setSubmittingVerification(true);
    try {
      await apiRequest(
        "POST",
        `/api/restaurants/${activeRestaurantId}/verification/request`,
        {
          documents: verificationDocuments,
          source: "truck-onboarding",
        },
      );
      setVerificationDocuments([]);
      setVerificationUploadOpen(false);
      await refreshOnboardingStatus();
      toast({
        title: "Verification submitted",
        description: "Your documents are in review. You can continue setup now.",
      });
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error?.message || "Try uploading the document again.",
        variant: "destructive",
      });
    } finally {
      setSubmittingVerification(false);
    }
  };

  const snoozeVerification = async () => {
    if (!activeRestaurantId) return;
    setSnoozingVerification(true);
    try {
      await apiRequest(
        "POST",
        `/api/restaurants/${activeRestaurantId}/verification/snooze`,
        { source: "truck-onboarding" },
      );
      setVerificationUploadOpen(false);
      await refreshOnboardingStatus();
      toast({
        title: "Verification skipped for today",
        description: "We will remind you again tomorrow if it is still missing.",
      });
    } catch (error: any) {
      toast({
        title: "Could not skip verification",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSnoozingVerification(false);
    }
  };

  const updateSignup = (key: keyof SignupFields, value: string) => {
    setSignup((prev) => ({ ...prev, [key]: value }));
  };

  const updateLogin = (key: keyof LoginFields, value: string) => {
    setLogin((prev) => ({ ...prev, [key]: value }));
  };

  const updateProfile = (key: keyof TruckProfileFields, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const validateSignup = () => {
    const missing = [
      signup.firstName,
      signup.lastName,
      signup.email,
      signup.phone,
      signup.password,
      signup.confirmPassword,
    ].some((value) => !String(value || "").trim());
    if (missing) return "Fill out every account field.";
    if (!signup.email.includes("@")) return "Enter a valid email address.";
    if (compactPhone(signup.phone).length < 10) {
      return "Enter a valid phone number.";
    }
    if (!PASSWORD_REGEX.test(signup.password)) return PASSWORD_REQUIREMENTS;
    if (signup.password !== signup.confirmPassword) {
      return "Passwords do not match.";
    }
    return "";
  };

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateSignup();
    if (error) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingSignupBlocked, {
        ...funnelContext,
        reason: error,
      });
      toast({
        title: "Check your account details",
        description: error,
        variant: "destructive",
      });
      return;
    }

    setSubmittingAuth(true);
    try {
      trackFunnelEvent(FUNNEL_EVENTS.signupSubmitted, {
        ...funnelContext,
        stage: "owner_account_submit",
        accountType: "business",
        businessSubType: "food_truck",
      });
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingSignupSubmitted, {
        ...funnelContext,
        authMode: "signup",
      });
      await apiRequest("POST", "/api/auth/restaurant/register", {
        firstName: signup.firstName.trim(),
        lastName: signup.lastName.trim(),
        email: signup.email.trim(),
        phone: signup.phone.trim(),
        password: signup.password,
        businessType: "food_truck",
      });
      try {
        window.sessionStorage.setItem(
          "mealscout:lastSignupEmail",
          signup.email.trim(),
        );
      } catch {}
      const verifyUrl = makeVerifyEmailUrl();
      trackFunnelEvent(FUNNEL_EVENTS.signupCompleted, {
        ...funnelContext,
        stage: "owner_account_created",
        accountType: "business",
        businessSubType: "food_truck",
      });
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingSignupCompleted, {
        ...funnelContext,
        redirectPath: verifyUrl,
      });
      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        ...funnelContext,
        stage: "redirect_to_verify_email",
        redirectPath: verifyUrl,
        accountType: "business",
        businessSubType: "food_truck",
      });
      trackMetaEvent("Lead", {
        content_name: "food_truck_owner_signup",
        content_category: "truck_onboarding",
      });
      toast({
        title: "Verify your email",
        description: "We sent a verification link. Use it, then continue here.",
      });
      window.location.href = verifyUrl;
    } catch (signupError: any) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingSignupBlocked, {
        ...funnelContext,
        reason: "api_error",
        message: signupError?.message || null,
      });
      toast({
        title: "Account not created",
        description: signupError?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!login.email.trim() || !login.password) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingLoginSubmitted, {
        ...funnelContext,
        blocked: true,
        reason: "missing_credentials",
      });
      toast({
        title: "Missing sign in details",
        description: "Enter your email and password.",
        variant: "destructive",
      });
      return;
    }

    setSubmittingAuth(true);
    try {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingLoginSubmitted, {
        ...funnelContext,
        blocked: false,
      });
      await apiRequest("POST", "/api/auth/restaurant/login", {
        email: login.email.trim(),
        password: login.password,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      await refetch();
      setStage("truck");
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingLoginCompleted, {
        ...funnelContext,
        nextStage: "truck",
      });
      toast({
        title: "Signed in",
        description: "Now finish your truck setup.",
      });
    } catch (loginError: any) {
      if (loginError instanceof ApiError && loginError.status === 403) {
        try {
          window.sessionStorage.setItem(
            "mealscout:lastSignupEmail",
            login.email.trim(),
          );
        } catch {}
        toast({
          title: "Verify your email",
          description: "Your account exists, but the email still needs verification.",
          variant: "destructive",
        });
        window.location.href = makeVerifyEmailUrl();
        return;
      }
      toast({
        title: "Could not sign in",
        description: loginError?.message || "Check your email and password.",
        variant: "destructive",
      });
    } finally {
      setSubmittingAuth(false);
    }
  };

  async function searchClaims(query = claimQuery) {
    const q = String(query || "").trim();
    if (!q) {
      setClaimResults([]);
      setClaimError("");
      return;
    }
    setClaimLoading(true);
    setClaimError("");
    trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingClaimSearch, {
      ...funnelContext,
      queryLength: q.length,
      stage,
    });
    try {
      const res = await apiRequest(
        "GET",
        `/api/truck-claims/search?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data) ? data : [];
      setClaimResults(rows);
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingClaimSearch, {
        ...funnelContext,
        queryLength: q.length,
        resultCount: rows.length,
        stage,
        completed: true,
      });
      if (rows.length === 0) {
        setClaimError("No matching trucks found. You can create a new profile.");
      }
    } catch (error: any) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingClaimSearch, {
        ...funnelContext,
        queryLength: q.length,
        stage,
        completed: false,
        error: error?.message || "search_failed",
      });
      setClaimError(error?.message || "Search failed. Try a shorter name.");
    } finally {
      setClaimLoading(false);
    }
  }

  const handleRequestSetup = async (listingId: string) => {
    setRequestingId(listingId);
    setClaimError("");
    try {
      const res = await apiRequest("POST", "/api/truck-claims/request", {
        listingId,
      });
      const data = await res.json().catch(() => ({}));
      toast({
        title: data?.emailSent ? "Setup email sent" : "Setup email not sent",
        description: data?.emailSent
          ? "We sent the invited owner a link to finish setup."
          : "This listing needs an email before a reminder can be sent.",
        variant: data?.emailSent ? "default" : "destructive",
      });
      await searchClaims();
    } catch (error: any) {
      setClaimError(error?.message || "Unable to request setup.");
    } finally {
      setRequestingId(null);
    }
  };

  const selectClaim = (listing: ClaimRow) => {
    if (listing.canClaim === false) {
      setClaimError(
        "This truck already has an invited owner. Request setup instead.",
      );
      return;
    }
    setTruckMode("claim");
    setClaimSelection(listing);
    setProfile({
      ...emptyProfile,
      name: String(listing.name || ""),
      address: String(listing.address || ""),
      city: String(listing.city || ""),
      state: String(listing.state || ""),
      phone: String(listing.phone || user?.phone || ""),
    });
    setStage("basics");
  };

  const startManualCreate = () => {
    setTruckMode("create");
    setClaimSelection(null);
    setClaimResults([]);
    setClaimError("");
    setProfile({
      ...emptyProfile,
      phone: String(user?.phone || ""),
    });
    setStage("basics");
  };

  const validateProfile = () => {
    if (!profile.name.trim()) return "Truck name is required.";
    if (!profile.city.trim()) return "City is required.";
    if (normalizeState(profile.state).length < 2) return "State is required.";
    if (compactPhone(profile.phone).length < 10) {
      return "Phone number is required.";
    }
    if (truckMode === "claim" && !profile.address.trim()) {
      return "Address is required to claim an imported listing.";
    }
    return "";
  };

  const buildRestaurantPayload = () => {
    const city = profile.city.trim();
    const state = normalizeState(profile.state);
    const address = profile.address.trim() || `${city}, ${state}`;
    const payload: Record<string, any> = {
      name: profile.name.trim(),
      address,
      city,
      state,
      phone: profile.phone.trim(),
      businessType: "food_truck",
    };

    const optionalFields: Array<[keyof TruckProfileFields, string]> = [
      ["cuisineType", "cuisineType"],
      ["description", "description"],
      ["websiteUrl", "websiteUrl"],
      ["instagramUrl", "instagramUrl"],
      ["facebookPageUrl", "facebookPageUrl"],
    ];

    optionalFields.forEach(([field, key]) => {
      const value = String(profile[field] || "").trim();
      if (value) payload[key] = value;
    });

    return payload;
  };

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateProfile();
    if (error) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingProfileSubmitted, {
        ...funnelContext,
        blocked: true,
        reason: error,
        truckMode,
        hasClaimSelection: Boolean(claimSelection),
      });
      toast({
        title: "Check truck basics",
        description: error,
        variant: "destructive",
      });
      return;
    }

    setSubmittingProfile(true);
    try {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingProfileSubmitted, {
        ...funnelContext,
        blocked: false,
        truckMode,
        hasClaimSelection: Boolean(claimSelection),
        hasOptionalDetails:
          Boolean(profile.cuisineType.trim()) ||
          Boolean(profile.description.trim()) ||
          Boolean(profile.websiteUrl.trim()) ||
          Boolean(profile.instagramUrl.trim()) ||
          Boolean(profile.facebookPageUrl.trim()),
      });
      const restaurantData = buildRestaurantPayload();
      const response = claimSelection
        ? await apiRequest("POST", "/api/truck-claims", {
            listingId: claimSelection.id,
            restaurantData,
          })
        : await apiRequest("POST", "/api/restaurants/signup", {
            userData: {
              email: user?.email,
              firstName: user?.firstName,
              lastName: user?.lastName,
              phone: user?.phone || profile.phone,
            },
            restaurantData,
          });
      const payload = await response.json().catch(() => ({}));

      if (payload?.requiresEmailVerification) {
        toast({
          title: "Verify your email",
          description: "Verification is required before setup can continue.",
        });
        window.location.href = makeVerifyEmailUrl();
        return;
      }

      const restaurant = payload?.restaurant || payload;
      setCreatedRestaurant(restaurant);
      await queryClient.invalidateQueries({
        queryKey: ["/api/restaurants/my-restaurants"],
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
      setStage("finish");
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingProfileCompleted, {
        ...funnelContext,
        truckMode,
        hasClaimSelection: Boolean(claimSelection),
        restaurantId: restaurant?.id || null,
      });
      toast({
        title: "Truck profile created",
        description: "Your profile is ready for menu and live-location setup.",
      });
    } catch (error: any) {
      trackFunnelEvent(FUNNEL_EVENTS.truckOnboardingProfileSubmitted, {
        ...funnelContext,
        blocked: true,
        reason: "api_error",
        message: error?.message || null,
        truckMode,
        hasClaimSelection: Boolean(claimSelection),
      });
      toast({
        title: "Truck setup failed",
        description: error?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSubmittingProfile(false);
    }
  };

  const renderStepMarker = (item: { id: Stage; label: string }, index: number) => {
    const isComplete = index < currentStepIndex;
    const isActive = item.id === stage;
    return (
      <div
        key={item.id}
        className={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold ${
          isActive
            ? "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]"
            : isComplete
              ? "text-[color:var(--status-success)]"
              : "text-[color:var(--text-muted)]"
        }`}
      >
        {isComplete ? (
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        ) : (
          <Circle className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{item.label}</span>
      </div>
    );
  };

  const renderAccountStage = () => (
    <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
      <section className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Food truck owner setup
            </p>
            <h2 className="mt-1 text-xl font-black">
              Create the owner account first.
            </h2>
          </div>
        </div>

        <p className="mt-4 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
          This path is for owners claiming or creating a food truck profile.
          After access is confirmed, you can add the truck, menu, schedule,
          booking, and live-location tools.
        </p>

        <div className="mt-5 grid gap-3">
          {[
            ["No customer account detour", "The next step is truck setup."],
            ["No credit card to start", "Create the profile before any paid tools."],
            ["Built for owner trust", "Phone and email protect the truck claim."],
          ].map(([title, body]) => (
            <div
              key={title}
              className="flex gap-3 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--status-success)]" />
              <div>
                <div className="text-sm font-black">{title}</div>
                <div className="text-xs font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                  {body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
        <CardContent className="p-5">
          <div className="mb-4">
            <h2 className="text-xl font-black">Owner access</h2>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-secondary)]">
              Sign in or create the owner account attached to the truck.
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-1">
            <Button
              type="button"
              variant={authMode === "signup" ? "default" : "ghost"}
              onClick={() => setAuthMode("signup")}
            >
              Create account
            </Button>
            <Button
              type="button"
              variant={authMode === "login" ? "default" : "ghost"}
              onClick={() => setAuthMode("login")}
            >
              Sign in
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="mb-4 w-full gap-2"
            onClick={() =>
              (window.location.href = authUrl("/api/auth/google/restaurant"))
            }
          >
            <ShieldCheck className="h-4 w-4" />
            Continue with Google
          </Button>

          {authMode === "signup" ? (
            <form className="space-y-3" onSubmit={handleSignup}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={signup.firstName}
                  onChange={(event) => updateSignup("firstName", event.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                />
                <Input
                  value={signup.lastName}
                  onChange={(event) => updateSignup("lastName", event.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                />
              </div>
              <Input
                value={signup.email}
                onChange={(event) => updateSignup("email", event.target.value)}
                placeholder="owner@example.com"
                type="email"
                autoComplete="email"
              />
              <Input
                value={signup.phone}
                onChange={(event) => updateSignup("phone", event.target.value)}
                placeholder="Phone"
                type="tel"
                autoComplete="tel"
              />
              <div className="relative">
                <Input
                  value={signup.password}
                  onChange={(event) => updateSignup("password", event.target.value)}
                  placeholder="Password"
                  type={showSignupPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSignupPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
                  aria-label="Toggle password visibility"
                >
                  {showSignupPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Input
                value={signup.confirmPassword}
                onChange={(event) =>
                  updateSignup("confirmPassword", event.target.value)
                }
                placeholder="Confirm password"
                type={showSignupPassword ? "text" : "password"}
                autoComplete="new-password"
              />
              <Button
                type="submit"
                disabled={submittingAuth}
                className="w-full gap-2"
              >
                {submittingAuth ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create account
              </Button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleLogin}>
              <Input
                value={login.email}
                onChange={(event) => updateLogin("email", event.target.value)}
                placeholder="owner@example.com"
                type="email"
                autoComplete="email"
              />
              <div className="relative">
                <Input
                  value={login.password}
                  onChange={(event) => updateLogin("password", event.target.value)}
                  placeholder="Password"
                  type={showLoginPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]"
                  aria-label="Toggle password visibility"
                >
                  {showLoginPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <Button
                type="submit"
                disabled={submittingAuth}
                className="w-full gap-2"
              >
                {submittingAuth ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sign in and continue
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const renderTruckStage = () => (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-black">Find or create the truck</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Claim an imported listing when it exists, or create a fresh one.
              </p>
            </div>
          </div>

          {existingTruck && !addingAnother ? (
            <div className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm">
              <div className="font-semibold">{existingTruck.name}</div>
              <div className="text-[color:var(--text-secondary)]">
                Existing truck profile found on this account.
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setAddingAnother(true)}
              >
                Add another truck
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={startManualCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create a new truck instead
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
              <Input
                value={claimQuery}
                onChange={(event) => setClaimQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void searchClaims();
                }}
                placeholder="Truck name, license ID, city, or state"
                className="pl-10"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={claimLoading}
              onClick={() => searchClaims()}
              className="gap-2"
            >
              {claimLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Search
            </Button>
          </div>

          {claimError ? (
            <div className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3 text-sm text-[color:var(--text-secondary)]">
              {claimError}
            </div>
          ) : null}

          {claimResults.length > 0 ? (
            <div className="space-y-2">
              {claimResults.slice(0, 8).map((row) => {
                const cooldown = Number(row.requestCooldownMinutes || 0);
                const canRequest = Boolean(row.canRequest && cooldown === 0);
                return (
                  <div
                    key={row.id}
                    className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate font-semibold">
                            {row.name || "Unnamed truck"}
                          </div>
                          {row.invited ? <Badge variant="secondary">Invited</Badge> : null}
                          {row.hasEmail ? (
                            <Badge variant="outline">Email on file</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate text-xs text-[color:var(--text-secondary)]">
                          {[row.address, row.city, row.state]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                        {cooldown > 0 ? (
                          <div className="mt-1 text-xs text-[color:var(--text-secondary)]">
                            Reminder already sent. Try again in about {cooldown} minutes.
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {row.canClaim !== false ? (
                          <Button size="sm" onClick={() => selectClaim(row)}>
                            Use this truck
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canRequest || requestingId === row.id}
                            onClick={() => handleRequestSetup(row.id)}
                          >
                            {requestingId === row.id ? "Sending..." : "Request setup"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  const renderBasicsStage = () => (
    <form className="space-y-4" onSubmit={submitProfile}>
      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-black">
                {truckMode === "claim" ? "Confirm truck basics" : "Create truck basics"}
              </h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                These are the minimum details needed to create the owner profile.
              </p>
            </div>
            {claimSelection ? (
              <Badge variant="outline">Claiming imported listing</Badge>
            ) : (
              <Badge variant="secondary">New profile</Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-semibold">Truck name</span>
              <Input
                value={profile.name}
                onChange={(event) => updateProfile("name", event.target.value)}
                placeholder="Example Taco Truck"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-semibold">
                Base address or commissary
              </span>
              <Input
                value={profile.address}
                onChange={(event) => updateProfile("address", event.target.value)}
                placeholder="Optional unless claiming an imported listing"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">City</span>
              <Input
                value={profile.city}
                onChange={(event) => updateProfile("city", event.target.value)}
                placeholder="Pensacola"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">State</span>
              <Input
                value={profile.state}
                onChange={(event) => updateProfile("state", event.target.value)}
                placeholder="FL"
                maxLength={2}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">Phone</span>
              <Input
                value={profile.phone}
                onChange={(event) => updateProfile("phone", event.target.value)}
                placeholder="(555) 123-4567"
                type="tel"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">Cuisine</span>
              <select
                value={profile.cuisineType}
                onChange={(event) => updateProfile("cuisineType", event.target.value)}
                className="flex h-10 w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
              >
                <option value="">Select cuisine</option>
                {cuisineOptions.map((option) => (
                  <option key={option} value={option.toLowerCase()}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">Optional profile details</div>
                <div className="text-xs text-[color:var(--text-secondary)]">
                  Add them now, or finish setup faster and fill them in later.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowOptionalDetails((value) => !value)}
              >
                {showOptionalDetails ? "Hide" : "Add details"}
              </Button>
            </div>

            {showOptionalDetails ? (
              <div className="mt-4 space-y-3">
                <label className="space-y-1">
                  <span className="text-sm font-semibold">Short description</span>
                  <Textarea
                    value={profile.description}
                    onChange={(event) =>
                      updateProfile("description", event.target.value)
                    }
                    maxLength={500}
                    placeholder="What should customers know about your truck?"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    value={profile.websiteUrl}
                    onChange={(event) =>
                      updateProfile("websiteUrl", event.target.value)
                    }
                    placeholder="Website URL"
                    type="url"
                  />
                  <Input
                    value={profile.instagramUrl}
                    onChange={(event) =>
                      updateProfile("instagramUrl", event.target.value)
                    }
                    placeholder="Instagram URL"
                    type="url"
                  />
                  <Input
                    value={profile.facebookPageUrl}
                    onChange={(event) =>
                      updateProfile("facebookPageUrl", event.target.value)
                    }
                    placeholder="Facebook URL"
                    type="url"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStage("truck")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Button type="submit" disabled={submittingProfile} className="gap-2">
              {submittingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Finish truck profile
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );

  const renderFinishStage = () => {
    const steps = onboardingStatus?.steps ?? [
      {
        id: "create-truck-profile",
        label: "Create truck profile",
        done: true,
        href: "/truck-onboarding",
        cta: "Create profile",
        why: "Attach the truck to this owner account.",
      },
      {
        id: "add-menu",
        label: "Add menu item",
        done: false,
        href: menuHref,
        cta: "Add item",
        why: "Customers need at least one menu item before the profile is useful.",
      },
      {
        id: "go-live",
        label: "Go live / get verified",
        done: false,
        href: dashboardHref,
        cta: "Check status",
        why: "Verified, active trucks with a menu can show up for customers.",
      },
    ];
    const nextStep = onboardingStatus?.nextStep;
    const setupComplete = Boolean(onboardingStatus?.allDone);
    const previewUrl = onboardingStatus?.publicPreviewUrl || previewHref;
    const verification = onboardingStatus?.verification;
    const needsVerification = verification?.status === "not_submitted";

    return (
      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-md ${
                  setupComplete
                    ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                    : "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]"
                }`}
              >
                {setupComplete ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : (
                  <Truck className="h-6 w-6" />
                )}
              </span>
              <div>
                <h2 className="text-xl font-black">
                  {setupComplete
                    ? "Truck onboarding is complete"
                    : "Truck profile is saved"}
                </h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  {setupComplete
                    ? `${activeRestaurant?.name || "Your truck"} is ready for customers.`
                    : "Finish the remaining checklist so customers can actually find and choose you."}
                </p>
              </div>
            </div>

            {loadingOnboardingStatus ? (
              <div className="flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[color:var(--text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking setup status...
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">
                    Setup progress
                  </div>
                  {onboardingStatus ? (
                    <Badge variant={setupComplete ? "default" : "secondary"}>
                      {onboardingStatus.completed} of {onboardingStatus.total}
                    </Badge>
                  ) : null}
                </div>
                {onboardingStatus ? (
                  <Progress value={onboardingStatus.percent} className="mb-4 h-2" />
                ) : null}
                <div className="space-y-2 text-sm">
                  {steps.map((step) => (
                    <div key={step.id} className="flex gap-2">
                      {step.done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--status-success)]" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={step.done ? "text-[color:var(--text-secondary)] line-through" : "font-semibold"}>
                          {step.label}
                        </div>
                        {!step.done ? (
                          <div className="text-xs text-[color:var(--text-secondary)]">
                            {step.why}
                          </div>
                        ) : null}
                      </div>
                      {!step.done ? (
                        <Link href={step.href} className="shrink-0 text-xs font-semibold text-[color:var(--accent-text)] hover:underline">
                          {step.cta}
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}

            {existingTruck && createdRestaurant?.id === existingTruck.id ? (
              <Button
                type="button"
                variant="outline"
                className="mt-5"
                onClick={() => {
                  setAddingAnother(true);
                  setCreatedRestaurant(null);
                  setStage("truck");
                }}
              >
                Add another truck
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {needsVerification ? (
            <Card className="border-[color:var(--accent-text)]/35 bg-[var(--bg-card)] shadow-clean">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-black">Verify when ready</div>
                      <p className="text-sm text-[color:var(--text-secondary)]">
                        {verification?.snoozed
                          ? "Skipped for today. You can still submit now if the document is nearby."
                          : "Upload one permit, license, or official business document. If it is not nearby, skip once and we will bring this back tomorrow."}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    Daily reminder
                  </Badge>
                </div>

                {verification?.snoozed && !verificationUploadOpen ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setVerificationUploadOpen(true)}
                    className="w-full sm:w-auto"
                  >
                    Submit now
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <DocumentUpload
                      onDocumentsChange={setVerificationDocuments}
                      maxFiles={3}
                      maxFileSize={10 * 1024 * 1024}
                      acceptedTypes={[
                        "image/jpeg",
                        "image/jpg",
                        "image/png",
                        "application/pdf",
                      ]}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Button
                        type="button"
                        onClick={() => void submitVerification()}
                        disabled={
                          submittingVerification ||
                          verificationDocuments.length === 0
                        }
                      >
                        {submittingVerification ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          "Submit verification"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void snoozeVerification()}
                        disabled={snoozingVerification || submittingVerification}
                      >
                        {snoozingVerification ? (
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
                )}
              </CardContent>
            </Card>
          ) : verification?.status === "pending" ? (
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
              <CardContent className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[color:var(--status-warning)]/12 text-[color:var(--status-warning)]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-black">Verification is in review</div>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    No action needed right now. We will update the checklist
                    when review is complete.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {nextStep ? (
            <Link href={nextStep.href}>
              <Card className="border-[color:var(--accent-text)]/40 bg-[var(--bg-card)] shadow-clean transition-colors hover:bg-[var(--bg-surface-muted)]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                      <ArrowRight className="h-5 w-5" />
                    </span>
                    <div>
                      <div className="font-black">Next: {nextStep.label}</div>
                      <div className="text-sm text-[color:var(--text-secondary)]">
                        {nextStep.why}
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {nextStep.cta}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ) : null}

          <Link href={menuHref}>
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition-colors hover:bg-[var(--bg-surface-muted)]">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                    <MenuSquare className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-black">Add first menu item</div>
                    <div className="text-sm text-[color:var(--text-secondary)]">
                      Required before the checklist marks menu setup done.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </CardContent>
            </Card>
          </Link>

          <Link href={dashboardHref}>
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition-colors hover:bg-[var(--bg-surface-muted)]">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                    <Radio className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-black">Go-live status</div>
                    <div className="text-sm text-[color:var(--text-secondary)]">
                      Request verification or start live map tools when eligible.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </CardContent>
            </Card>
          </Link>

          <Link href={previewUrl}>
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition-colors hover:bg-[var(--bg-surface-muted)]">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-black">Preview public profile</div>
                    <div className="text-sm text-[color:var(--text-secondary)]">
                      Check how the truck page appears to customers.
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    );
  };

  const renderStage = () => {
    if (isLoading || (isAuthenticated && loadingRestaurants && stage !== "account")) {
      return (
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
          <CardContent className="flex min-h-48 items-center justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin text-[color:var(--accent-text)]" />
          </CardContent>
        </Card>
      );
    }

    if (stage === "account") return renderAccountStage();
    if (stage === "truck") return renderTruckStage();
    if (stage === "basics") return renderBasicsStage();
    return renderFinishStage();
  };

  return (
    <main className="min-h-screen bg-[var(--bg-layered)] pb-[calc(5rem+env(safe-area-inset-bottom))] text-[color:var(--text-primary)]">
      <SEOHead
        title="Food Truck Onboarding | MealScout"
        description="Create or claim your food truck profile, add basics, and continue to menu and live map tools."
        canonicalUrl="https://www.mealscout.us/truck-onboarding"
        noIndex={true}
      />
      <BackHeader
        title="Truck Onboarding"
        fallbackHref="/truck-landing"
        icon={Truck}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <div className="mb-4 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">
                List your food truck
              </h1>
            </div>
            <div className="min-w-[220px]">
              <Progress value={progress} className="h-2" />
              <div className="mt-2 text-right text-xs font-semibold text-[color:var(--text-secondary)]">
                Step {currentStepIndex + 1} of {stageOrder.length}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stageOrder.map(renderStepMarker)}
          </div>
        </div>

        {stage === "account" && isAuthenticated ? (
          <Card className="mb-4 border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
            <CardContent className="flex items-center gap-3 p-4">
              <MailCheck className="h-5 w-5 text-[color:var(--status-success)]" />
              <div className="text-sm">
                Signed in as <span className="font-semibold">{user?.email}</span>.
              </div>
            </CardContent>
          </Card>
        ) : null}

        {renderStage()}
      </div>
    </main>
  );
}
