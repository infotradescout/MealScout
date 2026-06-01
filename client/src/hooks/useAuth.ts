import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { setAffiliateRef } from "@/lib/share";

export type AuthState = "loading" | "authenticated" | "guest";

export function useAuth() {
  const [, setLocation] = useLocation();
  const {
    data: user,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<
    User & {
      requiresPasswordReset?: boolean;
      loginAnnouncement?: string;
      businessOnboardingRequired?: boolean;
      businessOnboardingPath?: string | null;
      businessAccessSummary?: {
        linkState?: "linked" | "not_attached";
        guidance?: string | null;
        restaurantCount?: number;
        primaryRestaurantId?: string | null;
      } | null;
      accountOnboardingComplete?: boolean;
      primaryBusinessId?: string | null;
      profileComplete?: boolean;
      verificationRequired?: boolean;
      emailVerified?: boolean;
      businessInsuranceSubmitted?: boolean;
      menuRequired?: boolean;
      menuItemCount?: number;
      scheduleRequired?: boolean;
      hasSchedule?: boolean;
      nextRequiredStep?:
        | "account_onboarding"
        | "business_setup"
        | "profile"
        | "profile_visual"
        | "verification"
        | "menu"
        | "schedule"
        | "complete";
      continuationPath?: string | null;
      continuationReason?: string | null;
    }
  >({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull", timeoutMs: 6000 }),
    retry: (failureCount, error: any) => {
      const message = String(error?.message || "").toLowerCase();
      const isTransient =
        message.includes("service unavailable") ||
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("failed to fetch") ||
        message.includes("503");
      return isTransient && failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: 5 * 60_000, // Consider user data fresh for 5 minutes (reduce auth calls)
  });

  const authState: AuthState =
    isLoading || (isError && !user)
      ? "loading"
      : user
      ? "authenticated"
      : "guest";

  // Check for password reset requirement
  useEffect(() => {
    if (
      user?.requiresPasswordReset &&
      window.location.pathname !== "/change-password"
    ) {
      console.log("🔒 User must reset password, redirecting...");
      setLocation("/change-password");
    }
  }, [user, setLocation]);

  useEffect(() => {
    if (!user) return;
    const pathname = window.location.pathname || "";
    const continuationPath = String(user.continuationPath || "").trim();
    if (!continuationPath) return;
    const continuationUrl = new URL(continuationPath, window.location.origin);
    const continuationTarget =
      continuationUrl.pathname + continuationUrl.search + continuationUrl.hash;

    const ignoredPrefixes = ["/logout", "/login", "/post-verification"];
    if (ignoredPrefixes.some((prefix) => pathname.startsWith(prefix))) return;
    if (pathname.includes("/callback")) return;
    if (window.location.pathname + window.location.search === continuationTarget) {
      return;
    }

    const isAdminUser = ["admin", "duper_admin", "super_admin"].includes(
      String(user.userType || "").toLowerCase(),
    );
    if (isAdminUser && pathname.startsWith("/admin")) return;

    const nextRequiredStep = String(user.nextRequiredStep || "").toLowerCase();
    const hardBlockingStep =
      nextRequiredStep === "account_onboarding" ||
      nextRequiredStep === "business_setup";
    if (!hardBlockingStep) return;

    setLocation(continuationTarget);
  }, [user, setLocation]);

  useEffect(() => {
    if (!user?.businessOnboardingRequired) return;
    const pathname = window.location.pathname || "";
    const setupOnlyRoutes =
      pathname.startsWith("/parking-pass") ||
      pathname.startsWith("/restaurant-owner-dashboard") ||
      pathname.startsWith("/deal-creation") ||
      pathname.startsWith("/kitchen") ||
      pathname.startsWith("/orders");
    if (!setupOnlyRoutes) return;
    const target =
      user.businessOnboardingPath ||
      (user.userType === "food_truck"
        ? "/restaurant-signup?businessType=food_truck&source=auth-guard&claim=1"
        : "/restaurant-signup?businessType=restaurant&source=auth-guard&claim=1");
    setLocation(target);
  }, [user?.businessOnboardingRequired, user?.businessOnboardingPath, user?.userType, setLocation]);

  useEffect(() => {
    if (user?.affiliateTag || user?.id) {
      setAffiliateRef(user.affiliateTag || user.id);
    } else {
      setAffiliateRef(null);
    }
  }, [user?.affiliateTag, user?.id]);

  // Check for OAuth redirect completion and refresh auth state
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasAuthParams =
      urlParams.has("code") ||
      urlParams.has("state") ||
      urlParams.has("auth") ||
      window.location.pathname.includes("/callback");

    if (hasAuthParams) {
      console.log("🔄 OAuth redirect detected, refreshing auth state");
      // Short delay to ensure session is established
      const timeoutId = setTimeout(() => {
        refetch();
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [refetch]);

  return {
    user,
    isLoading,
    isError,
    error,
    authState,
    isAuthenticated: authState === "authenticated",
    isGuest: authState === "guest",
    requiresPasswordReset: user?.requiresPasswordReset || false,
    refetch,
  };
}
