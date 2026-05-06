import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  MapPin,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";

import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import BrandedBackground, {
  type BrandedBackgroundKind,
} from "@/components/admin/welcome-card/branded-backgrounds";
import {
  buildWelcomeCardCaptions,
  PLATFORM_LABELS,
  type CaptionPlatform,
  type CaptionSignupKind,
} from "@/components/admin/welcome-card/build-captions";

type RecentSignupKind =
  | "customer"
  | "food_truck"
  | "restaurant"
  | "caterer"
  | "private_chef"
  | "host"
  | "supplier"
  | "team";

type RecentSignup = {
  key: string;
  kind: RecentSignupKind;
  entity: "restaurant" | "host" | "supplier" | "user";
  id: string;
  displayName: string;
  typeLabel: string;
  nounLabel?: string | null;
  category?: string | null;
  locationLabel?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  shareImageUrl?: string | null;
  websiteUrl?: string | null;
  menuUrl?: string | null;
  orderUrl?: string | null;
  menuCount?: number | null;
  menuItemCount?: number | null;
  menuItemNames?: string[] | null;
  videoCount?: number | null;
  spotCount?: number | null;
  canonicalProfilePath?: string | null;
  profileCompleteness?: Record<string, boolean>;
  insurance?: {
    required: boolean;
    status:
      | "valid"
      | "pending"
      | "rejected"
      | "expired"
      | "not_submitted"
      | "not_required";
    valid: boolean;
    expiresAt?: string | null;
    documentsCount?: number;
  } | null;
  profileUrl: string;
  shareUrl?: string | null;
  sharePath?: string | null;
  profilePath: string;
  isPublic: boolean;
  linkLabel?: string | null;
  isVerified: boolean;
  googlePlaceId?: string | null;
  googleRating?: string | number | null;
  googleReviewCount?: number | null;
  googleProfileLinked?: boolean;
  profileSource?: string | null;
  createdAt: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  facebookPageUrl?: string | null;
  caption: string;
};

type RecentSignupsResponse = {
  windowHours: number | null;
  includeAll?: boolean;
  includeFiltered?: boolean;
  filteredOut?: number;
  generatedAt: string;
  summary: {
    total: number;
    users: number;
    customers: number;
    foodTrucks: number;
    restaurants: number;
    caterers?: number;
    privateChefs?: number;
    hosts: number;
    suppliers: number;
    team: number;
    notPublic: number;
    insuranceValid?: number;
    insurancePending?: number;
    insuranceNeedsSubmission?: number;
  };
  signups: RecentSignup[];
  facebookPagePostingConfigured: boolean;
};

type FacebookShareResponse = {
  ok: boolean;
  needsConfig?: boolean;
  fallbackShareUrl?: string;
  message?: string;
  facebookPostId?: string | null;
  facebookPhotoId?: string | null;
};

/**
 * Welcome-card visual tones. Per Thomas's locked brand rules every card now
 * shares the same amber accent (#f59e0b); only the announcement label and
 * noun change per category. Backgrounds come from <BrandedBackground />.
 */
const toneByKind: Record<
  RecentSignupKind,
  {
    label: string;
    accent: string;
    badge: string;
    noun: string;
  }
> = {
  customer: {
    label: "Customer",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "member",
  },
  food_truck: {
    label: "Food Truck",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "truck",
  },
  restaurant: {
    label: "Restaurant",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "restaurant",
  },
  caterer: {
    label: "Caterer",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "caterer",
  },
  private_chef: {
    label: "Private Chef",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "private chef",
  },
  host: {
    label: "Host",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "host",
  },
  supplier: {
    label: "Supplier",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "supplier",
  },
  team: {
    label: "Team",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "team member",
  },
};

/**
 * Map a RecentSignupKind to a BrandedBackgroundKind. Customer + team are
 * filtered out before render so they never reach this map, but we keep the
 * fallback so type-safety holds.
 */
const backgroundKindFor = (kind: RecentSignupKind): BrandedBackgroundKind => {
  switch (kind) {
    case "food_truck":
      return "food_truck";
    case "restaurant":
      return "restaurant";
    case "caterer":
      return "caterer";
    case "private_chef":
      return "private_chef";
    case "host":
      return "host";
    case "supplier":
      return "supplier";
    default:
      return "default";
  }
};

const formatSignupAge = (value: string) => {
  const createdAt = new Date(value);
  if (Number.isNaN(createdAt.getTime())) return "recently";
  const minutes = Math.max(
    1,
    Math.round((Date.now() - createdAt.getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return createdAt.toLocaleDateString();
};

/**
 * Marquee-style launch-moment label for the welcome card.
 *
 * Welcome cards are generated at the moment of signup, before a business
 * has built any inventory (menu items, videos, banner). The card needs a
 * chip that is always honest at that moment, so we print one based purely
 * on the signup timestamp:
 *
 *   <= 72h old   -> "Just opened"
 *   <= 7d old    -> "This week"
 *   <= 30d old   -> "This month"
 *   older        -> "Now on MealScout"   (admin re-share, still safe)
 */
const launchMomentLabelFor = (createdAtIso: string): string => {
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) return "Now on MealScout";
  const ageMs = Date.now() - createdAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours <= 72) return "Just opened";
  if (ageHours <= 24 * 7) return "This week";
  if (ageHours <= 24 * 30) return "This month";
  return "Now on MealScout";
};

const initialsFor = (value: string) =>
  String(value || "MS")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "MS";

const shortShareUrl = (value: string, maxLength = 42) => {
  try {
    const url = new URL(value);
    const path = `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
    return path.length > maxLength
      ? `${path.slice(0, Math.max(10, maxLength - 3))}...`
      : path;
  } catch {
    const raw = String(value || "").replace(/^https?:\/\//, "");
    return raw.length > maxLength
      ? `${raw.slice(0, Math.max(10, maxLength - 3))}...`
      : raw;
  }
};

/**
 * Mission-aligned announcement labels. Read like a hand-painted marquee or
 * a neighborhood newspaper kicker - foot-traffic energy, never delivery.
 */
const announcementFor = (signup: RecentSignup) => {
  const labels: Record<RecentSignupKind, string> = {
    customer: "Now on MealScout",
    food_truck: "Now parked in town",
    restaurant: "Now open in town",
    caterer: "Now booking in town",
    private_chef: "Now at the pass",
    host: "Doors open in town",
    supplier: "Now stocking the scene",
    team: "New on the MealScout team",
  };
  return labels[signup.kind] || "Now on MealScout";
};

/**
 * Featured-tile copy. Mission-aligned: every line pushes the viewer toward
 * "go there," never "order it." Uses the locationLabel when present so it
 * feels local on the post.
 */
const graphicActionFor = (signup: RecentSignup) => {
  const where = signup.locationLabel
    ? signup.locationLabel.split(",")[0].trim()
    : "";
  const cityTag = where ? ` in ${where}` : "";
  if (signup.kind === "food_truck") return `Find them${cityTag} this week`;
  if (signup.kind === "caterer") return `Stop in${cityTag} and meet them`;
  if (signup.kind === "private_chef") return `Sit at their counter${cityTag}`;
  if (signup.kind === "host") return `Pull up${cityTag}`;
  if (signup.kind === "supplier") return `Visit their floor${cityTag}`;
  if (signup.kind === "restaurant") return `Stop in${cityTag} tonight`;
  return `Come find them${cityTag}`;
};

const completionLabel = (signup: RecentSignup) => {
  const checks = signup.profileCompleteness || {};
  const missing = Object.entries(checks)
    .filter(([key, value]) => key !== "isPublic" && !value)
    .map(([key]) =>
      key
        .replace(/^has/, "")
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase(),
    );
  if (!signup.isPublic) return "Not public yet";
  if (!missing.length) return "Launch-ready";
  return `Missing ${missing.slice(0, 2).join(", ")}`;
};

const insuranceLabel = (signup: RecentSignup) => {
  const insurance = signup.insurance;
  if (!insurance?.required) return null;
  if (insurance.valid) return "Insurance OK";
  if (insurance.status === "pending") return "Insurance pending";
  if (insurance.status === "rejected") return "Insurance rejected";
  if (insurance.status === "expired") return "Insurance expired";
  return "Needs insurance";
};

const insuranceBadgeVariant = (signup: RecentSignup) => {
  const insurance = signup.insurance;
  if (!insurance?.required || insurance.valid) return "outline" as const;
  if (insurance.status === "pending") return "secondary" as const;
  return "destructive" as const;
};

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

const waitForGraphicImages = async (root: HTMLElement) => {
  const images = Array.from(root.querySelectorAll("img"));
  if (!images.length) return;

  await Promise.race([
    Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete && image.naturalWidth > 0) {
              resolve();
              return;
            }
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          }),
      ),
    ),
    new Promise((resolve) => window.setTimeout(resolve, 2500)),
  ]);
};

export default function RecentSignupShare() {
  const { toast } = useToast();
  const graphicRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isBackfillingGoogle, setIsBackfillingGoogle] = useState(false);
  // Active caption platform per signup card. Lets the admin preview Facebook,
  // Instagram, or X copy without changing other cards. Defaults to Facebook
  // since that's the canonical/longest version.
  const [captionPlatformByKey, setCaptionPlatformByKey] = useState<
    Record<string, CaptionPlatform>
  >({});

  const { data, isLoading, isFetching, refetch } =
    useQuery<RecentSignupsResponse>({
      queryKey: ["/api/admin/recent-signups", "all"],
      queryFn: async () => {
        const res = await fetch("/api/admin/recent-signups?all=1", {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error("Failed to load recent signups");
        }
        return res.json();
      },
      refetchOnWindowFocus: false,
    });

  // Per locked brand rules, welcome cards generate ONLY for businesses
  // (and Critics, handled separately). Customer + team signups never get
  // a welcome graphic. They still flow through the API for admin counts,
  // but they are never rendered as cards here.
  const allSignups = data?.signups || [];
  const signups = allSignups.filter(
    (s) => s.kind !== "customer" && s.kind !== "team",
  );
  const hiddenNonBusinessCount =
    allSignups.length - signups.length;

  const captureGraphic = async (signup: RecentSignup) => {
    const target = graphicRefs.current[signup.key];
    if (!target) {
      throw new Error("Graphic preview is not ready yet");
    }

    const html2canvas = (await import("html2canvas")).default;
    const clone = target.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.left = "-10000px";
    clone.style.top = "0";
    clone.style.width = "1200px";
    clone.style.height = "630px";
    clone.style.maxWidth = "1200px";
    clone.style.minWidth = "1200px";
    clone.style.transform = "none";
    clone.style.zIndex = "-1";
    document.body.appendChild(clone);

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await waitForGraphicImages(clone);
      const canvas = await html2canvas(clone, {
        backgroundColor: null,
        width: 1200,
        height: 630,
        windowWidth: 1200,
        windowHeight: 630,
        scale: 1,
        logging: false,
        useCORS: true,
      });
      return canvas.toDataURL("image/png", 0.95);
    } finally {
      clone.remove();
    }
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  const handleDownload = async (signup: RecentSignup) => {
    try {
      setBusyKey(`${signup.key}:download`);
      const dataUrl = await captureGraphic(signup);
      downloadDataUrl(
        dataUrl,
        `mealscout-${signup.kind}-${signup.displayName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "") || signup.id}.png`,
      );
    } catch (error: any) {
      toast({
        title: "Could not create graphic",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleFacebookShare = async (signup: RecentSignup) => {
    try {
      setBusyKey(`${signup.key}:facebook`);
      const graphicDataUrl = await captureGraphic(signup);
      const res = await apiRequest(
        "POST",
        "/api/admin/recent-signups/facebook-share",
        {
          caption: signup.caption,
          profileUrl: signup.shareUrl || signup.profileUrl,
          graphicDataUrl,
        },
      );
      const result = (await res.json()) as FacebookShareResponse;

      if (result.ok) {
        toast({
          title: "Posted to Facebook",
          description: "The welcome graphic is live on the MealScout page.",
        });
        return;
      }

      if (result.fallbackShareUrl) {
        window.open(result.fallbackShareUrl, "_blank", "noopener,noreferrer");
      }
      toast({
        title: result.needsConfig
          ? "Connect Facebook Page to post directly"
          : "Manual Facebook share opened",
        description:
          result.message ||
          "Opened a manual Facebook share window with the profile link.",
      });
    } catch (error: any) {
      const fallbackShareUrl = error?.payload?.fallbackShareUrl;
      if (fallbackShareUrl) {
        window.open(fallbackShareUrl, "_blank", "noopener,noreferrer");
      }
      toast({
        title: "Could not share to Facebook",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleGoogleBackfill = async () => {
    try {
      setIsBackfillingGoogle(true);
      const res = await apiRequest(
        "POST",
        "/api/admin/recent-signups/backfill-google",
        { all: true, limit: 80 },
      );
      const result = await res.json();
      await refetch();
      toast({
        title: "Google listing check complete",
        description: `Linked ${Number(result?.linked?.restaurants || 0) + Number(result?.linked?.hosts || 0)} profile${Number(result?.linked?.restaurants || 0) + Number(result?.linked?.hosts || 0) === 1 ? "" : "s"}.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not backfill Google listings",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsBackfillingGoogle(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-orange-500" />
              Recent Signup Graphics
            </CardTitle>
            <CardDescription>
              Ready-to-share welcome cards for active users and businesses, with
              profile details added when available.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGoogleBackfill}
              disabled={isBackfillingGoogle || isFetching}
            >
              {isBackfillingGoogle ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Sync Google
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">All signups</p>
              <p className="text-2xl font-semibold">
                {data?.summary.total ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Users</p>
              <p className="text-2xl font-semibold">
                {data?.summary.users ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Customers</p>
              <p className="text-2xl font-semibold">
                {data?.summary.customers ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Trucks</p>
              <p className="text-2xl font-semibold">
                {data?.summary.foodTrucks ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Restaurants</p>
              <p className="text-2xl font-semibold">
                {data?.summary.restaurants ?? 0}
              </p>
            </div>
            {(data?.summary.caterers ?? 0) > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Caterers</p>
                <p className="text-2xl font-semibold">
                  {data?.summary.caterers ?? 0}
                </p>
              </div>
            ) : null}
            {(data?.summary.privateChefs ?? 0) > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Private Chefs</p>
                <p className="text-2xl font-semibold">
                  {data?.summary.privateChefs ?? 0}
                </p>
              </div>
            ) : null}
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Hosts</p>
              <p className="text-2xl font-semibold">
                {data?.summary.hosts ?? 0}
              </p>
            </div>
            {(data?.summary.suppliers ?? 0) > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Suppliers</p>
                <p className="text-2xl font-semibold">
                  {data?.summary.suppliers ?? 0}
                </p>
              </div>
            ) : null}
            {(data?.summary.team ?? 0) > 0 ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Team</p>
                <p className="text-2xl font-semibold">
                  {data?.summary.team ?? 0}
                </p>
              </div>
            ) : null}
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Not public yet</p>
              <p className="text-2xl font-semibold">
                {data?.summary.notPublic ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Insurance OK</p>
              <p className="text-2xl font-semibold">
                {data?.summary.insuranceValid ?? 0}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Needs proof</p>
              <p className="text-2xl font-semibold">
                {data?.summary.insuranceNeedsSubmission ?? 0}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant={data?.facebookPagePostingConfigured ? "default" : "outline"}
            >
              {data?.facebookPagePostingConfigured
                ? "Facebook Page posting ready"
                : "Facebook Page not connected"}
            </Badge>
            <span>
              Direct posting opens from here once the MealScout Facebook Page is
              connected.
            </span>
            {data?.filteredOut ? (
              <span>
                {data.filteredOut} deleted, demo, or blocked signup
                {data.filteredOut === 1 ? "" : "s"} hidden.
              </span>
            ) : null}
            {hiddenNonBusinessCount > 0 ? (
              <span>
                {hiddenNonBusinessCount} customer or team signup
                {hiddenNonBusinessCount === 1 ? "" : "s"} hidden (welcome
                cards generate for businesses and critics only).
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-40 items-center justify-center">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading recent signups...
          </CardContent>
        </Card>
      ) : signups.length === 0 ? (
        <Card>
          <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">
              No new user signups in the last 48 hours.
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              When someone joins, their welcome graphic will appear here with
              share copy and the best public destination available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {signups.map((signup) => {
            const tone = toneByKind[signup.kind] || toneByKind.customer;
            const isPosting = busyKey === `${signup.key}:facebook`;
            const isDownloading = busyKey === `${signup.key}:download`;
            const graphicImageUrl = signup.shareImageUrl || signup.imageUrl;
            const hasBusinessImage = Boolean(graphicImageUrl);
            const readiness = completionLabel(signup);
            const insuranceReadiness = insuranceLabel(signup);
            const profileDestination = signup.isPublic
              ? "Public profile"
              : "Visitor fallback";
            const cleanShareUrl = signup.shareUrl || signup.profileUrl;
            const graphicUrlLabel = shortShareUrl(cleanShareUrl, 38);
            const statusText = signup.isPublic
              ? "Live public profile"
              : "Profile finishing";
            const nameLength = signup.displayName.length;
            const graphicNameClass =
              nameLength > 46
                ? "text-[3.2cqw]"
                : nameLength > 32
                  ? "text-[3.8cqw]"
                  : nameLength > 22
                    ? "text-[4.5cqw]"
                    : "text-[5.35cqw]";
            /**
             * Launch-moment subline.
             *
             * Welcome cards are generated at signup, before any inventory
             * (menu items, videos, banner, descriptions). The subline must
             * be honest at that moment, so it is built ONLY from fields the
             * business actually filled out on the signup form:
             *   - category   (e.g. "BBQ", "Tex-Mex")
             *   - typeLabel  (e.g. "Food Truck", "Restaurant")
             *   - city       (split off the locationLabel comma)
             *
             * We never fall back to menu highlights or description here.
             * Description tends to be scraped/owner-blurb and contradicts
             * the launch-moment framing. Menu items are an inventory system
             * surfaced elsewhere.
             */
            const sublineCity = signup.locationLabel
              ? signup.locationLabel.split(",")[0].trim()
              : "";
            const sublineKind =
              signup.category || signup.typeLabel || "";
            const graphicSubline =
              [sublineKind, sublineCity].filter(Boolean).join(" \u00B7 ") ||
              `Now on MealScout`;
            const announcement = announcementFor(signup);
            const graphicAction = graphicActionFor(signup);
            const imageAlt = `${signup.displayName} profile image`;
            const launchMomentLabel = launchMomentLabelFor(signup.createdAt);

            return (
              <Card key={signup.key} className="overflow-hidden">
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">
                        {signup.displayName}
                      </CardTitle>
                      <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                        <span>{signup.typeLabel}</span>
                        {signup.locationLabel ? (
                          <>
                            <span aria-hidden="true">.</span>
                            <span>{signup.locationLabel}</span>
                          </>
                        ) : null}
                        <span aria-hidden="true">.</span>
                        <span>{formatSignupAge(signup.createdAt)}</span>
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={tone.badge}>{tone.label}</Badge>
                      <Badge variant={signup.isPublic ? "outline" : "secondary"}>
                        {signup.linkLabel || profileDestination}
                      </Badge>
                      <Badge variant="outline">{readiness}</Badge>
                      {insuranceReadiness ? (
                        <Badge variant={insuranceBadgeVariant(signup)}>
                          <ShieldCheck className="mr-1 h-3 w-3" />
                          {insuranceReadiness}
                        </Badge>
                      ) : null}
                      {Number(signup.menuItemCount || 0) > 0 ? (
                        <Badge variant="outline">
                          {signup.menuItemCount} menu item
                          {Number(signup.menuItemCount) === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      {Number(signup.videoCount || 0) > 0 ? (
                        <Badge variant="outline">
                          {signup.videoCount} video
                          {Number(signup.videoCount) === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      {/*
                       * Google linked indicator. We surface ONLY that the
                       * Google profile is linked - never the rating value.
                       * The numeric Google rating remains a backend-only
                       * signal feeding the existing internal score/ranking
                       * system; we do not want to re-create star-based
                       * comparison in the admin UI either.
                       */}
                      {signup.googleProfileLinked || signup.googlePlaceId ? (
                        <Badge variant="outline">Google linked</Badge>
                      ) : null}
                      {signup.spotCount ? (
                        <Badge variant="outline">
                          {signup.spotCount} host spot
                          {Number(signup.spotCount) === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/*
                   * Welcome-card visual (1200x630 export size).
                   * - Branded SVG background per category (no scraped photos).
                   * - User photo (when present) shown as a contained circular
                   *   thumbnail in the right panel, NOT as a full-bleed blurry
                   *   background.
                   * - Editorial Playfair Display headline.
                   * - "Follow The Flavor." tagline locked into bottom right.
                   */}
                  {/*
                   * MAGAZINE-COVER LAYOUT (Round 3a).
                   * - Brand panel LEFT ~42% (kicker, headline, subline,
                   *   real-data signal chips, tagline, profile/affiliate URL).
                   * - Hero panel RIGHT ~58% (uploaded banner if present;
                   *   otherwise the BrandedBackground's typographic
                   *   destination word reads through as the hero).
                   * - Every signal chip pulls only from real signup fields.
                   *   Missing field = chip omitted (never invented).
                   */}
                  <div
                    ref={(node) => {
                      graphicRefs.current[signup.key] = node;
                    }}
                    className="relative aspect-[1200/630] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#050505] text-white shadow-sm"
                    style={{ containerType: "inline-size" }}
                  >
                    {/* Atmospheric room backdrop, always under everything */}
                    <BrandedBackground kind={backgroundKindFor(signup.kind)} />

                    <div className="relative flex h-full w-full">
                      {/* ============================================ */}
                      {/* LEFT  -  brand panel (~42%)                  */}
                      {/* ============================================ */}
                      <div className="relative z-10 flex w-[42%] flex-col justify-between p-[3.4cqw]">
                        {/* Top: MealScout mark + ornamental amber rule */}
                        <div>
                          <div className="flex items-center gap-[0.9cqw]">
                            <span className="flex h-[3cqw] w-[3cqw] items-center justify-center rounded-full bg-white text-[0.85cqw] font-black tracking-normal text-black shadow-[0_4px_12px_rgba(245,158,11,0.35)]">
                              MS
                            </span>
                            <span className="text-[1.05cqw] font-bold uppercase tracking-[0.28em] text-white/90">
                              MealScout
                            </span>
                          </div>
                          <div
                            className="mt-[1.6cqw] flex items-center gap-[0.7cqw]"
                            aria-hidden="true"
                          >
                            <span
                              className="h-[0.18cqw] w-[3.6cqw] rounded-full"
                              style={{ backgroundColor: tone.accent }}
                            />
                            <span
                              className="h-[0.7cqw] w-[0.7cqw] rotate-45"
                              style={{ backgroundColor: tone.accent }}
                            />
                            <span
                              className="h-[0.18cqw] flex-1 rounded-full opacity-60"
                              style={{ backgroundColor: tone.accent }}
                            />
                          </div>
                        </div>

                        {/* Middle: kicker -> name -> subline -> chips */}
                        <div className="flex flex-col">
                          {/* Bebas-style kicker, marquee feel */}
                          <p
                            className="text-[1.3cqw] font-normal uppercase tracking-[0.32em] text-amber-300"
                            style={{
                              fontFamily:
                                "'Bebas Neue', 'Impact', system-ui, sans-serif",
                            }}
                          >
                            {announcement}
                          </p>

                          {/* Editorial italic Playfair name */}
                          <h3
                            className={`mt-[1.2cqw] break-words ${graphicNameClass} font-bold italic leading-[0.95] text-white drop-shadow-[0_3px_18px_rgba(0,0,0,.55)]`}
                            style={{
                              fontFamily:
                                "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                              letterSpacing: "-0.01em",
                            }}
                          >
                            {signup.displayName}
                          </h3>

                          {/* Cuisine / menu subline (real data only) */}
                          {graphicSubline ? (
                            <p
                              className="mt-[1.4cqw] line-clamp-2 text-[1.3cqw] font-medium italic leading-tight text-white/85"
                              style={{
                                fontFamily:
                                  "'Cormorant Garamond', 'Playfair Display', Georgia, serif",
                              }}
                            >
                              {graphicSubline}
                            </p>
                          ) : null}

                          {/* Vintage signal chips - launch-moment ONLY.
                           *
                           * Welcome cards are generated the moment a business
                           * joins MealScout, before they have menu items,
                           * videos, banners, or recommendations. Anchoring
                           * chips on inventory would either lie or print
                           * a card with no chips at all.
                           *
                           * Instead the chips reflect what is always true at
                           * launch:
                           *   - signup recency  ("Just opened" / "This week")
                           *   - business kind   ("Food Truck", "Restaurant")
                           *   - neighborhood    (rendered below, real-only)
                           *   - profile status  (rendered below, always set)
                           *
                           * Google ratings are intentionally NOT shown in
                           * user-facing UI. They remain a backend-only signal
                           * that feeds the existing score/ranking system.
                           * Profile imagery / share artifacts are handled by
                           * a separate system and are not surfaced here.
                           */}
                          <div className="mt-[1.8cqw] flex flex-wrap items-center gap-[0.7cqw]">
                            {/* Launch-moment chip: when did they open on MealScout? */}
                            <span
                              className="inline-flex items-center gap-[0.45cqw] rounded-[0.35cqw] px-[1cqw] py-[0.45cqw] text-[0.95cqw] font-bold uppercase tracking-[0.22em] text-black shadow-[0_4px_18px_rgba(245,158,11,0.35)]"
                              style={{ backgroundColor: tone.accent }}
                            >
                              <span
                                className="h-[0.55cqw] w-[0.55cqw] rounded-full bg-black/70"
                                aria-hidden="true"
                              />
                              {launchMomentLabel}
                            </span>

                            {/* Business-kind chip - always present, never invented */}
                            <span className="inline-flex items-center gap-[0.45cqw] rounded-[0.35cqw] border border-amber-300/55 bg-amber-300/10 px-[1cqw] py-[0.45cqw] text-[0.95cqw] font-bold uppercase tracking-[0.22em] text-amber-200">
                              <span
                                className="h-[0.55cqw] w-[0.55cqw] rotate-45"
                                style={{ backgroundColor: tone.accent }}
                                aria-hidden="true"
                              />
                              {tone.label}
                            </span>

                            {/* Neighborhood / city kicker */}
                            {signup.locationLabel ? (
                              <span className="inline-flex items-center gap-[0.45cqw] rounded-[0.35cqw] border border-white/25 bg-black/45 px-[1cqw] py-[0.45cqw] text-[0.95cqw] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                                <MapPin
                                  className="h-[1cqw] w-[1cqw] shrink-0"
                                  style={{ color: tone.accent }}
                                />
                                {signup.locationLabel
                                  .split(",")[0]
                                  .trim()
                                  .toUpperCase()}
                              </span>
                            ) : null}

                            {/* Live profile / status marquee tag */}
                            <span
                              className="inline-flex items-center gap-[0.45cqw] rounded-[0.35cqw] px-[1cqw] py-[0.45cqw] text-[0.95cqw] font-bold uppercase tracking-[0.18em] text-black"
                              style={{ backgroundColor: tone.accent }}
                            >
                              {statusText}
                            </span>
                          </div>
                        </div>

                        {/* Bottom: tagline + profile (affiliate) link */}
                        <div>
                          <p
                            className="text-[1.85cqw] font-bold italic leading-none text-amber-300"
                            style={{
                              fontFamily:
                                "'Playfair Display', Georgia, serif",
                              letterSpacing: "0.005em",
                            }}
                          >
                            Follow The Flavor.
                          </p>
                          <div className="mt-[1cqw] flex items-center gap-[0.6cqw]">
                            <span
                              className="h-[0.18cqw] w-[2cqw] rounded-full"
                              style={{ backgroundColor: tone.accent }}
                              aria-hidden="true"
                            />
                            <p className="text-[0.78cqw] font-bold uppercase tracking-[0.28em] text-white/55">
                              Find them on MealScout
                            </p>
                          </div>
                          <div className="mt-[0.7cqw] flex min-w-0 items-center gap-[0.6cqw] text-[1.2cqw] font-semibold text-white">
                            <span className="min-w-0 truncate">
                              {graphicUrlLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* ============================================ */}
                      {/* RIGHT  -  hero panel (~58%)                  */}
                      {/* ============================================ */}
                      <div className="relative w-[58%] overflow-hidden">
                        {/* Vertical seam between brand and hero */}
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-[6%] h-[88%] w-[0.18cqw] rounded-full"
                          style={{
                            backgroundColor: tone.accent,
                            opacity: 0.55,
                          }}
                        />

                        {hasBusinessImage ? (
                          <>
                            {/*
                             * Owner-uploaded banner. Contained, never blown
                             * out. Dark gradient on top of it keeps the
                             * brand panel readable regardless of image
                             * brightness; amber underglow at the bottom
                             * mimics signage spill into the room.
                             */}
                            <img
                              src={graphicImageUrl || ""}
                              alt={imageAlt}
                              crossOrigin="anonymous"
                              className="h-full w-full object-cover"
                            />
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0"
                              style={{
                                background:
                                  "linear-gradient(90deg, rgba(5,5,5,0.92) 0%, rgba(5,5,5,0.55) 18%, rgba(5,5,5,0) 42%, rgba(5,5,5,0) 70%, rgba(5,5,5,0.45) 100%)",
                              }}
                            />
                            <div
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-x-0 bottom-0 h-[35%]"
                              style={{
                                background:
                                  "linear-gradient(0deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0) 100%)",
                              }}
                            />
                          </>
                        ) : (
                          /*
                           * No banner uploaded. The atmospheric
                           * BrandedBackground already paints the oversized
                           * destination word (TRUCK / DINER / BAR /
                           * KITCHEN / etc.) across the full canvas. We add
                           * only a soft amber inner vignette here so the
                           * right panel still reads as the hero target.
                           */
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0"
                            style={{
                              background:
                                "radial-gradient(ellipse at 65% 45%, rgba(245,158,11,0.18) 0%, rgba(5,5,5,0) 60%)",
                            }}
                          />
                        )}

                        {/* Featured CTA, anchored bottom-right of hero */}
                        <div className="absolute bottom-[3cqw] right-[3cqw] z-10 max-w-[34cqw]">
                          <div className="rounded-[0.6cqw] border border-amber-300/55 bg-black/65 px-[1.6cqw] py-[1.1cqw] backdrop-blur-md">
                            <p
                              className="text-[0.85cqw] font-bold uppercase tracking-[0.32em] text-amber-300"
                              style={{
                                fontFamily:
                                  "'Bebas Neue', 'Impact', system-ui, sans-serif",
                              }}
                            >
                              Featured on MealScout
                            </p>
                            <p
                              className="mt-[0.5cqw] line-clamp-2 text-[1.4cqw] font-bold italic leading-tight text-white"
                              style={{
                                fontFamily:
                                  "'Playfair Display', Georgia, serif",
                              }}
                            >
                              {graphicAction}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/*
                   * Per-platform captions (Round 2). Each variant is built
                   * client-side from real signup fields via
                   * buildWelcomeCardCaptions(). The Facebook variant matches
                   * the long-form server caption; IG and X are derived locally
                   * with platform-specific limits and conventions.
                   */}
                  {(() => {
                    const captions = buildWelcomeCardCaptions({
                      displayName: signup.displayName,
                      kind: signup.kind as CaptionSignupKind,
                      typeLabel: signup.typeLabel,
                      locationLabel: signup.locationLabel,
                      profileUrl: signup.profileUrl,
                      shareUrl: signup.shareUrl,
                      category: signup.category,
                      menuItemNames: signup.menuItemNames,
                      videoCount: signup.videoCount,
                      websiteUrl: signup.websiteUrl,
                      menuUrl: signup.menuUrl,
                      orderUrl: signup.orderUrl,
                    });
                    const activePlatform: CaptionPlatform =
                      captionPlatformByKey[signup.key] || "facebook";
                    const active = captions[activePlatform];
                    const platformOrder: CaptionPlatform[] = [
                      "facebook",
                      "instagram",
                      "x",
                    ];
                    return (
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div
                            role="tablist"
                            aria-label="Caption platform"
                            className="inline-flex rounded-full border border-amber-400/30 bg-black/30 p-0.5"
                          >
                            {platformOrder.map((p) => {
                              const selected = activePlatform === p;
                              return (
                                <button
                                  key={p}
                                  role="tab"
                                  type="button"
                                  aria-selected={selected}
                                  aria-pressed={selected}
                                  onClick={() =>
                                    setCaptionPlatformByKey((prev) => ({
                                      ...prev,
                                      [signup.key]: p,
                                    }))
                                  }
                                  className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                                    selected
                                      ? "bg-amber-400 text-black"
                                      : "text-amber-200/80 hover:text-amber-100"
                                  }`}
                                >
                                  {PLATFORM_LABELS[p]}
                                </button>
                              );
                            })}
                          </div>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wider ${
                              active.withinLimit
                                ? "text-muted-foreground"
                                : "text-red-400"
                            }`}
                          >
                            {active.length}
                            {active.platform === "x"
                              ? ` / ${active.charLimit}`
                              : active.platform === "instagram"
                                ? ` / ${active.charLimit}`
                                : " chars"}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {active.composed}
                        </p>
                        {!active.withinLimit ? (
                          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-red-400">
                            Over the {PLATFORM_LABELS[active.platform]} limit —
                            shorten before posting.
                          </p>
                        ) : null}
                      </div>
                    );
                  })()}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => handleFacebookShare(signup)}
                      disabled={!!busyKey}
                    >
                      {isPosting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Post to Facebook
                    </Button>
                    {/*
                     * Copy active platform caption. We rebuild here so the
                     * button always copies the latest variant matching the
                     * active tab without needing to lift state out of the IIFE.
                     */}
                    {(() => {
                      const captions = buildWelcomeCardCaptions({
                        displayName: signup.displayName,
                        kind: signup.kind as CaptionSignupKind,
                        typeLabel: signup.typeLabel,
                        locationLabel: signup.locationLabel,
                        profileUrl: signup.profileUrl,
                        shareUrl: signup.shareUrl,
                        category: signup.category,
                        menuItemNames: signup.menuItemNames,
                        videoCount: signup.videoCount,
                        websiteUrl: signup.websiteUrl,
                        menuUrl: signup.menuUrl,
                        orderUrl: signup.orderUrl,
                      });
                      const activePlatform: CaptionPlatform =
                        captionPlatformByKey[signup.key] || "facebook";
                      const active = captions[activePlatform];
                      return (
                        <Button
                          variant="outline"
                          onClick={() =>
                            copyText(
                              active.composed,
                              `${PLATFORM_LABELS[activePlatform]} caption`,
                            )
                          }
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Copy {PLATFORM_LABELS[activePlatform]}
                        </Button>
                      );
                    })()}
                    <Button
                      variant="outline"
                      onClick={() => copyText(cleanShareUrl, "Profile link")}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Link
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleDownload(signup)}
                      disabled={!!busyKey}
                    >
                      {isDownloading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      PNG
                    </Button>
                    <Link href={signup.profilePath}>
                      <Button variant="ghost">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Preview profile
                      </Button>
                    </Link>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {new Date(signup.createdAt).toLocaleString()}
                    </span>
                    {signup.ownerEmail ? <span>{signup.ownerEmail}</span> : null}
                    {insuranceReadiness ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {insuranceReadiness}
                      </span>
                    ) : null}
                    {signup.facebookPageUrl ? (
                      <a
                        className="inline-flex items-center gap-1 font-medium text-orange-600"
                        href={signup.facebookPageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Facebook page available for manual tagging
                      </a>
                    ) : (
                      <span>Tagging depends on a connected Facebook page.</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
