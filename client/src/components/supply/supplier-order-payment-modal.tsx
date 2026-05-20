import { useEffect, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import PaymentBrowserGate from "@/components/payment-browser-gate";
import { isPaymentHostileBrowser } from "@/lib/inAppBrowser";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || "";
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

const formatMoney = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const createIdempotencyKey = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore and use fallback
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

function PaymentForm(props: {
  orderId: string;
  clientSecret: string;
  totalCents: number;
  onPaid: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const waitForPaid = async () => {
    const startedAt = Date.now();
    const timeoutMs = 35_000;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const res = await fetch(`/api/supplier-orders/${encodeURIComponent(props.orderId)}`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (res.ok && String(data?.paymentStatus || "") === "paid") return true;
      } catch {
        // ignore
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    return false;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/suppliers`,
        },
        redirect: "if_required",
      });

      if (error) {
        toast({
          title: "Payment failed",
          description: error.message || "An error occurred during payment.",
          variant: "destructive",
        });
        return;
      }

      const ok = await waitForPaid();
      toast({
        title: ok ? "Payment received" : "Payment processing",
        description: ok
          ? "Your order is marked as paid."
          : "Payment received. This may take a moment to reflect on your order.",
      });
      props.onPaid();
    } catch (err: any) {
      toast({
        title: "Payment error",
        description: err?.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-lg border p-4 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Total due</span>
          <span className="font-semibold">{formatMoney(props.totalCents)}</span>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <PaymentElement />
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={props.onCancel} disabled={isProcessing}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" disabled={!stripe || isProcessing}>
          {isProcessing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            `Pay ${formatMoney(props.totalCents)}`
          )}
        </Button>
      </div>
    </form>
  );
}

export function SupplierOrderPaymentModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  onPaid?: () => void;
}) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [totalCents, setTotalCents] = useState<number>(0);
  const [chargeAmountCents, setChargeAmountCents] = useState<number>(0);
  const [buyerDiscountCents, setBuyerDiscountCents] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<"ach" | "card">("ach");
  const [startError, setStartError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [feeBreakdown, setFeeBreakdown] = useState<{
    supplierGrossCents: number;
    platformBaseFeeCents: number;
    buyerProcessingFeeCents: number;
  } | null>(null);
  const hostileBrowser = isPaymentHostileBrowser();

  useEffect(() => {
    if (!props.open) {
      setClientSecret(null);
      setTotalCents(0);
      setChargeAmountCents(0);
      setBuyerDiscountCents(0);
      setStartError(null);
      setPromoCode("");
      setFeeBreakdown(null);
      return;
    }

    if (!stripePromise) {
      toast({
        title: "Payments unavailable",
        description: "Stripe is not configured for this environment.",
        variant: "destructive",
      });
      props.onOpenChange(false);
      return;
    }
  }, [props.open, props.orderId, props, toast]);

  const startPayment = async (method: "ach" | "card") => {
    if (hostileBrowser) {
      setStartError("Open this page in Chrome or Safari to complete payment.");
      return;
    }
    setStartError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/supplier-orders/${encodeURIComponent(props.orderId)}/pay-intent`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          paymentMethod: method,
          promoCode: promoCode.trim() ? promoCode.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409) {
        throw new Error(
          data?.message || "A payment attempt is already in progress for this order. Please wait and retry.",
        );
      }
      if (!res.ok) throw new Error(data?.message || "Failed to start payment");
      setPaymentMethod(method);
      setClientSecret(String(data?.clientSecret || ""));
      const total = Number(data?.totalCents || 0) || 0;
      const charge = Number(data?.chargeAmountCents ?? total) || total;
      setTotalCents(total);
      setChargeAmountCents(charge);
      setBuyerDiscountCents(Number(data?.buyerDiscountCents || 0) || 0);
      setFeeBreakdown({
        supplierGrossCents: Number(data?.breakdown?.supplierGrossCents || 0) || 0,
        platformBaseFeeCents: Number(data?.breakdown?.platformBaseFeeCents || 0) || 0,
        buyerProcessingFeeCents: Number(data?.breakdown?.buyerProcessingFeeCents || 0) || 0,
      });
    } catch (err: any) {
      const msg = err?.message || "Please try again.";
      setStartError(msg);
      toast({
        title: "Unable to start payment",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetMethodSelection = () => {
    setClientSecret(null);
    setStartError(null);
  };

  const headerTotal = useMemo(() => {
    const base = totalCents || 0;
    const charge = chargeAmountCents || 0;
    return { base, charge };
  }, [totalCents, chargeAmountCents]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
          <DialogDescription>
            Pay through MealScout. ACH is recommended for large orders.
          </DialogDescription>
        </DialogHeader>

        {!clientSecret ? (
          <div className="space-y-4">
            {hostileBrowser ? (
              <PaymentBrowserGate
                currentUrl={window.location.href}
                reason="Complete supplier payment in Chrome or Safari."
                compact
              />
            ) : null}
            <div className="rounded-lg border p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Order total</span>
                <span className="font-semibold">{formatMoney(headerTotal.base)}</span>
              </div>
              {buyerDiscountCents > 0 ? (
                <div className="flex items-center justify-between text-[color:var(--status-success)]">
                  <span>ACH discount</span>
                  <span className="font-medium">-{formatMoney(buyerDiscountCents)}</span>
                </div>
              ) : null}
              {headerTotal.charge > 0 && headerTotal.charge !== headerTotal.base ? (
                <div className="flex items-center justify-between font-semibold">
                  <span>Pay now</span>
                  <span>{formatMoney(headerTotal.charge)}</span>
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground">
                Select your payment method. For large payments, bank transfer is usually cheapest.
              </div>
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
                  placeholder="e.g. TEST1 or FREE100"
                />
              </div>
            )}

            {startError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {startError}
              </div>
            ) : null}

            <div className="grid gap-2">
              <Button className="h-auto justify-between gap-2 py-3 text-left" disabled={isLoading || hostileBrowser} onClick={() => startPayment("ach")}>
                <span>Pay by bank transfer (ACH)</span>
                <Badge variant="secondary">Recommended</Badge>
              </Button>
              <Button variant="outline" className="h-auto py-3" disabled={isLoading || hostileBrowser} onClick={() => startPayment("card")}>
                Pay by card
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting payment...
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Selected method</span>
                <span className="font-medium">
                  {paymentMethod === "ach" ? "Bank transfer (ACH)" : "Card"}
                </span>
              </div>
              {feeBreakdown ? (
                <>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Supplier subtotal</span>
                    <span>{formatMoney(feeBreakdown.supplierGrossCents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Platform base fee</span>
                    <span>{formatMoney(feeBreakdown.platformBaseFeeCents)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Buyer processing fee</span>
                    <span>{formatMoney(feeBreakdown.buyerProcessingFeeCents)}</span>
                  </div>
                </>
              ) : null}
              {buyerDiscountCents > 0 ? (
                <div className="flex items-center justify-between text-[color:var(--status-success)]">
                  <span>ACH discount</span>
                  <span>-{formatMoney(buyerDiscountCents)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between font-semibold">
                <span>Pay now</span>
                <span>{formatMoney(chargeAmountCents || totalCents)}</span>
              </div>
            </div>

            <Button variant="outline" className="w-full sm:w-auto" onClick={resetMethodSelection}>
              Change method
            </Button>

            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PaymentForm
                orderId={props.orderId}
                clientSecret={clientSecret}
                totalCents={chargeAmountCents || totalCents}
                onPaid={() => {
                  props.onPaid?.();
                  props.onOpenChange(false);
                }}
                onCancel={() => props.onOpenChange(false)}
              />
            </Elements>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
