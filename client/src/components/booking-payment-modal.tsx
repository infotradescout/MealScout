import { useState, useEffect, useRef } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  isInAppBrowser,
  openCurrentUrlInExternalBrowser,
} from "@/lib/inAppBrowser";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || "";
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

interface BookingPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passId: string;
  truckId: string;
  slotTypes: string[];
  selectedDates?: string[];
  eventDetails: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    hostName: string;
    hostPrice?: number;
    slotSummary?: string;
  };
  onSuccess: (result: { outcome: "confirmed" | "pending" | "credited" }) => void;
}

interface PaymentFormProps {
  clientSecret: string;
  paymentIntentId: string;
  truckId: string;
  totalCents: number;
  breakdown: {
    hostPrice: number;
    platformFee: number;
    creditsApplied?: number;
  };
  onSuccess: (outcome: "confirmed" | "pending" | "credited") => void;
  onCancel: () => void;
}

function PaymentForm({
  clientSecret,
  paymentIntentId,
  truckId,
  totalCents,
  breakdown,
  onSuccess,
  onCancel,
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const inAppBrowser =
    typeof window !== "undefined" ? isInAppBrowser(window.navigator.userAgent) : false;

  const waitForBookingConfirmation = async () => {
    const startedAt = Date.now();
    const timeoutMs = 25_000;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const res = await fetch(
          `/api/bookings/payment-intent/${encodeURIComponent(
            paymentIntentId,
          )}?truckId=${encodeURIComponent(truckId)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.status === "confirmed") return "confirmed" as const;
          if (data?.status === "credited") return "credited" as const;
        }
      } catch {
        // ignore transient network issues; keep polling
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    return "pending" as const;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/parking-pass?booking=success`,
        },
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message || "An error occurred during payment.",
          variant: "destructive",
        });
      } else {
        const status = await waitForBookingConfirmation();
        if (status === "credited") {
          toast({
            title: "Booking Unavailable",
            description:
              "Payment succeeded but the spot was no longer available. Credits were issued to your account.",
            variant: "destructive",
          });
          onSuccess("credited");
          return;
        }

        toast({
          title: "Parking Pass Confirmed!",
          description:
            status === "pending"
              ? "Payment received. Your booking will appear shortly."
              : "Your parking spot has been reserved.",
        });
        onSuccess(status);
      }
    } catch (err: any) {
      toast({
        title: "Payment Error",
        description: err.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {inAppBrowser && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Payments may not finish inside Facebook or Messenger. Open this page in Safari or Chrome to complete your booking.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => openCurrentUrlInExternalBrowser()}
          >
            Open in Browser <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Pricing Breakdown */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between text-[color:var(--text-secondary)]">
          <span>Host Location Fee</span>
          <span className="font-medium">
            ${(breakdown.hostPrice / 100).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[color:var(--text-secondary)]">
          <span>MealScout Platform Fee</span>
          <span className="font-medium">
            ${(breakdown.platformFee / 100).toFixed(2)}
          </span>
        </div>
        {breakdown.creditsApplied ? (
          <div className="flex items-center justify-between text-[color:var(--status-success)]">
            <span>Credits Applied</span>
            <span className="font-medium">
              -${(breakdown.creditsApplied / 100).toFixed(2)}
            </span>
          </div>
        ) : null}
        <div className="border-t border-[var(--border-subtle)] pt-2 flex items-center justify-between font-semibold text-[color:var(--text-primary)]">
          <span>Total</span>
          <span className="text-lg">${(totalCents / 100).toFixed(2)}</span>
        </div>
        <p className="text-xs text-[color:var(--text-muted)] pt-1">
          All fees included. No hidden charges.
        </p>
      </div>

      {/* Stripe Payment Element */}
      <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--bg-surface)]">
        <PaymentElement />
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="flex-1"
          disabled={!stripe || isProcessing || inAppBrowser}
        >
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            `Pay $${(totalCents / 100).toFixed(2)}`
          )}
        </Button>
      </div>

      {/* Terms Notice */}
      <p className="text-xs text-[color:var(--text-muted)] text-center">
        By confirming payment, you acknowledge bookings are non-refundable once confirmed.
      </p>
    </form>
  );
}

export function BookingPaymentModal({
  open,
  onOpenChange,
  passId,
  truckId,
  slotTypes,
  selectedDates = [],
  eventDetails,
  onSuccess,
}: BookingPaymentModalProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [bookingData, setBookingData] = useState<{
    totalCents: number;
    breakdown: { hostPrice: number; platformFee: number; creditsApplied?: number };
  } | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [creditsToApply, setCreditsToApply] = useState("");
  const [promoCode, setPromoCode] = useState("");
  // true = host has Stripe Connect ready; false = payment held on platform, host payout deferred
  const [hostPaymentsReady, setHostPaymentsReady] = useState<boolean | null>(null);
  const cancelOnInitiateRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const stage: "review" | "pay" = clientSecret ? "pay" : "review";

  useEffect(() => {
    if (open) {
      cancelOnInitiateRef.current = false;
      if (!stripePromise) {
        toast({
          title: "Payments unavailable",
          description: "Payments are temporarily unavailable. Try again shortly.",
          variant: "destructive",
        });
        onOpenChange(false);
        return;
      }
      loadCreditBalance();
    }
  }, [open]);

  const cancelCheckout = async (intentId: string) => {
    try {
      await fetch(
        `/api/bookings/payment-intent/${encodeURIComponent(intentId)}/cancel?truckId=${encodeURIComponent(
          truckId,
        )}`,
        { method: "POST" },
      );
    } catch {
      // Best effort; pending holds will eventually expire.
    }
  };

  const loadCreditBalance = async () => {
    try {
      const res = await fetch("/api/payout/balance");
      if (!res.ok) return;
      const data = await res.json();
      setCreditBalance(Number(data.balance || 0));
    } catch (error) {
      console.error("Failed to load credit balance:", error);
    }
  };

  const initiateBooking = async () => {
    setIsLoading(true);
    try {
      const requestIdempotencyKey =
        idempotencyKeyRef.current ||
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      idempotencyKeyRef.current = requestIdempotencyKey;

      const creditCents = Math.max(
        0,
        Math.floor(Number(creditsToApply || 0) * 100),
      );
      const res = await fetch(`/api/parking-pass/${passId}/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestIdempotencyKey,
        },
        body: JSON.stringify({
          truckId,
          slotTypes,
          selectedDates,
          applyCreditsCents: creditCents > 0 ? creditCents : undefined,
          promoCode: promoCode.trim() ? promoCode.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to initiate booking");
      }

      const data = await res.json();
      if (cancelOnInitiateRef.current) {
        const intentId = String(data.paymentIntentId || "").trim();
        if (intentId) {
          await cancelCheckout(intentId);
        }
        return;
      }
      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId || null);
      setHostPaymentsReady(data.hostPaymentsReady !== false);
      setBookingData({
        totalCents: data.totalCents,
        breakdown: data.breakdown,
      });
    } catch (err: any) {
      toast({
        title: "Booking Failed",
        description:
          err.message || "Could not initiate booking. Please try again.",
        variant: "destructive",
      });
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const resetState = () => {
    setClientSecret(null);
    setPaymentIntentId(null);
    setBookingData(null);
    setCreditsToApply("");
    setPromoCode("");
    idempotencyKeyRef.current = null;
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleCancel = () => {
    const intentId = paymentIntentId;
    cancelOnInitiateRef.current = isLoading;
    resetState();
    onOpenChange(false);

    if (intentId) {
      void cancelCheckout(intentId);
    }
  };

  const handleSuccess = (outcome: "confirmed" | "pending" | "credited") => {
    handleClose();
    onSuccess({ outcome });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Parking Pass Checkout</DialogTitle>
          <DialogDescription>
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className={`rounded-full border px-2.5 py-1 font-semibold ${
                    stage === "review"
                      ? "border-orange-200 bg-orange-50 text-orange-900"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--text-muted)]"
                  }`}
                >
                  1. Review
                </span>
                <span className="h-px flex-1 bg-[var(--bg-subtle)]" />
                <span
                  className={`rounded-full border px-2.5 py-1 font-semibold ${
                    stage === "pay"
                      ? "border-orange-200 bg-orange-50 text-orange-900"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--text-muted)]"
                  }`}
                >
                  2. Pay
                </span>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[color:var(--text-secondary)]">
                <p className="font-semibold text-[color:var(--text-primary)]">{eventDetails.hostName}</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {eventDetails.date} · {eventDetails.startTime} - {eventDetails.endTime}
                </p>
                {eventDetails.slotSummary ? (
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    Slots: {eventDetails.slotSummary}
                  </p>
                ) : null}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {!clientSecret && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">Credits</p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  Credits reduce the MealScout platform fee.
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-[color:var(--text-muted)]">Available</p>
                <p className="text-base font-semibold text-[color:var(--text-primary)]">
                  ${(creditBalance || 0).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-[color:var(--text-muted)]">
                  Apply credits
                </label>
                <button
                  type="button"
                  className="text-xs text-[color:var(--text-muted)] underline"
                  onClick={() =>
                    setCreditsToApply(String((creditBalance || 0).toFixed(2)))
                  }
                >
                  Use max
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={creditsToApply}
                onChange={(e) => setCreditsToApply(e.target.value)}
                className="w-full rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm"
                placeholder="0.00"
              />
              <p className="text-[11px] text-[color:var(--text-muted)]">
                Your spot is held briefly while you check out. Closing this window releases the hold.
              </p>
            </div>

            {(import.meta.env.DEV ||
              String(import.meta.env.VITE_SHOW_TEST_PROMOS || "").toLowerCase() ===
                "true") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[color:var(--text-muted)]">
                  Promo code (testing)
                </label>
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm"
                  placeholder="e.g. BOOKFEE10, TEST1, or FREE100"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={initiateBooking}
                disabled={isLoading}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {clientSecret ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Pricing locked. Complete payment to confirm your booking.
          </div>
        ) : null}

        {clientSecret && hostPaymentsReady === false ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <strong>Note:</strong> This host is still setting up their payout account. Your payment
            will be held securely by MealScout and released to the host once they are ready to receive payouts.
            Your booking is fully guaranteed.
          </div>
        ) : null}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            <span className="ml-3 text-[color:var(--text-muted)]">Preparing payment...</span>
          </div>
        )}

        {!isLoading && clientSecret && paymentIntentId && bookingData && (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#ea580c",
                },
              },
            }}
          >
            <PaymentForm
              clientSecret={clientSecret}
              paymentIntentId={paymentIntentId}
              truckId={truckId}
              totalCents={bookingData.totalCents}
              breakdown={bookingData.breakdown}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

