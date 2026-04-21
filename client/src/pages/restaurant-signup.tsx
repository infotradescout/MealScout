import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Mail,
  Eye,
  EyeOff,
  Store,
} from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";
import { HOST_ONBOARDING_COPY as COPY } from "@/copy/hostOnboarding.copy";
import {
  PASSWORD_REGEX,
  PASSWORD_REQUIREMENTS,
} from "@/utils/passwordPolicy";
import { authUrl } from "@/lib/api";

/**
 * Host Onboarding v1  COPY LOCK
 * User-facing strings must come from HOST_ONBOARDING_COPY.
 * No inline labels, helper text, or validation messages.
 */

const restaurantSchema = z
  .object({
    name: z.string().min(1, COPY.validation.restaurant.nameRequired),
    address: z.string().min(1, COPY.validation.restaurant.addressRequired),
    city: z.string().min(1, "City is required"),
    state: z.string().min(2, "State is required"),
    phone: z.string().optional().or(z.literal("")),
    businessType: z.enum(["restaurant", "bar", "food_truck"], {
      required_error: COPY.validation.restaurant.businessTypeRequired,
    }),
    cuisineType: z.string().optional(),
    description: z
      .string()
      .max(500, "Description must be less than 500 characters")
      .optional(),
    websiteUrl: z
      .string()
      .url("Must be a valid URL")
      .optional()
      .or(z.literal("")),
    instagramUrl: z
      .string()
      .url("Must be a valid URL")
      .optional()
      .or(z.literal("")),
    facebookPageUrl: z
      .string()
      .url("Must be a valid URL")
      .optional()
      .or(z.literal("")),
    hasParking: z.boolean().default(false),
    hasWifi: z.boolean().default(false),
    hasOutdoorSeating: z.boolean().default(false),
    acceptTerms: z
      .boolean()
      .refine(
        (val) => val === true,
        COPY.validation.restaurant.acceptTermsRequired
      ),
  });

const signupSchema = z
  .object({
    email: z.string().email(COPY.validation.signup.emailInvalid),
    firstName: z.string().min(1, COPY.validation.signup.firstNameRequired),
    lastName: z.string().min(1, COPY.validation.signup.lastNameRequired),
    phone: z.string().min(10, COPY.validation.signup.phoneInvalid),
    password: z
      .string()
      .min(1, PASSWORD_REQUIREMENTS)
      .regex(PASSWORD_REGEX, COPY.validation.signup.passwordTooShort),
    confirmPassword: z
      .string()
      .min(1, COPY.validation.signup.confirmPasswordRequired),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: COPY.validation.signup.passwordsMismatch,
    path: ["confirmPassword"],
  });

const loginSchema = z.object({
  email: z.string().email(COPY.validation.login.emailInvalid),
  password: z.string().min(1, COPY.validation.login.passwordRequired),
});

type RestaurantFormData = z.infer<typeof restaurantSchema>;
type SignupFormData = z.infer<typeof signupSchema>;
type LoginFormData = z.infer<typeof loginSchema>;
type RestaurantSubmissionData = Omit<
  RestaurantFormData,
  "acceptTerms"
>;

export default function RestaurantSignup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");

  // Redirect admin/staff away from this flow to their dashboard
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (user.userType === "admin" || user.userType === "staff") {
      setLocation("/restaurant-owner-dashboard");
    }
  }, [isAuthenticated, user, setLocation]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [claimQuery, setClaimQuery] = useState("");
  const [claimResults, setClaimResults] = useState<any[]>([]);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimSelection, setClaimSelection] = useState<any | null>(null);
  const [claimError, setClaimError] = useState("");
  const [claimRequestingId, setClaimRequestingId] = useState<string | null>(null);
  const [claimAutoSearch, setClaimAutoSearch] = useState(false);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  const RESTAURANT_DRAFT_KEY = "mealscout:restaurant-signup-draft";

  const restaurantDefaultValues = useMemo<RestaurantFormData>(() => {
    const base: RestaurantFormData = {
      name: "",
      address: "",
      city: "",
      state: "",
      phone: "",
      businessType: "food_truck",
      cuisineType: "",
      description: "",
      websiteUrl: "",
      instagramUrl: "",
      facebookPageUrl: "",
      hasParking: false,
      hasWifi: false,
      hasOutdoorSeating: false,
      acceptTerms: false,
    };

    if (typeof window === "undefined") return base;

    try {
      const stored = window.localStorage.getItem(RESTAURANT_DRAFT_KEY);
      if (!stored) return base;
      const parsed = JSON.parse(stored) as Partial<RestaurantFormData>;
      return { ...base, ...parsed };
    } catch {
      return base;
    }
  }, []);

  const form = useForm<RestaurantFormData>({
    resolver: zodResolver(restaurantSchema),
    defaultValues: restaurantDefaultValues,
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      firstName: "",
      lastName: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const selectedBusinessType = form.watch("businessType");
  const mainHero =
    selectedBusinessType === "food_truck"
      ? COPY.main.hero.foodTruck
      : COPY.main.hero.restaurant;

  useEffect(() => {
    // Allow deep links like `/restaurant-signup?businessType=food_truck&claim=1`
    // so a user can go straight into the claim flow after creating an account.
    try {
      const params = new URLSearchParams(window.location.search);
      const businessType = params.get("businessType");
      if (businessType === "food_truck" || businessType === "restaurant") {
        form.setValue("businessType", businessType as any);
      }

      if (businessType === "food_truck" && params.get("claim") === "1") {
        const q = String(params.get("q") || "").trim();
        if (q) {
          setClaimQuery(q);
          setClaimAutoSearch(true);
        }
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>(
            '[data-testid="input-claim-search"]',
          );
          input?.focus();
        }, 250);
      }
    } catch {
      // ignore
    }
  }, [form]);

  useEffect(() => {
    trackFunnelEventOncePerSession(FUNNEL_EVENTS.activationStarted, "restaurant_signup_view", {
      page: "restaurant-signup",
      stage: "business_onboarding_view",
      businessType: selectedBusinessType,
      authMode,
    });
  }, [selectedBusinessType, authMode]);

  useEffect(() => {
    if (selectedBusinessType !== "food_truck" && claimSelection) {
      setClaimSelection(null);
      setClaimResults([]);
      setClaimQuery("");
      setClaimError("");
    }
  }, [selectedBusinessType, claimSelection]);

  useEffect(() => {
    if (selectedBusinessType === "food_truck") {
      form.setValue("hasParking", false);
      form.setValue("hasWifi", false);
      form.setValue("hasOutdoorSeating", false);
    }
  }, [selectedBusinessType, form]);

  // Persist restaurant business details so owners can resume onboarding
  useEffect(() => {
    const subscription = form.watch((value) => {
      try {
        window.localStorage.setItem(
          RESTAURANT_DRAFT_KEY,
          JSON.stringify(value)
        );
      } catch {
        // ignore storage errors
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const { confirmPassword, ...signupData } = data;
      const res = await apiRequest(
        "POST",
        "/api/auth/restaurant/register",
        signupData
      );
      return await res.json();
    },
    onSuccess: async (payload: any) => {
      toast({
        title: "Verify your email",
        description:
          payload?.message ||
          "We sent a verification link to your email. Verify it, then log in to continue.",
      });
      try {
        window.sessionStorage.setItem(
          "mealscout:lastSignupEmail",
          signupForm.getValues("email") || "",
        );
      } catch {}
      window.location.href = `/login?redirect=${encodeURIComponent(
        "/restaurant-signup",
      )}&signup=1`;
    },
    onError: (error) => {
      toast({
        title: COPY.notifications.signup.errorTitle,
        description:
          error.message || COPY.notifications.signup.errorDescription,
        variant: "destructive",
      });
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      return await apiRequest("POST", "/api/auth/restaurant/login", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: COPY.notifications.login.successTitle,
        description: COPY.notifications.login.successDescription,
      });
      // Reload to update auth state
      window.location.reload();
    },
    onError: (error) => {
      toast({
        title: COPY.notifications.login.errorTitle,
        description: error.message || COPY.notifications.login.errorDescription,
        variant: "destructive",
      });
    },
  });

  const createRestaurantMutation = useMutation({
    mutationFn: async (data: RestaurantSubmissionData) => {
      const restaurantDataPayload: Record<string, any> = {
        name: data.name,
        address: data.address,
        city: data.city,
        state: data.state,
        businessType: data.businessType,
      };
      const normalizedPhone = String(
        data.phone ||
          (isAuthenticated
            ? String(user?.phone || "")
            : String(signupForm.getValues("phone") || "")),
      ).trim();
      if (normalizedPhone) restaurantDataPayload.phone = normalizedPhone;

      const cuisineType = String(data.cuisineType || "").trim();
      const description = String(data.description || "").trim();
      const websiteUrl = String(data.websiteUrl || "").trim();
      const instagramUrl = String(data.instagramUrl || "").trim();
      const facebookPageUrl = String(data.facebookPageUrl || "").trim();

      if (cuisineType) restaurantDataPayload.cuisineType = cuisineType;
      if (description) restaurantDataPayload.description = description;
      if (websiteUrl) restaurantDataPayload.websiteUrl = websiteUrl;
      if (instagramUrl) restaurantDataPayload.instagramUrl = instagramUrl;
      if (facebookPageUrl) restaurantDataPayload.facebookPageUrl = facebookPageUrl;

      if (
        data.businessType !== "food_truck" &&
        (data.hasParking || data.hasWifi || data.hasOutdoorSeating)
      ) {
        restaurantDataPayload.amenities = {
          parking: data.hasParking,
          wifi: data.hasWifi,
          outdoor_seating: data.hasOutdoorSeating,
        };
      }

      if (claimSelection && data.businessType === "food_truck") {
        const res = await apiRequest("POST", "/api/truck-claims", {
          listingId: claimSelection.id,
          restaurantData: restaurantDataPayload,
        });
        const payload = await res.json();
        return payload?.restaurant || payload;
      }
      // Check if user is already authenticated
      if (isAuthenticated && user) {
        // For authenticated users, use existing user data
        const requestData = {
          userData: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone || data.phone, // Use restaurant phone if user doesn't have one
            // No password needed for authenticated users
          },
          restaurantData: restaurantDataPayload,
        };
        const res = await apiRequest(
          "POST",
          "/api/restaurants/signup",
          requestData,
        );
        const payload = await res.json();
        return payload?.restaurant || payload;
      } else {
        // For new registrations, get user data from signup form
        const signupData = signupForm.getValues();

        const requestData = {
          userData: {
            email: signupData.email,
            firstName: signupData.firstName,
            lastName: signupData.lastName,
            phone: signupData.phone,
            password: signupData.password,
          },
          restaurantData: restaurantDataPayload,
        };
        const res = await apiRequest(
          "POST",
          "/api/restaurants/signup",
          requestData,
        );
        const payload = await res.json();
        return payload?.restaurant || payload;
      }
    },
    onSuccess: (restaurant: any) => {
      if (restaurant?.requiresEmailVerification) {
        toast({
          title: "Verify your email",
          description:
            restaurant?.message ||
            "We sent a verification link to your email. Verify it, then log in to continue.",
        });
        try {
          window.sessionStorage.setItem(
            "mealscout:lastSignupEmail",
            signupForm.getValues("email") || "",
          );
        } catch {}
        window.location.href = `/login?redirect=${encodeURIComponent(
          "/restaurant-signup",
        )}&signup=1`;
        return;
      }

      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        page: "restaurant-signup",
        stage: "restaurant_profile_created",
        businessType: selectedBusinessType,
      });

      toast({
        title: COPY.notifications.restaurant.successTitle,
        description: COPY.notifications.restaurant.successDescription,
      });
      setLocation("/restaurant-owner-dashboard?src=onboarding&showOnboardingPrompt=1");
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: COPY.notifications.restaurant.unauthorizedTitle,
          description:
            error.message ||
            COPY.notifications.restaurant.unauthorizedDescription,
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/restaurant");
        }, 500);
        return;
      }
      toast({
        title: COPY.notifications.restaurant.errorTitle,
        description:
          error.message || COPY.notifications.restaurant.errorDescription,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: RestaurantFormData) => {
    const { acceptTerms, ...restaurantData } = data;

    trackFunnelEvent(FUNNEL_EVENTS.signupSubmitted, {
      page: "restaurant-signup",
      stage: "restaurant_onboarding_submit",
      businessType: selectedBusinessType,
      authMode,
      isAuthenticated,
    });

    try {
      // Create restaurant first
      await createRestaurantMutation.mutateAsync(restaurantData);
    } catch (error: any) {
      console.error("Error in restaurant signup:", error);
      // Error handling is already done in the mutation
    }
  };

  const handleRestaurantInvalid = (errors: Record<string, any>) => {
    const firstError = Object.values(errors)[0] as any;
    toast({
      title: "Check the form",
      description: firstError?.message || "Please fix the highlighted fields.",
      variant: "destructive",
    });
  };

  const handleRequestTruck = async (listingId: string) => {
    setClaimRequestingId(listingId);
    setClaimError("");
    try {
      const res = await apiRequest("POST", "/api/truck-claims/request", {
        listingId,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to send reminder");
      }
      if (data?.hadEmail === false) {
        toast({
          title: "No email on file",
          description: "Ask an admin to add an email, or claim it manually.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: data?.emailSent ? "Email sent to owner" : "Email could not be sent",
        description: data?.emailSent
          ? "We sent them a link to finish setting up their account."
          : "An admin should check Email Delivery in the dashboard.",
        variant: data?.emailSent ? "default" : "destructive",
      });
    } catch (error: any) {
      setClaimError(error.message || COPY.forms.restaurant.claimNoResults);
    } finally {
      setClaimRequestingId(null);
    }
  };

  const handleClaimSearch = async () => {
    const query = claimQuery.trim();
    if (!query) {
      setClaimResults([]);
      setClaimError("");
      return;
    }

    setClaimLoading(true);
    setClaimError("");
    try {
      const res = await apiRequest(
        "GET",
        `/api/truck-claims/search?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      setClaimResults(Array.isArray(data) ? data : []);
      if (!data || data.length === 0) {
        setClaimError(COPY.forms.restaurant.claimNoResults);
      }
    } catch (error: any) {
      setClaimError(error.message || COPY.forms.restaurant.claimNoResults);
    } finally {
      setClaimLoading(false);
    }
  };

  useEffect(() => {
    if (!claimAutoSearch) return;
    if (!isAuthenticated) return;
    if (selectedBusinessType !== "food_truck") return;
    if (!claimQuery.trim()) return;
    setClaimAutoSearch(false);
    void handleClaimSearch();
  }, [claimAutoSearch, isAuthenticated, selectedBusinessType, claimQuery]);

  const applyClaimSelection = (listing: any) => {
    if (listing?.canClaim === false) {
      setClaimError(
        'This truck already has an invited owner. Use "Request this truck" to notify them to finish setup.',
      );
      return;
    }
    setClaimSelection(listing);
    setClaimResults([]);
    setClaimQuery(listing.externalId || listing.name || "");
    form.setValue("name", listing.name || "");
    form.setValue("address", listing.address || "");
    form.setValue("city", listing.city || "");
    form.setValue("state", listing.state || "");
    form.setValue("phone", listing.phone || "");
  };

  const onSignup = (data: SignupFormData) => {
    signupMutation.mutate(data);
  };

  const onLogin = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto bg-background min-h-screen flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <BackHeader
          title={COPY.unauth.headerTitle}
          fallbackHref="/"
          icon={Store}
          className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
        />

        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
              <CardContent className="p-6 sm:p-8">
                <div className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
                  {COPY.unauth.hero.badge}
                </div>
                <h1 className="mt-4 text-3xl font-black leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                  {COPY.unauth.hero.title}
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                  {COPY.unauth.hero.subtitle}
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[color:var(--text-secondary)]">
                    {COPY.benefits.compact.local.title}
                  </div>
                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[color:var(--text-secondary)]">
                    {COPY.benefits.compact.allDay.title}
                  </div>
                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[color:var(--text-secondary)]">
                    {COPY.benefits.compact.track.title}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg" data-signup-section>
              <CardContent className="p-6">
                <div className="mb-5 grid grid-cols-2 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-1">
                  <Button
                    type="button"
                    data-testid="button-signup-toggle"
                    onClick={() => setAuthMode("signup")}
                    className={authMode === "signup" ? "action-primary" : ""}
                    variant={authMode === "signup" ? "default" : "ghost"}
                  >
                    {COPY.unauth.toggles.signup}
                  </Button>
                  <Button
                    type="button"
                    data-testid="button-login-toggle"
                    onClick={() => setAuthMode("login")}
                    className={authMode === "login" ? "action-primary" : ""}
                    variant={authMode === "login" ? "default" : "ghost"}
                  >
                    {COPY.unauth.toggles.login}
                  </Button>
                </div>

                <Button
                  type="button"
                  data-testid="button-google-signin"
                  variant="outline"
                  onClick={() => (window.location.href = authUrl("/api/auth/google/restaurant"))}
                  className="mb-4 w-full justify-center gap-2 border-[color:var(--border-subtle)]"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {COPY.unauth.oauth.button}
                </Button>

                <div className="relative mb-4">
                  <div className="border-t border-[color:var(--border-subtle)]" />
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-card)] px-3 text-xs text-[color:var(--text-secondary)]">
                    {COPY.unauth.divider.or}
                  </span>
                </div>

                {authMode === "signup" ? (
                  <Form {...signupForm}>
                    <form onSubmit={signupForm.handleSubmit(onSignup)} className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField control={signupForm.control} name="firstName" render={({ field }) => (
                          <FormItem>
                            <FormLabel>{COPY.forms.signup.firstNameLabel}</FormLabel>
                            <FormControl>
                              <Input data-testid="input-first-name" autoComplete="given-name" placeholder={COPY.forms.signup.firstNamePlaceholder} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={signupForm.control} name="lastName" render={({ field }) => (
                          <FormItem>
                            <FormLabel>{COPY.forms.signup.lastNameLabel}</FormLabel>
                            <FormControl>
                              <Input data-testid="input-last-name" autoComplete="family-name" placeholder={COPY.forms.signup.lastNamePlaceholder} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      <FormField control={signupForm.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.signup.emailLabel}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-secondary)]" />
                              <Input data-testid="input-email" type="email" autoComplete="email" placeholder={COPY.forms.signup.emailPlaceholder} className="pl-9" {...field} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={signupForm.control} name="phone" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.signup.phoneLabel}</FormLabel>
                          <FormControl>
                            <Input data-testid="input-phone" type="tel" autoComplete="tel" placeholder={COPY.forms.signup.phonePlaceholder} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={signupForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.signup.passwordLabel}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input data-testid="input-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder={COPY.forms.signup.passwordPlaceholder} className="pr-10" {...field} />
                              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-secondary)]" onClick={() => setShowPassword(!showPassword)}>
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={signupForm.control} name="confirmPassword" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.signup.confirmPasswordLabel}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input data-testid="input-confirm-password" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder={COPY.forms.signup.confirmPasswordPlaceholder} className="pr-10" {...field} />
                              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-secondary)]" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <Button type="submit" className="w-full action-primary hover:bg-[color:var(--action-hover)]" disabled={signupMutation.isPending} data-testid="button-signup-submit">
                        {signupMutation.isPending ? COPY.unauth.signupCta.buttonPending : COPY.unauth.signupCta.buttonIdle}
                      </Button>
                    </form>
                  </Form>
                ) : (
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                      <FormField control={loginForm.control} name="email" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.login.emailLabel}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-secondary)]" />
                              <Input data-testid="input-login-email" type="email" autoComplete="email" placeholder={COPY.forms.login.emailPlaceholder} className="pl-9" {...field} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <FormField control={loginForm.control} name="password" render={({ field }) => (
                        <FormItem>
                          <FormLabel>{COPY.forms.login.passwordLabel}</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input data-testid="input-login-password" type={showLoginPassword ? "text" : "password"} autoComplete="current-password" placeholder={COPY.forms.login.passwordPlaceholder} className="pr-10" {...field} />
                              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-secondary)]" onClick={() => setShowLoginPassword(!showLoginPassword)}>
                                {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />

                      <Button type="submit" className="w-full action-primary hover:bg-[color:var(--action-hover)]" disabled={loginMutation.isPending} data-testid="button-login-submit">
                        {loginMutation.isPending ? COPY.unauth.loginCta.buttonPending : COPY.unauth.loginCta.buttonIdle}
                      </Button>
                    </form>
                  </Form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title={COPY.meta.title}
        description={COPY.meta.description}
        keywords={COPY.meta.keywords}
        canonicalUrl={COPY.meta.canonicalUrl}
      />
      <BackHeader
        title={COPY.main.backHeaderTitle}
        fallbackHref="/"
        icon={Store}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {isAuthenticated && user && user.userType !== "admin" && user.userType !== "staff" && (
          <Card className="mb-4 border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] shadow-clean">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                {COPY.main.authenticatedBanner.title}
              </p>
              <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                {COPY.main.authenticatedBanner.body}
              </p>
              <p className="mt-2 text-xs text-[color:var(--text-secondary)]">
                {COPY.main.authenticatedBanner.freeLine}
              </p>
              <p className="mt-1 text-xs font-semibold text-[color:var(--text-primary)]">
                {COPY.main.authenticatedBanner.paidLine}
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="mb-6 border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardContent className="p-6">
            <div className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
              {COPY.main.hero.badge}
            </div>
            <h1 className="mt-3 text-2xl font-black leading-tight text-[color:var(--text-primary)] sm:text-3xl">
              {mainHero.title}
            </h1>
            <p className="mt-2 text-sm text-[color:var(--text-secondary)] sm:text-base">
              {mainHero.subtitle}
            </p>
          </CardContent>
        </Card>

        <div className="mb-5 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-[color:var(--action-primary)] bg-[var(--bg-surface-muted)] px-3 py-1 text-sm text-[color:var(--action-primary)]">
            <span className="font-bold">1</span>
            <span>{COPY.steps.businessDetails} (Minimal)</span>
          </div>
        </div>

        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardContent className="p-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit, handleRestaurantInvalid)} className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-business-name">{COPY.forms.restaurant.nameLabel}</FormLabel>
                        <FormControl><Input placeholder={COPY.forms.restaurant.namePlaceholder} data-testid="input-business-name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="businessType" render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-business-type">{COPY.forms.restaurant.businessTypeLabel}</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger data-testid="select-business-type"><SelectValue placeholder={COPY.forms.restaurant.businessTypePlaceholder} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="food_truck">Food Truck</SelectItem>
                            <SelectItem value="restaurant">Restaurant</SelectItem>
                            <SelectItem value="bar">Bar</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          {COPY.forms.restaurant.businessTypeHelp}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  {selectedBusinessType === "food_truck" && (
                    <div className="space-y-3 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-4">
                      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">{COPY.forms.restaurant.claimTitle}</h3>
                      <p className="text-xs text-[color:var(--text-secondary)]">{COPY.forms.restaurant.claimDescription}</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input value={claimQuery} onChange={(e) => setClaimQuery(e.target.value)} placeholder={COPY.forms.restaurant.claimSearchPlaceholder} data-testid="input-claim-search" />
                        <Button type="button" variant="outline" onClick={handleClaimSearch} disabled={claimLoading} data-testid="button-claim-search">{COPY.forms.restaurant.claimSearchButton}</Button>
                      </div>
                      {claimSelection && (
                        <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
                          <p className="font-semibold text-[color:var(--text-primary)]">{COPY.forms.restaurant.claimSelectedLabel}</p>
                          <p className="text-[color:var(--text-secondary)]">{claimSelection.name}</p>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setClaimSelection(null)} data-testid="button-claim-clear">{COPY.forms.restaurant.claimClearButton}</Button>
                        </div>
                      )}
                      {claimResults.length > 0 && !claimSelection && (
                        <div className="space-y-2">
                          {claimResults.map((listing) => (
                            <div key={listing.id} className="flex items-center justify-between rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
                              <div>
                                <p className="font-medium text-[color:var(--text-primary)]">{listing.name}</p>
                                {listing.invited && (
                                  <p className="text-[11px] text-[color:var(--text-secondary)]">
                                    This truck has an invited owner.
                                  </p>
                                )}
                              </div>
                              {listing.canClaim !== false ? (
                                <Button type="button" size="sm" onClick={() => applyClaimSelection(listing)} data-testid={`button-claim-select-${listing.id}`}>{COPY.forms.restaurant.claimSelectButton}</Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    claimRequestingId === listing.id ||
                                    Number(listing.requestCooldownMinutes || 0) > 0
                                  }
                                  onClick={() => handleRequestTruck(listing.id)}
                                  data-testid={`button-claim-request-${listing.id}`}
                                >
                                  {Number(listing.requestCooldownMinutes || 0) > 0
                                    ? `Try again in ${listing.requestCooldownMinutes}m`
                                    : claimRequestingId === listing.id
                                      ? "Sending..."
                                      : "Request this truck"}
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {claimError && <p className="text-xs text-[color:var(--text-secondary)]">{claimError}</p>}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="address" render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel data-testid="label-address">{COPY.forms.restaurant.addressLabel}</FormLabel>
                        <FormControl><Input placeholder={COPY.forms.restaurant.addressPlaceholder} data-testid="input-address" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="city" render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-city">{COPY.forms.restaurant.cityLabel}</FormLabel>
                        <FormControl><Input placeholder={COPY.forms.restaurant.cityPlaceholder} data-testid="input-city" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="state" render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-state">{COPY.forms.restaurant.stateLabel}</FormLabel>
                        <FormControl><Input placeholder={COPY.forms.restaurant.statePlaceholder} data-testid="input-state" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="phone" render={({ field }) => (
                      <FormItem>
                        <FormLabel data-testid="label-phone">{COPY.forms.restaurant.phoneLabel}</FormLabel>
                        <FormControl><Input type="tel" placeholder={COPY.forms.restaurant.phonePlaceholder} data-testid="input-phone" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[color:var(--text-primary)]">
                          Optional profile details
                        </p>
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Skip for now to finish onboarding faster.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowOptionalDetails((prev) => !prev)}
                        data-testid="button-toggle-optional-details"
                      >
                        {showOptionalDetails ? "Hide" : "Add details"}
                      </Button>
                    </div>

                    {showOptionalDetails && (
                      <div className="mt-4 space-y-4">
                        <FormField control={form.control} name="cuisineType" render={({ field }) => (
                          <FormItem>
                            <FormLabel data-testid="label-cuisine-type">{COPY.forms.restaurant.cuisineLabel}</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger data-testid="select-cuisine"><SelectValue placeholder={COPY.forms.restaurant.cuisinePlaceholder} /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="american">American</SelectItem>
                                <SelectItem value="bbq">BBQ</SelectItem>
                                <SelectItem value="breakfast">Breakfast</SelectItem>
                                <SelectItem value="burgers">Burgers</SelectItem>
                                <SelectItem value="cajun">Cajun</SelectItem>
                                <SelectItem value="caribbean">Caribbean</SelectItem>
                                <SelectItem value="coffee">Coffee & Café</SelectItem>
                                <SelectItem value="dessert">Dessert</SelectItem>
                                <SelectItem value="healthy">Healthy & Bowls</SelectItem>
                                <SelectItem value="keto">Keto & Low-Carb</SelectItem>
                                <SelectItem value="paleo">Paleo</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="description" render={({ field }) => (
                          <FormItem>
                            <FormLabel>About Your Business</FormLabel>
                            <FormControl>
                              <textarea placeholder="Tell customers what makes your restaurant unique..." rows={4} maxLength={500} className="w-full rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 py-2 text-sm text-[color:var(--text-primary)]" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid gap-4 sm:grid-cols-3">
                          <FormField control={form.control} name="websiteUrl" render={({ field }) => (<FormItem><FormLabel>Website</FormLabel><FormControl><Input type="url" placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={form.control} name="instagramUrl" render={({ field }) => (<FormItem><FormLabel>Instagram</FormLabel><FormControl><Input type="url" placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                          <FormField control={form.control} name="facebookPageUrl" render={({ field }) => (<FormItem><FormLabel>Facebook</FormLabel><FormControl><Input type="url" placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                        </div>
                        {selectedBusinessType !== "food_truck" && (
                          <div className="grid gap-2 sm:grid-cols-3">
                            <FormField control={form.control} name="hasParking" render={({ field }) => (<FormItem className="flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="m-0">Parking Available</FormLabel></FormItem>)} />
                            <FormField control={form.control} name="hasWifi" render={({ field }) => (<FormItem className="flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="m-0">Free Wi-Fi</FormLabel></FormItem>)} />
                            <FormField control={form.control} name="hasOutdoorSeating" render={({ field }) => (<FormItem className="flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel className="m-0">Outdoor Seating</FormLabel></FormItem>)} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-4">
                    <p className="text-sm font-medium text-[color:var(--text-primary)]">
                      {COPY.pricing.formCard.title}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                      {COPY.pricing.formCard.badge}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                      {COPY.pricing.formCard.freeProfileLine}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
                      {COPY.pricing.formCard.trialLine}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[color:var(--text-primary)]">
                      {COPY.pricing.formCard.paidLine}
                    </p>
                  </div>

                  <FormField control={form.control} name="acceptTerms" render={({ field }) => (
                    <FormItem className="flex items-start gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} className="mt-1" data-testid="checkbox-terms" /></FormControl>
                      <div className="space-y-1">
                        <FormLabel className="text-sm text-[color:var(--text-secondary)]" data-testid="label-terms">
                          {COPY.terms.labelPrefix}{" "}
                          <Link href="/terms-of-service"><span className="cursor-pointer text-[color:var(--accent-text)] underline">{COPY.terms.termsText}</span></Link>{" "}
                          {COPY.terms.andText}{" "}
                          <Link href="/privacy-policy"><span className="cursor-pointer text-[color:var(--accent-text)] underline">{COPY.terms.privacyText}</span></Link>
                        </FormLabel>
                        <FormMessage />
                      </div>
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full action-primary hover:bg-[color:var(--action-hover)]" disabled={createRestaurantMutation.isPending} data-testid="button-start-trial">
                    {createRestaurantMutation.isPending ? COPY.cta.restaurantSubmit.pending : COPY.cta.restaurantSubmit.idle}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
      </div>
    </div>
  );
}




