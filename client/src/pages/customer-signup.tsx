import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Mail, Eye, EyeOff, UserPlus, ArrowLeft } from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";
import {
  PASSWORD_REGEX,
  PASSWORD_REQUIREMENTS,
} from "@/utils/passwordPolicy";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";

const signupSchema = z
  .object({
    email: z.string().email("Valid email is required"),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
    otpCode: z.string().optional(),
    password: z
      .string()
      .min(1, PASSWORD_REQUIREMENTS)
      .regex(PASSWORD_REGEX, PASSWORD_REQUIREMENTS),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type SignupFormData = z.infer<typeof signupSchema>;

export default function CustomerSignup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const requirePhoneVerification = false;

  const searchParams = new URLSearchParams(window.location.search);
  const role = searchParams.get("role");
  const initialAccountType:
    | "diner"
    | "host"
    | "event_organizer"
    | "business"
    | "supplier" =
    role === "business"
      ? "business"
      : role === "host"
        ? "host"
        : role === "event"
          ? "event_organizer"
          : role === "event_coordinator"
            ? "event_organizer"
        : role === "supplier"
          ? "supplier"
          : "diner";
  const [accountType, setAccountType] = useState<
    "diner" | "host" | "event_organizer" | "business" | "supplier"
  >(
    initialAccountType
  );
  const initialBusinessSubType: "restaurant" | "food_truck" =
    searchParams.get("businessType") === "food_truck" ? "food_truck" : "restaurant";
  const [businessSubType, setBusinessSubType] = useState<
    "restaurant" | "food_truck"
  >(initialAccountType === "business" ? initialBusinessSubType : "restaurant");
  const SIGNUP_DRAFT_KEY = "mealscout:customer-signup-draft";

  useEffect(() => {
    trackFunnelEventOncePerSession(FUNNEL_EVENTS.signupStarted, "customer_signup_view", {
      page: "customer-signup",
      accountType: initialAccountType,
      businessSubType: initialBusinessSubType,
      stage: "signup_view",
    });
  }, [initialAccountType, initialBusinessSubType]);

  const defaultValues = useMemo<SignupFormData>(() => {
    const base: SignupFormData = {
      email: "",
      firstName: "",
      lastName: "",
      phone: "",
      otpCode: "",
      password: "",
      confirmPassword: "",
    };

    if (typeof window === "undefined") return base;

    try {
      const stored = window.localStorage.getItem(SIGNUP_DRAFT_KEY);
      if (!stored) return base;
      const parsed = JSON.parse(stored) as Partial<SignupFormData>;
      // Never pre-fill passwords from storage for safety
      delete (parsed as any).password;
      delete (parsed as any).confirmPassword;
      return { ...base, ...parsed };
    } catch {
      return base;
    }
  }, []);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues,
  });

  // Persist non-sensitive draft so interrupted users can resume later
  useEffect(() => {
    const subscription = form.watch((value) => {
      try {
        const { password, confirmPassword, ...rest } = value;
        window.localStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(rest));
      } catch {
        // ignore storage errors
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  useEffect(() => {
    if (accountType !== "business") {
      setBusinessSubType("restaurant");
    }
  }, [accountType]);

  const customerSignupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const { confirmPassword, ...signupData } = data;
      const res = await apiRequest(
        "POST",
        "/api/auth/customer/register",
        signupData
      );
      return await res.json();
    },
    onSuccess: async (payload: any) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
      }
      const redirectAfterLogin =
        accountType === "host"
          ? "/host-signup"
          : accountType === "event_organizer"
            ? "/events"
          : accountType === "business"
            ? "/restaurant-signup"
            : "/";
      try {
        window.sessionStorage.setItem(
          "mealscout:lastSignupEmail",
          form.getValues("email") || "",
        );
      } catch {}
      toast({
        title: "Verify your email",
        description:
          payload?.message ||
          "We sent a verification link to your email. Verify it, then log in to continue.",
      });
      trackFunnelEvent(FUNNEL_EVENTS.signupCompleted, {
        page: "customer-signup",
        accountType: "diner_or_host",
        stage: "signup_success",
      });
      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        page: "customer-signup",
        stage: "redirect_to_login",
        redirectPath: redirectAfterLogin,
      });
      window.location.href = `/login?redirect=${encodeURIComponent(
        redirectAfterLogin,
      )}&signup=1`;
    },
    onError: (error) => {
      toast({
        title: "Signup Failed",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    },
  });

  const businessSignupMutation = useMutation({
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
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
      }
      try {
        window.sessionStorage.setItem(
          "mealscout:lastSignupEmail",
          form.getValues("email") || "",
        );
      } catch {}
      toast({
        title: "Verify your email",
        description:
          payload?.message ||
          "We sent a verification link to your email. Verify it, then log in to continue.",
      });
      trackFunnelEvent(FUNNEL_EVENTS.signupCompleted, {
        page: "customer-signup",
        accountType: "business",
        businessSubType,
        stage: "signup_success",
      });
      const businessRedirect =
        businessSubType === "food_truck"
          ? "/restaurant-signup?businessType=food_truck&claim=1"
          : "/restaurant-signup";
      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        page: "customer-signup",
        stage: "redirect_to_login",
        redirectPath: businessRedirect,
        accountType: "business",
        businessSubType,
      });
      window.location.href = `/login?redirect=${encodeURIComponent(
        businessRedirect,
      )}&signup=1`;
    },
    onError: (error) => {
      toast({
        title: "Business signup failed",
        description: error.message || "Failed to create business account",
        variant: "destructive",
      });
    },
  });

  const supplierSignupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const { confirmPassword, ...signupData } = data;
      const res = await apiRequest(
        "POST",
        "/api/auth/supplier/register",
        signupData
      );
      return await res.json();
    },
    onSuccess: async (payload: any) => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SIGNUP_DRAFT_KEY);
      }
      try {
        window.sessionStorage.setItem(
          "mealscout:lastSignupEmail",
          form.getValues("email") || "",
        );
      } catch {}
      toast({
        title: "Verify your email",
        description:
          payload?.message ||
          "We sent a verification link to your email. Verify it, then log in to continue.",
      });
      trackFunnelEvent(FUNNEL_EVENTS.signupCompleted, {
        page: "customer-signup",
        accountType: "supplier",
        stage: "signup_success",
      });
      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        page: "customer-signup",
        stage: "redirect_to_login",
        redirectPath: "/supplier/dashboard",
        accountType: "supplier",
      });
      window.location.href = `/login?redirect=${encodeURIComponent(
        "/supplier/dashboard",
      )}&signup=1`;
    },
    onError: (error) => {
      toast({
        title: "Supplier signup failed",
        description: error.message || "Failed to create supplier account",
        variant: "destructive",
      });
    },
  });

  const activateSupplierProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/supplier/profile/activate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Failed to activate supplier profile");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier/me"] });
      toast({
        title: "Supplier profile created",
        description: "Your supplier profile was added to this account.",
      });
      setLocation("/supplier/dashboard");
    },
    onError: (error: any) => {
      toast({
        title: "Unable to create supplier profile",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const continueWithExistingAccount = () => {
    if (accountType === "host") {
      setLocation("/host-signup");
      return;
    }
    if (accountType === "event_organizer") {
      setLocation("/events");
      return;
    }

    if (accountType === "business") {
      const businessRedirect =
        businessSubType === "food_truck"
          ? "/restaurant-signup?businessType=food_truck&claim=1"
          : "/restaurant-signup";
      setLocation(businessRedirect);
      return;
    }

    if (accountType === "supplier") {
      activateSupplierProfileMutation.mutate();
      return;
    }

    setLocation("/dashboard");
  };

  const onSubmit = (data: SignupFormData) => {
    if (isAuthenticated) {
      trackFunnelEvent(FUNNEL_EVENTS.activationStarted, {
        page: "customer-signup",
        stage: "continue_with_existing_account",
        accountType,
        businessSubType,
      });
      continueWithExistingAccount();
      return;
    }

    trackFunnelEvent(FUNNEL_EVENTS.signupSubmitted, {
      page: "customer-signup",
      accountType,
      businessSubType: accountType === "business" ? businessSubType : null,
      stage: "signup_submit",
      isAuthenticated,
    });

    if (accountType === "business") {
      const digitsOnly = (data.phone || "").replace(/\D/g, "");
      if (!digitsOnly || digitsOnly.length < 10) {
        form.setError("phone", {
          type: "manual",
          message: "Valid phone number is required for business accounts",
        });
        return;
      }
      if (requirePhoneVerification && !data.otpCode) {
        form.setError("otpCode", {
          type: "manual",
          message: "Verification code is required",
        });
        return;
      }
      businessSignupMutation.mutate(data);
    } else if (accountType === "host") {
      // Hosts signup as customers but we can add host-specific flow later
      if (requirePhoneVerification && !data.otpCode) {
        form.setError("otpCode", {
          type: "manual",
          message: "Verification code is required",
        });
        return;
      }
      customerSignupMutation.mutate(data);
    } else if (accountType === "supplier") {
      if (requirePhoneVerification && !data.otpCode) {
        form.setError("otpCode", {
          type: "manual",
          message: "Verification code is required",
        });
        return;
      }
      supplierSignupMutation.mutate(data);
    } else {
      if (requirePhoneVerification && !data.otpCode) {
        form.setError("otpCode", {
          type: "manual",
          message: "Verification code is required",
        });
        return;
      }
      customerSignupMutation.mutate(data);
    }
  };

  const handleSendOtp = async () => {
    const phone = form.getValues("phone") || "";
    const digitsOnly = phone.replace(/\D/g, "");
    if (!digitsOnly || digitsOnly.length < 10) {
      form.setError("phone", {
        type: "manual",
        message: "Enter a valid phone number before sending a code",
      });
      return;
    }

    setOtpSending(true);
    try {
      await apiRequest("POST", "/api/auth/phone/send-code", {
        phone: digitsOnly,
      });
      setOtpSent(true);
      toast({
        title: "Code sent",
        description: "Check your phone for the verification code.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to send code",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setOtpSending(false);
    }
  };

  const isSubmitting =
    customerSignupMutation.isPending ||
    businessSignupMutation.isPending ||
    supplierSignupMutation.isPending ||
    activateSupplierProfileMutation.isPending;

  const existingAccountActionLabel =
    accountType === "host"
      ? "Create host profile"
      : accountType === "event_organizer"
        ? "Create event organizer profile"
      : accountType === "business"
        ? businessSubType === "food_truck"
          ? "Create food truck profile"
          : "Create restaurant profile"
        : accountType === "supplier"
          ? "Create supplier profile"
          : "Go to dashboard";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)] flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-[color:var(--action-primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)] flex flex-col">
        <BackHeader
          title="Account Setup"
          fallbackHref="/dashboard"
          icon={UserPlus}
          className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
        />
        <main className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
          <div className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] rounded-2xl shadow-clean-lg p-4 space-y-4">
            <div className="text-center">
              <h1 className="text-xl font-bold text-[color:var(--text-primary)]">You are already signed in</h1>
              <p className="text-sm text-[color:var(--text-secondary)] mt-1">
                Add another profile to this same account instead of creating a new login.
              </p>
            </div>

            <div className="inline-flex rounded-full bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] shadow-clean text-[11px] font-medium text-[color:var(--text-secondary)] overflow-hidden w-full">
              <button
                type="button"
                onClick={() => setAccountType("business")}
                className={`flex-1 px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                  accountType === "business"
                    ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                    : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                }`}
              >
                Business
              </button>
              <button
                type="button"
                onClick={() => setAccountType("diner")}
                className={`flex-1 px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                  accountType === "diner"
                    ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                    : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                }`}
              >
                Diner
              </button>
              <button
                type="button"
                onClick={() => setAccountType("host")}
                className={`flex-1 px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                  accountType === "host"
                    ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                    : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                }`}
              >
                Host
              </button>
              <button
                type="button"
                onClick={() => setAccountType("event_organizer")}
                className={`flex-1 px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                  accountType === "event_organizer"
                    ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                    : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                }`}
              >
                Event Organizer
              </button>
              <button
                type="button"
                onClick={() => setAccountType("supplier")}
                className={`flex-1 px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                  accountType === "supplier"
                    ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                    : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                }`}
              >
                Supplier
              </button>
            </div>

            {accountType === "business" && (
              <div className="inline-flex w-full overflow-hidden rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-clean">
                <button
                  type="button"
                  onClick={() => setBusinessSubType("restaurant")}
                  className={`flex-1 px-3 py-2 transition-colors ${
                    businessSubType === "restaurant"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Restaurant
                </button>
                <button
                  type="button"
                  onClick={() => setBusinessSubType("food_truck")}
                  className={`flex-1 border-l border-[color:var(--border-subtle)] px-3 py-2 transition-colors ${
                    businessSubType === "food_truck"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Food Truck
                </button>
              </div>
            )}

            <Button
              type="button"
              onClick={continueWithExistingAccount}
              disabled={isSubmitting}
              className="w-full py-3 font-semibold text-base rounded-2xl bg-[color:var(--action-primary)] hover:bg-[color:var(--action-hover)] text-[color:var(--action-primary-text)] border-0 shadow-clean"
            >
              {isSubmitting ? "Working..." : existingAccountActionLabel}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] flex flex-col">
      <SEOHead
        title="Sign Up - MealScout | Create Free Account"
        description="Join MealScout for free and start discovering exclusive food deals from local restaurants. Save your favorites, track deals, and never miss amazing dining discounts."
        keywords="sign up, create account, register, join mealscout, free account, food deals signup"
        canonicalUrl="https://www.mealscout.us/customer-signup"
        noIndex={true}
      />
      <h1 className="sr-only">Create a MealScout account</h1>
      <BackHeader
        title="Create Account"
        fallbackHref="/"
        icon={UserPlus}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <main className="flex-1 px-4 py-2 max-w-md mx-auto flex flex-col justify-between">
        {/* Top: hero + form */}
        <div>
          {/* Welcome Section (highly compressed) */}
          <div className="text-center mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500 rounded-2xl mb-1 flex items-center justify-center mx-auto shadow-clean-lg ring-2 ring-white/70">
              <UserPlus className="w-5 h-5 text-white drop-shadow" />
            </div>
            <h2 className="text-lg font-bold text-[color:var(--text-primary)] mb-1 tracking-tight">
              Create Your MealScout Account
            </h2>
            <p className="text-[color:var(--text-secondary)] text-xs leading-snug max-w-sm mx-auto">
              {accountType === "business"
                ? "Create your login so we can connect your restaurant or truck, list your deals, and pass savings directly to your regulars."
                : accountType === "host"
                ? "Post and manage parking-host locations for trucks and local diners."
                : accountType === "event_organizer"
                ? "Publish events, coordinate vendor attendance, and manage event demand."
                : accountType === "supplier"
                ? "Set up your supplier profile, publish products, and accept orders from food trucks and restaurants."
                : "Save favorite deals and never miss new drops from local spots."}
            </p>
          </div>

          {/* Signup Form */}
          <div className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] rounded-2xl shadow-clean-lg p-4">
            {/* Account type selection inside form */}
            <div className="flex justify-center mb-4">
              <div className="inline-flex rounded-full bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] shadow-clean text-[11px] font-medium text-[color:var(--text-secondary)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAccountType("business")}
                  className={`px-3 py-1 transition-colors ${
                    accountType === "business"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Restaurant / Food Truck
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("diner")}
                  className={`px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                    accountType === "diner"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Diner
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("host")}
                  className={`px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                    accountType === "host"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Host
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("event_organizer")}
                  className={`px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                    accountType === "event_organizer"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Event Organizer
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType("supplier")}
                  className={`px-3 py-1 border-l border-[color:var(--border-subtle)] transition-colors ${
                    accountType === "supplier"
                      ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                      : "bg-transparent text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  Supplier
                </button>
              </div>
            </div>

            {accountType === "business" && (
              <div className="mb-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
                  Business Type
                </div>
                <div className="mt-2 inline-flex w-full overflow-hidden rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] font-semibold text-[color:var(--text-secondary)] shadow-clean">
                  <button
                    type="button"
                    onClick={() => setBusinessSubType("restaurant")}
                    className={`flex-1 px-3 py-2 transition-colors ${
                      businessSubType === "restaurant"
                        ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                        : "bg-transparent hover:bg-[var(--bg-surface-muted)]"
                    }`}
                    data-testid="button-business-type-restaurant"
                  >
                    Restaurant
                  </button>
                  <button
                    type="button"
                    onClick={() => setBusinessSubType("food_truck")}
                    className={`flex-1 border-l border-[color:var(--border-subtle)] px-3 py-2 transition-colors ${
                      businessSubType === "food_truck"
                        ? "bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)]"
                        : "bg-transparent hover:bg-[var(--bg-surface-muted)]"
                    }`}
                    data-testid="button-business-type-food-truck"
                  >
                    Food Truck (Claim)
                  </button>
                </div>
                {businessSubType === "food_truck" && (
                  <div className="mt-2 text-xs text-[color:var(--text-secondary)]">
                    Create your account, then claim your truck from the registry list.
                    We’ll keep it inactive and unverified until you submit verification.
                  </div>
                )}
              </div>
            )}

            <div className="text-center mb-4">
              <h3 className="text-lg font-bold text-[color:var(--text-primary)] mb-1">
                Sign Up with Email
              </h3>
              <p className="text-[color:var(--text-secondary)] text-xs">
                {accountType === "business"
                  ? "This login powers your business dashboard. Pricing stays transparent and your discounts go straight to your guests."
                  : accountType === "host"
                  ? "This login lets you manage host locations and parking availability."
                : accountType === "event_organizer"
                  ? "This login gives you event organizer tools and vendor scheduling access."
                  : accountType === "supplier"
                  ? "This login powers your supplier dashboard, products, and incoming orders."
                  : "Create your account to get started with local food deals."}
              </p>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-first-name"
                            autoComplete="given-name"
                            placeholder="John"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-last-name"
                            autoComplete="family-name"
                            placeholder="Doe"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] w-4 h-4" />
                          <Input
                            data-testid="input-email"
                            type="email"
                            autoComplete="email"
                            placeholder="john@example.com"
                            className="pl-10"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input
                            data-testid="input-phone"
                            type="tel"
                            autoComplete="tel"
                            placeholder="(555) 123-4567"
                            {...field}
                          />
                          {requirePhoneVerification && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleSendOtp}
                              disabled={otpSending}
                            >
                              {otpSending
                                ? "Sending..."
                                : otpSent
                                  ? "Resend"
                                  : "Send code"}
                            </Button>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {requirePhoneVerification && (
                  <FormField
                    control={form.control}
                    name="otpCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Verification Code</FormLabel>
                        <FormControl>
                          <InputOTP
                            maxLength={6}
                            value={field.value}
                            onChange={field.onChange}
                          >
                            <InputOTPGroup>
                              {[0, 1, 2, 3, 4, 5].map((index) => (
                                <InputOTPSlot key={index} index={index} />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            data-testid="input-password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="Enter password"
                            {...field}
                          />
                          <button
                            data-testid="button-toggle-password"
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            data-testid="input-confirm-password"
                            type={showConfirmPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="Confirm password"
                            {...field}
                          />
                          <button
                            data-testid="button-toggle-confirm-password"
                            type="button"
                            onClick={() =>
                              setShowConfirmPassword(!showConfirmPassword)
                            }
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  data-testid="button-create-account"
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 font-semibold text-base rounded-2xl bg-[color:var(--action-primary)] hover:bg-[color:var(--action-hover)] text-[color:var(--action-primary-text)] border-0 shadow-clean hover:shadow-clean-lg transform hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {isSubmitting ? (
                    <div className="animate-spin w-5 h-5 mr-3 border-2 border-white border-t-transparent rounded-full" />
                  ) : null}
                  {accountType === "business" && businessSubType === "food_truck"
                    ? "Create Account & Claim Food Truck"
                    : "Create Account"}
                </Button>
              </form>
            </Form>

            {/* Divider + Login Link (compressed) */}
            <div className="mt-3 flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
              <span>Already have an account?</span>
              <Link href="/login">
                <button
                  type="button"
                  className="text-[color:var(--accent-text)] underline hover:text-[color:var(--accent-text)]"
                  data-testid="button-sign-in"
                >
                  Sign in
                </button>
              </Link>
            </div>

            {/* Trust indicators (compressed) */}
            <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2 flex items-center justify-center gap-4 text-[11px] leading-tight text-[color:var(--text-muted)]">
              <div className="flex items-center space-x-1">
                <svg
                  className="w-3 h-3 text-[color:var(--status-success)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>
                  {accountType === "business"
                    ? "Transparent pricing"
                    : "Local restaurants & trucks"}
                </span>
              </div>
              <div className="flex items-center space-x-1">
                <svg
                  className="w-3 h-3 text-[color:var(--status-success)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                <span>
                  {accountType === "business"
                    ? "You control every discount"
                    : "Secure"}
                </span>
              </div>
              <div className="flex items-center space-x-1">
                <svg
                  className="w-3 h-3 text-[color:var(--status-success)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <span>
                  {accountType === "business"
                    ? "Local diners get the savings"
                    : "Instant Access"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Legal Links */}
        <div className="mt-2 text-center">
          <p className="text-[11px] text-[color:var(--text-muted)]">
            By creating an account, you agree to our{" "}
            <Link href="/terms-of-service">
              <span className="text-[color:var(--accent-text)] underline hover:text-[color:var(--accent-text)] cursor-pointer">
                Terms of Service
              </span>
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy">
              <span className="text-[color:var(--accent-text)] underline hover:text-[color:var(--accent-text)] cursor-pointer">
                Privacy Policy
              </span>
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}



