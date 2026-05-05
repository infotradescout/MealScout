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

const toneByKind: Record<
  RecentSignupKind,
  {
    label: string;
    gradient: string;
    accent: string;
    badge: string;
    noun: string;
  }
> = {
  customer: {
    label: "Customer",
    gradient:
      "linear-gradient(135deg, #111111 0%, #23211a 38%, #10302b 100%)",
    accent: "#facc15",
    badge: "bg-yellow-300 text-black",
    noun: "member",
  },
  food_truck: {
    label: "Food Truck",
    gradient:
      "linear-gradient(135deg, #111111 0%, #241307 38%, #0d2d2b 100%)",
    accent: "#ff9f0a",
    badge: "bg-orange-500 text-black",
    noun: "truck",
  },
  restaurant: {
    label: "Restaurant",
    gradient:
      "linear-gradient(135deg, #111111 0%, #10251b 40%, #33220a 100%)",
    accent: "#22c55e",
    badge: "bg-emerald-400 text-black",
    noun: "restaurant",
  },
  caterer: {
    label: "Caterer",
    gradient:
      "linear-gradient(135deg, #111111 0%, #241b32 40%, #143229 100%)",
    accent: "#f59e0b",
    badge: "bg-amber-400 text-black",
    noun: "caterer",
  },
  private_chef: {
    label: "Private Chef",
    gradient:
      "linear-gradient(135deg, #111111 0%, #2d1f16 38%, #24183a 100%)",
    accent: "#fb7185",
    badge: "bg-rose-300 text-black",
    noun: "private chef",
  },
  host: {
    label: "Host",
    gradient:
      "linear-gradient(135deg, #111111 0%, #11223a 42%, #34240d 100%)",
    accent: "#38bdf8",
    badge: "bg-sky-300 text-black",
    noun: "host",
  },
  supplier: {
    label: "Supplier",
    gradient:
      "linear-gradient(135deg, #111111 0%, #1d2530 40%, #2e2614 100%)",
    accent: "#a3e635",
    badge: "bg-lime-300 text-black",
    noun: "supplier",
  },
  team: {
    label: "Team",
    gradient:
      "linear-gradient(135deg, #111111 0%, #27242f 40%, #302515 100%)",
    accent: "#f97316",
    badge: "bg-orange-400 text-black",
    noun: "team member",
  },
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

const initialsFor = (value: string) =>
  String(value || "MS")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "MS";

const summarize = (value?: string | null) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

const compactList = (items?: string[] | null, limit = 3) =>
  (items || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);

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

const announcementFor = (signup: RecentSignup) => {
  const labels: Record<RecentSignupKind, string> = {
    customer: "New MealScout member",
    food_truck: "New truck in town",
    restaurant: "New local spot",
    caterer: "New caterer in town",
    private_chef: "New private chef",
    host: "New host location",
    supplier: "New supplier partner",
    team: "New MealScout teammate",
  };
  return labels[signup.kind] || "New on MealScout";
};

const graphicActionFor = (signup: RecentSignup) => {
  if (signup.kind === "food_truck") return "Follow menus, stops, and updates";
  if (signup.kind === "caterer") return "Book catering and see menus";
  if (signup.kind === "private_chef") return "Book a private chef";
  if (signup.kind === "host") return "See parking and host details";
  if (signup.kind === "supplier") return "Find supplies and services";
  if (signup.kind === "restaurant") return "Follow menus and local updates";
  return "Find local food activity";
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

  const signups = data?.signups || [];

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
            const description = summarize(signup.description);
            const menuHighlights = compactList(signup.menuItemNames);
            const graphicImageUrl = signup.shareImageUrl || signup.imageUrl;
            const hasBusinessImage = Boolean(graphicImageUrl);
            const readiness = completionLabel(signup);
            const insuranceReadiness = insuranceLabel(signup);
            const profileDestination = signup.isPublic
              ? "Public profile"
              : "Visitor fallback";
            const cleanShareUrl = signup.shareUrl || signup.profileUrl;
            const graphicUrlLabel = shortShareUrl(cleanShareUrl, 38);
            const detailParts = [
              signup.category || signup.typeLabel,
              signup.locationLabel,
            ].filter(Boolean);
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
            const graphicSubline =
              menuHighlights.length > 0
                ? menuHighlights.slice(0, 3).join(" / ")
                : detailParts.join(" / ") ||
                  description ||
                  `${signup.typeLabel} on MealScout`;
            const announcement = announcementFor(signup);
            const graphicAction = graphicActionFor(signup);
            const imageAlt = `${signup.displayName} profile image`;

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
                      {signup.googleProfileLinked || signup.googlePlaceId ? (
                        <Badge variant="outline">
                          Google listing
                          {signup.googleRating
                            ? ` ${Number(signup.googleRating).toFixed(1)}`
                            : ""}
                        </Badge>
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
                  <div
                    ref={(node) => {
                      graphicRefs.current[signup.key] = node;
                    }}
                    className="relative aspect-[1200/630] overflow-hidden rounded-[1.5rem] border bg-neutral-950 text-white shadow-sm"
                    style={{
                      background: hasBusinessImage ? "#050505" : tone.gradient,
                      containerType: "inline-size",
                    }}
                  >
                    {hasBusinessImage ? (
                      <>
                        <img
                          src={graphicImageUrl || ""}
                          alt={imageAlt}
                          crossOrigin="anonymous"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/58" />
                        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/78 to-black/22" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-transparent to-black/42" />
                      </>
                    ) : (
                      <>
                        <div className="absolute inset-0 bg-[#050505]" />
                        <div
                          className="absolute inset-0 opacity-[0.12]"
                          style={{
                            backgroundImage:
                              "linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,.12) 1px, transparent 1px)",
                            backgroundSize: "72px 72px",
                          }}
                        />
                        <div
                          className="absolute inset-y-0 right-0 w-[39%]"
                          style={{ backgroundColor: tone.accent }}
                        />
                        <div className="absolute inset-y-0 right-[31%] w-[18rem] skew-x-[-12deg] bg-black/35" />
                      </>
                    )}

                    <div className="relative h-full p-[3.33cqw]">
                      <div className="absolute left-[3.33cqw] top-[3.33cqw] inline-flex items-center gap-[1cqw] text-[1.15cqw] font-black uppercase tracking-[0.18em] text-white">
                        <span className="flex h-[3.33cqw] w-[3.33cqw] items-center justify-center rounded-full bg-white text-[0.9cqw] tracking-normal text-black">
                          MS
                        </span>
                        <span>MealScout</span>
                      </div>

                      <div className="absolute right-[3.33cqw] top-[3.33cqw] flex max-w-[35cqw] flex-wrap justify-end gap-[0.65cqw]">
                        <span
                          className="rounded-full px-[1.65cqw] py-[0.65cqw] text-[1.05cqw] font-black text-black shadow-[0_10px_28px_rgba(0,0,0,.28)]"
                          style={{ backgroundColor: tone.accent }}
                        >
                          {tone.label}
                        </span>
                        <span className="rounded-full bg-white px-[1.65cqw] py-[0.65cqw] text-[1.05cqw] font-black text-black shadow-[0_10px_28px_rgba(0,0,0,.22)]">
                          {statusText}
                        </span>
                      </div>

                      <div className="absolute bottom-[8cqw] left-[3.33cqw] top-[10.6cqw] flex w-[55%] flex-col justify-center">
                        <div
                          className="mb-[1.6cqw] inline-flex w-fit rounded-full px-[1.65cqw] py-[0.65cqw] text-[1.05cqw] font-black uppercase tracking-[0.18em] text-black shadow-[0_12px_34px_rgba(0,0,0,.32)]"
                          style={{ backgroundColor: tone.accent }}
                        >
                          {announcement}
                        </div>
                        <p className="text-[1.1cqw] font-black uppercase tracking-[0.22em] text-white/70">
                          Just joined MealScout
                        </p>
                        <h3
                          className={`mt-[0.9cqw] max-w-[11.5ch] break-words ${graphicNameClass} font-black leading-[0.96] text-white drop-shadow-[0_3px_18px_rgba(0,0,0,.45)]`}
                        >
                          {signup.displayName}
                        </h3>
                        {graphicSubline ? (
                          <p className="mt-[1.5cqw] line-clamp-2 max-w-[44cqw] text-[1.55cqw] font-black leading-tight text-white/90">
                            {graphicSubline}
                          </p>
                        ) : null}
                      </div>

                      <div className="absolute bottom-[3.33cqw] left-[3.33cqw] w-[55%] min-w-0">
                        <p className="mb-[0.65cqw] text-[0.82cqw] font-black uppercase tracking-[0.2em] text-white/60">
                          Share this MealScout link
                        </p>
                        <div className="flex min-w-0 items-center gap-[0.65cqw] text-[1.35cqw] font-black text-white">
                          <MapPin className="h-[1.35cqw] w-[1.35cqw] shrink-0" />
                          <span className="min-w-0 truncate">
                            {graphicUrlLabel}
                          </span>
                        </div>
                      </div>

                      <div className="absolute bottom-[3.33cqw] right-[3.33cqw] top-[10.6cqw] w-[32%] overflow-hidden rounded-[2.65cqw] border border-white/15 bg-black/30 p-[2cqw] shadow-[0_28px_80px_rgba(0,0,0,.38)] backdrop-blur-sm">
                        <div
                          className="absolute inset-0 opacity-[0.42]"
                          style={{ backgroundColor: tone.accent }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/40" />
                        <div className="relative flex h-full flex-col justify-between">
                          <div className="flex justify-end">
                            <span className="rounded-full bg-white px-[1.35cqw] py-[0.65cqw] text-[0.95cqw] font-black text-black">
                              View profile
                            </span>
                          </div>
                          <div className="flex flex-1 items-center justify-center py-[1.33cqw]">
                            <div
                              className="flex h-[13.5cqw] w-[13.5cqw] items-center justify-center rounded-[2.7cqw] text-[5.1cqw] font-black text-black shadow-[0_20px_60px_rgba(0,0,0,.28)]"
                              style={{ backgroundColor: tone.accent }}
                            >
                              {initialsFor(signup.displayName)}
                            </div>
                          </div>
                          <div className="rounded-[1.65cqw] border border-white/15 bg-black/30 p-[1.65cqw]">
                            <p className="mb-[1cqw] text-[0.78cqw] font-black uppercase tracking-[0.24em] text-white/70">
                              Featured
                            </p>
                            <p className="line-clamp-2 text-[1.5cqw] font-black leading-tight text-white">
                              {graphicAction}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Caption
                    </p>
                    <p className="text-sm">{signup.caption}</p>
                  </div>

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
                    <Button
                      variant="outline"
                      onClick={() => copyText(signup.caption, "Caption")}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Caption
                    </Button>
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
