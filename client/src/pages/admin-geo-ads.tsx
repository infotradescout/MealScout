import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoogleMapPicker } from "@/components/maps/GoogleMapPicker";
import type { MapPickerPin } from "@/components/maps/GoogleMapPicker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Target } from "lucide-react";
import Navigation from "@/components/navigation";

const defaultCenter = { lat: 39.8283, lng: -98.5795 };

type GeoAdForm = {
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  placements: Array<"map" | "home" | "deals">;
  title: string;
  body: string;
  mediaUrl: string;
  targetUrl: string;
  ctaText: string;
  geofenceLat: number;
  geofenceLng: number;
  geofenceRadiusM: number;
  targetUserTypes: string[];
  minDailyFootTraffic: number | "";
  maxDailyFootTraffic: number | "";
  priority: number;
  startAt: string;
  endAt: string;
};

const emptyForm: GeoAdForm = {
  name: "",
  status: "draft",
  placements: ["map", "home", "deals"],
  title: "",
  body: "",
  mediaUrl: "",
  targetUrl: "",
  ctaText: "Learn more",
  geofenceLat: defaultCenter.lat,
  geofenceLng: defaultCenter.lng,
  geofenceRadiusM: 1500,
  targetUserTypes: [],
  minDailyFootTraffic: "",
  maxDailyFootTraffic: "",
  priority: 0,
  startAt: "",
  endAt: "",
};

const placementOptions: Array<GeoAdForm["placements"][number]> = [
  "map",
  "home",
  "deals",
];

const userTypeOptions = [
  "guest",
  "customer",
  "food_truck",
  "restaurant_owner",
  "host",
  "event_coordinator",
  "staff",
  "admin",
  "duper_admin",
  "super_admin",
];

function GeoAdMap({
  center,
  radius,
  onCenterChange,
}: {
  center: { lat: number; lng: number };
  radius: number;
  onCenterChange: (lat: number, lng: number) => void;
}) {
  const pins: MapPickerPin[] = [
    {
      key: "geofence-center",
      position: center,
      draggable: true,
    },
  ];
  return (
    <GoogleMapPicker
      center={center}
      zoom={13}
      pins={pins}
      circleRadiusMetres={radius}
      onMapClick={(p) => onCenterChange(p.lat, p.lng)}
      onPinDrag={(_key, p) => onCenterChange(p.lat, p.lng)}
      className="rounded-xl overflow-hidden"
    />
  );
}

export default function AdminGeoAds() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GeoAdForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: ads = [], isLoading } = useQuery({
    queryKey: ["/api/admin/geo-ads"],
    queryFn: async () => {
      const res = await fetch("/api/admin/geo-ads", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch geo ads");
      return res.json();
    },
  });

  const { data: metrics } = useQuery({
    queryKey: editingId ? ["/api/admin/geo-ads", editingId, "metrics"] : [],
    queryFn: async () => {
      const res = await fetch(`/api/admin/geo-ads/${editingId}/metrics`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch metrics");
      return res.json();
    },
    enabled: Boolean(editingId),
  });

  const createAd = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/admin/geo-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create ad");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/geo-ads"] });
      setForm(emptyForm);
      setEditingId(null);
    },
  });

  const updateAd = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`/api/admin/geo-ads/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to update ad");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/geo-ads"] });
    },
  });

  const archiveAd = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/geo-ads/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to archive ad");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/geo-ads"] });
      if (editingId) {
        setEditingId(null);
        setForm(emptyForm);
      }
    },
  });

  const mapCenter = useMemo(() => {
    const lat =
      Number.isFinite(form.geofenceLat) && form.geofenceLat !== 0
        ? form.geofenceLat
        : defaultCenter.lat;
    const lng =
      Number.isFinite(form.geofenceLng) && form.geofenceLng !== 0
        ? form.geofenceLng
        : defaultCenter.lng;
    return { lat, lng };
  }, [form.geofenceLat, form.geofenceLng]);

  const handleSubmit = () => {
    const payload = {
      ...form,
      mediaUrl: form.mediaUrl.trim() || null,
      body: form.body.trim() || null,
      ctaText: form.ctaText.trim() || "Learn more",
      minDailyFootTraffic:
        form.minDailyFootTraffic === "" ? null : form.minDailyFootTraffic,
      maxDailyFootTraffic:
        form.maxDailyFootTraffic === "" ? null : form.maxDailyFootTraffic,
      targetUserTypes: form.targetUserTypes,
      startAt: form.startAt || null,
      endAt: form.endAt || null,
    };

    if (editingId) {
      updateAd.mutate(payload);
    } else {
      createAd.mutate(payload);
    }
  };

  const selectAd = (ad: any) => {
    setEditingId(ad.id);
    setForm({
      name: ad.name || "",
      status: ad.status || "draft",
      placements: Array.isArray(ad.placements)
        ? (ad.placements as GeoAdForm["placements"])
        : [],
      title: ad.title || "",
      body: ad.body || "",
      mediaUrl: ad.mediaUrl || "",
      targetUrl: ad.targetUrl || "",
      ctaText: ad.ctaText || "Learn more",
      geofenceLat: Number(ad.geofenceLat) || defaultCenter.lat,
      geofenceLng: Number(ad.geofenceLng) || defaultCenter.lng,
      geofenceRadiusM: Number(ad.geofenceRadiusM) || 1500,
      targetUserTypes: Array.isArray(ad.targetUserTypes)
        ? ad.targetUserTypes
        : [],
      minDailyFootTraffic: ad.minDailyFootTraffic ?? "",
      maxDailyFootTraffic: ad.maxDailyFootTraffic ?? "",
      priority: ad.priority ?? 0,
      startAt: ad.startAt ? new Date(ad.startAt).toISOString().slice(0, 16) : "",
      endAt: ad.endAt ? new Date(ad.endAt).toISOString().slice(0, 16) : "",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">
              Geo Ads Studio
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Build onsite campaigns tied to real locations. All placements are
            location-based.
          </p>
        </header>

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                {editingId ? "Edit Campaign" : "Create Campaign"}
              </CardTitle>
              <CardDescription>
                Define geo targeting, placements, and creative. Click the map to
                set the geofence center.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Downtown lunch push"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <select
                    className="w-full h-10 rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 text-sm"
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        status: e.target.value as GeoAdForm["status"],
                      }))
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Headline</label>
                  <Input
                    value={form.title}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                    placeholder="Late-night specials nearby"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">CTA Text</label>
                  <Input
                    value={form.ctaText}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, ctaText: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Body</label>
                <textarea
                  className="w-full min-h-[90px] rounded-md border border-[color:var(--border-strong)] bg-[color:var(--field-bg)] px-3 py-2 text-sm text-[color:var(--text-primary)]"
                  value={form.body}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, body: e.target.value }))
                  }
                  placeholder="Drop in for 20% off at the truck row."
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target URL</label>
                  <Input
                    value={form.targetUrl}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, targetUrl: e.target.value }))
                    }
                    placeholder="https://mealscout.us/deals"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Media URL</label>
                  <Input
                    value={form.mediaUrl}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, mediaUrl: e.target.value }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Priority</label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        priority: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start</label>
                  <Input
                    type="datetime-local"
                    value={form.startAt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, startAt: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End</label>
                  <Input
                    type="datetime-local"
                    value={form.endAt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, endAt: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Placements</label>
                <div className="flex flex-wrap gap-3 text-sm">
                  {placementOptions.map((placement) => (
                    <label key={placement} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.placements.includes(placement)}
                        onChange={(e) => {
                          setForm((prev) => {
                            const next = new Set(prev.placements);
                            if (e.target.checked) {
                              next.add(placement);
                            } else {
                              next.delete(placement);
                            }
                            return {
                              ...prev,
                              placements: Array.from(next) as GeoAdForm["placements"],
                            };
                          });
                        }}
                      />
                      {placement}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Target User Types</label>
                <div className="flex flex-wrap gap-3 text-sm">
                  {userTypeOptions.map((type) => (
                    <label key={type} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.targetUserTypes.includes(type)}
                        onChange={(e) => {
                          setForm((prev) => {
                            const next = new Set(prev.targetUserTypes);
                            if (e.target.checked) {
                              next.add(type);
                            } else {
                              next.delete(type);
                            }
                            return {
                              ...prev,
                              targetUserTypes: Array.from(next),
                            };
                          });
                        }}
                      />
                      {type}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave empty to allow all user types.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Min Daily Foot Traffic
                  </label>
                  <Input
                    type="number"
                    value={form.minDailyFootTraffic}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        minDailyFootTraffic: e.target.value
                          ? Number(e.target.value)
                          : "",
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Max Daily Foot Traffic
                  </label>
                  <Input
                    type="number"
                    value={form.maxDailyFootTraffic}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        maxDailyFootTraffic: e.target.value
                          ? Number(e.target.value)
                          : "",
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Latitude</label>
                  <Input
                    type="number"
                    value={form.geofenceLat}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        geofenceLat: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Longitude</label>
                  <Input
                    type="number"
                    value={form.geofenceLng}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        geofenceLng: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Radius (m)</label>
                  <Input
                    type="number"
                    value={form.geofenceRadiusM}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        geofenceRadiusM: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              </div>

              <div className="h-64 rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
                <GeoAdMap
                  center={mapCenter}
                  radius={form.geofenceRadiusM}
                  onCenterChange={(lat, lng) =>
                    setForm((prev) => ({
                      ...prev,
                      geofenceLat: Number(lat.toFixed(6)),
                      geofenceLng: Number(lng.toFixed(6)),
                    }))
                  }
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSubmit} disabled={createAd.isPending || updateAd.isPending}>
                  {(createAd.isPending || updateAd.isPending) && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {editingId ? "Save Changes" : "Create Campaign"}
                </Button>
                {editingId && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingId(null);
                      setForm(emptyForm);
                    }}
                  >
                    New Campaign
                  </Button>
                )}
                {editingId && (
                  <Button
                    variant="destructive"
                    onClick={() => archiveAd.mutate(editingId)}
                    disabled={archiveAd.isPending}
                  >
                    Archive
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Active Metrics</CardTitle>
                <CardDescription>Latest metrics for the selected ad.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {editingId ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-lg border">
                      <div className="text-muted-foreground">Impressions</div>
                      <div className="text-xl font-semibold">
                        {metrics?.impressions ?? 0}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-muted-foreground">Clicks</div>
                      <div className="text-xl font-semibold">
                        {metrics?.clicks ?? 0}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-muted-foreground">CTR</div>
                      <div className="text-xl font-semibold">
                        {metrics?.ctr ? `${(metrics.ctr * 100).toFixed(1)}%` : "0%"}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border">
                      <div className="text-muted-foreground">Foot Traffic (24h)</div>
                      <div className="text-xl font-semibold">
                        {metrics?.footTraffic24h ?? 0}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a campaign to see metrics.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Campaigns</CardTitle>
                <CardDescription>
                  {ads.length} total campaigns
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading campaigns...
                  </div>
                ) : ads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No geo ads yet. Create the first campaign.
                  </p>
                ) : (
                  ads.map((ad: any) => (
                    <button
                      key={ad.id}
                      onClick={() => selectAd(ad)}
                      className={`w-full text-left border rounded-lg p-3 transition ${
                        editingId === ad.id
                          ? "border-primary bg-primary/5"
                          : "border-[color:var(--border-subtle)] hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{ad.name}</div>
                        <Badge variant="secondary">{ad.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {ad.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Placements:{" "}
                        {Array.isArray(ad.placements)
                          ? ad.placements.join(", ")
                          : "none"}
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Navigation />
    </div>
  );
}



