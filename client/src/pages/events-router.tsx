import { useEffect, useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function EventsRouter() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const roleState = useMemo(() => {
    const roles = new Set<string>();
    if (user?.userType) roles.add(user.userType);
    if (Array.isArray(user?.roles)) {
      user.roles.forEach((role: string | null) => {
        if (role) roles.add(role);
      });
    }

    const isEventCoordinator = roles.has("event_coordinator");
    const isTruck = roles.has("food_truck") || roles.has("restaurant_owner");
    const isMultiRole = Number(isEventCoordinator) + Number(isTruck) > 1;

    return { isEventCoordinator, isTruck, isMultiRole };
  }, [user]);

  useEffect(() => {
    if (isLoading || roleState.isMultiRole) return;

    const destination = roleState.isEventCoordinator
      ? "/event-coordinator/dashboard"
      : roleState.isTruck
        ? "/truck-discovery"
        : "/events/public";
    setLocation(destination, { replace: true });
  }, [isLoading, roleState, setLocation]);

  if (roleState.isMultiRole) {
    return (
      <main className="min-h-screen bg-[var(--bg-layered)] px-4 py-8">
        <div className="mx-auto max-w-xl rounded-[1.75rem] border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-6 shadow-clean-lg sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
            <CalendarDays className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-[color:var(--text-primary)]">
            Events
          </h1>
          <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
            Choose the event work you need, or browse the public event list.
          </p>
          <div className="mt-6 grid gap-3">
            <Button
              className="min-h-11 justify-start"
              onClick={() => setLocation("/event-coordinator/dashboard")}
            >
              Manage organizer events
            </Button>
            <Button
              className="min-h-11 justify-start"
              variant="secondary"
              onClick={() => setLocation("/truck-discovery")}
            >
              Find truck opportunities
            </Button>
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              onClick={() => setLocation("/events/public")}
            >
              Browse food events
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] px-4 text-center">
      <p className="text-sm text-[color:var(--text-muted)]">
        {isLoading ? "Loading events…" : "Opening events…"}
      </p>
    </main>
  );
}
