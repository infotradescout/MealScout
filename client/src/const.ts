import { authUrl } from "@/lib/api";

/**
 * Get the login URL for redirecting users to authentication
 * Defaults to Google OAuth for customers
 */
export function getLoginUrl(returnPath?: string): string {
  const loginUrl = authUrl("/api/auth/google/customer");
  if (!returnPath) return loginUrl;
  
  // Add return path as query parameter
  const url = new URL(loginUrl, typeof window !== "undefined" ? window.location.origin : "https://mealscout.us");
  url.searchParams.set("returnTo", returnPath);
  return url.toString();
}
