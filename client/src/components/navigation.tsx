import { useState, useEffect, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Search,
  Compass,
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
  MessageCircle,
  Menu,
  TrendingUp,
  Briefcase,
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
    | "nav.explore"
    | "nav.scout"
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
  const isRestaurantOwner =
    user &&
    (user.userType === "restaurant_owner" ||
      user.userType === "caterer" ||
      user.userType === "private_chef");
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
  const canSeeParkingPassNav = canManageParkingPass;
  const currentPath = location.split("?")[0];
  const hiddenAppNavRoutes = [
    "/admin",
    "/staff",
    "/events",
    "/event",
    "/truck-discovery",
    "/truck-landing",
    "/truck-onboarding",
    "/claim-truck",
  ];
  const hiddenGuestMobileNavRoutes = [
    "/login",
    "/customer-signup",
    "/verify-email",
    "/restaurant-signup",
    "/truck-onboarding",
    "/claim-truck",
    "/host-signup",
    "/event-signup",
    "/forgot-password",
    "/reset-password",
    "/change-password",
    "/account-setup",
    "/admin/login",
    "/events",
    "/event",
    "/truck-discovery",
    "/truck-landing",
  ];
  const shouldHideAppNav = hiddenAppNavRoutes.some(
    (route) => currentPath === route || currentPath.startsWith(`${route}/`),
  );
  const shouldHideGuestMobileNav =
    !user &&
    (currentPath === "/" ||
      hiddenGuestMobileNavRoutes.some(
        (route) => currentPath === route || currentPath.startsWith(`${route}/`),
      ));
  const shouldShowMobileNav = !shouldHideGuestMobileNav;
  const currentSearch = location.includes("?")
    ? location.slice(location.indexOf("?"))
    : window.location.search;
  const isHostManagementContext =
    currentPath === "/host/dashboard" ||
    (currentPath === "/parking-pass" &&
      new URLSearchParams(currentSearch).get("adminMode") === "host") ||
    Boolean(isHostUser && currentPath === "/parking-pass");
  const shouldUseHostNav = Boolean(
    isHost || isHostUser || isHostManagementContext,
  );

  useEffect(() => {
    if (!shouldShowMobileNav) {
      setMoreOpen(false);
    }
  }, [shouldShowMobileNav]);

  useEffect(() => {
    if (!user) {
      setIsHost(false);
      return;
    }
    let cancelled = false;
    fetch("/api/hosts", { credentials: "include" })
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

  if (shouldHideAppNav || (!isGlobalScope && !showLocalNav)) {
    return null;
  }

  // ─── NAV ITEM DEFINITIONS ───────────────────────────────────────

  // Bottom nav layout (Atmospheric):
  //   [Explore]  [role action]  [Scout center-glow]  [Share]  [More]
  // getTopItems returns the LEFT side: slot 1 (Explore, universal) + slot 2 (role action).
  // Scout, Share and More are rendered explicitly by the bottom-nav JSX.
  const exploreItem: NavItem = {
    path: "/explore",
    icon: Compass,
    labelKey: "nav.explore",
    fallbackLabel: "Explore",
  };

  const videoItem: NavItem = {
    path: "/video",
    icon: Clapperboard,
    labelKey: "nav.video",
    fallbackLabel: "Video",
  };

  const getTopItems = (): NavItem[] => {
    if (!user) {
      // Guest: Explore + Video
      return [exploreItem, videoItem];
    }
    if (shouldUseHostNav) {
      return [
        exploreItem,
        {
          path: "/host/dashboard",
          icon: Users,
          labelKey: "nav.host",
          fallbackLabel: "Host",
        },
      ];
    }
    if (isAdmin) {
      return [
        exploreItem,
        {
          path: "/admin/dashboard",
          icon: Shield,
          labelKey: "nav.admin",
          fallbackLabel: "Admin",
        },
      ];
    }
    if (isStaff) {
      return [
        exploreItem,
        {
          path: "/staff",
          icon: Users,
          labelKey: "nav.staff",
          fallbackLabel: "Staff",
        },
      ];
    }
    if (isEventCoordinator) {
      return [
        exploreItem,
        {
          path: "/events",
          icon: Calendar,
          labelKey: "nav.events",
          fallbackLabel: "Events",
        },
      ];
    }
    if (isSupplier) {
      return [
        exploreItem,
        {
          path: "/supplier/dashboard",
          icon: LayoutDashboard,
          labelKey: "nav.dashboard",
          fallbackLabel: "Dashboard",
        },
      ];
    }
    if (isFoodTruck) {
      return [
        exploreItem,
        {
          path: "/dashboard",
          icon: LayoutDashboard,
          labelKey: "nav.dashboard",
          fallbackLabel: "Dashboard",
        },
      ];
    }
    if (isRestaurantOwner) {
      return [
        exploreItem,
        {
          path: "/dashboard",
          icon: LayoutDashboard,
          labelKey: "nav.dashboard",
          fallbackLabel: "Dashboard",
        },
      ];
    }
    if (hasBusinessTeamAccess) {
      return [
        exploreItem,
        {
          path: "/restaurant-owner-dashboard",
          icon: LayoutDashboard,
          labelKey: "nav.dashboard",
          fallbackLabel: "Dashboard",
        },
      ];
    }
    if (isHost) {
      return [
        exploreItem,
        {
          path: "/host/dashboard",
          icon: Users,
          labelKey: "nav.host",
          fallbackLabel: "Host",
        },
      ];
    }
    // Customer: Explore + Video (keeps Scout dead center)
    return [exploreItem, videoItem];
  };

  // The center 'Scout' action — same for everyone.
  const scoutItem: NavItem = {
    path: "/find-food",
    icon: Search,
    labelKey: "nav.scout",
    fallbackLabel: "Scout",
  };

  // All overflow items for the "More" drawer, grouped by category
  const getOverflowItems = (): NavItem[] => {
    const items: NavItem[] = [];

    // ── Discover ──
    items.push(
      {
        path: "/",
        icon: UtensilsCrossed,
        fallbackLabel: "Food",
        group: "Discover",
      },
      { path: "/map", icon: MapPin, fallbackLabel: "Map", group: "Discover" },
      {
        path: "/video",
        icon: Clapperboard,
        fallbackLabel: "Video",
        group: "Discover",
      },
      {
        path: "/events",
        icon: Calendar,
        fallbackLabel: "Events",
        group: "Discover",
      },
      {
        path: "/jobs",
        icon: Briefcase,
        fallbackLabel: "Jobs",
        group: "Discover",
      },
    );

    if (!user) {
      items.push(
        {
          path: "/customer-signup",
          icon: UserPlus,
          fallbackLabel: "Create Account",
          group: "Get Started",
        },
        {
          path: "/truck-onboarding?claim=1",
          icon: Truck,
          fallbackLabel: "Claim Business",
          group: "Get Started",
        },
      );
    }

    if (user) {
      // ── My Stuff ──
      items.push(
        {
          path: "/dashboard",
          icon: LayoutDashboard,
          fallbackLabel: "Dashboard",
          group: "My Stuff",
        },
        {
          path: "/favorites",
          icon: Heart,
          fallbackLabel: "Favorites",
          group: "My Stuff",
        },
        {
          path: "/orders",
          icon: Receipt,
          fallbackLabel: "Orders",
          group: "My Stuff",
        },
        {
          path: "/messages",
          icon: MessageCircle,
          fallbackLabel: "Messages",
          group: "My Stuff",
        },
      );

      // ── Business ──
      if (
        isAdmin ||
        isStaff ||
        isRestaurantOwner ||
        isFoodTruck ||
        hasBusinessTeamAccess
      ) {
        if (isRestaurantOwner || isFoodTruck || hasBusinessTeamAccess) {
          items.push({
            path: "/restaurant-owner-dashboard",
            icon: Store,
            fallbackLabel: "Business Dashboard",
            group: "Business",
          });
        }
        if (canManageDeals) {
          items.push({
            path: "/deal-creation",
            icon: Plus,
            fallbackLabel: "Create Special",
            group: "Business",
          });
        }
        if (canManageBusinessProfile) {
          items.push({
            path: "/hiring",
            icon: Briefcase,
            fallbackLabel: "Hiring",
            group: "Business",
          });
        }
        items.push(
          {
            path: "/menu-builder",
            icon: Store,
            fallbackLabel: "Menu Builder",
            group: "Business",
          },
          {
            path: "/kitchen",
            icon: ChefHat,
            fallbackLabel: "Kitchen",
            group: "Business",
          },
          {
            path: "/supply/orders",
            icon: Package,
            fallbackLabel: "Supply Orders",
            group: "Business",
          },
        );
        if (canSeeParkingPassNav && !shouldUseHostNav) {
          items.push({
            path: "/parking-pass",
            icon: ParkingSquare,
            fallbackLabel: "Parking Pass",
            group: "Business",
          });
        }
        if (hasBusinessTeamAccess || canManageBusinessProfile) {
          items.push({
            path: "/business-team",
            icon: Users,
            fallbackLabel: "Team",
            group: "Business",
          });
        }
        items.push(
          {
            path: "/subscription",
            icon: BarChart3,
            fallbackLabel: "Subscription",
            group: "Business",
          },
          {
            path: "/suppliers",
            icon: Store,
            fallbackLabel: "Supplies",
            group: "Business",
          },
        );
      }

      // ── Host ──
      if (isHost || isAdmin || isStaff) {
        items.push({
          path: "/host/dashboard",
          icon: Users,
          fallbackLabel: "Host Dashboard",
          group: "Host",
        });
        if (
          canSeeParkingPassNav &&
          !shouldUseHostNav &&
          !items.some((i) => i.path === "/parking-pass")
        ) {
          items.push({
            path: "/parking-pass",
            icon: ParkingSquare,
            fallbackLabel: "Parking Pass",
            group: "Host",
          });
        }
      }

      // ── Supplier ──
      if (isSupplier) {
        items.push({
          path: "/supplier/dashboard",
          icon: LayoutDashboard,
          fallbackLabel: "Supplier Dashboard",
          group: "Supplier",
        });
      }

      // ── Staff ──
      if (isStaff) {
        items.push({
          path: "/staff",
          icon: Users,
          fallbackLabel: "Staff Hub",
          group: "Staff",
        });
      }

      // ── Admin ──
      if (isAdmin) {
        items.push(
          {
            path: "/admin/dashboard",
            icon: Shield,
            fallbackLabel: "Admin",
            group: "Admin",
          },
          {
            path: "/admin/control-center",
            icon: LayoutDashboard,
            fallbackLabel: "Control Center",
            group: "Admin",
          },
          {
            path: "/admin/sentiment-intelligence",
            icon: TrendingUp,
            fallbackLabel: "Sentiment Intel",
            group: "Admin",
          },
          {
            path: "/admin/affiliates",
            icon: Users,
            fallbackLabel: "Affiliates",
            group: "Admin",
          },
          {
            path: "/admin/vac-logs",
            icon: Shield,
            fallbackLabel: "VAC Logs",
            group: "Admin",
          },
          {
            path: "/deals/featured",
            icon: Receipt,
            fallbackLabel: "Featured Specials",
            group: "Admin",
          },
          {
            path: "/truck-discovery",
            icon: Truck,
            fallbackLabel: "Open Calls",
            group: "Admin",
          },
        );
      }

      // ── Account ──
      items.push(
        {
          path: "/profile",
          icon: User,
          fallbackLabel: "Profile",
          group: "Account",
        },
        {
          path: "/profile/settings",
          icon: Settings,
          fallbackLabel: "Settings",
          group: "Account",
        },
        {
          path: "/profile/notifications",
          icon: Bell,
          fallbackLabel: "Notifications",
          group: "Account",
        },
        {
          path: "/profile/payment",
          icon: CreditCard,
          fallbackLabel: "Payment Methods",
          group: "Account",
        },
        {
          path: "/profile/addresses",
          icon: MapPinned,
          fallbackLabel: "Addresses",
          group: "Account",
        },
        {
          path: "/profile/help",
          icon: HelpCircle,
          fallbackLabel: "Help & Support",
          group: "Account",
        },
      );

      // ── Share & Report ──
      if (!isAdmin && !isStaff) {
        items.push({
          path: "/share-hub",
          icon: Share2,
          fallbackLabel: "Share Hub",
          group: "More",
        });
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
      const key = item.path
        ? `path:${item.path}`
        : `label:${item.fallbackLabel}`;
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
    const label = item.labelKey
      ? t(item.labelKey, item.fallbackLabel)
      : item.fallbackLabel;
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
          <span
            className={`${textSize} leading-tight font-semibold tracking-normal`}
          >
            {label}
          </span>
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
        <span
          className={`${textSize} leading-tight font-semibold tracking-normal`}
        >
          {label}
        </span>
      </button>
    );
  };

  const renderDrawerItem = (item: NavItem) => {
    const label = item.labelKey
      ? t(item.labelKey, item.fallbackLabel)
      : item.fallbackLabel;
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
    const label = item.labelKey
      ? t(item.labelKey, item.fallbackLabel)
      : item.fallbackLabel;
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
          {sidebarOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
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
                <Link
                  href="/"
                  className="flex items-center gap-2"
                  onClick={() => setSidebarOpen(false)}
                >
                  <UtensilsCrossed className="w-6 h-6 text-orange-500" />
                  <span className="text-lg font-bold font-display tracking-tight">
                    MealScout
                  </span>
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
                      <p className="text-sm font-semibold truncate">
                        {user.firstName || user.email}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {user.email}
                      </p>
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
                          await fetch("/api/auth/logout", {
                            method: "POST",
                            credentials: "include",
                          });
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
                    aria-label={
                      item.labelKey
                        ? t(item.labelKey, item.fallbackLabel)
                        : item.fallbackLabel
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden lg:inline">
                      {item.labelKey
                        ? t(item.labelKey, item.fallbackLabel)
                        : item.fallbackLabel}
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
          MOBILE: Atmospheric floating bottom nav
          Layout: [slot1] [slot2] [Scout center-glow] [Share] [More]
          ═══════════════════════════════════════════════════════════════ */}
      {shouldShowMobileNav && (() => {
        const slot1 = topItems[0];
        const slot2 = topItems[1];
        const isActive = (path?: string) =>
          !!path && (path === "/" ? location === "/" : location.startsWith(path));
        const renderAtmoItem = (item: NavItem | undefined) => {
          if (!item) return <div className="flex-1" />;
          const Icon = item.icon;
          const active = isActive(item.path);
          const label = item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel;
          const content = (
            <>
              <Icon
                className={`w-5 h-5 transition-colors ${
                  active ? "text-amber-300" : "text-white/70"
                }`}
              />
              <span
                className={`text-[10px] leading-tight font-semibold tracking-wide transition-colors ${
                  active ? "text-amber-300" : "text-white/70"
                }`}
              >
                {label}
              </span>
            </>
          );
          const baseClass =
            "flex flex-1 flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl transition-colors";
          if (item.onClick) {
            return (
              <button
                key={item.fallbackLabel}
                onClick={item.onClick}
                className={baseClass}
                aria-label={label}
                aria-current={active ? "page" : undefined}
              >
                {content}
              </button>
            );
          }
          return (
            <Link
              key={item.fallbackLabel}
              href={item.path || "/"}
              className={baseClass}
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              {content}
            </Link>
          );
        };
        const scoutLabel = t(scoutItem.labelKey!, scoutItem.fallbackLabel);
        const scoutActive = isActive(scoutItem.path);
        const ScoutIcon = scoutItem.icon;
        return (
          <div className="fixed inset-x-0 bottom-0 z-[1100] lg:hidden pointer-events-none">
            <div className="px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
              <nav
                className="atmo-glass pointer-events-auto relative mx-auto flex max-w-md items-end justify-between rounded-[28px] px-3 pt-2 pb-2.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]"
                aria-label="Primary"
              >
                {/* Slot 1 (Explore) */}
                {renderAtmoItem(slot1)}
                {/* Slot 2 (role action) */}
                {renderAtmoItem(slot2)}

                {/* Center: Scout glow button (raised) */}
                <div className="flex flex-1 flex-col items-center justify-end -mt-7">
                  <Link
                    href={scoutItem.path!}
                    aria-label={scoutLabel}
                    aria-current={scoutActive ? "page" : undefined}
                    className="atmo-glow-amber group relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-amber-400 to-amber-600 ring-4 ring-black/40 transition-transform active:scale-95"
                  >
                    <ScoutIcon className="h-7 w-7 text-black" />
                  </Link>
                  <span
                    className={`mt-1 text-[10px] font-semibold tracking-wide ${
                      scoutActive ? "text-amber-300" : "text-white/80"
                    }`}
                  >
                    {scoutLabel}
                  </span>
                </div>

                {/* Share */}
                <button
                  onClick={handleShare}
                  className="flex flex-1 flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl transition-colors"
                  aria-label="Share"
                >
                  <Share2 className="w-5 h-5 text-white/70" />
                  <span className="text-[10px] font-semibold tracking-wide text-white/70">
                    {t("nav.share", "Share")}
                  </span>
                </button>

                {/* More */}
                <button
                  onClick={() => setMoreOpen(true)}
                  className="flex flex-1 flex-col items-center justify-center gap-1 min-h-[56px] rounded-xl transition-colors"
                  aria-label="More"
                  aria-expanded={moreOpen}
                >
                  <MoreHorizontal
                    className={`w-5 h-5 ${moreOpen ? "text-amber-300" : "text-white/70"}`}
                  />
                  <span
                    className={`text-[10px] font-semibold tracking-wide ${
                      moreOpen ? "text-amber-300" : "text-white/70"
                    }`}
                  >
                    More
                  </span>
                </button>
              </nav>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════
          MOBILE: "More" drawer
          ═══════════════════════════════════════════════════════════════ */}
      {shouldShowMobileNav && (
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
                        await fetch("/api/auth/logout", {
                          method: "POST",
                          credentials: "include",
                        });
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
      )}
    </>
  );
}
