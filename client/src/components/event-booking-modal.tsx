import { useState } from "react";
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
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || "";
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

interface EventBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  truckId: string;
  eventDetails: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    hostName: string;
    hostPriceCents: number;
  };
  onSuccess: () => void;
}

interface PaymentFormProps {
  clientSecret: string;
  bookingId: string;
  totalCents: number;
  breakdown: { hostPrice: number; platformFee: number };
  onSuccess: () => void;
  onCancel: () => void;
}

function PaymentForm({
  clientSecret,
  bookingId,
  totalCents,
  breakdown,
  onSuccess,
  onCancel,
}: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/events?booking=success`,
        },
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message || "An error occurred during payment.",
          variant: "destructive",
        });
        return;
      }

      // Confirm booking via API (idempotent — webhook also handles this)
      try {
        await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // Non-fatal: webhook will confirm the booking
      }

      toast({
        title: "Booking Confirmed!",
        description: "Your spot has been reserved.",
      });
      onSuccess();
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
        <div className="border-t border-[var(--border-subtle)] pt-2 flex items-center justify-between font-semibold text-[color:var(--text-primary)]">
          <span>Total</span>
          <span className="text-lg">${(totalCents / 100).toFixed(2)}</span>
        </div>
        <p className="text-xs text-[color:var(--text-muted)] pt-1">
          All fees included. No hidden charges.
        </p>
      </div>

      <div className="border border-[var(--border-subtle)] rounded-lg p-4 bg-[var(--bg-surface)]">
        <PaymentElement />
      </div>

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
          disabled={!stripe || isProcessing}
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

      <p className="text-xs text-[color:var(--text-muted)] text-center">
        By confirming payment you agree that bookings are non-refundable once
        confirmed.
      </p>
    </form>
  );
}

export function EventBookingModal({
  open,
  onOpenChange,
  eventId,
  truckId,
  eventDetails,
  onSuccess,
}: EventBookingModalProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingData, setBookingData] = useState<{
    totalCents: number;
    breakdown: { hostPrice: number; platformFee: number };
  } | null>(null);

  const stage: "review" | "pay" = clientSecret ? "pay" : "review";

  const initiateBooking = async () => {
    if (!stripePromise) {
      toast({
        title: "Payments unavailable",
        description: "Payments are temporarily unavailable. Try again shortly.",
        variant: "destructive",
      });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/book`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ truckId }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Failed to initiate booking");
      }
      const data = await res.json();
      setClientSecret(data.clientSecret);
      setBookingId(data.bookingId);
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
    setBookingId(null);
    setBookingData(null);
  };

  const handleCancel = () => {
    resetState();
    onOpenChange(false);
  };

  const handleSuccess = () => {
    resetState();
    onOpenChange(false);
    onSuccess();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Book This Spot</DialogTitle>
          <DialogDescription asChild>
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
                <p className="font-semibold text-[color:var(--text-primary)]">
                  {eventDetails.hostName}
                </p>
                <p className="text-xs text-[color:var(--text-muted)]">
                  {eventDetails.name && `${eventDetails.name} · `}
                  {eventDetails.date} · {eventDetails.startTime}–
                  {eventDetails.endTime}
                </p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                  Host fee: ${(eventDetails.hostPriceCents / 100).toFixed(2)} +
                  $10.00 MealScout fee
                </p>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {!clientSecret && !isLoading && (
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={initiateBooking}>
              Continue to Payment
            </Button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            <span className="ml-3 text-[color:var(--text-muted)]">
              Preparing payment...
            </span>
          </div>
        )}

        {clientSecret && bookingId && bookingData && (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Pricing locked. Complete payment to confirm your spot.
            </div>
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "stripe",
                  variables: { colorPrimary: "#ea580c" },
                },
              }}
            >
              <PaymentForm
                clientSecret={clientSecret}
                bookingId={bookingId}
                totalCents={bookingData.totalCents}
                breakdown={bookingData.breakdown}
                onSuccess={handleSuccess}
                onCancel={handleCancel}
              />
            </Elements>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
