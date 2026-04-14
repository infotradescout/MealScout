
import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area } from "recharts";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

export default function AdminTelemetry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 1. Interest Velocity Query
  const { data: velocity, isLoading: loadingVelocity } = useQuery({
    queryKey: ['/api/admin/telemetry/velocity'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/velocity?days=30');
      if (!res.ok) throw new Error('Failed to fetch velocity');
      return res.json();
    }
  });

  // 2. Fill Rates Query
  const { data: fillRates, isLoading: loadingFillRates } = useQuery({
    queryKey: ['/api/admin/telemetry/fill-rates'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/fill-rates');
      if (!res.ok) throw new Error('Failed to fetch fill rates');
      return res.json();
    }
  });

  // 3. Digest Coverage Query
  const { data: coverage, isLoading: loadingCoverage } = useQuery({
    queryKey: ['/api/admin/telemetry/digest-coverage'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/digest-coverage');
      if (!res.ok) throw new Error('Failed to fetch coverage');
      return res.json();
    }
  });

  // 4. UX Recovery Telemetry Query
  const { data: uxRecovery, isLoading: loadingUxRecovery } = useQuery({
    queryKey: ['/api/admin/telemetry/ux-recovery'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/ux-recovery?days=7');
      if (!res.ok) throw new Error('Failed to fetch UX recovery telemetry');
      return res.json();
    }
  });

  // 5. Open-call series telemetry
  const { data: openCallSeries, isLoading: loadingOpenCallSeries } = useQuery({
    queryKey: ['/api/admin/telemetry/open-call-series'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/open-call-series?days=30&upcomingDays=30');
      if (!res.ok) throw new Error('Failed to fetch open-call series telemetry');
      return res.json();
    }
  });

  // 6. Premium ops telemetry
  const { data: premiumOps, isLoading: loadingPremiumOps } = useQuery({
    queryKey: ['/api/admin/telemetry/premium-ops'],
    queryFn: async () => {
      const res = await fetch('/api/admin/telemetry/premium-ops?days=30');
      if (!res.ok) throw new Error('Failed to fetch premium ops telemetry');
      return res.json();
    }
  });

  const { data: pensacolaOps, isLoading: loadingPensacolaOps } = useQuery({
    queryKey: ["/api/admin/growth/pensacola/ops"],
    queryFn: async () => {
      const res = await fetch("/api/admin/growth/pensacola/ops");
      if (!res.ok) throw new Error("Failed to fetch Pensacola ops snapshot");
      return res.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const runPensacolaReportDrip = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/growth/pensacola/report-drip/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.message || "Failed to run Pensacola report drip");
      }
      return payload;
    },
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/growth/pensacola/ops"],
      });
      toast({
        title: "Pensacola report drip ran",
        description: `Sent ${Number(payload?.stats?.sent || 0)} message(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Report drip failed",
        description: error?.message || "Unable to run Pensacola report drip.",
        variant: "destructive",
      });
    },
  });

  const runPensacolaTruckDrip = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/growth/pensacola/truck-drip/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.message || "Failed to run Pensacola truck drip");
      }
      return payload;
    },
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/growth/pensacola/ops"],
      });
      toast({
        title: "Pensacola truck drip ran",
        description: `Sent ${Number(payload?.stats?.sent || 0)} message(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Truck drip failed",
        description: error?.message || "Unable to run Pensacola truck drip.",
        variant: "destructive",
      });
    },
  });

  const premiumTotals = premiumOps?.totals || {};
  const summaryViewed = Number(premiumTotals.summaryViewed || 0);
  const summaryEmailed = Number(premiumTotals.summaryEmailed || 0);
  const summaryViewedUniqueUsers = Number(
    premiumTotals.summaryViewedUniqueUsers || 0,
  );
  const summaryEmailedUniqueUsers = Number(
    premiumTotals.summaryEmailedUniqueUsers || 0,
  );
  const liveLocationUsedUniqueUsers = Number(
    premiumTotals.liveLocationUsedUniqueUsers || 0,
  );
  const manualScheduleUsedUniqueUsers = Number(
    premiumTotals.manualScheduleUsedUniqueUsers || 0,
  );

  const toPercent = (numerator: number, denominator: number) => {
    if (!denominator || denominator <= 0) return 0;
    return (numerator / denominator) * 100;
  };

  const summaryEmailActionRate = toPercent(summaryEmailed, summaryViewed);
  const summaryEmailUserRate = toPercent(
    summaryEmailedUniqueUsers,
    summaryViewedUniqueUsers,
  );
  const liveActivationUserRate = toPercent(
    liveLocationUsedUniqueUsers,
    summaryViewedUniqueUsers,
  );
  const manualScheduleUserRate = toPercent(
    manualScheduleUsedUniqueUsers,
    summaryViewedUniqueUsers,
  );

  const recommendation = (() => {
    if (summaryViewedUniqueUsers < 5) {
      return {
        title: "Increase weekly summary exposure",
        body: "Too few operators are seeing the summary card. Surface it in one more high-traffic owner screen before optimizing downstream actions.",
      };
    }

    if (summaryEmailUserRate < 25) {
      return {
        title: "Target summary-viewed but not emailed",
        body: "Email adoption is low after view. Prioritize a stronger CTA and remind users that emailed summaries help weekly ops reviews.",
      };
    }

    if (liveActivationUserRate < 35) {
      return {
        title: "Target summary users not using go-live",
        body: "Live-location activation lags summary usage. Add a direct link from summary to one-click live location for the next test cycle.",
      };
    }

    if (manualScheduleUserRate < 35) {
      return {
        title: "Target summary users not scheduling manually",
        body: "Manual scheduling usage is lagging. Drive users from summary into off-platform schedule creation with a prefilled action link.",
      };
    }

    return {
      title: "Scale retention nudges",
      body: "Adoption rates are healthy. Move to retention by sending inactivity nudges to premium users with no live or schedule actions in 7 days.",
    };
  })();

  if (loadingVelocity || loadingFillRates || loadingCoverage || loadingUxRecovery || loadingOpenCallSeries || loadingPremiumOps) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Telemetry Viewer</h1>
          <p className="text-muted-foreground">Operational insights from system events (Read-Only)</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pensacola Launch Ops</CardTitle>
          <CardDescription>
            Report leads, truck onboarding funnel, and one-click drip execution for launch market conversion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Report Leads (7d)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loadingPensacolaOps ? "..." : Number(pensacolaOps?.report?.leads7d || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  30d: {Number(pensacolaOps?.report?.leads30d || 0)} · All: {Number(pensacolaOps?.report?.leadsAllTime || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Pensacola Trucks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loadingPensacolaOps ? "..." : Number(pensacolaOps?.trucks?.pensacolaTrucks || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Owners: {Number(pensacolaOps?.trucks?.pensacolaOwners || 0)} · Verified: {Number(pensacolaOps?.trucks?.verifiedOwners || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Active Premium Trucks</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {loadingPensacolaOps ? "..." : Number(pensacolaOps?.trucks?.activePremiumTrucks || 0)}
                </div>
                <p className="text-xs text-muted-foreground">
                  New owners (7d): {Number(pensacolaOps?.trucks?.newOwners7d || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Launch Sequence Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm space-y-1">
                  <div>Report S1: {Number(pensacolaOps?.report?.stepSends?.step1 || 0)} · S2: {Number(pensacolaOps?.report?.stepSends?.step2 || 0)} · S3: {Number(pensacolaOps?.report?.stepSends?.step3 || 0)}</div>
                  <div>Truck S1: {Number(pensacolaOps?.trucks?.stepSends?.step1 || 0)} · S2: {Number(pensacolaOps?.trucks?.stepSends?.step2 || 0)} · S3: {Number(pensacolaOps?.trucks?.stepSends?.step3 || 0)} · S4: {Number(pensacolaOps?.trucks?.stepSends?.step4 || 0)}</div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => runPensacolaReportDrip.mutate()}
              disabled={runPensacolaReportDrip.isPending}
            >
              {runPensacolaReportDrip.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Run Report Drip Now
            </Button>
            <Button
              variant="outline"
              onClick={() => runPensacolaTruckDrip.mutate()}
              disabled={runPensacolaTruckDrip.isPending}
            >
              {runPensacolaTruckDrip.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Run Truck Drip Now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Top Row: Key Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Events Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fillRates?.totalEvents || 0}</div>
            <p className="text-xs text-muted-foreground">Active events in system</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Over Capacity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {fillRates?.overCapacityPercentage?.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Events with &gt;100% fill rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Digest Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {coverage?.history?.[0]?.coverage || 0}%
            </div>
            <p className="text-xs text-muted-foreground">Last week's eligible hosts reached</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Weekly Summary Views (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{premiumOps?.totals?.summaryViewed || 0}</div>
            <p className="text-xs text-muted-foreground">
              {premiumOps?.totals?.summaryViewedUniqueUsers || 0} unique operators
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Summary Emails (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{premiumOps?.totals?.summaryEmailed || 0}</div>
            <p className="text-xs text-muted-foreground">
              {premiumOps?.totals?.summaryEmailedUniqueUsers || 0} unique operators
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live Location Uses (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{premiumOps?.totals?.liveLocationUsed || 0}</div>
            <p className="text-xs text-muted-foreground">
              {premiumOps?.totals?.liveLocationUsedUniqueUsers || 0} unique operators
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Manual Schedules (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{premiumOps?.totals?.manualScheduleUsed || 0}</div>
            <p className="text-xs text-muted-foreground">
              {premiumOps?.totals?.manualScheduleUsedUniqueUsers || 0} unique operators
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Open-Call Fill Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {openCallSeries?.totals?.fillRatePct?.toFixed?.(1) ?? 0}%
            </div>
            <p className="text-xs text-muted-foreground">Accepted vs upcoming capacity</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Accepted Decisions (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {openCallSeries?.totals?.acceptedDecisions || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {openCallSeries?.totals?.declinedDecisions || 0} declined
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Acceptance Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {openCallSeries?.totals?.acceptanceRatePct?.toFixed?.(1) ?? 0}%
            </div>
            <p className="text-xs text-muted-foreground">Accepted out of total decisions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Trucks Impacted (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {openCallSeries?.totals?.trucksImpacted || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {openCallSeries?.totals?.seriesCancelled || 0} cancelled series
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Middle Row: Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        
        {/* Interest Velocity */}
        <Card>
          <CardHeader>
            <CardTitle>Interest Velocity (30 Days)</CardTitle>
            <CardDescription>Daily volume of new truck interests</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={velocity}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(str) => new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  fontSize={12}
                />
                <YAxis fontSize={12} />
                <Tooltip 
                  labelFormatter={(str) => new Date(str).toLocaleDateString()}
                />
                <Area type="monotone" dataKey="count" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Fill Rate Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Fill Rate Distribution</CardTitle>
            <CardDescription>How full are our events?</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fillRates?.buckets}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Digest History */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Digest History</CardTitle>
          <CardDescription>Email delivery performance over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={coverage?.history}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" fontSize={12} />
              <YAxis yAxisId="left" orientation="left" stroke="#8884d8" fontSize={12} />
              <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" unit="%" fontSize={12} />
              <Tooltip />
              <Bar yAxisId="left" dataKey="sent" name="Sent Emails" fill="#8884d8" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="coverage" name="Coverage %" stroke="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Premium Ops Adoption Trend (Last 30 Days)</CardTitle>
          <CardDescription>
            Daily usage of weekly summary, live location, and manual scheduling
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={premiumOps?.history || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Line type="monotone" dataKey="premium_summary_viewed" name="Summary Views" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="premium_summary_emailed" name="Summary Emails" stroke="#7c3aed" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="premium_live_location_used" name="Live Location" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="premium_manual_schedule_used" name="Manual Schedule" stroke="#ea580c" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Summary to Email (Events)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryEmailActionRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Email actions / summary views</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Summary to Email (Users)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryEmailUserRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Users who viewed and emailed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live Activation Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{liveActivationUserRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Live-location users / summary users</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Manual Schedule Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{manualScheduleUserRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Schedule users / summary users</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Premium Ops Next Target</CardTitle>
          <CardDescription>
            Recommendation generated from the current 30-day adoption profile
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-base font-semibold">{recommendation.title}</div>
          <p className="text-sm text-muted-foreground mt-2">{recommendation.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Top Open-Call Series (Upcoming {openCallSeries?.upcomingWindowDays || 30} Days)
          </CardTitle>
          <CardDescription>
            Fill rate by series for active upcoming occurrences
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={openCallSeries?.topSeries || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="seriesName" fontSize={12} interval={0} angle={-18} textAnchor="end" height={72} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="fillRatePct" name="Fill Rate %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">UX Recovery Events (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uxRecovery?.totals?.totalEvents || 0}</div>
            <p className="text-xs text-muted-foreground">
              Total clicks on recovery paths
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Unique Users (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uxRecovery?.totals?.totalUniqueUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              Users interacting with recovery flows
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Recovery Action</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-base font-semibold truncate">
              {uxRecovery?.topEvents?.[0]?.eventName || "N/A"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {uxRecovery?.topEvents?.[0]?.count || 0} events
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>UX Recovery Actions (Last 7 Days)</CardTitle>
          <CardDescription>
            What users click when they hit empty states or fallback prompts
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={uxRecovery?.topEvents || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" fontSize={12} />
              <YAxis
                type="category"
                dataKey="eventName"
                width={220}
                fontSize={12}
              />
              <Tooltip />
              <Bar dataKey="count" name="Events" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Data Note</AlertTitle>
        <AlertDescription>
          Time-to-Decision metrics are currently unavailable. Requires schema update to track `decidedAt` timestamp.
        </AlertDescription>
      </Alert>
    </div>
  );
}



