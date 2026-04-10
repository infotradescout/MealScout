import {
  useStripe,
  Elements,
  PaymentElement,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
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
  CreditCard,
  Check,
  Calendar,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  message?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
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
  billingInterval,
  promoCode,
  onBillingIntervalChange,
  onPromoCodeChange,
  onContinue,
}: {
  billingInterval: "month";
  promoCode: string;
  onBillingIntervalChange: (value: "month") => void;
  onPromoCodeChange: (value: string) => void;
  onContinue: () => void;
}) => {
  const getPricingDisplay = () =>
    "$25/month forever for signups before April 1, 2026";
  const getPricingAmount = () => (
    <>
      <span className="mr-2 text-xl text-[color:var(--text-muted)] line-through">
        $50
      </span>
      $25
    </>
  );

  return (
    <div className="space-y-6">
      {/* Monthly Only */}
      <Card className="bg-[linear-gradient(110deg,rgba(34,197,94,0.12),rgba(20,184,166,0.12))] border-[color:var(--border-subtle)] shadow-clean">
        <CardContent className="p-6">
          <h3 className="text-xl font-bold text-[color:var(--text-primary)] mb-4 text-center">
            Monthly Plan
          </h3>
          <div className="grid grid-cols-1 gap-4">
            <div
              className="border rounded-lg p-4 text-center border-[color:var(--status-success)]/40 bg-[color:var(--status-success)]/10 shadow-clean"
              onClick={() => onBillingIntervalChange("month")}
              data-testid="card-billing-monthly"
            >
              <div className="font-semibold text-[color:var(--text-primary)] mb-1">
                Monthly
              </div>
              <div className="text-sm text-[color:var(--text-secondary)]">
                Billed monthly
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Promo Code */}
      <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
        <CardContent className="p-6">
          <Label
            htmlFor="promoCode"
            className="text-base font-semibold text-[color:var(--text-primary)] mb-2 block"
          >
            Promo Code (Optional)
          </Label>
          <Input
            id="promoCode"
            type="text"
            placeholder="Enter promo code"
            value={promoCode}
            onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
            className="text-center font-mono"
            data-testid="input-promo-code"
          />
          <p className="text-sm text-muted-foreground mt-2 text-center">
            If you received a promo code from MealScout, enter it above.
          </p>
        </CardContent>
      </Card>

      {/* Summary and Continue */}
      <Card className="bg-[linear-gradient(110deg,rgba(59,130,246,0.12),rgba(99,102,241,0.12))] border-[color:var(--border-subtle)] shadow-clean">
        <CardContent className="p-6">
          <div className="text-center">
            <h3 className="text-lg font-bold text-[color:var(--text-primary)] mb-2">
              Plan Summary
            </h3>
            <div className="flex justify-center items-center space-x-2 mb-2">
              <Check className="w-5 h-5 text-[color:var(--status-success)]" />
              <span className="font-semibold text-[color:var(--text-primary)]">
                MealScout Premium Plan
              </span>
            </div>
            <div className="text-3xl font-bold text-[color:var(--accent-text)] mb-2">
              {getPricingAmount()}
            </div>
            <div className="text-sm text-[color:var(--text-secondary)] mb-4">
              {getPricingDisplay()}
            </div>
            {promoCode && (
              <div className="text-sm text-[color:var(--status-success)] mb-4">
                Promo code: {promoCode}
              </div>
            )}
            <Button
              onClick={onContinue}
              className="w-full py-3 font-semibold text-sm"
              data-testid="button-continue-to-payment"
            >
              Continue to Payment
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const SubscriptionManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();

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

  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/subscription/cancel");
    },
    onSuccess: () => {
      toast({
        title: "Subscription Cancelled",
        description: "Your subscription has been cancelled.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      setShowCancelDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Cancellation Failed",
        description: error.message || "Failed to cancel subscription",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-[color:var(--status-success)]/15 text-[color:var(--status-success)]">
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </Badge>
        );
      case "canceled":
        return (
          <Badge className="bg-[color:var(--status-error)]/15 text-[color:var(--status-error)]">
            <AlertCircle className="h-3 w-3 mr-1" />
            Cancelled
          </Badge>
        );
      case "past_due":
        return (
          <Badge className="bg-[color:var(--status-error)]/15 text-[color:var(--status-error)]">
            <AlertCircle className="h-3 w-3 mr-1" />
            Past Due
          </Badge>
        );
      case "none":
        return <Badge variant="secondary">No Subscription</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Subscription
          </CardTitle>
          <CardDescription>
            Your subscription status and billing information
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Status</span>
            {getStatusBadge(subscriptionStatus?.status || "none")}
          </div>

          {subscriptionStatus?.status === "active" && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Current Period Ends
                </span>
                <span className="text-sm">
                  {subscriptionStatus.currentPeriodEnd
                    ? formatDate(subscriptionStatus.currentPeriodEnd)
                    : "N/A"}
                </span>
              </div>

              {subscriptionStatus.cancelAtPeriodEnd && (
                <div className="bg-[color:var(--status-warning)]/10 border border-[color:var(--status-warning)]/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-[color:var(--status-warning)]">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Subscription will cancel at the end of the billing period
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-2">Subscription Features</h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[color:var(--status-success)]" />
                    Post and distribute specials
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[color:var(--status-success)]" />
                    Off-platform schedule management
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[color:var(--status-success)]" />
                    One-click live location updates
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[color:var(--status-success)]" />
                    Social auto-post controls and premium analytics
                  </li>
                </ul>
              </div>
            </>
          )}

          {subscriptionStatus?.status === "active" &&
            !subscriptionStatus.cancelAtPeriodEnd && (
              <div className="pt-4 space-y-2">
                <Dialog
                  open={showCancelDialog}
                  onOpenChange={setShowCancelDialog}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="destructive"
                      className="w-full"
                      data-testid="button-cancel-subscription"
                    >
                      Cancel Subscription
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancel Subscription</DialogTitle>
                      <DialogDescription>
                        This will cancel your subscription immediately.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setShowCancelDialog(false)}
                      >
                        Keep Subscription
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                      >
                        {cancelMutation.isPending
                          ? "Cancelling..."
                          : "Yes, Cancel Now"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
        </CardContent>
      </Card>

      <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>
            View your past invoices and payments
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Billing history will be available after your first payment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default function Subscribe() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();

  const getSafeNextPath = (): string | null => {
    try {
      const params = new URLSearchParams(location.split("?")[1] || "");
      const raw = (params.get("next") || params.get("redirect") || "").trim();
      if (!raw) return null;
      if (!raw.startsWith("/")) return null;
      if (raw.startsWith("//")) return null;
      if (raw.includes("://")) return null;
      return raw;
    } catch {
      return null;
    }
  };

  const defaultNextPath =
    user?.userType === "food_truck"
      ? "/parking-pass"
      : "/restaurant-owner-dashboard";
  const nextPath = getSafeNextPath() || defaultNextPath;
  const stripeReturnUrl = `${window.location.origin}/subscribe?next=${encodeURIComponent(
    nextPath,
  )}`;

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
  const [billingInterval, setBillingInterval] = useState<"month">("month");
  const [promoCode, setPromoCode] = useState("");
  const [creditsToApply, setCreditsToApply] = useState("");

  // Subscription flow state
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>(
    {
      status: "selecting",
    },
  );

  // Debug: Log auth status
  console.log("Subscribe page - Auth Status:", {
    isAuthenticated,
    isLoading,
    hasUser: !!user,
    userEmail: user?.email,
  });

  // Check current subscription status to determine which view to show
  const { data: currentSubscription } = useQuery<ApiSubscriptionStatus>({
    queryKey: ["/api/subscription/status"],
    enabled: !!user,
  });

  const { data: creditBalanceData } = useQuery<{ balance: number }>({
    queryKey: ["/api/payout/balance"],
    enabled: !!user,
  });

  const initializeSubscription = async () => {
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
          window.location.href = "/api/auth/google/restaurant";
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

  const showNewSubscription = () => {
    setSubscriptionState({ status: "selecting" });
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <div
          className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground mb-4">
              Please log in to manage your subscription
            </p>
            <Button
              onClick={() =>
                (window.location.href = "/api/auth/google/restaurant")
              }
              className="w-full"
            >
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show message if Stripe is not configured
  if (!stripePromise) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen">
        <BackHeader
          title="Pricing & Subscriptions"
          fallbackHref={nextPath}
          icon={CreditCard}
          className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
        />
        <div className="px-4 py-6 flex items-center justify-center min-h-[50vh]">
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
            <CardContent className="p-6 text-center">
              <i className="fas fa-cog text-muted-foreground text-3xl mb-4"></i>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Payment Setup Required
              </h2>
              <p className="text-muted-foreground mb-4">
                Stripe payment processing is not yet configured.
              </p>
              <Button
                className="w-full mb-2"
                onClick={() => setLocation(nextPath)}
              >
                Continue (No Premium)
              </Button>
              <Link href="/">
                <Button variant="outline" className="w-full">
                  Back to Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Determine which view to show based on subscription status
  const hasActiveSubscription = currentSubscription?.status === "active";
  const showManagement =
    hasActiveSubscription && subscriptionState.status === "selecting";

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen">
      <BackHeader
        title="Pricing & Subscriptions"
        fallbackHref={nextPath}
        icon={CreditCard}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="px-4 py-6">
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                  Premium is optional
                </div>
                <div className="text-xs text-[color:var(--text-secondary)]">
                  Premium unlocks deal creation + analytics
                  (trial/subscription). Parking Pass is separate and always
                  available for food trucks.
                </div>
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={() => setLocation(nextPath)}
                data-testid="button-continue-without-premium"
              >
                Continue
              </Button>
            </div>
            <div className="flex gap-2">
              <Link href="/parking-pass">
                <Button
                  variant="secondary"
                  className="w-full"
                  data-testid="button-go-parking-pass"
                >
                  Parking Pass
                </Button>
              </Link>
              <Link href="/deal-creation">
                <Button
                  variant="secondary"
                  className="w-full"
                  data-testid="button-go-deal-creation"
                >
                  Premium Features
                </Button>
              </Link>
            </div>
            {(currentSubscription as any)?.trialAccess &&
              (currentSubscription as any)?.trialEndsAt && (
                <div className="text-xs text-[color:var(--status-success)]">
                  Trial active until{" "}
                  {new Date(
                    (currentSubscription as any).trialEndsAt,
                  ).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  .
                </div>
              )}
          </CardContent>
        </Card>

        {/* If user has active subscription and not in payment flow, show management */}
        {showManagement && (
          <div className="space-y-6">
            <SubscriptionManagement />

            {/* Option to upgrade/change plan */}
            <Card className="bg-[linear-gradient(110deg,rgba(59,130,246,0.12),rgba(168,85,247,0.12))] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-6 text-center">
                <h3 className="text-lg font-bold text-[color:var(--text-primary)] mb-2">
                  Change Plan or Use Promo Code
                </h3>
                <p className="text-sm text-[color:var(--text-secondary)] mb-2">
                  Change your billing frequency or apply a promo code
                </p>
                <p className="text-xs text-[color:var(--accent-text)] font-medium mb-4">
                  Tip: If you received a promo code from MealScout, enter it
                  below.
                </p>
                <Button
                  onClick={showNewSubscription}
                  variant="outline"
                  className="w-full"
                  data-testid="button-change-plan"
                >
                  View Plans & Enter Promo Code
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Show plan selection for new users or when changing plans */}
        {subscriptionState.status === "selecting" && !showManagement && (
          <div className="space-y-6">
            {/* If user has active subscription, show note about changing plans */}
            {hasActiveSubscription && (
              <Card className="bg-[color:var(--status-warning)]/10 border-[color:var(--status-warning)]/30 shadow-clean">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-[color:var(--status-warning)]">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      You currently have an active subscription. Selecting a new
                      plan will replace your current plan.
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardHeader>
                <CardTitle>Apply Credits</CardTitle>
                <CardDescription>
                  Credits can reduce your next subscription invoice.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-[color:var(--text-secondary)]">
                  Available: $
                  {Number(creditBalanceData?.balance || 0).toFixed(2)}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="credit-apply">Credits to apply</Label>
                  <Input
                    id="credit-apply"
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditsToApply}
                    onChange={(e) => setCreditsToApply(e.target.value)}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-[color:var(--text-muted)]">
                    Credits apply to the upcoming invoice only.
                  </p>
                </div>
              </CardContent>
            </Card>

            <PlanSelector
              billingInterval={billingInterval}
              promoCode={promoCode}
              onBillingIntervalChange={setBillingInterval}
              onPromoCodeChange={setPromoCode}
              onContinue={initializeSubscription}
            />

            {/* If user has active subscription, show option to go back to management */}
            {hasActiveSubscription && (
              <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="p-4 text-center">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setSubscriptionState({ status: "selecting" })
                    }
                    className="w-full"
                    data-testid="button-back-to-management"
                  >
                    Back to Subscription Management
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {subscriptionState.status === "initializing" && (
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="text-center">
              <div
                className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"
                aria-label="Loading"
              />
              <p
                className="text-muted-foreground"
                data-testid="text-initializing"
              >
                Initializing your subscription...
              </p>
            </div>
          </div>
        )}

        {subscriptionState.status === "requires_payment" &&
          subscriptionState.clientSecret && (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret: subscriptionState.clientSecret }}
            >
              <div className="space-y-6">
                <Card className="bg-[linear-gradient(110deg,rgba(59,130,246,0.12),rgba(99,102,241,0.12))] border-[color:var(--border-subtle)] shadow-clean">
                  <CardContent className="p-6 text-center">
                    <h3 className="text-lg font-bold text-[color:var(--text-primary)] mb-2">
                      Complete Your Payment
                    </h3>
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      MealScout Restaurant Plan -{" "}
                      <span className="line-through text-[color:var(--text-muted)]">
                        $50
                      </span>{" "}
                      $25/month (join before April 1, 2026)
                    </p>
                  </CardContent>
                </Card>
                <PaymentForm
                  clientSecret={subscriptionState.clientSecret}
                  intentType={subscriptionState.intentType}
                  returnUrl={stripeReturnUrl}
                  onSuccess={(paymentIntentId: string) =>
                    handlePaymentSuccess(paymentIntentId)
                  }
                />
              </div>
            </Elements>
          )}

        {subscriptionState.status === "error" && (
          <div className="flex items-center justify-center min-h-[50vh]">
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-6 text-center">
                <i className="fas fa-exclamation-triangle text-destructive text-3xl mb-4"></i>
                <h2 className="text-lg font-semibold text-foreground mb-2">
                  Setup Error
                </h2>
                <p
                  className="text-muted-foreground mb-4"
                  data-testid="text-error-message"
                >
                  {subscriptionState.error}
                </p>
                <Button onClick={handleRetry} className="w-full">
                  Try Again
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
