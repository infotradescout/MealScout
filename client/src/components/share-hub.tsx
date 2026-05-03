import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  Clapperboard,
  Copy,
  ExternalLink,
  Link2,
  Mail,
  MapPinned,
  MessageCircle,
  Send,
  Store,
  Truck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type ShareHubMode = "admin" | "staff" | "user";
type ShareAudience = "owners" | "hosts" | "customers" | "events" | "general";
type ShareAction =
  | "open"
  | "copy_link"
  | "copy_message"
  | "share"
  | "sms"
  | "email"
  | "facebook"
  | "whatsapp";

interface ShareHubItem {
  key: string;
  title: string;
  description: string;
  href: string;
  audience: ShareAudience;
  audienceLabel: string;
  message: string;
  icon: ComponentType<{ className?: string }>;
  priority?: number;
}

const SHARE_ITEMS: ShareHubItem[] = [
  {
    key: "map",
    title: "Food Map",
    description: "Send customers to the live map.",
    href: "/map",
    audience: "customers",
    audienceLabel: "Customers",
    icon: MapPinned,
    message: "Find food trucks, restaurants, and deals near you on MealScout:",
  },
  {
    key: "video",
    title: "Video Feed",
    description: "Share local food videos and recommendations.",
    href: "/video",
    audience: "customers",
    audienceLabel: "Customers",
    icon: Clapperboard,
    message: "Watch local food videos and recommendations on MealScout:",
  },
  {
    key: "truck-owner",
    title: "Add a Food Truck",
    description: "Invite a truck owner to claim or create a profile.",
    href: "/truck-onboarding",
    audience: "owners",
    audienceLabel: "Truck Owners",
    icon: Truck,
    priority: 1,
    message:
      "Get your food truck on MealScout so customers and hosts can find you:",
  },
  {
    key: "restaurant-owner",
    title: "Add a Restaurant",
    description: "Invite a restaurant or bar owner to join.",
    href: "/restaurant-signup",
    audience: "owners",
    audienceLabel: "Restaurant Owners",
    icon: Store,
    priority: 2,
    message:
      "Add your restaurant or bar to MealScout so local customers can discover you:",
  },
  {
    key: "host",
    title: "Host a Truck",
    description: "Send this to locations with usable parking space.",
    href: "/host-location-partner",
    audience: "hosts",
    audienceLabel: "Hosts",
    icon: Building2,
    priority: 3,
    message:
      "Have space for food trucks? Become a MealScout host location here:",
  },
  {
    key: "request-truck",
    title: "Book a Truck",
    description: "Use for catering, offices, apartments, and pop-ups.",
    href: "/request-truck",
    audience: "events",
    audienceLabel: "Events",
    icon: CalendarDays,
    message: "Need a food truck for an event or location? Start here:",
  },
  {
    key: "for-hosts",
    title: "Host Program",
    description: "Overview page for property owners and locations.",
    href: "/for-hosts",
    audience: "hosts",
    audienceLabel: "Hosts",
    icon: Users,
    message: "Here is how MealScout host locations work:",
  },
];

const FILTERS: Array<{ key: "all" | ShareAudience; label: string }> = [
  { key: "all", label: "All" },
  { key: "customers", label: "Customers" },
  { key: "owners", label: "Owners" },
  { key: "hosts", label: "Hosts" },
  { key: "events", label: "Events" },
];

const INTERNAL_SHARE_PATH = /^(?:\/admin(?:\/|$)|\/staff(?:\/|$))/i;

export default function ShareHub({
  mode,
  title,
  description,
  enableAffiliateLookup = false,
}: {
  mode: ShareHubMode;
  title: string;
  description: string;
  enableAffiliateLookup?: boolean;
}) {
  const { toast } = useToast();
  const [affiliateTag, setAffiliateTag] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | ShareAudience>(
    "all",
  );
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    if (!enableAffiliateLookup) return;
    let cancelled = false;
    fetch("/api/affiliate/tag", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.tag) setAffiliateTag(String(data.tag));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enableAffiliateLookup]);

  const items = useMemo(() => {
    const base = SHARE_ITEMS.filter(
      (item) => !INTERNAL_SHARE_PATH.test(item.href),
    );
    if (!affiliateTag) return base;
    const referralItem: ShareHubItem = {
      key: "referral",
      title: "My Referral Link",
      description: "Best all-purpose link. Referrals are credited to you.",
      href: `/ref/${affiliateTag}`,
      audience: "general",
      audienceLabel: "Referral",
      icon: Send,
      priority: 0,
      message: "Check out MealScout here:",
    };
    return [referralItem, ...base];
  }, [affiliateTag]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    return items.filter((item) => item.audience === activeFilter);
  }, [activeFilter, items]);

  const primaryItem = items[0];

  const absoluteUrl = (href: string) => {
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    if (typeof window === "undefined") return href;
    return `${window.location.origin}${href}`;
  };

  const shareText = (item: ShareHubItem) =>
    `${item.message} ${absoluteUrl(item.href)}`;

  const trackShareHubEvent = async (
    action: ShareAction,
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
      // Best-effort telemetry only.
    }
  };

  const copyToClipboard = async (
    value: string,
    item: ShareHubItem,
    action: Extract<ShareAction, "copy_link" | "copy_message">,
  ) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedKey(`${action}:${item.key}`);
      window.setTimeout(() => setCopiedKey(""), 1600);
      void trackShareHubEvent(action, item);
      toast({ title: "Copied", description: item.title });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission was blocked.",
        variant: "destructive",
      });
    }
  };

  const nativeShare = async (item: ShareHubItem) => {
    const url = absoluteUrl(item.href);
    if (!navigator.share) {
      await copyToClipboard(shareText(item), item, "copy_message");
      return;
    }
    try {
      await navigator.share({
        title: item.title,
        text: item.message,
        url,
      });
      void trackShareHubEvent("share", item);
    } catch {
      // User dismissed native share.
    }
  };

  const openChannel = (item: ShareHubItem, channel: ShareAction) => {
    const text = shareText(item);
    const url = absoluteUrl(item.href);
    let target = "";
    if (channel === "sms") target = `sms:?&body=${encodeURIComponent(text)}`;
    if (channel === "email") {
      target = `mailto:?subject=${encodeURIComponent(item.title)}&body=${encodeURIComponent(
        `${item.message}\n\n${url}`,
      )}`;
    }
    if (channel === "facebook") {
      target = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        url,
      )}`;
    }
    if (channel === "whatsapp") {
      target = `https://wa.me/?text=${encodeURIComponent(text)}`;
    }
    if (!target) return;
    void trackShareHubEvent(channel, item);
    window.location.href = target;
  };

  const copiedLabel = (
    item: ShareHubItem,
    action: "copy_link" | "copy_message",
  ) => copiedKey === `${action}:${item.key}`;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-text)]">
              <Send className="h-3.5 w-3.5" />
              Share
            </div>
            <h2 className="font-display text-3xl leading-none text-[color:var(--text-primary)] sm:text-4xl">
              {title}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--text-secondary)]">
              {description}
            </p>
          </div>

          {primaryItem ? (
            <div className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 lg:w-[24rem]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                  Best link
                </span>
                <Badge variant="secondary">{primaryItem.audienceLabel}</Badge>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--field-bg)] px-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                <span className="min-w-0 truncate text-sm font-medium text-[color:var(--text-primary)]">
                  {absoluteUrl(primaryItem.href)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      absoluteUrl(primaryItem.href),
                      primaryItem,
                      "copy_link",
                    )
                  }
                >
                  {copiedLabel(primaryItem, "copy_link") ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => nativeShare(primaryItem)}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Share
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            className={`h-9 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors ${
              activeFilter === filter.key
                ? "border-[color:var(--accent-text)] bg-[color:var(--accent-text)] text-black"
                : "border-[color:var(--border-subtle)] bg-[var(--bg-card)] text-[color:var(--text-primary)]"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.key}
              className="flex min-h-[19rem] flex-col rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-[color:var(--text-primary)]">
                      {item.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {mode !== "user" && typeof item.priority === "number" ? (
                        <Badge>{`P${item.priority}`}</Badge>
                      ) : null}
                      <Badge variant="secondary">{item.audienceLabel}</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
                {item.description}
              </p>

              <div className="mt-3 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm leading-6 text-[color:var(--text-primary)]">
                {item.message}
              </div>

              <div className="mt-auto pt-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      copyToClipboard(absoluteUrl(item.href), item, "copy_link")
                    }
                  >
                    {copiedLabel(item, "copy_link") ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      copyToClipboard(shareText(item), item, "copy_message")
                    }
                  >
                    {copiedLabel(item, "copy_message") ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <MessageCircle className="mr-2 h-4 w-4" />
                    )}
                    Message
                  </Button>
                </div>

                <div className="mt-2 grid grid-cols-5 gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Share ${item.title}`}
                    onClick={() => nativeShare(item)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Text ${item.title}`}
                    onClick={() => openChannel(item, "sms")}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Email ${item.title}`}
                    onClick={() => openChannel(item, "email")}
                  >
                    <Mail className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Share ${item.title} on Facebook`}
                    onClick={() => openChannel(item, "facebook")}
                  >
                    <Users className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" asChild>
                    <a
                      href={item.href}
                      aria-label={`Open ${item.title}`}
                      onClick={() => void trackShareHubEvent("open", item)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
