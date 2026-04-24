import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BetaDisclaimer } from "@/components/beta-disclaimer";
import Navigation from "@/components/navigation";
import { apiUrl } from "@/lib/api";
import { TimeOfDayBackground } from "@/components/TimeOfDayBackground";
import { useToast } from "@/hooks/use-toast";

// Eager load only critical pages (home, login) - everything else lazy loads
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Home from "@/pages/home";

// Lazy load all other pages - they only download when the user navigates to them
const CustomerSignup = lazy(() => import("@/pages/customer-signup"));
const RestaurantSignup = lazy(() => import("@/pages/restaurant-signup"));
const CityLanding = lazy(() => import("@/pages/city-landing"));
const CityDiscoveryPage = lazy(() => import("@/pages/city-discovery"));
const DealCreation = lazy(() => import("@/pages/deal-creation"));
const DealEdit = lazy(() => import("@/pages/deal-edit"));
const DealDetail = lazy(() => import("@/pages/deal-detail"));
const Subscribe = lazy(() => import("@/pages/subscribe"));
const Search = lazy(() => import("@/pages/search"));
const MapPage = lazy(() => import("@/pages/map"));
const ReviewsPage = lazy(() => import("@/pages/reviews"));
const Favorites = lazy(() => import("@/pages/favorites"));
const Orders = lazy(() => import("@/pages/orders"));
const Profile = lazy(() => import("@/pages/profile"));
const AdminLogin = lazy(() => import("@/pages/admin-login"));
const AdminDashboard = lazy(() => import("@/pages/admin-dashboard"));
const StaffDashboard = lazy(() => import("@/pages/staff-dashboard"));
const AdminIncidents = lazy(() => import("@/pages/AdminIncidents"));
const AdminControlCenter = lazy(() => import("@/pages/AdminControlCenter"));
const AdminSupportTickets = lazy(() => import("@/pages/AdminSupportTickets"));
const AdminModerationEvents = lazy(
  () => import("@/pages/AdminModerationEvents"),
);
const AdminModerationVideos = lazy(
  () => import("@/pages/admin-moderation-videos"),
);
const AdminModerationMetrics = lazy(
  () => import("@/pages/admin-moderation-metrics"),
);
const AdminModerationAppeals = lazy(
  () => import("@/pages/admin-moderation-appeals"),
);
const ModerationQueue = lazy(() => import("@/pages/admin/ModerationQueue"));
const ReporterReputationPage = lazy(
  () => import("@/pages/ReporterReputationPage"),
);
const ModerationPolicy = lazy(() => import("@/pages/public/ModerationPolicy"));
const AdminAuditLogs = lazy(() => import("@/pages/AdminAuditLogs"));
const AdminVacLogs = lazy(() => import("@/pages/AdminVacLogs"));
const AdminTelemetry = lazy(() => import("@/pages/admin-telemetry"));
const AdminAffiliateManagement = lazy(
  () => import("@/pages/AdminAffiliateManagement"),
);
const AdminGeoAds = lazy(() => import("@/pages/admin-geo-ads"));
const AffiliateEarnings = lazy(() => import("@/pages/AffiliateEarnings"));
const EmptyCountyExperience = lazy(
  () => import("@/pages/EmptyCountyExperience"),
);
const CategoryPage = lazy(() => import("@/pages/category"));
const FeaturedDealsPage = lazy(() => import("@/pages/deals-featured"));
const DealsCityPage = lazy(() => import("@/pages/deals-city"));
const RestaurantDetail = lazy(() => import("@/pages/restaurant-detail"));
const LocationDetailPage = lazy(() => import("@/pages/location-detail"));
const LocationDiscoveryPage = lazy(() => import("@/pages/location-discovery"));
const NotificationsPage = lazy(() => import("@/pages/profile/notifications"));
const SettingsPage = lazy(() => import("@/pages/profile/settings"));
const AddressesPage = lazy(() => import("@/pages/profile/addresses"));
const PaymentMethodsPage = lazy(() => import("@/pages/profile/payment"));
const HelpSupportPage = lazy(() => import("@/pages/profile/help"));
const RestaurantOwnerDashboard = lazy(
  () => import("@/pages/restaurant-owner-dashboard"),
);
const EditRestaurantPage = lazy(() => import("@/pages/edit-restaurant"));
const UserDashboard = lazy(() => import("@/pages/user-dashboard"));
const DashboardSwitcher = lazy(() => import("@/components/dashboard-switcher"));
const TermsOfService = lazy(() => import("@/pages/terms-of-service"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const DataDeletion = lazy(() => import("@/pages/data-deletion"));
const About = lazy(() => import("@/pages/about"));
const ComparePage = lazy(() => import("@/pages/compare"));
const OnlineOrderingPlatformsPage = lazy(
  () => import("@/pages/online-ordering-platforms"),
);
const FAQ = lazy(() => import("@/pages/faq"));
const HowItWorks = lazy(() => import("@/pages/how-it-works"));
const Contact = lazy(() => import("@/pages/contact"));
const Sitemap = lazy(() => import("@/pages/sitemap"));
const InstallApp = lazy(() => import("@/pages/install"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const ResetPassword = lazy(() => import("@/pages/reset-password"));
const AccountSetup = lazy(() => import("@/pages/account-setup"));
const OAuthSetupGuide = lazy(() => import("@/pages/oauth-setup-guide"));
const GoldenPlateWinners = lazy(() => import("@/pages/golden-plate-winners"));
const ParkingPassPage = lazy(() => import("@/pages/parking-pass"));
const ParkingPassManage = lazy(() => import("@/pages/parking-pass-manage"));
const StatusPage = lazy(() => import("@/pages/status"));
const HostSignup = lazy(() => import("@/pages/host-signup"));
const HostDashboard = lazy(() => import("@/pages/host-dashboard"));
const DashboardRouter = lazy(() => import("@/pages/dashboard-router"));
const TruckDiscovery = lazy(() => import("@/pages/truck-discovery"));
const RequestTruck = lazy(() => import("@/pages/request-truck"));
const EventsRouter = lazy(() => import("@/pages/events-router"));
const EventDetailPage = lazy(() => import("@/pages/event-detail"));
const ForRestaurants = lazy(() => import("@/pages/for-restaurants"));
const ForBars = lazy(() => import("@/pages/for-bars"));
const ForHosts = lazy(() => import("@/pages/for-hosts"));
const HostLocationPartnerPage = lazy(
  () => import("@/pages/host-location-partner"),
);
const ForEvents = lazy(() => import("@/pages/for-events"));
const FindFood = lazy(() => import("@/pages/find-food"));
const VideoPage = lazy(() => import("@/pages/video"));
const VideoDetailPage = lazy(() => import("@/pages/video-detail"));
const ChangePassword = lazy(() => import("@/pages/change-password"));
const TruckLanding = lazy(() => import("@/pages/truck-landing"));
const ClaimTruckPage = lazy(() => import("@/pages/claim-truck"));
const SuppliersPage = lazy(() => import("@/pages/suppliers"));
const SupplierDetailPage = lazy(() => import("@/pages/supplier-detail"));
const SupplierDashboardPage = lazy(() => import("@/pages/supplier-dashboard"));
const SupplyOrdersPage = lazy(() => import("@/pages/supply-orders"));
const PublicProfilePage = lazy(() => import("@/pages/public-profile"));
const PensacolaSpots = lazy(() => import("@/pages/pensacola-spots"));
const PensacolaReport = lazy(() => import("@/pages/pensacola-report"));
const ShareHubPage = lazy(() => import("@/pages/share-hub-page"));
const BusinessTeamPage = lazy(() => import("@/pages/business-team"));
const BusinessTeamAcceptPage = lazy(
  () => import("@/pages/business-team-accept"),
);
const MenuBuilderPage = lazy(() => import("@/pages/menu-builder"));
const KitchenDisplayPage = lazy(() => import("@/pages/kitchen-display"));
const OnlineMenuPage = lazy(() => import("@/pages/online-menu"));
const PickupCheckoutPage = lazy(() => import("@/pages/pickup-checkout"));
const OrderConfirmationPage = lazy(() => import("@/pages/order-confirmation"));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
  </div>
);

const publicRoutePrefixes = [
  "/",
  "/login",
  "/customer-signup",
  "/restaurant-signup",
  "/claim-truck",
  "/deal-creation",
  "/deal/",
  "/search",
  "/map",
  "/video",
  "/category/",
  "/deals",
  "/restaurant/",
  "/terms-of-service",
  "/moderation-policy",
  "/privacy-policy",
  "/data-deletion",
  "/about",
  "/compare",
  "/online-ordering-platforms",
  "/faq",
  "/how-it-works",
  "/contact",
  "/install",
  "/host-signup",
  "/for-restaurants",
  "/for-bars",
  "/for-hosts",
  "/host-location-partner",
  "/for-events",
  "/find-food",
  "/events",
  "/food-trucks/",
  "/truck-landing",
  "/sitemap",
  "/status",
  "/golden-plate-winners",
  "/pensacola/spots",
  "/pensacola/report",
  "/p/",
  "/forgot-password",
  "/reset-password",
  "/change-password",
  "/account-setup",
  "/admin",
  "/business-team/accept",
  "/menu/",
  "/checkout/",
  "/order-confirmation/",
];

const isPublicPath = (path: string) =>
  publicRoutePrefixes.some((prefix) =>
    prefix === "/" ? path === "/" : path.startsWith(prefix),
  );

// Wrapper component to handle route props
function DashboardSwitcherPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const view = urlParams.get("view") as "admin" | "user" | "restaurant" | null;
  return <DashboardSwitcher defaultView={view || "admin"} />;
}

function Router() {
  const { authState, isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const shownAnnouncementRef = useRef<string>("");
  const [location] = useLocation();
  const [affiliateTag, setAffiliateTag] = useState<string>("");
  const isLikelyPublicRoute = isPublicPath(location);
  const shouldUseGuestRoutes =
    !isAuthenticated || (authState === "loading" && isLikelyPublicRoute);

  useEffect(() => {
    if (!isAuthenticated) {
      setAffiliateTag("");
      return;
    }
    let cancelled = false;
    fetch(apiUrl("/api/affiliate/tag"), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.tag) setAffiliateTag(data.tag);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!affiliateTag) return;
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    if (url.pathname.startsWith("/ref/")) return;
    if (url.searchParams.has("ref")) return;
    if (url.pathname === "/truck-landing") return;

    url.searchParams.set("ref", affiliateTag);
    window.history.replaceState({}, "", url.toString());
  }, [affiliateTag, location]);

  useEffect(() => {
    const message = String((user as any)?.loginAnnouncement || "").trim();
    if (!message) return;
    if (shownAnnouncementRef.current === message) return;
    shownAnnouncementRef.current = message;
    toast({
      title: "Partner Access Activated",
      description: message,
    });
  }, [user, toast]);

  // Canonical guard: never redirect until authState resolves
  if (authState === "loading" && !isLikelyPublicRoute) {
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {shouldUseGuestRoutes ? (
          <>
            <Route path="/" component={Home} />
            <Route path="/login" component={Login} />
            <Route path="/customer-signup" component={CustomerSignup} />
            <Route path="/restaurant-signup" component={RestaurantSignup} />
            <Route path="/claim-truck" component={ClaimTruckPage} />
            <Route path="/deal-creation" component={DealCreation} />
            <Route path="/deal/:id" component={DealDetail} />
            <Route path="/search" component={Search} />
            <Route path="/map" component={MapPage} />
            <Route path="/suppliers" component={SuppliersPage} />
            <Route
              path="/suppliers/:supplierId"
              component={SupplierDetailPage}
            />
            <Route path="/supplier/:slug" component={SupplierDetailPage} />
            <Route path="/video" component={VideoPage} />
            <Route path="/video/:id" component={VideoDetailPage} />
            <Route path="/category/:category" component={CategoryPage} />
            <Route path="/cuisine/:type" component={CategoryPage} />
            <Route path="/deals" component={FeaturedDealsPage} />
            <Route path="/deals/featured" component={FeaturedDealsPage} />
            <Route path="/deals/:city" component={DealsCityPage} />
            <Route path="/restaurant/:id" component={RestaurantDetail} />
            <Route path="/truck/:slug" component={RestaurantDetail} />
            <Route path="/bar/:slug" component={RestaurantDetail} />
            <Route path="/location/:slug" component={LocationDetailPage} />
            <Route
              path="/location/:slug/food-trucks"
              component={LocationDetailPage}
            />
            <Route
              path="/location/:slug/food-trucks-now"
              component={LocationDiscoveryPage}
            />
            <Route
              path="/location/:slug/food-trucks-tonight"
              component={LocationDiscoveryPage}
            />
            <Route path="/city/:city" component={CityLanding} />
            <Route path="/city/:city/:mode" component={CityDiscoveryPage} />
            <Route path="/terms-of-service" component={TermsOfService} />
            <Route path="/moderation-policy" component={ModerationPolicy} />
            <Route path="/privacy-policy" component={PrivacyPolicy} />
            <Route path="/data-deletion" component={DataDeletion} />
            <Route path="/about" component={About} />
            <Route path="/compare" component={ComparePage} />
            <Route
              path="/online-ordering-platforms"
              component={OnlineOrderingPlatformsPage}
            />
            <Route path="/faq" component={FAQ} />
            <Route path="/how-it-works" component={HowItWorks} />
            <Route path="/contact" component={Contact} />
            <Route path="/install" component={InstallApp} />
            <Route path="/host-signup" component={HostSignup} />
            <Route path="/for-restaurants" component={ForRestaurants} />
            <Route path="/for-bars" component={ForBars} />
            <Route path="/for-hosts" component={ForHosts} />
            <Route
              path="/host-location-partner"
              component={HostLocationPartnerPage}
            />
            <Route path="/for-events" component={ForEvents} />
            <Route path="/find-food" component={FindFood} />
            <Route path="/event-signup" component={EventsRouter} />
            <Route path="/request-truck" component={RequestTruck} />
            <Route path="/events" component={EventsRouter} />
            <Route path="/admin/events" component={EventsRouter} />
            <Route
              path="/event-coordinator/dashboard"
              component={EventsRouter}
            />
            <Route path="/events/public" component={EventsRouter} />
            <Route path="/event/:slug" component={EventDetailPage} />
            <Route path="/dashboard" component={DashboardRouter} />
            <Route path="/food-trucks/:citySlug" component={CityLanding} />
            <Route
              path="/food-trucks/:citySlug/:cuisineSlug"
              component={CityLanding}
            />
            <Route path="/truck-landing" component={TruckLanding} />
            <Route path="/sitemap" component={Sitemap} />
            <Route path="/status" component={StatusPage} />
            <Route
              path="/golden-plate-winners"
              component={GoldenPlateWinners}
            />
            <Route
              path="/p/:profileType/:profileId"
              component={PublicProfilePage}
            />
            <Route
              path="/p/:profileType/:profileId/:profileSlug"
              component={PublicProfilePage}
            />
            <Route path="/pensacola/spots" component={PensacolaSpots} />
            <Route path="/pensacola/report" component={PensacolaReport} />
            <Route path="/parking-pass" component={ParkingPassPage} />
            <Route path="/share-hub" component={ShareHubPage} />
            <Route
              path="/business-team/accept"
              component={BusinessTeamAcceptPage}
            />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/change-password" component={ChangePassword} />
            <Route path="/account-setup" component={AccountSetup} />
            <Route path="/admin" component={AdminLogin} />
            <Route path="/admin/login" component={AdminLogin} />
            <Route path="/menu/:restaurantId" component={OnlineMenuPage} />
            <Route
              path="/checkout/:restaurantId"
              component={PickupCheckoutPage}
            />
            <Route
              path="/order-confirmation/:orderId"
              component={OrderConfirmationPage}
            />
          </>
        ) : (
          <>
            <Route path="/" component={Home} />
            <Route path="/login" component={Login} />
            <Route path="/customer-signup" component={CustomerSignup} />
            <Route path="/restaurant-signup" component={RestaurantSignup} />
            <Route path="/claim-truck" component={ClaimTruckPage} />
            <Route path="/deal-creation" component={DealCreation} />
            <Route path="/deal-edit/:dealId" component={DealEdit} />
            <Route path="/deal/:id" component={DealDetail} />
            <Route path="/subscribe" component={Subscribe} />
            <Route path="/subscription" component={Subscribe} />
            <Route path="/subscription/manage" component={Subscribe} />
            <Route
              path="/restaurant-owner-dashboard"
              component={RestaurantOwnerDashboard}
            />
            <Route
              path="/restaurant/dashboard"
              component={RestaurantOwnerDashboard}
            />
            <Route
              path="/edit-restaurant/:restaurantId"
              component={EditRestaurantPage}
            />
            <Route path="/dashboard" component={DashboardRouter} />
            <Route path="/user-dashboard" component={UserDashboard} />
            <Route path="/host/dashboard" component={HostDashboard} />
            <Route
              path="/event-coordinator/dashboard"
              component={EventsRouter}
            />
            <Route path="/truck-discovery" component={TruckDiscovery} />
            <Route path="/for-restaurants" component={ForRestaurants} />
            <Route path="/for-bars" component={ForBars} />
            <Route path="/for-hosts" component={ForHosts} />
            <Route
              path="/host-location-partner"
              component={HostLocationPartnerPage}
            />
            <Route path="/for-events" component={ForEvents} />
            <Route path="/find-food" component={FindFood} />
            <Route path="/search" component={Search} />
            <Route path="/map" component={MapPage} />
            <Route path="/suppliers" component={SuppliersPage} />
            <Route
              path="/suppliers/:supplierId"
              component={SupplierDetailPage}
            />
            <Route path="/supplier/:slug" component={SupplierDetailPage} />
            <Route path="/supply/orders" component={SupplyOrdersPage} />
            <Route path="/video" component={VideoPage} />
            <Route path="/favorites" component={Favorites} />
            <Route path="/orders" component={Orders} />
            <Route path="/profile" component={Profile} />
            <Route
              path="/supplier/dashboard"
              component={SupplierDashboardPage}
            />
            <Route path="/affiliate/earnings" component={AffiliateEarnings} />
            <Route path="/staff" component={StaffDashboard} />
            <Route path="/admin" component={AdminLogin} />
            <Route path="/admin/dashboard" component={AdminDashboard} />
            <Route path="/admin/incidents" component={AdminIncidents} />
            <Route
              path="/admin/control-center"
              component={AdminControlCenter}
            />
            <Route path="/admin/legacy-dashboard" component={AdminDashboard} />
            <Route path="/admin/tickets" component={AdminSupportTickets} />
            <Route path="/admin/moderation" component={AdminModerationEvents} />
            <Route path="/admin/moderation/queue" component={ModerationQueue} />
            <Route
              path="/admin/moderation/videos"
              component={AdminModerationVideos}
            />
            <Route
              path="/admin/moderation/metrics"
              component={AdminModerationMetrics}
            />
            <Route
              path="/admin/moderation/appeals"
              component={AdminModerationAppeals}
            />
            <Route path="/admin/audit-logs" component={AdminAuditLogs} />
            <Route path="/admin/vac-logs" component={AdminVacLogs} />
            <Route path="/admin/telemetry" component={AdminTelemetry} />
            <Route path="/admin/geo-ads" component={AdminGeoAds} />
            <Route
              path="/admin/affiliates"
              component={AdminAffiliateManagement}
            />
            <Route path="/admin/switcher" component={DashboardSwitcherPage} />
            <Route path="/category/:category" component={CategoryPage} />
            <Route path="/cuisine/:type" component={CategoryPage} />
            <Route path="/deals" component={FeaturedDealsPage} />
            <Route path="/deals/featured" component={FeaturedDealsPage} />
            <Route path="/deals/:city" component={DealsCityPage} />
            <Route path="/restaurant/:id" component={RestaurantDetail} />
            <Route path="/truck/:slug" component={RestaurantDetail} />
            <Route path="/bar/:slug" component={RestaurantDetail} />
            <Route path="/location/:slug" component={LocationDetailPage} />
            <Route
              path="/location/:slug/food-trucks"
              component={LocationDetailPage}
            />
            <Route
              path="/location/:slug/food-trucks-now"
              component={LocationDiscoveryPage}
            />
            <Route
              path="/location/:slug/food-trucks-tonight"
              component={LocationDiscoveryPage}
            />
            <Route path="/city/:city" component={CityLanding} />
            <Route path="/city/:city/:mode" component={CityDiscoveryPage} />
            <Route path="/terms-of-service" component={TermsOfService} />
            <Route path="/moderation-policy" component={ModerationPolicy} />
            <Route path="/privacy-policy" component={PrivacyPolicy} />
            <Route path="/data-deletion" component={DataDeletion} />
            <Route path="/about" component={About} />
            <Route path="/compare" component={ComparePage} />
            <Route
              path="/online-ordering-platforms"
              component={OnlineOrderingPlatformsPage}
            />
            <Route path="/faq" component={FAQ} />
            <Route path="/how-it-works" component={HowItWorks} />
            <Route path="/contact" component={Contact} />
            <Route path="/install" component={InstallApp} />
            <Route path="/host-signup" component={HostSignup} />
            <Route path="/event-signup" component={EventsRouter} />
            <Route path="/request-truck" component={RequestTruck} />
            <Route path="/events" component={EventsRouter} />
            <Route path="/admin/events" component={EventsRouter} />
            <Route path="/events/public" component={EventsRouter} />
            <Route path="/event/:slug" component={EventDetailPage} />
            <Route path="/pensacola/spots" component={PensacolaSpots} />
            <Route path="/pensacola/report" component={PensacolaReport} />
            <Route path="/food-trucks/:citySlug" component={CityLanding} />
            <Route
              path="/food-trucks/:citySlug/:cuisineSlug"
              component={CityLanding}
            />
            <Route path="/sitemap" component={Sitemap} />
            <Route path="/truck-landing" component={TruckLanding} />
            <Route path="/status" component={StatusPage} />
            <Route
              path="/p/:profileType/:profileId"
              component={PublicProfilePage}
            />
            <Route
              path="/p/:profileType/:profileId/:profileSlug"
              component={PublicProfilePage}
            />
            <Route path="/forgot-password" component={ForgotPassword} />
            <Route path="/reset-password" component={ResetPassword} />
            <Route path="/change-password" component={ChangePassword} />
            <Route path="/account-setup" component={AccountSetup} />
            <Route path="/admin/login" component={AdminLogin} />
            <Route path="/admin/oauth-setup" component={OAuthSetupGuide} />
            <Route
              path="/profile/notifications"
              component={NotificationsPage}
            />
            <Route path="/profile/settings" component={SettingsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/profile/addresses" component={AddressesPage} />
            <Route path="/profile/payment" component={PaymentMethodsPage} />
            <Route path="/profile/help" component={HelpSupportPage} />
            <Route
              path="/profile/reporter-reputation"
              component={ReporterReputationPage}
            />
            <Route
              path="/restaurant/:restaurantId/reviews"
              component={ReviewsPage}
            />
            <Route path="/parking-pass" component={ParkingPassPage} />
            <Route path="/parking-pass-manage" component={ParkingPassManage} />
            <Route path="/share-hub" component={ShareHubPage} />
            <Route path="/business-team" component={BusinessTeamPage} />
            <Route
              path="/business-team/accept"
              component={BusinessTeamAcceptPage}
            />
            <Route path="/menu/:restaurantId" component={OnlineMenuPage} />
            <Route
              path="/checkout/:restaurantId"
              component={PickupCheckoutPage}
            />
            <Route
              path="/order-confirmation/:orderId"
              component={OrderConfirmationPage}
            />
            <Route
              path="/menu-builder/:restaurantId"
              component={MenuBuilderPage}
            />
            <Route path="/menu-builder" component={MenuBuilderPage} />
            <Route path="/kitchen" component={KitchenDisplayPage} />
          </>
        )}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TimeOfDayBackground />
        <div className="desktop-full-width app-background app-content min-h-screen md:pt-16 relative z-10">
          <Toaster />
          <BetaDisclaimer />
          <Router />
          <Navigation scope="global" />
          {/* Build canary - shows deployment timestamp */}
          {import.meta.env.PROD && (
            <div
              style={{
                position: "fixed",
                bottom: 4,
                right: 6,
                fontSize: 10,
                opacity: 0.4,
                zIndex: 99999,
                pointerEvents: "none",
                fontFamily: "monospace",
              }}
            >
              {typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev"}
            </div>
          )}
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
