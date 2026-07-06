import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

type ShareHubMode = "admin" | "staff" | "user";

interface ShareHubItem {
  key: string;
  title: string;
  description: string;
  href: string;
  audience: string;
  priority?: number;
  outreachText?: string;
}

const BASE_ITEMS: ShareHubItem[] = [
  {
    key: "signup",
    title: "Signup",
    description: "Best first link for anyone new to MealScout.",
    href: "/customer-signup",
    audience: "General",
    priority: 1,
    outreachText: "Join MealScout here: ",
  },
  {
    key: "host",
    title: "Host",
    description: "For property and venue owners who want to host food trucks.",
    href: "/host-signup",
    audience: "Hosts",
    priority: 2,
    outreachText: "Start your host listing on MealScout: ",
  },
  {
    key: "truck",
    title: "Truck",
    description: "For food truck owners to claim and launch their profile.",
    href: "/claim-truck",
    audience: "Food Truck Owners",
    priority: 3,
    outreachText: "Claim your food truck profile: ",
  },
  {
    key: "restaurant",
    title: "Restaurant",
    description: "For restaurant owners to create their public MealScout page.",
    href: "/restaurant-signup?businessType=restaurant",
    audience: "Restaurant Owners",
    priority: 4,
    outreachText: "Create your restaurant page on MealScout: ",
  },
];

const STAFF_ADMIN_ITEMS: ShareHubItem[] = BASE_ITEMS;
const SHARE_UNAVAILABLE_MESSAGE =
  "Tracked links are active. Add a custom share tag any time for cleaner branding.";

function sanitizeTargetPathForTrackedLink(targetPath: string): string {
  const parsed = new URL(targetPath, window.location.origin);
  parsed.searchParams.delete("to");
  parsed.searchParams.delete("ref");
  if (
    parsed.pathname.toLowerCase() === "/customer-signup" &&
    parsed.searchParams.get("role") === "business"
  ) {
    parsed.searchParams.delete("role");
  }
  const normalizedPathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${normalizedPathname}${parsed.search}${parsed.hash}`;
}

function isDirectAttributedShareLink(
  shareLink: string,
  targetPath: string,
): boolean {
  try {
    const generated = new URL(shareLink, window.location.origin);
    const expectedTarget = new URL(
      sanitizeTargetPathForTrackedLink(targetPath),
      window.location.origin,
    );
    const generatedParts = generated.pathname.split("/").filter(Boolean);
    if (generatedParts.length < 2) return false;
    const refSegment = String(
      generatedParts[generatedParts.length - 1] || "",
    ).trim();
    if (!refSegment) return false;
    const generatedBasePath = `/${generatedParts.slice(0, -1).join("/")}`;
    const expectedBasePath = expectedTarget.pathname.replace(/\/+$/, "") || "/";
    return (
      generatedBasePath === expectedBasePath &&
      generated.search === expectedTarget.search &&
      generated.hash === expectedTarget.hash &&
      generated.pathname.toLowerCase() !== "/ref" &&
      !generated.pathname.toLowerCase().startsWith("/ref/") &&
      !generated.searchParams.has("to") &&
      !generated.searchParams.has("ref") &&
      !shareLink.includes("to=") &&
      !shareLink.includes("%2F") &&
      !shareLink.includes("role=business")
    );
  } catch {
    return false;
  }
}

function normalizeShareHubTargetPath(href: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;

  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }

  if (!path.startsWith("/")) path = `/${path}`;
  const pathname = path.split(/[?#]/, 1)[0].toLowerCase();
  if (
    pathname === "/" ||
    pathname === "/ref" ||
    pathname.startsWith("/ref/") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/staff") ||
    pathname.startsWith("/api")
  ) {
    return null;
  }
  return path;
}

export default function ShareHub({
  mode,
  title,
  description,
}: {
  mode: ShareHubMode;
  title: string;
  description: string;
}) {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [shareAuthError, setShareAuthError] = useState<string | null>(null);
  const [publicProfilePath, setPublicProfilePath] = useState<string | null>(null);

  const canonicalMealScoutOrigin = (
    import.meta.env.VITE_PUBLIC_BASE_URL ||
    import.meta.env.VITE_PUBLIC_ORIGIN ||
    "https://www.mealscout.us"
  ).replace(/\/+$/, "");

  const toSeoSlug = (value: string) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const deriveSelfPublicProfilePath = (user: any, hostProfile?: any | null) => {
    const restaurantId = String(user?.restaurantId || "").trim();
    if (restaurantId) {
      const businessType = String(user?.businessType || "").toLowerCase();
      const profileType =
        user?.businessIsFoodTruck === true ||
        user?.userType === "food_truck" ||
        businessType === "food_truck"
          ? "truck"
          : "restaurant";
      const slug = toSeoSlug(
        user?.businessName ||
          `${String(user?.firstName || "").trim()} ${String(user?.lastName || "").trim()}` ||
          restaurantId,
      );
      return buildPublicProfilePath({
        entityType: profileType,
        id: restaurantId,
        slug,
        name: user?.businessName,
      });
    }

    const hostId = String(hostProfile?.id || "").trim();
    if (hostId) {
      const slug = toSeoSlug(
        hostProfile?.businessName || hostProfile?.name || user?.businessName || hostId,
      );
      return buildPublicProfilePath({
        entityType: "location",
        id: hostId,
        slug,
        name: hostProfile?.businessName || hostProfile?.name,
      });
    }

    return null;
  };

  useEffect(() => {
    let cancelled = false;
    if (isLoading) return;

    if (!isAuthenticated || !user) {
      setShareAuthError("Sign in to generate share links.");
      setPublicProfilePath(null);
      return;
    }

    setShareAuthError(null);

    const loadPublicProfilePath = async () => {
      let hostProfile: any | null = null;
      try {
        const hostResponse = await fetch("/api/hosts/me", {
          credentials: "include",
        });
        hostProfile = hostResponse.ok
          ? await hostResponse.json().catch(() => null)
          : null;
      } catch {
        hostProfile = null;
      }

      if (cancelled) return;
      setPublicProfilePath(deriveSelfPublicProfilePath(user, hostProfile));
    };

    void loadPublicProfilePath().catch(() => {
      if (cancelled) return;
      setShareAuthError("Sign in to generate share links.");
      setPublicProfilePath(null);
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, user]);

  const items = useMemo(() => {
    const base = mode === "user" ? BASE_ITEMS : STAFF_ADMIN_ITEMS;
    if (!publicProfilePath) return base;
    const publicProfileItem: ShareHubItem = {
      key: "public-profile",
      title: "Public Profile",
      description: "Share your live public MealScout page.",
      href: publicProfilePath,
      audience: "Your audience",
      priority: 0,
      outreachText: "View my public MealScout page: ",
    };
    return [publicProfileItem, ...base];
  }, [mode, publicProfilePath]);

  const generateTrackedShareUrl = async (href: string) => {
    const path = normalizeShareHubTargetPath(href);
    if (!path) {
      throw new Error("Tracked link target is not eligible.");
    }

    const response = await fetch("/api/share/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        path,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || "Tracked links are unavailable.");
    }
    const shareLink = String(data?.shareLink || "").trim();
    if (!shareLink || !isDirectAttributedShareLink(shareLink, path)) {
      throw new Error("Tracked share link missing attribution target.");
    }
    if (/\/ref\/([^/?#]+)[^#]*[?&]ref=\1(?:&|#|$)/i.test(shareLink)) {
      throw new Error(SHARE_UNAVAILABLE_MESSAGE);
    }
    if (/^https:\/\/meal-scout\.vercel\.app\//i.test(shareLink)) {
      throw new Error(SHARE_UNAVAILABLE_MESSAGE);
    }
    return shareLink;
  };

  const trackShareHubEvent = async (
    action: "copy_link" | "copy_outreach" | "share",
    item: ShareHubItem,
  ) => {
    try {
      await fetch("/api/telemetry/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventName: "share_hub_action",
          properties: {
            action,
            mode,
            itemKey: item.key,
            href: item.href,
            audience: item.audience,
          },
        }),
      });
    } catch {
      // Best-effort telemetry only
    }
  };

  const copyLink = async (href: string) => {
    let value = "";
    try {
      value = await generateTrackedShareUrl(href);
    } catch (error: any) {
      toast({
        title: "Sharing disabled",
        description: error?.message || SHARE_UNAVAILABLE_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied", description: value });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission was blocked.",
        variant: "destructive",
      });
    }
  };

  const shareLink = async (titleValue: string, href: string) => {
    const item = items.find(
      (entry) => entry.title === titleValue && entry.href === href,
    );
    let value = "";
    try {
      value = await generateTrackedShareUrl(href);
    } catch (error: any) {
      toast({
        title: "Sharing disabled",
        description: error?.message || SHARE_UNAVAILABLE_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    if (!navigator.share) {
      if (item) void trackShareHubEvent("share", item);
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied", description: value });
      return;
    }
    try {
      await navigator.share({
        title: titleValue,
        text: "Useful MealScout link",
        url: value,
      });
      if (item) void trackShareHubEvent("share", item);
    } catch {
      // user dismissed share modal
    }
  };

  const copyOutreachText = async (item: ShareHubItem) => {
    let text = "";
    try {
      const value = await generateTrackedShareUrl(item.href);
      text = item.outreachText ? `${item.outreachText}${value}` : value;
    } catch (error: any) {
      toast({
        title: "Sharing disabled",
        description: error?.message || SHARE_UNAVAILABLE_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      void trackShareHubEvent("copy_outreach", item);
      toast({ title: "Outreach text copied", description: item.title });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission was blocked.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {shareAuthError ? (
          <div className="mb-3 rounded-md border border-red-300/50 bg-red-100/40 p-3 text-xs text-red-900">
            {shareAuthError}
          </div>
        ) : isAuthenticated ? (
          <div className="mb-3 rounded-md border border-amber-300/50 bg-amber-100/40 p-3 text-xs text-amber-900">
            {SHARE_UNAVAILABLE_MESSAGE}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="font-semibold">{item.title}</h4>
                <div className="flex items-center gap-2">
                  {typeof item.priority === "number" ? (
                    <Badge>{`P${item.priority}`}</Badge>
                  ) : null}
                  <Badge variant="secondary">{item.audience}</Badge>
                </div>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                {item.description}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={
                    !isAuthenticated || !normalizeShareHubTargetPath(item.href)
                  }
                  onClick={() => shareLink(item.title, item.href)}
                >
                  Share Link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    !isAuthenticated || !normalizeShareHubTargetPath(item.href)
                  }
                  onClick={async () => {
                    await copyLink(item.href);
                    void trackShareHubEvent("copy_link", item);
                  }}
                >
                  Copy Link
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    !isAuthenticated || !normalizeShareHubTargetPath(item.href)
                  }
                  onClick={() => copyOutreachText(item)}
                >
                  Copy Outreach
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
