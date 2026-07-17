import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChevronRight,
  CircleDot,
  Eye,
  Globe2,
  Loader2,
  MapPin,
  Menu,
  MousePointerClick,
  Phone,
  QrCode,
  RefreshCw,
  Share2,
  ShoppingBag,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { isTruckBusinessType } from "@shared/businessTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AudienceWindow = "7d" | "30d";

type AudienceTotals = {
  profileViews: number;
  menuClicks: number;
  directionsClicks: number;
  callClicks: number;
  websiteClicks: number;
  orderClicks: number;
  deliveryClicks: number;
  qrOpens: number;
  dealClicks: number;
  eventClicks: number;
  socialClicks: number;
  shareClicks: number;
  cateringClicks: number;
  truckBookingClicks: number;
};

type AudienceDeltas = {
  profileViews: number;
  menuClicks: number;
  directionsClicks: number;
  callClicks: number;
  orderClicks: number;
  qrOpens: number;
};

type AudienceRecommendation = {
  id: string;
  severity: "info" | "opportunity" | "urgent";
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
};

type AudienceResponse = {
  restaurantId: string;
  window: AudienceWindow;
  generatedAt: string;
  freshnessLabel: string;
  totals: AudienceTotals;
  previousWindowTotals: Partial<AudienceTotals>;
  deltas: AudienceDeltas;
  topActions: Array<{
    actionType: string;
    label: string;
    count: number;
  }>;
  recommendations: AudienceRecommendation[];
};

type OwnerAudienceWorkspaceProps = {
  restaurantId: string;
  businessName: string;
  businessType?: string | null;
  canViewAnalytics: boolean;
  publicProfileHref?: string | null;
};

type MetricCardProps = {
  label: string;
  value: number;
  delta: number;
  window: AudienceWindow;
  icon: typeof Eye;
  className: string;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchAudience(
  restaurantId: string,
  window: AudienceWindow,
): Promise<AudienceResponse> {
  const response = await fetch(
    `/api/restaurants/${encodeURIComponent(restaurantId)}/owner-value-dashboard?window=${window}`,
    { credentials: "include" },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.message || "Audience activity could not be loaded right now.",
    );
  }
  return payload as AudienceResponse;
}

function Delta({ value, window }: { value: number; window: AudienceWindow }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : null;
  const period = window === "7d" ? "prior 7 days" : "prior 30 days";

  if (!Icon) {
    return (
      <span className="text-xs font-semibold text-stone-500">
        No change from {period}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold ${
        value > 0 ? "text-emerald-700" : "text-stone-600"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {Math.abs(value).toLocaleString()} {value > 0 ? "more" : "fewer"} than {period}
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
  window,
  icon: Icon,
  className,
}: MetricCardProps) {
  return (
    <Card className={`overflow-hidden border-0 shadow-none ${className}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-stone-700">{label}</p>
            <p className="mt-2 text-3xl font-black tracking-tight text-stone-950">
              {value.toLocaleString()}
            </p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/75 text-stone-800 shadow-sm">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        <div className="mt-3">
          <Delta value={delta} window={window} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function OwnerAudienceWorkspace({
  restaurantId,
  businessName,
  businessType,
  canViewAnalytics,
  publicProfileHref,
}: OwnerAudienceWorkspaceProps) {
  const [window, setWindow] = useState<AudienceWindow>("30d");
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<AudienceResponse>({
    queryKey: [
      "/api/restaurants",
      restaurantId,
      "owner-value-dashboard",
      window,
    ],
    queryFn: () => fetchAudience(restaurantId, window),
    enabled: Boolean(restaurantId && canViewAnalytics),
    staleTime: 60_000,
  });

  const totals = data?.totals;
  const deltas = data?.deltas;
  const isTruck = isTruckBusinessType(businessType);
  const visitIntent =
    numberValue(totals?.directionsClicks) + numberValue(totals?.callClicks);
  const orderIntent =
    numberValue(totals?.orderClicks) + numberValue(totals?.deliveryClicks);
  const visitIntentDelta =
    numberValue(deltas?.directionsClicks) + numberValue(deltas?.callClicks);
  const allActions = useMemo(
    () => [
      {
        id: "menu",
        label: "Menu opens",
        description: "People checking what you serve",
        count: numberValue(totals?.menuClicks),
        icon: Menu,
      },
      {
        id: "visit",
        label: "Directions and calls",
        description: isTruck
          ? "People trying to find or contact the truck"
          : "People planning a visit or getting in touch",
        count: visitIntent,
        icon: MapPin,
      },
      {
        id: "orders",
        label: "Order and delivery taps",
        description: "People moving toward an order",
        count: orderIntent,
        icon: ShoppingBag,
      },
      {
        id: "website",
        label: "Website visits",
        description: "People continuing to your website",
        count: numberValue(totals?.websiteClicks),
        icon: Globe2,
      },
      {
        id: "offers",
        label: "Deals and events",
        description: "Interest in your current reasons to visit",
        count:
          numberValue(totals?.dealClicks) + numberValue(totals?.eventClicks),
        icon: Tag,
      },
      {
        id: "sharing",
        label: "Social and shares",
        description: "People sharing or opening social links",
        count:
          numberValue(totals?.socialClicks) + numberValue(totals?.shareClicks),
        icon: Share2,
      },
      {
        id: "qr",
        label: "QR opens",
        description: "Profile, menu, or specials opened from a QR code",
        count: numberValue(totals?.qrOpens),
        icon: QrCode,
      },
      {
        id: "requests",
        label: isTruck ? "Catering and booking interest" : "Catering interest",
        description: isTruck
          ? "People asking about catering or booking the truck"
          : "People opening your catering path",
        count:
          numberValue(totals?.cateringClicks) +
          numberValue(totals?.truckBookingClicks),
        icon: Users,
      },
    ],
    [isTruck, orderIntent, totals, visitIntent],
  );
  const maxActionCount = Math.max(1, ...allActions.map((item) => item.count));
  const totalCustomerActions = allActions.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const hasActivity =
    numberValue(totals?.profileViews) > 0 || totalCustomerActions > 0;

  if (!canViewAnalytics) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex gap-3 p-5 text-amber-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-black">Audience access is not enabled</p>
            <p className="mt-1 text-sm text-amber-900/80">
              Ask the business owner to grant you analytics permission.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div
      id="owner-workspace-operations"
      className="mx-auto max-w-6xl space-y-6 scroll-mt-64 lg:scroll-mt-24"
      data-testid="owner-audience-workspace"
    >
      <section className="overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-black text-rose-800">
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Audience
            </div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">
              See what people do after finding {businessName}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-700">
              These are real views and actions from your public MealScout profile.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {publicProfileHref ? (
              <Button asChild size="sm" variant="outline" className="bg-white/80">
                <Link href={publicProfileHref}>View public profile</Link>
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="bg-white/80"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rose-200/80 pt-4">
          <div className="inline-flex rounded-full border border-white/80 bg-white/70 p-1 shadow-sm">
            {(["7d", "30d"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setWindow(value)}
                className={`rounded-full px-4 py-2 text-sm font-black transition ${
                  window === value
                    ? "bg-stone-950 text-white shadow-sm"
                    : "text-stone-600 hover:bg-white"
                }`}
                aria-pressed={window === value}
                data-testid={`audience-window-${value}`}
              >
                {value === "7d" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
          <p className="text-xs font-semibold text-stone-600">
            {data?.freshnessLabel || "Updated when this page loads"}
          </p>
        </div>
      </section>

      {isLoading ? (
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)]">
          <CardContent className="flex min-h-56 items-center justify-center gap-3 p-6 text-stone-600">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Loading audience activity…
          </CardContent>
        </Card>
      ) : isError ? (
        <Card className="border-red-200 bg-red-50" data-testid="audience-error-state">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3 text-red-950">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-black">Audience activity is unavailable</p>
                <p className="mt-1 text-sm text-red-900/80">
                  {error instanceof Error ? error.message : "Please try again."}
                </p>
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Audience summary">
            <MetricCard
              label="Profile views"
              value={numberValue(totals?.profileViews)}
              delta={numberValue(deltas?.profileViews)}
              window={window}
              icon={Eye}
              className="bg-orange-100"
            />
            <MetricCard
              label="Menu opens"
              value={numberValue(totals?.menuClicks)}
              delta={numberValue(deltas?.menuClicks)}
              window={window}
              icon={Menu}
              className="bg-amber-100"
            />
            <MetricCard
              label="Directions and calls"
              value={visitIntent}
              delta={visitIntentDelta}
              window={window}
              icon={Phone}
              className="bg-emerald-100"
            />
            <MetricCard
              label="Order and delivery taps"
              value={orderIntent}
              delta={numberValue(deltas?.orderClicks)}
              window={window}
              icon={ShoppingBag}
              className="bg-sky-100"
            />
          </section>

          {!hasActivity ? (
            <Card className="overflow-hidden border-dashed border-orange-300 bg-orange-50/60" data-testid="audience-empty-state">
              <CardContent className="p-6 sm:p-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-800">
                  <MousePointerClick className="h-6 w-6" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-xl font-black text-stone-950">
                  No profile activity in this period yet
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">
                  Views and customer actions will appear here when people use your public profile, menu, links, or QR codes.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {publicProfileHref ? (
                    <Button asChild size="sm">
                      <Link href={publicProfileHref}>Check public profile</Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/restaurant-owner-dashboard?setup=profile&restaurantId=${encodeURIComponent(restaurantId)}`}
                    >
                      Get profile QR codes
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-black text-stone-950">What people did</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      Every count is an action recorded from the public profile.
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {totalCustomerActions.toLocaleString()} total
                  </Badge>
                </div>

                <div className="mt-6 space-y-5">
                  {allActions.map((item) => {
                    const Icon = item.icon;
                    const width = `${Math.max(
                      item.count > 0 ? 7 : 0,
                      Math.round((item.count / maxActionCount) * 100),
                    )}%`;
                    return (
                      <div key={item.id}>
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-bold text-stone-900">{item.label}</p>
                              <p className="shrink-0 font-black text-stone-950">
                                {item.count.toLocaleString()}
                              </p>
                            </div>
                            <p className="mt-0.5 text-xs text-stone-500">
                              {item.description}
                            </p>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500"
                                style={{ width }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-orange-600" aria-hidden="true" />
                  <h3 className="text-lg font-black text-stone-950">What to do next</h3>
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  Suggestions are based on the activity and profile details MealScout can verify.
                </p>

                <div className="mt-5 space-y-3">
                  {data?.recommendations?.length ? (
                    data.recommendations.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 ${
                          item.severity === "urgent"
                            ? "border-rose-200 bg-rose-50"
                            : item.severity === "opportunity"
                              ? "border-orange-200 bg-orange-50"
                              : "border-sky-200 bg-sky-50"
                        }`}
                      >
                        <p className="font-black text-stone-950">{item.title}</p>
                        <p className="mt-1 text-sm leading-5 text-stone-600">{item.body}</p>
                        <Button asChild size="sm" variant="link" className="mt-2 h-auto p-0 font-black text-orange-800">
                          <Link href={item.ctaHref}>
                            {item.ctaLabel}
                            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                          </Link>
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="font-black text-emerald-950">Keep your profile current</p>
                      <p className="mt-1 text-sm leading-5 text-emerald-900/75">
                        There is no urgent profile action for this period. Update menus, hours, schedules, and photos whenever they change.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
            <span className="inline-flex items-center gap-2 font-semibold">
              <CircleDot className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              Activity is counted from public-profile views and taps only.
            </span>
            <span>{window === "7d" ? "Last 7 days" : "Last 30 days"}</span>
          </div>
        </>
      )}
    </div>
  );
}
