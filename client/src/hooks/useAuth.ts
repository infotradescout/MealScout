import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { setAffiliateRef } from "@/lib/share";

export type AuthState = "loading" | "authenticated" | "guest";

function hasOAuthCompletionHint() {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  return (
    urlParams.has("code") ||
    urlParams.has("state") ||
    urlParams.get("auth") === "success" ||
    window.location.pathname.includes("/callback")
  );
}

function clearOAuthCompletionParams() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("auth");
  url.searchParams.delete("t");
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const [oauthConfirmationPending, setOauthConfirmationPending] = useState(() =>
    hasOAuthCompletionHint(),
  );
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
    isLoading || oauthConfirmationPending || (isError && !user)
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
    const isAccountSetupWithoutToken =
      continuationUrl.pathname === "/account-setup" &&
      !continuationUrl.searchParams.get("token");

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
      nextRequiredStep === "business_setup";
    if (nextRequiredStep === "account_onboarding" && isAccountSetupWithoutToken) return;
    if (!hardBlockingStep) return;

    setLocation(continuationTarget);
  }, [user, setLocation]);

  useEffect(() => {
    if (!user?.businessOnboardingRequired) return;
    const pathname = window.location.pathname || "";
    const setupOnlyRoutes =
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

  // Check for OAuth redirect completion and confirm the session with /api/auth/user.
  useEffect(() => {
    const hasAuthParams = hasOAuthCompletionHint();

    if (hasAuthParams) {
      console.log("🔄 OAuth redirect detected, refreshing auth state");
      // Short delay to ensure session is established
      const timeoutId = setTimeout(() => {
        setOauthConfirmationPending(true);
        refetch()
          .then((result) => {
            clearOAuthCompletionParams();
            if (!result.data) {
              setAffiliateRef(null);
              setOauthConfirmationPending(false);
              setLocation("/login?error=session_not_completed");
              return;
            }
            setOauthConfirmationPending(false);
          })
          .catch(() => {
            clearOAuthCompletionParams();
            setAffiliateRef(null);
            setOauthConfirmationPending(false);
            setLocation("/login?error=session_not_completed");
          });
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [refetch, setLocation]);

  return {
    user: oauthConfirmationPending ? undefined : user,
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
