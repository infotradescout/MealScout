import { useState, useEffect, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
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
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";

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
};

type NavigationProps = {
  scope?: "global" | "local";
};

let hasGlobalNavigation = false;

export default function Navigation({ scope = "local" }: NavigationProps) {
  const isGlobalScope = scope === "global";
  const [showLocalNav, setShowLocalNav] = useState(true);
  const [location] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isReporting, setIsReporting] = useState(false);
  const { t } = useI18n();

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
      // Lazy load html2canvas only when needed (don't bundle it in main app)
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

  // Check user role
  const isRestaurantOwner = user && user.userType === "restaurant_owner";
  const isFoodTruck = user && user.userType === "food_truck";
  const isSupplier = user && user.userType === "supplier";
  const isAdmin =
    user && (user.userType === "admin" || user.userType === "super_admin");
  const isStaff = user && user.userType === "staff";
  const isEventCoordinator = user && user.userType === "event_coordinator";

  const [isHost, setIsHost] = useState(false);
  const canSeeParkingPassNav =
    isAdmin || isStaff || isFoodTruck || isRestaurantOwner || isHost;

  // Detect if this user has a host profile so we can show host flows
  useEffect(() => {
    if (!user) {
      setIsHost(false);
      return;
    }

    let cancelled = false;
    // Use list endpoint so users without a host profile don't generate noisy 404s.
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

  // Debug logging (development only)
  if (user && typeof window !== "undefined" && import.meta.env.DEV) {
    console.log("🔍 Navigation User Debug:", {
      email: user.email,
      userType: user.userType,
      isAdmin,
      isStaff,
      isRestaurantOwner,
      isEventCoordinator,
      isHost,
    });
  }
  // Shared core nav: Food (home), Map, Video, Profile (only when logged in)
  const sharedNavItems: NavItem[] = [
    { path: "/", icon: UtensilsCrossed, labelKey: "nav.food", fallbackLabel: "Food" },
    { path: "/map", icon: MapPin, labelKey: "nav.map", fallbackLabel: "Map" },
    ...(user && canSeeParkingPassNav
      ? ([
          {
            path: "/parking-pass",
            icon: ParkingSquare,
            labelKey: "nav.parkingPass",
            fallbackLabel: "Parking Pass",
          },
        ] as NavItem[])
      : []),
    { path: "/video", icon: Clapperboard, labelKey: "nav.video", fallbackLabel: "Video" },
    ...(user
      ? ([{ path: "/profile", icon: User, labelKey: "nav.profile", fallbackLabel: "Profile" }] as NavItem[])
      : []),
    ...(user && !isAdmin && !isStaff
      ? ([{
          path: "/share-hub",
          icon: Share2,
          labelKey: "nav.share",
          fallbackLabel: "Share",
        }] as NavItem[])
      : []),
  ];

  const customerExtras: NavItem[] = [
    {
      path: "/dashboard",
      icon: LayoutDashboard,
      labelKey: "nav.dashboard",
      fallbackLabel: "Dashboard",
    },
    { path: "/favorites", icon: Heart, labelKey: "nav.favorites", fallbackLabel: "Favorites" },
  ];

  const unauthenticatedExtras: NavItem[] = [
    {
      path: "/customer-signup",
      icon: UserPlus,
      labelKey: "nav.createAccount",
      fallbackLabel: "Create Account",
    },
    {
      path: "/restaurant-signup?businessType=food_truck&claim=1",
      icon: Truck,
      labelKey: "nav.claimTruck",
      fallbackLabel: "Claim Truck",
    },
  ];

  // Host-specific flows: dashboard + host marketing and discovery
  const hostExtras: NavItem[] = [
    { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
    { path: "/host/dashboard", icon: Users, labelKey: "nav.host", fallbackLabel: "Host" },
    {
      path: "/for-restaurants",
      icon: Store,
      labelKey: "nav.forRestaurants",
      fallbackLabel: "For Restaurants",
    },
    { path: "/for-bars", icon: Store, labelKey: "nav.forBars", fallbackLabel: "For Bars" },
  ];

  // Staff should be able to jump into every major website flow
  // Including all business types (restaurant, food truck, bar), host, and event coordinator capabilities
  const staffExtras: NavItem[] = [
    { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
    { path: "/staff", icon: Users, labelKey: "nav.staff", fallbackLabel: "Staff" },
    { path: "/host/dashboard", icon: Users, labelKey: "nav.host", fallbackLabel: "Host" },
    {
      path: "/restaurant-owner-dashboard",
      icon: Store,
      labelKey: "nav.dashboard",
      fallbackLabel: "Dashboard",
    },
    {
      path: "/deal-creation",
      icon: Plus,
      labelKey: "nav.createSpecial",
      fallbackLabel: "Create Special",
    },
    {
      path: "/subscription",
      icon: BarChart3,
      labelKey: "nav.subscription",
      fallbackLabel: "Subscription",
    },
    {
      path: "/parking-pass",
      icon: ParkingSquare,
      labelKey: "nav.parkingPass",
      fallbackLabel: "Parking Pass",
    },
    {
      path: "/for-restaurants",
      icon: Store,
      labelKey: "nav.forRestaurants",
      fallbackLabel: "For Restaurants",
    },
    { path: "/for-bars", icon: Store, labelKey: "nav.forBars", fallbackLabel: "For Bars" },
    {
      path: "/deals/featured",
      icon: Receipt,
      labelKey: "nav.featuredSpecials",
      fallbackLabel: "Featured Specials",
    },
  ];

  const restaurantOwnerExtras: NavItem[] = [
    {
      path: "/dashboard",
      icon: LayoutDashboard,
      labelKey: "nav.dashboard",
      fallbackLabel: "Dashboard",
    },
    {
      path: "/deal-creation",
      icon: Plus,
      labelKey: "nav.createSpecial",
      fallbackLabel: "Create Special",
    },
    {
      path: "/subscription",
      icon: BarChart3,
      labelKey: "nav.subscription",
      fallbackLabel: "Subscription",
    },
    {
      path: "/business-team",
      icon: Users,
      fallbackLabel: "Team",
    },
    { path: "/suppliers", icon: Store, labelKey: "nav.supplies", fallbackLabel: "Supplies" },
  ];

  const bugNavItem: NavItem = {
    labelKey: "nav.report",
    fallbackLabel: "Report",
    icon: Bug,
    onClick: handleBugReport,
    isBug: true,
    testId: "report",
  };

  const mergeNavItems = (...groups: NavItem[][]): NavItem[] => {
    const seen = new Set<string>();
    const result: NavItem[] = [];
    for (const group of groups) {
      for (const item of group) {
        const key = item.path ? `path:${item.path}` : `label:${item.fallbackLabel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  };

  // Admins should see every flow including all business types, host, and event coordinator capabilities
  const adminNavItems: NavItem[] = mergeNavItems(sharedNavItems, [
    { path: "/admin/dashboard", icon: Shield, labelKey: "nav.admin", fallbackLabel: "Admin" },
    {
      path: "/admin/control-center",
      icon: LayoutDashboard,
      labelKey: "nav.controlCenter",
      fallbackLabel: "Control Center",
    },
    {
      path: "/admin/affiliates",
      icon: Users,
      labelKey: "nav.affiliates",
      fallbackLabel: "Affiliates",
    },
    { path: "/staff", icon: Users, labelKey: "nav.staff", fallbackLabel: "Staff" },
    { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
    { path: "/host/dashboard", icon: Users, labelKey: "nav.host", fallbackLabel: "Host" },
    ...restaurantOwnerExtras,
    {
      path: "/parking-pass",
      icon: ParkingSquare,
      labelKey: "nav.parkingPass",
      fallbackLabel: "Parking Pass",
    },
    ...customerExtras,
  ]);

  const customerNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    customerExtras,
  );

  const unauthenticatedNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    unauthenticatedExtras,
  );

  const staffNavItems: NavItem[] = mergeNavItems(sharedNavItems, staffExtras);

  const restaurantOwnerNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    restaurantOwnerExtras,
  );

  const hostNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    customerExtras,
    hostExtras,
    canSeeParkingPassNav
      ? ([
          {
            path: "/parking-pass",
            icon: ParkingSquare,
            labelKey: "nav.parkingPass",
            fallbackLabel: "Parking Pass",
          },
        ] as NavItem[])
      : [],
  );

  const eventCoordinatorExtras: NavItem[] = [
    { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
    {
      path: "/dashboard",
      icon: LayoutDashboard,
      labelKey: "nav.dashboard",
      fallbackLabel: "Dashboard",
    },
  ];

  const eventCoordinatorNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    eventCoordinatorExtras,
  );

  const foodTruckNavItems: NavItem[] = mergeNavItems(
    sharedNavItems,
    customerExtras,
    [
      { path: "/events", icon: Calendar, labelKey: "nav.events", fallbackLabel: "Events" },
      { path: "/suppliers", icon: Store, labelKey: "nav.supplies", fallbackLabel: "Supplies" },
      { path: "/business-team", icon: Users, fallbackLabel: "Team" },
      ...(canSeeParkingPassNav
        ? ([
            {
              path: "/parking-pass",
              icon: ParkingSquare,
              labelKey: "nav.parkingPass",
              fallbackLabel: "Parking Pass",
            },
          ] as NavItem[])
        : []),
    ],
  );

  const supplierExtras: NavItem[] = [
    {
      path: "/supplier/dashboard",
      icon: LayoutDashboard,
      labelKey: "nav.dashboard",
      fallbackLabel: "Dashboard",
    },
  ];
  const supplierNavItems: NavItem[] = mergeNavItems(sharedNavItems, supplierExtras);

  const navItems = !user
    ? [...unauthenticatedNavItems, bugNavItem]
    : isAdmin
      ? [...adminNavItems, bugNavItem]
      : isStaff
        ? [...staffNavItems, bugNavItem]
        : isEventCoordinator
          ? [...eventCoordinatorNavItems, bugNavItem]
          : isSupplier
            ? [...supplierNavItems, bugNavItem]
          : isFoodTruck
            ? [...foodTruckNavItems, bugNavItem]
            : isRestaurantOwner
              ? [...restaurantOwnerNavItems, bugNavItem]
              : isHost
                ? [...hostNavItems, bugNavItem]
              : [...customerNavItems, bugNavItem];

  const desktopQuickActionPaths = [
    "/search",
    "/map",
    "/events",
    "/dashboard",
    "/profile",
    "/admin/dashboard",
    "/staff",
    "/host/dashboard",
    "/supplier/dashboard",
  ];
  const desktopQuickActions = navItems
    .filter((item) => item.path && desktopQuickActionPaths.includes(item.path))
    .slice(0, 5);

  return (
    <>
      <div data-nav-root={scope} className="hidden lg:block fixed top-4 right-4 z-50">
        <div className="rounded-2xl border border-white/20 bg-[hsl(var(--background))/0.82] backdrop-blur-xl shadow-clean-lg p-2">
          <div className="flex items-center gap-2">
            {desktopQuickActions.map((item) =>
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
          </div>
        </div>
      </div>

      <nav className="nav-bar nav-bar-mobile fixed bottom-0 left-0 right-0 w-full border-t px-3 pt-2 pb-[calc(0.45rem+env(safe-area-inset-bottom))] z-[1100] lg:hidden">
      <div className="w-full mx-auto overflow-x-auto max-w-none">
        <div className="flex items-stretch justify-start space-x-2 min-w-max snap-x snap-mandatory">
          {navItems.map((item) =>
            item.path ? (
              <Link
                key={item.path}
                href={item.path}
                className={`nav-link snap-start min-h-[56px] min-w-[72px] flex flex-col items-center justify-center space-y-1 px-2 rounded-xl transition-colors duration-200 ${
                  location === item.path ? "nav-link--active" : "nav-link--inactive"
                }`}
                data-testid={`nav-${(item.testId ?? item.fallbackLabel).toLowerCase()}`}
                aria-label={item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
                aria-current={location === item.path ? "page" : undefined}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[11px] leading-tight font-semibold tracking-normal">
                  {item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
                </span>
              </Link>
            ) : (
              <button
                key={item.fallbackLabel}
                onClick={item.onClick}
                disabled={isReporting}
                className={`nav-link snap-start min-h-[56px] min-w-[72px] flex flex-col items-center justify-center space-y-1 px-2 rounded-xl transition-colors duration-200 ${
                  item.isBug ? "nav-bug" : "nav-link--inactive"
                } ${isReporting ? "opacity-80 cursor-not-allowed" : ""}`}
                data-testid={`nav-${(item.testId ?? item.fallbackLabel).toLowerCase()}`}
                aria-label={item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
              >
                {isReporting ? (
                  <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <item.icon className="w-5 h-5" />
                )}
                <span className="text-[11px] leading-tight font-semibold tracking-normal">
                  {item.labelKey ? t(item.labelKey, item.fallbackLabel) : item.fallbackLabel}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
    </nav>
    </>
  );
}

