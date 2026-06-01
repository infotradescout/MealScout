import { useState, useEffect, useRef, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  User,
  Store,
  BarChart3,
  UserPlus,
  Clapperboard,
  Bug,
  Shield,
  Users,
  Calendar,
  LayoutDashboard,
  ParkingSquare,
  Truck,
  Share2,
  ChefHat,
  Package,
  ShoppingCart,
  Tag,
  MoreHorizontal,
  X,
  Compass,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";
import LongPressHelp from "@/components/long-press-help";

type NavItem = {
  path?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  isBug?: boolean;
};

type NavigationProps = {
  scope?: "global" | "local";
};

const NAV_HELP: Record<string, string> = {
  Scout: "Find food trucks, restaurants, deals, and local food options near you.",
  Deals: "Find or create local food deals based on your account type.",
  "Parking Pass": "Food trucks use this to book approved host parking spots.",
  Profile: "Manage your account, saved items, and business setup.",
  More: "Open additional tools and pages for your account role.",
  "Admin Dashboard": "Use admin tools to manage users, businesses, and platform operations.",
};

let hasGlobalNavigation = false;

export default function Navigation({ scope = "local" }: NavigationProps) {
  const isGlobalScope = scope === "global";
  const [showLocalNav, setShowLocalNav] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [location] = useLocation();
  const currentPath = location.split("?")[0];
  const { user } = useAuth();
  const { toast } = useToast();
  const [isReporting, setIsReporting] = useState(false);
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

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
      await apiRequest("POST", "/api/bug-report", {
        screenshot,
        currentUrl: window.location.href,
        userAgent: navigator.userAgent,
      });
      toast({
        title: t("toast.bugSentTitle", "Bug report sent!"),
        description: t(
          "toast.bugSentDescription",
          "Thank you for helping us improve MealScout.",
        ),
      });
    } catch {
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

  const isRestaurantOwner = user?.userType === "restaurant_owner";
  const isFoodTruck = user?.userType === "food_truck";
  const isSupplier = user?.userType === "supplier";
  const isAdmin =
    user?.userType === "admin" ||
    user?.userType === "duper_admin" ||
    user?.userType === "super_admin";
  const isStaff = user?.userType === "staff";
  const isEventCoordinator = user?.userType === "event_coordinator";
  const businessOnboardingRequired = user?.businessOnboardingRequired === true;
  const businessOnboardingPath =
    user?.businessOnboardingPath ||
    (isFoodTruck
      ? "/restaurant-signup?businessType=food_truck&source=navigation&claim=1"
      : "/restaurant-signup?businessType=restaurant&source=navigation&claim=1");

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
  const isBusinessOperator =
    isFoodTruck || isRestaurantOwner || hasBusinessTeamAccess;

  const [isHost, setIsHost] = useState(false);
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
        if (!cancelled) setIsHost(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isWheelPage = location.startsWith("/admin/giveaway-wheel");
  const [isDocFullscreen, setIsDocFullscreen] = useState(false);
  const [isScoutMapFullscreen, setIsScoutMapFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsDocFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  useEffect(() => {
    const update = () =>
      setIsScoutMapFullscreen(
        document.body.classList.contains("mealscout-map-fullscreen"),
      );
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  if (isGlobalScope && !user && currentPath === "/") return null;
  if (isWheelPage || isDocFullscreen || isScoutMapFullscreen) return null;
  if (!isGlobalScope && !showLocalNav) return null;

  const dashboardPath = !user
    ? "/customer-signup"
    : "/dashboard";
  const isScoutRoute =
    currentPath === "/scout" || currentPath.startsWith("/scout/");
  const disableScoutHelpBubbles = isScoutRoute;

  const lane: "guest" | "admin_staff" | "event" | "supplier" | "food_truck" | "restaurant" | "host" | "customer" =
    !user
      ? "guest"
      : isAdmin || isStaff
        ? "admin_staff"
        : isEventCoordinator
          ? "event"
          : isSupplier
            ? "supplier"
            : isFoodTruck
              ? "food_truck"
              : isRestaurantOwner || hasBusinessTeamAccess
                ? "restaurant"
                : isHost
                  ? "host"
                  : "customer";
  const isRestaurantHostCapable = lane === "restaurant" && isHost;

  const primarySlotsByLane: Record<typeof lane, NavItem[]> = {
    guest: [
      { path: "/video", icon: Clapperboard, label: "Video" },
      { path: "/events", icon: Calendar, label: "Events" },
      { path: "/customer-signup", icon: UserPlus, label: "Join" },
    ],
    customer: [
      { path: "/video", icon: Clapperboard, label: "Video" },
      { path: "/events", icon: Calendar, label: "Events" },
      { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ],
    food_truck: [
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: Store, label: "Set Up" }
        : { path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" },
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: UserPlus, label: "Claim" }
        : { path: "/orders", icon: ShoppingCart, label: "Orders" },
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: Truck, label: "Truck" }
        : { path: "/kitchen", icon: ChefHat, label: "Kitchen" },
    ],
    restaurant: [
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: Store, label: "Set Up" }
        : isRestaurantHostCapable
          ? { path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" }
          : { path: "/orders", icon: ShoppingCart, label: "Orders" },
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: UserPlus, label: "Claim" }
        : { path: "/kitchen", icon: ChefHat, label: "Kitchen" },
      businessOnboardingRequired
        ? { path: businessOnboardingPath, icon: LayoutDashboard, label: "Finish" }
        : { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ],
    host: [
      { path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" },
      { path: "/video", icon: Clapperboard, label: "Video" },
      { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ],
    event: [
      { path: "/events", icon: Calendar, label: "Events" },
      {
        path: "/event-coordinator/dashboard?tab=requests",
        icon: Package,
        label: "Requests",
      },
      { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ],
    supplier: [
      { path: "/supply/orders", icon: ShoppingCart, label: "Orders" },
      { path: "/suppliers", icon: Package, label: "Products" },
      { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ],
    admin_staff: [
      { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
      { path: "/admin/control-center", icon: Shield, label: "Control" },
      {
        path: isAdmin ? "/admin/geo/heatmap" : "/staff",
        icon: BarChart3,
        label: isAdmin ? "Reports" : "Staff",
      },
    ],
  };

  const basePrimary = primarySlotsByLane[lane];
  const sixSlotNav: NavItem[] = [
    { path: "/scout", icon: Compass, label: "Scout" },
    basePrimary[0],
    basePrimary[1],
    basePrimary[2],
    { path: "/share-hub", icon: Share2, label: "Share" },
    { icon: MoreHorizontal, label: "More", onClick: () => setMoreOpen((v) => !v) },
  ];

  const dedupeByPath = (items: NavItem[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item.path) return true;
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  };

  const buildMoreItems = (): NavItem[] => {
    const items: NavItem[] = [];

    if (lane === "guest") {
      items.push(
        { path: "/login", icon: User, label: "Log In" },
        { path: "/customer-signup", icon: UserPlus, label: "Join" },
      );
    } else if (lane === "customer") {
      items.push(
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (lane === "food_truck") {
      items.push(
        { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
        { path: "/parking-pass", icon: ParkingSquare, label: "Schedule" },
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/suppliers", icon: Truck, label: "Suppliers" },
        { path: "/subscribe", icon: BarChart3, label: "Subscription" },
        { path: "/restaurant-owner-dashboard", icon: BarChart3, label: "Reports" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (lane === "restaurant") {
      items.push(
        ...(isRestaurantHostCapable
          ? [{ path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" } as NavItem]
          : []),
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/suppliers", icon: Truck, label: "Suppliers" },
        { path: "/subscribe", icon: BarChart3, label: "Subscription" },
        { path: "/restaurant-owner-dashboard", icon: BarChart3, label: "Reports" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (lane === "host") {
      items.push(
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (lane === "event") {
      items.push(
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (lane === "supplier") {
      items.push(
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/supplier/dashboard", icon: BarChart3, label: "Reports" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else {
      items.push(
        { path: "/admin/dashboard", icon: Shield, label: "Admin Dashboard" },
        { path: "/staff", icon: Users, label: "Staff" },
        { path: "/admin/control-center", icon: Shield, label: "Control Center" },
        { path: "/admin/geo/heatmap", icon: BarChart3, label: "Geo Heatmap" },
        { path: "/admin/dashboard?tab=restaurants", icon: Store, label: "Businesses" },
        { path: "/admin/dashboard?tab=trucks", icon: Truck, label: "Food Trucks" },
        { path: "/admin/dashboard?tab=hosts", icon: ParkingSquare, label: "Hosts" },
        { path: "/admin/dashboard?tab=events", icon: Calendar, label: "Events" },
        { path: "/parking-pass", icon: ParkingSquare, label: "Parking Pass" },
        { path: "/deal-creation", icon: Tag, label: "Deals" },
        { path: "/orders", icon: ShoppingCart, label: "Orders" },
        { path: "/admin/dashboard?tab=users", icon: UserPlus, label: "Users" },
        { path: "/admin/giveaway-wheel", icon: Clapperboard, label: "Giveaway Wheel" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    }

    items.push({
      label: isReporting ? "Sending..." : "Report Bug",
      icon: Bug,
      onClick: handleBugReport,
      isBug: true,
    });

    return dedupeByPath(items);
  };

  const moreItems = buildMoreItems();
  const isActive = (path: string) =>
    location === path || location.startsWith(`${path}/`) || location.startsWith(`${path}?`);

  const buildOwnerToolHref = (destination: string) => {
    try {
      const url = new URL(destination, window.location.origin);
      const current = new URL(window.location.href);
      const isLeavingOwnerDashboard =
        current.pathname.startsWith("/restaurant-owner-dashboard") &&
        !url.pathname.startsWith("/restaurant-owner-dashboard");
      if (!isLeavingOwnerDashboard) return destination;
      ["setup", "ref", "setupStep", "setupPanel", "onboarding"].forEach((key) =>
        url.searchParams.delete(key),
      );
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return destination;
    }
  };

  return (
    <>
      <div
        data-nav-root={scope}
        className="hidden lg:block fixed top-6 right-6 z-50"
      >
        <div className="rounded-2xl border border-white/5 bg-[#120805]/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-2">
          <div className="flex items-center gap-1">
            {sixSlotNav.map((item, idx) =>
              item.path ? (
                <LongPressHelp
                  disabled={disableScoutHelpBubbles}
                  key={`${item.path}-${idx}`}
                  description={NAV_HELP[item.label] || `${item.label} navigation`}
                >
                  <Link
                    href={buildOwnerToolHref(item.path)}
                    className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold transition-all ${
                      isActive(item.path)
                        ? "bg-primary text-[#1a0d08] shadow-[0_0_20px_rgba(255,90,47,0.4)]"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                    aria-label={item.label}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden lg:inline uppercase tracking-wider text-[11px]">
                      {item.label}
                    </span>
                  </Link>
                </LongPressHelp>
              ) : (
                <LongPressHelp
                  disabled={disableScoutHelpBubbles}
                  key={`more-${idx}`}
                  description={NAV_HELP[item.label] || `${item.label} options`}
                >
                  <button
                    type="button"
                    aria-label={item.label}
                    aria-expanded={moreOpen}
                    onClick={item.onClick}
                    className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold transition-all ${
                      moreOpen
                        ? "bg-primary text-[#1a0d08] shadow-[0_0_20px_rgba(255,90,47,0.4)]"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden lg:inline uppercase tracking-wider text-[11px]">
                      {item.label}
                    </span>
                  </button>
                </LongPressHelp>
              ),
            )}
          </div>
        </div>
      </div>

      <nav
        aria-label="Primary navigation"
        className="fixed left-0 right-0 z-[1100] lg:hidden"
        style={{ bottom: 0 }}
      >
        <div className="w-full px-0">
          <div
            className="relative flex items-end justify-between gap-1 h-[58px] px-1.5 rounded-none border-t border-orange-500/20 bg-[#0b0b0b] pb-[env(safe-area-inset-bottom)]"
            style={{
              boxShadow: "0 -8px 22px rgba(0,0,0,0.42)",
            }}
          >
            {sixSlotNav.map((item, index) => {
              const isPrimary = index === 0;
              const active = item.path ? isActive(item.path) : moreOpen;

              if (item.path) {
                return (
                  <LongPressHelp
                    disabled={disableScoutHelpBubbles}
                    key={`${item.path}-${index}`}
                    description={NAV_HELP[item.label] || `${item.label} navigation`}
                  >
                    <Link
                      href={buildOwnerToolHref(item.path)}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full transition-colors ${isPrimary ? "pb-0.5" : "pb-1"} ${
                        active ? "text-orange-300" : "text-white/70 hover:text-white"
                      }`}
                    >
                      {isPrimary ? (
                        <span
                          className="flex h-8.5 w-8.5 items-center justify-center rounded-full bg-[#120805]/70 ring-[1.5px] ring-orange-500/90 -mt-3"
                          style={{
                            boxShadow:
                              "0 0 0 2px rgba(255,90,47,0.13), 0 0 12px rgba(255,90,47,0.26)",
                          }}
                          aria-hidden="true"
                        >
                          <item.icon className="h-4.5 w-4.5 text-orange-300" />
                        </span>
                      ) : (
                        <item.icon className="h-4.5 w-4.5" aria-hidden="true" />
                      )}
                      <span className="text-[9px] font-medium truncate max-w-full leading-none">{item.label}</span>
                    </Link>
                  </LongPressHelp>
                );
              }

              return (
                <LongPressHelp
                  disabled={disableScoutHelpBubbles}
                  key={`more-${index}`}
                  description={NAV_HELP[item.label] || `${item.label} options`}
                >
                  <button
                    type="button"
                    aria-label={item.label}
                    aria-expanded={moreOpen}
                    onClick={item.onClick}
                    className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-1 transition-colors ${
                      moreOpen ? "text-orange-300" : "text-white/70 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-4.5 w-4.5" aria-hidden="true" />
                    <span className="text-[9px] font-medium leading-none">{item.label}</span>
                  </button>
                </LongPressHelp>
              );
            })}
          </div>
        </div>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-[1090]"
          aria-modal="true"
          role="dialog"
          aria-label="More options"
        >
          <div
            className="absolute inset-0 bg-[#120805]/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            className="absolute left-0 right-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] mx-4 rounded-3xl bg-[#120805]/80 backdrop-blur-2xl border border-white/10 shadow-[0_-16px_48px_rgba(0,0,0,0.7)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
                More
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="text-white/40 hover:text-white transition-colors p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-0 pb-4 px-2">
              {moreItems.map((item) => {
                const active = item.path ? isActive(item.path) : false;
                const inner = (
                  <>
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-2xl mb-1 transition-all ${
                        active
                          ? "bg-primary/20 ring-1 ring-primary/40"
                          : item.isBug
                            ? "bg-primary/10"
                            : "bg-white/5"
                      }`}
                      aria-hidden="true"
                    >
                      <item.icon
                        className={`h-5 w-5 ${
                          active
                            ? "text-orange-300"
                            : item.isBug
                              ? "text-primary animate-pulse"
                              : "text-white/70"
                        }`}
                      />
                    </span>
                    <span
                      className={`text-[10px] font-medium text-center leading-tight ${
                        active ? "text-orange-300" : "text-white/60"
                      }`}
                    >
                      {item.label}
                    </span>
                  </>
                );

                return item.path ? (
                  <Link
                    key={item.path}
                    href={buildOwnerToolHref(item.path)}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className="flex flex-col items-center justify-start pt-3 px-1 rounded-2xl hover:bg-white/5 transition-colors"
                    onClick={() => setMoreOpen(false)}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      item.onClick?.();
                      setMoreOpen(false);
                    }}
                    disabled={isReporting}
                    aria-label={item.label}
                    className="flex flex-col items-center justify-start pt-3 px-1 rounded-2xl hover:bg-white/5 transition-colors disabled:opacity-60"
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
