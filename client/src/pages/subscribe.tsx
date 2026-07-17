import {
  useStripe,
  Elements,
  PaymentElement,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { Restaurant } from "@shared/schema";
import { isBarBusinessType, isTruckBusinessType } from "@shared/businessTypes";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BackHeader } from "@/components/back-header";
import {
  AlertTriangle,
  CreditCard,
  Check,
  Calendar,
  AlertCircle,
  CheckCircle,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authUrl } from "@/lib/api";
import PaymentBrowserGate from "@/components/payment-browser-gate";
import { isPaymentHostileBrowser } from "@/lib/inAppBrowser";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

// Make sure to call `loadStripe` outside of a component's render to avoid
// recreating the `Stripe` object on every render.
const getStripePromise = () => {
  return import.meta.env.VITE_STRIPE_PUBLIC_KEY
    ? loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY)
    : null;
};

const stripePromise = getStripePromise();

type SubscriptionStatus =
  | "selecting"
  | "initializing"
  | "requires_payment"
  | "active"
  | "error";

interface SubscriptionState {
  status: SubscriptionStatus;
  subscriptionId?: string;
  clientSecret?: string;
  intentType?: string;
  error?: string;
}

interface ApiSubscriptionStatus {
  status: string;
  hasAccess?: boolean;
  trialAccess?: boolean;
  trialEndsAt?: string | Date | null;
  lifetimeAccess?: boolean;
  message?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

interface PremiumWeeklySummary {
  hasAccess: boolean;
  weekStart: string;
  weekEnd: string;
  restaurantCount: number;
  stopsCovered: number;
  liveLocationActivations: number;
  manualScheduleUsage: number;
  parkingReportsCompleted: number;
}

const PaymentForm = ({
  clientSecret,
  intentType = "payment",
  returnUrl,
  onSuccess,
}: {
  clientSecret: string;
  intentType?: string;
  returnUrl: string;
  onSuccess: (paymentIntentId: string) => void;
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      let result;

      if (intentType === "setup") {
        result = await stripe.confirmSetup({
          elements,
          confirmParams: {
            return_url: returnUrl,
          },
          redirect: "if_required",
        });
      } else {
        result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: returnUrl,
          },
          redirect: "if_required",
        });
      }

      if (result.error) {
        toast({
          title: intentType === "setup" ? "Setup Failed" : "Payment Failed",
          description: result.error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title:
            intentType === "setup"
              ? "Setup Successful!"
              : "Payment Successful!",
          description: "Premium is now active on your account.",
        });
        const paymentIntentId =
          intentType === "setup"
            ? "setupIntent" in result
              ? result.setupIntent?.id
              : undefined
            : "paymentIntent" in result
              ? result.paymentIntent?.id
              : undefined;
        if (paymentIntentId) {
          onSuccess(paymentIntentId);
        }
      }
    } catch (error: any) {
      toast({
        title: intentType === "setup" ? "Setup Error" : "Payment Error",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] rounded-lg p-4 shadow-clean">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>

      <Button
        type="submit"
        className="w-full py-3 font-semibold text-sm"
        disabled={!stripe || !elements || isProcessing}
        data-testid="button-pay-now"
      >
        {isProcessing ? "Processing..." : "Complete Payment"}
      </Button>
    </form>
  );
};

const PlanSelector = ({
  promoCode,
  onPromoCodeChange,
  onContinue,
}: {
  promoCode: string;
  onPromoCodeChange: (value: string) => void;
  onContinue: () => void;
}) => {
  return (
    <Card className="overflow-hidden border-orange-200 bg-[var(--bg-surface)] shadow-clean">
      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-[linear-gradient(135deg,#fff7ed,#ffedd5_55%,#fef3c7)] p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sm font-black text-orange-800">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              MealScout Premium
            </div>
            <div className="mt-5 flex items-end gap-2">
              <span className="text-5xl font-black tracking-tight text-stone-950">
                $25
              </span>
              <span className="pb-1.5 text-sm font-bold text-stone-600">
                per month
              </span>
            </div>
            <p className="mt-2 text-sm text-stone-600">
              Monthly billing. Cancel at the end of any billing period.
            </p>
            <div className="mt-6 grid gap-3 text-sm text-stone-700 sm:grid-cols-2 lg:grid-cols-1">
              {[
                "Online ordering tools",
                "Deals and distribution",
                "Schedule and live-location tools",
                "Premium business activity summary",
              ].map((feature) => (
                <div key={feature} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-between p-6 sm:p-8">
            <div>
              <Label
                htmlFor="promoCode"
                className="text-sm font-black text-stone-950"
              >
                Promo code
              </Label>
              <Input
                id="promoCode"
                type="text"
                placeholder="Enter code"
                value={promoCode}
                onChange={(event) =>
                  onPromoCodeChange(event.target.value.toUpperCase())
                }
                className="mt-2 font-mono"
                data-testid="input-promo-code"
              />
              <p className="mt-2 text-xs leading-5 text-stone-500">
                Any eligible code is checked before payment begins.
              </p>
              {promoCode ? (
                <p className="mt-3 text-sm font-bold text-emerald-700">
                  Code ready: {promoCode}
                </p>
              ) : null}
            </div>
            <Button
              onClick={onContinue}
              className="mt-6 w-full"
              data-testid="button-continue-to-payment"
            >
              Continue to secure checkout
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const SubscriptionManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const {
    data: subscriptionStatus,
    isLoading,
    isError,
  } = useQuery<ApiSubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const {
    data: weeklySummary,
    isLoading: isWeeklySummaryLoading,
    isError: isWeeklySummaryError,
  } = useQuery<PremiumWeeklySummary>({
    queryKey: ["/api/business/premium-weekly-summary"],
    enabled: !!user && subscriptionStatus?.status === "active",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const emailSummaryMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/business/premium-weekly-summary/email",
      );
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Summary sent",
        description: "The weekly premium summary was sent to your account email.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Summary not sent",
        description: error.message || "The weekly summary could not be emailed.",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/subscription/cancel"),
    onSuccess: () => {
      toast({
        title: "Cancellation scheduled",
        description:
          "Premium stays active through the end of the current billing period.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      setShowCancelDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Cancellation not scheduled",
        description: error.message || "The subscription could not be cancelled.",
        variant: "destructive",
      });
    },
  });

  const formatTimestamp = (timestamp?: number) =>
    timestamp
      ? new Date(timestamp * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;
  const formatDateValue = (value?: string | Date | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };
  const formatSummaryDate = (value?: string) => {
    if (!value) return "N/A";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-stone-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Loading plan details…
      </div>
    );
  }

  if (isError || !subscriptionStatus) {
    return (
      <Card className="border-amber-200 bg-amber-50 shadow-clean">
        <CardContent className="flex gap-3 p-5 text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="font-black">Plan details are unavailable</h2>
            <p className="mt-1 text-sm text-amber-900/80">
              No billing change was made. Refresh the page or try again later.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const status = String(subscriptionStatus.status || "none").toLowerCase();
  const isTrial = subscriptionStatus.trialAccess === true;
  const isLifetime = subscriptionStatus.lifetimeAccess === true;
  const isPaidActive = status === "active" && !isTrial && !isLifetime;
  const periodEnd = formatTimestamp(subscriptionStatus.currentPeriodEnd);
  const trialEnd = formatDateValue(subscriptionStatus.trialEndsAt);
  const statusLabel = isTrial
    ? "Trial active"
    : isLifetime
      ? "Lifetime access"
      : status === "past_due"
        ? "Payment past due"
        : status === "active"
          ? "Active"
          : status.replace(/_/g, " ");
  const planLabel = isTrial
    ? "Premium trial"
    : isLifetime
      ? "Premium partner access"
      : "MealScout Premium";

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[1.75rem] border border-orange-200 bg-[linear-gradient(135deg,#fff7ed,#ffedd5_60%,#fef3c7)] p-6 shadow-clean sm:p-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-orange-800">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Current plan
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-stone-950">
              {planLabel}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700">
              This plan belongs to your MealScout business account and supports
              the businesses managed through that account.
            </p>
          </div>
          <Badge
            className={
              status === "past_due"
                ? "w-fit bg-red-100 text-red-800"
                : "w-fit bg-emerald-100 text-emerald-800"
            }
          >
            {statusLabel}
          </Badge>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 text-sm text-stone-700">
          {isPaidActive ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-2">
              <CreditCard className="h-4 w-4 text-orange-700" aria-hidden="true" />
              $25 per month
            </div>
          ) : null}
          {trialEnd ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-2">
              <Calendar className="h-4 w-4 text-orange-700" aria-hidden="true" />
              Trial ends {trialEnd}
            </div>
          ) : null}
          {periodEnd ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-2">
              <Calendar className="h-4 w-4 text-orange-700" aria-hidden="true" />
              {subscriptionStatus.cancelAtPeriodEnd ? "Access through" : "Renews"} {periodEnd}
            </div>
          ) : null}
        </div>
      </section>

      {subscriptionStatus.cancelAtPeriodEnd ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="text-sm leading-6">
            Cancellation is scheduled. Premium remains available through the
            current billing period.
          </p>
        </div>
      ) : null}

      {status === "past_due" ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-black">Payment needs attention</p>
              <p className="mt-1 text-sm text-red-900/80">
                Starting another subscription is disabled while this plan is past due.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href="/profile/help">Contact support</Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-orange-700" aria-hidden="true" />
              Premium access
            </CardTitle>
            <CardDescription>
              Tools available while this plan is active.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {[
              "Online ordering tools",
              "Deals and distribution",
              "Schedule and live-location tools",
              "Premium business activity summary",
            ].map((feature) => (
              <div
                key={feature}
                className="flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-3 text-sm text-stone-700"
              >
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span>{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ReceiptText className="h-5 w-5 text-orange-700" aria-hidden="true" />
              Billing control
            </CardTitle>
            <CardDescription>
              Plan and payment access stays with the account owner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isPaidActive && !subscriptionStatus.cancelAtPeriodEnd ? (
              <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                    data-testid="button-cancel-subscription"
                  >
                    Cancel subscription
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel subscription?</DialogTitle>
                    <DialogDescription>
                      Premium stays active through the end of the current billing
                      period. The cancellation does not interrupt access today.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
                      Keep subscription
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                    >
                      {cancelMutation.isPending ? "Scheduling…" : "Cancel at period end"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : (
              <p className="rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-600">
                {subscriptionStatus.cancelAtPeriodEnd
                  ? "No further billing action is needed."
                  : isTrial
                    ? "Payment is not required while the trial is active."
                    : isLifetime
                      ? "This account does not have a recurring premium charge."
                      : "No billing action is available for this plan state."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {status === "active" ? (
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
          <CardHeader className="sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
            <div>
              <CardTitle className="text-xl">Premium activity</CardTitle>
              <CardDescription className="mt-1">
                {isWeeklySummaryLoading
                  ? "Loading this week's account activity…"
                  : `Activity from ${formatSummaryDate(weeklySummary?.weekStart)} to ${formatSummaryDate(weeklySummary?.weekEnd)}.`}
              </CardDescription>
            </div>
            {weeklySummary ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => emailSummaryMutation.mutate()}
                disabled={emailSummaryMutation.isPending}
                data-testid="button-email-weekly-summary"
              >
                {emailSummaryMutation.isPending ? "Sending…" : "Email summary"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {isWeeklySummaryLoading ? (
              <div className="flex items-center py-6 text-sm text-stone-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading activity…
              </div>
            ) : isWeeklySummaryError || !weeklySummary ? (
              <p className="rounded-xl bg-stone-50 p-4 text-sm text-stone-600">
                The weekly activity summary is temporarily unavailable. Billing
                status is unaffected.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    ["Stops covered", weeklySummary.stopsCovered],
                    ["Live activations", weeklySummary.liveLocationActivations],
                    ["Schedule updates", weeklySummary.manualScheduleUsage],
                    ["Parking reports", weeklySummary.parkingReportsCompleted],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl bg-orange-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-orange-800">
                        {label}
                      </p>
                      <p className="mt-2 text-2xl font-black text-stone-950">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-stone-500">
                  Account activity across {weeklySummary.restaurantCount} linked business
                  {weeklySummary.restaurantCount === 1 ? "" : "es"}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default function Subscribe() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const queryParams = useMemo(() => new URLSearchParams(search), [search]);
  const requestedRestaurantId = queryParams.get("restaurantId") || "";
  const businessWorkspaceUserTypes = new Set([
    "restaurant_owner",
    "food_truck",
    "admin",
    "duper_admin",
    "super_admin",
    "staff",
  ]);
  const canUseBusinessWorkspace = businessWorkspaceUserTypes.has(
    String(user?.userType || ""),
  );

  const {
    data: businesses = [],
    isLoading: businessesLoading,
    isError: businessesError,
  } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: Boolean(user && canUseBusinessWorkspace),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const currentBusiness = useMemo(() => {
    if (!businesses.length) return null;
    return (
      businesses.find((business) => business.id === requestedRestaurantId) ||
      businesses[0]
    );
  }, [businesses, requestedRestaurantId]);

  const getSafeNextPath = (): string | null => {
    try {
      const raw = (
        queryParams.get("next") ||
        queryParams.get("redirect") ||
        ""
      ).trim();
      if (!raw) return null;
      if (!raw.startsWith("/")) return null;
      if (raw.startsWith("//")) return null;
      if (raw.includes("://")) return null;
      return raw;
    } catch {
      return null;
    }
  };

  const selectedBusinessReturnPath = requestedRestaurantId
    ? `/restaurant-owner-dashboard?restaurantId=${encodeURIComponent(
        requestedRestaurantId,
      )}`
    : null;
  const defaultNextPath =
    selectedBusinessReturnPath ||
    (user?.userType === "food_truck"
      ? "/parking-pass"
      : "/restaurant-owner-dashboard");
  const nextPath = getSafeNextPath() || defaultNextPath;
  const stripeReturnParams = new URLSearchParams({ next: nextPath });
  if (requestedRestaurantId) {
    stripeReturnParams.set("restaurantId", requestedRestaurantId);
  }
  const stripeReturnUrl = `${window.location.origin}/subscribe?${stripeReturnParams.toString()}`;

  useEffect(() => {
    // Stripe redirect (3DS/etc) lands back here with `redirect_status`.
    try {
      const params = new URLSearchParams(window.location.search);
      const redirectStatus = (
        params.get("redirect_status") || ""
      ).toLowerCase();
      if (redirectStatus === "succeeded") {
        toast({
          title: "Payment Successful!",
          description: "Premium is now active on your account.",
        });
        setLocation(nextPath);
      }
    } catch {}
  }, [nextPath, setLocation, toast]);

  // Plan selection state
  const billingInterval: "month" = "month";
  const [promoCode, setPromoCode] = useState("");
  const [creditsToApply, setCreditsToApply] = useState("");

  // Subscription flow state
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>(
    {
      status: "selecting",
    },
  );
  const hostileBrowser = isPaymentHostileBrowser();

  // Check current subscription status to determine which view to show
  const {
    data: currentSubscription,
    isLoading: currentSubscriptionLoading,
    isError: currentSubscriptionError,
  } = useQuery<ApiSubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: creditBalanceData } = useQuery<{ balance: number }>({
    queryKey: ["/api/payout/balance"],
    enabled: !!user,
  });

  const initializeSubscription = async () => {
    if (hostileBrowser) {
      setSubscriptionState({
        status: "error",
        error: "Open this page in Chrome or Safari to complete checkout.",
      });
      return;
    }
    setSubscriptionState({ status: "initializing" });

    try {
      console.log("Initializing subscription with promo code:", promoCode);
      const response = await apiRequest(
        "POST",
        "/api/subscriptions/initialize",
        {
          hasMultipleDeals: false, // Always false now - single tier pricing
          billingInterval,
          promoCode: promoCode || undefined,
        },
      );

      const data = await response.json();
      console.log("Subscription response:", data);

      if (data && data.status === "active") {
        // BETA or free promo code - no payment required
        console.log("BETA access granted successfully");
        toast({
          title: "Success!",
          description: data.message || "Your subscription is now active!",
        });
        // Invalidate and refetch queries to refresh subscription status
        await queryClient.invalidateQueries({
          queryKey: ["/api/subscription/status"],
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        // Wait for refetch to complete
        await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
        // Premium is active (promo code) - route forward to caller intent.
        setTimeout(() => setLocation(nextPath), 800);
      } else if (data && data.status === "requires_payment") {
        console.log("Payment required, showing payment form");
        setSubscriptionState({
          status: "requires_payment",
          subscriptionId: data.subscriptionId,
          clientSecret: data.clientSecret,
          intentType: data.intentType || "payment",
        });
      } else if (data && data.status === "quote") {
        // Read-only initialize: now create the actual subscription
        console.log(
          "Received quote; creating subscription with server-selected Price ID",
        );
        const createResp = await apiRequest(
          "POST",
          "/api/create-subscription",
          {
            billingInterval,
            promoCode: promoCode || undefined,
            applyCreditsCents: Math.max(
              0,
              Math.floor(Number(creditsToApply || 0) * 100),
            ),
          },
        );
        const createData = await createResp.json();
        if (
          createResp.ok &&
          createData &&
          createData.subscriptionId &&
          createData.clientSecret
        ) {
          setSubscriptionState({
            status: "requires_payment",
            subscriptionId: createData.subscriptionId,
            clientSecret: createData.clientSecret,
            intentType: "payment",
          });
        } else {
          console.error("Create subscription failed:", createData);
          setSubscriptionState({
            status: "error",
            error:
              createData?.error?.message ||
              "Failed to create subscription after quote.",
          });
        }
      } else {
        console.error("Unexpected response:", data);
        setSubscriptionState({
          status: "error",
          error:
            data.error?.message ||
            data.message ||
            "Unable to initialize payment. Please try again.",
        });
      }
    } catch (error: any) {
      console.error("Error initializing subscription:", error);
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/restaurant");
        }, 500);
        return;
      }

      setSubscriptionState({
        status: "error",
        error:
          error.message ||
          "Failed to initialize subscription. Please try again.",
      });
    }
  };

  const handlePaymentSuccess = async (paymentIntentId: string) => {
    setLocation(nextPath);
  };

  const handleRetry = () => {
    setSubscriptionState({ status: "selecting" });
  };

  const publicProfileHref = currentBusiness
    ? buildPublicProfilePath({
        entityType: isTruckBusinessType(currentBusiness.businessType)
          ? "truck"
          : isBarBusinessType(currentBusiness.businessType)
            ? "bar"
            : "restaurant",
        id: currentBusiness.id,
        name: currentBusiness.name,
      })
    : null;

  const handleBusinessChange = (businessId: string) => {
    const params = new URLSearchParams(search);
    params.set("restaurantId", businessId);
    setLocation(`/subscribe?${params.toString()}`);
  };

  const renderPaymentsFrame = (content: ReactNode) => {
    if (currentBusiness && canUseBusinessWorkspace) {
      return (
        <BusinessWorkspaceShell
          activeModule="payments"
          business={currentBusiness}
          businesses={businesses}
          onBusinessChange={handleBusinessChange}
          publicProfileHref={publicProfileHref}
          capabilities={{
            deals: true,
            audience: true,
            team: true,
            payments: true,
          }}
        >
          <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 lg:px-6 lg:py-8">
            {content}
          </div>
        </BusinessWorkspaceShell>
      );
    }

    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <BackHeader
          title="Plan & billing"
          fallbackHref={nextPath}
          icon={CreditCard}
          className="border-b border-[color:var(--border-subtle)] bg-[hsl(var(--background))/0.94] shadow-clean"
        />
        <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">{content}</main>
      </div>
    );
  };

  if (
    isLoading ||
    (canUseBusinessWorkspace && businessesLoading) ||
    (isAuthenticated && currentSubscriptionLoading)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] text-stone-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Loading plan &amp; billing…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] px-4">
        <Card className="w-full max-w-md border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
          <CardContent className="p-6 text-center">
            <WalletCards className="mx-auto h-9 w-9 text-orange-700" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-black text-stone-950">
              Sign in to manage billing
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              Plan and payment details are protected with your business account.
            </p>
            <Button
              onClick={() => (window.location.href = authUrl("/api/auth/google/restaurant"))}
              className="mt-5 w-full"
            >
              Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show message if Stripe is not configured
  if (!stripePromise) {
    return renderPaymentsFrame(
      <div className="mx-auto max-w-2xl py-8 sm:py-14">
        <Card className="border-amber-200 bg-[linear-gradient(135deg,#fffbeb,#fff7ed)] shadow-clean">
          <CardContent className="p-6 sm:p-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
              <WalletCards className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-2xl font-black text-stone-950">
              Payment setup required
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">
              Secure subscription checkout is not configured in this environment.
              No plan or payment change can be made here.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => setLocation(nextPath)}>
                Return to workspace
              </Button>
              <Button asChild variant="outline">
                <Link href="/scout">Scout</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>,
    );
  }

  const currentPlanStatus = String(
    currentSubscription?.status || "none",
  ).toLowerCase();
  const hasExistingPlan = currentPlanStatus !== "none";
  const showManagement =
    hasExistingPlan && subscriptionState.status === "selecting";
  const requestedBusinessMissing = Boolean(
    requestedRestaurantId &&
      !businessesLoading &&
      !businesses.some((business) => business.id === requestedRestaurantId),
  );

  const contextNotice =
    businessesError || requestedBusinessMissing ? (
      <div className="mb-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="text-sm leading-6">
          {businessesError
            ? "Business context could not be loaded. Billing still applies to this signed-in account."
            : "The requested business is not available to this account. Choose an available business before returning to its workspace."}
        </p>
      </div>
    ) : null;

  const pageContent = (
    <div className="space-y-5">
      {contextNotice}

      {!showManagement && subscriptionState.status === "selecting" ? (
        <section className="rounded-[1.75rem] border border-orange-200 bg-[linear-gradient(135deg,#fff7ed,#ffedd5_60%,#fef3c7)] p-6 shadow-clean sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.12em] text-orange-800">
                Plan &amp; billing
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-stone-950">
                MealScout Premium
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-700">
                Public profiles and menu browsing stay available without Premium.
                Upgrade here for paid operating tools.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0 bg-white/70"
              onClick={() => setLocation(nextPath)}
              data-testid="button-continue-without-premium"
            >
              Return to workspace
            </Button>
          </div>
        </section>
      ) : null}

      {currentSubscriptionError ? (
        <Card className="border-amber-200 bg-amber-50 shadow-clean">
          <CardContent className="flex gap-3 p-5 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-black">Billing status could not be confirmed</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900/80">
                Checkout is disabled so a second subscription cannot be created by mistake.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showManagement && !currentSubscriptionError ? <SubscriptionManagement /> : null}

      {subscriptionState.status === "selecting" &&
      !showManagement &&
      !currentSubscriptionError ? (
        <div className="space-y-5">
          {hostileBrowser ? (
            <PaymentBrowserGate
              currentUrl={window.location.href}
              reason="Complete subscription checkout in Chrome or Safari."
            />
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <WalletCards className="h-5 w-5 text-orange-700" aria-hidden="true" />
                  Use credits
                </CardTitle>
                <CardDescription>
                  Apply available MealScout credits to the first invoice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl bg-orange-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-800">
                    Available
                  </p>
                  <p className="mt-1 text-2xl font-black text-stone-950">
                    ${Number(creditBalanceData?.balance || 0).toFixed(2)}
                  </p>
                </div>
                <div>
                  <Label htmlFor="credit-apply">Amount to apply</Label>
                  <Input
                    id="credit-apply"
                    type="number"
                    min="0"
                    max={Number(creditBalanceData?.balance || 0)}
                    step="0.01"
                    value={creditsToApply}
                    onChange={(event) => setCreditsToApply(event.target.value)}
                    placeholder="0.00"
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs leading-5 text-stone-500">
                    The server verifies the final available balance before applying it.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-[1.75rem] border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-clean sm:p-8">
              <div className="flex items-center gap-2 text-sm font-black text-stone-950">
                <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                Always available without Premium
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  "Public business profile",
                  "Customer menu browsing",
                  "Basic discovery presence",
                  "Parking Pass spot booking",
                ].map((feature) => (
                  <div key={feature} className="flex items-start gap-2 text-sm text-stone-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs leading-5 text-stone-500">
                Parking Pass booking fees remain separate from the Premium subscription.
              </p>
            </div>
          </div>

          <PlanSelector
            promoCode={promoCode}
            onPromoCodeChange={setPromoCode}
            onContinue={initializeSubscription}
          />
        </div>
      ) : null}

      {subscriptionState.status === "initializing" ? (
        <div className="flex min-h-72 items-center justify-center rounded-[1.75rem] border border-[color:var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="text-center">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-orange-700" aria-hidden="true" />
            <p className="mt-4 font-bold text-stone-700" data-testid="text-initializing">
              Setting up your plan…
            </p>
          </div>
        </div>
      ) : null}

      {subscriptionState.status === "requires_payment" &&
      subscriptionState.clientSecret ? (
        <div className="space-y-5">
          {hostileBrowser ? (
            <PaymentBrowserGate
              currentUrl={window.location.href}
              reason="Complete subscription checkout in Chrome or Safari."
            />
          ) : null}
          <Elements
            stripe={stripePromise}
            options={{ clientSecret: subscriptionState.clientSecret }}
          >
            <div className="mx-auto max-w-2xl space-y-5">
              <div className="rounded-[1.75rem] border border-orange-200 bg-[linear-gradient(135deg,#fff7ed,#ffedd5)] p-6 text-center shadow-clean">
                <h2 className="text-2xl font-black text-stone-950">
                  Complete secure checkout
                </h2>
                <p className="mt-2 text-sm text-stone-600">
                  MealScout Premium · $25 per month
                </p>
              </div>
              <PaymentForm
                clientSecret={subscriptionState.clientSecret}
                intentType={subscriptionState.intentType}
                returnUrl={stripeReturnUrl}
                onSuccess={handlePaymentSuccess}
              />
            </div>
          </Elements>
        </div>
      ) : null}

      {subscriptionState.status === "error" ? (
        <div className="mx-auto max-w-xl py-8">
          <Card className="border-red-200 bg-red-50 shadow-clean">
            <CardContent className="p-6 text-center">
              <AlertTriangle className="mx-auto h-9 w-9 text-red-700" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-black text-red-950">
                Checkout could not start
              </h2>
              <p className="mt-2 text-sm leading-6 text-red-900/80" data-testid="text-error-message">
                {subscriptionState.error}
              </p>
              <Button onClick={handleRetry} className="mt-5">
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );

  return renderPaymentsFrame(pageContent);
}
