import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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

const USER_ITEMS: ShareHubItem[] = [
  {
    key: "owner-signup",
    title: "1) Owner Signup",
    description: "Primary link for restaurant owners and food truck operators to start.",
    href: "/customer-signup?role=business",
    audience: "Restaurant + Food Truck Owners",
    priority: 1,
    outreachText:
      "Get your business on MealScout and start getting monthly visibility and booking leads: ",
  },
  {
    key: "claim-truck",
    title: "2) Food Truck Claim",
    description: "Direct page for food truck operators to claim and activate their profile.",
    href: "/claim-truck",
    audience: "Food Truck Owners",
    priority: 2,
    outreachText:
      "Claim your food truck listing and start receiving local booking opportunities here: ",
  },
  {
    key: "host-partner",
    title: "3) Host Location Signup",
    description: "Direct intake page for non-food businesses with usable parking.",
    href: "/host-signup",
    audience: "Potential Hosts",
    priority: 3,
    outreachText:
      "Have parking space? Become a MealScout host location and earn from food truck bookings: ",
  },
  {
    key: "for-restaurants",
    title: "Restaurant Growth Page",
    description: "Share this with restaurant owners ready for monthly growth.",
    href: "/restaurant-signup?businessType=restaurant",
    audience: "Restaurant Owners",
  },
  {
    key: "for-hosts",
    title: "Host Program Page",
    description: "Great for businesses with parking lots that can host trucks.",
    href: "/host-signup",
    audience: "Potential Hosts",
  },
  {
    key: "map",
    title: "Scout Dashboard",
    description: "Send people straight to nearby food trucks and restaurants.",
    href: "/scout",
    audience: "Customers",
  },
  {
    key: "sitemap",
    title: "Site Directory",
    description: "Shareable index of important public pages.",
    href: "/sitemap",
    audience: "General",
  },
];

const STAFF_ADMIN_ITEMS: ShareHubItem[] = [
  ...USER_ITEMS,
  {
    key: "staff-dashboard",
    title: "Staff Dashboard",
    description: "Account creation and host-location operations in one place.",
    href: "/staff",
    audience: "Internal",
  },
  {
    key: "admin-dashboard",
    title: "Admin Dashboard",
    description: "Platform operations, moderation, imports, and host controls.",
    href: "/admin/dashboard",
    audience: "Internal",
  },
  {
    key: "lisa",
    title: "LISA Control Center",
    description: "AI operations, traffic insights, and growth automation tools.",
    href: "/admin/control-center",
    audience: "Internal",
  },
  {
    key: "admin-affiliates",
    title: "Affiliate Manager",
    description: "Manage referral tags and commission settings.",
    href: "/admin/affiliates",
    audience: "Internal",
  },
];

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
  const [affiliateTag, setAffiliateTag] = useState("");
  const [affiliateTagUnavailable, setAffiliateTagUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/affiliate/tag", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.tag) {
          setAffiliateTag(String(data.tag));
          setAffiliateTagUnavailable(false);
        } else {
          setAffiliateTagUnavailable(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAffiliateTagUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    const base = mode === "user" ? USER_ITEMS : STAFF_ADMIN_ITEMS;
    if (!affiliateTag) return base;
    const referralItem: ShareHubItem = {
      key: "referral",
      title: "My Referral Link",
      description: "Use this one-click link to share and auto-credit referrals.",
      href: `/ref/${affiliateTag}`,
      audience: "All",
    };
    return [referralItem, ...base];
  }, [mode, affiliateTag]);

  const absoluteUrl = (href: string) => {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    if (typeof window === "undefined") return href;
    return `${window.location.origin}${href}`;
  };

  const generateTrackedShareUrl = async (href: string) => {
    try {
      const response = await fetch("/api/share/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          path: href,
          ref: affiliateTag || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to generate tracked share link");
      }
      const data = await response.json();
      const shareLink = String(data?.shareLink || "").trim();
      if (!shareLink) {
        throw new Error("Tracked share link missing");
      }
      return shareLink;
    } catch {
      return absoluteUrl(href);
    }
  };

  const trackShareHubEvent = async (
    action: "open" | "copy_link" | "copy_outreach" | "share",
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
    const value = await generateTrackedShareUrl(href);
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

  const copyOutreachText = async (item: ShareHubItem) => {
    const value = await generateTrackedShareUrl(item.href);
    const text = item.outreachText ? `${item.outreachText}${value}` : value;
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

  const shareLink = async (titleValue: string, href: string) => {
    const item = items.find((entry) => entry.title === titleValue && entry.href === href);
    const value = await generateTrackedShareUrl(href);
    if (!navigator.share) {
      if (item) void trackShareHubEvent("share", item);
      await navigator.clipboard.writeText(value);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {affiliateTagUnavailable ? (
          <div className="mb-3 rounded-md border border-amber-300/50 bg-amber-100/40 p-3 text-xs text-amber-900">
            Referral tracking is temporarily unavailable. You can still share this page, but attribution may not be attached.
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
              <p className="mb-3 text-sm text-muted-foreground">{item.description}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => shareLink(item.title, item.href)}
                >
                  Share tracked link
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const trackedUrl = await generateTrackedShareUrl(item.href);
                    window.open(
                      trackedUrl,
                      item.href.startsWith("http") ? "_blank" : "_self",
                      item.href.startsWith("http")
                        ? "noopener,noreferrer"
                        : undefined,
                    );
                    void trackShareHubEvent("open", item);
                  }}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
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
