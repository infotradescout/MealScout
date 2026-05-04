import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import BusinessProfileImport from "@/components/BusinessProfileImport";
import BusinessPhotoGallery from "@/components/BusinessPhotoGallery";
import { HelpWantedQuickAction } from "@/components/HelpWantedQuickAction";

interface HostProfile {
  id: string;
  businessName: string;
  address: string;
  city?: string;
  state?: string;
  locationType: string;
  contactPhone?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  stripeConnectAccountId?: string | null;
  stripeConnectStatus?: string | null;
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
  stripeOnboardingCompleted?: boolean;
  amenities?: Record<string, boolean> | null;
  showFuelPrices?: boolean;
  gasPriceRegularCents?: number | null;
  gasPriceMidgradeCents?: number | null;
  gasPricePremiumCents?: number | null;
  gasPriceDieselCents?: number | null;
  gasPriceUpdatedAt?: string | null;
}

interface HostEarningsSummary {
  accruedCents: number;
  pendingPayoutCents: number;
  paidOutCents: number;
  availableCents: number;
  stripePayoutReady: boolean;
  canRequestPayout: boolean;
}

interface HostPayoutRequest {
  id: string;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
  notes?: string | null;
  createdAt: string;
  paidAt?: string | null;
  reviewedAt?: string | null;
}

interface LocationDemandItem {
  id: string;
  businessName: string;
  address: string;
  demandStatus: string;
  status: string;
  interestCount: number;
  minInterestedTrucks: number;
  thresholdRemaining: number;
  thresholdReachedAt?: string | null;
}

function HostDashboard() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [authLoadingTimedOut, setAuthLoadingTimedOut] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [host, setHost] = useState<HostProfile | null>(null);
  const [isCheckingStripe, setIsCheckingStripe] = useState(false);
  const [earningsSummary, setEarningsSummary] =
    useState<HostEarningsSummary | null>(null);
  const [isLoadingEarnings, setIsLoadingEarnings] = useState(false);
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);
  const [payoutRequests, setPayoutRequests] = useState<HostPayoutRequest[]>([]);
  const [isLoadingPayoutRequests, setIsLoadingPayoutRequests] = useState(false);
  const [demandQueue, setDemandQueue] = useState<LocationDemandItem[]>([]);
  const [isLoadingDemand, setIsLoadingDemand] = useState(false);
  const [ownedRestaurants, setOwnedRestaurants] = useState<any[]>([]);
  const [fuelForm, setFuelForm] = useState({
    showFuelPrices: false,
    regular: "",
    midgrade: "",
    premium: "",
    diesel: "",
  });
  const [isSavingFuelPrices, setIsSavingFuelPrices] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setAuthLoadingTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setAuthLoadingTimedOut(true);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (!isAuthenticated) {
      setLocation("/login?redirect=/host/dashboard");
      return;
    }

    if (user?.userType === "event_coordinator") {
      setLocation("/events");
      return;
    }

    const fetchData = async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 12000);
      try {
        setDashboardError("");
        const hostsRes = await fetch("/api/hosts", {
          credentials: "include",
          signal: controller.signal,
        });
        if (hostsRes.status === 401 || hostsRes.status === 403) {
          setLocation("/login?redirect=/host/dashboard");
          return;
        }
        if (!hostsRes.ok) {
          throw new Error("Failed to fetch host profiles");
        }
        const hostList = await hostsRes.json();
        if (!Array.isArray(hostList) || hostList.length === 0) {
          setLocation("/host-signup");
          return;
        }

        setHosts(hostList);
        const initialHost = hostList[0];
        setSelectedHostId(initialHost.id);
        setHost(initialHost);
      } catch (error: any) {
        console.error(error);
        const message =
          error?.name === "AbortError"
            ? "Loading timed out. Please try again."
            : error?.message || "Unable to load Host Dashboard.";
        setDashboardError(message);
      } finally {
        window.clearTimeout(timeoutId);
        setIsLoadingPage(false);
      }
    };

    fetchData();
  }, [isAuthenticated, isLoading, setLocation, user]);

  useEffect(() => {
    if (!selectedHostId) return;
    const selected = hosts.find((item) => item.id === selectedHostId) || null;
    setHost(selected);
  }, [hosts, selectedHostId]);

  const centsToDollars = (value?: number | null) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? (value / 100).toFixed(2)
      : "";

  const dollarsToCents = (value: string) => {
    const normalized = value.replace(/[^0-9.]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  };

  useEffect(() => {
    if (!host) return;
    setFuelForm({
      showFuelPrices: Boolean(host.showFuelPrices),
      regular: centsToDollars(host.gasPriceRegularCents),
      midgrade: centsToDollars(host.gasPriceMidgradeCents),
      premium: centsToDollars(host.gasPricePremiumCents),
      diesel: centsToDollars(host.gasPriceDieselCents),
    });
  }, [host?.id, host?.showFuelPrices, host?.gasPriceRegularCents, host?.gasPriceMidgradeCents, host?.gasPricePremiumCents, host?.gasPriceDieselCents]);

  const saveFuelPrices = async () => {
    if (!host?.id) return;
    setIsSavingFuelPrices(true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(host.id)}/fuel-prices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          showFuelPrices: fuelForm.showFuelPrices,
          regularCents: dollarsToCents(fuelForm.regular),
          midgradeCents: dollarsToCents(fuelForm.midgrade),
          premiumCents: dollarsToCents(fuelForm.premium),
          dieselCents: dollarsToCents(fuelForm.diesel),
        }),
      });
      const updated = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(updated?.message || "Could not save fuel prices");
      }
      setHost(updated);
      setHosts((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      toast({
        title: "Fuel prices updated",
        description: fuelForm.showFuelPrices
          ? "Your public map pin can now show live gas prices."
          : "Fuel prices are hidden from the public map.",
      });
    } catch (error: any) {
      toast({
        title: "Unable to save fuel prices",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingFuelPrices(false);
    }
  };

  const loadHostEarnings = async () => {
    setIsLoadingEarnings(true);
    try {
      const hostId = selectedHostId || host?.id;
      const summaryUrl = hostId
        ? `/api/hosts/earnings/summary?hostId=${encodeURIComponent(hostId)}`
        : "/api/hosts/earnings/summary";
      const res = await fetch(summaryUrl, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Failed to load earnings summary");
      }
      const data = await res.json();
      setEarningsSummary(data);
    } catch (error) {
      console.error("Host earnings summary error:", error);
      setEarningsSummary(null);
    } finally {
      setIsLoadingEarnings(false);
    }
  };

  const loadPayoutRequests = async () => {
    setIsLoadingPayoutRequests(true);
    try {
      const hostId = selectedHostId || host?.id;
      const url = hostId
        ? `/api/hosts/earnings/payout-requests?hostId=${encodeURIComponent(hostId)}`
        : "/api/hosts/earnings/payout-requests";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payout requests");
      const data = await res.json();
      setPayoutRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (error) {
      console.error("Payout request history error:", error);
      setPayoutRequests([]);
    } finally {
      setIsLoadingPayoutRequests(false);
    }
  };

  const loadDemandQueue = async () => {
    setIsLoadingDemand(true);
    try {
      const res = await fetch("/api/location-requests/demand/me?limit=25", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to load demand queue");
      }
      const payload = await res.json();
      const rows = Array.isArray(payload?.queue) ? payload.queue : [];
      setDemandQueue(rows);
    } catch (error) {
      console.error("Demand queue error:", error);
      setDemandQueue([]);
    } finally {
      setIsLoadingDemand(false);
    }
  };

  const requestHostPayout = async () => {
    setIsRequestingPayout(true);
    try {
      const hostId = selectedHostId || host?.id;
      const res = await fetch("/api/hosts/earnings/payout-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hostId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Failed to request payout");
      }

      setEarningsSummary(data.summary || null);
      void loadPayoutRequests();
      toast({
        title: "Payout requested",
        description: "Your payout request has been submitted for review. You can track its status in the Payout History section below.",
      });
    } catch (error: any) {
      toast({
        title: "Unable to request payout",
        description: error?.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsRequestingPayout(false);
    }
  };

  useEffect(() => {
    if (!host) return;
    void loadHostEarnings();
    void loadPayoutRequests();
    void loadDemandQueue();
  }, [host?.id]);

  useEffect(() => {
    if (!isAuthenticated) {
      setOwnedRestaurants([]);
      return;
    }

    let cancelled = false;
    fetch("/api/restaurants/my-restaurants", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return [];
        return res.json().catch(() => []);
      })
      .then((rows) => {
        if (cancelled) return;
        setOwnedRestaurants(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        setOwnedRestaurants([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  const handleEnablePayments = async () => {
    try {
      const hostId = selectedHostId || host?.id;
      if (!hostId) {
        throw new Error("No host selected");
      }
      const res = await fetch("/api/hosts/stripe/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hostId }),
      });
      if (!res.ok) {
        throw new Error("Failed to initiate Stripe onboarding");
      }
      const { onboardingUrl } = await res.json();
      window.location.href = onboardingUrl;
    } catch (error) {
      console.error("Stripe onboarding error:", error);
      toast({
        title: "Error",
        description: "Failed to initiate payment setup. Please try again.",
        variant: "destructive",
      });
    }
  };

  const refreshStripeStatus = async () => {
    setIsCheckingStripe(true);
    try {
      const hostId = selectedHostId || host?.id;
      const statusUrl = hostId
        ? `/api/hosts/stripe/status?hostId=${encodeURIComponent(hostId)}`
        : "/api/hosts/stripe/status";
      const res = await fetch(statusUrl, { credentials: "include" });
      if (!res.ok) {
        throw new Error("Failed to check payment status");
      }
      const data = await res.json();
      setHost((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stripeConnectAccountId:
            data.accountId || prev.stripeConnectAccountId || null,
          stripeConnectStatus:
            data.connectStatus || prev.stripeConnectStatus || null,
          stripeChargesEnabled: data.chargesEnabled,
          stripePayoutsEnabled: data.payoutsEnabled,
          stripeOnboardingCompleted: data.onboardingCompleted,
        };
      });
      setHosts((prev) =>
        prev.map((item) =>
          item.id === (selectedHostId || host?.id)
            ? {
                ...item,
                stripeConnectAccountId:
                  data.accountId || item.stripeConnectAccountId || null,
                stripeConnectStatus:
                  data.connectStatus || item.stripeConnectStatus || null,
                stripeChargesEnabled: data.chargesEnabled,
                stripePayoutsEnabled: data.payoutsEnabled,
                stripeOnboardingCompleted: data.onboardingCompleted,
              }
            : item,
        ),
      );
      toast({
        title: "Stripe status updated",
        description:
          data.chargesEnabled && data.payoutsEnabled
            ? "Payments are enabled."
            : "Payments are still pending.",
      });
      await loadHostEarnings();
    } catch (error: any) {
      console.error("Stripe status error:", error);
      toast({
        title: "Unable to refresh status",
        description: error.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingStripe(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setup = params.get("setup");
    const setupHostId = params.get("hostId");
    if (!setup) return;

    if (setupHostId && setupHostId !== selectedHostId) {
      setSelectedHostId(setupHostId);
    }

    if (setup === "complete" || setup === "refresh") {
      void refreshStripeStatus();
      const cleanUrl = `${window.location.pathname}${setupHostId ? `?hostId=${encodeURIComponent(setupHostId)}` : ""}`;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, [selectedHostId]);

  const demandThresholdMet = demandQueue.filter(
    (row) => row.demandStatus === "threshold_met",
  );

  if (isLoading || isLoadingPage) {
    if (authLoadingTimedOut) {
      return (
        <div className="max-w-xl mx-auto px-4 py-16">
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-6 text-center">
            <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
              Host Dashboard is taking too long to load
            </h2>
            <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
              We couldn't finish loading your account session. Try reloading this page.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button onClick={() => window.location.reload()}>Reload</Button>
              <Button variant="outline" onClick={() => setLocation("/map")}>Open Map</Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg-layered)]">
        <Loader2 className="h-8 w-8 animate-spin text-[color:var(--accent-text)]" />
      </div>
    );
  }

  if (!host) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-6 text-center">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Couldn't load Host Parking Pass dashboard
          </h2>
          <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
            {dashboardError || "We hit a temporary loading issue."}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button onClick={() => window.location.reload()}>Retry</Button>
            <Button variant="outline" onClick={() => setLocation("/map")}>Open Map</Button>
          </div>
        </div>
      </div>
    );
  }

  const hostStripePayoutReady = Boolean(
    host.stripeConnectAccountId &&
    host.stripeChargesEnabled &&
    host.stripePayoutsEnabled &&
    host.stripeOnboardingCompleted,
  );
  const stripeConnectionState = !host.stripeConnectAccountId
    ? "Not connected"
    : hostStripePayoutReady
      ? "Payouts enabled"
      : host.stripeOnboardingCompleted
        ? "Waiting on Stripe checks"
        : "Onboarding in progress";
  const isGasStationHost =
    String(host.locationType || "").toLowerCase() === "gas_station";

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 bg-[var(--bg-layered)] min-h-screen">
      {!hostStripePayoutReady && (
        <Alert className="mb-6 border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10">
          <AlertCircle className="h-4 w-4 text-[color:var(--status-warning)]" />
          <AlertTitle className="text-[color:var(--text-primary)]">
            Your parking pass is live and accepting bookings
          </AlertTitle>
          <AlertDescription className="text-[color:var(--text-secondary)]">
            <p className="mb-1">
              Trucks can book your spots right now — MealScout holds your earnings securely until you complete Stripe setup.
            </p>
            {earningsSummary && earningsSummary.accruedCents > 0 && (
              <p className="mb-3 font-semibold text-[color:var(--text-primary)]">
                💰 You have{" "}
                <span className="text-emerald-700">
                  ${(earningsSummary.accruedCents / 100).toFixed(2)}
                </span>{" "}
                in accrued earnings waiting to be unlocked. Complete Stripe setup to cash out.
              </p>
            )}
            {(!earningsSummary || earningsSummary.accruedCents === 0) && (
              <p className="mb-3">
                Complete Stripe onboarding now so your first payout is ready the moment a truck books your spot.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleEnablePayments}
                className="bg-[color:var(--accent-text)] hover:bg-[color:var(--action-hover)]"
              >
                {host.stripeConnectAccountId ? "Resume Stripe Setup" : "Set Up Payouts (Free)"}
              </Button>
              <Button
                variant="outline"
                onClick={refreshStripeStatus}
                disabled={isCheckingStripe}
              >
                {isCheckingStripe ? "Checking..." : "Refresh Status"}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
              Stripe Payout Setup
            </h2>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Track onboarding progress for paid bookings and host payouts.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              hostStripePayoutReady
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {stripeConnectionState}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
            <p className="text-xs text-[color:var(--text-muted)]">Account</p>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
              {host.stripeConnectAccountId ? "Connected" : "Not started"}
            </p>
          </div>
          <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
            <p className="text-xs text-[color:var(--text-muted)]">Onboarding</p>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
              {host.stripeOnboardingCompleted ? "Submitted" : "Incomplete"}
            </p>
          </div>
          <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
            <p className="text-xs text-[color:var(--text-muted)]">Charges</p>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
              {host.stripeChargesEnabled ? "Enabled" : "Pending"}
            </p>
          </div>
          <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
            <p className="text-xs text-[color:var(--text-muted)]">Payouts</p>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-primary)]">
              {host.stripePayoutsEnabled ? "Enabled" : "Pending"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={handleEnablePayments}
            className="bg-[color:var(--accent-text)] hover:bg-[color:var(--action-hover)]"
          >
            {host.stripeConnectAccountId
              ? "Resume Stripe Setup"
              : "Start Stripe Setup"}
          </Button>
          <Button
            variant="outline"
            onClick={refreshStripeStatus}
            disabled={isCheckingStripe}
          >
            {isCheckingStripe ? "Checking..." : "Refresh Stripe Status"}
          </Button>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Host Earnings
          </h2>
          <Button
            variant="outline"
            onClick={requestHostPayout}
            disabled={
              isRequestingPayout ||
              isLoadingEarnings ||
              !earningsSummary?.canRequestPayout
            }
          >
            {isRequestingPayout ? "Requesting..." : "Request Payout"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-[color:var(--text-muted)]">Accrued</p>
            <p className="text-base font-semibold text-[color:var(--text-primary)]">
              {isLoadingEarnings
                ? "..."
                : `$${((earningsSummary?.accruedCents || 0) / 100).toFixed(2)}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--text-muted)]">Available</p>
            <p className="text-base font-semibold text-[color:var(--text-primary)]">
              {isLoadingEarnings
                ? "..."
                : `$${((earningsSummary?.availableCents || 0) / 100).toFixed(2)}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--text-muted)]">
              Pending Payouts
            </p>
            <p className="text-base font-semibold text-[color:var(--text-primary)]">
              {isLoadingEarnings
                ? "..."
                : `$${((earningsSummary?.pendingPayoutCents || 0) / 100).toFixed(2)}`}
            </p>
          </div>
          <div>
            <p className="text-xs text-[color:var(--text-muted)]">Paid Out</p>
            <p className="text-base font-semibold text-[color:var(--text-primary)]">
              {isLoadingEarnings
                ? "..."
                : `$${((earningsSummary?.paidOutCents || 0) / 100).toFixed(2)}`}
            </p>
          </div>
        </div>
      </div>

      {/* Payout Request History */}
      <div className="mb-6 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Payout History
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void loadPayoutRequests()}
            disabled={isLoadingPayoutRequests}
          >
            {isLoadingPayoutRequests ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        {isLoadingPayoutRequests ? (
          <p className="text-sm text-[color:var(--text-muted)]">Loading...</p>
        ) : payoutRequests.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">
            No payout requests yet. Once you have available earnings and complete Stripe setup, you can request a payout above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-subtle)] text-left text-xs text-[color:var(--text-muted)]">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Paid At</th>
                </tr>
              </thead>
              <tbody>
                {payoutRequests.map((req) => (
                  <tr key={req.id} className="border-b border-[color:var(--border-subtle)] last:border-0">
                    <td className="py-2 pr-4 text-[color:var(--text-secondary)]">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 font-medium text-[color:var(--text-primary)]">
                      ${(req.amountCents / 100).toFixed(2)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          req.status === "paid"
                            ? "bg-emerald-100 text-emerald-800"
                            : req.status === "approved"
                              ? "bg-blue-100 text-blue-800"
                              : req.status === "rejected" || req.status === "cancelled"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-2 text-[color:var(--text-muted)]">
                      {req.paidAt ? new Date(req.paidAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Demand Queue
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[color:var(--text-muted)]">
              {demandThresholdMet.length} threshold met
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDemandQueue}
              disabled={isLoadingDemand}
            >
              {isLoadingDemand ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {demandQueue.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">
            No demand requests yet. As trucks show interest, qualified locations
            appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {demandQueue.slice(0, 6).map((item) => {
              const thresholdMet = item.demandStatus === "threshold_met";
              const claimed = item.demandStatus === "claimed";
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border-subtle)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[color:var(--text-primary)] truncate">
                      {item.businessName}
                    </p>
                    <p className="text-xs text-[color:var(--text-muted)] truncate">
                      {item.address}
                    </p>
                    <p className="text-xs text-[color:var(--text-muted)]">
                      {item.interestCount}/{item.minInterestedTrucks} interested
                      trucks
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        claimed
                          ? "bg-slate-100 text-slate-700"
                          : thresholdMet
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {claimed
                        ? "claimed"
                        : thresholdMet
                          ? "threshold met"
                          : `${item.thresholdRemaining} to go`}
                    </span>
                    {thresholdMet ? (
                      <Button
                        size="sm"
                        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                      >
                        Review Location
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[color:var(--text-primary)]">
            {host.businessName}
          </h1>
          <p className="text-[color:var(--text-secondary)]">{host.address}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/restaurant-signup?businessType=bar">
              <Button size="sm" variant="outline">
                Add Bar/Restaurant Profile
              </Button>
            </Link>
            {ownedRestaurants.length > 0 && (
              <Link href="/restaurant-owner-dashboard">
                <Button size="sm">Manage Bar/Restaurant</Button>
              </Link>
            )}
          </div>
        </div>
        {hosts.length > 1 && (
          <div className="flex items-center gap-2">
            <Label
              htmlFor="hostSelect"
              className="text-sm text-[color:var(--text-secondary)]"
            >
              Property
            </Label>
            <select
              id="hostSelect"
              value={selectedHostId}
              onChange={(event) => setSelectedHostId(event.target.value)}
              className="h-10 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm"
            >
              {hosts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.businessName} {item.address}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <section className="mb-12 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <h2 className="text-base font-semibold text-[color:var(--text-primary)]">
          Parking Pass Only
        </h2>
        <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
          Events are managed separately from Parking Pass. This Host Dashboard only manages Parking Pass listings, payouts, and bookings.
        </p>
      </section>

      <HelpWantedQuickAction
        hostId={host.id}
        businessName={host.businessName}
        compact
      />

      {(isGasStationHost || host.showFuelPrices) && (
        <section className="mb-12 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[color:var(--text-primary)]">
                Live Gas Prices
              </h2>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                Show current fuel prices on your public map pin so trucks can plan stops.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] px-3 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={fuelForm.showFuelPrices}
                onChange={(event) =>
                  setFuelForm((prev) => ({
                    ...prev,
                    showFuelPrices: event.target.checked,
                  }))
                }
              />
              Public
            </label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["regular", "Regular"],
              ["midgrade", "Midgrade"],
              ["premium", "Premium"],
              ["diesel", "Diesel"],
            ].map(([key, label]) => (
              <label key={key} className="grid gap-1 text-sm font-semibold">
                {label}
                <input
                  value={(fuelForm as any)[key]}
                  inputMode="decimal"
                  placeholder="3.49"
                  className="h-10 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 text-sm"
                  onChange={(event) =>
                    setFuelForm((prev) => ({ ...prev, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={saveFuelPrices} disabled={isSavingFuelPrices}>
              {isSavingFuelPrices ? "Saving..." : "Save Fuel Prices"}
            </Button>
            {host.gasPriceUpdatedAt ? (
              <span className="text-xs text-[color:var(--text-muted)]">
                Updated {new Date(host.gasPriceUpdatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        </section>
      )}

      {/* ── Profile Import & Photo Gallery ────────────────────── */}
      {host && (
        <section className="mb-12 space-y-6">
          <BusinessProfileImport
            entityType="host"
            entityId={host.id}
            entityName={host.businessName}
            entityAddress={host.address || undefined}
            entityCity={host.city || undefined}
            entityState={host.state || undefined}
            onImportComplete={() => {
              // Refetch hosts data
              fetch("/api/hosts", { credentials: "include" })
                .then(res => res.json())
                .then(data => {
                  if (Array.isArray(data)) setHosts(data);
                })
                .catch(() => {});
            }}
          />
          <BusinessPhotoGallery
            entityType="host"
            entityId={host.id}
            maxPhotos={50}
            canEdit={true}
          />
        </section>
      )}

      {/* ── Bookings section ────────────────────────────────────── */}
      {host && <HostBookingsSection hostId={host.id} />}
    </div>
  );
}

function HostBookingsSection({ hostId }: { hostId: string }) {
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [bookings, setBookings] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLoadingEvents(true);
    fetch(`/api/events?hostId=${encodeURIComponent(hostId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setEvents(
          Array.isArray(data?.events)
            ? data.events
            : Array.isArray(data)
              ? data
              : [],
        );
      })
      .catch(() => {})
      .finally(() => setLoadingEvents(false));
  }, [hostId]);

  useEffect(() => {
    if (!selectedEventId) {
      setBookings([]);
      return;
    }
    setLoadingBookings(true);
    fetch(`/api/events/${encodeURIComponent(selectedEventId)}/bookings`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setBookings(data?.bookings ?? []))
      .catch(() => setBookings([]))
      .finally(() => setLoadingBookings(false));
  }, [selectedEventId]);

  const handleCancel = async (bookingId: string) => {
    if (!confirm("Cancel this booking? No refund will be issued.")) return;
    const res = await fetch(
      `/api/bookings/${encodeURIComponent(bookingId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: "Host cancelled" }),
      },
    );
    if (res.ok) {
      toast({ title: "Booking cancelled", description: "No refund issued." });
      setBookings((prev) =>
        prev.map((b) =>
          b.booking?.id === bookingId
            ? { ...b, booking: { ...b.booking, status: "cancelled" } }
            : b,
        ),
      );
    } else {
      toast({
        title: "Error",
        description: "Could not cancel booking.",
        variant: "destructive",
      });
    }
  };

  const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;

  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-4">
      <h2 className="text-xl font-semibold text-[color:var(--text-primary)]">
        Event Bookings
      </h2>
      <p className="text-sm text-[color:var(--text-secondary)]">
        Select an event to see which trucks have booked a spot.
      </p>

      {loadingEvents ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading events…
        </div>
      ) : (
        <select
          className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          value={selectedEventId}
          onChange={(e) => setSelectedEventId(e.target.value)}
        >
          <option value="">Select an event…</option>
          {events.map((ev: any) => (
            <option key={ev.id} value={ev.id}>
              {ev.name || ev.id} —{" "}
              {ev.date ? new Date(ev.date).toLocaleDateString() : ""}
              {ev.requiresPayment ? " (paid)" : ""}
            </option>
          ))}
        </select>
      )}

      {selectedEventId && (
        <>
          {loadingBookings ? (
            <div className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
            </div>
          ) : bookings.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              No bookings for this event yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] uppercase">
                    <th className="py-2 pr-4 text-left font-medium">Truck</th>
                    <th className="py-2 pr-4 text-left font-medium">Status</th>
                    <th className="py-2 pr-4 text-left font-medium">Total</th>
                    <th className="py-2 pr-4 text-left font-medium">Paid At</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((row: any) => {
                    const b = row.booking ?? row;
                    const truckName = row.truckName ?? "Unknown truck";
                    return (
                      <tr
                        key={b.id}
                        className="border-b border-[color:var(--border-subtle)] last:border-0"
                      >
                        <td className="py-2 pr-4">{truckName}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                              b.status === "confirmed"
                                ? "bg-green-100 text-green-800"
                                : b.status === "pending"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {fmtCents(b.totalCents ?? 0)}
                        </td>
                        <td className="py-2 pr-4 text-[color:var(--text-muted)]">
                          {b.paidAt
                            ? new Date(b.paidAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-2 text-right">
                          {b.status === "confirmed" ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleCancel(b.id)}
                            >
                              Cancel Booking
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default HostDashboard;
