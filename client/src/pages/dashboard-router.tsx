import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { getRoleDashboardPath } from "@/lib/dashboard-route";

export default function DashboardRouter() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/login?redirect=/dashboard");
      return;
    }

    setLocation(getRoleDashboardPath(user));
  }, [isLoading, setLocation, user]);

  return null;
}
