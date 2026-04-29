/**
 * Menu Builder — Business dashboard page
 * Allows restaurant/bar/truck owners to create and manage their online menus.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronUp,
  ChevronDown,
  Loader2,
  UtensilsCrossed,
  DollarSign,
  Eye,
  EyeOff,
  Settings,
  RefreshCw,
  Clock,
  GripVertical,
  Image as ImageIcon,
} from "lucide-react";
import { Link, useParams } from "wouter";

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
  importSource?: string | null;
  importedAt?: string | null;
  importUrl?: string | null;
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
  uncategorizedItems?: MenuItem[];
}

const MENU_SERVICE_TYPE_OPTIONS = [
  { value: "all", label: "All Day" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "late_night", label: "Late Night" },
  { value: "weekend_brunch", label: "Weekend Brunch" },
] as const;

const MENU_SERVICE_TYPE_LABELS = MENU_SERVICE_TYPE_OPTIONS.reduce(
  (labels, option) => ({ ...labels, [option.value]: option.label }),
  {} as Record<string, string>,
);

function normalizeMenuServiceType(value: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "all";

  const aliases: Record<string, string> = {
    all_day: "all",
    brunch: "weekend_brunch",
    happy_hour: "late_night",
    seasonal: "all",
  };

  const mapped = aliases[normalized] ?? normalized;
  return MENU_SERVICE_TYPE_OPTIONS.some((option) => option.value === mapped)
    ? mapped
    : "all";
}

interface RestaurantOption {
  id: string;
  name: string;
  businessType?: string | null;
  menuUrl?: string | null;
  orderUrl?: string | null;
  websiteUrl?: string | null;
}

type MenuImportResult = {
  imported: number;
  skipped: number;
  source?: string;
  errors: Array<{ row?: number; reason: string }>;
};

// ──────────────────────────────── helpers ─────────────────────────────────────
function useRestaurantId(restaurants: RestaurantOption[]): string | null {
  const { user } = useAuth();
  const params = useParams<{ restaurantId?: string }>();
  const routeRestaurantId = String(params.restaurantId || "").trim();
  if (routeRestaurantId) return routeRestaurantId;

  const role = String((user as any)?.userType || "");
  const isAdminMode = ["admin", "super_admin", "staff"].includes(role);
  if (isAdminMode && typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const override = String(params.get("adminRestaurantId") || "").trim();
      if (override) return override;
  }
  return (user as any)?.restaurantId ?? restaurants[0]?.id ?? null;
}

// ──────────────────────────────── main page ───────────────────────────────────
export default function MenuBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const restaurantsQuery = useQuery<RestaurantOption[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: !!user,
  });
  const restaurantOptions = restaurantsQuery.data ?? [];
  const restaurantId = useRestaurantId(restaurantOptions);
  const activeRestaurant = useMemo(
    () => restaurantOptions.find((restaurant) => restaurant.id === restaurantId),
    [restaurantOptions, restaurantId],
  );
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [showNewMenuDialog, setShowNewMenuDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [newMenuName, setNewMenuName] = useState("");
  const [newMenuServiceType, setNewMenuServiceType] = useState("all");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<"csv" | "pdf" | "image" | "url">(
    "csv",
  );
  const [importUrl, setImportUrl] = useState("");
  const [importSource, setImportSource] = useState("auto");
  const [isImporting, setIsImporting] = useState(false);
  const [lastImportResult, setLastImportResult] =
    useState<MenuImportResult | null>(null);

  const profileImportUrl = useMemo(() => {
    const candidates = [
      activeRestaurant?.menuUrl,
      activeRestaurant?.orderUrl,
      activeRestaurant?.websiteUrl,
    ];
    return candidates.find((value) => String(value || "").trim()) || "";
  }, [activeRestaurant?.menuUrl, activeRestaurant?.orderUrl, activeRestaurant?.websiteUrl]);

  const openImportDialog = (urlOverride?: string | null) => {
    const nextUrl = String(urlOverride || importUrl || profileImportUrl || "").trim();
    if (nextUrl) {
      setImportType("url");
      setImportUrl(nextUrl);
    }
    setShowImportDialog(true);
  };

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
      const payload = await res.json();
      return Array.isArray(payload) ? payload : payload?.menus ?? [];
    },
    enabled: !!restaurantId,
  });

  // fetch full menu with categories + items
  const fullMenuQuery = useQuery<FullMenu>({
    queryKey: ["/api/owner/menus/full", restaurantId, selectedMenuId],
    queryFn: async () => {
      if (!selectedMenuId || !restaurantId) throw new Error("No menu selected");
      const res = await fetch(
        `/api/owner/menus/${encodeURIComponent(restaurantId)}/full?menuId=${encodeURIComponent(selectedMenuId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load menu");
      const data = await res.json();
      const menus: FullMenu[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.menus)
          ? data.menus
          : [data].filter(Boolean);
      return menus.find((m) => m.id === selectedMenuId) ?? menus[0];
    },
    enabled: !!selectedMenuId && !!restaurantId,
  });

  useEffect(() => {
    if (!restaurantId) {
      setSelectedMenuId(null);
      return;
    }
    const menus = menusQuery.data ?? [];
    if (menus.length === 0) {
      setSelectedMenuId(null);
      return;
    }
    if (!selectedMenuId || !menus.some((menu) => menu.id === selectedMenuId)) {
      setSelectedMenuId(menus[0].id);
    }
  }, [menusQuery.data, restaurantId, selectedMenuId]);

  // create menu
  const createMenuMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/owner/menus", {
        restaurantId,
        name: newMenuName,
        serviceType: normalizeMenuServiceType(newMenuServiceType),
      });
      return res.json();
    },
    onSuccess: (payload) => {
      const menu = payload?.menu ?? payload;
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/menus", restaurantId],
      });
      queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
      if (menu?.id) setSelectedMenuId(menu.id);
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
      let res: Response;
      if (importType === "url") {
        const cleanedUrl = importUrl.trim();
        if (!cleanedUrl) throw new Error("Paste a menu URL to import.");
        res = await fetch(
          `/api/owner/menus/${encodeURIComponent(selectedMenuId)}/import/url`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: cleanedUrl,
              source: importSource === "auto" ? undefined : importSource,
            }),
          },
        );
      } else {
        if (!importFile) throw new Error("Choose a file to import.");
        const form = new FormData();
        form.append("file", importFile);
        // Image imports use the same PDF AI parser endpoint
        const importEndpoint = importType === "image" ? "pdf" : importType;
        res = await fetch(
          `/api/owner/menus/${encodeURIComponent(selectedMenuId)}/import/${importEndpoint}`,
          { method: "POST", body: form, credentials: "include" },
        );
      }

      const raw = await res.text();
      const data = raw
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return { message: raw };
            }
          })()
        : {};
      if (!res.ok) throw new Error(data.message || "Import failed");
      setLastImportResult({
        imported: Number(data.imported ?? data.inserted ?? 0),
        skipped: Number(data.skipped ?? 0),
        source: data.source,
        errors: Array.isArray(data.errors) ? data.errors : [],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/menus/full", restaurantId, selectedMenuId],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/menus", restaurantId],
      });
      queryClient.invalidateQueries({ queryKey: ["owner-onboarding"] });
      setShowImportDialog(false);
      setImportFile(null);
      setImportUrl("");
      setImportSource("auto");
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

  if (restaurantsQuery.isLoading) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!restaurantId) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-muted-foreground">
              No business profile is linked to your account yet.
            </p>
            <Link href="/restaurant-signup">
              <Button className="mt-4">Create Business Profile</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const menus = menusQuery.data ?? [];
  const selectedMenu = fullMenuQuery.data ?? null;

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
              Create and manage menus for {activeRestaurant?.name || "your business"}.
            </p>
          </div>
          <div className="flex gap-2">
            {selectedMenuId && selectedMenu?.importUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportSource(
                    selectedMenu.importSource &&
                      selectedMenu.importSource !== "url"
                      ? selectedMenu.importSource
                      : "auto",
                  );
                  openImportDialog(selectedMenu.importUrl);
                }}
                title={`Re-import from ${selectedMenu.importUrl}`}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-import
              </Button>
            )}
            {selectedMenuId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openImportDialog()}
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

        {selectedMenu?.importedAt && (
          <div className="mb-4 px-3 py-2 rounded-md bg-muted/50 border text-xs text-muted-foreground flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            <span>
              Last imported{" "}
              <strong>
                {new Date(selectedMenu.importedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </strong>
              {selectedMenu.importSource && (
                <>
                  {" "}via <strong>{selectedMenu.importSource}</strong>
                </>
              )}
              {selectedMenu.importUrl && (
                <>
                  {" "}—{" "}
                  <a
                    href={selectedMenu.importUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground break-all"
                  >
                    {selectedMenu.importUrl}
                  </a>
                </>
              )}
            </span>
          </div>
        )}

        {lastImportResult && (
          <div className="mb-4 rounded-md border bg-card px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">
                  Imported {lastImportResult.imported} item
                  {lastImportResult.imported === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">
                  {" "}• skipped {lastImportResult.skipped}
                  {lastImportResult.source ? ` • source ${lastImportResult.source}` : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLastImportResult(null)}
              >
                Dismiss
              </Button>
            </div>
            {lastImportResult.errors.length > 0 && (
              <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                <div className="font-medium">
                  {lastImportResult.errors.length} import issue
                  {lastImportResult.errors.length === 1 ? "" : "s"}
                </div>
                <ul className="mt-1 space-y-1">
                  {lastImportResult.errors.slice(0, 5).map((error, index) => (
                    <li key={`${error.row ?? index}-${error.reason}`}>
                      {error.row != null ? `Row ${error.row}: ` : ""}
                      {error.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

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
                  {MENU_SERVICE_TYPE_LABELS[menu.serviceType] ??
                    menu.serviceType.replace("_", " ")}
                </div>
                {!menu.isActive && (
                  <Badge variant="secondary" className="text-xs mt-1">
                    Inactive
                  </Badge>
                )}
              </button>
            ))}
            {menus.length === 0 && !menusQuery.isLoading && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No menus yet. Create one to get started.
              </p>
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
                    Choose a menu from the left, or create a new one.
                  </p>
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
                    queryKey: [
                      "/api/owner/menus/full",
                      restaurantId,
                      selectedMenuId,
                    ],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/owner/menus", restaurantId],
                  });
                  queryClient.invalidateQueries({
                    queryKey: ["owner-onboarding"],
                  });
                }}
              />
            ) : null}
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
                  {MENU_SERVICE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
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
            <div>
              <Label>Import Format</Label>
              <div className="flex gap-2 mt-2">
                {(["url", "csv", "pdf", "image"] as const).map((t) => (
                  <Button
                    key={t}
                    variant={importType === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setImportType(t)}
                  >
                    {t === "url"
                      ? "URL"
                      : t === "image"
                        ? "Photo"
                        : t.toUpperCase()}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {importType === "csv"
                  ? "CSV with columns: Name, Description, Price, Category, Calories, etc."
                    : importType === "pdf"
                      ? "Upload a PDF menu — AI will extract items automatically."
                      : importType === "image"
                        ? "Upload a photo of your menu board or printed menu — AI will read and extract items."
                        : "Paste your website, Google, Yelp, Grubhub, UberEats, or another public menu URL."}
              </p>
            </div>
            {importType === "url" ? (
              <>
                {profileImportUrl && !importUrl.trim() && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <div className="font-medium">Use saved profile link</div>
                    <div className="mt-1 break-all text-xs text-muted-foreground">
                      {profileImportUrl}
                    </div>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => setImportUrl(profileImportUrl)}
                    >
                      Use this link
                    </Button>
                  </div>
                )}
                <div>
                  <Label htmlFor="import-url">Menu URL</Label>
                  <Input
                    id="import-url"
                    type="url"
                    placeholder="https://your-menu-link.example"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="import-source">Source</Label>
                  <Select value={importSource} onValueChange={setImportSource}>
                    <SelectTrigger id="import-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto detect</SelectItem>
                      <SelectItem value="ubereats">UberEats</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="grubhub">Grubhub</SelectItem>
                      <SelectItem value="yelp">Yelp</SelectItem>
                      <SelectItem value="website">Other Website</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="import-file">File</Label>
                <Input
                  id="import-file"
                  type="file"
                  accept={importType === "csv" ? ".csv,.tsv,.xlsx,.xls" : importType === "image" ? "image/*" : ".pdf"}
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
                (importType === "url"
                  ? !importUrl.trim()
                  : !importFile)
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
    name: menu.name,
    serviceType: normalizeMenuServiceType(menu.serviceType),
    availableFrom: menu.availableFrom ?? "",
    availableTo: menu.availableTo ?? "",
    acceptsCash: menu.acceptsCash,
    hidePlatformFee: menu.hidePlatformFee,
    isActive: menu.isActive,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setMenuSettings({
      name: menu.name,
      serviceType: normalizeMenuServiceType(menu.serviceType),
      availableFrom: menu.availableFrom ?? "",
      availableTo: menu.availableTo ?? "",
      acceptsCash: menu.acceptsCash,
      hidePlatformFee: menu.hidePlatformFee,
      isActive: menu.isActive,
    });
  }, [
    menu.id,
    menu.name,
    menu.serviceType,
    menu.availableFrom,
    menu.availableTo,
    menu.acceptsCash,
    menu.hidePlatformFee,
    menu.isActive,
  ]);

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

  const createStarterCategory = async () => {
    try {
      await apiRequest("POST", "/api/owner/menu-categories", {
        menuId: menu.id,
        restaurantId,
        name: "Menu Items",
        description: null,
      });
      onRefresh();
      toast({ title: "Starter category added" });
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
      await apiRequest("PATCH", `/api/owner/menus/${menu.id}`, {
        ...menuSettings,
        name: menuSettings.name.trim() || "Menu",
        serviceType: normalizeMenuServiceType(menuSettings.serviceType),
        availableFrom: menuSettings.availableFrom || null,
        availableTo: menuSettings.availableTo || null,
      });
      onRefresh();
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

  // ── Reorder helpers ────────────────────────────────────────────────────────
  const moveCategory = async (idx: number, dir: -1 | 1) => {
    const next = [...menu.categories];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    try {
      await apiRequest(
        "PUT",
        `/api/owner/menus/${menu.id}/reorder/categories`,
        { categoryIds: next.map((c) => c.id) },
      );
      onRefresh();
    } catch (err: any) {
      toast({
        title: "Reorder failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const moveItem = async (
    categoryId: string,
    items: MenuItem[],
    idx: number,
    dir: -1 | 1,
  ) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    try {
      await apiRequest(
        "PUT",
        `/api/owner/menu-categories/${categoryId}/reorder/items`,
        { itemIds: next.map((i) => i.id) },
      );
      onRefresh();
    } catch (err: any) {
      toast({
        title: "Reorder failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
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
                <div className="rounded-lg border border-dashed py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No categories yet. Add a starter category to begin adding items.
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={createStarterCategory}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Starter Category
                  </Button>
                </div>
              )}

              <Accordion type="multiple" className="space-y-2">
                {menu.categories.map((cat, catIdx) => (
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
                          disabled={catIdx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveCategory(catIdx, -1);
                          }}
                          title="Move up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={catIdx === menu.categories.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveCategory(catIdx, 1);
                          }}
                          title="Move down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
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
                        {cat.items.map((item, itemIdx) => (
                          <MenuItemRow
                            key={item.id}
                            item={item}
                            canMoveUp={itemIdx > 0}
                            canMoveDown={itemIdx < cat.items.length - 1}
                            onMoveUp={() => moveItem(cat.id, cat.items, itemIdx, -1)}
                            onMoveDown={() => moveItem(cat.id, cat.items, itemIdx, 1)}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor={`menu-name-${menu.id}`}>Menu Name</Label>
                  <Input
                    id={`menu-name-${menu.id}`}
                    value={menuSettings.name}
                    onChange={(e) =>
                      setMenuSettings((s) => ({ ...s, name: e.target.value }))
                    }
                    placeholder="e.g. Lunch Menu"
                  />
                </div>
                <div>
                  <Label htmlFor={`menu-service-${menu.id}`}>Service Type</Label>
                  <Select
                    value={menuSettings.serviceType}
                    onValueChange={(value) =>
                      setMenuSettings((s) => ({
                        ...s,
                        serviceType: normalizeMenuServiceType(value),
                      }))
                    }
                  >
                    <SelectTrigger id={`menu-service-${menu.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MENU_SERVICE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor={`menu-from-${menu.id}`}>Starts</Label>
                    <Input
                      id={`menu-from-${menu.id}`}
                      type="time"
                      value={menuSettings.availableFrom}
                      onChange={(e) =>
                        setMenuSettings((s) => ({
                          ...s,
                          availableFrom: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor={`menu-to-${menu.id}`}>Ends</Label>
                    <Input
                      id={`menu-to-${menu.id}`}
                      type="time"
                      value={menuSettings.availableTo}
                      onChange={(e) =>
                        setMenuSettings((s) => ({
                          ...s,
                          availableTo: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
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
                  <Label>Absorb Platform Fee</Label>
                  <p className="text-xs text-muted-foreground">
                    Hide the $1 MealScout fee from customers (you cover it)
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
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  item: MenuItem;
  onEdit: () => void;
  onRefresh: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
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
          {!item.isAvailable && (
            <Badge variant="secondary" className="text-xs">
              86'd
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
          <span>{formatMoney(item.priceCents)}</span>
          {item.calories && <span>· {item.calories} cal</span>}
          {item.trackInventory && item.inventoryQty !== null && (
            <span>· {item.inventoryQty} left</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onMoveUp && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!canMoveUp}
            onClick={onMoveUp}
            title="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
        )}
        {onMoveDown && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={!canMoveDown}
            onClick={onMoveDown}
            title="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        )}
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
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: item?.name ?? "",
    description: item?.description ?? "",
    priceCents: item ? String(item.priceCents / 100) : "",
    calories: item?.calories ? String(item.calories) : "",
    proteinG: (item as any)?.proteinG ? String((item as any).proteinG) : "",
    carbsG: (item as any)?.carbsG ? String((item as any).carbsG) : "",
    fatG: (item as any)?.fatG ? String((item as any).fatG) : "",
    isAvailable: item?.isAvailable ?? true,
    trackInventory: item?.trackInventory ?? false,
    inventoryQty: item?.inventoryQty ? String(item.inventoryQty) : "",
    dietaryTags: (item?.dietaryTags ?? []).join(", "),
    allergens: (item?.allergens ?? []).join(", "),
    imageUrl: item?.imageUrl ?? "",
    sku: (item as any)?.sku ?? "",
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
        calories: form.calories ? parseInt(form.calories) : null,
        proteinG: form.proteinG ? form.proteinG : null,
        carbsG: form.carbsG ? form.carbsG : null,
        fatG: form.fatG ? form.fatG : null,
        isAvailable: form.isAvailable,
        trackInventory: form.trackInventory,
        inventoryQty:
          form.trackInventory && form.inventoryQty
            ? parseInt(form.inventoryQty)
            : null,
        dietaryTags: form.dietaryTags
          ? form.dietaryTags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        allergens: form.allergens
          ? form.allergens
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean)
          : [],
        imageUrl: form.imageUrl.trim() || null,
        sku: form.sku.trim() || null,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            <div>
              <Label>Protein (g)</Label>
              <Input
                value={form.proteinG}
                onChange={(e) =>
                  setForm((f) => ({ ...f, proteinG: e.target.value }))
                }
                placeholder="e.g. 35"
                type="number"
                min="0"
                step="0.1"
              />
            </div>
            <div>
              <Label>Carbs (g)</Label>
              <Input
                value={form.carbsG}
                onChange={(e) =>
                  setForm((f) => ({ ...f, carbsG: e.target.value }))
                }
                placeholder="e.g. 50"
                type="number"
                min="0"
                step="0.1"
              />
            </div>
            <div>
              <Label>Fat (g)</Label>
              <Input
                value={form.fatG}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fatG: e.target.value }))
                }
                placeholder="e.g. 28"
                type="number"
                min="0"
                step="0.1"
              />
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
            <div className="col-span-2">
              <Label>Photo</Label>
              {form.imageUrl && (
                <div className="mt-1 mb-2">
                  <img
                    src={form.imageUrl}
                    alt={form.name || "Menu item"}
                    className="w-32 h-32 object-cover rounded-md border"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={form.imageUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, imageUrl: e.target.value }))
                  }
                  placeholder="https://… or upload below"
                  type="url"
                />
                {item && (
                  <>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !item) return;
                        setIsUploadingPhoto(true);
                        try {
                          const fd = new FormData();
                          fd.append("file", file);
                          const res = await fetch(
                            `/api/owner/menu-items/${item.id}/photo`,
                            {
                              method: "POST",
                              body: fd,
                              credentials: "include",
                            },
                          );
                          const data = await res.json();
                          if (!res.ok)
                            throw new Error(data.message || "Upload failed");
                          setForm((f) => ({
                            ...f,
                            imageUrl: data.imageUrl ?? f.imageUrl,
                          }));
                          toast({ title: "Photo uploaded" });
                        } catch (err: any) {
                          toast({
                            title: "Upload failed",
                            description: err.message,
                            variant: "destructive",
                          });
                        } finally {
                          setIsUploadingPhoto(false);
                          if (photoInputRef.current)
                            photoInputRef.current.value = "";
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={isUploadingPhoto}
                    >
                      {isUploadingPhoto ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                    </Button>
                  </>
                )}
              </div>
              {!item && (
                <p className="text-xs text-muted-foreground mt-1">
                  Save the item first, then upload a photo.
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label>
                SKU{" "}
                <span className="text-xs text-muted-foreground">
                  (optional, for POS sync)
                </span>
              </Label>
              <Input
                value={form.sku}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sku: e.target.value }))
                }
                placeholder="e.g. BURGER-CLASSIC-01"
              />
            </div>
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

          {item && (
            <div className="pt-4 border-t space-y-6">
              <ItemVariantsEditor
                itemId={item.id}
                initial={item.variants ?? []}
                onChanged={onSaved}
              />
              <ItemModifiersEditor
                itemId={item.id}
                initial={item.modifiers ?? []}
                onChanged={onSaved}
              />
            </div>
          )}
          {!item && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Save the item first to add size variants or add-on modifiers.
            </p>
          )}
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

// ──────────────────────────── ItemVariantsEditor ──────────────────────────────
function ItemVariantsEditor({
  itemId,
  initial,
  onChanged,
}: {
  itemId: string;
  initial: MenuItemVariant[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [variants, setVariants] = useState<MenuItemVariant[]>(
    initial.map((v) => ({ ...v })),
  );
  const [saving, setSaving] = useState(false);

  const update = (idx: number, patch: Partial<MenuItemVariant>) =>
    setVariants((arr) =>
      arr.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    );

  const add = () =>
    setVariants((arr) => [
      ...arr,
      { label: "", additionalCents: 0, isDefault: arr.length === 0 },
    ]);

  const remove = (idx: number) =>
    setVariants((arr) => arr.filter((_, i) => i !== idx));

  const save = async () => {
    const cleaned = variants
      .map((v) => ({ ...v, label: v.label.trim() }))
      .filter((v) => v.label.length > 0);
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/owner/menu-items/${itemId}/variants`, {
        variants: cleaned,
      });
      toast({ title: "Variants saved" });
      onChanged();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">
          Size Variants{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (e.g. Small, Medium, Large)
          </span>
        </Label>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add
        </Button>
      </div>
      {variants.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No size variants. Add one if this item comes in multiple sizes.
        </p>
      )}
      {variants.map((v, idx) => (
        <div
          key={idx}
          className="grid grid-cols-12 gap-2 items-center p-2 rounded-md border bg-muted/20"
        >
          <Input
            className="col-span-5"
            value={v.label}
            onChange={(e) => update(idx, { label: e.target.value })}
            placeholder="Label (e.g. Large)"
          />
          <div className="col-span-4 relative">
            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="pl-7"
              type="number"
              min="0"
              step="0.01"
              value={(v.additionalCents / 100).toFixed(2)}
              onChange={(e) =>
                update(idx, {
                  additionalCents: Math.round(
                    (parseFloat(e.target.value) || 0) * 100,
                  ),
                })
              }
              placeholder="0.00"
            />
          </div>
          <label className="col-span-2 flex items-center gap-1 text-xs">
            <input
              type="radio"
              checked={v.isDefault}
              onChange={() =>
                setVariants((arr) =>
                  arr.map((vv, i) => ({ ...vv, isDefault: i === idx })),
                )
              }
            />
            Default
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="col-span-1 h-7 w-7 p-0 text-destructive"
            onClick={() => remove(idx)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      {variants.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Save Variants
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────── ItemModifiersEditor ─────────────────────────────
function ItemModifiersEditor({
  itemId,
  initial,
  onChanged,
}: {
  itemId: string;
  initial: MenuItemModifier[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [mods, setMods] = useState<MenuItemModifier[]>(
    initial.map((m) => ({ ...m })),
  );
  const [saving, setSaving] = useState(false);

  const update = (idx: number, patch: Partial<MenuItemModifier>) =>
    setMods((arr) => arr.map((m, i) => (i === idx ? { ...m, ...patch } : m)));

  const add = () =>
    setMods((arr) => [
      ...arr,
      {
        groupName: arr[arr.length - 1]?.groupName || "Add-ons",
        label: "",
        additionalCents: 0,
        isRequired: false,
        maxSelections: 1,
      },
    ]);

  const remove = (idx: number) =>
    setMods((arr) => arr.filter((_, i) => i !== idx));

  const save = async () => {
    const cleaned = mods
      .map((m) => ({
        ...m,
        label: m.label.trim(),
        groupName: m.groupName.trim() || "Add-ons",
      }))
      .filter((m) => m.label.length > 0);
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/owner/menu-items/${itemId}/modifiers`, {
        modifiers: cleaned,
      });
      toast({ title: "Modifiers saved" });
      onChanged();
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">
          Modifiers{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (e.g. Extra cheese, No onions, Sauce choice)
          </span>
        </Label>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add
        </Button>
      </div>
      {mods.length === 0 && (
        <p className="text-xs text-muted-foreground py-2">
          No modifiers. Add toppings, sauces, or other add-ons.
        </p>
      )}
      {mods.map((m, idx) => (
        <div
          key={idx}
          className="grid grid-cols-12 gap-2 items-center p-2 rounded-md border bg-muted/20"
        >
          <Input
            className="col-span-3"
            value={m.groupName}
            onChange={(e) => update(idx, { groupName: e.target.value })}
            placeholder="Group"
          />
          <Input
            className="col-span-4"
            value={m.label}
            onChange={(e) => update(idx, { label: e.target.value })}
            placeholder="Label"
          />
          <div className="col-span-3 relative">
            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              className="pl-7"
              type="number"
              min="0"
              step="0.01"
              value={(m.additionalCents / 100).toFixed(2)}
              onChange={(e) =>
                update(idx, {
                  additionalCents: Math.round(
                    (parseFloat(e.target.value) || 0) * 100,
                  ),
                })
              }
              placeholder="0.00"
            />
          </div>
          <label className="col-span-1 flex items-center justify-center text-xs">
            <input
              type="checkbox"
              checked={m.isRequired}
              onChange={(e) => update(idx, { isRequired: e.target.checked })}
              title="Required"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="col-span-1 h-7 w-7 p-0 text-destructive"
            onClick={() => remove(idx)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
      {mods.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground">
            Group = the choice category (e.g. "Sauce"). Tick the checkbox to
            require a selection from that group.
          </p>
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              Save Modifiers
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
