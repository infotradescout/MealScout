/**
 * Pickup Checkout page
 * Customer fills in contact info, chooses card/cash, and pays via Stripe.
 */
import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { PublicOrderingTopBar } from "@/components/public-ordering/PublicOrderingTopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Loader2,
  ShoppingCart,
  AlertCircle,
  CreditCard,
  Banknote,
  ArrowLeft,
  MapPin,
} from "lucide-react";
import type { CartItem } from "./online-menu";
import PaymentBrowserGate from "@/components/payment-browser-gate";
import { isPaymentHostileBrowser } from "@/lib/inAppBrowser";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || "";
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

const CART_KEY = "mealscout_cart";
const MEALSCOUT_ORDER_FEE_CENTS = 100;
const STRIPE_FEE_BPS = 290;
const STRIPE_FEE_FIXED_CENTS = 30;
const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

function estimateProcessingFeeCents(baseBeforeProcessingCents: number) {
  if (!Number.isFinite(baseBeforeProcessingCents) || baseBeforeProcessingCents <= 0) {
    return 0;
  }
  const denominator = 10_000 - STRIPE_FEE_BPS;
  if (denominator <= 0) {
    return Math.ceil(
      (baseBeforeProcessingCents * STRIPE_FEE_BPS) / 10_000 +
        STRIPE_FEE_FIXED_CENTS,
    );
  }
  const gross = Math.ceil(
    ((baseBeforeProcessingCents + STRIPE_FEE_FIXED_CENTS) * 10_000) /
      denominator,
  );
  return Math.max(0, gross - baseBeforeProcessingCents);
}

function getCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function clearCartForRestaurant(restaurantId: string) {
  try {
    const cart = getCart().filter((i) => i.restaurantId !== restaurantId);
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // ignore
  }
}

interface MenuInfo {
  acceptsCash: boolean;
  hidePlatformFee: boolean;
}

interface DeliveryInfo {
  enabled: boolean;
  feeCents: number;
  minimumOrderCents: number;
  estimatedMinutes: number;
  postalCodes: string[];
  instructions?: string | null;
}

interface OrderingReadiness {
  blockingReasons: string[];
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    action: string;
  }>;
}

export default function CheckoutPage() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const [, navigate] = useLocation();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [menuInfo, setMenuInfo] = useState<MenuInfo | null>(null);
  const [menuInfoError, setMenuInfoError] = useState(false);
  const [readiness, setReadiness] = useState<OrderingReadiness | null>(null);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash">("card");
  const [orderType, setOrderType] = useState<"pickup" | "dine_in" | "delivery">("pickup");
  const [deliveryInfo, setDeliveryInfo] = useState<DeliveryInfo | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState({
    address: "",
    city: "",
    state: "",
    postalCode: "",
    instructions: "",
  });
  const [contact, setContact] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [serverTotals, setServerTotals] = useState<{
    subtotalCents: number;
    platformFeeCents: number;
    totalCents: number;
    feePaidByBusiness: boolean;
  } | null>(null);
  const hostileBrowser = isPaymentHostileBrowser();

  useEffect(() => {
    const restaurantCart = getCart().filter(
      (i) => i.restaurantId === restaurantId,
    );
    setCart(restaurantCart);

    // Also fetch menu to check acceptsCash + hidePlatformFee
    if (restaurantId) {
      setMenuInfoError(false);
      fetch(`/api/menus/${encodeURIComponent(restaurantId)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Menu lookup failed (${r.status})`);
          return r.json();
        })
        .then((payload: any) => {
          setOrderingEnabled(Boolean(payload?.orderingEnabled));
          setReadiness(payload?.readiness || null);
          const menus = Array.isArray(payload?.menus) ? payload.menus : [];
          const activeMenu = menus.find((m: any) => m.isActive);
          if (activeMenu) {
            setMenuInfo({
              acceptsCash: activeMenu.acceptsCash,
              hidePlatformFee: activeMenu.hidePlatformFee,
            });
          }
        })
        // A failed lookup previously left menuInfo null, which silently
        // hides the cash option with no explanation -- surface it instead
        // so a diner who expected to pay cash isn't just confused.
        .catch(() => setMenuInfoError(true));
      fetch(`/api/restaurants/${encodeURIComponent(restaurantId)}/delivery`)
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => setDeliveryInfo(payload))
        .catch(() => setDeliveryInfo(null));
    }
  }, [restaurantId]);

  if (cart.length === 0) {
    return (
      <div
        className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)]"
        data-public-checkout-shell="warm-food-led"
      >
        <PublicOrderingTopBar
          secondaryHref={`/menu/${restaurantId}`}
          secondaryLabel="Menu"
        />
        <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center px-4 py-20">
          <section className="profile-surface w-full rounded-[2rem] p-7 text-center sm:p-10">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--profile-surface-strong)] text-[color:var(--profile-accent)]">
              <ShoppingCart className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-black tracking-tight text-[color:var(--profile-ink)]">
              Your cart is empty
            </h1>
            <p className="mt-2 text-sm text-[color:var(--profile-muted)]">
              Add something from the menu when online ordering is available.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href={`/menu/${restaurantId}`}
                className="profile-action-secondary inline-flex min-h-11 items-center rounded-full px-5 text-sm font-black"
              >
                Return to menu
              </Link>
              <Link
                href="/scout"
                className="profile-action-primary inline-flex min-h-11 items-center rounded-full px-5 text-sm font-black"
              >
                Scout
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const subtotal = cart.reduce((sum, i) => sum + i.lineTotalCents, 0);
  const platformFee = menuInfo?.hidePlatformFee
    ? 0
    : MEALSCOUT_ORDER_FEE_CENTS +
      (paymentMethod === "card"
        ? estimateProcessingFeeCents(subtotal + MEALSCOUT_ORDER_FEE_CENTS)
        : 0);
  const deliveryFee = orderType === "delivery" ? Number(deliveryInfo?.feeCents || 0) : 0;
  const total = subtotal + platformFee + deliveryFee;
  const displayedSubtotal = serverTotals?.subtotalCents ?? subtotal;
  const displayedFee = serverTotals?.feePaidByBusiness
    ? 0
    : (serverTotals?.platformFeeCents ?? platformFee);
  const displayedTotal = serverTotals?.totalCents ?? total;
  const menuId = cart[0].menuId;

  const createOrder = async () => {
    if (!contact.name.trim()) {
      setOrderError("Please enter your name.");
      return;
    }
    if (paymentMethod === "card" && hostileBrowser) {
      setOrderError("Open this page in Chrome or Safari to complete card payment.");
      return;
    }
    if (orderType === "delivery" && (!deliveryAddress.address.trim() || !deliveryAddress.city.trim() || !deliveryAddress.state.trim() || !deliveryAddress.postalCode.trim())) {
      setOrderError("Enter the complete delivery address.");
      return;
    }
    setOrderError(null);
    setIsCreating(true);
    try {
      const payload = {
        restaurantId,
        menuId,
        customerName: contact.name.trim(),
        customerEmail: contact.email.trim() || undefined,
        customerPhone: contact.phone.trim() || undefined,
        orderType,
        deliveryAddress: orderType === "delivery" ? deliveryAddress.address.trim() : undefined,
        deliveryCity: orderType === "delivery" ? deliveryAddress.city.trim() : undefined,
        deliveryState: orderType === "delivery" ? deliveryAddress.state.trim() : undefined,
        deliveryPostalCode: orderType === "delivery" ? deliveryAddress.postalCode.trim() : undefined,
        deliveryInstructions: orderType === "delivery" ? deliveryAddress.instructions.trim() || undefined : undefined,
        paymentMethod,
        promotionToken:
          window.localStorage.getItem(
            `mealscout:promotion:${restaurantId}`,
          ) || undefined,
        items: cart.map((i) => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          selectedVariantId: i.selectedVariantId,
          selectedModifierIds: i.selectedModifierIds,
          specialInstructions: i.specialInstructions || undefined,
        })),
      };
      const res = await fetch("/api/pickup-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create order");

      setOrderId(data.order.id);
      setServerTotals({
        subtotalCents: Number(data.order.subtotalCents || subtotal) || subtotal,
        platformFeeCents:
          Number(data.order.platformFeeCents || platformFee) || platformFee,
        totalCents: Number(data.order.totalCents || total) || total,
        feePaidByBusiness: Boolean(data.order.feePaidByBusiness),
      });

      if (paymentMethod === "cash") {
        // No payment needed — redirect immediately
        clearCartForRestaurant(restaurantId ?? "");
        navigate(`/order-confirmation/${data.order.id}`);
      } else {
        // Card payment — show Stripe Elements
        setClientSecret(data.clientSecret);
      }
    } catch (err: any) {
      const message = String(err?.message || "Failed to create order");
      if (message.toLowerCase().includes("subscription")) {
        setOrderError(
          "Online ordering requires the restaurant to have an active MealScout subscription. Menu browsing is always free — you can still view the menu and order in person.",
        );
      } else {
        setOrderError(message);
      }
    } finally {
      setIsCreating(false);
    }
  };

  // If we have a clientSecret, render the Stripe Elements form
  if (clientSecret && orderId && stripePromise) {
    return (
      <div
        className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)]"
        data-public-checkout-shell="warm-food-led"
      >
        <PublicOrderingTopBar
          secondaryHref={`/menu/${restaurantId}`}
          secondaryLabel="Menu"
        />
        <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
          <p className="profile-section-label">Pickup order</p>
          <h1 className="mb-6 mt-1 text-3xl font-black tracking-tight text-[color:var(--profile-ink)]">
            Payment
          </h1>
          {hostileBrowser ? (
            <div className="mb-4">
              <PaymentBrowserGate
                currentUrl={window.location.href}
                reason="Complete pickup checkout in Chrome or Safari."
                compact
              />
            </div>
          ) : null}
          <Card className="profile-surface mb-4 rounded-3xl">
            <CardContent className="pt-4 pb-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(displayedSubtotal)}</span>
              </div>
              {displayedFee > 0 && (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Processing + MealScout fee</span>
                  <span>{formatMoney(displayedFee)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-[#ead7c7] pt-2 font-black">
                <span>Total</span>
                <span>{formatMoney(displayedTotal)}</span>
              </div>
            </CardContent>
          </Card>
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: { theme: "stripe" } }}
          >
            <StripePaymentForm
              orderId={orderId}
              restaurantId={restaurantId ?? ""}
              onSuccess={() => {
                clearCartForRestaurant(restaurantId ?? "");
                navigate(`/order-confirmation/${orderId}`);
              }}
            />
          </Elements>
        </main>
      </div>
    );
  }

  return (
    <div
      className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)] pb-12 text-[color:var(--profile-ink)]"
      data-public-checkout-shell="warm-food-led"
    >
      <PublicOrderingTopBar
        secondaryHref={`/menu/${restaurantId}`}
        secondaryLabel="Menu"
      />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
        <Link
          href={`/menu/${restaurantId}`}
          className="mb-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-[color:var(--profile-surface-soft)] px-3 text-sm font-black text-[color:var(--profile-ink-soft)] transition-colors hover:text-[color:var(--profile-accent)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Return to menu
        </Link>
        <p className="profile-section-label">Pickup order</p>
        <h1 className="mb-6 mt-1 text-3xl font-black tracking-tight text-[color:var(--profile-ink)]">
          Checkout
        </h1>

        {!orderingEnabled && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[#efc37b] bg-[#fff4d9] px-4 py-3 text-sm text-[#70470f]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-black">Online ordering is not available</p>
              {readiness?.blockingReasons?.length ? (
                <p className="mt-1 text-xs">
                  Waiting on: {readiness.blockingReasons.join(", ")}.
                </p>
              ) : (
                <p className="mt-1 text-xs">
                  Please order in person for now.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Order summary */}
        <Card className="profile-surface mb-6 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Order summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cart.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span>
                  {item.quantity}× {item.itemName}
                  {item.variantLabel && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {item.variantLabel}
                    </span>
                  )}
                </span>
                <span>{formatMoney(item.lineTotalCents)}</span>
              </div>
            ))}
            <div className="mt-2 space-y-1 border-t border-[color:var(--profile-border)] pt-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {platformFee > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Processing + MealScout fee</span>
                  <span>{formatMoney(platformFee)}</span>
                </div>
              )}
              {deliveryFee > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Merchant delivery</span>
                  <span>{formatMoney(deliveryFee)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-base font-black">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact info */}
        <Card className="profile-surface mb-4 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Your details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="font-black text-[color:var(--profile-ink)]">Name *</Label>
              <Input
                value={contact.name}
                onChange={(e) =>
                  setContact((c) => ({ ...c, name: e.target.value }))
                }
                placeholder="Your name"
                className="mt-1 border-[#d8bda8] bg-white"
              />
            </div>
            <div>
              <Label className="font-black text-[color:var(--profile-ink)]">
                Email{" "}
                <span className="text-muted-foreground text-xs">
                  (for confirmation)
                </span>
              </Label>
              <Input
                type="email"
                value={contact.email}
                onChange={(e) =>
                  setContact((c) => ({ ...c, email: e.target.value }))
                }
                placeholder="you@email.com"
                className="mt-1 border-[#d8bda8] bg-white"
              />
            </div>
            <div>
              <Label className="font-black text-[color:var(--profile-ink)]">
                Phone{" "}
                <span className="text-muted-foreground text-xs">
                  (for SMS when ready)
                </span>
              </Label>
              <Input
                type="tel"
                value={contact.phone}
                onChange={(e) =>
                  setContact((c) => ({ ...c, phone: e.target.value }))
                }
                placeholder="(555) 000-0000"
                className="mt-1 border-[#d8bda8] bg-white"
              />
            </div>
          </CardContent>
        </Card>

        {/* Order type */}
        <Card className="profile-surface mb-4 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Order type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={orderType}
              onValueChange={(v) => setOrderType(v as "pickup" | "dine_in" | "delivery")}
              className="flex flex-wrap gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="pickup" id="ot-pickup" />
                <Label
                  htmlFor="ot-pickup"
                  className="cursor-pointer font-normal"
                >
                  Pickup
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="dine_in" id="ot-dinein" />
                <Label
                  htmlFor="ot-dinein"
                  className="cursor-pointer font-normal"
                >
                  Dine In
                </Label>
              </div>
              {deliveryInfo?.enabled && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="delivery" id="ot-delivery" />
                  <Label htmlFor="ot-delivery" className="cursor-pointer font-normal">
                    Delivery · {formatMoney(deliveryInfo.feeCents)}
                  </Label>
                </div>
              )}
            </RadioGroup>
          </CardContent>
        </Card>

        {orderType === "delivery" && (
          <Card className="profile-surface mb-4 rounded-3xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-black">
                <MapPin className="h-4 w-4" /> Delivery address
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Input className="sm:col-span-2" placeholder="Street address" value={deliveryAddress.address} onChange={(e) => setDeliveryAddress((v) => ({ ...v, address: e.target.value }))} />
              <Input placeholder="City" value={deliveryAddress.city} onChange={(e) => setDeliveryAddress((v) => ({ ...v, city: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="State" value={deliveryAddress.state} onChange={(e) => setDeliveryAddress((v) => ({ ...v, state: e.target.value }))} />
                <Input placeholder="ZIP code" value={deliveryAddress.postalCode} onChange={(e) => setDeliveryAddress((v) => ({ ...v, postalCode: e.target.value }))} />
              </div>
              <Input className="sm:col-span-2" placeholder="Gate code or delivery note (optional)" value={deliveryAddress.instructions} onChange={(e) => setDeliveryAddress((v) => ({ ...v, instructions: e.target.value }))} />
              <p className="sm:col-span-2 text-xs text-muted-foreground">
                {deliveryInfo?.estimatedMinutes || 45}-minute estimate
                {deliveryInfo?.minimumOrderCents ? ` · ${formatMoney(deliveryInfo.minimumOrderCents)} minimum` : ""}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Payment method */}
        <Card className="profile-surface mb-6 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Payment method
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as "card" | "cash")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="card" id="pm-card" />
                <Label
                  htmlFor="pm-card"
                  className="cursor-pointer font-normal flex items-center gap-1"
                >
                  <CreditCard className="w-4 h-4" /> Card
                </Label>
              </div>
              {menuInfo?.acceptsCash && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="cash" id="pm-cash" />
                  <Label
                    htmlFor="pm-cash"
                    className="cursor-pointer font-normal flex items-center gap-1"
                  >
                    <Banknote className="w-4 h-4" /> Cash at Pickup
                  </Label>
                </div>
              )}
            </RadioGroup>
            {menuInfoError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Couldn't check whether this restaurant accepts cash at pickup.
                Card payment is available; refresh to try again.
              </p>
            )}
          </CardContent>
        </Card>

        {orderError && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-3 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {orderError}
          </div>
        )}

        <Button
          className="h-12 w-full rounded-full bg-[#d84a12] text-base font-black text-white shadow-[0_16px_35px_rgba(149,58,18,0.2)] hover:bg-[#b83a0a]"
          onClick={createOrder}
          disabled={
            isCreating ||
            !contact.name.trim() ||
            !orderingEnabled ||
            (paymentMethod === "card" && hostileBrowser)
          }
        >
          {isCreating && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          {paymentMethod === "cash"
            ? "Place Order (Cash)"
            : `Pay ${formatMoney(total)}`}
        </Button>
      </main>
    </div>
  );
}

// ──────────────────────────── StripePaymentForm ───────────────────────────────
function StripePaymentForm({
  orderId,
  restaurantId,
  onSuccess,
}: {
  orderId: string;
  restaurantId: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/order-confirmation/${orderId}`,
        },
        redirect: "if_required",
      });

      if (stripeError) {
        setError(stripeError.message ?? "Payment failed");
        return;
      }

      // Payment succeeded without redirect
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Payment failed");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
      <Button
        type="submit"
        className="h-12 w-full rounded-full bg-[#d84a12] text-base font-black text-white hover:bg-[#b83a0a]"
        disabled={!stripe || isProcessing}
      >
        {isProcessing && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
        Confirm Payment
      </Button>
    </form>
  );
}
