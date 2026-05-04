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
  profileUrl: string;
  shareUrl?: string | null;
  profilePath: string;
  isPublic: boolean;
  linkLabel?: string | null;
  isVerified: boolean;
  createdAt: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
  facebookPageUrl?: string | null;
  caption: string;
};

type RecentSignupsResponse = {
  windowHours: number;
  generatedAt: string;
  summary: {
    total: number;
    users: number;
    customers: number;
    foodTrucks: number;
    restaurants: number;
    hosts: number;
    suppliers: number;
    team: number;
    notPublic: number;
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

const shortShareUrl = (value: string) => {
  try {
    const url = new URL(value);
    const path = `${url.hostname.replace(/^www\./, "")}${url.pathname}`;
    return path.length > 34 ? `${path.slice(0, 31)}...` : path;
  } catch {
    const raw = String(value || "").replace(/^https?:\/\//, "");
    return raw.length > 34 ? `${raw.slice(0, 31)}...` : raw;
  }
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

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

export default function RecentSignupShare() {
  const { toast } = useToast();
  const graphicRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } =
    useQuery<RecentSignupsResponse>({
      queryKey: ["/api/admin/recent-signups", "48h"],
      queryFn: async () => {
        const res = await fetch("/api/admin/recent-signups?hours=48", {
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
    const canvas = await html2canvas(target, {
      backgroundColor: null,
      scale: 2,
      logging: false,
      useCORS: true,
    });
    return canvas.toDataURL("image/png", 0.95);
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
              Ready-to-share welcome cards for every new user from the last 48
              hours, with business profile details added when available.
            </CardDescription>
          </div>
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
            const profileDestination = signup.isPublic
              ? "Public profile"
              : "Visitor fallback";
            const cleanShareUrl = signup.shareUrl || signup.profileUrl;
            const graphicUrlLabel = shortShareUrl(cleanShareUrl);
            const detailParts = [
              signup.category || signup.typeLabel,
              signup.locationLabel,
            ].filter(Boolean);
            const statusText = signup.isPublic
              ? "Live public profile"
              : "Profile finishing";
            const featuredLine =
              menuHighlights.length > 0
                ? menuHighlights.join(" / ")
                : description || `Find ${signup.displayName} on MealScout`;

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
                    className="relative aspect-[1200/630] overflow-hidden rounded-xl border bg-neutral-950 text-white shadow-sm"
                    style={{ background: tone.gradient }}
                  >
                    {hasBusinessImage ? (
                      <img
                        src={graphicImageUrl || ""}
                        alt={`${signup.displayName} profile image`}
                        crossOrigin="anonymous"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : null}
                    <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/78 to-black/45" />
                    <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 to-transparent" />
                    <div
                      className="absolute inset-0 opacity-20"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,.07) 1px, transparent 1px)",
                        backgroundSize: "64px 64px",
                      }}
                    />
                    <div className="absolute right-0 top-0 h-full w-[42%] bg-black/50 backdrop-blur-[1px]" />
                    <div
                      className="absolute right-[34%] top-0 h-full w-28 skew-x-[-12deg]"
                      style={{ backgroundColor: tone.accent, opacity: 0.9 }}
                    />

                    <div className="relative grid h-full grid-cols-[1.05fr_0.95fr]">
                      <div className="flex h-full flex-col justify-between p-8">
                        <div className="inline-flex w-fit items-center gap-3 rounded-full bg-black/45 px-4 py-2 text-sm font-black uppercase tracking-[0.22em] text-white shadow">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs tracking-normal text-black">
                            MS
                          </span>
                          MealScout
                        </div>

                        <div className="max-w-[92%] space-y-4">
                          <div
                            className="inline-flex rounded-full px-4 py-2 text-sm font-black uppercase tracking-[0.16em] text-black shadow"
                            style={{ backgroundColor: tone.accent }}
                          >
                            New {signup.nounLabel || tone.noun} in town
                          </div>
                          <div>
                            <p className="text-sm font-black uppercase tracking-[0.24em] text-white/70">
                              Just joined MealScout
                            </p>
                            <h3 className="mt-2 text-balance text-5xl font-black leading-[0.95] sm:text-6xl">
                              {signup.displayName}
                            </h3>
                          </div>
                          {detailParts.length ? (
                            <div className="flex flex-wrap items-center gap-3 text-xl font-bold text-white/90">
                              {detailParts.map((part, index) => (
                                <span key={`${part}-${index}`} className="flex items-center gap-3">
                                  {index > 0 ? (
                                    <span className="text-white/35">/</span>
                                  ) : null}
                                  {part}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2 text-sm font-semibold text-white/75">
                          <MapPin className="h-4 w-4" />
                          {graphicUrlLabel}
                        </div>
                      </div>

                      <div className="relative flex h-full flex-col justify-between p-8 pl-12">
                        <div className="flex flex-wrap justify-end gap-2">
                          <span
                            className="rounded-full px-4 py-2 text-sm font-black text-black shadow"
                            style={{ backgroundColor: tone.accent }}
                          >
                            {tone.label}
                          </span>
                          <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-black shadow">
                            {statusText}
                          </span>
                        </div>

                        {hasBusinessImage ? (
                          <div className="min-h-20" />
                        ) : (
                          <div
                            className="flex h-32 w-32 items-center justify-center self-end rounded-[2rem] text-5xl font-black text-black shadow-2xl"
                            style={{ backgroundColor: tone.accent }}
                          >
                            {initialsFor(signup.displayName)}
                          </div>
                        )}

                        <div className="space-y-4 rounded-3xl border border-white/15 bg-black/55 p-5 shadow-2xl backdrop-blur-sm">
                          <p className="text-xs font-black uppercase tracking-[0.22em] text-white/55">
                            Featured
                          </p>
                          <p className="line-clamp-3 text-2xl font-black leading-tight text-white">
                            {featuredLine}
                          </p>
                          {menuHighlights.length ? (
                            <div className="flex flex-wrap gap-2">
                              {menuHighlights.map((item) => (
                                <span
                                  key={item}
                                  className="rounded-full bg-white px-3 py-1 text-sm font-black text-black"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between gap-4 border-t border-white/15 pt-4">
                            <span className="text-sm font-bold text-white/70">
                              Follow updates, menus, and stops
                            </span>
                            <span
                              className="rounded-full px-4 py-2 text-sm font-black text-black"
                              style={{ backgroundColor: tone.accent }}
                            >
                              View profile
                            </span>
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
