/**
 * Public Menu Page — Customer view of a restaurant/bar/truck's online menu.
 * Supports add-to-cart with variants + modifiers.
 * Cart state is stored in localStorage for simplicity.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ShoppingCart,
  Plus,
  Minus,
  Loader2,
  AlertCircle,
  Clock,
  Leaf,
  Wheat,
  ChevronRight,
} from "lucide-react";

const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

// ─────────────────────────────────── types ────────────────────────────────────
interface Variant {
  id: string;
  label: string;
  additionalCents: number;
  isDefault: boolean;
}

interface Modifier {
  id: string;
  groupName: string;
  label: string;
  additionalCents: number;
  isRequired: boolean;
  maxSelections: number;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  isAvailable: boolean;
  calories: number | null;
  dietaryTags: string[] | null;
  allergens: string[] | null;
  variants: Variant[];
  modifiers: Modifier[];
}

interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  items: MenuItem[];
}

interface Menu {
  id: string;
  name: string;
  serviceType: string;
  isActive: boolean;
  acceptsCash: boolean;
  hidePlatformFee: boolean;
  categories: MenuCategory[];
}

export interface CartItem {
  menuId: string;
  restaurantId: string;
  menuItemId: string;
  itemName: string;
  priceCents: number;
  quantity: number;
  selectedVariantId: string | null;
  variantLabel: string | null;
  variantAddCents: number;
  selectedModifierIds: string[];
  modifierLabels: string[];
  modifierAddCents: number;
  lineTotalCents: number;
  specialInstructions: string;
}

const CART_KEY = "mealscout_cart";

function getCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(cart: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export default function MenuPage() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const [, navigate] = useLocation();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [addingItem, setAddingItem] = useState<MenuItem | null>(null);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);

  // Load cart from localStorage on mount
  useEffect(() => {
    setCart(getCart());
  }, []);

  const menusQuery = useQuery<Menu[]>({
    queryKey: ["/api/menus", restaurantId],
    queryFn: async () => {
      const res = await fetch(`/api/menus/${encodeURIComponent(restaurantId ?? "")}`);
      if (!res.ok) throw new Error("Menu not found");
      return res.json();
    },
    enabled: !!restaurantId,
  });

  const menus = menusQuery.data ?? [];
  const activeMenus = menus.filter((m) => m.isActive);

  useEffect(() => {
    if (activeMenus.length > 0 && !selectedMenuId) {
      setSelectedMenuId(activeMenus[0].id);
    }
  }, [activeMenus.length, selectedMenuId]);

  const selectedMenu = activeMenus.find((m) => m.id === selectedMenuId) ?? null;

  const cartItemCount = cart
    .filter((i) => i.restaurantId === restaurantId)
    .reduce((sum, i) => sum + i.quantity, 0);

  const addToCart = (item: CartItem) => {
    const newCart = [...cart, item];
    setCart(newCart);
    saveCart(newCart);
  };

  const removeFromCart = (idx: number) => {
    const newCart = cart.filter((_, i) => i !== idx);
    setCart(newCart);
    saveCart(newCart);
  };

  const updateQty = (idx: number, delta: number) => {
    const newCart = cart.map((item, i) => {
      if (i !== idx) return item;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return null;
      return {
        ...item,
        quantity: newQty,
        lineTotalCents:
          (item.priceCents + item.variantAddCents + item.modifierAddCents) * newQty,
      };
    }).filter(Boolean) as CartItem[];
    setCart(newCart);
    saveCart(newCart);
  };

  const restaurantCart = cart.filter((i) => i.restaurantId === restaurantId);
  const cartTotal = restaurantCart.reduce((sum, i) => sum + i.lineTotalCents, 0);

  if (menusQuery.isLoading) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (menusQuery.isError || activeMenus.length === 0) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex flex-col items-center justify-center py-32 gap-3">
          <AlertCircle className="w-10 h-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {menusQuery.isError ? "Menu could not be loaded." : "This location has no active online menu."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navigation />

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Menu selector tabs if multiple menus */}
        {activeMenus.length > 1 && (
          <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
            {activeMenus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => setSelectedMenuId(menu.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${
                  selectedMenuId === menu.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted border-border"
                }`}
              >
                {menu.name}
              </button>
            ))}
          </div>
        )}

        {selectedMenu && (
          <>
            {!selectedMenu.hidePlatformFee && (
              <p className="text-xs text-muted-foreground mb-4 text-center">
                A $1.00 MealScout service fee is added at checkout.
                {selectedMenu.acceptsCash && " Cash payments accepted."}
              </p>
            )}

            {/* Category + items */}
            {selectedMenu.categories.map((cat) => {
              const visibleItems = cat.items.filter((i) => i.isAvailable);
              if (visibleItems.length === 0) return null;
              return (
                <div key={cat.id} className="mb-8">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3">{cat.name}</h2>
                  {cat.description && (
                    <p className="text-sm text-muted-foreground mb-3">{cat.description}</p>
                  )}
                  <div className="divide-y">
                    {visibleItems.map((item) => (
                      <MenuItemCard
                        key={item.id}
                        item={item}
                        onAdd={() => setAddingItem(item)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Floating cart button */}
      {cartItemCount > 0 && (
        <div className="fixed bottom-4 inset-x-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-96 z-50">
          <Button className="w-full h-12 text-base shadow-lg" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="w-5 h-5 mr-2" />
            View Cart ({cartItemCount})
            <span className="ml-auto">{formatMoney(cartTotal)}</span>
          </Button>
        </div>
      )}

      {/* Add item dialog */}
      {addingItem && selectedMenu && (
        <AddItemDialog
          item={addingItem}
          menuId={selectedMenu.id}
          restaurantId={restaurantId ?? ""}
          hidePlatformFee={selectedMenu.hidePlatformFee}
          onAdd={(cartItem) => {
            addToCart(cartItem);
            setAddingItem(null);
          }}
          onClose={() => setAddingItem(null)}
        />
      )}

      {/* Cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Your Cart</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {restaurantCart.length === 0 && (
              <p className="text-center text-muted-foreground py-8">Your cart is empty.</p>
            )}
            {restaurantCart.map((item, idx) => {
              const globalIdx = cart.indexOf(item);
              return (
                <div key={idx} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{item.itemName}</div>
                    {item.variantLabel && (
                      <div className="text-xs text-muted-foreground">{item.variantLabel}</div>
                    )}
                    {item.modifierLabels.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        + {item.modifierLabels.join(", ")}
                      </div>
                    )}
                    {item.specialInstructions && (
                      <div className="text-xs italic text-muted-foreground">
                        {item.specialInstructions}
                      </div>
                    )}
                    <div className="font-semibold text-sm mt-1">{formatMoney(item.lineTotalCents)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => updateQty(globalIdx, -1)}
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="w-5 text-center text-sm">{item.quantity}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => updateQty(globalIdx, 1)}
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <SheetFooter className="border-t pt-4">
            <div className="w-full space-y-3">
              <div className="flex justify-between font-medium">
                <span>Subtotal</span>
                <span>{formatMoney(cartTotal)}</span>
              </div>
              {restaurantCart.length > 0 && selectedMenu && !selectedMenu.hidePlatformFee && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>MealScout fee</span>
                  <span>$1.00</span>
                </div>
              )}
              <Button
                className="w-full"
                size="lg"
                onClick={() => {
                  setCartOpen(false);
                  navigate(`/checkout/${restaurantId}`);
                }}
                disabled={restaurantCart.length === 0}
              >
                Proceed to Checkout
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────────── MenuItemCard ─────────────────────────────────
function MenuItemCard({ item, onAdd }: { item: MenuItem; onAdd: () => void }) {
  return (
    <div className="flex gap-3 py-3 cursor-pointer hover:bg-muted/30 px-1 rounded transition-colors" onClick={onAdd}>
      <div className="flex-1">
        <div className="font-medium">{item.name}</div>
        {item.description && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
        )}
        <div className="flex gap-2 flex-wrap mt-1">
          <span className="text-sm font-semibold">{formatMoney(item.priceCents)}</span>
          {item.calories && <span className="text-xs text-muted-foreground">{item.calories} cal</span>}
          {(item.dietaryTags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt={item.name}
          className="w-20 h-20 object-cover rounded-lg shrink-0"
        />
      )}
    </div>
  );
}

// ───────────────────────────── AddItemDialog ──────────────────────────────────
function AddItemDialog({
  item,
  menuId,
  restaurantId,
  hidePlatformFee,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  menuId: string;
  restaurantId: string;
  hidePlatformFee: boolean;
  onAdd: (cartItem: CartItem) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    item.variants.find((v) => v.isDefault)?.id ?? item.variants[0]?.id ?? null
  );
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [specialInstructions, setSpecialInstructions] = useState("");

  const selectedVariant = item.variants.find((v) => v.id === selectedVariantId);
  const variantAddCents = selectedVariant?.additionalCents ?? 0;
  const selectedModifiers = item.modifiers.filter((m) => selectedModifierIds.includes(m.id));
  const modifierAddCents = selectedModifiers.reduce((sum, m) => sum + m.additionalCents, 0);
  const unitPrice = item.priceCents + variantAddCents + modifierAddCents;
  const lineTotal = unitPrice * qty;

  // Group modifiers by groupName
  const modifierGroups = item.modifiers.reduce<Record<string, Modifier[]>>((acc, m) => {
    acc[m.groupName] = acc[m.groupName] ?? [];
    acc[m.groupName].push(m);
    return acc;
  }, {});

  const toggleModifier = (id: string, maxSelections: number, groupName: string) => {
    const groupModIds = item.modifiers
      .filter((m) => m.groupName === groupName)
      .map((m) => m.id);
    const currentGroupSelected = selectedModifierIds.filter((mid) =>
      groupModIds.includes(mid)
    );

    if (selectedModifierIds.includes(id)) {
      setSelectedModifierIds((prev) => prev.filter((m) => m !== id));
    } else {
      if (currentGroupSelected.length >= maxSelections) {
        // Replace the oldest selection in this group
        const toRemove = currentGroupSelected[0];
        setSelectedModifierIds((prev) =>
          prev.filter((m) => m !== toRemove).concat(id)
        );
      } else {
        setSelectedModifierIds((prev) => [...prev, id]);
      }
    }
  };

  const handleAdd = () => {
    const cartItem: CartItem = {
      menuId,
      restaurantId,
      menuItemId: item.id,
      itemName: item.name,
      priceCents: item.priceCents,
      quantity: qty,
      selectedVariantId: selectedVariantId,
      variantLabel: selectedVariant?.label ?? null,
      variantAddCents,
      selectedModifierIds,
      modifierLabels: selectedModifiers.map((m) => m.label),
      modifierAddCents,
      lineTotalCents: lineTotal,
      specialInstructions,
    };
    onAdd(cartItem);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {item.description && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}
          {item.calories && (
            <p className="text-xs text-muted-foreground">{item.calories} calories</p>
          )}
          {item.allergens && item.allergens.length > 0 && (
            <p className="text-xs text-amber-700">
              ⚠ Contains: {item.allergens.join(", ")}
            </p>
          )}

          {/* Variants */}
          {item.variants.length > 0 && (
            <div>
              <Label className="font-semibold">Size / Option</Label>
              <RadioGroup
                value={selectedVariantId ?? ""}
                onValueChange={setSelectedVariantId}
                className="mt-2 space-y-2"
              >
                {item.variants.map((v) => (
                  <div key={v.id} className="flex items-center justify-between bg-muted/50 px-3 py-2 rounded">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={v.id} id={`var-${v.id}`} />
                      <Label htmlFor={`var-${v.id}`} className="font-normal cursor-pointer">
                        {v.label}
                      </Label>
                    </div>
                    {v.additionalCents > 0 && (
                      <span className="text-sm text-muted-foreground">
                        +{formatMoney(v.additionalCents)}
                      </span>
                    )}
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Modifiers */}
          {Object.entries(modifierGroups).map(([groupName, mods]) => {
            const required = mods[0].isRequired;
            const max = mods[0].maxSelections;
            return (
              <div key={groupName}>
                <div className="flex items-center gap-2 mb-2">
                  <Label className="font-semibold">{groupName}</Label>
                  {required ? (
                    <Badge variant="destructive" className="text-xs px-1.5 py-0">Required</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      Optional{max > 1 ? ` (up to ${max})` : ""}
                    </Badge>
                  )}
                </div>
                <div className="space-y-2">
                  {mods.map((m) => (
                    <div key={m.id} className="flex items-center justify-between bg-muted/50 px-3 py-2 rounded">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`mod-${m.id}`}
                          checked={selectedModifierIds.includes(m.id)}
                          onCheckedChange={() => toggleModifier(m.id, max, groupName)}
                        />
                        <Label htmlFor={`mod-${m.id}`} className="font-normal cursor-pointer">
                          {m.label}
                        </Label>
                      </div>
                      {m.additionalCents > 0 && (
                        <span className="text-sm text-muted-foreground">
                          +{formatMoney(m.additionalCents)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Special instructions */}
          <div>
            <Label>Special Instructions</Label>
            <Textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="Any allergies or special requests?"
              rows={2}
            />
          </div>

          {/* Quantity */}
          <div className="flex items-center justify-between">
            <Label>Quantity</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              >
                <Minus className="w-3 h-3" />
              </Button>
              <span className="w-8 text-center font-semibold">{qty}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setQty((q) => q + 1)}
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd}>
            Add to Cart — {formatMoney(lineTotal)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
