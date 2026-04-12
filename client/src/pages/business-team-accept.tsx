import { useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

export default function BusinessTeamAcceptPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return String(params.get("token") || "");
  }, []);

  const acceptInvite = useMutation({
    mutationFn: async () =>
      await apiRequest("POST", "/api/business/team/invites/accept", { token }),
    onSuccess: () => {
      toast({
        title: "Access granted",
        description: "You now have business feature access.",
      });
      setLocation("/restaurant-owner-dashboard");
    },
    onError: (error: any) => {
      toast({
        title: "Invite could not be accepted",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[var(--bg-layered)]">
      <BackHeader title="Accept Team Access" fallbackHref="/" />
      <main className="p-4 pt-8">
        <Card className="shadow-clean border-[color:var(--border-subtle)]">
          <CardContent className="p-6 text-center space-y-4">
            <h1 className="text-lg font-semibold">Join this business team</h1>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Accept to unlock the feature permissions shared with you.
            </p>
            <Button
              className="w-full"
              onClick={() => acceptInvite.mutate()}
              disabled={!token || acceptInvite.isPending || !isAuthenticated}
            >
              Accept Access
            </Button>
            {!isAuthenticated ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  (window.location.href = `/login?redirect=${encodeURIComponent(
                    window.location.pathname + window.location.search,
                  )}`)
                }
              >
                Log in to accept
              </Button>
            ) : null}
            {!token ? (
              <p className="text-xs text-[color:var(--status-error)]">
                Invite token missing from this link.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
