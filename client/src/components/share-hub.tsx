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
import { getAffiliateShareUrl } from "@/lib/share";

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
  cleanOwnerLink?: boolean;
  shareHint?: string;
}

type OwnedRestaurant = {
  id: string;
  name?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  isActive?: boolean | null;
};

type OwnedHost = {
  id: string;
  businessName?: string | null;
  locationType?: string | null;
};

const SHARE_ITEMS: ShareHubItem[] = [
  {
    key: "map",
    title: "Food Map",
    description: "Send people straight to nearby food.",
    href: "/map",
    audience: "customers",
    audienceLabel: "Customers",
    icon: MapPinned,
    message: "Find food trucks, restaurants, and deals near you on MealScout:",
  },
  {
    key: "video",
    title: "Video Feed",
    description: "Give customers a quick taste of the local feed.",
    href: "/video",
    audience: "customers",
    audienceLabel: "Customers",
    icon: Clapperboard,
    message: "Watch local food videos and recommendations on MealScout:",
  },
  {
    key: "truck-owner",
    title: "Add a Food Truck",
    description: "Invite a truck owner to get found.",
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
    description: "Send this to lots, breweries, offices, and venues.",
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
    title: "Create an Event",
    description: "Public or private first, then one-time or recurring.",
    href: "/event-signup",
    audience: "events",
    audienceLabel: "Events",
    icon: CalendarDays,
    message:
      "Create an event on MealScout. Pick public or private, then one-time or recurring so the flow matches:",
  },
  {
    key: "for-hosts",
    title: "Host Program",
    description: "A simple overview for property owners and locations.",
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

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const absoluteUrl = (href: string) => {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (typeof window === "undefined") return href;
  return `${window.location.origin}${href}`;
};

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
  const [ownedRestaurants, setOwnedRestaurants] = useState<OwnedRestaurant[]>(
    [],
  );
  const [ownedHosts, setOwnedHosts] = useState<OwnedHost[]>([]);
  const [shareUrlCache, setShareUrlCache] = useState<Record<string, string>>(
    {},
  );
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

  useEffect(() => {
    if (!enableAffiliateLookup) return;
    let cancelled = false;

    fetch("/api/restaurants/my-restaurants", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        setOwnedRestaurants(Array.isArray(data) ? data : []);
      })
      .catch(() => {});

    fetch("/api/hosts", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        setOwnedHosts(Array.isArray(data) ? data : []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enableAffiliateLookup]);

  const items = useMemo(() => {
    const selfPromoItems: ShareHubItem[] = [];
    const activeRestaurants = ownedRestaurants
      .filter((restaurant) => restaurant?.id && restaurant.isActive !== false)
      .slice(0, 4);

    activeRestaurants.forEach((restaurant, index) => {
      const name = String(restaurant.name || "My business").trim();
      const slug = toSlug(name) || restaurant.id;
      const isTruck =
        Boolean(restaurant.isFoodTruck) ||
        String(restaurant.businessType || "").toLowerCase() === "food_truck";
      const isCaterer =
        String(restaurant.businessType || "").toLowerCase() === "caterer";
      const isPrivateChef =
        String(restaurant.businessType || "").toLowerCase() ===
        "private_chef";
      const businessLabel = isTruck
        ? "Food Truck"
        : isPrivateChef
          ? "Private Chef"
        : isCaterer
          ? "Caterer"
          : "Public Profile";
      const profileSlug = `${slug}--${restaurant.id}`;
      const profileHref = isTruck
        ? `/truck/${profileSlug}`
        : `/restaurant/${restaurant.id}/${slug}`;

      selfPromoItems.push({
        key: `restaurant-profile:${restaurant.id}`,
        title: index === 0 ? "My Public Profile" : `${name} Profile`,
        description: "Post this in bios, stories, flyers, and DMs.",
        href: profileHref,
        audience: "customers",
        audienceLabel: businessLabel,
        icon: isTruck ? Truck : isCaterer ? Users : Store,
        priority: 0,
        cleanOwnerLink: true,
        shareHint: "Clean link. You still get credit.",
        message: isCaterer
          ? `Book catering with ${name} on MealScout:`
          : `Follow, order, and book ${name} on MealScout:`,
      });

      if (index === 0) {
        selfPromoItems.push({
          key: `restaurant-menu:${restaurant.id}`,
          title: isTruck ? "Truck Menu Link" : "Menu Link",
          description: "Send customers straight to what they can buy.",
          href: `/menu/${restaurant.id}`,
          audience: "customers",
          audienceLabel: "Menu",
          icon: Link2,
          cleanOwnerLink: true,
          shareHint: "Clean link. You still get credit.",
          message: `See the menu for ${name} on MealScout:`,
        });
      }
    });

    ownedHosts
      .filter((host) => host?.id)
      .slice(0, 2)
      .forEach((host, index) => {
        const name = String(host.businessName || "My host location").trim();
        const slug = toSlug(name) || host.id;
        const profileSlug = `${slug}--${host.id}`;
        selfPromoItems.push({
          key: `host-profile:${host.id}`,
          title: index === 0 ? "My Host Profile" : `${name} Host Link`,
          description: "Share your truck-friendly location page.",
          href: `/location/${profileSlug}`,
          audience: "hosts",
          audienceLabel: "Host Profile",
          icon: Building2,
          cleanOwnerLink: true,
          shareHint: "Clean link. You still get credit.",
          message: `Book or request food truck parking at ${name} on MealScout:`,
        });
      });

    const base = SHARE_ITEMS.filter(
      (item) => !INTERNAL_SHARE_PATH.test(item.href),
    );

    const referralItem: ShareHubItem | null = affiliateTag
      ? {
          key: "referral",
          title: "My Referral Link",
          description: "Best all-purpose link when you are not sharing a profile.",
          href: `/ref/${affiliateTag}`,
          audience: "general",
          audienceLabel: "Referral",
          icon: Send,
          priority: 0,
          shareHint: "Tracks to you.",
          message: "Check out MealScout here:",
        }
      : null;

    return [
      ...selfPromoItems,
      ...(referralItem ? [referralItem] : []),
      ...base,
    ];
  }, [affiliateTag, ownedHosts, ownedRestaurants]);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;
    return items.filter((item) => item.audience === activeFilter);
  }, [activeFilter, items]);

  const primaryItem = items[0];

  const displayUrl = (item: ShareHubItem) => {
    const cached = shareUrlCache[item.key];
    if (cached) return cached;
    const cleanUrl = absoluteUrl(item.href);
    if (item.cleanOwnerLink || item.href.startsWith("/ref/")) return cleanUrl;
    return affiliateTag
      ? absoluteUrl(`/ref/${encodeURIComponent(affiliateTag)}${item.href}`)
      : cleanUrl;
  };

  const getItemShareUrl = async (item: ShareHubItem) => {
    const cached = shareUrlCache[item.key];
    if (cached) return cached;

    const shareUrl =
      item.cleanOwnerLink || item.href.startsWith("/ref/")
        ? absoluteUrl(item.href)
        : await getAffiliateShareUrl(item.href);

    setShareUrlCache((current) => ({ ...current, [item.key]: shareUrl }));
    return shareUrl;
  };

  const shareText = async (item: ShareHubItem) =>
    `${item.message} ${await getItemShareUrl(item)}`;

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
            cleanOwnerLink: Boolean(item.cleanOwnerLink),
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
      toast({
        title: "Copied",
        description: item.cleanOwnerLink
          ? "Clean link copied. You still get credit."
          : item.title,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission was blocked.",
        variant: "destructive",
      });
    }
  };

  const nativeShare = async (item: ShareHubItem) => {
    const url = await getItemShareUrl(item);
    if (!navigator.share) {
      await copyToClipboard(await shareText(item), item, "copy_message");
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

  const openChannel = async (item: ShareHubItem, channel: ShareAction) => {
    const text = await shareText(item);
    const url = await getItemShareUrl(item);
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
    <div className="space-y-4">
      <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-text)]">
              <Send className="h-3.5 w-3.5" />
              Share links
            </div>
            <h2 className="font-display text-2xl leading-tight text-[color:var(--text-primary)] sm:text-3xl">
              {title}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-[color:var(--text-secondary)]">
              {description}
            </p>
          </div>

          {primaryItem ? (
            <div className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 lg:w-[25rem]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[color:var(--text-muted)]">
                  Start here
                </span>
                <Badge variant="secondary">{primaryItem.audienceLabel}</Badge>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--field-bg)] px-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                <span className="min-w-0 truncate text-sm font-medium text-[color:var(--text-primary)]">
                  {displayUrl(primaryItem)}
                </span>
              </div>
              {primaryItem.shareHint ? (
                <p className="mt-2 text-xs font-medium text-[color:var(--accent-text)]">
                  {primaryItem.shareHint}
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  onClick={async () =>
                    copyToClipboard(
                      await getItemShareUrl(primaryItem),
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
                  onClick={() => void nativeShare(primaryItem)}
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
            className={`h-8 shrink-0 rounded-full border px-3 text-sm font-semibold transition-colors ${
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
              className="flex min-h-[13rem] flex-col rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-base font-bold text-[color:var(--text-primary)]">
                      {item.title}
                    </h3>
                    {mode !== "user" && typeof item.priority === "number" ? (
                      <Badge>{`P${item.priority}`}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{item.audienceLabel}</Badge>
                    {item.shareHint ? (
                      <Badge variant="outline">{item.shareHint}</Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              <p className="mt-3 line-clamp-2 text-sm leading-5 text-[color:var(--text-secondary)]">
                {item.description}
              </p>

              <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-[color:var(--accent-text)]" />
                <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--text-primary)]">
                  {displayUrl(item)}
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-xs text-[color:var(--text-muted)]">
                {item.message}
              </p>

              <div className="mt-auto pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    onClick={async () =>
                      copyToClipboard(
                        await getItemShareUrl(item),
                        item,
                        "copy_link",
                      )
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
                    onClick={async () =>
                      copyToClipboard(
                        await shareText(item),
                        item,
                        "copy_message",
                      )
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

                <div className="mt-2 grid grid-cols-5 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Share ${item.title}`}
                    onClick={() => void nativeShare(item)}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Text ${item.title}`}
                    onClick={() => void openChannel(item, "sms")}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Email ${item.title}`}
                    onClick={() => void openChannel(item, "email")}
                  >
                    <Mail className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Share ${item.title} on Facebook`}
                    onClick={() => void openChannel(item, "facebook")}
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
