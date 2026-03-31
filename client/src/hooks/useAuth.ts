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
  } = useQuery<User & { requiresPasswordReset?: boolean }>({
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

  const authState: AuthState = isLoading
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
