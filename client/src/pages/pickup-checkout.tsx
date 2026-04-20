/**
 * Pickup Checkout page
 * Customer fills in contact info, chooses card/cash, and pays via Stripe.
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Loader2,
  ShoppingCart,
  AlertCircle,
  CreditCard,
  Banknote,
} from "lucide-react";
import type { CartItem } from "./online-menu";

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
  acceptsCash: boolean;
  hidePlatformFee: boolean;
}

export default function CheckoutPage() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const [, navigate] = useLocation();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [menuInfo, setMenuInfo] = useState<MenuInfo | null>(null);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash">("card");
  const [orderType, setOrderType] = useState<"pickup" | "dine_in">("pickup");
  const [contact, setContact] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    const restaurantCart = getCart().filter(
      (i) => i.restaurantId === restaurantId,
    );
    setCart(restaurantCart);

    // Also fetch menu to check acceptsCash + hidePlatformFee
    if (restaurantId) {
      fetch(`/api/menus/${encodeURIComponent(restaurantId)}`)
        .then((r) => r.json())
        .then((payload: any) => {
          setOrderingEnabled(Boolean(payload?.orderingEnabled));
          const menus = Array.isArray(payload?.menus) ? payload.menus : [];
          const activeMenu = menus.find((m: any) => m.isActive);
          if (activeMenu) {
            setMenuInfo({
              acceptsCash: activeMenu.acceptsCash,
              hidePlatformFee: activeMenu.hidePlatformFee,
            });
          }
        })
        .catch(() => {});
    }
  }, [restaurantId]);

  if (cart.length === 0) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="max-w-lg mx-auto px-4 py-20 text-center">
          <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">Your cart is empty.</p>
          <Button
            className="mt-4"
            onClick={() => navigate(`/menu/${restaurantId}`)}
          >
            Back to Menu
          </Button>
        </div>
      </div>
    );
  }

  const subtotal = cart.reduce((sum, i) => sum + i.lineTotalCents, 0);
  const platformFee = menuInfo?.hidePlatformFee ? 0 : 100;
  const total = subtotal + platformFee;
  const menuId = cart[0].menuId;

  const createOrder = async () => {
    if (!contact.name.trim()) {
      setOrderError("Please enter your name.");
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
        paymentMethod,
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
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="max-w-lg mx-auto px-4 py-8">
          <h1 className="text-2xl font-bold mb-6">Payment</h1>
          <Card className="mb-4">
            <CardContent className="pt-4 pb-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {platformFee > 0 && (
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted-foreground">MealScout fee</span>
                  <span>{formatMoney(platformFee)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-2 mt-2">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
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
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Checkout</h1>

        {!orderingEnabled && (
          <div className="flex items-center gap-2 text-amber-800 text-sm bg-amber-50 px-4 py-3 rounded-lg mb-4 border border-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Menu browsing is always free. Online ordering is not yet active
            for this restaurant — please order in person.
          </div>
        )}

        {/* Order summary */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order Summary</CardTitle>
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
            <div className="border-t pt-2 mt-2 space-y-1">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {platformFee > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>MealScout fee</span>
                  <span>{formatMoney(platformFee)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-base pt-1">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact info */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input
                value={contact.name}
                onChange={(e) =>
                  setContact((c) => ({ ...c, name: e.target.value }))
                }
                placeholder="Your name"
              />
            </div>
            <div>
              <Label>
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
              />
            </div>
            <div>
              <Label>
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
              />
            </div>
          </CardContent>
        </Card>

        {/* Order type */}
        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order Type</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={orderType}
              onValueChange={(v) => setOrderType(v as "pickup" | "dine_in")}
              className="flex gap-4"
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
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Payment method */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment Method</CardTitle>
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
          </CardContent>
        </Card>

        {orderError && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-3 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {orderError}
          </div>
        )}

        <Button
          className="w-full h-12 text-base"
          onClick={createOrder}
          disabled={isCreating || !contact.name.trim() || !orderingEnabled}
        >
          {isCreating && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          {paymentMethod === "cash"
            ? "Place Order (Cash)"
            : `Pay ${formatMoney(total)}`}
        </Button>
      </div>
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
        className="w-full h-12 text-base"
        disabled={!stripe || isProcessing}
      >
        {isProcessing && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
        Confirm Payment
      </Button>
    </form>
  );
}
