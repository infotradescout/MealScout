import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Settings,
  Bell,
  Heart,
  Receipt,
  CreditCard,
  ArrowDownToLine,
  HelpCircle,
  LogOut,
  ChevronRight,
  Star,
  MapPin,
  Store,
  Building2,
  PartyPopper,
  Calendar,
  Link as LinkIcon,
  Video,
  Flag,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { apiUrl, authUrl } from "@/lib/api";
import { getOptimizedImageUrl } from "@/lib/images";
import { useIsStandalone } from "@/hooks/useIsStandalone";
import { CriticBadge } from "@/components/award-badges";
import { isCriticAccount } from "@/lib/critic";

export default function ProfilePage() {
  const { user, isAuthenticated } = useAuth();
  const isStandalone = useIsStandalone();
  const [affiliateTag, setAffiliateTag] = useState<string>("");
  const [tagInput, setTagInput] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  const [userStats] = useState({
    dealsRedeemed: 0,
    joinedDate: user?.createdAt
      ? new Date(user.createdAt).toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        })
      : null,
    lastActivity: null,
  });
  const isEventCoordinator = user?.userType === "event_coordinator";
  const showEventCta = user?.userType === "customer" || isEventCoordinator;
  const eventCta = isEventCoordinator
    ? {
        href: "/events",
        title: "Manage Your Events",
        description: "Open the events portal to post and manage events ->",
        Icon: Calendar,
      }
    : {
        href: "/request-truck",
        title: "Request a Truck",
        description: "Birthdays, private parties, and neighborhood gatherings ->",
        Icon: PartyPopper,
      };

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated) return;
    fetch(apiUrl("/api/affiliate/tag"), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.tag) {
          setAffiliateTag(data.tag);
          setTagInput(data.tag);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))] border-b border-white/5">
          <h1 className="text-2xl font-bold text-foreground flex items-center">
            <User className="w-6 h-6 text-[color:var(--accent-text)] mr-3" />
            Profile
          </h1>
        </header>

        <div className="px-4 sm:px-6 py-12 text-center">
          <User className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Sign in to view profile
          </h2>
          <p className="text-muted-foreground mb-6">
            Log in to access your profile, settings, and deal history
          </p>
          <Button onClick={() => (window.location.href = authUrl("/api/auth/facebook"))}>
            Sign In with Facebook
          </Button>
        </div>

        <Navigation />
      </div>
    );
  }

  const menuItems = [
    { icon: Receipt, label: "Deal History", badge: null, href: "/orders" },
    { icon: Heart, label: "Favorites", badge: null, href: "/favorites" },
    {
      icon: Bell,
      label: "Notifications",
      badge: null,
      href: "/profile/notifications",
    },
    {
      icon: MapPin,
      label: "Addresses",
      badge: null,
      href: "/profile/addresses",
    },
    // Only show Payment Methods for restaurant owners who need subscription billing
    ...(user?.userType === "restaurant_owner" ||
      user?.userType === "caterer" ||
      user?.userType === "private_chef"
      ? [
          {
            icon: CreditCard,
            label: "Payment Methods",
            badge: null,
            href: "/profile/payment",
          },
        ]
      : []),
    {
      icon: Settings,
      label: "Settings",
      badge: null,
      href: "/profile/settings",
    },
    ...(!isStandalone
      ? [
          {
            icon: ArrowDownToLine,
            label: "Install App",
            badge: null,
            href: "/install",
          },
        ]
      : []),
    {
      icon: HelpCircle,
      label: "Help & Support",
      badge: null,
      href: "/profile/help",
    },
    {
      icon: Flag,
      label: "Reporter Reputation",
      badge: null,
      href: "/profile/reporter-reputation",
    },
  ];

  const handleCopyAffiliateLink = async () => {
    if (!affiliateTag) return;
    const shareUrl = `${window.location.origin}/ref/${affiliateTag}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (error) {
      console.error("Failed to copy affiliate link:", error);
    }
  };

  const handleSaveTag = async () => {
    if (!tagInput.trim()) {
      setTagError("Please enter a valid tag.");
      return;
    }
    setTagSaving(true);
    setTagError(null);
    try {
      const res = await fetch(apiUrl("/api/affiliate/tag"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tagInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update tag");
      }
      const data = await res.json();
      setAffiliateTag(data.tag);
      setTagInput(data.tag);
    } catch (error: any) {
      setTagError(error.message || "Failed to update tag.");
    } finally {
      setTagSaving(false);
    }
  };

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title="My Profile - MealScout | Account Settings"
        description="Manage your MealScout profile, view account settings, update preferences, and access your deal history. Customize your food deal discovery experience."
        keywords="profile, account settings, user profile, account management, preferences"
        canonicalUrl="https://www.mealscout.us/profile"
        noIndex={true}
      />
      {/* Header */}
      <header className="px-4 sm:px-6 py-6 bg-[linear-gradient(110deg,rgba(255,77,46,0.10),rgba(245,158,11,0.08))] border-b border-[color:var(--border-subtle)] shadow-clean">
        <h1 className="text-2xl font-bold text-foreground flex items-center mb-6">
          <User className="w-6 h-6 text-[color:var(--accent-text)] mr-3" />
          Profile
        </h1>

        {/* User Info Card */}
        <Card className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              {user?.profileImageUrl ? (
                <img
                  src={getOptimizedImageUrl(user.profileImageUrl, "large")}
                  alt="Profile"
                  className="w-16 h-16 rounded-full object-cover"
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-16 h-16 bg-[color:var(--accent-text)] rounded-full flex items-center justify-center">
                  <User className="w-8 h-8 text-white" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    className="text-xl font-bold text-foreground"
                    data-testid="text-user-name"
                  >
                    {user?.firstName && user?.lastName
                      ? `${user.firstName} ${user.lastName}`
                      : user?.email || "User"}
                  </h2>
                  {isCriticAccount(user) && <CriticBadge size="md" />}
                </div>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-user-email"
                >
                  {user?.email}
                </p>
                <div className="flex items-center mt-2">
                  <Star className="w-4 h-4 text-[color:var(--status-warning)] mr-1" />
                  <span
                    className="text-sm font-medium text-foreground"
                    data-testid="text-user-type"
                  >
                    {user?.userType === "restaurant_owner"
                      ? "Restaurant Owner"
                      : user?.userType === "caterer"
                        ? "Caterer"
                        : user?.userType === "private_chef"
                          ? "Private Chef"
                          : user?.userType === "food_truck"
                            ? "Food Truck"
                            : user?.userType === "supplier"
                              ? "Supplier"
                              : user?.userType === "host"
                                ? "Host"
                                : user?.userType === "event_coordinator"
                                  ? "Event Coordinator"
                                  : user?.userType === "staff"
                                    ? "Staff"
                                    : user?.userType === "admin"
                                      ? "Admin"
                                      : user?.userType === "super_admin"
                                        ? "Super Admin"
                                        : "Food Explorer"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </header>

      {/* Stats Section - Removed mock data */}
      <div className="px-4 sm:px-6 py-6">
        <Card className="border border-[color:var(--border-subtle)]">
          <CardContent className="p-6">
            <div className="space-y-3 text-sm text-[color:var(--text-secondary)]">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>Joined {userStats.joinedDate}</span>
              </div>
              {userStats.dealsRedeemed > 0 && (
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4" />
                  <span>{userStats.dealsRedeemed} deals redeemed</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4 border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
          <CardContent className="p-4">
            <Link href="/video">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--bg-surface-muted)] flex items-center justify-center">
                    <Video className="w-4 h-4 text-[color:var(--accent-text)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Post a Video Recommendation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Help local spots get discovered faster.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Affiliate Link (Prominent) */}
      {affiliateTag && (
        <div className="px-4 sm:px-6 pb-2">
          <Card className="border border-strong bg-[color:var(--bg-card)] shadow-clean-lg">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl action-primary flex items-center justify-center">
                  <LinkIcon className="w-5 h-5 text-[color:var(--action-primary-text)]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-[color:var(--accent-text)]">
                    Affiliate Link
                  </h3>
                  <p className="text-sm text-secondary">
                    Customize your tag once and share your referral link.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex-1 flex items-center rounded-md border border-subtle bg-surface-muted px-3 py-2 text-sm text-[color:var(--accent-text)]">
                  <span className="text-secondary mr-1">
                    {`${window.location.origin}/ref/`}
                  </span>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    className="bg-transparent outline-none flex-1"
                    placeholder="user1234"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="action-primary"
                    onClick={handleSaveTag}
                    disabled={tagSaving}
                  >
                    {tagSaving ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" onClick={handleCopyAffiliateLink}>
                    Copy Link
                  </Button>
                </div>
              </div>
              {tagError && <p className="text-xs text-error">{tagError}</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Menu Items */}
      <div className="px-4 sm:px-6 pb-6">
        {/* Business Opportunities Section */}
        {showEventCta && (
          <div className="mb-6 space-y-4">
            <h3 className="text-sm font-semibold text-[color:var(--text-muted)] uppercase tracking-wide">
              Business Opportunities
            </h3>

            {/* Event Organizer CTA */}
            <Card className="bg-gradient-to-br from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 transition-all cursor-pointer border border-[color:var(--border-subtle)]">
              <CardContent className="p-0">
                <Link href={eventCta.href}>
                  <div className="p-5">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-[color:var(--accent-text)]/100/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                        <eventCta.Icon className="w-6 h-6 text-[color:var(--accent-text)]" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-[color:var(--text-primary)] font-bold text-base mb-1">
                          {eventCta.title}
                        </h3>
                        <p className="text-[color:var(--text-secondary)] text-sm">
                          {eventCta.description}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="space-y-2">
          {menuItems.map((item, index) => (
            <Link key={index} href={item.href}>
              <Card className="bg-[var(--bg-card)] hover:bg-[var(--bg-surface-muted)] transition-colors cursor-pointer border border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="p-4">
                  <div
                    className="flex items-center justify-between"
                    data-testid={`menu-item-${item.label
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    <div className="flex items-center space-x-3">
                      <item.icon className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        {item.label}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {item.badge && (
                        <Badge variant="secondary" className="text-xs">
                          {item.badge}
                        </Badge>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {/* Restaurant Owner Option (de-emphasized in menu) */}
          {user?.userType === "customer" && (
            <Link href="/restaurant-signup">
              <Card className="bg-[var(--bg-card)] hover:bg-[var(--bg-surface-muted)] transition-colors cursor-pointer border border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Store className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium text-foreground">
                        List Your Restaurant
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}
        </div>

        {/* Logout Button */}
        <Card className="bg-[var(--bg-card)] hover:bg-[var(--bg-surface-muted)] transition-colors cursor-pointer border border-[color:var(--border-subtle)] shadow-clean mt-6">
          <CardContent className="p-4">
            <button
              onClick={async () => {
                try {
                  const response = await fetch(apiUrl("/api/auth/logout"), {
                    method: "POST",
                    credentials: "include",
                  });
                  if (response.ok) {
                    window.location.href = "/";
                  } else {
                    console.error("Logout failed");
                  }
                } catch (error) {
                  console.error("Logout error:", error);
                }
              }}
              className="w-full flex items-center justify-between"
              data-testid="button-logout"
            >
              <div className="flex items-center space-x-3">
                <LogOut className="w-5 h-5 text-[color:var(--status-error)]" />
                <span className="font-medium text-[color:var(--status-error)]">
                  Sign Out
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-[color:var(--status-error)]" />
            </button>
          </CardContent>
        </Card>
      </div>

      <Navigation />
    </div>
  );
}
