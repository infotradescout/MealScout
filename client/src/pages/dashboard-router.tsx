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

  return (
    <main className="flex min-h-screen items-center justify-center px-4 text-center">
      <p className="text-sm text-muted-foreground">
        {isLoading ? "Loading your dashboard..." : "Opening your dashboard..."}
      </p>
    </main>
  );
}
