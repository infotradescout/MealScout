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

type RecentSignupKind = "food_truck" | "restaurant" | "host";

type RecentSignup = {
  key: string;
  kind: RecentSignupKind;
  entity: "restaurant" | "host";
  id: string;
  displayName: string;
  typeLabel: string;
  category?: string | null;
  locationLabel?: string | null;
  description?: string | null;
  profileUrl: string;
  profilePath: string;
  isPublic: boolean;
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
    foodTrucks: number;
    restaurants: number;
    hosts: number;
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
  host: {
    label: "Host",
    gradient:
      "linear-gradient(135deg, #111111 0%, #11223a 42%, #34240d 100%)",
    accent: "#38bdf8",
    badge: "bg-sky-300 text-black",
    noun: "host",
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
          profileUrl: signup.profileUrl,
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
              Ready-to-share welcome cards for new trucks, restaurants, and
              hosts from the last 48 hours.
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-semibold">
                {data?.summary.total ?? 0}
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
              No new truck, restaurant, or host signups in the last 48 hours.
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              When someone joins, their welcome graphic will appear here with a
              caption and profile link ready to share.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {signups.map((signup) => {
            const tone = toneByKind[signup.kind] || toneByKind.restaurant;
            const isPosting = busyKey === `${signup.key}:facebook`;
            const isDownloading = busyKey === `${signup.key}:download`;
            const description = summarize(signup.description);

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
                        {signup.isPublic ? "Public link" : "Map redirect link"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div
                    ref={(node) => {
                      graphicRefs.current[signup.key] = node;
                    }}
                    className="relative aspect-[1200/630] overflow-hidden rounded-xl border bg-neutral-950 p-6 text-white shadow-sm sm:p-8"
                    style={{ background: tone.gradient }}
                  >
                    <div
                      className="absolute inset-0 opacity-30"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,.06) 1px, transparent 1px)",
                        backgroundSize: "58px 58px",
                      }}
                    />
                    <div
                      className="absolute -right-20 top-0 h-full w-1/2 skew-x-[-14deg] opacity-30"
                      style={{ backgroundColor: tone.accent }}
                    />
                    <div className="relative flex h-full flex-col justify-between">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.18em] text-white/80">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black">
                            MS
                          </span>
                          MealScout
                        </div>
                        <Badge className={tone.badge}>
                          New {tone.noun}
                        </Badge>
                      </div>

                      <div className="max-w-[78%] space-y-4">
                        <div
                          className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-black text-black"
                          style={{ backgroundColor: tone.accent }}
                        >
                          {initialsFor(signup.displayName)}
                        </div>
                        <div>
                          <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/70">
                            Just joined MealScout
                          </p>
                          <h3 className="mt-2 text-balance text-4xl font-black leading-tight sm:text-5xl">
                            {signup.displayName}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-lg font-semibold text-white/90">
                          <span>{signup.category || signup.typeLabel}</span>
                          {signup.locationLabel ? (
                            <>
                              <span className="text-white/35">/</span>
                              <span>{signup.locationLabel}</span>
                            </>
                          ) : null}
                        </div>
                        {description ? (
                          <p className="line-clamp-2 max-w-2xl text-base font-medium text-white/80">
                            {description}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-end justify-between gap-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white/75">
                          <MapPin className="h-4 w-4" />
                          Find them on MealScout
                        </div>
                        <div className="rounded-full bg-black/40 px-4 py-2 text-sm font-semibold text-white/85">
                          mealscout.us
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
                      onClick={() => copyText(signup.profileUrl, "Profile link")}
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
