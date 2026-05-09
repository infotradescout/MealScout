import { useState, useEffect, useRef, type ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  User,
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
  Heart,
  Receipt,
  X,
  Compass,
  Bell,
  Bookmark,
  Home,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useI18n } from "@/lib/i18n";

type NavItem = {
  path?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
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

  // Close more sheet on route change
  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

  // Close more sheet on outside click
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
        description: t("toast.bugSentDescription", "Thank you for helping us improve MealScout."),
      });
    } catch {
      toast({
        title: t("toast.bugFailedTitle", "Failed to send report"),
        description: t("toast.bugFailedDescription", "Please try again or contact support."),
        variant: "destructive",
      });
    } finally {
      setIsReporting(false);
    }
  };

  // Role checks
  const isRestaurantOwner = user?.userType === "restaurant_owner";
  const isFoodTruck = user?.userType === "food_truck";
  const isSupplier = user?.userType === "supplier";
  const isAdmin = user?.userType === "admin" || user?.userType === "super_admin";
  const isStaff = user?.userType === "staff";
  const isEventCoordinator = user?.userType === "event_coordinator";

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
    isAdmin || isStaff || isRestaurantOwner || isFoodTruck ||
    businessAccess?.permissions?.manageDeals === true;

  const [isHost, setIsHost] = useState(false);
  useEffect(() => {
    if (!user) { setIsHost(false); return; }
    let cancelled = false;
    fetch("/api/hosts")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setIsHost(false); return; }
        const hosts = await res.json().catch(() => []);
        setIsHost(Array.isArray(hosts) && hosts.length > 0);
      })
      .catch(() => { if (!cancelled) setIsHost(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Hide nav on giveaway wheel page — record mode and fullscreen are handled
  // inside the wheel itself; the global nav must not overlay the wheel canvas.
  const isWheelPage = location.startsWith("/admin/giveaway-wheel");
  const [isDocFullscreen, setIsDocFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsDocFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  if (isGlobalScope && !user && currentPath === "/") return null;
  if (isWheelPage || isDocFullscreen) return null;

  if (!isGlobalScope && !showLocalNav) return null;

  // ── DASHBOARD path per role ──────────────────────────────────────────────
  const dashboardPath = !user
    ? "/customer-signup"
    : isAdmin
    ? "/admin/dashboard"
    : isStaff
    ? "/staff"
    : isEventCoordinator
    ? "/event-coordinator/dashboard"
    : isSupplier
    ? "/supplier/dashboard"
    : isFoodTruck || isRestaurantOwner || hasBusinessTeamAccess
    ? "/restaurant-owner-dashboard"
    : isHost
    ? "/host/dashboard"
    : "/scout";

  // ── USER-SPECIFIC slot (3rd item in desktop bar) ─────────────────────────
  // This must be a DIFFERENT destination from dashboardPath to avoid duplicates.
  const userSpecificItem: NavItem = !user
    ? { path: "/customer-signup", icon: UserPlus, label: "Join" }
    : isAdmin || isStaff
    ? { path: "/admin/control-center", icon: Shield, label: "Control" }
    : isEventCoordinator
    ? { path: "/events", icon: Calendar, label: "Events" }
    : isSupplier
    ? { path: "/supply/orders", icon: Package, label: "Orders" }
    : isFoodTruck || isRestaurantOwner || hasBusinessTeamAccess
    ? canManageDeals
      ? { path: "/deal-creation", icon: Plus, label: "Deals" }
      : { path: "/restaurant-owner-dashboard", icon: Store, label: "Business" }
    : isHost
    ? { path: "/events", icon: Calendar, label: "Events" }
    : { path: "/favorites", icon: Bookmark, label: "Saved" };

  // ── MORE sheet items (everything not in the 5-item bar) ──────────────────
  const buildMoreItems = (): NavItem[] => {
    const items: NavItem[] = [];

    if (!user) {
      items.push(
        { path: "/", icon: Home, label: "Home" },
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/login", icon: User, label: "Log In" },
      );
    } else if (isAdmin || isStaff) {
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/admin/dashboard", icon: Shield, label: "Admin" },
        { path: "/staff", icon: Users, label: "Staff" },
        { path: "/restaurant-owner-dashboard", icon: Store, label: "Restaurant" },
        { path: "/host/dashboard", icon: Users, label: "Host" },
        { path: "/parking-pass", icon: ParkingSquare, label: "Parking" },
        { path: "/deals/featured", icon: Receipt, label: "Featured Deals" },
        { path: "/admin/giveaway-wheel", icon: LayoutDashboard, label: "Giveaway Wheel" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (isEventCoordinator) {
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/event-coordinator/dashboard", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (isSupplier) {
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/supplier/dashboard", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (isFoodTruck || isRestaurantOwner || hasBusinessTeamAccess) {
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/parking-pass", icon: ParkingSquare, label: "Parking" },
        { path: "/menu-builder", icon: Store, label: "Menu Builder" },
        { path: "/kitchen", icon: ChefHat, label: "Kitchen" },
        { path: "/orders", icon: ShoppingCart, label: "Orders" },
        { path: "/subscription", icon: BarChart3, label: "Subscription" },
        { path: "/events", icon: Calendar, label: "Events" },
        { path: "/suppliers", icon: Truck, label: "Supplies" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else if (isHost) {
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/host/dashboard", icon: Users, label: "Host" },
        { path: "/parking-pass", icon: ParkingSquare, label: "Parking" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    } else {
      // Regular customer
      items.push(
        { path: "/scout", icon: Compass, label: "Scout" },
        { path: "/video", icon: Clapperboard, label: "Video" },
        { path: "/favorites", icon: Heart, label: "Saved" },
        { path: "/alerts", icon: Bell, label: "Alerts" },
        { path: "/deals/featured", icon: Receipt, label: "Deals" },
        { path: "/profile", icon: User, label: "Profile" },
      );
    }

    items.push({
      label: isReporting ? "Sending…" : "Report Bug",
      icon: Bug,
      onClick: handleBugReport,
      isBug: true,
    });

    return items;
  };

  const moreItems = buildMoreItems();
  const isActive = (path: string) =>
    location === path || location.startsWith(`${path}/`);
  const isScoutExperience =
    isActive("/scout");

  // ── DESKTOP quick-action bar ─────────────────────────────────────────────
  // Deduplicate: if userSpecificItem points to the same path as dashboardPath,
  // omit it to avoid two nav items going to the same destination.
  const userSpecificIsUnique =
    !userSpecificItem.path || userSpecificItem.path !== dashboardPath;
  const scoutExperienceItems: NavItem[] = [
    { path: "/scout", icon: Compass, label: "Scout" },
    { path: "/favorites", icon: Heart, label: "Saved" },
    { path: "/deals/featured", icon: Receipt, label: "Deals" },
    { path: "/share-hub", icon: Share2, label: "Share" },
    { path: "/profile", icon: User, label: "Profile" },
  ];
  const defaultDesktopItems: NavItem[] = [
    { path: "/scout", icon: Compass, label: "Scout" },
    { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" },
    ...(userSpecificIsUnique ? [userSpecificItem] : []),
    { path: "/share-hub", icon: Share2, label: "Share" },
    { path: "/profile", icon: User, label: "Profile" },
  ];
  const dashboardIsScout = dashboardPath === "/scout";
  const desktopItems = isScoutExperience || dashboardIsScout
    ? scoutExperienceItems
    : defaultDesktopItems;
  const mobileSecondItem: NavItem = isScoutExperience || dashboardIsScout
    ? { path: "/favorites", icon: Heart, label: "Saved" }
    : { path: dashboardPath, icon: LayoutDashboard, label: "Dashboard" };
  const mobileThirdItem: NavItem = isScoutExperience || dashboardIsScout
    ? { path: "/deals/featured", icon: Receipt, label: "Deals" }
    : userSpecificItem;
  const showMobileThirdItem =
    Boolean(mobileThirdItem.path) &&
    (isScoutExperience || dashboardIsScout || userSpecificIsUnique);

  return (
    <>
      {/* Desktop top-right pill */}
      <div data-nav-root={scope} className="hidden lg:block fixed top-6 right-6 z-50">
        <div className="rounded-2xl border border-white/5 bg-[#120805]/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-2">
          <div className="flex items-center gap-1">
            {desktopItems.map((item) =>
              item.path ? (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition-all ${
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
              ) : null,
            )}
          </div>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Primary navigation"
        className="fixed left-0 right-0 z-[1100] lg:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <div className="mx-auto max-w-md px-4">
          <div
            className="relative flex items-end justify-between gap-1 h-[68px] px-3 rounded-full bg-[#120805]/65 backdrop-blur-xl ring-1 ring-white/10"
            style={{
              boxShadow: "0 0 0 1px rgba(255,90,47,0.10), 0 18px 48px rgba(0,0,0,0.65)",
            }}
          >
            {/* 1 — Scout (center raised) */}
            <Link
              href="/scout"
              aria-label="Scout"
              aria-current={isActive("/scout") ? "page" : undefined}
              className="flex flex-col items-center justify-end gap-1 flex-1 min-w-0 h-full pb-1 transition-transform active:scale-95"
            >
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#120805]/70 ring-2 ring-orange-500 -mt-6"
                style={{ boxShadow: "0 0 0 4px rgba(255,90,47,0.15), 0 0 24px rgba(255,90,47,0.35)" }}
                aria-hidden="true"
              >
                <Search className="h-5 w-5 text-orange-300" />
              </span>
              <span className="text-[11px] font-medium text-orange-300">Scout</span>
            </Link>

            {/* 2 — Scout-local secondary action, otherwise Dashboard */}
            <Link
              href={mobileSecondItem.path || "/scout"}
              aria-label={mobileSecondItem.label}
              aria-current={
                mobileSecondItem.path && isActive(mobileSecondItem.path)
                  ? "page"
                  : undefined
              }
              className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-2 transition-colors ${
                mobileSecondItem.path && isActive(mobileSecondItem.path)
                  ? "text-orange-300"
                  : "text-white/70 hover:text-white"
              }`}
            >
              <mobileSecondItem.icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{mobileSecondItem.label}</span>
            </Link>

            {/* 3 — Scout-local saved action, otherwise user-specific */}
            {showMobileThirdItem && mobileThirdItem.path ? (
              <Link
                href={mobileThirdItem.path}
                aria-label={mobileThirdItem.label}
                aria-current={isActive(mobileThirdItem.path) ? "page" : undefined}
                className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-2 transition-colors ${
                  isActive(mobileThirdItem.path) ? "text-orange-300" : "text-white/70 hover:text-white"
                }`}
              >
                <mobileThirdItem.icon className="h-5 w-5" aria-hidden="true" />
                <span className="text-[11px] font-medium">{mobileThirdItem.label}</span>
              </Link>
            ) : null}

            {/* 4 — Share */}
            <Link
              href="/share-hub"
              aria-label="Share"
              aria-current={isActive("/share-hub") ? "page" : undefined}
              className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-2 transition-colors ${
                isActive("/share-hub") ? "text-orange-300" : "text-white/70 hover:text-white"
              }`}
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px] font-medium">Share</span>
            </Link>

            {/* 5 — More */}
            <button
              type="button"
              aria-label="More navigation options"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className={`flex flex-col items-center justify-end gap-0.5 flex-1 min-w-0 h-full pb-2 transition-colors ${
                moreOpen ? "text-orange-300" : "text-white/70 hover:text-white"
              }`}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px] font-medium">More</span>
            </button>
          </div>
        </div>
      </nav>

      {/* More slide-up sheet */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[1090] lg:hidden"
          aria-modal="true"
          role="dialog"
          aria-label="More options"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-[#120805]/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          {/* Sheet */}
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
                          active ? "text-orange-300" : item.isBug ? "text-primary animate-pulse" : "text-white/70"
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
                    href={item.path}
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
                    onClick={() => { item.onClick?.(); setMoreOpen(false); }}
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
