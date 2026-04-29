import { useState, useEffect, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Search,
  Heart,
  Receipt,
  User,
  MapPin,
  Store,
  Plus,
  BarChart3,
  UserPlus,
  Clapperboard,
  Bug,
  Shield,
  Users,
  UtensilsCrossed,
  Calendar,
  LayoutDashboard,
  ParkingSquare,
  Truck,
  Share2,
  ChefHat,
  Package,
  ShoppingCart,
  MoreHorizontal,
  Settings,
  LogOut,
  X,
  HelpCircle,
  Bell,
  CreditCard,
  MapPinned,
  Menu,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";

type NavItem = {
  path?: string;
  icon: ComponentType<{ className?: string }>;
  labelKey?:
    | "nav.food"
    | "nav.map"
    | "nav.parkingPass"
    | "nav.video"
    | "nav.profile"
    | "nav.dashboard"
    | "nav.favorites"
    | "nav.createAccount"
    | "nav.claimTruck"
    | "nav.events"
    | "nav.host"
    | "nav.forRestaurants"
    | "nav.forBars"
    | "nav.staff"
    | "nav.createSpecial"
    | "nav.subscription"
    | "nav.supplies"
    | "nav.report"
    | "nav.admin"
    | "nav.controlCenter"
    | "nav.affiliates"
    | "nav.featuredSpecials"
    | "nav.share";
  fallbackLabel: string;
  onClick?: () => void;
  isBug?: boolean;
  testId?: string;
  /** Group label for the "More" drawer */
  group?: string;
};

type NavigationProps = {
  scope?: "global" | "local";
};

let hasGlobalNavigation = false;

export default function Navigation({ scope = "local" }: NavigationProps) {
  const isGlobalScope = scope === "global";
  const [showLocalNav, setShowLocalNav] = useState(true);
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isReporting, setIsReporting] = useState(false);
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (isGlobalScope) {
      hasGlobalNavigation = true;
      return () => {
        hasGlobalNavigation = false;
      };
    }

    if (hasGlobalNavigation) {
      setShowLocalNav(false);
    }
  }, [isGlobalScope]);

  useEffect(() => {
    if (!isGlobalScope && hasGlobalNavigation) {
      setShowLocalNav(false);
    }
  });

  const handleBugReport = async () => {
    if (isReporting) return;
    setIsReporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: 0.5,
        logging: false,
      });
      const screenshot = canvas.toDataURL("image/png");
      const currentUrl = window.location.href;
      const userAgent = navigator.userAgent;
      await apiRequest("POST", "/api/bug-report", {
        screenshot,
        currentUrl,
        userAgent,
      });
      toast({
        title: t("toast.bugSentTitle", "Bug report sent!"),
        description: t(
          "toast.bugSentDescription",
          "Thank you for helping us improve MealScout.",
        ),
      });
    } catch (error) {
      console.error("Failed to submit bug report:", error);
      toast({
        title: t("toast.bugFailedTitle", "Failed to send report"),
        description: t(
          "toast.bugFailedDescription",
          "Please try again or contact support.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsReporting(false);
    }
  };

  const handleShare = async () => {
    setLocation("/share-hub");
  };

  // Check user role
  const isRestaurantOwner = user && user.userType === "restaurant_owner";
  const isFoodTruck = user && user.userType === "food_truck";
  const isSupplier = user && user.userType === "supplier";
  const isHostUser = user && user.userType === "host";
  const isAdmin =
    user && (user.userType === "admin" || user.userType === "super_admin");
  const isStaff = user && user.userType === "staff";
  const isEventCoordinator = user && user.userType === "event_coordinator";
  const { data: businessAccess } = useQuery<{
    hasAnyAccess: boolean;
    permissions: {
      manageDeals: boolean;
      manageParkingPass: boolean;
      viewAnalytics: boolean;
      manageProfile: boolean;
    };
  }>({
    queryKey: ["/api/business-access/me"],
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const hasBusinessTeamAccess = Boolean(businessAccess?.hasAnyAccess);
  const canManageDeals =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.manageDeals === true;
  const canManageParkingPass =
    isAdmin ||
    isStaff ||
    isFoodTruck ||
    isRestaurantOwner ||
    businessAccess?.permissions?.manageParkingPass === true;
  const canManageBusinessProfile =
    isAdmin ||
    isStaff ||
    isRestaurantOwner ||
    isFoodTruck ||
    businessAccess?.permissions?.manageProfile === true;

  const [isHost, setIsHost] = useState(false);
  const canSeeParkingPassNav = canManageParkingPass || isHost;
  const currentPath = location.split("?")[0];
  const currentSearch = location.includes("?")
    ? location.slice(location.indexOf("?"))
    : window.location.search;
  const isHostManagementContext =
    currentPath === "/host/dashboard" ||
    (currentPath === "/parking-pass" &&
      new URLSearchParams(currentSearch).get("adminMode") === "host") ||
    Boolean(isHostUser && currentPath === "/parking-pass");
  const shouldUseHostNav = Boolean(isHost || isHostUser || isHostManagementContext);

  useEffect(() => {
    if (!user) {
      setIsHost(false);
      return;
    }
    let cancelled = false;
    fetch("/api/hosts")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setIsHost(false);
          return;
        }
        const hosts = await res.json().catch(() => []);
        setIsHost(Array.isArray(hosts) && hosts.length > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setIsHost(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!isGlobalScope && !showLocalNav) {
    return null;
  }

  // ─── NAV ITEM DEFINITIONS ───────────────────────────────────────

  // Top 3 items per role (shown in bottom bar)
  const getTopItems = (): NavItem[] => {
    if (!user) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
        { path: "/video", icon: Clapperboard, labelKey: "nav.video", fallbackLabel: "Video" },
      ];
    }
    if (shouldUseHostNav) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/host/dashboard", icon: Users, labelKey: "nav.host", fallbackLabel: "Host" },
        { path: "/parking-pass", icon: ParkingSquare, labelKey: "nav.parkingPass", fallbackLabel: "Parking Pass" },
      ];
    }
    if (isAdmin) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/admin/dashboard", icon: Shield, labelKey: "nav.admin", fallbackLabel: "Admin" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isStaff) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/staff", icon: Users, labelKey: "nav.staff", fallbackLabel: "Staff" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isEventCoordinator) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isSupplier) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/supplier/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", fallbackLabel: "Dashboard" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isFoodTruck) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", fallbackLabel: "Dashboard" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isRestaurantOwner) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", fallbackLabel: "Dashboard" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (hasBusinessTeamAccess) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/restaurant-owner-dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard", fallbackLabel: "Dashboard" },
        { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      ];
    }
    if (isHost) {
      return [
        { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
        { path: "/host/dashboard", icon: Users, labelKey: "nav.host", fallbackLabel: "Host" },
        { path: "/parking-pass", icon: ParkingSquare, labelKey: "nav.parkingPass", fallbackLabel: "Parking Pass" },
      ];
    }
    // Customer
    return [
      { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
      { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
      { path: "/video", icon: Clapperboard, labelKey: "nav.video", fallbackLabel: "Video" },
    ];
  };

  // All overflow items for the "More" drawer, grouped by category
  const getOverflowItems = (): NavItem[] => {
    const items: NavItem[] = [];

    // ── Discover ──
    items.push(
      { path: "/", icon: UtensilsCrossed, fallbackLabel: "Food", group: "Discover" },
      { path: "/video", icon: Clapperboard, fallbackLabel: "Video", group: "Discover" },
      { path: "/events", icon: Calendar, fallbackLabel: "Events", group: "Discover" },
    );

    if (!shouldUseHostNav) {
      items.splice(1, 0, { path: "/map", icon: MapPin, fallbackLabel: "Map", group: "Discover" });
    }

    if (!user) {
      items.push(
        { path: "/customer-signup", icon: UserPlus, fallbackLabel: "Create Account", group: "Get Started" },
        { path: "/restaurant-signup?businessType=food_truck&claim=1", icon: Truck, fallbackLabel: "Claim Business", group: "Get Started" },
      );
    }

    if (user) {
      // ── My Stuff ──
      items.push(
        { path: "/dashboard", icon: LayoutDashboard, fallbackLabel: "Dashboard", group: "My Stuff" },
        { path: "/favorites", icon: Heart, fallbackLabel: "Favorites", group: "My Stuff" },
        { path: "/orders", icon: Receipt, fallbackLabel: "Orders", group: "My Stuff" },
      );

      // ── Business ──
      if (isAdmin || isStaff || isRestaurantOwner || isFoodTruck || hasBusinessTeamAccess) {
        if (isRestaurantOwner || isFoodTruck || hasBusinessTeamAccess) {
          items.push(
            { path: "/restaurant-owner-dashboard", icon: Store, fallbackLabel: "Business Dashboard", group: "Business" },
          );
        }
        if (canManageDeals) {
          items.push(
            { path: "/deal-creation", icon: Plus, fallbackLabel: "Create Special", group: "Business" },
          );
        }
        items.push(
          { path: "/menu-builder", icon: Store, fallbackLabel: "Menu Builder", group: "Business" },
          { path: "/kitchen", icon: ChefHat, fallbackLabel: "Kitchen", group: "Business" },
          { path: "/supply/orders", icon: Package, fallbackLabel: "Supply Orders", group: "Business" },
        );
        if (canSeeParkingPassNav) {
          items.push(
            { path: "/parking-pass", icon: ParkingSquare, fallbackLabel: "Parking Pass", group: "Business" },
          );
        }
        if (hasBusinessTeamAccess || canManageBusinessProfile) {
          items.push(
            { path: "/business-team", icon: Users, fallbackLabel: "Team", group: "Business" },
          );
        }
        items.push(
          { path: "/subscription", icon: BarChart3, fallbackLabel: "Subscription", group: "Business" },
          { path: "/suppliers", icon: Store, fallbackLabel: "Supplies", group: "Business" },
        );
      }

      // ── Host ──
      if (isHost || isAdmin || isStaff) {
        items.push(
          { path: "/host/dashboard", icon: Users, fallbackLabel: "Host Dashboard", group: "Host" },
        );
        if (canSeeParkingPassNav && !items.some(i => i.path === "/parking-pass")) {
          items.push(
            { path: "/parking-pass", icon: ParkingSquare, fallbackLabel: "Parking Pass", group: "Host" },
          );
        }
      }

      // ── Supplier ──
      if (isSupplier) {
        items.push(
          { path: "/supplier/dashboard", icon: LayoutDashboard, fallbackLabel: "Supplier Dashboard", group: "Supplier" },
        );
      }

      // ── Staff ──
      if (isStaff) {
        items.push(
          { path: "/staff", icon: Users, fallbackLabel: "Staff Hub", group: "Staff" },
        );
      }

      // ── Admin ──
      if (isAdmin) {
        items.push(
          { path: "/admin/dashboard", icon: Shield, fallbackLabel: "Admin", group: "Admin" },
          { path: "/admin/control-center", icon: LayoutDashboard, fallbackLabel: "Control Center", group: "Admin" },
          { path: "/admin/sentiment-intelligence", icon: TrendingUp, fallbackLabel: "Sentiment Intel", group: "Admin" },
          { path: "/admin/affiliates", icon: Users, fallbackLabel: "Affiliates", group: "Admin" },
          { path: "/admin/vac-logs", icon: Shield, fallbackLabel: "VAC Logs", group: "Admin" },
          { path: "/deals/featured", icon: Receipt, fallbackLabel: "Featured Specials", group: "Admin" },
          { path: "/truck-discovery", icon: Truck, fallbackLabel: "Open Calls", group: "Admin" },
        );
      }

      // ── Account ──
      items.push(
        { path: "/profile", icon: User, fallbackLabel: "Profile", group: "Account" },
        { path: "/profile/settings", icon: Settings, fallbackLabel: "Settings", group: "Account" },
        { path: "/profile/notifications", icon: Bell, fallbackLabel: "Notifications", group: "Account" },
        { path: "/profile/payment", icon: CreditCard, fallbackLabel: "Payment Methods", group: "Account" },
        { path: "/profile/addresses", icon: MapPinned, fallbackLabel: "Addresses", group: "Account" },
        { path: "/profile/help", icon: HelpCircle, fallbackLabel: "Help & Support", group: "Account" },
      );

      // ── Share & Report ──
      if (!isAdmin && !isStaff) {
        items.push(
          { path: "/share-hub", icon: Share2, fallbackLabel: "Share Hub", group: "More" },
        );
      }
    }

    items.push({
      icon: Bug,
      fallbackLabel: "Report Bug",
      onClick: handleBugReport,
      isBug: true,
      group: "More",
    });

    // Deduplicate by path
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = item.path ? `path:${item.path}` : `label:${item.fallbackLabel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const topItems = getTopItems();
  const overflowItems = getOverflowItems();

  // Group overflow items for the drawer
  const groupedOverflow = overflowItems.reduce(
    (acc, item) => {
      const group = item.group || "More";
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    },
    {} as Record<string, NavItem[]>,
  );

  // ─── DESKTOP SIDEBAR ITEMS ──────────────────────────────────────
  // For desktop, we show a proper sidebar with grouped navigation
  const desktopSidebarGroups = Object.entries(groupedOverflow);

  // ─── RENDER HELPERS ─────────────────────────────────────────────

  const renderNavLink = (item: NavItem, size: "sm" | "md" = "sm") => {
    const label = item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel;
    const isActive = item.path ? location === item.path : false;
    const iconSize = size === "sm" ? "w-5 h-5" : "w-5 h-5";
    const textSize = size === "sm" ? "text-[11px]" : "text-sm";

    if (item.path) {
      return (
        <Link
          key={item.path}
          href={item.path}
          className={`flex flex-col items-center justify-center space-y-1 px-2 min-h-[56px] min-w-[64px] rounded-xl transition-colors duration-200 ${
            isActive ? "nav-link--active" : "nav-link--inactive"
          }`}
          data-testid={`nav-${(item.testId ?? item.fallbackLabel).toLowerCase().replace(/\s+/g, "-")}`}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          onClick={() => setMoreOpen(false)}
        >
          <item.icon className={iconSize} />
          <span className={`${textSize} leading-tight font-semibold tracking-normal`}>{label}</span>
        </Link>
      );
    }

    return (
      <button
        key={item.fallbackLabel}
        onClick={() => {
          item.onClick?.();
          setMoreOpen(false);
        }}
        disabled={item.isBug ? isReporting : false}
        className={`flex flex-col items-center justify-center space-y-1 px-2 min-h-[56px] min-w-[64px] rounded-xl transition-colors duration-200 ${
          item.isBug ? "nav-bug" : "nav-link--inactive"
        } ${isReporting && item.isBug ? "opacity-80 cursor-not-allowed" : ""}`}
        data-testid={`nav-${(item.testId ?? item.fallbackLabel).toLowerCase().replace(/\s+/g, "-")}`}
        aria-label={label}
      >
        {isReporting && item.isBug ? (
          <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <item.icon className={iconSize} />
        )}
        <span className={`${textSize} leading-tight font-semibold tracking-normal`}>{label}</span>
      </button>
    );
  };

  const renderDrawerItem = (item: NavItem) => {
    const label = item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel;
    const isActive = item.path ? location === item.path : false;

    if (item.path) {
      return (
        <Link
          key={item.path}
          href={item.path}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
            isActive
              ? "bg-orange-500/10 text-orange-500 font-semibold"
              : "text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
          }`}
          onClick={() => setMoreOpen(false)}
        >
          <item.icon className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </Link>
      );
    }

    return (
      <button
        key={item.fallbackLabel}
        onClick={() => {
          item.onClick?.();
          setMoreOpen(false);
        }}
        disabled={item.isBug ? isReporting : false}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors w-full text-left ${
          item.isBug
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        }`}
      >
        {isReporting && item.isBug ? (
          <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
        ) : (
          <item.icon className="w-5 h-5 flex-shrink-0" />
        )}
        <span className="text-sm font-medium">{label}</span>
      </button>
    );
  };

  const renderSidebarLink = (item: NavItem) => {
    const label = item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel;
    const isActive = item.path ? location === item.path : false;

    if (item.path) {
      return (
        <Link
          key={item.path}
          href={item.path}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm ${
            isActive
              ? "bg-orange-500/10 text-orange-500 font-semibold"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
          }`}
          onClick={() => setSidebarOpen(false)}
        >
          <item.icon className="w-4 h-4 flex-shrink-0" />
          <span>{label}</span>
        </Link>
      );
    }

    return (
      <button
        key={item.fallbackLabel}
        onClick={() => {
          item.onClick?.();
          setSidebarOpen(false);
        }}
        disabled={item.isBug ? isReporting : false}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm w-full text-left ${
          item.isBug
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-hover)]"
        }`}
      >
        <item.icon className="w-4 h-4 flex-shrink-0" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          DESKTOP: Sidebar toggle button + collapsible sidebar
          ═══════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        {/* Toggle button - always visible */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed top-4 left-4 z-50 h-10 w-10 flex items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-clean transition-colors hover:bg-[var(--bg-card-hover)]"
          aria-label="Toggle navigation"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Sidebar panel */}
        {sidebarOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
              onClick={() => setSidebarOpen(false)}
            />
            {/* Sidebar */}
            <aside className="fixed top-0 left-0 bottom-0 w-72 z-50 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] shadow-clean-lg overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4">
                <Link href="/" className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
                  <UtensilsCrossed className="w-6 h-6 text-orange-500" />
                  <span className="text-lg font-bold font-display tracking-tight">MealScout</span>
                </Link>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* User info */}
              {user && (
                <div className="px-5 pb-4 border-b border-[var(--border-subtle)]">
                  <Link
                    href="/profile"
                    className="flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
                      <User className="w-5 h-5 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{user.firstName || user.email}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
                    </div>
                  </Link>
                </div>
              )}

              {/* Nav groups */}
              <nav className="px-3 py-3 space-y-4">
                {desktopSidebarGroups.map(([group, items]) => (
                  <div key={group}>
                    <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {group}
                    </p>
                    <div className="space-y-0.5">
                      {items.map(renderSidebarLink)}
                    </div>
                  </div>
                ))}

                {/* Logout */}
                {user && (
                  <div className="pt-2 border-t border-[var(--border-subtle)]">
                    <button
                      onClick={async () => {
                        try {
                          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                          window.location.href = "/";
                        } catch {
                          window.location.href = "/";
                        }
                      }}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm w-full text-left text-red-500 hover:bg-red-500/10"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </nav>
            </aside>
          </>
        )}

        {/* Desktop top-right quick actions (compact) */}
        <div data-nav-root={scope} className="fixed top-4 right-4 z-50">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg p-2">
            <div className="flex items-center gap-2">
              {topItems.map((item) =>
                item.path ? (
                  <Link
                    key={`quick-${item.path}`}
                    href={item.path}
                    className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
                      location === item.path
                        ? "bg-[color:var(--accent-text)] text-white"
                        : "bg-[var(--bg-surface)] text-foreground hover:bg-[var(--bg-card-hover)]"
                    }`}
                    aria-label={item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden lg:inline">
                      {item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
                    </span>
                  </Link>
                ) : null,
              )}
              {user && (
                <Link
                  href="/profile"
                  className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
                    location === "/profile"
                      ? "bg-[color:var(--accent-text)] text-white"
                      : "bg-[var(--bg-surface)] text-foreground hover:bg-[var(--bg-card-hover)]"
                  }`}
                  aria-label="Profile"
                >
                  <User className="h-4 w-4" />
                  <span className="hidden lg:inline">Profile</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MOBILE: Bottom nav bar with top 3 + share + more
          ═══════════════════════════════════════════════════════════════ */}
      <nav className="nav-bar nav-bar-mobile fixed bottom-0 left-0 right-0 h-[var(--mobile-nav-height)] w-full border-t px-2 pt-2 pb-[env(safe-area-inset-bottom)] z-[1100] lg:hidden">
        <div className="flex items-stretch justify-around w-full max-w-md mx-auto">
          {/* Top 3 role-specific items */}
          {topItems.map((item) => renderNavLink(item))}

          {/* Share button */}
          <button
            onClick={handleShare}
            className="flex flex-col items-center justify-center space-y-1 px-2 min-h-[56px] min-w-[64px] rounded-xl transition-colors duration-200 nav-link--inactive"
            aria-label="Share"
          >
            <Share2 className="w-5 h-5" />
            <span className="text-[11px] leading-tight font-semibold tracking-normal">Share</span>
          </button>

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center space-y-1 px-2 min-h-[56px] min-w-[64px] rounded-xl transition-colors duration-200 ${
              moreOpen ? "nav-link--active" : "nav-link--inactive"
            }`}
            aria-label="More"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[11px] leading-tight font-semibold tracking-normal">More</span>
          </button>
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════
          MOBILE: "More" drawer
          ═══════════════════════════════════════════════════════════════ */}
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="flex items-center justify-between pb-2">
            <DrawerTitle className="text-lg font-display">Menu</DrawerTitle>
            <DrawerClose asChild>
              <button className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </DrawerClose>
          </DrawerHeader>

          <div className="overflow-y-auto px-4 pb-8 space-y-5">
            {Object.entries(groupedOverflow).map(([group, items]) => (
              <div key={group}>
                <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {items.map(renderDrawerItem)}
                </div>
              </div>
            ))}

            {/* Logout in drawer */}
            {user && (
              <div className="pt-2 border-t border-[var(--border-subtle)]">
                <button
                  onClick={async () => {
                    try {
                      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                      window.location.href = "/";
                    } catch {
                      window.location.href = "/";
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors w-full text-left text-red-500 hover:bg-red-500/10"
                >
                  <LogOut className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm font-medium">Log Out</span>
                </button>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
