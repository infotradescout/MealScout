import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Clock3, MapPin, Truck } from "lucide-react";

import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

type TruckSighting = {
  id: string;
  truckName: string;
  notes: string | null;
  latitude: number;
  longitude: number;
  locationLabel: string | null;
  source: string;
  status: "pending" | "reviewing" | "outreach" | "claimed" | "dismissed" | "duplicate";
  reportCount: number;
  firstSeenAt: string;
  lastReportedAt: string;
  createdAt: string;
  updatedAt: string;
  adminNotes: string | null;
  linkedRestaurantId: string | null;
  reviewedAt: string | null;
  reportedByUserId: string | null;
  reportedByEmail: string | null;
  reviewedByUserId: string | null;
  reviewedByEmail: string | null;
  expiresAt: string;
  isLive: boolean;
};

const statusOptions: Array<TruckSighting["status"]> = [
  "pending",
  "reviewing",
  "outreach",
  "claimed",
  "dismissed",
  "duplicate",
];

export default function AdminTruckSightingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isAdminLike =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [limit, setLimit] = useState<string>("200");

  const { data, isLoading, isError } = useQuery<{ rows: TruckSighting[]; count: number }>({
    queryKey: ["/api/admin/truck-sightings", statusFilter, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", String(Math.max(1, Math.min(500, Number(limit || "200") || 200))));
      const res = await fetch(`/api/admin/truck-sightings?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message || "Failed to load truck sightings");
      }
      return res.json();
    },
    enabled: isAdminLike,
    refetchOnWindowFocus: false,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      status?: TruckSighting["status"];
      adminNotes?: string;
    }) => {
      const res = await fetch(`/api/admin/truck-sightings/${encodeURIComponent(payload.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: payload.status,
          adminNotes: payload.adminNotes,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Failed to update truck sighting");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/truck-sightings"] });
    },
  });

  const rows = useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]);
  const liveCount = rows.filter((row) => row.isLive).length;

  if (!isAdminLike) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-background pb-24">
        <BackHeader title="Truck Sightings" fallbackHref="/admin/dashboard" />
        <div className="px-4 py-8">
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Staff or admin access is required to review crowd-sourced truck sightings.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-background pb-24">
      <BackHeader title="Truck Sightings" fallbackHref="/admin/dashboard" />

      <div className="px-4 py-4 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Crowd-Sourced Truck Pings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Map visibility is limited to 1 hour for unpaid sightings. Admin history is retained for due diligence and outreach.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border p-2">
                <div className="text-muted-foreground">Rows loaded</div>
                <div className="text-lg font-semibold">{rows.length}</div>
              </div>
              <div className="rounded-lg border p-2">
                <div className="text-muted-foreground">Live now ({"<="}1h)</div>
                <div className="text-lg font-semibold">{liveCount}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-10 rounded-md border px-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <Input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="Limit"
              />
            </div>
          </CardContent>
        </Card>

        {isLoading && <Card><CardContent className="py-6 text-sm">Loading sightings...</CardContent></Card>}
        {isError && <Card><CardContent className="py-6 text-sm text-red-600">Unable to load truck sightings right now.</CardContent></Card>}

        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4" />
                    <h3 className="text-sm font-semibold">{row.truckName}</h3>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock3 className="w-3 h-3" />
                    Last seen {new Date(row.lastReportedAt).toLocaleString()}
                  </div>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {row.status}
                </span>
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
              </div>

              {row.locationLabel && (
                <div className="text-xs text-muted-foreground">{row.locationLabel}</div>
              )}

              {row.notes && (
                <div className="rounded-md bg-muted/50 p-2 text-xs">{row.notes}</div>
              )}

              <div className="text-[11px] text-muted-foreground">
                Reports: {row.reportCount} · Source: {row.source} · Live on map: {row.isLive ? "yes" : "no"}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      status: "reviewing",
                    })
                  }
                  disabled={updateMutation.isPending}
                >
                  Review
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      status: "outreach",
                    })
                  }
                  disabled={updateMutation.isPending}
                >
                  Outreach
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      status: "dismissed",
                    })
                  }
                  disabled={updateMutation.isPending}
                >
                  Dismiss
                </Button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Reporter: {row.reportedByEmail || "guest"}</span>
                <Link href={`/admin/truck-import-listings/search?q=${encodeURIComponent(row.truckName)}`}>
                  <a className="underline underline-offset-2">Find match</a>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

        {!isLoading && !isError && rows.length === 0 && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              No crowd-sourced truck sightings found for this filter.
            </CardContent>
          </Card>
        )}

        <div className="pt-2">
          <Link href="/admin/dashboard">
            <Button variant="ghost" className="w-full" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to admin dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
