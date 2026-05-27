/**
 * Menu Builder — Business dashboard page
 * Allows restaurant/bar/truck owners to create and manage their online menus.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Plus,
  Pencil,
  Trash2,
  Upload,
  ChevronRight,
  Loader2,
  UtensilsCrossed,
  DollarSign,
  Package,
  Eye,
  EyeOff,
  Settings,
} from "lucide-react";
import { Link } from "wouter";

const formatMoney = (cents: number) =>
  `$${(Number(cents || 0) / 100).toFixed(2)}`;

// ─────────────────────────────────── types ────────────────────────────────────
interface Menu {
  id: string;
  name: string;
  serviceType: string;
  isActive: boolean;
  acceptsCash: boolean;
  hidePlatformFee: boolean;
  availableFrom: string | null;
  availableTo: string | null;
}

interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface MenuItemVariant {
  id?: string;
  label: string;
  additionalCents: number;
  isDefault: boolean;
}

interface MenuItemModifier {
  id?: string;
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
  itemType: "food" | "merchandise";
  imageUrl: string | null;
  isAvailable: boolean;
  trackInventory: boolean;
  inventoryQty: number | null;
  dietaryTags: string[] | null;
  allergens: string[] | null;
  calories: number | null;
  variants: MenuItemVariant[];
  modifiers: MenuItemModifier[];
  categoryId: string;
}

interface FullMenu extends Menu {
  categories: Array<MenuCategory & { items: MenuItem[] }>;
}

interface OrderingReadiness {
  orderingEnabled: boolean;
  blockingReasons: string[];
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    blocking: boolean;
    action: string;
  }>;
  payout?: {
    connected: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    status: string;
    message: string;
  };
}

// ──────────────────────────────── helpers ─────────────────────────────────────
function useRestaurantId(): string | null {
  const { user } = useAuth();
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const queryRestaurantId = String(params.get("restaurantId") || "").trim();
    if (queryRestaurantId) return queryRestaurantId;
  }
  return (user as any)?.restaurantId ?? null;
}

const MENU_IMPORT_DRAFT_KEY = "mealscout:menu-import-draft";

function getInitialMenuSourceUrl() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const querySource = String(params.get("menuSource") || "").trim();
  if (querySource) return querySource;
  try {
    const stored = window.localStorage.getItem(MENU_IMPORT_DRAFT_KEY);
    if (!stored) return "";
    const parsed = JSON.parse(stored) as { sourceUrl?: string };
    return String(parsed.sourceUrl || "").trim();
  } catch {
    return "";
  }
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeMenusPayload(payload: unknown): Menu[] {
  if (Array.isArray(payload)) return payload as Menu[];
  if (payload && typeof payload === "object") {
    const wrapped = payload as Record<string, unknown>;
    if (Array.isArray(wrapped.menus)) return wrapped.menus as Menu[];
    if (Array.isArray(wrapped.items)) return wrapped.items as Menu[];
    if (Array.isArray(wrapped.data)) return wrapped.data as Menu[];
  }
  return [];
}

function normalizeFullMenu(menu: unknown): FullMenu | null {
  if (!menu || typeof menu !== "object") return null;
  const candidate = menu as Record<string, unknown>;
  const categoriesRaw = toArray<Record<string, unknown>>(candidate.categories);
  const categories = categoriesRaw.map((category) => ({
    ...((category as unknown) as MenuCategory),
    items: toArray<MenuItem>(category.items),
  }));
  return {
    ...((candidate as unknown) as FullMenu),
    categories,
  };
}

function normalizeFullMenusPayload(payload: unknown): FullMenu[] {
  if (Array.isArray(payload)) {
    return payload.map(normalizeFullMenu).filter((menu): menu is FullMenu => !!menu);
  }
  if (payload && typeof payload === "object") {
    const wrapped = payload as Record<string, unknown>;
    if (Array.isArray(wrapped.menus)) {
      return wrapped.menus
        .map(normalizeFullMenu)
        .filter((menu): menu is FullMenu => !!menu);
    }
  }
  const single = normalizeFullMenu(payload);
  return single ? [single] : [];
}

// ──────────────────────────────── main page ───────────────────────────────────
export default function MenuBuilderPage() {
  const restaurantId = useRestaurantId();
  const { toast } = useToast();
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [showNewMenuDialog, setShowNewMenuDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuServiceType, setNewMenuServiceType] = useState("all_day");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<"csv" | "pdf" | "pos_json">("csv");
  const [isImporting, setIsImporting] = useState(false);
  const [menuSourceUrl, setMenuSourceUrl] = useState(getInitialMenuSourceUrl);
  const [posSource, setPosSource] = useState("toast");
  const [posNotes, setPosNotes] = useState("");
  const [externalJson, setExternalJson] = useState("");
  const [isRequestingPosSync, setIsRequestingPosSync] = useState(false);

  useEffect(() => {
    if (!menuSourceUrl.trim()) return;
    try {
      window.localStorage.setItem(
        MENU_IMPORT_DRAFT_KEY,
        JSON.stringify({
          sourceUrl: menuSourceUrl.trim(),
          restaurantId,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Draft persistence is only a convenience.
    }
  }, [menuSourceUrl, restaurantId]);

  // fetch menus list
  const menusQuery = useQuery<Menu[]>({
    queryKey: ["/api/owner/menus", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const res = await fetch(
        `/api/owner/menus/${encodeURIComponent(restaurantId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load menus");
      const data = await res.json();
      return normalizeMenusPayload(data);
    },
    enabled: !!restaurantId,
  });

  // fetch full menu with categories + items
  const fullMenuQuery = useQuery<FullMenu | null>({
    queryKey: ["/api/menus", selectedMenuId],
    queryFn: async () => {
      if (!selectedMenuId || !restaurantId) throw new Error("No menu selected");
      const res = await fetch(
        `/api/menus/${encodeURIComponent(restaurantId)}?menuId=${encodeURIComponent(selectedMenuId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load menu");
      const data = await res.json();
      const menus = normalizeFullMenusPayload(data);
      if (!menus.length) return null;
      return menus.find((m) => m.id === selectedMenuId) ?? menus[0] ?? null;
    },
    enabled: !!selectedMenuId && !!restaurantId,
  });

  // create menu
  const createMenuMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/owner/menus", {
        restaurantId,
        name: newMenuName,
        serviceType: newMenuServiceType,
      });
      return res.json();
    },
    onSuccess: (menu) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/menus", restaurantId],
      });
      setSelectedMenuId(menu.id);
      setShowNewMenuDialog(false);
      setNewMenuName("");
      toast({ title: "Menu created!" });
    },
    onError: (err: Error) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  // import menu items
  const handleImport = async () => {
    if (!selectedMenuId) return;
    setIsImporting(true);
    try {
      if (importType === "pos_json") {
        const rawData = JSON.parse(externalJson.trim());
        const rows = Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.items)
            ? rawData.items
            : Array.isArray(rawData?.menuItems)
              ? rawData.menuItems
              : [];
        if (!rows.length) {
          throw new Error("Paste a JSON array, or an object with items/menuItems.");
        }
        const res = await fetch(
          `/api/owner/menus/${encodeURIComponent(selectedMenuId)}/import/external`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: posSource, rawData: rows }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Import failed");
        queryClient.invalidateQueries({
          queryKey: ["/api/menus", selectedMenuId],
        });
        setShowImportDialog(false);
        setExternalJson("");
        toast({
          title: "Import complete",
          description: `${data.imported ?? 0} items imported from ${posSource}.`,
        });
        return;
      }

      if (!importFile) return;
      const form = new FormData();
      form.append("file", importFile);
      const res = await fetch(
        `/api/owner/menus/${encodeURIComponent(selectedMenuId)}/import/${importType}`,
        { method: "POST", body: form, credentials: "include" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Import failed");
      queryClient.invalidateQueries({
        queryKey: ["/api/menus", selectedMenuId],
      });
      setShowImportDialog(false);
      setImportFile(null);
      toast({
        title: "Import complete",
        description: `${data.imported ?? data.inserted ?? 0} items imported.`,
      });
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const requestPosConnection = async () => {
    if (!selectedMenuId) {
      setShowNewMenuDialog(true);
      return;
    }

    setIsRequestingPosSync(true);
    try {
      const res = await fetch(
        `/api/owner/menus/${encodeURIComponent(selectedMenuId)}/pos-connection-request`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: posSource,
            sourceUrl: menuSourceUrl.trim() || undefined,
            notes: posNotes.trim() || undefined,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Unable to save POS request");
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/menus", restaurantId],
      });
      toast({
        title: "POS source saved",
        description:
          "We saved this as a pending connection. You can still import CSV/PDF or build manually while sync is connected.",
      });
    } catch (err: any) {
      toast({
        title: "POS request failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsRequestingPosSync(false);
    }
  };

  if (!restaurantId) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">
            No restaurant linked to your account.
          </p>
        </div>
      </div>
    );
  }

  const menus = toArray<Menu>(menusQuery.data);
  const selectedMenu = normalizeFullMenu(fullMenuQuery.data);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="w-6 h-6" />
              Menu Builder
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Create and manage your online menus for pickup &amp; dine-in
              ordering.
            </p>
          </div>
          <div className="flex gap-2">
            {selectedMenuId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImportDialog(true)}
              >
                <Upload className="w-4 h-4 mr-2" />
                Import Items
              </Button>
            )}
            <Button size="sm" onClick={() => setShowNewMenuDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Menu
            </Button>
          </div>
        </div>

        <Card className="mb-6 border-amber-300/30 bg-amber-50/70 dark:bg-amber-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Menu setup</CardTitle>
            <CardDescription>
              Import what you already have, then review it before publishing to Scout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="menu-source-url">Website, PDF, or online menu source</Label>
              <Input
                id="menu-source-url"
                value={menuSourceUrl}
                onChange={(event) => setMenuSourceUrl(event.target.value)}
                placeholder="Paste your website, menu PDF, or existing online menu URL"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                MealScout keeps this source with your setup so you can use it while importing or rebuilding the menu.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (!selectedMenuId) {
                    setShowNewMenuDialog(true);
                    return;
                  }
                  setShowImportDialog(true);
                }}
              >
                <Upload className="mr-2 h-4 w-4" />
                {selectedMenuId ? "Upload CSV/PDF import" : "Create menu to import"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowNewMenuDialog(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Build manually
              </Button>
              {restaurantId ? (
                <Link href={`/menu/${restaurantId}`} target="_blank">
                  <Button type="button" variant="outline">
                    <Eye className="mr-2 h-4 w-4" />
                    Public preview
                  </Button>
                </Link>
              ) : null}
              <Link href="/restaurant-owner-dashboard?src=menu-builder&setup=schedule">
                <Button type="button" variant="outline">
                  Schedule and hours
                </Button>
              </Link>
            </div>
            <div className="rounded-xl border bg-background/70 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="md:w-48">
                  <Label>Existing POS/menu system</Label>
                  <Select value={posSource} onValueChange={setPosSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toast">Toast</SelectItem>
                      <SelectItem value="square">Square</SelectItem>
                      <SelectItem value="clover">Clover</SelectItem>
                      <SelectItem value="website">Website menu</SelectItem>
                      <SelectItem value="ubereats">Uber Eats</SelectItem>
                      <SelectItem value="doordash">DoorDash</SelectItem>
                      <SelectItem value="gmb">Google Business Profile</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label>Connection notes</Label>
                  <Input
                    value={posNotes}
                    onChange={(event) => setPosNotes(event.target.value)}
                    placeholder="Example: Toast location name, Square merchant nickname, or login owner to contact"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={requestPosConnection}
                  disabled={isRequestingPosSync}
                >
                  {isRequestingPosSync && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save POS source
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Direct sync starts as a connection request. For now, exports from Toast, Square, Clover, DoorDash, Uber Eats, or Google can be imported as CSV/PDF/JSON while we wire deeper API access.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left sidebar: menu list */}
          <div className="lg:col-span-1 space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Your Menus
            </h2>
            {menusQuery.isLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {menus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => setSelectedMenuId(menu.id)}
                className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                  selectedMenuId === menu.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card hover:bg-muted border-border"
                }`}
              >
                <div className="font-medium truncate">{menu.name}</div>
                <div className="text-xs opacity-70 capitalize">
                  {menu.serviceType.replace("_", " ")}
                </div>
                {!menu.isActive && (
                  <Badge variant="secondary" className="text-xs mt-1">
                    Inactive
                  </Badge>
                )}
              </button>
            ))}
            {menus.length === 0 && !menusQuery.isLoading && (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm font-medium">No menus yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create your first menu, then import or add items.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowNewMenuDialog(true)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Create menu
                </Button>
              </div>
            )}
          </div>

          {/* Right: menu editor */}
          <div className="lg:col-span-3">
            {!selectedMenuId ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64 text-center">
                  <UtensilsCrossed className="w-10 h-10 text-muted-foreground mb-3" />
                  <h3 className="font-medium mb-1">Select or create a menu</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose a menu from the left, create a new one, or keep the source URL above while you rebuild.
                  </p>
                  <Button
                    type="button"
                    className="mt-4"
                    onClick={() => setShowNewMenuDialog(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create first menu
                  </Button>
                </CardContent>
              </Card>
            ) : fullMenuQuery.isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : selectedMenu ? (
              <MenuEditor
                menu={selectedMenu}
                restaurantId={restaurantId}
                onRefresh={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["/api/menus", selectedMenuId],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/owner/menus", restaurantId],
                  });
                }}
              />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center h-64 text-center">
                  <UtensilsCrossed className="w-10 h-10 text-muted-foreground mb-3" />
                  <h3 className="font-medium mb-1">Menu data unavailable</h3>
                  <p className="text-sm text-muted-foreground">
                    We could not load menu items in the expected format. Try refreshing or re-importing your menu data.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* New menu dialog */}
      <Dialog open={showNewMenuDialog} onOpenChange={setShowNewMenuDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Menu</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="menu-name">Menu Name</Label>
              <Input
                id="menu-name"
                placeholder="e.g. Lunch Menu, Happy Hour, Full Menu"
                value={newMenuName}
                onChange={(e) => setNewMenuName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="service-type">Service Type</Label>
              <Select
                value={newMenuServiceType}
                onValueChange={setNewMenuServiceType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_day">All Day</SelectItem>
                  <SelectItem value="breakfast">Breakfast</SelectItem>
                  <SelectItem value="lunch">Lunch</SelectItem>
                  <SelectItem value="dinner">Dinner</SelectItem>
                  <SelectItem value="late_night">Late Night</SelectItem>
                  <SelectItem value="brunch">Brunch</SelectItem>
                  <SelectItem value="happy_hour">Happy Hour</SelectItem>
                  <SelectItem value="seasonal">Seasonal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewMenuDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMenuMutation.mutate()}
              disabled={!newMenuName.trim() || createMenuMutation.isPending}
            >
              {createMenuMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Create Menu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Menu Items</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {menuSourceUrl.trim() ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-medium">Source saved from onboarding</div>
                <a
                  href={menuSourceUrl.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-primary underline"
                >
                  {menuSourceUrl.trim()}
                </a>
              </div>
            ) : null}
            <div>
              <Label>Import Format</Label>
              <div className="flex gap-2 mt-2">
                {(["csv", "pdf", "pos_json"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={importType === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setImportType(t)}
                  >
                    {t === "pos_json" ? "POS JSON" : t.toUpperCase()}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {importType === "csv"
                  ? "CSV with columns: Name, Description, Price, Category, Calories, etc."
                  : importType === "pdf"
                    ? "Upload a PDF menu — AI will extract items automatically."
                    : "Paste exported item JSON from Toast, Square, Clover, DoorDash, Uber Eats, or Google."}
              </p>
            </div>
            {importType === "pos_json" ? (
              <div className="space-y-3">
                <div>
                  <Label>Source</Label>
                  <Select value={posSource} onValueChange={setPosSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="toast">Toast</SelectItem>
                      <SelectItem value="square">Square</SelectItem>
                      <SelectItem value="clover">Clover</SelectItem>
                      <SelectItem value="ubereats">Uber Eats</SelectItem>
                      <SelectItem value="doordash">DoorDash</SelectItem>
                      <SelectItem value="gmb">Google Business Profile</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="external-json">Exported JSON</Label>
                  <Textarea
                    id="external-json"
                    value={externalJson}
                    onChange={(event) => setExternalJson(event.target.value)}
                    placeholder='[{"name":"Smash Burger","description":"...","price":"12.99"}]'
                    rows={8}
                  />
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="import-file">File</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept={importType === "csv" ? ".csv,.tsv,.xlsx,.xls" : ".pdf"}
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowImportDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={
                isImporting ||
                (importType === "pos_json" ? !externalJson.trim() : !importFile)
              }
            >
              {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────── MenuEditor ───────────────────────────────────
function MenuEditor({
  menu,
  restaurantId,
  onRefresh,
}: {
  menu: FullMenu;
  restaurantId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(
    null,
  );
  const [categoryName, setCategoryName] = useState("");
  const [categoryDesc, setCategoryDesc] = useState("");
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [menuSettings, setMenuSettings] = useState({
    acceptsCash: menu.acceptsCash,
    hidePlatformFee: menu.hidePlatformFee,
    isActive: menu.isActive,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const readinessQuery = useQuery<OrderingReadiness>({
    queryKey: ["/api/owner/restaurants", restaurantId, "ordering-readiness"],
    queryFn: async () => {
      const res = await fetch(
        `/api/owner/restaurants/${encodeURIComponent(restaurantId)}/ordering-readiness`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load ordering readiness");
      }
      return data;
    },
    enabled: !!restaurantId,
  });
  const readiness = readinessQuery.data;

  const saveCategory = async () => {
    try {
      if (editingCategory) {
        await apiRequest(
          "PATCH",
          `/api/owner/menu-categories/${editingCategory.id}`,
          {
            name: categoryName,
            description: categoryDesc || null,
          },
        );
      } else {
        await apiRequest("POST", "/api/owner/menu-categories", {
          menuId: menu.id,
          restaurantId,
          name: categoryName,
          description: categoryDesc || null,
        });
      }
      onRefresh();
      setShowCategoryDialog(false);
      setCategoryName("");
      setCategoryDesc("");
      setEditingCategory(null);
      toast({ title: editingCategory ? "Category updated" : "Category added" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category and all its items?")) return;
    try {
      await apiRequest("DELETE", `/api/owner/menu-categories/${id}`, undefined);
      onRefresh();
      toast({ title: "Category deleted" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const saveMenuSettings = async () => {
    setSavingSettings(true);
    try {
      await apiRequest("PATCH", `/api/owner/menus/${menu.id}`, menuSettings);
      onRefresh();
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/restaurants", restaurantId, "ordering-readiness"],
      });
      toast({ title: "Settings saved" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-4">
      {readiness && (
        <Card className="border-orange-200 bg-orange-50/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Online ordering readiness</CardTitle>
                <CardDescription>
                  {readiness.orderingEnabled
                    ? "Customers can place orders from this menu."
                    : "Finish these items before customers can order online."}
                </CardDescription>
              </div>
              <Badge variant={readiness.orderingEnabled ? "default" : "secondary"}>
                {readiness.orderingEnabled ? "Ready" : "Needs attention"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {readiness.checks.map((check) => (
                <div
                  key={check.id}
                  className="rounded-lg border bg-background/80 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{check.label}</span>
                    <Badge variant={check.ok ? "default" : check.blocking ? "destructive" : "secondary"}>
                      {check.ok ? "OK" : check.blocking ? "Blocked" : "Warning"}
                    </Badge>
                  </div>
                  {!check.ok && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {check.action}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {readiness.payout?.message && (
              <div className="rounded-lg border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Payouts: </span>
                {readiness.payout.message}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Menu header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{menu.name}</CardTitle>
              <CardDescription className="capitalize">
                {menu.serviceType.replace(/_/g, " ")}
              </CardDescription>
            </div>
            <Link href={`/menu/${restaurantId}`} target="_blank">
              <Button variant="outline" size="sm">
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="categories">
            <TabsList>
              <TabsTrigger value="categories">
                Categories &amp; Items
              </TabsTrigger>
              <TabsTrigger value="settings">Menu Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="pt-4 space-y-2">
              <div className="flex justify-end mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingCategory(null);
                    setCategoryName("");
                    setCategoryDesc("");
                    setShowCategoryDialog(true);
                  }}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Category
                </Button>
              </div>

              {menu.categories.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No categories yet. Add a category to start adding items.
                </p>
              )}

              <Accordion type="multiple" className="space-y-2">
                {menu.categories.map((cat) => (
                  <AccordionItem
                    key={cat.id}
                    value={cat.id}
                    className="border rounded-lg"
                  >
                    <div className="flex items-center px-4">
                      <AccordionTrigger className="flex-1 text-left font-medium py-3">
                        {cat.name}
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {cat.items.length}
                        </Badge>
                      </AccordionTrigger>
                      <div className="flex gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategory(cat);
                            setCategoryName(cat.name);
                            setCategoryDesc(cat.description ?? "");
                            setShowCategoryDialog(true);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCategory(cat.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <AccordionContent className="px-4 pb-4">
                      <div className="space-y-2 mb-3">
                        {cat.items.map((item) => (
                          <MenuItemRow
                            key={item.id}
                            item={item}
                            onEdit={() => {
                              setEditingItem(item);
                              setActiveCategoryId(cat.id);
                              setShowItemDialog(true);
                            }}
                            onRefresh={onRefresh}
                          />
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setEditingItem(null);
                          setActiveCategoryId(cat.id);
                          setShowItemDialog(true);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Item
                      </Button>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </TabsContent>

            <TabsContent value="settings" className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Menu Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Customers can order from this menu
                  </p>
                </div>
                <Switch
                  checked={menuSettings.isActive}
                  onCheckedChange={(v) =>
                    setMenuSettings((s) => ({ ...s, isActive: v }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Accept Cash Payments</Label>
                  <p className="text-xs text-muted-foreground">
                    Allow cash for pickup orders
                  </p>
                </div>
                <Switch
                  checked={menuSettings.acceptsCash}
                  onCheckedChange={(v) =>
                    setMenuSettings((s) => ({ ...s, acceptsCash: v }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Absorb customer fees</Label>
                  <p className="text-xs text-muted-foreground">
                    Hide processing plus the $1 MealScout fee from customers (you cover it)
                  </p>
                </div>
                <Switch
                  checked={menuSettings.hidePlatformFee}
                  onCheckedChange={(v) =>
                    setMenuSettings((s) => ({ ...s, hidePlatformFee: v }))
                  }
                />
              </div>
              <Button onClick={saveMenuSettings} disabled={savingSettings}>
                {savingSettings && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Save Settings
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Category dialog */}
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Edit Category" : "Add Category"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name</Label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Appetizers, Burgers, Drinks"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={categoryDesc}
                onChange={(e) => setCategoryDesc(e.target.value)}
                placeholder="Brief description shown to customers"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCategoryDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={saveCategory} disabled={!categoryName.trim()}>
              {editingCategory ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item dialog */}
      {showItemDialog && (
        <MenuItemDialog
          item={editingItem}
          menuId={menu.id}
          categoryId={activeCategoryId!}
          restaurantId={restaurantId}
          onClose={() => {
            setShowItemDialog(false);
            setEditingItem(null);
          }}
          onSaved={() => {
            onRefresh();
            setShowItemDialog(false);
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────── MenuItemRow ────────────────────────────────────
function MenuItemRow({
  item,
  onEdit,
  onRefresh,
}: {
  item: MenuItem;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const toggleAvailable = async () => {
    try {
      await apiRequest("PATCH", `/api/owner/menu-items/${item.id}`, {
        isAvailable: !item.isAvailable,
      });
      onRefresh();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const deleteItem = async () => {
    if (!confirm(`Delete "${item.name}"?`)) return;
    try {
      await apiRequest("DELETE", `/api/owner/menu-items/${item.id}`, undefined);
      onRefresh();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 border">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{item.name}</span>
          {item.itemType === "merchandise" && (
            <Badge variant="outline" className="text-xs gap-1">
              <Package className="w-3 h-3" />
              Merch
            </Badge>
          )}
          {!item.isAvailable && (
            <Badge variant="secondary" className="text-xs">
              86'd
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
          <span>{formatMoney(item.priceCents)}</span>
          {item.itemType !== "merchandise" && item.calories && (
            <span>· {item.calories} cal</span>
          )}
          {item.trackInventory && item.inventoryQty !== null && (
            <span>· {item.inventoryQty} left</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={toggleAvailable}
        >
          {item.isAvailable ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onEdit}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={deleteItem}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────── MenuItemDialog ──────────────────────────────────
function MenuItemDialog({
  item,
  menuId,
  categoryId,
  restaurantId,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  menuId: string;
  categoryId: string;
  restaurantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    priceCents: item ? String(item.priceCents / 100) : "",
    itemType: item?.itemType ?? "food",
    calories: item?.calories ? String(item.calories) : "",
    isAvailable: item?.isAvailable ?? true,
    trackInventory: item?.trackInventory ?? false,
    inventoryQty: item?.inventoryQty ? String(item.inventoryQty) : "",
    dietaryTags: (item?.dietaryTags ?? []).join(", "),
    allergens: (item?.allergens ?? []).join(", "),
  });

  const save = async () => {
    if (!form.name.trim() || !form.priceCents) return;
    setIsSaving(true);
    try {
      const payload = {
        menuId,
        categoryId,
        restaurantId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        priceCents: Math.round(parseFloat(form.priceCents) * 100),
        itemType: form.itemType,
        calories:
          form.itemType === "merchandise"
            ? null
            : form.calories
              ? parseInt(form.calories)
              : null,
        isAvailable: form.isAvailable,
        trackInventory: form.trackInventory,
        inventoryQty:
          form.trackInventory && form.inventoryQty
            ? parseInt(form.inventoryQty)
            : null,
        dietaryTags: form.itemType === "merchandise"
          ? []
          : form.dietaryTags
          ? form.dietaryTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        allergens: form.itemType === "merchandise"
          ? []
          : form.allergens
          ? form.allergens
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
          : [],
      };

      if (item) {
        await apiRequest("PATCH", `/api/owner/menu-items/${item.id}`, payload);
      } else {
        await apiRequest("POST", "/api/owner/menu-items", payload);
      }
      onSaved();
      toast({ title: item ? "Item updated" : "Item added" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Item" : "Add Menu Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. Classic Burger"
              />
            </div>
            <div>
              <Label>Price *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={form.priceCents}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priceCents: e.target.value }))
                  }
                  placeholder="0.00"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div>
              <Label>Item type</Label>
              <Select
                value={form.itemType}
                onValueChange={(value) =>
                  setForm((f) => ({
                    ...f,
                    itemType: value as "food" | "merchandise",
                    calories: value === "merchandise" ? "" : f.calories,
                    dietaryTags: value === "merchandise" ? "" : f.dietaryTags,
                    allergens: value === "merchandise" ? "" : f.allergens,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="food">Food / drink</SelectItem>
                  <SelectItem value="merchandise">Merchandise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Brief appetizing description"
                rows={2}
              />
            </div>
            {form.itemType !== "merchandise" && (
              <>
                <div>
                  <Label>Calories</Label>
                  <Input
                    value={form.calories}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, calories: e.target.value }))
                    }
                    placeholder="e.g. 650"
                    type="number"
                    min="0"
                  />
                </div>
                <div className="col-span-2">
                  <Label>
                    Dietary Tags{" "}
                    <span className="text-xs text-muted-foreground">
                      (comma separated)
                    </span>
                  </Label>
                  <Input
                    value={form.dietaryTags}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dietaryTags: e.target.value }))
                    }
                    placeholder="vegan, gluten-free, keto"
                  />
                </div>
                <div className="col-span-2">
                  <Label>
                    Allergens{" "}
                    <span className="text-xs text-muted-foreground">
                      (comma separated)
                    </span>
                  </Label>
                  <Input
                    value={form.allergens}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, allergens: e.target.value }))
                    }
                    placeholder="nuts, dairy, gluten"
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label>Available</Label>
              <Switch
                checked={form.isAvailable}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, isAvailable: v }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Track Inventory</Label>
              <Switch
                checked={form.trackInventory}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, trackInventory: v }))
                }
              />
            </div>
            {form.trackInventory && (
              <div>
                <Label>In Stock Quantity</Label>
                <Input
                  value={form.inventoryQty}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, inventoryQty: e.target.value }))
                  }
                  type="number"
                  min="0"
                  placeholder="e.g. 20"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={isSaving || !form.name.trim() || !form.priceCents}
          >
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {item ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
