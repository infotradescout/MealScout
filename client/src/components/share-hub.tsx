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
    title: "Add a Business",
    description: "Invite a restaurant, bar, or food truck to join MealScout.",
    href: "/restaurant-signup",
    audience: "Restaurant + Food Truck Owners",
    priority: 1,
    outreachText:
      "Get your business on MealScout and start getting monthly visibility and booking leads: ",
  },
  {
    key: "claim-business",
    title: "Claim Business",
    description: "Help an owner find and activate an existing listing.",
    href: "/truck-onboarding?claim=1",
    audience: "Business Owners",
    priority: 2,
    outreachText:
      "Claim your MealScout business listing and start receiving local booking opportunities here: ",
  },
  {
    key: "host-partner",
    title: "Become a Host",
    description: "Share this with places that have parking space for food trucks.",
    href: "/host-location-partner",
    audience: "Potential Hosts",
    priority: 3,
    outreachText:
      "Have parking space? Become a MealScout host location and earn from food truck bookings: ",
  },
  {
    key: "for-restaurants",
    title: "Restaurant Info",
    description: "A simple overview for restaurants considering MealScout.",
    href: "/for-restaurants",
    audience: "Restaurant Owners",
  },
  {
    key: "for-hosts",
    title: "Host Program",
    description: "A simple overview for host locations and property owners.",
    href: "/for-hosts",
    audience: "Potential Hosts",
  },
  {
    key: "map",
    title: "Live Food Map",
    description: "Send people straight to nearby food trucks and restaurants.",
    href: "/map",
    audience: "Customers",
  },
  {
    key: "sitemap",
    title: "MealScout Directory",
    description: "A clean index of useful public MealScout pages.",
    href: "/sitemap",
    audience: "General",
  },
];

const INTERNAL_SHARE_PATH = /^(?:\/admin(?:\/|$)|\/staff(?:\/|$))/i;

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/affiliate/tag", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.tag) {
          setAffiliateTag(String(data.tag));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    // Share Hub must stay public-safe: never expose internal admin/staff routes.
    const base = USER_ITEMS.filter((item) => !INTERNAL_SHARE_PATH.test(item.href));
    if (!affiliateTag) return base;
    const referralItem: ShareHubItem = {
      key: "referral",
      title: "My Referral Link",
      description: "Use this one-click link to share and auto-credit referrals.",
      href: `/ref/${affiliateTag}`,
      audience: "All",
    };
    return [referralItem, ...base];
  }, [affiliateTag]);

  const absoluteUrl = (href: string) => {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    if (typeof window === "undefined") return href;
    return `${window.location.origin}${href}`;
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
    const value = absoluteUrl(href);
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
    const value = absoluteUrl(item.href);
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
    const value = absoluteUrl(href);
    if (!navigator.share) {
      if (item) void trackShareHubEvent("share", item);
      await copyLink(href);
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="font-semibold">{item.title}</h4>
                <div className="flex items-center gap-2">
                  {mode !== "user" && typeof item.priority === "number" ? (
                    <Badge>{`P${item.priority}`}</Badge>
                  ) : null}
                  <Badge variant="secondary">{item.audience}</Badge>
                </div>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">{item.description}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <a
                    href={item.href}
                    target={item.href.startsWith("http") ? "_blank" : undefined}
                    rel={
                      item.href.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                    onClick={() => void trackShareHubEvent("open", item)}
                  >
                    Open Page
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await copyLink(item.href);
                    void trackShareHubEvent("copy_link", item);
                  }}
                >
                  Copy Link
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => shareLink(item.title, item.href)}
                >
                  Share
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => copyOutreachText(item)}
                >
                  Copy Message
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
