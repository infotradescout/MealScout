import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ObservatoryData = any;

const formatRate = (rate: any) =>
  rate?.percent == null
    ? "No denominator yet"
    : `${Number(rate.percent).toFixed(1)}% (${Number(rate.numerator || 0)} of ${Number(
        rate.denominator || 0,
      )})`;

const evidenceTone = (state: string) => {
  if (["available", "current", "known", "observed"].includes(state)) {
    return "default" as const;
  }
  if (["stale", "unknown"].includes(state)) return "secondary" as const;
  return "outline" as const;
};

function EmptyEvidence({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export default function AdminDiscoveryObservatory() {
  const queryClient = useQueryClient();
  const [decisionRationales, setDecisionRationales] = useState<Record<string, string>>({});
  const { data, isLoading, error } = useQuery<ObservatoryData>({
    queryKey: ["/api/admin/discovery-observatory", 30],
    queryFn: async () => {
      const response = await fetch("/api/admin/discovery-observatory?windowDays=30", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.message || payload?.error || "Discovery Observatory is unavailable",
        );
      }
      return payload;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
  const decisionMutation = useMutation({
    mutationFn: async (input: {
      experimentId: string;
      decision: "hold" | "approved" | "rejected";
      rationale: string;
    }) => {
      const response = await fetch(
        `/api/admin/discovery-observatory/experiments/${encodeURIComponent(input.experimentId)}/decision`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            decision: input.decision,
            decisionAuthority: "owner_review",
            idempotencyKey: crypto.randomUUID(),
            rationale: input.rationale,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Owner decision was not recorded");
      }
      return payload;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/discovery-observatory", 30],
      });
    },
  });

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center" aria-label="Loading Discovery Observatory">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="container mx-auto max-w-5xl py-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Discovery Observatory unavailable</AlertTitle>
          <AlertDescription>{(error as Error)?.message || "No evidence response was returned."}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const funnel = data.funnel || {};
  const freshnessCoverage = Object.entries(data.freshness?.coverage || {});
  const freshnessFailures = Array.isArray(data.freshness?.failures)
    ? data.freshness.failures
    : [];
  const queries = Array.isArray(data.queryCollection) ? data.queryCollection : [];
  const experiments = Array.isArray(data.experiments) ? data.experiments : [];
  const impressionOnly = Array.isArray(data.pagesWithImpressionsButNoActions)
    ? data.pagesWithImpressionsButNoActions
    : [];

  return (
    <main className="container mx-auto max-w-7xl space-y-8 py-8" data-testid="discovery-observatory">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Discovery Observatory</h1>
          <Badge variant="outline">Administrator only</Badge>
          <Badge variant="secondary">{Number(data.windowDays || 30)}-day requested window</Badge>
        </div>
        <p className="max-w-4xl text-muted-foreground">
          Outside visibility, real MealScout entries, deliberate actions, merchant receipt, and completed outcomes remain separate facts. Unknown evidence stays in the math.
        </p>
      </header>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Evidence boundary</AlertTitle>
        <AlertDescription>
          A search result does not prove a visit. A visit does not prove an action. An action does not prove the merchant received it or that the customer outcome completed.
        </AlertDescription>
      </Alert>

      <Alert>
        <Database className="h-4 w-4" />
        <AlertTitle>Retention boundary</AlertTitle>
        <AlertDescription>
          {data.retention?.evidenceBoundary || "Operational evidence retention is unavailable."}
        </AlertDescription>
      </Alert>

      <section aria-labelledby="journey-heading" className="space-y-4">
        <div>
          <h2 id="journey-heading" className="text-2xl font-semibold">Discovery-to-outcome journey</h2>
          <p className="text-sm text-muted-foreground">Every number is a distinct journey, not a joined row count.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Actual entries", funnel.entries, "Real MealScout landings"],
            ["Deliberate actions", funnel.actions, "Follow, menu, schedule, or order attempts"],
            ["Merchant receipts", funnel.merchantReceipts, "Separately observed receipt state"],
            ["Completed outcomes", funnel.completedOutcomes, "Separately observed completion"],
          ].map(([label, value, note], index) => (
            <Card key={String(label)}>
              <CardHeader className="pb-2">
                <CardDescription>{String(label)}</CardDescription>
                <CardTitle className="text-3xl">{Number(value || 0)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{String(note)}</p>
                {index < 3 ? <ArrowRight className="mt-3 h-4 w-4 text-muted-foreground" aria-hidden="true" /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Entry → action", funnel.entryToAction, data.denominators?.entryToAction],
            ["Action → merchant receipt", funnel.actionToMerchantReceipt, data.denominators?.actionToMerchantReceipt],
            ["Action → completed outcome", funnel.actionToCompletedOutcome, data.denominators?.actionToCompletedOutcome],
          ].map(([label, rate, denominator]) => (
            <Card key={String(label)}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{String(label)}</CardTitle>
                <CardDescription>{formatRate(rate)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <p>{String(denominator || "Denominator unavailable")}</p>
                <p>Unknown within denominator: {Number((rate as any)?.unknown || 0)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Excluded orphan or out-of-order evidence</CardTitle>
            <CardDescription>These distinct-journey exclusions cannot enter conversion numerators.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(funnel.exclusions || {}).map(([reason, count]) => (
              <div key={reason} className="flex justify-between gap-3 rounded-md border p-2">
                <span className="text-muted-foreground">{reason.replace(/([A-Z])/g, " $1")}</span>
                <strong>{Number(count || 0)}</strong>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="freshness-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5" aria-hidden="true" />
          <h2 id="freshness-heading" className="text-2xl font-semibold">Freshness guardrail</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Evidence coverage</CardTitle>
            <CardDescription>Known false and confirmed unavailable states are not mislabeled as missing.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Freshness field</th>
                  <th className="py-2 pr-4">Known true</th>
                  <th className="py-2 pr-4">Known false</th>
                  <th className="py-2 pr-4">Unknown</th>
                  <th className="py-2">Denominator</th>
                </tr>
              </thead>
              <tbody>
                {freshnessCoverage.map(([field, value]: [string, any]) => (
                  <tr key={field} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{field.replace(/([A-Z])/g, " $1")}</td>
                    <td className="py-3 pr-4">{Number(value.knownTrue || 0)}</td>
                    <td className="py-3 pr-4">{Number(value.knownFalse || 0)}</td>
                    <td className="py-3 pr-4">{Number(value.unknown || 0)}</td>
                    <td className="py-3">{Number(value.denominator || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stale, unknown, or unavailable facts</CardTitle>
            <CardDescription>{freshnessFailures.length} finding(s); these remain visible instead of dropping from rates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {freshnessFailures.length === 0 ? (
              <EmptyEvidence>No freshness failures are recorded in the available supply evidence.</EmptyEvidence>
            ) : (
              freshnessFailures.slice(0, 30).map((finding: any) => (
                <div key={`${finding.entityType}:${finding.entityId}:${finding.field}`} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{finding.entityName}</p>
                    <p className="text-sm text-muted-foreground">{finding.field}: {finding.detail}</p>
                  </div>
                  <Badge variant={evidenceTone(finding.state)}>{finding.state}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Independent observation detail</CardTitle>
            <CardDescription>Result state and query-evidence state are separate; unknown queries stay visible.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.outsideObservationDetails || []).length === 0 ? (
              <EmptyEvidence>No independent observation has been captured in the observatory store.</EmptyEvidence>
            ) : (
              data.outsideObservationDetails.slice(0, 50).map((row: any) => (
                <div key={row.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={evidenceTone(row.observationResult)}>{row.observationResult}</Badge>
                    <Badge variant={evidenceTone(row.queryEvidenceState)}>query {row.queryEvidenceState}</Badge>
                    <span className="text-muted-foreground">{row.source} · {row.surface || "surface unknown"}</span>
                  </div>
                  <p className="mt-2 font-medium">{row.query || "Query not available"}</p>
                  {row.displayedPage ? <p className="break-all text-muted-foreground">{row.displayedPage}</p> : null}
                  {(row.competitors || []).length > 0 ? <p className="text-muted-foreground">Competitors: {row.competitors.join(", ")}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">{row.observedAt} ({row.observationPrecision}) · {row.evidenceBoundary}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Discovery evidence">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Evidence availability</CardTitle>
            <CardDescription>Unavailable providers stay unavailable; no observations are invented.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data.evidenceAvailability || []).map((source: any) => (
              <div key={source.source} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{source.source}</p>
                  <Badge variant={evidenceTone(source.state)}>{source.state}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{source.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sources producing entries</CardTitle>
            <CardDescription>Distinct actual landings by recorded source.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.sourcesProducingEntries || []).length === 0 ? (
              <EmptyEvidence>No source-linked entries are available. Entry source remains unknown.</EmptyEvidence>
            ) : (
              data.sourcesProducingEntries.map((row: any) => (
                <div key={row.source} className="flex justify-between rounded-md border p-3">
                  <span>{row.source}</span><strong>{row.distinctEntries}</strong>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pages appearing or cited</CardTitle>
            <CardDescription>Only independent observations with result state “observed.”</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.pagesAppearingOrCited || []).length === 0 ? (
              <EmptyEvidence>No independently recorded cited page is available in this data store.</EmptyEvidence>
            ) : (
              data.pagesAppearingOrCited.map((row: any, index: number) => (
                <div key={`${row.page}:${index}`} className="rounded-md border p-3 text-sm">
                  <p className="break-all font-medium">{row.page}</p>
                  <p className="text-muted-foreground">{row.source} · {row.surface || "surface unknown"} · {row.linkStrength}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repeated competitors and outside sources</CardTitle>
            <CardDescription>Counts only independently observed outside results.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Competitors</p>
              {(data.repeatedCompetitors || []).length === 0 ? <EmptyEvidence>No repeated competitor is established.</EmptyEvidence> : data.repeatedCompetitors.map((row: any) => <p key={row.name} className="text-sm">{row.name}: {row.count}</p>)}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Outside sources</p>
              {(data.repeatedOutsideSources || []).length === 0 ? <EmptyEvidence>No repeated outside source is established.</EmptyEvidence> : data.repeatedOutsideSources.map((row: any) => <p key={row.name} className="text-sm">{row.name}: {row.count}</p>)}
            </div>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="queries-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5" aria-hidden="true" />
          <h2 id="queries-heading" className="text-2xl font-semibold">Living query collection</h2>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{queries.length} supply-grounded query candidate(s)</CardTitle>
            <CardDescription>Built from current eligible businesses, schedules, events, menus, fulfillment settings, and safe zero-result searches. It creates no public location pages.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {queries.length === 0 ? (
              <EmptyEvidence>Active supply evidence is unavailable, so no query candidates were invented.</EmptyEvidence>
            ) : (
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2 pr-4">Query</th><th className="py-2 pr-4">Kind</th><th className="py-2 pr-4">Market</th><th className="py-2">Supply evidence</th></tr>
                </thead>
                <tbody>
                  {queries.slice(0, 60).map((row: any) => (
                    <tr key={`${row.category}:${row.query}`} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.query}</td>
                      <td className="py-3 pr-4">{row.category}</td>
                      <td className="py-3 pr-4">{row.market || "Unknown"}</td>
                      <td className="py-3 text-muted-foreground">{row.supplyEvidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Demand gaps">
        <Card>
          <CardHeader><CardTitle>Impressions with no action</CardTitle><CardDescription>Distinct page entries with zero measured action journeys.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {impressionOnly.length === 0 ? <EmptyEvidence>No impression-only page is established in the available window.</EmptyEvidence> : impressionOnly.map((row: any) => <div key={row.page} className="rounded-md border p-3 text-sm"><p className="font-medium break-all">{row.page}</p><p className="text-muted-foreground">{row.impressions} distinct impression(s), 0 actions</p></div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Unclaimed entities receiving demand</CardTitle><CardDescription>Only directly linked demand counts. Unmatched demand stays unknown.</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(data.unclaimedEntitiesReceivingDemand?.items || []).length === 0 ? <EmptyEvidence>No directly linked unclaimed demand is established; unknown remains true.</EmptyEvidence> : data.unclaimedEntitiesReceivingDemand.items.map((row: any) => <div key={row.entityId} className="flex justify-between rounded-md border p-3"><span>{row.name}</span><strong>{row.distinctDemand}</strong></div>)}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="experiments-heading" className="space-y-4">
        <h2 id="experiments-heading" className="text-2xl font-semibold">Ranked experiment queue</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {experiments.map((experiment: any) => (
            <Card key={experiment.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3"><Badge>Rank {experiment.rank}</Badge><Badge variant={experiment.decision === "approved" ? "default" : "outline"}>{experiment.decision || "hold"}</Badge></div>
                <CardTitle className="pt-2 text-lg">{experiment.question}</CardTitle>
                <CardDescription>{experiment.baseline} Evidence score: {Number(experiment.evidenceScore || 0)}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {(experiment.scoringEvidence || []).map((item: string) => <p key={item}>{item}</p>)}
                </div>
                <p><strong>One change:</strong> {experiment.controlledChange}</p>
                <p><strong>Target:</strong> {experiment.target}</p>
                <p><strong>Action:</strong> {experiment.intendedAction}</p>
                <p><strong>Period:</strong> {experiment.observationPeriod}</p>
                <p><strong>Success:</strong> {experiment.successMeasure}</p>
                <p><strong>Failure:</strong> {experiment.failureCondition}</p>
                <p><strong>Rollback:</strong> {experiment.rollbackCondition}</p>
                <p className="text-muted-foreground"><strong>Boundary:</strong> {experiment.evidenceBoundary}</p>
                <p className="text-xs text-muted-foreground">Immutable decision events: {Number(experiment.decisionHistory?.length || 0)}. Distinct predeclared assignments: {Number(experiment.distinctAssignments || 0)}. No decision or assignment publishes a public change.</p>
                <Input
                  value={decisionRationales[experiment.id] || ""}
                  onChange={(event) =>
                    setDecisionRationales((current) => ({
                      ...current,
                      [experiment.id]: event.target.value,
                    }))
                  }
                  placeholder="Owner-review rationale (required)"
                  aria-label={`Decision rationale for ${experiment.id}`}
                />
                <div className="flex flex-wrap gap-2">
                  {(["hold", "approved", "rejected"] as const).map((decision) => (
                    <Button
                      key={decision}
                      size="sm"
                      variant={decision === "approved" ? "default" : "outline"}
                      disabled={
                        decisionMutation.isPending ||
                        (decisionRationales[experiment.id] || "").trim().length < 3
                      }
                      onClick={() =>
                        decisionMutation.mutate({
                          experimentId: experiment.id,
                          decision,
                          rationale: decisionRationales[experiment.id].trim(),
                        })
                      }
                    >
                      Record {decision}
                    </Button>
                  ))}
                </div>
                {decisionMutation.error && decisionMutation.variables?.experimentId === experiment.id ? (
                  <p className="text-sm text-destructive">{(decisionMutation.error as Error).message}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="integrity-heading">
        <Card>
          <CardHeader>
            <CardTitle id="integrity-heading" className="flex items-center gap-2">
              {data.integrity?.valid ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-amber-600" />}
              Evidence integrity
            </CardTitle>
            <CardDescription>{data.integrity?.noJoinMultiplication}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {[
              ["Duplicate IDs", data.integrity?.duplicateRecordIds],
              ["Journey/entity conflicts", data.integrity?.journeyEntityConflicts],
              ["Future timestamps", data.integrity?.futureDatedRecordIds],
              ["Duplicate assignments", data.integrity?.duplicateExperimentAssignments],
              ["Events before assignment", data.integrity?.experimentEventsBeforeAssignment],
              ["Missing source freshness", data.integrity?.missingSourceFreshnessRecordIds],
            ].map(([label, rows]) => (
              <div key={String(label)} className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{String(label)}</p>
                <p className="text-2xl font-semibold">{Array.isArray(rows) ? rows.length : 0}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="unknowns-heading">
        <Card>
          <CardHeader><CardTitle id="unknowns-heading">Unknown or unavailable evidence</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data.explicitUnknowns || []).map((unknown: string) => <p key={unknown} className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{unknown}</p>)}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
