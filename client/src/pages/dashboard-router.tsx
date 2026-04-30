import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

const ROLE_DASHBOARD_PATHS: Record<string, string> = {
  admin: "/admin/dashboard",
  super_admin: "/admin/dashboard",
  staff: "/staff",
  event_coordinator: "/events?mode=event_coordinator&src=dashboard-router",
  host: "/host/dashboard",
  food_truck: "/restaurant-owner-dashboard?mode=food_truck&src=dashboard-router",
  restaurant_owner: "/restaurant-owner-dashboard?mode=restaurant&src=dashboard-router",
  supplier: "/supplier/dashboard",
  customer: "/user-dashboard",
};

const ROLE_PRIORITY = [
  "super_admin",
  "admin",
  "staff",
  "event_coordinator",
  "host",
  "food_truck",
  "restaurant_owner",
  "supplier",
  "customer",
];

function normalizeRole(role: string | null | undefined) {
  return String(role || "").trim();
}

function getDashboardPathForRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return ROLE_DASHBOARD_PATHS[normalized] || "";
}

export default function DashboardRouter() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const roles = useMemo(() => {
    const list = new Set<string>();
    const primaryType = normalizeRole(user?.userType);
    if (primaryType) list.add(primaryType);
    if (Array.isArray(user?.roles)) {
      user.roles.forEach((role: string | null) => {
        const normalized = normalizeRole(role);
        if (normalized) list.add(normalized);
      });
    }
    return list;
  }, [user]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/login?redirect=/dashboard");
      return;
    }

    const primaryPath = getDashboardPathForRole(user.userType);
    if (primaryPath) {
      setLocation(primaryPath);
      return;
    }

    // Fallback for legacy accounts where userType is missing/inconsistent.
    for (const role of ROLE_PRIORITY) {
      if (roles.has(role)) {
        setLocation(ROLE_DASHBOARD_PATHS[role]);
        return;
      }
    }

    setLocation("/user-dashboard");
  }, [isLoading, roles, setLocation, user]);

  return null;
}
