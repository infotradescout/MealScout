import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { BarChart3, Loader2, ShieldCheck } from "lucide-react";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";

type Business = {
  id: string;
  name: string;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  city?: string | null;
  state?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
};

type Partner = {
  targetRestaurantId: string;
  targetName?: string | null;
  status: "approved" | "excluded";
};
type InboundPartner = {
  sourceRestaurantId: string;
  sourceName: string;
  commissionBps: number;
  targetApprovedAt?: string | null;
};

export default function MerchantPromotionsPage() {
  const search = useSearch();
  const { toast } = useToast();
  const requestedId = new URLSearchParams(search).get("restaurantId");
  const [restaurantId, setRestaurantId] = useState(requestedId || "");
  const [enabled, setEnabled] = useState(true);
  const [approvalMode, setApprovalMode] = useState<
    "automatic" | "approved_only"
  >("automatic");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [inboundTerms, setInboundTerms] = useState<
    Array<{
      sourceRestaurantId: string;
      commissionBps: number;
      approved: boolean;
    }>
  >([]);
  const [saving, setSaving] = useState(false);

  const businessesQuery = useQuery<Business[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    queryFn: async () => {
      const response = await fetch(apiUrl("/api/restaurants/my-restaurants"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to load businesses");
      return response.json();
    },
  });
  const businesses = businessesQuery.data || [];
  useEffect(() => {
    if (!restaurantId && businesses[0]?.id) setRestaurantId(businesses[0].id);
  }, [businesses, restaurantId]);
  const business = useMemo(
    () => businesses.find((item) => item.id === restaurantId) || businesses[0],
    [businesses, restaurantId],
  );

  const controlsQuery = useQuery<{
    policy: { enabled: boolean; approvalMode: "automatic" | "approved_only" };
    partners: Partner[];
    candidates: Array<{ id: string; name: string; businessType?: string | null }>;
    inboundPartners: InboundPartner[];
  }>({
    queryKey: ["/api/restaurants", restaurantId, "promotion-controls"],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/restaurants/${restaurantId}/promotion-controls`),
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Unable to load promotion controls");
      return response.json();
    },
  });
  useEffect(() => {
    if (!controlsQuery.data) return;
    setEnabled(controlsQuery.data.policy.enabled);
    setApprovalMode(controlsQuery.data.policy.approvalMode);
    setPartners(controlsQuery.data.partners || []);
    setInboundTerms(
      (controlsQuery.data.inboundPartners || []).map((partner) => ({
        sourceRestaurantId: partner.sourceRestaurantId,
        commissionBps: Number(partner.commissionBps || 0),
        approved: Boolean(partner.targetApprovedAt),
      })),
    );
  }, [controlsQuery.data]);

  const reportQuery = useQuery<{
    clicks: number;
    attributedOrders: number;
    conversionRate: number;
    eligibleOrders: number;
    earnedCents: number;
    reversedCents: number;
  }>({
    queryKey: ["/api/restaurants", restaurantId, "promotion-report"],
    enabled: Boolean(restaurantId),
    queryFn: async () => {
      const response = await fetch(
        apiUrl(`/api/restaurants/${restaurantId}/promotion-report?window=30d`),
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Unable to load promotion report");
      return response.json();
    },
  });

  const setPartnerStatus = (
    targetRestaurantId: string,
    targetName: string,
    status: "approved" | "excluded",
  ) =>
    setPartners((current) => [
      ...current.filter(
        (partner) => partner.targetRestaurantId !== targetRestaurantId,
      ),
      { targetRestaurantId, targetName, status },
    ]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(
        apiUrl(`/api/restaurants/${restaurantId}/promotion-controls`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            enabled,
            approvalMode,
            partners,
            inboundTerms,
          }),
        },
      );
      if (!response.ok) throw new Error("Unable to save promotion controls");
      toast({ title: "Promotion controls saved" });
    } catch (error: any) {
      toast({
        title: "Could not save",
        description: error?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!business) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {businessesQuery.isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          "Create or claim a business first."
        )}
      </div>
    );
  }

  const report = reportQuery.data;
  return (
    <BusinessWorkspaceShell
      activeModule="promotions"
      business={business}
      businesses={businesses}
      onBusinessChange={setRestaurantId}
    >
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Cross-promotion</h1>
          <p className="text-muted-foreground">
            Control which local businesses appear on your profile and see orders
            your recommendations produced.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Merchant controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="promotion-enabled">Show local recommendations</Label>
              <Switch
                id="promotion-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-medium">Approval rule</span>
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={approvalMode}
                onChange={(event) =>
                  setApprovalMode(
                    event.target.value as "automatic" | "approved_only",
                  )
                }
              >
                <option value="automatic">
                  Automatic, except businesses I exclude
                </option>
                <option value="approved_only">
                  Only businesses I explicitly approve
                </option>
              </select>
            </label>
            {partners.length > 0 ? (
              <div className="space-y-2">
                <Label>Saved business rules</Label>
                {partners.map((partner) => (
                  <div
                    key={partner.targetRestaurantId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <span>{partner.targetName || partner.targetRestaurantId}</span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          partner.status === "approved" ? "default" : "outline"
                        }
                        onClick={() =>
                          setPartnerStatus(
                            partner.targetRestaurantId,
                            partner.targetName || partner.targetRestaurantId,
                            "approved",
                          )
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          partner.status === "excluded"
                            ? "destructive"
                            : "outline"
                        }
                        onClick={() =>
                          setPartnerStatus(
                            partner.targetRestaurantId,
                            partner.targetName || partner.targetRestaurantId,
                            "excluded",
                          )
                        }
                      >
                        Exclude
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {(controlsQuery.data?.candidates || []).length > 0 ? (
              <div className="space-y-2">
                <Label>Local businesses</Label>
                {(controlsQuery.data?.candidates || []).map((candidate) => {
                  const saved = partners.find(
                    (partner) => partner.targetRestaurantId === candidate.id,
                  );
                  return (
                    <div
                      key={candidate.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <div className="font-medium">{candidate.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {candidate.businessType || "Food business"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            saved?.status === "approved" ? "default" : "outline"
                          }
                          onClick={() =>
                            setPartnerStatus(
                              candidate.id,
                              candidate.name,
                              "approved",
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            saved?.status === "excluded"
                              ? "destructive"
                              : "outline"
                          }
                          onClick={() =>
                            setPartnerStatus(
                              candidate.id,
                              candidate.name,
                              "excluded",
                            )
                          }
                        >
                          Exclude
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save controls"}
            </Button>
          </CardContent>
        </Card>
        {(controlsQuery.data?.inboundPartners || []).length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Affiliate terms you fund</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No promoted-order commission is created until you explicitly
                approve a rate for the business sending you customers.
              </p>
              {(controlsQuery.data?.inboundPartners || []).map((partner) => {
                const terms = inboundTerms.find(
                  (item) =>
                    item.sourceRestaurantId === partner.sourceRestaurantId,
                ) || {
                  sourceRestaurantId: partner.sourceRestaurantId,
                  commissionBps: 0,
                  approved: false,
                };
                const update = (next: Partial<typeof terms>) =>
                  setInboundTerms((current) => [
                    ...current.filter(
                      (item) =>
                        item.sourceRestaurantId !== partner.sourceRestaurantId,
                    ),
                    { ...terms, ...next },
                  ]);
                return (
                  <div
                    key={partner.sourceRestaurantId}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_140px_auto]"
                  >
                    <div className="font-medium">{partner.sourceName}</div>
                    <label className="text-sm">
                      Commission %
                      <input
                        className="mt-1 h-9 w-full rounded-md border bg-background px-2"
                        type="number"
                        min="0"
                        max="100"
                        step="0.25"
                        value={terms.commissionBps / 100}
                        onChange={(event) =>
                          update({
                            commissionBps: Math.round(
                              Number(event.target.value || 0) * 100,
                            ),
                          })
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant={terms.approved ? "default" : "outline"}
                      onClick={() => update({ approved: !terms.approved })}
                    >
                      {terms.approved ? "Approved" : "Approve terms"}
                    </Button>
                  </div>
                );
              })}
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save affiliate terms"}
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" /> Last 30 days
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {[
              ["Recommendation visits", report?.clicks || 0],
              ["Attributed orders", report?.attributedOrders || 0],
              [
                "Conversion",
                `${(((report?.conversionRate || 0) * 100).toFixed(1))}%`,
              ],
              ["Eligible orders", report?.eligibleOrders || 0],
              ["Earned", `$${((report?.earnedCents || 0) / 100).toFixed(2)}`],
              [
                "Reversed",
                `$${((report?.reversedCents || 0) / 100).toFixed(2)}`,
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="text-xl font-bold">{value}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </BusinessWorkspaceShell>
  );
}
