/**
 * Pickup Checkout page
 * Customer fills in contact info and completes verified pickup card payment.
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
import { normalizeOrderContactPhone } from "@shared/orderContact";
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
  ArrowLeft,
  MapPin,
} from "lucide-react";
import type { CartItem } from "./online-menu";
import PaymentBrowserGate from "@/components/payment-browser-gate";
import { isPaymentHostileBrowser } from "@/lib/inAppBrowser";
import {
  toAuthoritativePaymentOrder,
  type AuthoritativePaymentOrder,
} from "@/lib/pickupCheckoutTruth";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY || "";
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

const CART_KEY = "mealscout_cart";
const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

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
  cardPaymentsEnabled: boolean;
  hidePlatformFee: boolean;
  pricesIncludeTax: boolean;
}

interface OrderingReadiness {
  blockingReasons: string[];
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  pickupAddressLabel?: string | null;
  paymentMethods?: {
    card: boolean;
    cash: boolean;
  };
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
  const [orderingEnabled, setOrderingEnabled] = useState(false);
  const paymentMethod = "card" as const;
  const [orderType, setOrderType] = useState<"pickup" | null>(null);
  const [contact, setContact] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [authoritativePaymentOrder, setAuthoritativePaymentOrder] =
    useState<AuthoritativePaymentOrder | null>(null);
  const [checkoutRequestId] = useState(() => crypto.randomUUID());
  const [customerAccessToken] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
  const [serverTotals, setServerTotals] = useState<{
    subtotalCents: number;
    mealscoutFeeCents: number;
    processingFeeCents: number;
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

    // Fetch the exact menu's card readiness and fee presentation.
    if (restaurantId) {
      setMenuInfoError(false);
      fetch(`/api/menus/${encodeURIComponent(restaurantId)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Menu lookup failed (${r.status})`);
          return r.json();
        })
        .then((payload: any) => {
          setReadiness(payload?.readiness || null);
          const menus = Array.isArray(payload?.menus) ? payload.menus : [];
          const cartMenuIds = new Set(
            restaurantCart.map((item) => item.menuId),
          );
          const cartMenuId =
            cartMenuIds.size === 1
              ? String(restaurantCart[0]?.menuId || "")
              : "";
          const activeMenu = menus.find(
            (menu: any) => menu.isActive && menu.id === cartMenuId,
          );
          if (activeMenu) {
            const cardPaymentsEnabled = Boolean(
              activeMenu?.paymentMethods?.card,
            );
            const pricesIncludeTax = activeMenu.pricesIncludeTax === true;
            setOrderingEnabled(
              Boolean(
                activeMenu.orderingEnabled &&
                cardPaymentsEnabled &&
                pricesIncludeTax,
              ),
            );
            setMenuInfo({
              cardPaymentsEnabled,
              hidePlatformFee: activeMenu.hidePlatformFee,
              pricesIncludeTax,
            });
          } else {
            setOrderingEnabled(false);
            setMenuInfo(null);
            setMenuInfoError(true);
          }
        })
        // A failed lookup must remain a visible, fail-closed checkout state.
        .catch(() => setMenuInfoError(true));
    }
  }, [restaurantId]);

  const cartMenuIds = new Set(cart.map((item) => item.menuId));
  const cartHasMixedMenus = cartMenuIds.size > 1;

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

  if (cartHasMixedMenus) {
    return (
      <div className="mealscout-public-profile min-h-screen bg-[color:var(--profile-page)]">
        <PublicOrderingTopBar
          secondaryHref={`/menu/${restaurantId}`}
          secondaryLabel="Menu"
        />
        <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center justify-center px-4 py-20">
          <section className="profile-surface w-full rounded-[2rem] p-7 text-center sm:p-10">
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-4 text-2xl font-black tracking-tight text-[color:var(--profile-ink)]">
              Choose one menu per order
            </h1>
            <p className="mt-2 text-sm text-[color:var(--profile-muted)]">
              This saved cart contains items from different menus, so its
              payment rules and fees cannot be verified safely.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  clearCartForRestaurant(restaurantId ?? "");
                  setCart([]);
                }}
              >
                Clear saved cart
              </Button>
              <Link
                href={`/menu/${restaurantId}`}
                className="profile-action-primary inline-flex min-h-10 items-center rounded-full px-5 text-sm font-black"
              >
                Return to menu
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const subtotal = cart.reduce((sum, i) => sum + i.lineTotalCents, 0);
  const knownTotalBeforeCardFees = subtotal;
  const customerCardFeesPending = Boolean(
    paymentMethod === "card" && menuInfo && !menuInfo.hidePlatformFee,
  );
  const displayedSubtotal = serverTotals?.subtotalCents ?? subtotal;
  const displayedMealscoutFee = serverTotals?.feePaidByBusiness
    ? 0
    : (serverTotals?.mealscoutFeeCents ?? 0);
  const displayedProcessingFee = serverTotals?.feePaidByBusiness
    ? 0
    : (serverTotals?.processingFeeCents ?? 0);
  const displayedTotal = serverTotals?.totalCents ?? knownTotalBeforeCardFees;
  const menuId = cart[0].menuId;
  const normalizedContactPhone = contact.phone.trim()
    ? normalizeOrderContactPhone(contact.phone)
    : null;

  const createOrder = async () => {
    if (new Set(cart.map((item) => item.menuId)).size !== 1) {
      setOrderError("Choose items from one menu before checkout.");
      return;
    }
    if (!contact.name.trim()) {
      setOrderError("Please enter your name.");
      return;
    }
    if (!orderType) {
      setOrderError("Choose pickup.");
      return;
    }
    if (!contact.email.trim() && !contact.phone.trim()) {
      setOrderError(
        "Enter an email address or phone number so you can receive order updates.",
      );
      return;
    }
    if (contact.phone.trim() && !normalizedContactPhone) {
      setOrderError(
        "Enter a valid phone number that can receive order updates.",
      );
      return;
    }
    if (hostileBrowser) {
      setOrderError(
        "Open this page in Chrome or Safari to complete card payment.",
      );
      return;
    }
    if (!stripePromise) {
      setOrderError(
        "Secure card payment is not configured on this checkout. No order was created.",
      );
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
        customerPhone: normalizedContactPhone || undefined,
        orderType,
        checkoutRequestId,
        customerAccessToken,
        paymentMethod,
        promotionToken:
          window.localStorage.getItem(`mealscout:promotion:${restaurantId}`) ||
          undefined,
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
      if (data.customerAccessToken) {
        window.sessionStorage.setItem(
          `mealscout:order-access:${data.order.id}`,
          data.customerAccessToken,
        );
      }
      if (String(data.order.status || "") !== "pending") {
        navigate(`/order-confirmation/${data.order.id}`);
        return;
      }
      if (!data.clientSecret) {
        throw new Error(
          "Secure payment setup did not finish. No payment can be submitted from this checkout.",
        );
      }
      setServerTotals({
        subtotalCents: Number(data.order.subtotalCents || subtotal) || subtotal,
        mealscoutFeeCents: Number(data.order.mealscoutFeeCents ?? 0),
        processingFeeCents: Number(data.order.processingFeeCents ?? 0),
        platformFeeCents: Number(data.order.platformFeeCents ?? 0),
        totalCents:
          Number(data.order.totalCents || knownTotalBeforeCardFees) ||
          knownTotalBeforeCardFees,
        feePaidByBusiness: Boolean(data.order.feePaidByBusiness),
      });
      setAuthoritativePaymentOrder(toAuthoritativePaymentOrder(data.order));

      setClientSecret(data.clientSecret);
    } catch (err: any) {
      const message = String(err?.message || "Failed to create order");
      setOrderError(message);
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
          {authoritativePaymentOrder?.merchantNameSnapshot ? (
            <div className="mb-4 rounded-2xl border border-[color:var(--profile-border)] bg-white px-4 py-3 text-sm">
              <p className="font-black">
                {authoritativePaymentOrder.merchantNameSnapshot}
              </p>
              {authoritativePaymentOrder.pickupAddressSnapshot ? (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {authoritativePaymentOrder.pickupAddressSnapshot}
                </p>
              ) : null}
            </div>
          ) : null}
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
              {displayedMealscoutFee > 0 && (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">MealScout fee</span>
                  <span>{formatMoney(displayedMealscoutFee)}</span>
                </div>
              )}
              {displayedProcessingFee > 0 && (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Card processing</span>
                  <span>{formatMoney(displayedProcessingFee)}</span>
                </div>
              )}
              {authoritativePaymentOrder?.pricesIncludeTax ? (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Tax</span>
                  <span>Included in item prices</span>
                </div>
              ) : null}
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
                <p className="mt-1 text-xs">Please order in person for now.</p>
              )}
            </div>
          </div>
        )}

        {readiness?.restaurantName ? (
          <Card className="profile-surface mb-4 rounded-3xl">
            <CardContent className="pt-4">
              <p className="font-black text-[color:var(--profile-ink)]">
                {readiness.restaurantName}
              </p>
              {readiness.pickupAddressLabel ? (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-[color:var(--profile-muted)]">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  {readiness.pickupAddressLabel}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-[color:var(--profile-muted)]">
                The status page will show when the business starts preparation
                and when the order is ready.
              </p>
            </CardContent>
          </Card>
        ) : null}

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
              {customerCardFeesPending && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Card fees</span>
                  <span>Calculated before payment</span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-base font-black">
                <span>
                  {customerCardFeesPending ? "Before card fees" : "Total"}
                </span>
                <span>{formatMoney(knownTotalBeforeCardFees)}</span>
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
              <Label
                htmlFor="customer-name"
                className="font-black text-[color:var(--profile-ink)]"
              >
                Name *
              </Label>
              <Input
                id="customer-name"
                value={contact.name}
                onChange={(e) =>
                  setContact((c) => ({ ...c, name: e.target.value }))
                }
                placeholder="Your name"
                className="mt-1 border-[#d8bda8] bg-white"
              />
            </div>
            <div>
              <Label
                htmlFor="customer-email"
                className="font-black text-[color:var(--profile-ink)]"
              >
                Email{" "}
                <span className="text-muted-foreground text-xs">
                  (email or phone required)
                </span>
              </Label>
              <Input
                id="customer-email"
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
              <Label
                htmlFor="customer-phone"
                className="font-black text-[color:var(--profile-ink)]"
              >
                Phone{" "}
                <span className="text-muted-foreground text-xs">
                  (email or phone required)
                </span>
              </Label>
              <Input
                id="customer-phone"
                type="tel"
                autoComplete="tel"
                maxLength={40}
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
              value={orderType || ""}
              onValueChange={() => setOrderType("pickup")}
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
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Payment method */}
        <Card className="profile-surface mb-6 rounded-3xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-black text-[color:var(--profile-ink)]">
              Payment method
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup value={paymentMethod} className="flex gap-4">
              {menuInfo?.cardPaymentsEnabled ? (
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="card" id="pm-card" />
                  <Label
                    htmlFor="pm-card"
                    className="cursor-pointer font-normal flex items-center gap-1"
                  >
                    <CreditCard className="w-4 h-4" /> Card
                  </Label>
                </div>
              ) : null}
            </RadioGroup>
            {menuInfoError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Payment availability could not be verified. Refresh before
                placing an order.
              </p>
            )}
            {menuInfo?.cardPaymentsEnabled ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Menu availability, hours, pickup location, and payment readiness
                are checked again when payment completes. If they changed, the
                order is blocked from fulfillment and payment cancellation or
                refund reconciliation begins.
              </p>
            ) : null}
            {menuInfo && !menuInfo.cardPaymentsEnabled ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                This business has not enabled a safe online payment method yet.
              </p>
            ) : null}
            {menuInfo && !menuInfo.pricesIncludeTax ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Checkout stays unavailable until this business confirms that
                displayed prices include applicable tax.
              </p>
            ) : null}
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
            (!contact.email.trim() && !contact.phone.trim()) ||
            (Boolean(contact.phone.trim()) && !normalizedContactPhone) ||
            !orderType ||
            !orderingEnabled ||
            !menuInfo?.cardPaymentsEnabled ||
            !stripePromise ||
            hostileBrowser
          }
        >
          {isCreating && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Continue to secure payment
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
