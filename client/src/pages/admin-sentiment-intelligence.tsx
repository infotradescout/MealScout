import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Download, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

type SentimentSignalsResponse = {
  filters?: { windowDays?: number; minSamples?: number };
  overview?: {
    sampleCount: number;
    changedCount: number;
    avgScore100: number;
    avgDelta100: number;
    positiveShare: number;
    improvedShare: number;
    declinedShare: number;
  };
  topByCuisine?: Array<{ key: string | null; sampleCount: number; avgScore100: number; avgDelta100: number }>;
  topByCity?: Array<{ key: string | null; sampleCount: number; avgScore100: number; avgDelta100: number }>;
  topByMenuItem?: Array<{ key: string | null; sampleCount: number; avgScore100: number; avgDelta100: number }>;
};

type SentimentAlertsResponse = {
  counts?: { atRisk: number; rising: number };
  atRisk?: Array<{
    restaurantId: string;
    restaurantName: string;
    sampleCount: number;
    avgScore100: number;
    avgDelta100: number;
    positiveShare: number;
    recommendation: string;
    severity: "high" | "medium";
  }>;
  rising?: Array<{
    restaurantId: string;
    restaurantName: string;
    sampleCount: number;
    avgScore100: number;
    avgDelta100: number;
    positiveShare: number;
    recommendation: string;
  }>;
};

type SentimentSnapshotSummary = {
  windowDays?: number;
  generatedAt?: string;
  overview?: {
    sampleCount?: number;
    avgScore100?: number;
    avgDelta100?: number;
    positiveShare?: number;
  };
};

type DailyReportsResponse = {
  reports?: Array<{
    id: string;
    reportDate: string;
    summary?: SentimentSnapshotSummary | null;
  }>;
};

export default function AdminSentimentIntelligence() {
  const [windowDays, setWindowDays] = useState(90);
  const normalizedWindowDays = useMemo(
    () => Math.max(7, Math.min(365, Number.isFinite(windowDays) ? Math.trunc(windowDays) : 90)),
    [windowDays],
  );

  const { data: signals, isLoading: loadingSignals, error: signalsError } =
    useQuery<SentimentSignalsResponse>({
      queryKey: ["/api/admin/insights/sentiment-signals", normalizedWindowDays],
      queryFn: async () => {
        const response = await fetch(
          `/api/admin/insights/sentiment-signals?windowDays=${normalizedWindowDays}&minSamples=5`,
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch sentiment intelligence");
        }
        return response.json();
      },
      refetchOnWindowFocus: false,
    });

  const { data: alerts, isLoading: loadingAlerts } = useQuery<SentimentAlertsResponse>({
    queryKey: ["/api/admin/insights/sentiment-alerts", normalizedWindowDays],
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/insights/sentiment-alerts?windowDays=${Math.min(60, normalizedWindowDays)}&minSamples=8`,
        { credentials: "include" },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch sentiment alerts");
      }
      return response.json();
    },
    refetchOnWindowFocus: false,
  });

  const { data: dailySnapshots, isLoading: loadingDailySnapshots } =
    useQuery<DailyReportsResponse>({
      queryKey: ["/api/admin/daily-reports", "sentiment_snapshot_daily"],
      queryFn: async () => {
        const response = await fetch(
          "/api/admin/daily-reports?type=sentiment_snapshot_daily&limit=1",
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch daily sentiment snapshot");
        }
        return response.json();
      },
      refetchOnWindowFocus: false,
      retry: false,
    });

  const { data: weeklySnapshots, isLoading: loadingWeeklySnapshots } =
    useQuery<DailyReportsResponse>({
      queryKey: ["/api/admin/daily-reports", "sentiment_snapshot_weekly"],
      queryFn: async () => {
        const response = await fetch(
          "/api/admin/daily-reports?type=sentiment_snapshot_weekly&limit=1",
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch weekly sentiment snapshot");
        }
        return response.json();
      },
      refetchOnWindowFocus: false,
      retry: false,
    });

  const handleExportCsv = () => {
    const url = `/api/admin/insights/sentiment-opportunities/export?windowDays=${normalizedWindowDays}&minSamples=6&format=csv`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const overview = signals?.overview;
  const atRisk = Array.isArray(alerts?.atRisk) ? alerts!.atRisk.slice(0, 8) : [];
  const rising = Array.isArray(alerts?.rising) ? alerts!.rising.slice(0, 8) : [];
  const latestDailySnapshot = dailySnapshots?.reports?.[0];
  const latestWeeklySnapshot = weeklySnapshots?.reports?.[0];

  if (loadingSignals) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[color:var(--action-primary)]" />
      </div>
    );
  }

  if (signalsError) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Sentiment intelligence unavailable</AlertTitle>
          <AlertDescription>
            Could not load sentiment intelligence data. Check admin permissions and try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sentiment Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Operational signals from micro-survey sentiment trends, alerts, and strategy exports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={7}
            max={365}
            value={normalizedWindowDays}
            onChange={(event) => setWindowDays(Number(event.target.value || 90))}
            className="w-28"
            aria-label="Window days"
          />
          <Button variant="outline" onClick={handleExportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export Ops CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Signal Samples</CardDescription>
            <CardTitle>{overview?.sampleCount ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Average Sentiment</CardDescription>
            <CardTitle>{(overview?.avgScore100 ?? 0).toFixed(1)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Average Delta</CardDescription>
            <CardTitle className={(overview?.avgDelta100 ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}>
              {(overview?.avgDelta100 ?? 0).toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Positive Share</CardDescription>
            <CardTitle>{(((overview?.positiveShare ?? 0) * 100) || 0).toFixed(1)}%</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              At-Risk Alerts
            </CardTitle>
            <CardDescription>
              Restaurants showing sentiment decline or weak positive-share durability.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAlerts ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : atRisk.length === 0 ? (
              <p className="text-sm text-muted-foreground">No critical risk signals in this window.</p>
            ) : (
              <div className="space-y-3">
                {atRisk.map((row) => (
                  <div key={row.restaurantId} className="rounded-lg border border-red-200 bg-red-50/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground">{row.restaurantName}</p>
                      <Badge variant={row.severity === "high" ? "destructive" : "outline"}>
                        {row.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Delta {row.avgDelta100.toFixed(2)} · Positive {(row.positiveShare * 100).toFixed(1)}% · Samples {row.sampleCount}
                    </p>
                    <p className="text-xs mt-1 text-foreground">{row.recommendation}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Rising Momentum
            </CardTitle>
            <CardDescription>
              Restaurants with improving sentiment trend and promotion potential.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAlerts ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : rising.length === 0 ? (
              <p className="text-sm text-muted-foreground">No strong rise signals in this window.</p>
            ) : (
              <div className="space-y-3">
                {rising.map((row) => (
                  <div key={row.restaurantId} className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <p className="font-semibold text-sm text-foreground">{row.restaurantName}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Delta +{row.avgDelta100.toFixed(2)} · Positive {(row.positiveShare * 100).toFixed(1)}% · Samples {row.sampleCount}
                    </p>
                    <p className="text-xs mt-1 text-foreground">{row.recommendation}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cuisine Hold-Up</CardTitle>
            <CardDescription>Which cuisines hold sentiment best over time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(signals?.topByCuisine || []).slice(0, 8).map((row) => (
              <div key={String(row.key)} className="flex items-center justify-between text-sm">
                <span className="truncate pr-2">{row.key || "Unknown"}</span>
                <span className={row.avgDelta100 >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {row.avgDelta100.toFixed(2)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Area Hold-Up</CardTitle>
            <CardDescription>Where sentiment is most resilient.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(signals?.topByCity || []).slice(0, 8).map((row) => (
              <div key={String(row.key)} className="flex items-center justify-between text-sm">
                <span className="truncate pr-2">{row.key || "Unknown"}</span>
                <span className={row.avgDelta100 >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {row.avgDelta100.toFixed(2)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Menu Item Durability</CardTitle>
            <CardDescription>Items that sustain positive sentiment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(signals?.topByMenuItem || []).slice(0, 8).map((row) => (
              <div key={String(row.key)} className="flex items-center justify-between text-sm">
                <span className="truncate pr-2">{row.key || "Unknown"}</span>
                <span className={row.avgDelta100 >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {row.avgDelta100.toFixed(2)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest Daily Snapshot</CardTitle>
            <CardDescription>Auto-saved 30-day sentiment summary.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingDailySnapshots ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !latestDailySnapshot ? (
              <p className="text-sm text-muted-foreground">No daily snapshot saved yet.</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  Samples: {Number(latestDailySnapshot.summary?.overview?.sampleCount || 0)}
                </p>
                <p>
                  Avg score: {Number(latestDailySnapshot.summary?.overview?.avgScore100 || 0).toFixed(1)}
                </p>
                <p className={
                  Number(latestDailySnapshot.summary?.overview?.avgDelta100 || 0) >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                }>
                  Avg delta: {Number(latestDailySnapshot.summary?.overview?.avgDelta100 || 0).toFixed(2)}
                </p>
                <p>
                  Positive share: {(Number(latestDailySnapshot.summary?.overview?.positiveShare || 0) * 100).toFixed(1)}%
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Latest Weekly Snapshot</CardTitle>
            <CardDescription>Auto-saved 90-day sentiment summary.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingWeeklySnapshots ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : !latestWeeklySnapshot ? (
              <p className="text-sm text-muted-foreground">No weekly snapshot saved yet.</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  Samples: {Number(latestWeeklySnapshot.summary?.overview?.sampleCount || 0)}
                </p>
                <p>
                  Avg score: {Number(latestWeeklySnapshot.summary?.overview?.avgScore100 || 0).toFixed(1)}
                </p>
                <p className={
                  Number(latestWeeklySnapshot.summary?.overview?.avgDelta100 || 0) >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                }>
                  Avg delta: {Number(latestWeeklySnapshot.summary?.overview?.avgDelta100 || 0).toFixed(2)}
                </p>
                <p>
                  Positive share: {(Number(latestWeeklySnapshot.summary?.overview?.positiveShare || 0) * 100).toFixed(1)}%
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Alert>
        <TrendingDown className="h-4 w-4" />
        <AlertTitle>Ops Loop Enabled</AlertTitle>
        <AlertDescription>
          Use this panel in sequence: monitor alerts, prioritize intervention/promotion, export opportunities, and review weekly snapshots in Admin Daily Reports.
        </AlertDescription>
      </Alert>
    </div>
  );
}
