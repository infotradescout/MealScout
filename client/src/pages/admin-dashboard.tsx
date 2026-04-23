import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/navigation";
import {
  Shield,
  Users,
  Store,
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  BarChart3,
  Activity,
  Package,
  Settings,
  Eye,
  MapPin,
  Phone,
  Mail,
  Calendar,
  CreditCard,
  UserMinus,
} from "lucide-react";
import { Link } from "wouter";
import QuickDashboardAccess from "@/components/quick-dashboard-access";
import HostLocationManager from "@/components/admin/host-location-manager";
import ShareHub from "@/components/share-hub";
import { getOptimizedImageUrl } from "@/lib/images";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DashboardStats {
  totalUsers: number;
  totalRestaurants: number;
  totalRestaurantProfiles?: number;
  totalRestaurantOwners?: number;
  memberCountsTotal?: number;
  unclassifiedUsers?: number;
  totalDeals: number;
  activeDeals: number;
  totalClaims: number;
  todayClaims: number;
  revenue: number;
  newUsersToday: number;
  memberCounts?: {
    customer: number;
    restaurantOwner: number;
    foodTruck: number;
    host: number;
    eventCoordinator: number;
    staff: number;
    admin: number;
    superAdmin: number;
    other: number;
  };
}

interface PendingRestaurant {
  id: string;
  name: string;
  email: string;
  cuisineType: string;
  createdAt: string;
  isActive: boolean;
}

interface MapPinAudit {
  sampleMissing?: Array<{
    id: string;
    source: "open_request" | "host_profile" | "host_address";
    address?: string | null;
    city?: string | null;
    state?: string | null;
  }>;
  renderedHostLocationCandidates: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
  primaryHostProfiles: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
  additionalHostAddresses: {
    total: number;
    included: number;
    skippedDuplicates: number;
    mappable: number;
    missingCoords: number;
  };
  openLocationRequests: {
    total: number;
    mappable: number;
    missingCoords: number;
  };
}

const toTitleCase = (value: string) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const buildBriefSentence = (item: {
  title: string;
  why: string;
  next: string;
}) => `${item.title}. ${item.why} ${item.next}`;

interface DashboardTotalsResponse {
  generatedAt: string;
  totals: DashboardStats;
  operations?: null | {
    parkingPass: {
      seriesTotal: number;
      seriesPublished: number;
      hostsPublished: number;
      spotCapacityPublished: number;
    };
    openCalls?: {
      acceptedNext7Days: number;
      capacityNext7Days: number;
      fillRateNext7DaysPct: number;
    };
    bookings: {
      parkingPassConfirmedToday: number;
      parkingPassConfirmedNext7Days: number;
      pendingCheckoutHolds?: number;
      staleCheckoutHolds?: number;
      failedPaymentsLast24h?: number;
      confirmedLast24h?: number;
    };
    trucks: {
      liveTrucks15m: number;
      activeSessions: number;
    };
  };
  consistency: {
    roleTotal: number;
    totalUsers: number;
    unclassifiedUsers: number;
    rolesWithinUserTotal: boolean;
  };
}

interface ParkingPassOnboardingQueueItem {
  hostId: string;
  userId: string;
  businessName: string | null;
  address: string | null;
  email: string | null;
  locationType: string | null;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  stripeReady: boolean;
  needsPricing: boolean;
  needsStripe: boolean;
  priority: "high" | "medium";
}

interface ParkingPassOnboardingQueueResponse {
  ok: boolean;
  total: number;
  highPriority: number;
  mediumPriority: number;
  items: ParkingPassOnboardingQueueItem[];
}

interface ParkingPassPricingAuditItem {
  hostId: string;
  userId: string;
  businessName: string | null;
  hostPricing: boolean;
  seriesPricing: boolean;
  eventPricing: boolean;
  pricingReady: boolean;
  pricingSource: "host" | "series" | "event" | "none";
  mismatch: boolean;
}

interface ParkingPassPricingAuditResponse {
  ok: boolean;
  totalHosts: number;
  withHostPricing: number;
  withSeriesPricing: number;
  withEventPricing: number;
  mismatches: number;
  noPricing: number;
  items: ParkingPassPricingAuditItem[];
}

interface HostPayoutRequestItem {
  id: string;
  hostId: string;
  userId: string;
  amountCents: number;
  status: "pending" | "approved" | "paid" | "rejected" | "cancelled";
  notes?: string | null;
  reviewedByUserId?: string | null;
  reviewedByEmail?: string | null;
  reviewedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  hostBusinessName?: string | null;
  hostAddress?: string | null;
  hostCity?: string | null;
  hostState?: string | null;
  requesterEmail?: string | null;
}

interface HostPayoutRequestsResponse {
  ok: boolean;
  totals: {
    pending: number;
    approved: number;
    paid: number;
    rejected: number;
  };
  rows: HostPayoutRequestItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters?: {
    status: string;
    q: string;
  };
}

interface LocationDemandFunnelSummary {
  total_requests: number;
  collecting_open: number;
  threshold_met_open: number;
  threshold_met_stuck_24h: number;
  threshold_met_stuck_72h: number;
  claimed_total: number;
  claimed_within_24h: number;
  claimed_with_published_slots: number;
  claimed_with_confirmed_booking: number;
  threshold_met_last_7d: number;
  claimRateFromThresholdOpen: number;
  publishRateFromClaimed: number;
  bookingRateFromClaimed: number;
}

interface LocationDemandFunnelResponse {
  ok: boolean;
  generatedAt: string;
  summary: LocationDemandFunnelSummary;
}

const FOOT_TRAFFIC_OPTIONS = [
  { value: "50", label: "Low (1-50/day)", min: 1, max: 50 },
  { value: "200", label: "Medium (51-200/day)", min: 51, max: 200 },
  { value: "500", label: "High (201+/day)", min: 201, max: 10000 },
];

const resolveFootTrafficValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const match = FOOT_TRAFFIC_OPTIONS.find(
    (option) => numeric >= option.min && numeric <= option.max,
  );
  return (
    match?.value ?? FOOT_TRAFFIC_OPTIONS[FOOT_TRAFFIC_OPTIONS.length - 1].value
  );
};

function TruckImportPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [listingQuery, setListingQuery] = useState("");
  const [listingResults, setListingResults] = useState<any[]>([]);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingEdits, setListingEdits] = useState<Record<string, any>>({});
  const [purgeForce, setPurgeForce] = useState(false);
  const [includePurgedBatches, setIncludePurgedBatches] = useState(false);
  const [detailBatchId, setDetailBatchId] = useState<string | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const detailLimit = 50;

  const { data: batches = [] } = useQuery<any[]>({
    queryKey: [
      "/api/admin/truck-imports",
      includePurgedBatches ? "includePurged" : "activeOnly",
    ],
    enabled,
    queryFn: async () => {
      const qs = includePurgedBatches ? "?includePurged=1" : "";
      const res = await fetch(`/api/admin/truck-imports${qs}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load import batches.");
      }
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: batchDetails, isLoading: batchDetailsLoading } = useQuery<any>({
    queryKey: [
      "/api/admin/truck-imports",
      detailBatchId,
      "details",
      detailOffset,
      detailLimit,
    ],
    enabled: enabled && !!detailBatchId,
    queryFn: async () => {
      if (!detailBatchId) return null;
      const res = await fetch(
        `/api/admin/truck-imports/${detailBatchId}?limit=${detailLimit}&offset=${detailOffset}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load batch details.");
      }
      return data;
    },
  });

  const uploadImport = useMutation({
    mutationFn: async () => {
      if (!file) {
        throw new Error("Please select a file to upload.");
      }
      const formData = new FormData();
      formData.append("file", file);
      if (source.trim()) {
        formData.append("source", source.trim());
      }

      const res = await fetch("/api/admin/truck-imports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          throw new Error(
            json?.message || json?.error || "Failed to upload import file.",
          );
        } catch {
          throw new Error(text || "Failed to upload import file.");
        }
      }
      return await res.json();
    },
    onSuccess: (data: any) => {
      setLastResult(data);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/truck-imports"] });
      const imported = Number(data?.importedRows ?? 0);
      if (imported > 0) {
        toast({
          title: "Import complete",
          description: `Imported ${imported} rows.`,
        });
      } else {
        toast({
          title: "Import uploaded, 0 rows imported",
          description:
            "This usually means the file headers/delimiter didn’t match. Check the results panel for header preview.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.message || "Unable to import file.",
        variant: "destructive",
      });
    },
  });

  const searchListings = async () => {
    const q = listingQuery.trim();
    if (!q) {
      setListingResults([]);
      return;
    }
    setListingLoading(true);
    try {
      const res = await fetch(
        `/api/admin/truck-import-listings/search?q=${encodeURIComponent(q)}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(data?.message || "Failed to search import listings.");
      }
      const rows = Array.isArray(data) ? data : [];
      setListingResults(rows);
      const nextEdits: Record<string, any> = {};
      rows.forEach((row: any) => {
        nextEdits[row.id] = {
          externalId: row.externalId || "",
          email: row.email || "",
          name: row.name || "",
          address: row.address || "",
          city: row.city || "",
          state: row.state || "",
          phone: row.phone || "",
          cuisineType: row.cuisineType || "",
          websiteUrl: row.websiteUrl || "",
          instagramUrl: row.instagramUrl || "",
          facebookPageUrl: row.facebookPageUrl || "",
          latitude: row.latitude || "",
          longitude: row.longitude || "",
        };
      });
      setListingEdits(nextEdits);
    } catch (error: any) {
      toast({
        title: "Search failed",
        description: error.message || "Unable to search import listings.",
        variant: "destructive",
      });
    } finally {
      setListingLoading(false);
    }
  };

  const saveListing = useMutation({
    mutationFn: async (payload: { id: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/truck-import-listings/${payload.id}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Import listing updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.message || "Unable to update listing.",
        variant: "destructive",
      });
    },
  });

  const sendInviteForListing = useMutation({
    mutationFn: async (payload: { id: string; email: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-import-listings/${payload.id}/invite`,
        { email: payload.email },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Setup email sent",
        description: "The truck received a setup link to finish their account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Invite failed",
        description: error.message || "Unable to send setup email.",
        variant: "destructive",
      });
    },
  });

  const purgeBatch = useMutation({
    mutationFn: async (payload: { batchId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-imports/${payload.batchId}/purge`,
        { force: purgeForce },
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/truck-imports"] });
      const blockedCount = Array.isArray(data?.blocked)
        ? data.blocked.length
        : 0;
      toast({
        title: "Import purged",
        description:
          `Deleted ${data.deletedListings} listings and ${data.deletedRestaurants} trucks.` +
          (blockedCount ? ` Blocked: ${blockedCount}.` : ""),
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.message || "Unable to purge this import.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5" />
          Food Truck Imports
        </CardTitle>
        <CardDescription>
          Upload CSV/TSV/XLSX to seed food truck profiles for the claim flow
          (not user accounts). They’ll appear under Restaurants → Pending and in
          “Claim an Existing Food Truck” search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="State registry, county export, etc."
            />
          </div>
          <div>
            <label className="text-sm font-medium">File</label>
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.html,.htm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
          <Button
            type="button"
            onClick={() => uploadImport.mutate()}
            disabled={uploadImport.isPending}
            data-testid="button-import-trucks"
          >
            {uploadImport.isPending ? "Uploading..." : "Upload Import"}
          </Button>
        </div>

        {lastResult && (
          <div className="p-3 rounded-md bg-muted/40 text-sm">
            <div>Batch: {lastResult.batchId}</div>
            <div>Imported: {lastResult.importedRows}</div>
            {"seededRestaurants" in lastResult && (
              <div>Seeded Accounts: {lastResult.seededRestaurants}</div>
            )}
            <div>Duplicates: {lastResult.duplicateRows}</div>
            <div>Missing Name: {lastResult.missingRows}</div>
            {Array.isArray(lastResult.headers) &&
              lastResult.headers.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Headers: {lastResult.headers.slice(0, 12).join(" • ")}
                  {lastResult.headers.length > 12 ? " • ..." : ""}
                </div>
              )}
          </div>
        )}

        <div className="space-y-3 rounded-md border p-3">
          <div className="text-sm font-semibold">Edit Imported Trucks</div>
          <div className="text-xs text-muted-foreground">
            Search by license ID, name, email, city, address. Add an email here
            to create an invited owner account and send a setup link.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={listingQuery}
              onChange={(e) => setListingQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Search imported trucks..."
            />
            <Button
              type="button"
              variant="outline"
              onClick={searchListings}
              disabled={listingLoading}
            >
              {listingLoading ? "Searching..." : "Search"}
            </Button>
          </div>

          {listingResults.length > 0 && (
            <div className="space-y-3">
              {listingResults.map((row: any) => {
                const edits = listingEdits[row.id];
                if (!edits) return null;
                return (
                  <div
                    key={row.id}
                    className="rounded-md border bg-background/40 p-3 space-y-2"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs">
                        <div className="font-semibold">{row.name}</div>
                        <div className="text-muted-foreground">
                          License: {row.externalId || "(none)"} • Status:{" "}
                          {row.status}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            saveListing.mutate({ id: row.id, updates: edits })
                          }
                          disabled={saveListing.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            sendInviteForListing.mutate({
                              id: row.id,
                              email: String(edits.email || ""),
                            })
                          }
                          disabled={
                            sendInviteForListing.isPending ||
                            !String(edits.email || "").trim()
                          }
                        >
                          Send setup email
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Email"
                        value={edits.email}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, email: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="License ID"
                        value={edits.externalId}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, externalId: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                        placeholder="Name"
                        value={edits.name}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, name: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                        placeholder="Address"
                        value={edits.address}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, address: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="City"
                        value={edits.city}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, city: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="State"
                        value={edits.state}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, state: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Phone"
                        value={edits.phone}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, phone: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Cuisine"
                        value={edits.cuisineType}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, cuisineType: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Website"
                        value={edits.websiteUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, websiteUrl: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Instagram"
                        value={edits.instagramUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: {
                              ...edits,
                              instagramUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Facebook"
                        value={edits.facebookPageUrl}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: {
                              ...edits,
                              facebookPageUrl: e.target.value,
                            },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Latitude"
                        value={edits.latitude}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, latitude: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full px-2 py-1 border rounded-md text-xs"
                        placeholder="Longitude"
                        value={edits.longitude}
                        onChange={(e) =>
                          setListingEdits({
                            ...listingEdits,
                            [row.id]: { ...edits, longitude: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Recent Imports</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={purgeForce}
              onChange={(e) => setPurgeForce(e.target.checked)}
            />
            Force purge (also deletes claim requests; still blocks anything with
            bookings)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includePurgedBatches}
              onChange={(e) => setIncludePurgedBatches(e.target.checked)}
            />
            Show purged batches (history)
          </label>
          {batches.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No import batches yet.
            </div>
          ) : (
            <div className="space-y-2">
              {batches.slice(0, 5).map((batch: any) => (
                <div key={batch.id} className="space-y-2">
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs">
                    <div>
                      <div className="font-semibold">
                        {batch.fileName}
                        {batch.purgedAt ? (
                          <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            Purged
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        {batch.source || "Unspecified source"}
                      </div>
                      <div className="text-muted-foreground">
                        Batch: {batch.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div>Imported: {batch.importedRows}</div>
                        <div className="text-muted-foreground">
                          Skipped: {batch.skippedRows}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetailOffset(0);
                          setDetailBatchId((current) =>
                            current === batch.id ? null : batch.id,
                          );
                        }}
                      >
                        {detailBatchId === batch.id ? "Hide" : "Details"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={purgeBatch.isPending || !!batch.purgedAt}
                        onClick={() => {
                          const ok = window.confirm(
                            `Permanently delete everything seeded by “${batch.fileName}”? This deletes unclaimed rows (and claim requests if force-purge is enabled).`,
                          );
                          if (!ok) return;
                          purgeBatch.mutate({ batchId: batch.id });
                        }}
                      >
                        Purge
                      </Button>
                    </div>
                  </div>

                  {detailBatchId === batch.id && (
                    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
                      {batchDetailsLoading ? (
                        <div className="text-muted-foreground">
                          Loading details...
                        </div>
                      ) : batchDetails ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <span>Total listings: {batchDetails.total}</span>
                            <span>
                              Seeded profiles: {batchDetails.seededRestaurants}
                            </span>
                            <span>
                              Claim requests: {batchDetails.claimRequests}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            Status counts:{" "}
                            {Array.isArray(batchDetails.statusCounts)
                              ? batchDetails.statusCounts
                                  .map(
                                    (row: any) => `${row.status}:${row.count}`,
                                  )
                                  .join(" • ")
                              : "(none)"}
                          </div>
                          {Array.isArray(batchDetails.rows) &&
                          batchDetails.rows.length > 0 ? (
                            <div className="space-y-1">
                              {batchDetails.rows
                                .slice(0, 20)
                                .map((row: any) => (
                                  <div
                                    key={row.id}
                                    className="flex items-center justify-between rounded border bg-background/40 px-2 py-1"
                                  >
                                    <div className="min-w-0">
                                      <div className="font-semibold truncate">
                                        {row.name}
                                      </div>
                                      <div className="text-muted-foreground truncate">
                                        {row.city || ""} {row.state || ""} •{" "}
                                        {row.status}
                                      </div>
                                    </div>
                                    <div className="text-muted-foreground">
                                      {row.restaurantId
                                        ? "claimed"
                                        : "unclaimed"}
                                    </div>
                                  </div>
                                ))}
                              {batchDetails.total > detailLimit && (
                                <div className="flex items-center gap-2 pt-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={detailOffset <= 0}
                                    onClick={() =>
                                      setDetailOffset((prev) =>
                                        Math.max(0, prev - detailLimit),
                                      )
                                    }
                                  >
                                    Prev
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      detailOffset + detailLimit >=
                                      batchDetails.total
                                    }
                                    onClick={() =>
                                      setDetailOffset(
                                        (prev) => prev + detailLimit,
                                      )
                                    }
                                  >
                                    Next
                                  </Button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-muted-foreground">
                              No listings found.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-muted-foreground">No details.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UnclaimedImportedTrucksTab({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [editsById, setEditsById] = useState<Record<string, any>>({});

  const limit = 50;

  const loadPage = async (nextOffset: number, mode: "replace" | "append") => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/admin/truck-import-listings/unclaimed?limit=${limit}&offset=${nextOffset}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || "Failed to load unclaimed trucks.");
      }
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setTotal(Number(data?.total ?? 0));
      setOffset(nextOffset);
      setItems((prev) => (mode === "append" ? [...prev, ...rows] : rows));
      const nextEdits: Record<string, any> = {};
      rows.forEach((row: any) => {
        nextEdits[row.id] = {
          email: row.email || "",
          externalId: row.externalId || "",
          name: row.name || "",
          address: row.address || "",
          city: row.city || "",
          state: row.state || "",
          phone: row.phone || "",
        };
      });
      setEditsById((prev) => ({ ...prev, ...nextEdits }));
    } catch (error: any) {
      toast({
        title: "Load failed",
        description: error.message || "Unable to load unclaimed trucks.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void loadPage(0, "replace");
  }, [enabled]);

  const saveListing = useMutation({
    mutationFn: async (payload: { id: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/truck-import-listings/${payload.id}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.message || "Unable to save changes.",
        variant: "destructive",
      });
    },
  });

  const sendInvite = useMutation({
    mutationFn: async (payload: { id: string; email: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/truck-import-listings/${payload.id}/invite`,
        { email: payload.email },
      );
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Setup email sent" });
    },
    onError: (error: any) => {
      toast({
        title: "Invite failed",
        description: error.message || "Unable to send setup email.",
        variant: "destructive",
      });
    },
  });

  const canLoadMore = items.length < total;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Unclaimed Imported Trucks</div>
          <div className="text-xs text-muted-foreground">
            Scroll these. They disappear automatically once claimed + business
            verification is approved.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            onClick={() => loadPage(0, "replace")}
          >
            Refresh
          </Button>
          <div className="text-xs text-muted-foreground">
            {items.length}/{total}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {isLoading ? "Loading..." : "No unclaimed imported trucks."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((row) => {
            const edits = editsById[row.id];
            if (!edits) return null;
            return (
              <Card key={row.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-muted-foreground">
                        License: {row.externalId || "(none)"} • {row.city || ""}{" "}
                        {row.state || ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saveListing.isPending}
                        onClick={() =>
                          saveListing.mutate({ id: row.id, updates: edits })
                        }
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          sendInvite.isPending ||
                          !String(edits.email || "").trim()
                        }
                        onClick={() =>
                          sendInvite.mutate({
                            id: row.id,
                            email: String(edits.email || ""),
                          })
                        }
                      >
                        Send setup email
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                      placeholder="Name"
                      value={edits.name}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, name: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="Email"
                      value={edits.email}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, email: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="Phone"
                      value={edits.phone}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, phone: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="License ID"
                      value={edits.externalId}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, externalId: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs sm:col-span-2"
                      placeholder="Address"
                      value={edits.address}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, address: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="City"
                      value={edits.city}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, city: e.target.value },
                        })
                      }
                    />
                    <input
                      className="w-full px-2 py-1 border rounded-md text-xs"
                      placeholder="State"
                      value={edits.state}
                      onChange={(e) =>
                        setEditsById({
                          ...editsById,
                          [row.id]: { ...edits, state: e.target.value },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {canLoadMore && (
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={() => loadPage(offset + limit, "append")}
            >
              {isLoading ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Manual User/Host Creation Component (Combined)
function ManualUserCreation({ adminUser }: { adminUser?: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    businessName: "",
    address: "",
    city: "",
    state: "",
    cuisineType: "",
    latitude: "",
    longitude: "",
    locationType: "private_residence",
    footTraffic: "low",
    amenities: [] as string[],
    userType: "customer" as
      | "customer"
      | "food_truck"
      | "restaurant_owner"
      | "supplier"
      | "staff"
      | "event_coordinator"
      | "host"
      | "admin"
      | "super_admin",
  });
  const [geocoding, setGeocoding] = useState(false);
  const [inviteSentEmail, setInviteSentEmail] = useState("");
  const [inviteUserType, setInviteUserType] = useState("");
  const [inviteRestaurantId, setInviteRestaurantId] = useState("");
  const [inviteHostId, setInviteHostId] = useState("");
  const [inviteSupplierId, setInviteSupplierId] = useState("");

  const createUser = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/admin/users/create", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setInviteSentEmail(formData.email);
      setInviteUserType(formData.userType);
      setInviteRestaurantId(String(data?.createdRestaurantId || ""));
      setInviteHostId(String(data?.createdHostId || ""));
      setInviteSupplierId(String(data?.createdSupplierId || ""));
      toast({
        title: "Account Created",
        description:
          "Setup link sent. The user will complete their profile and password.",
      });
      // Reset form
      setFormData({
        email: "",
        firstName: "",
        lastName: "",
        phone: "",
        businessName: "",
        address: "",
        city: "",
        state: "",
        cuisineType: "",
        latitude: "",
        longitude: "",
        locationType: "private_residence",
        footTraffic: "low",
        amenities: [],
        userType: "food_truck",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create account.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const needsBusinessProfile =
      formData.userType === "restaurant_owner" ||
      formData.userType === "food_truck" ||
      formData.userType === "supplier" ||
      formData.userType === "host" ||
      formData.userType === "event_coordinator";

    if (
      needsBusinessProfile &&
      (!formData.businessName.trim() ||
        !formData.address.trim() ||
        !formData.city.trim() ||
        !formData.state.trim())
    ) {
      toast({
        title: "Missing required fields",
        description:
          "Business/location name, address, city, and state are required.",
        variant: "destructive",
      });
      return;
    }

    // Auto-geocode for hosts if address provided
    if (
      formData.userType === "host" &&
      formData.address &&
      !formData.latitude
    ) {
      setGeocoding(true);
      try {
        const geocodeQuery = [formData.address, formData.city, formData.state]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(", ");
        const response = await fetch(
          `/api/location/search?q=${encodeURIComponent(geocodeQuery)}&limit=1`,
        );
        const data = await response.json();

        if (data && data[0]) {
          formData.latitude = data[0].lat;
          formData.longitude = data[0].lon;
        }
      } catch (error) {
        console.error("Failed to geocode:", error);
      } finally {
        setGeocoding(false);
      }
    }

    createUser.mutate(formData);
  };

  const handleUserTypeChange = (newType: typeof formData.userType) => {
    // Reset conditional fields when type changes
    setFormData({
      ...formData,
      userType: newType,
      businessName: "",
      address: "",
      city: "",
      state: "",
      cuisineType: "",
      latitude: "",
      longitude: "",
      locationType: "private_residence",
      footTraffic: "low",
      amenities: [],
    });
  };

  const handleGeocode = async () => {
    if (!formData.address) return;

    setGeocoding(true);
    try {
      const geocodeQuery = [formData.address, formData.city, formData.state]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ");
      const response = await fetch(
        `/api/location/search?q=${encodeURIComponent(geocodeQuery)}&limit=1`,
      );
      const data = await response.json();

      if (data && data[0]) {
        setFormData({
          ...formData,
          latitude: data[0].lat,
          longitude: data[0].lon,
        });
        toast({
          title: "Coordinates Found",
          description: "Location has been geocoded successfully.",
        });
      } else {
        toast({
          title: "Not Found",
          description:
            "Could not find coordinates for this address. Please enter manually.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to geocode address.",
        variant: "destructive",
      });
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div className="space-y-4">
      {inviteSentEmail && (
        <div className="p-4 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg space-y-2">
          <p className="font-semibold text-[color:var(--status-success)]">
            Setup Email Sent
          </p>
          <p className="text-sm text-[color:var(--status-success)]">
            Invite sent to {inviteSentEmail}. The user will finish their profile
            and set a password from the link.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/events">
              <Button size="sm" variant="outline">
                Event Organizer Flow
              </Button>
            </Link>
            <Link href="/user-dashboard">
              <Button size="sm" variant="outline">
                Diner Flow
              </Button>
            </Link>
            <Link href="/restaurant-owner-dashboard">
              <Button size="sm" variant="outline">
                Restaurant/Truck Flow
              </Button>
            </Link>
            <Link href="/parking-pass?adminMode=truck">
              <Button size="sm" variant="outline">
                Parking Pass (Truck)
              </Button>
            </Link>
            <Link href="/parking-pass?adminMode=host">
              <Button size="sm" variant="outline">
                Parking Pass (Host)
              </Button>
            </Link>
            <Link
              href={
                inviteRestaurantId
                  ? `/menu-builder?adminRestaurantId=${encodeURIComponent(inviteRestaurantId)}`
                  : "/menu-builder"
              }
            >
              <Button size="sm" variant="outline">
                Menu Builder Flow
              </Button>
            </Link>
            <Link href="/supplier/dashboard">
              <Button size="sm" variant="outline">
                Supplier Flow
              </Button>
            </Link>
          </div>
          {inviteUserType === "supplier" && (
            <p className="text-xs text-[color:var(--status-success)]">
              Supplier account created. Open Supplier Flow to work in the same
              dashboard they use.
            </p>
          )}
          {inviteHostId && (
            <p className="text-xs text-[color:var(--status-success)]">
              Host profile created: {inviteHostId}
            </p>
          )}
          {inviteSupplierId && (
            <p className="text-xs text-[color:var(--status-success)]">
              Supplier profile created: {inviteSupplierId}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setInviteSentEmail("");
              setInviteUserType("");
              setInviteRestaurantId("");
              setInviteHostId("");
              setInviteSupplierId("");
            }}
          >
            Dismiss
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* User Type - First Field */}
        <div>
          <label className="text-sm font-medium">Account Type</label>
          <select
            value={formData.userType}
            onChange={(e) => handleUserTypeChange(e.target.value as any)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="food_truck">Food Truck</option>
            <option value="restaurant_owner">Restaurant Owner</option>
            <option value="customer">Customer</option>
            <option value="host">Host (Parking/Events)</option>
            <option value="event_coordinator">Event Coordinator</option>
            <option value="supplier">Supplier</option>
            <option value="staff">Staff</option>
            {(adminUser?.userType === "admin" ||
              adminUser?.userType === "super_admin") && (
              <option value="admin">Admin</option>
            )}
            {adminUser?.userType === "super_admin" && (
              <option value="super_admin">Super Admin</option>
            )}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            {formData.userType === "food_truck" &&
              "Food truck owner - mobile restaurant, create deals, manage location"}
            {formData.userType === "customer" &&
              "Regular customer - can claim deals and browse restaurants"}
            {formData.userType === "restaurant_owner" &&
              "Business owner - manage restaurant and create deals"}
            {formData.userType === "staff" &&
              "Staff member - help manage restaurant operations"}
            {formData.userType === "event_coordinator" &&
              "Event organizer - create and manage public event postings"}
            {formData.userType === "supplier" &&
              "Supplier - manage catalog, requests, orders, and delivery settings"}
            {formData.userType === "host" &&
              "Host - rent parking spots/lots to food trucks (hourly/daily/weekly/monthly)"}
          </p>
        </div>

        {/* Common Fields */}
        <div>
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full px-3 py-2 border rounded-md"
            placeholder="user@example.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">First Name</label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) =>
                setFormData({ ...formData, firstName: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Last Name</label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) =>
                setFormData({ ...formData, lastName: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Phone</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) =>
              setFormData({ ...formData, phone: e.target.value })
            }
            className="w-full px-3 py-2 border rounded-md"
            placeholder="+1234567890"
          />
        </div>

        {/* Restaurant Owner & Food Truck Specific Fields */}
        {(formData.userType === "restaurant_owner" ||
          formData.userType === "food_truck" ||
          formData.userType === "supplier") && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                {formData.userType === "supplier"
                  ? "Supplier Information"
                  : "Restaurant Information"}
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Business Name</label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder={
                      formData.userType === "supplier"
                        ? "Bayou Wholesale Foods"
                        : "Joe's Pizza"
                    }
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="123 Main St, City, State 12345"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">City</label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) =>
                        setFormData({ ...formData, city: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Houston"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">State</label>
                    <input
                      type="text"
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="TX"
                    />
                  </div>
                </div>

                <div>
                  {formData.userType !== "supplier" ? (
                    <>
                      <label className="text-sm font-medium">
                        Cuisine Type
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.cuisineType}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            cuisineType: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border rounded-md"
                        placeholder="Italian, Mexican, American, etc."
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-md">
              <p className="text-xs text-[color:var(--accent-text)]">
                <strong>Note:</strong>{" "}
                {formData.userType === "supplier"
                  ? "Supplier profile is provisioned and active so you can work the same supplier dashboard flow immediately."
                  : "Restaurant will be created as verified and active. No document verification required for manual onboarding."}
              </p>
            </div>
          </>
        )}

        {/* Staff Specific Fields */}
        {formData.userType === "staff" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">Staff Information</h4>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Restaurant/Business Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Which restaurant will they work for?"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--accent-text)]/10 border border-[color:var(--border-subtle)] rounded-md">
              <p className="text-xs text-[color:var(--accent-text)]">
                <strong>Note:</strong> Staff member will need to be assigned to
                a restaurant after creation.
              </p>
            </div>
          </>
        )}

        {/* Event Coordinator Specific Fields */}
        {formData.userType === "event_coordinator" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                Event Coordinator Information
              </h4>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-md">
                <p className="text-xs text-purple-800">
                  <strong>Event Coordinator:</strong> Organizes food truck
                  events and coordinates logistics.
                  <br />
                  <strong className="text-[color:var(--status-error)]">
                    IMPORTANT: NO payments go through us. They handle all
                    payments directly.
                  </strong>
                </p>
              </div>

              <div className="space-y-3 mt-3">
                <div>
                  <label className="text-sm font-medium">
                    Organization Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Organization or coordinator business name"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Primary Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="123 Main St, City, State 12345"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">City</label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) =>
                        setFormData({ ...formData, city: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Austin"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">State</label>
                    <input
                      type="text"
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="TX"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Host Specific Fields */}
        {formData.userType === "host" && (
          <>
            <div className="pt-3 border-t">
              <h4 className="text-sm font-semibold mb-3">
                Host Location Information
              </h4>

              <div className="p-3 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-md mb-3">
                <p className="text-xs text-[color:var(--status-success)]">
                  <strong>Host Model:</strong> Hosts create lots with 1+ spots.
                  They set rental prices (hourly/daily/weekly/monthly).
                  <br />
                  <strong>
                    We add $10/day to every booking - host gets their price, we
                    get $10 per day.
                  </strong>
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">
                    Location/Business Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.businessName}
                    onChange={(e) =>
                      setFormData({ ...formData, businessName: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Park name, business name, etc."
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Full Address</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="123 Main St, City, State 12345"
                  />
                  <p className="text-xs text-[color:var(--text-muted)] mt-1">
                    Coordinates will be automatically geocoded from this address
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">City</label>
                    <input
                      type="text"
                      required
                      value={formData.city}
                      onChange={(e) =>
                        setFormData({ ...formData, city: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Dallas"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">State</label>
                    <input
                      type="text"
                      required
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value })
                      }
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="TX"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Location Type</label>
                  <select
                    value={formData.locationType}
                    onChange={(e) =>
                      setFormData({ ...formData, locationType: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="private_residence">Private Residence</option>
                    <option value="business">Business</option>
                    <option value="parking_lot">Parking Lot</option>
                    <option value="event_space">Event Space</option>
                    <option value="public_park">Public Park</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">Foot Traffic</label>
                  <select
                    value={formData.footTraffic}
                    onChange={(e) =>
                      setFormData({ ...formData, footTraffic: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="low">Low (Quiet area)</option>
                    <option value="medium">Medium (Moderate activity)</option>
                    <option value="high">High (Busy area)</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Amenities (Optional)
                  </label>
                  <div className="space-y-2">
                    {["Power", "Water", "Restrooms", "Wifi", "Seating"].map(
                      (amenity) => (
                        <label
                          key={amenity}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={formData.amenities.includes(
                              amenity.toLowerCase(),
                            )}
                            onChange={(e) => {
                              const value = amenity.toLowerCase();
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  amenities: [...formData.amenities, value],
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  amenities: formData.amenities.filter(
                                    (a) => a !== value,
                                  ),
                                });
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm">{amenity}</span>
                        </label>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-md">
              <p className="text-xs text-[color:var(--status-success)]">
                <strong>Host Account:</strong> Can list parking spots and event
                spaces for food trucks to use. Will have access to host
                dashboard.
              </p>
            </div>
          </>
        )}

        <Button
          type="submit"
          disabled={createUser.isPending}
          className="w-full"
        >
          {createUser.isPending ? "Creating..." : "Create Account"}
        </Button>
      </form>
    </div>
  );
}

// Staff Management Tab Component
function StaffManagementTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [eligibleUserSearch, setEligibleUserSearch] = useState("");

  const { data: staffMembers = [], isLoading: loadingStaff } = useQuery<any[]>({
    queryKey: ["/api/admin/staff"],
  });

  const { data: allUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
  });

  const promoteToStaff = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/staff/${userId}/promote`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUserId("");
      toast({
        title: "Staff Promoted",
        description: "User has been promoted to staff role.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to promote user to staff.",
        variant: "destructive",
      });
    },
  });

  const demoteStaff = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/staff/${userId}/demote`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Staff Demoted",
        description: "Staff member has been demoted to customer role.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to demote staff member.",
        variant: "destructive",
      });
    },
  });

  const eligibleUsers = allUsers.filter(
    (user) =>
      user.userType !== "admin" &&
      user.userType !== "staff" &&
      user.userType !== "super_admin",
  );

  // Filter out super_admin from staff members list (they should never appear here)
  const displayStaffMembers = staffMembers.filter(
    (staff) => staff.userType !== "super_admin",
  );

  const filteredStaffMembers = useMemo(() => {
    const search = staffSearch.trim().toLowerCase();
    if (!search) return displayStaffMembers;
    return displayStaffMembers.filter((staff: any) => {
      const firstName = String(staff?.firstName || "").toLowerCase();
      const lastName = String(staff?.lastName || "").toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = String(staff?.email || "").toLowerCase();
      return (
        firstName.includes(search) ||
        lastName.includes(search) ||
        fullName.includes(search) ||
        email.includes(search)
      );
    });
  }, [displayStaffMembers, staffSearch]);

  const filteredEligibleUsers = useMemo(() => {
    const search = eligibleUserSearch.trim().toLowerCase();
    if (!search) return eligibleUsers;
    return eligibleUsers.filter((user: any) => {
      const firstName = String(user?.firstName || "").toLowerCase();
      const lastName = String(user?.lastName || "").toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = String(user?.email || "").toLowerCase();
      const userType = String(user?.userType || "").toLowerCase();
      return (
        firstName.includes(search) ||
        lastName.includes(search) ||
        fullName.includes(search) ||
        email.includes(search) ||
        userType.includes(search)
      );
    });
  }, [eligibleUsers, eligibleUserSearch]);

  return (
    <div className="space-y-6">
      {/* Current Staff */}
      <div>
        <h3 className="font-semibold mb-3">Current Staff Members</h3>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background mb-3"
          placeholder="Search current staff by name or email..."
          value={staffSearch}
          onChange={(e) => setStaffSearch(e.target.value)}
        />
        {loadingStaff ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : displayStaffMembers.length === 0 ? (
          <p className="text-muted-foreground">No staff members yet.</p>
        ) : filteredStaffMembers.length === 0 ? (
          <p className="text-muted-foreground">No matching staff members.</p>
        ) : (
          <div className="space-y-2">
            {filteredStaffMembers.map((staff) => (
              <div
                key={staff.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">
                    {staff.firstName} {staff.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {staff.email}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (
                      window.confirm(`Remove ${staff.email} from staff role?`)
                    ) {
                      demoteStaff.mutate(staff.id);
                    }
                  }}
                  disabled={demoteStaff.isPending}
                >
                  <UserMinus className="w-4 h-4 mr-1" />
                  Remove Staff
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote User */}
      <div>
        <h3 className="font-semibold mb-3">Promote User to Staff</h3>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-md bg-background mb-3"
          placeholder="Search users by name, email, or role..."
          value={eligibleUserSearch}
          onChange={(e) => setEligibleUserSearch(e.target.value)}
        />
        <div className="flex gap-3">
          <select
            className="flex-1 px-3 py-2 border rounded-md bg-background"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">Select user...</option>
            {filteredEligibleUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email} ({user.firstName} {user.lastName}) -{" "}
                {user.userType}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              if (selectedUserId) {
                promoteToStaff.mutate(selectedUserId);
              }
            }}
            disabled={!selectedUserId || promoteToStaff.isPending}
          >
            Promote to Staff
          </Button>
        </div>
      </div>

      {/* Quick Link */}
      <div className="pt-4 border-t">
        <Link href="/staff">
          <Button variant="outline">Go to Staff Dashboard -&gt;</Button>
        </Link>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("overview");
  const [briefStatus, setBriefStatus] = useState<
    Record<string, { until: number }>
  >(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem("lisa-dashboard-brief-state-v1");
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(parsed || {}).filter(
          ([, value]: any) => Number(value?.until || 0) > now,
        ),
      ) as Record<string, { until: number }>;
    } catch {
      return {};
    }
  });
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userDetailsOpen, setUserDetailsOpen] = useState(false);
  const [userSortKey, setUserSortKey] = useState<"name" | "type" | "created">(
    "type",
  );
  const [userSortDir, setUserSortDir] = useState<"asc" | "desc">("asc");
  const [userSearch, setUserSearch] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState("all");
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [dealDetailsOpen, setDealDetailsOpen] = useState(false);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<
    "all" | "pending" | "approved" | "paid" | "rejected" | "cancelled"
  >("all");
  const [payoutSearch, setPayoutSearch] = useState("");
  const [payoutFromDate, setPayoutFromDate] = useState("");
  const [payoutToDate, setPayoutToDate] = useState("");
  const [activePendingPayoutRowId, setActivePendingPayoutRowId] = useState<
    string | null
  >(null);
  const [payoutPage, setPayoutPage] = useState(1);
  const [isExportingPayouts, setIsExportingPayouts] = useState(false);
  const payoutPageSize = 12;
  const [extendDays, setExtendDays] = useState(7);
  const [userEdits, setUserEdits] = useState<any>(null);
  const [parkingPassEdits, setParkingPassEdits] = useState<Record<string, any>>(
    {},
  );
  const [addressEdits, setAddressEdits] = useState<Record<string, any>>({});
  const [hostEdits, setHostEdits] = useState<Record<string, any>>({});
  const [spotImageFilesByHostId, setSpotImageFilesByHostId] = useState<
    Record<string, File | null>
  >({});
  const [restaurantEdits, setRestaurantEdits] = useState<Record<string, any>>(
    {},
  );
  const [dealEdits, setDealEdits] = useState<Record<string, any>>({});
  const [eventEdits, setEventEdits] = useState<Record<string, any>>({});
  const [seriesEdits, setSeriesEdits] = useState<Record<string, any>>({});
  const [bookingEdits, setBookingEdits] = useState<Record<string, any>>({});
  const [newAddress, setNewAddress] = useState<any>({
    label: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    type: "other",
    isDefault: false,
  });
  const [newHostLocation, setNewHostLocation] = useState<any>({
    businessName: "",
    address: "",
    city: "",
    state: "",
    locationType: "other",
    expectedFootTraffic: "",
    contactPhone: "",
    notes: "",
  });

  const formatDateInput = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const setPayoutDateRange = (from: string, to: string) => {
    if (from && to && from > to) {
      setPayoutFromDate(to);
      setPayoutToDate(from);
      return;
    }
    setPayoutFromDate(from);
    setPayoutToDate(to);
  };

  const handlePayoutFromDateChange = (value: string) => {
    setPayoutDateRange(value, payoutToDate);
  };

  const handlePayoutToDateChange = (value: string) => {
    setPayoutDateRange(payoutFromDate, value);
  };

  const applyPayoutDatePreset = (
    preset: "last7" | "thisMonth" | "lastMonth" | "clear",
  ) => {
    const today = new Date();

    if (preset === "clear") {
      setPayoutDateRange("", "");
      return;
    }

    if (preset === "last7") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      setPayoutDateRange(formatDateInput(from), formatDateInput(today));
      return;
    }

    if (preset === "thisMonth") {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      setPayoutDateRange(formatDateInput(from), formatDateInput(today));
      return;
    }

    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    setPayoutDateRange(formatDateInput(from), formatDateInput(to));
  };

  const payoutDateRangeError = useMemo(() => {
    if (!payoutFromDate || !payoutToDate) {
      return "";
    }
    return payoutFromDate > payoutToDate
      ? "From date must be on or before To date."
      : "";
  }, [payoutFromDate, payoutToDate]);

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } finally {
      window.location.href = "/";
    }
  };

  // Check admin authentication
  const { data: adminUser, isLoading: isAuthLoading } = useQuery<any>({
    queryKey: ["/api/auth/admin/verify"],
    retry: false,
  });
  const isStaff = adminUser?.userType === "staff";
  const isAdminOrSuper =
    adminUser?.userType === "admin" || adminUser?.userType === "super_admin";
  const isSuperAdmin = adminUser?.userType === "super_admin";

  // Fetch dashboard stats
  const { data: dashboardTotals, isLoading: statsLoading } =
    useQuery<DashboardTotalsResponse>({
      queryKey: ["/api/admin/dashboard-totals"],
      enabled: !!adminUser,
    });

  // Fetch pending restaurants
  const { data: pendingRestaurants = [] } = useQuery<PendingRestaurant[]>({
    queryKey: ["/api/admin/restaurants/pending"],
    enabled: !!adminUser && selectedTab === "restaurants",
  });

  // Fetch all users
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!adminUser && selectedTab === "users",
  });

  const userById = useMemo(() => {
    const map = new Map<string, any>();
    for (const u of users) {
      const id = String(u?.id || "").trim();
      if (id) map.set(id, u);
    }
    return map;
  }, [users]);

  const { data: mapPinAudit } = useQuery<MapPinAudit>({
    queryKey: ["/api/admin/map-pin-audit"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "lisa-dashboard-brief-state-v1",
      JSON.stringify(briefStatus),
    );
  }, [briefStatus]);
  const { data: lisaMarketIntel } = useQuery<any>({
    queryKey: ["/api/admin/lisa/market-intel", "dashboard-tab"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/market-intel");
      if (!res.ok) throw new Error("Failed to fetch LISA market intel");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaSignals } = useQuery<any>({
    queryKey: ["/api/admin/lisa/signals", "dashboard-tab"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/signals?limit=16&hours=72");
      if (!res.ok) throw new Error("Failed to fetch LISA signals");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaPriorities } = useQuery<any>({
    queryKey: ["/api/admin/lisa/priorities", "dashboard-tab"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/priorities?limit=6");
      if (!res.ok) throw new Error("Failed to fetch LISA priorities");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const { data: lisaBriefActions } = useQuery<any>({
    queryKey: ["/api/admin/lisa/brief-actions", "dashboard-tab"],
    queryFn: async () => {
      const res = await fetch("/api/admin/lisa/brief-actions?hours=720");
      if (!res.ok) throw new Error("Failed to fetch LISA brief actions");
      return res.json();
    },
    enabled: !!adminUser && selectedTab === "lisa",
    staleTime: 60 * 1000,
  });
  const briefActionMutation = useMutation({
    mutationFn: async (payload: {
      briefKey: string;
      action: "done" | "snooze" | "dismiss";
      title: string;
      href: string;
    }) => {
      const res = await fetch("/api/admin/lisa/brief-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to log brief action");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/lisa/brief-actions", "dashboard-tab"],
      });
    },
  });
  const isTruthOnlyMode =
    lisaMarketIntel?.signalContract?.mode === "truth_only";
  const promoteNowItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const momentum = Array.isArray(lisaMarketIntel?.contentMomentum)
      ? lisaMarketIntel.contentMomentum
      : [];
    return momentum.slice(0, 4).map((item: any) => ({
      id: item.id,
      title: item.title || "Untitled content",
      why: `${Number(item.viewCount ?? 0)} views and ${Number(item.impressionCount ?? 0)} impressions signal current attention.`,
      next: item.restaurantId
        ? `Promote this restaurant now and attach a deal or event while attention is active.`
        : "Promote this story now while attention is active.",
      changed: lisaMarketIntel?.dailyBriefChanges?.promotion,
      rankReason:
        "Ranked #1 because it has the strongest live content momentum right now.",
      href: item.restaurantId
        ? `/restaurant/${item.restaurantId}`
        : "/admin/control-center",
      actionLabel: item.restaurantId ? "Open restaurant" : "Open stream",
    }));
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const demandSpikeItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const trends = Array.isArray(lisaMarketIntel?.trendWatch)
      ? lisaMarketIntel.trendWatch
      : [];
    const cityDemand = Array.isArray(
      lisaMarketIntel?.advertiserSignals?.cityDemand,
    )
      ? lisaMarketIntel.advertiserSignals.cityDemand
      : [];
    const demandRows = [
      ...trends.slice(0, 2).map((item: any) => ({
        id: item.id,
        title: item.label || "Unnamed food trend",
        why: item.summary || `This food trend is moving right now.`,
        next:
          item.next ||
          "Build content, deals, or landing pages around this demand before it cools off.",
        changed: lisaMarketIntel?.dailyBriefChanges?.demand,
        rankReason:
          "Ranked #1 because this food trend is currently the strongest visible demand signal.",
        href: "/admin/control-center",
        actionLabel: "Open stream",
      })),
      ...cityDemand.slice(0, 2).map((item: any, index: number) => ({
        id: `city:${index}:${item.address || item.businessName || "unknown"}`,
        title:
          item.businessName ||
          item.address ||
          item.locationType ||
          "Location demand cluster",
        why: `${Number(item.requestCount ?? 0)} requests and ${Number(item.interestCount ?? 0)} interest signals point to local demand.`,
        next: "Sell ads here, recruit inventory here, or create a city page that captures the traffic.",
        changed: lisaMarketIntel?.changeSinceYesterday?.summary,
        rankReason:
          "Ranked highly because this location cluster is showing the strongest local demand mix.",
        href: "/admin/control-center",
        actionLabel: "Open stream",
      })),
    ];
    return demandRows.slice(0, 4);
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const acquisitionWatchItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const targets = Array.isArray(lisaMarketIntel?.acquisitionTargets)
      ? lisaMarketIntel.acquisitionTargets
      : [];
    return targets.slice(0, 4).map((item: any) => ({
      id: item.id,
      title: item.title || "Untitled target",
      why: `${Number(item.crawlerHits ?? 0)} crawler hits with ${item.quality || "unknown"} quality suggests outside interest is ahead of asset quality.`,
      next:
        (Array.isArray(item.reasons) && item.reasons[0]) ||
        "Review this asset for acquisition, partnership, or cleanup.",
      changed: lisaMarketIntel?.dailyBriefChanges?.acquisition,
      rankReason:
        "Ranked #1 because outside attention is ahead of quality more than the other current targets.",
      href: item.canonicalPath || "/admin/control-center",
      actionLabel: "Open target",
    }));
  }, [isTruthOnlyMode, lisaMarketIntel]);

  const authorityGapItems = useMemo(() => {
    const items = Array.isArray(lisaPriorities?.items)
      ? lisaPriorities.items
      : [];
    return items.slice(0, 4).map((item: any) => ({
      id: `${item.entityType}:${item.entityId}`,
      title: item.title || `${item.entityType} ${item.entityId}`,
      why: `${item.quality || "unknown"} quality and ${item.freshness || "unknown"} freshness are limiting how trustworthy this page feels.`,
      next: (Array.isArray(item.reasons) && item.reasons.length > 0
        ? item.reasons.map((reason: string) => toTitleCase(reason)).join(" • ")
        : "Improve the page, data completeness, and freshness."
      ).slice(0, 180),
      changed: lisaMarketIntel?.changeSinceYesterday?.summary,
      rankReason:
        "Ranked highly because page weakness is limiting authority on a high-interest entity.",
      href: "/admin/control-center",
      actionLabel: "Open stream",
    }));
  }, [lisaMarketIntel, lisaPriorities]);

  const machineAttentionItems = useMemo(() => {
    if (isTruthOnlyMode) return [];
    const items = Array.isArray(lisaSignals?.items) ? lisaSignals.items : [];
    return items
      .filter((signal: any) => signal.visibility === "off_platform")
      .slice(0, 4)
      .map((signal: any, index: number) => ({
        id: `${signal.id || "signal"}:${index}`,
        title: signal.title || "Observed machine attention",
        why:
          signal.summary ||
          "Outside systems are interacting with a MealScout page.",
        next:
          signal.subjectType === "path"
            ? `Strengthen ${signal.subjectId || "this page"} so outside machines find something worth citing.`
            : "Strengthen the related public entity page and attach fresher information.",
        changed: lisaMarketIntel?.dailyBriefChanges?.machineAttention,
        rankReason:
          "Ranked #1 because it is the strongest current off-platform attention signal.",
        href:
          signal.subjectType === "path" &&
          String(signal.subjectId || "").startsWith("/")
            ? String(signal.subjectId)
            : "/admin/control-center",
        actionLabel:
          signal.subjectType === "path" &&
          String(signal.subjectId || "").startsWith("/")
            ? "Open page"
            : "Open stream",
      }));
  }, [isTruthOnlyMode, lisaMarketIntel, lisaSignals]);

  const yesterdayChangeItems = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.changeSinceYesterday?.items)
        ? lisaMarketIntel.changeSinceYesterday.items
        : [],
    [lisaMarketIntel],
  );

  const foodTrendItems = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.trendWatch)
        ? lisaMarketIntel.trendWatch
        : [],
    [lisaMarketIntel],
  );

  const priceScoutDeals = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.priceScout?.bestDeals)
        ? lisaMarketIntel.priceScout.bestDeals
        : [],
    [lisaMarketIntel],
  );

  const priceScoutSupplySummary = useMemo(
    () => lisaMarketIntel?.priceScout?.supplyLaneSummary ?? null,
    [lisaMarketIntel],
  );

  const priceScoutSupplySpotlight = useMemo(
    () =>
      Array.isArray(lisaMarketIntel?.priceScout?.supplyLaneSummary?.spotlight)
        ? lisaMarketIntel.priceScout.supplyLaneSummary.spotlight
        : [],
    [lisaMarketIntel],
  );

  const deferBrief = (
    briefKey: string,
    mode: "dismiss" | "snooze" | "done",
  ) => {
    const hours = mode === "done" ? 24 * 7 : mode === "snooze" ? 4 : 16;
    setBriefStatus((current) => ({
      ...current,
      [briefKey]: { until: Date.now() + hours * 60 * 60 * 1000 },
    }));
  };

  const latestBriefActionByKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of lisaBriefActions?.latest ?? []) {
      map.set(String(item.briefKey || ""), item);
    }
    return map;
  }, [lisaBriefActions]);

  const pickVisibleBrief = (items: any[], prefix: string) =>
    items.find((item: any) => {
      const briefKey = `${prefix}:${item.id}`;
      const localUntil = briefStatus[briefKey]?.until ?? 0;
      const latestAction = latestBriefActionByKey.get(briefKey);
      const actionUntil =
        latestAction?.action === "done"
          ? new Date(latestAction.createdAt).getTime() + 24 * 7 * 60 * 60 * 1000
          : latestAction?.action === "snooze"
            ? new Date(latestAction.createdAt).getTime() + 4 * 60 * 60 * 1000
            : latestAction?.action === "dismiss"
              ? new Date(latestAction.createdAt).getTime() + 16 * 60 * 60 * 1000
              : 0;
      return Math.max(localUntil, actionUntil) <= Date.now();
    }) || null;

  const handleBriefAction = (
    briefKey: string,
    action: "done" | "snooze" | "dismiss",
    title: string,
    href: string,
  ) => {
    deferBrief(briefKey, action);
    briefActionMutation.mutate({ briefKey, action, title, href });
  };

  const topPromotionItem = pickVisibleBrief(promoteNowItems, "promote");
  const topDemandItem = pickVisibleBrief(demandSpikeItems, "demand");
  const topAcquisitionItem = pickVisibleBrief(acquisitionWatchItems, "acquire");
  const topMachineAttentionItem = pickVisibleBrief(
    machineAttentionItems,
    "machine",
  );
  const retryMapPinGeocode = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/map-pin-audit/retry-geocode",
        {
          limit: 50,
        },
      );
      return res.json();
    },
    onSuccess: async (result: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/map-pin-audit"],
      });
      toast({
        title: "Map geocode retry complete",
        description: `Updated ${result?.updated?.total ?? 0} locations.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Map geocode retry failed",
        description: error?.message || "Unable to retry geocoding.",
        variant: "destructive",
      });
    },
  });
  const retryMapPinGeocodeItem = useMutation({
    mutationFn: async (payload: {
      source: "open_request" | "host_profile" | "host_address";
      id: string;
    }) => {
      const res = await apiRequest(
        "POST",
        "/api/admin/map-pin-audit/retry-geocode-item",
        payload,
      );
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/map-pin-audit"],
      });
      toast({
        title: "Location updated",
        description: "Geocode retried for the selected location.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Location retry failed",
        description: error?.message || "Unable to retry this location.",
        variant: "destructive",
      });
    },
  });

  const { data: emailStatus } = useQuery<any>({
    queryKey: ["/api/admin/email/status"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 60 * 1000,
  });
  const { data: emailAttempts } = useQuery<any>({
    queryKey: ["/api/admin/email/attempts?limit=25"],
    enabled: !!adminUser && selectedTab === "overview",
    staleTime: 30 * 1000,
  });

  const { data: parkingPassOnboardingQueue, isLoading: queueLoading } =
    useQuery<ParkingPassOnboardingQueueResponse>({
      queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: parkingPassPricingAudit } =
    useQuery<ParkingPassPricingAuditResponse>({
      queryKey: ["/api/admin/parking-pass/pricing-audit"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: locationDemandFunnel, isLoading: demandFunnelLoading } =
    useQuery<LocationDemandFunnelResponse>({
      queryKey: ["/api/admin/location-demand/funnel"],
      enabled: !!adminUser && selectedTab === "overview",
      staleTime: 30 * 1000,
    });

  const { data: hostPayoutRequests, isLoading: payoutQueueLoading } =
    useQuery<HostPayoutRequestsResponse>({
      queryKey: [
        "/api/admin/host-payout-requests",
        payoutStatusFilter,
        payoutSearch,
        payoutFromDate,
        payoutToDate,
        payoutPage,
        payoutPageSize,
      ],
      enabled:
        !!adminUser && selectedTab === "overview" && !payoutDateRangeError,
      staleTime: 30 * 1000,
      queryFn: async () => {
        const params = new URLSearchParams();
        params.set("status", payoutStatusFilter);
        params.set("page", String(payoutPage));
        params.set("pageSize", String(payoutPageSize));
        if (payoutSearch.trim()) {
          params.set("q", payoutSearch.trim());
        }
        if (payoutFromDate) {
          params.set("from", payoutFromDate);
        }
        if (payoutToDate) {
          params.set("to", payoutToDate);
        }
        const res = await fetch(
          `/api/admin/host-payout-requests?${params.toString()}`,
          {
            credentials: "include",
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.message || "Failed to load host payout requests.",
          );
        }
        return data as HostPayoutRequestsResponse;
      },
    });

  const orderedPendingPayoutRowIds = useMemo(() => {
    const rows = Array.isArray(hostPayoutRequests?.rows)
      ? hostPayoutRequests.rows
      : [];
    const pendingRows = rows.filter((row) => row.status === "pending");
    if (pendingRows.length === 0) {
      return [];
    }

    return pendingRows
      .slice()
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      })
      .map((row) => row.id);
  }, [hostPayoutRequests?.rows]);

  const activePendingPayoutRow = useMemo(() => {
    if (!activePendingPayoutRowId) {
      return null;
    }
    const rows = Array.isArray(hostPayoutRequests?.rows)
      ? hostPayoutRequests.rows
      : [];
    return (
      rows.find(
        (row) =>
          row.id === activePendingPayoutRowId && row.status === "pending",
      ) || null
    );
  }, [activePendingPayoutRowId, hostPayoutRequests?.rows]);

  useEffect(() => {
    if (
      activePendingPayoutRowId &&
      !orderedPendingPayoutRowIds.includes(activePendingPayoutRowId)
    ) {
      setActivePendingPayoutRowId(null);
    }
  }, [activePendingPayoutRowId, orderedPendingPayoutRowIds]);

  const jumpToPendingPayout = (rowId: string) => {
    const node = document.getElementById(`payout-row-${rowId}`);
    if (!node) {
      toast({
        title: "Row not found",
        description: "Refresh the queue and try again.",
        variant: "destructive",
      });
      return;
    }

    setActivePendingPayoutRowId(rowId);
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const jumpToNextPendingPayout = () => {
    if (orderedPendingPayoutRowIds.length === 0) {
      toast({
        title: "No pending requests",
        description:
          "There are no pending payout requests in the current view.",
      });
      return;
    }

    const currentIndex = activePendingPayoutRowId
      ? orderedPendingPayoutRowIds.indexOf(activePendingPayoutRowId)
      : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) % orderedPendingPayoutRowIds.length
        : 0;
    const nextId = orderedPendingPayoutRowIds[nextIndex];

    if (nextId) {
      jumpToPendingPayout(nextId);
    }
  };

  const jumpToPreviousPendingPayout = () => {
    if (orderedPendingPayoutRowIds.length === 0) {
      toast({
        title: "No pending requests",
        description:
          "There are no pending payout requests in the current view.",
      });
      return;
    }

    const currentIndex = activePendingPayoutRowId
      ? orderedPendingPayoutRowIds.indexOf(activePendingPayoutRowId)
      : 0;
    const prevIndex =
      currentIndex > 0
        ? currentIndex - 1
        : orderedPendingPayoutRowIds.length - 1;
    const prevId = orderedPendingPayoutRowIds[prevIndex];

    if (prevId) {
      jumpToPendingPayout(prevId);
    }
  };

  const isTypingTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  };

  const handlePayoutCardKeyDown = (event: React.KeyboardEvent) => {
    if (
      event.key.toLowerCase() === "a" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      approveCurrentPendingPayout();
      return;
    }

    if (
      event.key.toLowerCase() !== "n" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTypingTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    if (event.shiftKey) {
      jumpToPreviousPendingPayout();
      return;
    }
    jumpToNextPendingPayout();
  };

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailCategory, setTestEmailCategory] = useState<
    "general" | "account"
  >("general");
  const sendTestEmail = useMutation({
    mutationFn: async () => {
      const payload: any = { category: testEmailCategory };
      if (testEmailTo.trim()) payload.to = testEmailTo.trim();
      const res = await apiRequest("POST", "/api/admin/email/test", payload);
      return await res.json();
    },
    onSuccess: (result: any) => {
      if (result?.success) {
        toast({ title: "Test email sent" });
      } else {
        toast({
          title: "Test email failed",
          description:
            "Email provider may be disabled or filtered by EMAIL_NOTIFICATIONS_MODE.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Test email failed",
        description: error?.message || "Unable to send test email.",
        variant: "destructive",
      });
    },
  });
  const runParkingPassReminders = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/reminders/run",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      toast({
        title: "Reminder campaign started",
        description: `Sent ${Number(data?.stats?.sent ?? 0)} reminder(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reminder campaign failed",
        description: error?.message || "Unable to run parking pass reminders.",
        variant: "destructive",
      });
    },
  });
  const sendSingleParkingPassReminder = useMutation({
    mutationFn: async (hostId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/parking-pass/reminders/${hostId}/send`,
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      toast({
        title: "Reminder sent",
        description: data?.host?.businessName
          ? `Sent to ${data.host.businessName}.`
          : "Host reminder sent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Send failed",
        description: error?.message || "Unable to send host reminder.",
        variant: "destructive",
      });
    },
  });
  const repairParkingPassPricingAudit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/pricing-audit/repair",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/onboarding-queue"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/pricing-audit"],
      });
      toast({
        title: "Pricing repair completed",
        description: `Updated ${Number(data?.updatedHosts ?? 0)} host(s), remaining mismatches ${Number(data?.remainingMismatches ?? 0)}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Pricing repair failed",
        description: error?.message || "Unable to repair pricing drift.",
        variant: "destructive",
      });
    },
  });
  const runLocationDemandActivation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/location-demand/activation/run",
      );
      return await res.json();
    },
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/location-demand/funnel"],
      });
      toast({
        title: "Demand activation run completed",
        description: `Sent ${Number(data?.stats?.sent ?? 0)} reminder(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Demand activation run failed",
        description: error?.message || "Unable to run demand activation.",
        variant: "destructive",
      });
    },
  });
  const updateHostPayoutRequest = useMutation({
    mutationFn: async ({
      requestId,
      status,
    }: {
      requestId: string;
      status: "approved" | "rejected" | "paid" | "cancelled";
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/host-payout-requests/${requestId}`,
        { status },
      );
      return await res.json();
    },
    onSuccess: async (_data: any, vars: any) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/host-payout-requests"],
      });
      toast({
        title: "Payout request updated",
        description: `Request marked as ${vars?.status || "updated"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Unable to update payout request.",
        variant: "destructive",
      });
    },
  });

  const approveCurrentPendingPayout = () => {
    if (!activePendingPayoutRow) {
      toast({
        title: "No selected pending request",
        description:
          "Use Next pending first, then approve the highlighted request.",
      });
      return;
    }

    updateHostPayoutRequest.mutate({
      requestId: activePendingPayoutRow.id,
      status: "approved",
    });
  };

  const exportHostPayoutRequestsCsv = async () => {
    if (payoutDateRangeError) {
      toast({
        title: "Invalid date range",
        description: payoutDateRangeError,
        variant: "destructive",
      });
      return;
    }

    setIsExportingPayouts(true);
    try {
      const params = new URLSearchParams();
      params.set("status", payoutStatusFilter);
      if (payoutSearch.trim()) {
        params.set("q", payoutSearch.trim());
      }
      if (payoutFromDate) {
        params.set("from", payoutFromDate);
      }
      if (payoutToDate) {
        params.set("to", payoutToDate);
      }

      const response = await fetch(
        `/api/admin/host-payout-requests/export.csv?${params.toString()}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.message || "Failed to export host payout requests.",
        );
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);
      anchor.href = downloadUrl;
      anchor.download = `host-payout-requests-${payoutStatusFilter}-${dateStamp}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({
        title: "Export ready",
        description: "Downloaded payout requests CSV.",
      });
    } catch (error: any) {
      toast({
        title: "Export failed",
        description: error?.message || "Unable to export payout requests.",
        variant: "destructive",
      });
    } finally {
      setIsExportingPayouts(false);
    }
  };
  const clearMapCaches = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/map/locations-cache/clear");
      await apiRequest("POST", "/api/admin/parking-pass/cache/clear");
      try {
        localStorage.removeItem("mealscout:map:locations:v1");
        localStorage.removeItem("mealscout:map:bookableHostIds:v1");
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key) keys.push(key);
        }
        keys.forEach((key) => {
          if (key.startsWith("mealscout:map:parkingPassHostStatus:")) {
            localStorage.removeItem(key);
          }
        });
      } catch {
        // ignore localStorage issues
      }
      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: "Cleared map caches",
        description: "Server + browser caches cleared. Map pins will rebuild.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cache clear failed",
        description: error?.message || "Unable to clear caches.",
        variant: "destructive",
      });
    },
  });
  const backfillParkingPasses = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/parking-pass/backfill");
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Backfill complete",
        description: `Created ${Number(data?.created ?? 0)} draft parking pass series.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Backfill failed",
        description: error?.message || "Unable to backfill parking passes.",
        variant: "destructive",
      });
    },
  });
  const normalizeParkingPassSeries = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/normalize-series",
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Normalization complete",
        description: `Updated ${Number(data?.updated ?? 0)} series statuses.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Normalization failed",
        description: error?.message || "Unable to normalize series statuses.",
        variant: "destructive",
      });
    },
  });
  const runParkingPassIntegrity = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/parking-pass/integrity/run",
        {
          dryRun: false,
        },
      );
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Integrity job complete",
        description: `Series created: ${Number(data?.createdDraftSeries ?? 0)}. Defaults updated: ${Number(data?.updatedDefaults ?? 0)}. Status updated: ${Number(data?.updatedStatus ?? 0)}.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/fix-queue"],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Integrity job failed",
        description: error?.message || "Unable to run integrity job.",
        variant: "destructive",
      });
    },
  });

  const uploadHostSpotImage = useMutation({
    mutationFn: async (payload: { hostId: string; file: File }) => {
      const formData = new FormData();
      formData.append("image", payload.file);
      const res = await fetch(`/api/hosts/${payload.hostId}/spot-image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(
          data?.message || text || "Failed to upload spot photo.",
        );
      }
      return data;
    },
    onSuccess: (data: any, vars) => {
      const nextUrl = String(data?.spotImageUrl || "").trim();
      if (nextUrl) {
        setHostEdits((prev) => ({
          ...prev,
          [vars.hostId]: {
            ...prev[vars.hostId],
            spotImageUrl: nextUrl,
          },
        }));
      }
      setSpotImageFilesByHostId((prev) => ({ ...prev, [vars.hostId]: null }));
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      toast({ title: "Uploaded", description: "Spot photo updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Upload failed",
        description: error?.message || "Unable to upload spot photo.",
        variant: "destructive",
      });
    },
  });

  const userContextEnabled =
    !!adminUser && !!selectedUser?.id && userDetailsOpen;

  const { data: parkingPasses = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
    enabled: userContextEnabled,
  });

  const { data: userHosts = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
    enabled: userContextEnabled,
  });

  const { data: userRestaurants = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "restaurants"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userDeals = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "deals"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userEvents = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "events"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userEventSeries = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "event-series"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const { data: userParkingBookings } = useQuery<any>({
    queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass-bookings"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });
  const { data: userAddresses = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
    enabled: !!adminUser && !!selectedUser?.id && userDetailsOpen,
  });

  const sortedUsers = useMemo(() => {
    const typeOrder = [
      "super_admin",
      "admin",
      "staff",
      "restaurant_owner",
      "food_truck",
      "host",
      "event_coordinator",
      "customer",
    ];
    const orderMap = new Map(typeOrder.map((type, index) => [type, index]));

    const normalized = [...users];
    normalized.sort((a, b) => {
      const dir = userSortDir === "asc" ? 1 : -1;
      if (userSortKey === "type") {
        const aRank = orderMap.get(a.userType) ?? 999;
        const bRank = orderMap.get(b.userType) ?? 999;
        if (aRank !== bRank) return (aRank - bRank) * dir;
      }
      if (userSortKey === "created") {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (aTime !== bTime) return (aTime - bTime) * dir;
      }

      const aName = `${a.firstName || ""} ${a.lastName || ""}`
        .trim()
        .toLowerCase();
      const bName = `${b.firstName || ""} ${b.lastName || ""}`
        .trim()
        .toLowerCase();
      return aName.localeCompare(bName) * dir;
    });

    return normalized;
  }, [users, userSortDir, userSortKey]);

  const userTypeTabs = useMemo(() => {
    const base = [
      { value: "all", label: "All" },
      { value: "customer", label: "Customers" },
      { value: "food_truck", label: "Food Trucks" },
      { value: "restaurant_owner", label: "Restaurants" },
      { value: "host", label: "Hosts" },
      { value: "event_coordinator", label: "Events" },
      { value: "staff", label: "Staff" },
    ];

    if (isAdminOrSuper) {
      base.push({ value: "admin", label: "Admins" });
    }
    if (isSuperAdmin) {
      base.push({ value: "super_admin", label: "Super Admins" });
    }

    return base;
  }, [isAdminOrSuper, isSuperAdmin]);

  const userCountsByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of users) {
      const type = String(u?.userType || "unknown");
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
  }, [users]);
  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    return sortedUsers.filter((user: any) => {
      if (userTypeFilter !== "all" && user.userType !== userTypeFilter) {
        return false;
      }
      if (!search) return true;
      const name = `${user.firstName || ""} ${user.lastName || ""}`
        .trim()
        .toLowerCase();
      const email = `${user.email || ""}`.toLowerCase();
      const phone = `${user.phone || ""}`.toLowerCase();
      return (
        name.includes(search) ||
        email.includes(search) ||
        phone.includes(search)
      );
    });
  }, [sortedUsers, userSearch, userTypeFilter]);

  const duplicateEmailGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const user of users) {
      const normalizedEmail = String(user?.email || "")
        .trim()
        .toLowerCase();
      if (!normalizedEmail) continue;
      const existing = groups.get(normalizedEmail) || [];
      existing.push(user);
      groups.set(normalizedEmail, existing);
    }

    const roleRank = (userType?: string) => {
      const value = String(userType || "")
        .trim()
        .toLowerCase();
      if (value === "super_admin") return 100;
      if (value === "admin") return 90;
      if (value === "staff") return 80;
      if (value === "restaurant_owner") return 70;
      if (value === "food_truck") return 60;
      if (value === "host") return 50;
      if (value === "event_coordinator") return 40;
      return 10;
    };

    return Array.from(groups.entries())
      .map(([normalizedEmail, members]) => {
        if (members.length < 2) return null;
        const sortedMembers = [...members].sort((a: any, b: any) => {
          const aVerified = a?.emailVerified ? 1 : 0;
          const bVerified = b?.emailVerified ? 1 : 0;
          if (aVerified !== bVerified) return bVerified - aVerified;

          const aRank = roleRank(a?.userType);
          const bRank = roleRank(b?.userType);
          if (aRank !== bRank) return bRank - aRank;

          const aCreated = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          return aCreated - bCreated;
        });

        return {
          normalizedEmail,
          primary: sortedMembers[0],
          duplicates: sortedMembers.slice(1),
          members: sortedMembers,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.members.length - a.members.length);
  }, [users]);

  const renderHostLocationsEditor = () => {
    if (!selectedUser) return null;
    if (!(selectedUser?.userType === "host" || userHosts.length > 0))
      return null;

    const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div>
        <h3 className="font-semibold mb-2 flex items-center text-sm text-muted-foreground">
          <MapPin className="w-4 h-4 mr-2" />
          HOST LOCATIONS (PARKING PASS) ({userHosts.length})
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          These addresses power Parking Pass listings. Edit here to update them
          everywhere.
        </p>
        <div className="space-y-4">
          {userHosts.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No host locations yet.
            </div>
          )}
          {userHosts.map((host: any) => {
            const edits = hostEdits[host.id];
            if (!edits) return null;
            const pass = parkingPasses.find(
              (item) => (item.host?.id ?? item.hostId) === host.id,
            );
            const passEdits = pass ? parkingPassEdits[pass.id] : null;
            return (
              <div
                key={host.id}
                className="border rounded-lg p-3 bg-muted/30 space-y-3"
              >
                <div className="text-sm font-medium">{host.businessName}</div>
                {pass &&
                  Array.isArray((pass as any).qualityFlags) &&
                  (pass as any).qualityFlags.length > 0 && (
                    <div className="text-xs text-destructive">
                      Data quality: {(pass as any).qualityFlags.join(", ")}
                    </div>
                  )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    value={edits.businessName}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          businessName: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    value={edits.address}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          address: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="City"
                    value={edits.city}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          city: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="State"
                    value={edits.state}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          state: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Latitude"
                    value={edits.latitude}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          latitude: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Longitude"
                    value={edits.longitude}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          longitude: e.target.value,
                        },
                      })
                    }
                  />
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Spot image URL"
                    value={edits.spotImageUrl}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          spotImageUrl: e.target.value,
                        },
                      })
                    }
                  />
                  <div className="sm:col-span-2 flex flex-col gap-2 rounded-md border border-dashed p-3">
                    <div className="text-xs text-muted-foreground">
                      Upload spot photo (preferred). This will show on all maps.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setSpotImageFilesByHostId((prev) => ({
                            ...prev,
                            [host.id]: e.target.files?.[0] ?? null,
                          }))
                        }
                        className="w-full text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          uploadHostSpotImage.isPending ||
                          !spotImageFilesByHostId[host.id]
                        }
                        onClick={() => {
                          const file = spotImageFilesByHostId[host.id];
                          if (!file) return;
                          uploadHostSpotImage.mutate({ hostId: host.id, file });
                        }}
                      >
                        {uploadHostSpotImage.isPending
                          ? "Uploading..."
                          : "Upload"}
                      </Button>
                    </div>
                  </div>
                  <select
                    className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                    value={edits.locationType}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          locationType: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="private_residence">Private Residence</option>
                    <option value="business">Business</option>
                    <option value="parking_lot">Parking Lot</option>
                    <option value="event_space">Event Space</option>
                    <option value="public_park">Public Park</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                    value={resolveFootTrafficValue(edits.expectedFootTraffic)}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          expectedFootTraffic: e.target.value,
                          expectedFootTrafficTouched: true,
                        },
                      })
                    }
                  >
                    <option value="">Foot Traffic</option>
                    {FOOT_TRAFFIC_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-full px-2 py-1 border rounded-md text-sm"
                    placeholder="Contact Phone"
                    value={edits.contactPhone}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          contactPhone: e.target.value,
                        },
                      })
                    }
                  />
                  <textarea
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Amenities JSON"
                    value={edits.amenitiesText}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          amenitiesText: e.target.value,
                        },
                      })
                    }
                  />
                  <textarea
                    className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                    placeholder="Notes"
                    value={edits.notes}
                    onChange={(e) =>
                      setHostEdits({
                        ...hostEdits,
                        [host.id]: {
                          ...edits,
                          notes: e.target.value,
                        },
                      })
                    }
                  />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={edits.isVerified}
                      onChange={(e) =>
                        setHostEdits({
                          ...hostEdits,
                          [host.id]: {
                            ...edits,
                            isVerified: e.target.checked,
                          },
                        })
                      }
                    />
                    Verified
                  </label>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Parking Pass defaults (host)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    These control pins/bookability. Saving the host will sync
                    the derived Parking Pass listing immediately.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Start Time
                      </p>
                      <input
                        type="time"
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={edits.parkingPassStartTime}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassStartTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">End Time</p>
                      <input
                        type="time"
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={edits.parkingPassEndTime}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassEndTime: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Days</p>
                      <div className="flex flex-wrap gap-2">
                        {dayLabels.map((label, idx) => {
                          const days: number[] = Array.isArray(
                            edits.parkingPassDaysOfWeek,
                          )
                            ? edits.parkingPassDaysOfWeek
                            : [];
                          const checked = days.includes(idx);
                          return (
                            <label
                              key={label}
                              className="flex items-center gap-1 text-xs text-muted-foreground select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set<number>(days);
                                  if (e.target.checked) next.add(idx);
                                  else next.delete(idx);
                                  setHostEdits({
                                    ...hostEdits,
                                    [host.id]: {
                                      ...edits,
                                      parkingPassDaysOfWeek: Array.from(
                                        next,
                                      ).sort((a, b) => a - b),
                                    },
                                  });
                                }}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Breakfast ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassBreakfastPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassBreakfastPriceCents: toCents(
                              e.target.value,
                            ),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Lunch ($)</p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassLunchPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassLunchPriceCents: toCents(e.target.value),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Dinner ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassDinnerPriceCents)}
                        onChange={(e) => {
                          const next = applyHostDailyAutoIfAllowed({
                            ...edits,
                            parkingPassDinnerPriceCents: toCents(
                              e.target.value,
                            ),
                          });
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: next,
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Daily ($)</p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassDailyPriceCents)}
                        onChange={(e) => {
                          const cents = toCents(e.target.value);
                          const nextWeekly =
                            edits._parkingPassWeeklyManuallyEdited
                              ? Number(edits.parkingPassWeeklyPriceCents || 0)
                              : cents * 7;
                          const nextMonthly =
                            edits._parkingPassMonthlyManuallyEdited
                              ? Number(edits.parkingPassMonthlyPriceCents || 0)
                              : cents * 30;
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassDailyPriceCents: cents,
                              parkingPassWeeklyPriceCents: nextWeekly,
                              parkingPassMonthlyPriceCents: nextMonthly,
                              _parkingPassDailyManuallyEdited: true,
                            },
                          });
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Weekly ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassWeeklyPriceCents)}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassWeeklyPriceCents: toCents(
                                e.target.value,
                              ),
                              _parkingPassWeeklyManuallyEdited:
                                toCents(e.target.value) > 0,
                            },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Monthly ($)
                      </p>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-full px-2 py-1 border rounded-md text-sm"
                        value={toDollars(edits.parkingPassMonthlyPriceCents)}
                        onChange={(e) =>
                          setHostEdits({
                            ...hostEdits,
                            [host.id]: {
                              ...edits,
                              parkingPassMonthlyPriceCents: toCents(
                                e.target.value,
                              ),
                              _parkingPassMonthlyManuallyEdited:
                                toCents(e.target.value) > 0,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  {pass && passEdits ? (
                    <>
                      <div className="pt-2 border-t">
                        <p className="text-xs font-semibold text-muted-foreground">
                          Parking Pass listing override (optional)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Use this only if you need to override a specific
                          listing; host defaults are the source of truth.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Start Time
                          </p>
                          <input
                            type="time"
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.startTime}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  startTime: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            End Time
                          </p>
                          <input
                            type="time"
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.endTime}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  endTime: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Max Trucks
                          </p>
                          <input
                            type="number"
                            min={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={passEdits.maxTrucks}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  maxTrucks: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Status
                          </p>
                          <select
                            className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                            value={passEdits.status}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  status: e.target.value,
                                },
                              })
                            }
                          >
                            <option value="open">Open</option>
                            <option value="booked">Booked</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="completed">Completed</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Breakfast ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.breakfastPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                breakfastPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Lunch ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.lunchPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                lunchPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Dinner ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.dinnerPriceCents)}
                            onChange={(e) => {
                              const next = applyListingDailyAutoIfAllowed({
                                ...passEdits,
                                dinnerPriceCents: toCents(e.target.value),
                              });
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: next,
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Daily ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.dailyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  dailyPriceCents: toCents(e.target.value),
                                  weeklyPriceCents:
                                    passEdits._weeklyManuallyEdited
                                      ? Number(passEdits.weeklyPriceCents || 0)
                                      : toCents(e.target.value) * 7,
                                  monthlyPriceCents:
                                    passEdits._monthlyManuallyEdited
                                      ? Number(passEdits.monthlyPriceCents || 0)
                                      : toCents(e.target.value) * 30,
                                  _dailyManuallyEdited: true,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Weekly ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.weeklyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  weeklyPriceCents: toCents(e.target.value),
                                  _weeklyManuallyEdited:
                                    toCents(e.target.value) > 0,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Monthly ($)
                          </p>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="w-full px-2 py-1 border rounded-md text-sm"
                            value={toDollars(passEdits.monthlyPriceCents)}
                            onChange={(e) =>
                              setParkingPassEdits({
                                ...parkingPassEdits,
                                [pass.id]: {
                                  ...passEdits,
                                  monthlyPriceCents: toCents(e.target.value),
                                  _monthlyManuallyEdited:
                                    toCents(e.target.value) > 0,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateParkingPass.mutate({
                            eventId: pass.id,
                            updates: passEdits,
                          })
                        }
                        disabled={updateParkingPass.isPending}
                      >
                        Save Parking Pass
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No parking pass listing yet.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      let amenities: any = undefined;
                      if (edits.amenitiesText) {
                        try {
                          amenities = JSON.parse(edits.amenitiesText);
                        } catch {
                          toast({
                            title: "Invalid JSON",
                            description: "Amenities must be valid JSON.",
                            variant: "destructive",
                          });
                          return;
                        }
                      }
                      updateHost.mutate({
                        hostId: host.id,
                        updates: {
                          ...edits,
                          latitude: String(edits.latitude ?? "").trim()
                            ? String(edits.latitude).trim()
                            : null,
                          longitude: String(edits.longitude ?? "").trim()
                            ? String(edits.longitude).trim()
                            : null,
                          spotImageUrl: edits.spotImageUrl?.trim()
                            ? edits.spotImageUrl.trim()
                            : null,
                          expectedFootTraffic: edits.expectedFootTrafficTouched
                            ? edits.expectedFootTraffic === ""
                              ? null
                              : Number(edits.expectedFootTraffic)
                            : edits.expectedFootTrafficOriginal,
                          amenities,
                        },
                      });
                    }}
                  >
                    Save Host
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      deleteHostLocation.mutate({ hostId: host.id })
                    }
                  >
                    Delete Location
                  </Button>
                </div>
              </div>
            );
          })}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium">Add Host Location</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Location name"
                value={newHostLocation.businessName}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    businessName: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Address"
                value={newHostLocation.address}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    address: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="City"
                value={newHostLocation.city}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    city: e.target.value,
                  })
                }
              />
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="State"
                value={newHostLocation.state}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    state: e.target.value,
                  })
                }
              />
              <select
                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                value={newHostLocation.locationType}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    locationType: e.target.value,
                  })
                }
              >
                <option value="private_residence">Private Residence</option>
                <option value="business">Business</option>
                <option value="parking_lot">Parking Lot</option>
                <option value="event_space">Event Space</option>
                <option value="public_park">Public Park</option>
                <option value="other">Other</option>
              </select>
              <select
                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                value={resolveFootTrafficValue(
                  newHostLocation.expectedFootTraffic,
                )}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    expectedFootTraffic: e.target.value,
                  })
                }
              >
                <option value="">Foot Traffic</option>
                {FOOT_TRAFFIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="w-full px-2 py-1 border rounded-md text-sm"
                placeholder="Contact Phone"
                value={newHostLocation.contactPhone}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    contactPhone: e.target.value,
                  })
                }
              />
              <textarea
                className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                placeholder="Notes"
                value={newHostLocation.notes}
                onChange={(e) =>
                  setNewHostLocation({
                    ...newHostLocation,
                    notes: e.target.value,
                  })
                }
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (
                  !newHostLocation.businessName.trim() ||
                  !newHostLocation.address.trim()
                ) {
                  toast({
                    title: "Missing fields",
                    description: "Location name and address are required.",
                    variant: "destructive",
                  });
                  return;
                }
                createHostLocation.mutate({
                  userId: selectedUser.id,
                  data: newHostLocation,
                });
              }}
              disabled={createHostLocation.isPending}
            >
              Add Location
            </Button>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!selectedUser) {
      setUserEdits(null);
      return;
    }
    setUserEdits({
      email: selectedUser.email || "",
      firstName: selectedUser.firstName || "",
      lastName: selectedUser.lastName || "",
      phone: selectedUser.phone || "",
      postalCode: selectedUser.postalCode || "",
      birthYear: selectedUser.birthYear || "",
      gender: selectedUser.gender || "",
      isActive: !selectedUser.isDisabled,
      emailVerified: !!selectedUser.emailVerified,
      userType: selectedUser.userType || "customer",
    });
  }, [selectedUser]);

  useEffect(() => {
    setPayoutPage(1);
  }, [payoutStatusFilter, payoutSearch, payoutFromDate, payoutToDate]);

  useEffect(() => {
    if (!parkingPasses.length) {
      setParkingPassEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    parkingPasses.forEach((pass: any) => {
      const breakfast = Number(pass.breakfastPriceCents ?? 0) || 0;
      const lunch = Number(pass.lunchPriceCents ?? 0) || 0;
      const dinner = Number(pass.dinnerPriceCents ?? 0) || 0;
      const slotSum = breakfast + lunch + dinner;
      const daily = Number(pass.dailyPriceCents ?? 0) || 0;
      const weekly = Number(pass.weeklyPriceCents ?? 0) || 0;
      const monthly = Number(pass.monthlyPriceCents ?? 0) || 0;
      const baseDaily = daily > 0 ? daily : slotSum;
      const derivedWeekly = baseDaily > 0 ? baseDaily * 7 : 0;
      const derivedMonthly = baseDaily > 0 ? baseDaily * 30 : 0;
      nextEdits[pass.id] = {
        startTime: pass.startTime || "",
        endTime: pass.endTime || "",
        maxTrucks: pass.maxTrucks ?? 1,
        status: pass.status || "open",
        breakfastPriceCents: pass.breakfastPriceCents ?? 0,
        lunchPriceCents: pass.lunchPriceCents ?? 0,
        dinnerPriceCents: pass.dinnerPriceCents ?? 0,
        dailyPriceCents: baseDaily,
        weeklyPriceCents: weekly > 0 ? weekly : derivedWeekly,
        monthlyPriceCents: monthly > 0 ? monthly : derivedMonthly,
        _dailyManuallyEdited:
          daily > 0 && slotSum > 0 ? daily !== slotSum : false,
        _weeklyManuallyEdited:
          weekly > 0 && derivedWeekly > 0 ? weekly !== derivedWeekly : false,
        _monthlyManuallyEdited:
          monthly > 0 && derivedMonthly > 0
            ? monthly !== derivedMonthly
            : false,
      };
    });
    setParkingPassEdits(nextEdits);
  }, [parkingPasses]);

  useEffect(() => {
    if (!userAddresses.length) {
      setAddressEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userAddresses.forEach((address: any) => {
      nextEdits[address.id] = {
        label: address.label || "",
        address: address.address || "",
        city: address.city || "",
        state: address.state || "",
        postalCode: address.postalCode || "",
        type: address.type || "other",
        isDefault: !!address.isDefault,
      };
    });
    setAddressEdits(nextEdits);
  }, [userAddresses]);

  useEffect(() => {
    if (!userHosts.length) {
      setHostEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userHosts.forEach((host: any) => {
      const originalFootTraffic =
        host.expectedFootTraffic === undefined
          ? null
          : host.expectedFootTraffic;
      const breakfast = Number(host.parkingPassBreakfastPriceCents ?? 0) || 0;
      const lunch = Number(host.parkingPassLunchPriceCents ?? 0) || 0;
      const dinner = Number(host.parkingPassDinnerPriceCents ?? 0) || 0;
      const slotSum = breakfast + lunch + dinner;
      const daily = Number(host.parkingPassDailyPriceCents ?? 0) || 0;
      const weekly = Number(host.parkingPassWeeklyPriceCents ?? 0) || 0;
      const monthly = Number(host.parkingPassMonthlyPriceCents ?? 0) || 0;
      const baseDaily = daily > 0 ? daily : slotSum;
      const derivedWeekly = baseDaily > 0 ? baseDaily * 7 : 0;
      const derivedMonthly = baseDaily > 0 ? baseDaily * 30 : 0;
      nextEdits[host.id] = {
        businessName: host.businessName || "",
        address: host.address || "",
        city: host.city || "",
        state: host.state || "",
        latitude: host.latitude || "",
        longitude: host.longitude || "",
        spotImageUrl: host.spotImageUrl || "",
        locationType: host.locationType || "other",
        expectedFootTraffic: resolveFootTrafficValue(originalFootTraffic),
        expectedFootTrafficOriginal: originalFootTraffic,
        expectedFootTrafficTouched: false,
        contactPhone: host.contactPhone || "",
        notes: host.notes || "",
        isVerified: !!host.isVerified,
        amenitiesText: host.amenities ? JSON.stringify(host.amenities) : "",
        // Parking Pass defaults (host-level source of truth)
        parkingPassStartTime: host.parkingPassStartTime || "",
        parkingPassEndTime: host.parkingPassEndTime || "",
        parkingPassDaysOfWeek: Array.isArray(host.parkingPassDaysOfWeek)
          ? host.parkingPassDaysOfWeek
          : [],
        parkingPassBreakfastPriceCents:
          host.parkingPassBreakfastPriceCents ?? 0,
        parkingPassLunchPriceCents: host.parkingPassLunchPriceCents ?? 0,
        parkingPassDinnerPriceCents: host.parkingPassDinnerPriceCents ?? 0,
        parkingPassDailyPriceCents: baseDaily,
        parkingPassWeeklyPriceCents: weekly > 0 ? weekly : derivedWeekly,
        parkingPassMonthlyPriceCents: monthly > 0 ? monthly : derivedMonthly,
        _parkingPassDailyManuallyEdited:
          daily > 0 && slotSum > 0 ? daily !== slotSum : false,
        _parkingPassWeeklyManuallyEdited:
          weekly > 0 && derivedWeekly > 0 ? weekly !== derivedWeekly : false,
        _parkingPassMonthlyManuallyEdited:
          monthly > 0 && derivedMonthly > 0
            ? monthly !== derivedMonthly
            : false,
      };
    });
    setHostEdits(nextEdits);
  }, [userHosts]);

  useEffect(() => {
    if (!userRestaurants.length) {
      setRestaurantEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userRestaurants.forEach((restaurant: any) => {
      nextEdits[restaurant.id] = {
        name: restaurant.name || "",
        address: restaurant.address || "",
        phone: restaurant.phone || "",
        businessType: restaurant.businessType || "restaurant",
        cuisineType: restaurant.cuisineType || "",
        promoCode: restaurant.promoCode || "",
        city: restaurant.city || "",
        state: restaurant.state || "",
        latitude: restaurant.latitude || "",
        longitude: restaurant.longitude || "",
        description: restaurant.description || "",
        websiteUrl: restaurant.websiteUrl || "",
        instagramUrl: restaurant.instagramUrl || "",
        facebookPageUrl: restaurant.facebookPageUrl || "",
        isActive: !!restaurant.isActive,
        isVerified: !!restaurant.isVerified,
        amenitiesText: restaurant.amenities
          ? JSON.stringify(restaurant.amenities)
          : "",
      };
    });
    setRestaurantEdits(nextEdits);
  }, [userRestaurants]);

  useEffect(() => {
    if (!userDeals.length) {
      setDealEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userDeals.forEach((deal: any) => {
      nextEdits[deal.id] = {
        title: deal.title || "",
        description: deal.description || "",
        dealType: deal.dealType || "percentage",
        discountValue: deal.discountValue ?? "",
        minOrderAmount: deal.minOrderAmount ?? "",
        imageUrl: deal.imageUrl || "",
        startDate: deal.startDate ? deal.startDate.slice(0, 10) : "",
        endDate: deal.endDate ? deal.endDate.slice(0, 10) : "",
        startTime: deal.startTime || "",
        endTime: deal.endTime || "",
        availableDuringBusinessHours: !!deal.availableDuringBusinessHours,
        isOngoing: !!deal.isOngoing,
        totalUsesLimit: deal.totalUsesLimit ?? "",
        perCustomerLimit: deal.perCustomerLimit ?? "",
        isActive: !!deal.isActive,
      };
    });
    setDealEdits(nextEdits);
  }, [userDeals]);

  useEffect(() => {
    if (!userEvents.length) {
      setEventEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userEvents.forEach((event: any) => {
      nextEdits[event.id] = {
        name: event.name || "",
        description: event.description || "",
        date: event.date ? event.date.slice(0, 10) : "",
        startTime: event.startTime || "",
        endTime: event.endTime || "",
        maxTrucks: event.maxTrucks ?? 1,
        status: event.status || "open",
        hardCapEnabled: !!event.hardCapEnabled,
        requiresPayment: !!event.requiresPayment,
        breakfastPriceCents: event.breakfastPriceCents ?? 0,
        lunchPriceCents: event.lunchPriceCents ?? 0,
        dinnerPriceCents: event.dinnerPriceCents ?? 0,
      };
    });
    setEventEdits(nextEdits);
  }, [userEvents]);

  useEffect(() => {
    if (!userEventSeries.length) {
      setSeriesEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    userEventSeries.forEach((series: any) => {
      nextEdits[series.id] = {
        name: series.name || "",
        description: series.description || "",
        timezone: series.timezone || "America/New_York",
        recurrenceRule: series.recurrenceRule || "",
        startDate: series.startDate ? series.startDate.slice(0, 10) : "",
        endDate: series.endDate ? series.endDate.slice(0, 10) : "",
        defaultStartTime: series.defaultStartTime || "",
        defaultEndTime: series.defaultEndTime || "",
        defaultMaxTrucks: series.defaultMaxTrucks ?? 1,
        defaultHardCapEnabled: !!series.defaultHardCapEnabled,
        status: series.status || "draft",
      };
    });
    setSeriesEdits(nextEdits);
  }, [userEventSeries]);

  useEffect(() => {
    const bookingRows = [
      ...(userParkingBookings?.bookingsAsTruck || []),
      ...(userParkingBookings?.bookingsAsHost || []),
    ];
    if (!bookingRows.length) {
      setBookingEdits({});
      return;
    }
    const nextEdits: Record<string, any> = {};
    bookingRows.forEach((row: any) => {
      const booking = row.event_bookings || row;
      nextEdits[booking.id] = {
        status: booking.status || "pending",
        refundStatus: booking.refundStatus || "none",
        refundAmountCents: booking.refundAmountCents ?? "",
        cancellationReason: booking.cancellationReason || "",
        refundReason: booking.refundReason || "",
      };
    });
    setBookingEdits(nextEdits);
  }, [userParkingBookings]);

  // Fetch selected deal's performance stats
  const { data: dealStats } = useQuery<any>({
    queryKey: ["/api/admin/deals", selectedDeal?.id, "stats"],
    enabled: !!adminUser && !!selectedDeal?.id && dealDetailsOpen,
  });

  // Fetch all deals
  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/deals"],
    enabled: !!adminUser && selectedTab === "deals",
  });

  // Fetch verification requests
  const { data: verificationRequests = [], isLoading: loadingVerifications } =
    useQuery<any[]>({
      queryKey: ["/api/admin/verifications"],
      enabled: !!adminUser && selectedTab === "verifications",
    });

  // Approve restaurant mutation
  const approveRestaurant = useMutation({
    mutationFn: async (restaurantId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/restaurants/${restaurantId}/approve`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/restaurants/pending"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Restaurant Approved",
        description: "The restaurant has been activated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve restaurant. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject restaurant mutation
  const rejectRestaurant = useMutation({
    mutationFn: async (restaurantId: string) => {
      return await apiRequest(
        "DELETE",
        `/api/admin/restaurants/${restaurantId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/restaurants/pending"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Restaurant Rejected",
        description: "The restaurant application has been rejected.",
      });
    },
  });

  // Toggle deal featured status
  const toggleDealFeatured = useMutation({
    mutationFn: async ({
      dealId,
      isFeatured,
    }: {
      dealId: string;
      isFeatured: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/featured`, {
        isFeatured,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      toast({
        title: "Deal Updated",
        description: "Featured status has been updated.",
      });
    },
  });

  // Delete deal
  const deleteDeal = useMutation({
    mutationFn: async (dealId: string) => {
      return await apiRequest("DELETE", `/api/admin/deals/${dealId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDealDetailsOpen(false);
      toast({
        title: "Deal Deleted",
        description: "The deal has been permanently deleted.",
      });
    },
  });

  // Clone deal
  const cloneDeal = useMutation({
    mutationFn: async (dealId: string) => {
      return await apiRequest("POST", `/api/admin/deals/${dealId}/clone`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      toast({
        title: "Deal Cloned",
        description: "A copy of the deal has been created (inactive).",
      });
    },
  });

  // Toggle deal active status
  const toggleDealStatus = useMutation({
    mutationFn: async ({
      dealId,
      isActive,
    }: {
      dealId: string;
      isActive: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/status`, {
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Deal Status Updated",
        description: "The deal has been activated/deactivated.",
      });
    },
  });

  // Extend deal
  const extendDeal = useMutation({
    mutationFn: async ({ dealId, days }: { dealId: string; days: number }) => {
      return await apiRequest("PATCH", `/api/admin/deals/${dealId}/extend`, {
        days,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deals"] });
      setDealDetailsOpen(false);
      toast({
        title: "Deal Extended",
        description: `Deal extended by ${extendDays} days successfully.`,
      });
    },
  });

  // Toggle user status
  const toggleUserStatus = useMutation({
    mutationFn: async ({
      userId,
      isActive,
    }: {
      userId: string;
      isActive: boolean;
    }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/status`, {
        isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Status Updated",
        description: "User account status has been updated.",
      });
    },
  });

  // Update user type
  const updateUserType = useMutation({
    mutationFn: async ({
      userId,
      userType,
    }: {
      userId: string;
      userType: string;
    }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/type`, {
        userType,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Type Updated",
        description: "User type has been changed successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user type.",
        variant: "destructive",
      });
    },
  });

  const resendVerificationEmail = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/resend-verification`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Verification Sent",
        description: "Verification email has been resent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend verification email.",
        variant: "destructive",
      });
    },
  });

  const verifyUserEmail = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/verify`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "User Verified",
        description: "Email verification marked as complete.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to verify user.",
        variant: "destructive",
      });
    },
  });

  const sendSubscriptionLink = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/send-subscription-link`,
      );
    },
    onSuccess: () => {
      toast({
        title: "Subscription Link Sent",
        description: "Monthly subscription link has been emailed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send subscription link.",
        variant: "destructive",
      });
    },
  });

  const updateUserInfo = useMutation({
    mutationFn: async (payload: { userId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/users/${payload.userId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setSelectedUser(updatedUser);
      toast({
        title: "User Updated",
        description: "User information has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user.",
        variant: "destructive",
      });
    },
  });

  const updateParkingPass = useMutation({
    mutationFn: async (payload: { eventId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/parking-pass/${payload.eventId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({
        title: "Parking Pass Updated",
        description: "Parking pass listing updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update parking pass.",
        variant: "destructive",
      });
    },
  });

  const createAddress = useMutation({
    mutationFn: async (payload: { userId: string; data: any }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/addresses`,
        payload.data,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      setNewAddress({
        label: "",
        address: "",
        city: "",
        state: "",
        postalCode: "",
        type: "other",
        isDefault: false,
      });
      toast({ title: "Address Added" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add address.",
        variant: "destructive",
      });
    },
  });

  const updateAddress = useMutation({
    mutationFn: async (payload: {
      userId: string;
      addressId: string;
      updates: any;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Address Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update address.",
        variant: "destructive",
      });
    },
  });

  const deleteAddress = useMutation({
    mutationFn: async (payload: { userId: string; addressId: string }) => {
      return await apiRequest(
        "DELETE",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Address Deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete address.",
        variant: "destructive",
      });
    },
  });

  const setDefaultAddress = useMutation({
    mutationFn: async (payload: { userId: string; addressId: string }) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/addresses/${payload.addressId}/default`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "addresses"],
      });
      toast({ title: "Default Address Updated" });
    },
  });

  const updateHost = useMutation({
    mutationFn: async (payload: { hostId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/hosts/${payload.hostId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({ title: "Host Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update host.",
        variant: "destructive",
      });
    },
  });

  const createHostLocation = useMutation({
    mutationFn: async (payload: { userId: string; data: any }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${payload.userId}/hosts`,
        payload.data,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      setNewHostLocation({
        businessName: "",
        address: "",
        city: "",
        state: "",
        locationType: "other",
        expectedFootTraffic: "",
        contactPhone: "",
        notes: "",
      });
      toast({ title: "Host Location Added" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add host location.",
        variant: "destructive",
      });
    },
  });

  const deleteHostLocation = useMutation({
    mutationFn: async (payload: { hostId: string }) => {
      return await apiRequest("DELETE", `/api/admin/hosts/${payload.hostId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "hosts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "parking-pass"],
      });
      toast({ title: "Host Location Deleted" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete host location.",
        variant: "destructive",
      });
    },
  });

  const updateRestaurant = useMutation({
    mutationFn: async (payload: { restaurantId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/restaurants/${payload.restaurantId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "restaurants"],
      });
      toast({ title: "Restaurant Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update restaurant.",
        variant: "destructive",
      });
    },
  });

  const updateDeal = useMutation({
    mutationFn: async (payload: { dealId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/deals/${payload.dealId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "deals"],
      });
      toast({ title: "Deal Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update deal.",
        variant: "destructive",
      });
    },
  });

  const updateEvent = useMutation({
    mutationFn: async (payload: { eventId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/events/${payload.eventId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "events"],
      });
      toast({ title: "Event Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event.",
        variant: "destructive",
      });
    },
  });

  const updateEventSeries = useMutation({
    mutationFn: async (payload: { seriesId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/event-series/${payload.seriesId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users", selectedUser?.id, "event-series"],
      });
      toast({ title: "Open Call Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update open call.",
        variant: "destructive",
      });
    },
  });

  const updateBooking = useMutation({
    mutationFn: async (payload: { bookingId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/parking-pass-bookings/${payload.bookingId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          "/api/admin/users",
          selectedUser?.id,
          "parking-pass-bookings",
        ],
      });
      toast({ title: "Booking Updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update booking.",
        variant: "destructive",
      });
    },
  });

  // Delete user
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUserDetailsOpen(false);
      toast({
        title: "User Deleted",
        description: "User account has been permanently deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user.",
        variant: "destructive",
      });
    },
  });

  // Delete user (super admin only)
  const deleteUserPermanently = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUserDetailsOpen(false);
      toast({
        title: "User Deleted",
        description: "User has been permanently deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message ||
          "Failed to delete user. You may need super admin permissions.",
        variant: "destructive",
      });
    },
  });

  // Approve verification request
  const approveVerification = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/verifications/${requestId}/approve`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Verification Approved",
        description: "Restaurant verification has been approved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve verification. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Reject verification request
  const rejectVerification = useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: string;
      reason: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/admin/verifications/${requestId}/reject`,
        { reason },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: "Verification Rejected",
        description: "Restaurant verification has been rejected.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject verification. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!adminUser) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex items-center justify-center p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="w-6 h-6 text-destructive" />
              <span>Access Denied</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              You need admin privileges to access this page.
            </p>
            <Link href="/login">
              <Button className="w-full">Go to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const defaultStats: DashboardStats = {
    totalUsers: 0,
    totalRestaurants: 0,
    totalDeals: 0,
    activeDeals: 0,
    totalClaims: 0,
    todayClaims: 0,
    revenue: 0,
    newUsersToday: 0,
    memberCounts: {
      customer: 0,
      restaurantOwner: 0,
      foodTruck: 0,
      host: 0,
      eventCoordinator: 0,
      staff: 0,
      admin: 0,
      superAdmin: 0,
      other: 0,
    },
  };

  const dashboardStats = dashboardTotals?.totals || defaultStats;
  const operations = dashboardTotals?.operations || null;
  const toDollars = (value: number | string | null | undefined) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return parsed / 100;
  };
  const toCents = (value: string | number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.round(parsed * 100);
  };

  const applyHostDailyAutoIfAllowed = (edits: any) => {
    const slotSum =
      (Number(edits?.parkingPassBreakfastPriceCents ?? 0) || 0) +
      (Number(edits?.parkingPassLunchPriceCents ?? 0) || 0) +
      (Number(edits?.parkingPassDinnerPriceCents ?? 0) || 0);
    if (slotSum <= 0) return edits;
    const nextDaily = edits?._parkingPassDailyManuallyEdited
      ? Number(edits?.parkingPassDailyPriceCents ?? 0) || 0
      : slotSum;
    const nextWeekly = edits?._parkingPassWeeklyManuallyEdited
      ? Number(edits?.parkingPassWeeklyPriceCents ?? 0) || 0
      : nextDaily * 7;
    const nextMonthly = edits?._parkingPassMonthlyManuallyEdited
      ? Number(edits?.parkingPassMonthlyPriceCents ?? 0) || 0
      : nextDaily * 30;
    return {
      ...edits,
      parkingPassDailyPriceCents: nextDaily,
      parkingPassWeeklyPriceCents: nextWeekly,
      parkingPassMonthlyPriceCents: nextMonthly,
    };
  };

  const applyListingDailyAutoIfAllowed = (edits: any) => {
    const slotSum =
      (Number(edits?.breakfastPriceCents ?? 0) || 0) +
      (Number(edits?.lunchPriceCents ?? 0) || 0) +
      (Number(edits?.dinnerPriceCents ?? 0) || 0);
    if (slotSum <= 0) return edits;
    const nextDaily = edits?._dailyManuallyEdited
      ? Number(edits?.dailyPriceCents ?? 0) || 0
      : slotSum;
    const nextWeekly = edits?._weeklyManuallyEdited
      ? Number(edits?.weeklyPriceCents ?? 0) || 0
      : nextDaily * 7;
    const nextMonthly = edits?._monthlyManuallyEdited
      ? Number(edits?.monthlyPriceCents ?? 0) || 0
      : nextDaily * 30;
    return {
      ...edits,
      dailyPriceCents: nextDaily,
      weeklyPriceCents: nextWeekly,
      monthlyPriceCents: nextMonthly,
    };
  };

  const demandSummary = locationDemandFunnel?.summary;
  const demandStuck24h = Number(demandSummary?.threshold_met_stuck_24h ?? 0);
  const demandStuck72h = Number(demandSummary?.threshold_met_stuck_72h ?? 0);
  const demandAlertLevel =
    demandStuck72h > 0
      ? "critical"
      : demandStuck24h > 0
        ? "warning"
        : "healthy";
  const demandAlertBadgeVariant =
    demandAlertLevel === "critical"
      ? "destructive"
      : demandAlertLevel === "warning"
        ? "secondary"
        : "outline";
  const demandAlertText =
    demandAlertLevel === "critical"
      ? "SLA breach: 72h+ threshold backlog requires immediate intervention."
      : demandAlertLevel === "warning"
        ? "Warning: 24h+ threshold backlog needs host follow-up."
        : "Healthy: no threshold backlog breaches.";

  return (
    <div className="admin-dashboard max-w-7xl mx-auto min-h-screen bg-[var(--bg-app)] pb-20">
      {/* Header */}
      <header className="px-4 sm:px-6 py-4 sm:py-6 bg-[hsl(var(--background))] border-b border-white/5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-primary" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Admin Dashboard</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Manage your MealScout platform and LISA intelligence feeds
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleLogout}
            data-testid="button-logout-admin"
          >
            Logout
          </Button>
        </div>
      </header>

      {/* Dashboard Switcher */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6">
        <QuickDashboardAccess />
      </div>

      {/* Stats Overview */}
      <div className="px-4 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="col-span-2 md:col-span-4 border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/5">
            <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    LISA
                  </span>
                </div>
                <h2 className="text-lg font-semibold">
                  Livestream is in Control Center
                </h2>
                <p className="text-sm text-muted-foreground">
                  Open the live MealScout signal feed, truth registry, bot
                  traffic, and market intelligence from the admin control
                  center.
                </p>
              </div>
              <Link href="/admin/control-center">
                <Button>Open LISA Livestream</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="col-span-2 md:col-span-4 border-[color:var(--status-warning)]/25 bg-[color:var(--status-warning)]/5">
            <CardContent className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    MODERATION
                  </span>
                </div>
                <h2 className="text-lg font-semibold">
                  Review Flagged Content
                </h2>
                <p className="text-sm text-muted-foreground">
                  Review flagged recommendations and profile content, assign
                  cases, and resolve reports.
                </p>
              </div>
              <Link href="/admin/moderation/queue">
                <Button variant="outline">Open Moderation Queue</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {dashboardStats.totalUsers}
                </div>
                <Users className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                +{dashboardStats.newUsersToday} today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Restaurant Profiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {dashboardStats.totalRestaurantProfiles ??
                    dashboardStats.totalRestaurants}
                </div>
                <Store className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dashboardStats.totalRestaurantOwners ??
                  dashboardStats.memberCounts?.restaurantOwner ??
                  0}{" "}
                owner accounts - {pendingRestaurants.length} pending
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Deals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {dashboardStats.activeDeals}
                </div>
                <Package className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                of {dashboardStats.totalDeals} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Claims Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {dashboardStats.todayClaims}
                </div>
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {dashboardStats.totalClaims} total
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Member Counts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Role total {dashboardStats.memberCountsTotal ?? 0} of{" "}
              {dashboardStats.totalUsers} users
              {dashboardStats.unclassifiedUsers
                ? ` - ${dashboardStats.unclassifiedUsers} unclassified`
                : ""}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Customers</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.customer ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Restaurant Owners</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.restaurantOwner ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Food Trucks</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.foodTruck ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Hosts</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.host ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Event Coordinators</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.eventCoordinator ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Staff</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.staff ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Admins</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.admin ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Super Admin</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.superAdmin ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Other</p>
                <p className="font-semibold">
                  {dashboardStats.memberCounts?.other ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Operations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Parking Passes (Live)</p>
                <p className="font-semibold">
                  {operations?.parkingPass?.seriesPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Parking Pass Hosts (Live)
                </p>
                <p className="font-semibold">
                  {operations?.parkingPass?.hostsPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Parking Pass Spots (Capacity)
                </p>
                <p className="font-semibold">
                  {operations?.parkingPass?.spotCapacityPublished ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Bookings (Today)</p>
                <p className="font-semibold">
                  {operations?.bookings?.parkingPassConfirmedToday ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Bookings Confirmed (24h)
                </p>
                <p className="font-semibold">
                  {operations?.bookings?.confirmedLast24h ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Bookings (Next 7d)</p>
                <p className="font-semibold">
                  {operations?.bookings?.parkingPassConfirmedNext7Days ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Open Call Accepted (7d)</p>
                <p className="font-semibold">
                  {operations?.openCalls?.acceptedNext7Days ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Open Call Fill Rate (7d)
                </p>
                <p className="font-semibold">
                  {operations?.openCalls?.fillRateNext7DaysPct?.toFixed?.(1) ??
                    0}
                  %
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {operations?.openCalls?.capacityNext7Days ?? 0} total capacity
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Checkout Holds (Pending)
                </p>
                <p className="font-semibold">
                  {operations?.bookings?.pendingCheckoutHolds ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Checkout Holds (Stale)</p>
                <p
                  className={`font-semibold ${
                    (operations?.bookings?.staleCheckoutHolds ?? 0) > 0
                      ? "text-[color:var(--status-error)]"
                      : ""
                  }`}
                >
                  {operations?.bookings?.staleCheckoutHolds ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Failed Payments (24h)</p>
                <p
                  className={`font-semibold ${
                    (operations?.bookings?.failedPaymentsLast24h ?? 0) > 0
                      ? "text-[color:var(--status-error)]"
                      : ""
                  }`}
                >
                  {operations?.bookings?.failedPaymentsLast24h ?? 0}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Live Trucks (15m)</p>
                <p className="font-semibold">
                  {operations?.trucks?.liveTrucks15m ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {operations?.trucks?.activeSessions ?? 0} active sessions
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {mapPinAudit && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Map Pin Parity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryMapPinGeocode.mutate()}
                  disabled={retryMapPinGeocode.isPending}
                >
                  {retryMapPinGeocode.isPending
                    ? "Retrying..."
                    : "Retry Missing Geocodes"}
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Rendered host pins</p>
                  <p className="font-semibold">
                    {mapPinAudit.renderedHostLocationCandidates.mappable}/
                    {mapPinAudit.renderedHostLocationCandidates.total}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Primary hosts mapped</p>
                  <p className="font-semibold">
                    {mapPinAudit.primaryHostProfiles.mappable}/
                    {mapPinAudit.primaryHostProfiles.total}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    Extra addresses mapped
                  </p>
                  <p className="font-semibold">
                    {mapPinAudit.additionalHostAddresses.mappable}/
                    {mapPinAudit.additionalHostAddresses.included}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Open requests mapped</p>
                  <p className="font-semibold">
                    {mapPinAudit.openLocationRequests.mappable}/
                    {mapPinAudit.openLocationRequests.total}
                  </p>
                </div>
              </div>
              {!!mapPinAudit.sampleMissing?.length && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Sample missing locations
                  </p>
                  {mapPinAudit.sampleMissing.map((missing) => (
                    <div
                      key={`${missing.source}:${missing.id}`}
                      className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-md border border-[color:var(--border-subtle)] p-2"
                    >
                      <div className="text-xs">
                        <div className="font-medium text-foreground">
                          {[missing.address, missing.city, missing.state]
                            .filter(Boolean)
                            .join(", ") || "(no address)"}
                        </div>
                        <div className="text-muted-foreground">
                          {missing.source}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryMapPinGeocodeItem.isPending}
                        onClick={() =>
                          retryMapPinGeocodeItem.mutate({
                            source: missing.source,
                            id: missing.id,
                          })
                        }
                      >
                        Retry row
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main Content Tabs */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="w-full inline-flex h-auto flex-wrap gap-1 p-1">
            <TabsTrigger
              value="overview"
              data-testid="tab-overview"
              className="flex-shrink-0"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="restaurants"
              data-testid="tab-restaurants"
              className="flex-shrink-0"
            >
              Restaurants
            </TabsTrigger>
            <TabsTrigger
              value="lisa"
              data-testid="tab-lisa"
              className="flex-shrink-0"
            >
              LISA
            </TabsTrigger>
            <TabsTrigger
              value="users"
              data-testid="tab-users"
              className="flex-shrink-0"
            >
              Users
            </TabsTrigger>
            <TabsTrigger
              value="staff"
              data-testid="tab-staff"
              className="flex-shrink-0"
            >
              Staff
            </TabsTrigger>
            <TabsTrigger
              value="deals"
              data-testid="tab-deals"
              className="flex-shrink-0"
            >
              Deals
            </TabsTrigger>
            <TabsTrigger
              value="verifications"
              data-testid="tab-verifications"
              className="flex-shrink-0"
            >
              Verifications
            </TabsTrigger>
            <TabsTrigger
              value="onboarding"
              data-testid="tab-onboarding"
              className="flex-shrink-0"
            >
              Manual Onboarding
            </TabsTrigger>
            <TabsTrigger
              value="imports"
              data-testid="tab-imports"
              className="flex-shrink-0"
            >
              Admin Uploads
            </TabsTrigger>
            <TabsTrigger
              value="host-locations"
              data-testid="tab-host-locations"
              className="flex-shrink-0"
            >
              Host Locations
            </TabsTrigger>
            <TabsTrigger
              value="share-portal"
              data-testid="tab-share-portal"
              className="flex-shrink-0"
            >
              Share Portal
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Platform Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[color:var(--status-success)]/10 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="w-5 h-5 text-[color:var(--status-success)]" />
                    <span className="font-medium">System Status</span>
                  </div>
                  <Badge variant="default">Operational</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Conversion Rate
                    </div>
                    <div className="text-xl font-bold">
                      {dashboardStats.totalClaims > 0
                        ? (
                            (dashboardStats.todayClaims /
                              dashboardStats.totalClaims) *
                            100
                          ).toFixed(1)
                        : "0"}
                      %
                    </div>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="text-sm text-muted-foreground">
                      Monthly Revenue
                    </div>
                    <div className="text-xl font-bold">
                      {(() => {
                        const revenue = Number(dashboardStats?.revenue ?? 0);
                        return `$${revenue.toFixed(2)}`;
                      })()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Email Delivery</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <div className="font-medium">
                      Provider: {emailStatus?.provider || "unknown"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      From: {emailStatus?.fromName || "MealScout"} &lt;
                      {emailStatus?.fromEmail || "unknown"}&gt;
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Mode: {emailStatus?.mode || "unknown"}
                    </div>
                  </div>
                  <Badge
                    variant={
                      emailStatus?.configured ? "default" : "destructive"
                    }
                  >
                    {emailStatus?.configured ? "Configured" : "Not configured"}
                  </Badge>
                </div>

                {emailStatus?.disabled ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Email sending is disabled by `EMAIL_NOTIFICATIONS_MODE=
                    {String(emailStatus?.mode || "")}`.
                  </div>
                ) : null}

                {!emailStatus?.configured ? (
                  <div className="rounded-md border border-[color:var(--status-error)]/30 bg-[color:var(--status-error)]/10 p-3 text-xs text-[color:var(--status-error)]">
                    Email provider is not configured. Missing:{" "}
                    {Array.isArray(emailStatus?.missing) &&
                    emailStatus.missing.length
                      ? emailStatus.missing.join(", ")
                      : "BREVO_API_KEY"}
                  </div>
                ) : Array.isArray(emailStatus?.missing) &&
                  emailStatus.missing.length > 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Email config warnings: {emailStatus.missing.join(", ")}
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="Send test email to (blank = your admin email)"
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                  />
                  <select
                    className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                    value={testEmailCategory}
                    onChange={(e) =>
                      setTestEmailCategory(
                        e.target.value === "account" ? "account" : "general",
                      )
                    }
                  >
                    <option value="general">General</option>
                    <option value="account">Account</option>
                  </select>
                  <Button
                    disabled={sendTestEmail.isPending || !adminUser}
                    onClick={() => sendTestEmail.mutate()}
                  >
                    Send test
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <div className="text-xs font-semibold">Recent attempts</div>
                  {Array.isArray(emailAttempts?.rows) &&
                  emailAttempts.rows.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {emailAttempts.rows.slice(0, 10).map((row: any) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-1 rounded-md border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="truncate">
                              <span className="font-semibold">
                                {row.status}
                              </span>{" "}
                              {row.category ? `(${row.category})` : ""} -{" "}
                              {row.to}
                            </div>
                            <div className="truncate text-muted-foreground">
                              {row.subject}
                            </div>
                            {row.error ? (
                              <div className="truncate text-[color:var(--status-error)]">
                                {row.error}
                              </div>
                            ) : row.skipReason ? (
                              <div className="truncate text-muted-foreground">
                                {row.skipReason}
                              </div>
                            ) : null}
                            {row.providerStatusCode ? (
                              <div className="truncate text-muted-foreground">
                                Provider status: {row.providerStatusCode}
                                {row.providerErrorCode
                                  ? ` (${row.providerErrorCode})`
                                  : ""}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-muted-foreground">
                            {row.createdAt
                              ? new Date(row.createdAt).toLocaleString()
                              : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      No email attempts recorded yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Location Demand Funnel</CardTitle>
                    <CardDescription>
                      Track threshold to claimed to published to booked
                      conversion.
                    </CardDescription>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={demandAlertBadgeVariant}>
                        {demandAlertLevel === "critical"
                          ? "Critical"
                          : demandAlertLevel === "warning"
                            ? "Warning"
                            : "Healthy"}
                      </Badge>
                      <Badge
                        variant={demandStuck72h > 0 ? "destructive" : "outline"}
                      >
                        72h stuck: {demandStuck72h}
                      </Badge>
                      <Badge
                        variant={demandStuck24h > 0 ? "secondary" : "outline"}
                      >
                        24h stuck: {demandStuck24h}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    disabled={runLocationDemandActivation.isPending}
                    onClick={() => runLocationDemandActivation.mutate()}
                  >
                    {runLocationDemandActivation.isPending
                      ? "Running..."
                      : "Run Activation"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Threshold open
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary?.threshold_met_open ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Claimed</div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary?.claimed_total ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Published
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary
                          ?.claimed_with_published_slots ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Confirmed booking
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(
                        locationDemandFunnel?.summary
                          ?.claimed_with_confirmed_booking ?? 0,
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Claim rate from threshold open
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.claimRateFromThresholdOpen ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Publish rate from claimed
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.publishRateFromClaimed ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                  <div className="rounded-md border p-3 text-sm">
                    <div className="text-xs text-muted-foreground">
                      Booking rate from claimed
                    </div>
                    <div className="font-semibold">
                      {Math.round(
                        Number(
                          locationDemandFunnel?.summary
                            ?.bookingRateFromClaimed ?? 0,
                        ) * 100,
                      )}
                      %
                    </div>
                  </div>
                </div>

                <div
                  className={`text-xs ${
                    demandAlertLevel === "critical"
                      ? "text-[color:var(--status-error)]"
                      : demandAlertLevel === "warning"
                        ? "text-[color:var(--status-warning)]"
                        : "text-muted-foreground"
                  }`}
                >
                  {demandFunnelLoading
                    ? "Loading demand funnel..."
                    : demandAlertText}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Parking Pass Onboarding Queue</CardTitle>
                    <CardDescription>
                      Prioritized hosts missing Stripe onboarding or pricing.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={repairParkingPassPricingAudit.isPending}
                      onClick={() => repairParkingPassPricingAudit.mutate()}
                    >
                      {repairParkingPassPricingAudit.isPending
                        ? "Repairing..."
                        : "Repair Pricing"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={runParkingPassReminders.isPending}
                      onClick={() => runParkingPassReminders.mutate()}
                    >
                      {runParkingPassReminders.isPending
                        ? "Running..."
                        : "Run All Reminders"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent
                className="space-y-3"
                tabIndex={0}
                onKeyDown={handlePayoutCardKeyDown}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Total queued
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.total ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      High priority (Stripe)
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.highPriority ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Medium priority (Pricing)
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(parkingPassOnboardingQueue?.mediumPriority ?? 0)}
                    </div>
                  </div>
                </div>

                {parkingPassPricingAudit ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Host pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withHostPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Series pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withSeriesPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Event pricing rows
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.withEventPricing ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        Pricing mismatches
                      </div>
                      <div className="text-lg font-semibold">
                        {Number(parkingPassPricingAudit.mismatches ?? 0)}
                      </div>
                    </div>
                  </div>
                ) : null}

                {queueLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading queue...
                  </div>
                ) : Array.isArray(parkingPassOnboardingQueue?.items) &&
                  parkingPassOnboardingQueue.items.length > 0 ? (
                  <div className="space-y-2">
                    {parkingPassOnboardingQueue.items
                      .slice(0, 12)
                      .map((item) => (
                        <div
                          key={item.hostId}
                          className="rounded-md border px-3 py-2 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {item.businessName || "Unnamed host"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {item.address || "No address"}
                              {item.email ? ` • ${item.email}` : " • No email"}
                            </div>
                            <div className="mt-1 flex gap-2">
                              <Badge
                                variant={
                                  item.priority === "high"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {item.priority}
                              </Badge>
                              {item.needsStripe ? (
                                <Badge variant="outline">Needs Stripe</Badge>
                              ) : null}
                              {item.needsPricing ? (
                                <Badge variant="outline">Needs Pricing</Badge>
                              ) : (
                                <Badge variant="outline">
                                  Pricing: {item.pricingSource}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              sendSingleParkingPassReminder.isPending ||
                              !item.email
                            }
                            onClick={() =>
                              sendSingleParkingPassReminder.mutate(item.hostId)
                            }
                          >
                            {sendSingleParkingPassReminder.isPending
                              ? "Sending..."
                              : "Send Reminder"}
                          </Button>
                        </div>
                      ))}
                    {parkingPassOnboardingQueue.items.length > 12 ? (
                      <div className="text-xs text-muted-foreground">
                        Showing first 12 of{" "}
                        {parkingPassOnboardingQueue.items.length} hosts.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No hosts currently need onboarding reminders.
                  </div>
                )}

                {Array.isArray(parkingPassPricingAudit?.items) &&
                parkingPassPricingAudit.items.length > 0 ? (
                  <div className="pt-2 border-t">
                    <div className="text-xs font-semibold mb-2">
                      Pricing audit exceptions
                    </div>
                    <div className="space-y-2">
                      {parkingPassPricingAudit.items.slice(0, 8).map((item) => (
                        <div
                          key={`pricing-audit-${item.hostId}`}
                          className="rounded-md border px-3 py-2 text-xs"
                        >
                          <div className="font-medium">
                            {item.businessName || item.hostId}
                          </div>
                          <div className="text-muted-foreground">
                            source={item.pricingSource} host=
                            {item.hostPricing ? "yes" : "no"} series=
                            {item.seriesPricing ? "yes" : "no"} event=
                            {item.eventPricing ? "yes" : "no"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Host Payout Requests</CardTitle>
                <CardDescription>
                  Review and process host cash-out requests.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutStatusFilter}
                        onChange={(e) =>
                          setPayoutStatusFilter(
                            e.target.value as
                              | "all"
                              | "pending"
                              | "approved"
                              | "paid"
                              | "rejected"
                              | "cancelled",
                          )
                        }
                      >
                        <option value="all">All statuses</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="paid">Paid</option>
                        <option value="rejected">Rejected</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={
                            payoutStatusFilter === "pending"
                              ? "default"
                              : "outline"
                          }
                          onClick={() => setPayoutStatusFilter("pending")}
                        >
                          Pending only
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            payoutStatusFilter === "all" ? "default" : "outline"
                          }
                          onClick={() => setPayoutStatusFilter("all")}
                        >
                          All
                        </Button>
                      </div>
                      <input
                        className="w-full sm:w-64 px-3 py-2 border rounded-md text-sm"
                        placeholder="Search host/email/address"
                        value={payoutSearch}
                        onChange={(e) => setPayoutSearch(e.target.value)}
                      />
                      <input
                        type="date"
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutFromDate}
                        onChange={(e) =>
                          handlePayoutFromDateChange(e.target.value)
                        }
                      />
                      <input
                        type="date"
                        className="w-full sm:w-40 px-3 py-2 border rounded-md text-sm"
                        value={payoutToDate}
                        onChange={(e) =>
                          handlePayoutToDateChange(e.target.value)
                        }
                      />
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("last7")}
                        >
                          Last 7 Days
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("thisMonth")}
                        >
                          This Month
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("lastMonth")}
                        >
                          Last Month
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => applyPayoutDatePreset("clear")}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    {payoutDateRangeError && (
                      <div className="text-xs text-destructive">
                        {payoutDateRangeError}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground">
                      {Number(hostPayoutRequests?.pagination?.total ?? 0)}{" "}
                      matching request(s)
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={jumpToNextPendingPayout}
                      disabled={
                        payoutQueueLoading ||
                        orderedPendingPayoutRowIds.length === 0
                      }
                      title="Shortcuts: N / Shift+N"
                    >
                      Next pending
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={approveCurrentPendingPayout}
                      disabled={
                        updateHostPayoutRequest.isPending ||
                        !activePendingPayoutRow
                      }
                      title="Shortcut: A"
                    >
                      Approve current
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      N / Shift+N / A
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={exportHostPayoutRequestsCsv}
                      disabled={
                        isExportingPayouts ||
                        payoutQueueLoading ||
                        Boolean(payoutDateRangeError)
                      }
                    >
                      {isExportingPayouts ? "Exporting..." : "Export CSV"}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Pending</div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.pending ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Approved
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.approved ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Paid</div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.paid ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">
                      Rejected
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(hostPayoutRequests?.totals?.rejected ?? 0)}
                    </div>
                  </div>
                </div>

                {payoutQueueLoading ? (
                  <div className="text-sm text-muted-foreground">
                    Loading payout requests...
                  </div>
                ) : Array.isArray(hostPayoutRequests?.rows) &&
                  hostPayoutRequests.rows.length > 0 ? (
                  <div className="space-y-2">
                    {hostPayoutRequests.rows.map((row) => {
                      const canApprove = row.status === "pending";
                      const canMarkPaid = row.status === "approved";
                      return (
                        <div
                          key={row.id}
                          id={`payout-row-${row.id}`}
                          className={`rounded-md border px-3 py-2 text-sm flex flex-col gap-2 ${
                            row.id === activePendingPayoutRowId
                              ? "ring-2 ring-primary/40"
                              : ""
                          }`}
                        >
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                {row.hostBusinessName || "Unnamed host"}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {row.requesterEmail || "No requester email"}
                                {row.hostAddress
                                  ? ` • ${row.hostAddress}${row.hostCity ? `, ${row.hostCity}` : ""}${row.hostState ? `, ${row.hostState}` : ""}`
                                  : ""}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                Requested:{" "}
                                {row.createdAt
                                  ? new Date(row.createdAt).toLocaleString()
                                  : "-"}
                                {row.reviewedAt
                                  ? ` • Reviewed: ${new Date(row.reviewedAt).toLocaleString()}`
                                  : ""}
                                {row.reviewedByEmail
                                  ? ` • By: ${row.reviewedByEmail}`
                                  : row.reviewedByUserId
                                    ? ` • By: ${row.reviewedByUserId}`
                                    : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{row.status}</Badge>
                              <span className="font-semibold">
                                $
                                {(Number(row.amountCents || 0) / 100).toFixed(
                                  2,
                                )}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                updateHostPayoutRequest.isPending || !canApprove
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "approved",
                                })
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                updateHostPayoutRequest.isPending ||
                                !canMarkPaid
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "paid",
                                })
                              }
                            >
                              Mark Paid
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                updateHostPayoutRequest.isPending ||
                                row.status === "paid" ||
                                row.status === "rejected"
                              }
                              onClick={() =>
                                updateHostPayoutRequest.mutate({
                                  requestId: row.id,
                                  status: "rejected",
                                })
                              }
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between pt-2">
                      <div className="text-xs text-muted-foreground">
                        Page {Number(hostPayoutRequests?.pagination?.page ?? 1)}{" "}
                        of{" "}
                        {Number(
                          hostPayoutRequests?.pagination?.totalPages ?? 1,
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            payoutQueueLoading ||
                            !hostPayoutRequests?.pagination?.hasPrev
                          }
                          onClick={() =>
                            setPayoutPage((prev) => Math.max(1, prev - 1))
                          }
                        >
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            payoutQueueLoading ||
                            !hostPayoutRequests?.pagination?.hasNext
                          }
                          onClick={() => setPayoutPage((prev) => prev + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No host payout requests yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lisa" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>LISA Opportunity Console</CardTitle>
                <CardDescription>
                  First-party truth now, with recommendation cards only when
                  signal density is sufficient
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isTruthOnlyMode ? (
                  <div className="text-xs text-muted-foreground">
                    {lisaMarketIntel?.signalContract?.reason ||
                      "Not enough recent first-party signal to rank recommendation cards safely."}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Link href="/admin/control-center">
                    <Button>Open Full Stream</Button>
                  </Link>
                  <Badge variant="outline">
                    {(promoteNowItems ?? []).length} promotion ideas
                  </Badge>
                  <Badge variant="outline">
                    {(acquisitionWatchItems ?? []).length} acquisition targets
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Human sessions now
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.humanSessionsNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Intent actions now
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.intentActionsNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Repeated interest
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters
                          ?.repeatedBusinessInterestNow ?? 0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Machine discovery
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.machineDiscoveryNow ??
                          0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-[11px] text-muted-foreground">
                      Friction cases
                    </div>
                    <div className="text-lg font-semibold">
                      {Number(
                        lisaMarketIntel?.truthCounters?.frictionCasesNow ?? 0,
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Top content promotion candidate
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topPromotionItem
                        ? buildBriefSentence(topPromotionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topPromotionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topPromotionItem.rankReason}
                        </div>
                      ) : null}
                      {topPromotionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topPromotionItem.changed}
                        </div>
                      ) : null}
                      {topPromotionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topPromotionItem.href}>
                            <Button size="sm" variant="outline">
                              {topPromotionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "snooze",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "done",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `promote:${topPromotionItem.id}`,
                                "dismiss",
                                topPromotionItem.title,
                                topPromotionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Biggest demand spike
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topDemandItem
                        ? buildBriefSentence(topDemandItem)
                        : "No clear demand spike yet."}
                      {topDemandItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topDemandItem.rankReason}
                        </div>
                      ) : null}
                      {topDemandItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday: {topDemandItem.changed}
                        </div>
                      ) : null}
                      {topDemandItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topDemandItem.href}>
                            <Button size="sm" variant="outline">
                              {topDemandItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "snooze",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "done",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `demand:${topDemandItem.id}`,
                                "dismiss",
                                topDemandItem.title,
                                topDemandItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Strongest supply/acquisition watch target
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topAcquisitionItem
                        ? buildBriefSentence(topAcquisitionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topAcquisitionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topAcquisitionItem.rankReason}
                        </div>
                      ) : null}
                      {topAcquisitionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topAcquisitionItem.changed}
                        </div>
                      ) : null}
                      {topAcquisitionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topAcquisitionItem.href}>
                            <Button size="sm" variant="outline">
                              {topAcquisitionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "snooze",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "done",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `acquire:${topAcquisitionItem.id}`,
                                "dismiss",
                                topAcquisitionItem.title,
                                topAcquisitionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Machine discovery pressure to address
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {topMachineAttentionItem
                        ? buildBriefSentence(topMachineAttentionItem)
                        : "Not enough recent first-party signal to rank this safely."}
                      {topMachineAttentionItem ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Why this is #1: {topMachineAttentionItem.rankReason}
                        </div>
                      ) : null}
                      {topMachineAttentionItem?.changed ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          What changed since yesterday:{" "}
                          {topMachineAttentionItem.changed}
                        </div>
                      ) : null}
                      {topMachineAttentionItem ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={topMachineAttentionItem.href}>
                            <Button size="sm" variant="outline">
                              {topMachineAttentionItem.actionLabel}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "snooze",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Snooze
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "done",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              handleBriefAction(
                                `machine:${topMachineAttentionItem.id}`,
                                "dismiss",
                                topMachineAttentionItem.title,
                                topMachineAttentionItem.href,
                              )
                            }
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        What Changed Since Yesterday
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {yesterdayChangeItems.length ? (
                        yesterdayChangeItems.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.title}</div>
                              <Badge variant="outline">
                                {item.delta > 0 ? "+" : ""}
                                {item.delta}
                              </Badge>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.summary}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Yesterday-to-today movement is still too light to
                          summarize yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Food Trend Watch
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {foodTrendItems.length ? (
                        foodTrendItems.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">{item.label}</div>
                              <div className="flex gap-2">
                                <Badge variant="outline">
                                  {item.currentCount} now
                                </Badge>
                                <Badge variant="outline">
                                  {item.delta > 0 ? "+" : ""}
                                  {item.delta}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.summary}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No clear food trend movement is visible yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Promote Now</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {promoteNowItems.length ? (
                        promoteNowItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No immediate promotion opportunities are clear yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Demand Spikes</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {demandSpikeItems.length ? (
                        demandSpikeItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No clear demand spikes detected yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">Price Scout</CardTitle>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=json"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Export JSON
                          </a>
                          <a
                            href="/api/admin/lisa/price-scout-feed?hours=48&dealLimit=40&laneLimit=1000&format=csv"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Export CSV
                          </a>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {priceScoutSupplySummary ? (
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">
                            {priceScoutSupplySummary.totalRecentRecords} supply
                            records
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.snapshotCount} snapshots
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.alertCount} alerts
                          </Badge>
                          <Badge variant="outline">
                            {priceScoutSupplySummary.watchCount} watches
                          </Badge>
                        </div>
                      ) : null}
                      {priceScoutDeals.length ? (
                        priceScoutDeals.slice(0, 4).map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium">
                                {item.restaurantName}
                              </div>
                              <Badge variant="outline">
                                value {item.valueScore}
                              </Badge>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {item.title}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.priceSignal}
                              {item.cuisineType
                                ? ` in ${item.cuisineType}.`
                                : "."}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: Promote this offer, fold it into
                              advertiser packages, and use it as proof of local
                              value coverage.
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Price Scout needs more active deals before it can rank
                          value cleanly.
                        </div>
                      )}
                      {priceScoutSupplySpotlight.length ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            Supply lane spotlight
                          </div>
                          {priceScoutSupplySpotlight
                            .slice(0, 2)
                            .map((signal: any) => (
                              <div
                                key={`${signal.lane}:${signal.itemKey}:${signal.createdAt}`}
                                className="rounded-lg border px-3 py-2 text-xs"
                              >
                                <div className="font-medium">
                                  {signal.itemName}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {String(
                                    signal.signalType || "signal",
                                  ).replace(/_/g, " ")}{" "}
                                  in {signal.areaKey}
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Machine Attention
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {machineAttentionItems.length ? (
                        machineAttentionItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No meaningful outside machine attention is visible
                          yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Acquisition Targets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {acquisitionWatchItems.length ? (
                        acquisitionWatchItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No acquisition targets stand out yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Pages To Improve
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {authorityGapItems.length ? (
                        authorityGapItems.map((item: any) => (
                          <div
                            key={item.id}
                            className="rounded-lg border px-3 py-3 text-sm"
                          >
                            <div className="font-medium">{item.title}</div>
                            <div className="mt-2 text-muted-foreground">
                              Why it matters: {item.why}
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              What to do: {item.next}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No obvious authority gaps are showing yet.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Restaurants Tab */}
          <TabsContent value="restaurants" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Pending Restaurant Approvals</CardTitle>
              </CardHeader>
              <CardContent>
                {pendingRestaurants.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No pending approvals
                  </p>
                ) : (
                  <div className="space-y-3">
                    {pendingRestaurants.map((restaurant: PendingRestaurant) => (
                      <div
                        key={restaurant.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <div className="font-medium">{restaurant.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {restaurant.cuisineType} - {restaurant.email}
                          </div>
                        </div>
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              approveRestaurant.mutate(restaurant.id)
                            }
                            disabled={approveRestaurant.isPending}
                            data-testid={`button-approve-${restaurant.id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              rejectRestaurant.mutate(restaurant.id)
                            }
                            disabled={rejectRestaurant.isPending}
                            data-testid={`button-reject-${restaurant.id}`}
                          >
                            <XCircle className="w-4 h-4 mr-1" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
                <CardDescription>
                  View and manage all registered users
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Sorting affects the full user list.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search name, email, phone"
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    />
                    <select
                      value={userSortKey}
                      onChange={(e) =>
                        setUserSortKey(e.target.value as typeof userSortKey)
                      }
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="type">Sort by Type</option>
                      <option value="name">Sort by Name</option>
                      <option value="created">Sort by Created</option>
                    </select>
                    <select
                      value={userSortDir}
                      onChange={(e) =>
                        setUserSortDir(e.target.value as typeof userSortDir)
                      }
                      className="text-xs px-2 py-1 border rounded-md bg-background"
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                  </div>
                </div>

                <Tabs value={userTypeFilter} onValueChange={setUserTypeFilter}>
                  <TabsList className="mt-3 w-full justify-start overflow-x-auto flex-nowrap">
                    {userTypeTabs.map((tab) => {
                      const count =
                        tab.value === "all"
                          ? users.length
                          : (userCountsByType.get(tab.value) ?? 0);
                      return (
                        <TabsTrigger
                          key={tab.value}
                          value={tab.value}
                          className="whitespace-nowrap"
                        >
                          {tab.label}
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {count}
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>
                {duplicateEmailGroups.length > 0 && (
                  <div className="mt-4 rounded-lg border border-[color:var(--status-error)]/40 bg-[color:var(--status-error)]/5 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Duplicate Email Audit
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {duplicateEmailGroups.length} duplicate email group
                          {duplicateEmailGroups.length === 1 ? "" : "s"} found.
                          Keep the primary account and remove duplicate rows.
                        </p>
                      </div>
                      <Badge variant="destructive">
                        {duplicateEmailGroups.reduce(
                          (sum: number, group: any) =>
                            sum + group.duplicates.length,
                          0,
                        )}{" "}
                        duplicates
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {duplicateEmailGroups.slice(0, 20).map((group: any) => (
                        <div
                          key={group.normalizedEmail}
                          className="rounded-md border border-[color:var(--border-subtle)] bg-background p-2.5"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {group.normalizedEmail}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Primary: {group.primary?.firstName || ""}{" "}
                                {group.primary?.lastName || ""} (
                                {group.primary?.userType || "customer"}) · ID{" "}
                                {group.primary?.id}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedUser(group.primary);
                                setUserDetailsOpen(true);
                              }}
                            >
                              Details
                            </Button>
                          </div>
                          <div className="space-y-1.5">
                            {group.duplicates.map((dup: any) => (
                              <div
                                key={dup.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[color:var(--border-subtle)] p-2"
                              >
                                <p className="text-xs text-muted-foreground">
                                  {dup.firstName || ""} {dup.lastName || ""} ·{" "}
                                  {dup.userType || "customer"} · ID {dup.id}
                                </p>
                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedUser(dup);
                                      setUserDetailsOpen(true);
                                    }}
                                  >
                                    Details
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={deleteUser.isPending}
                                    onClick={() => {
                                      if (
                                        confirm(
                                          `Delete duplicate account ${dup.id} (${group.normalizedEmail})?`,
                                        )
                                      ) {
                                        deleteUser.mutate(dup.id);
                                      }
                                    }}
                                  >
                                    Delete Duplicate
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-3 mt-3">
                  {filteredUsers.map((user: any) => (
                    <div
                      key={user.id}
                      className="flex flex-col gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex-1">
                        <div className="font-medium">
                          {user.firstName} {user.lastName}
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </div>
                        {user.phone && (
                          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                            <Phone className="w-3 h-3" />
                            {user.phone}
                          </div>
                        )}
                        {user.postalCode && (
                          <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                            <MapPin className="w-3 h-3" />
                            {user.postalCode}
                          </div>
                        )}
                      </div>
                      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex flex-col gap-2">
                          <select
                            value={user.userType}
                            onChange={(e) =>
                              updateUserType.mutate({
                                userId: user.id,
                                userType: e.target.value,
                              })
                            }
                            className="text-xs px-2 py-1 border rounded-md"
                            disabled={updateUserType.isPending || isStaff}
                          >
                            <option value="customer">Customer</option>
                            <option value="food_truck">Food Truck</option>
                            <option value="restaurant_owner">
                              Restaurant Owner
                            </option>
                            <option value="host">Host</option>
                            <option value="event_coordinator">
                              Event Coordinator
                            </option>
                            <option value="staff">Staff</option>
                            {(adminUser?.userType === "admin" ||
                              adminUser?.userType === "super_admin") && (
                              <option value="admin">Admin</option>
                            )}
                            {adminUser?.userType === "super_admin" && (
                              <option value="super_admin">Super Admin</option>
                            )}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              resendVerificationEmail.mutate(user.id)
                            }
                            disabled={
                              resendVerificationEmail.isPending ||
                              isStaff ||
                              !user.email ||
                              user.emailVerified
                            }
                            data-testid={`button-resend-verify-${user.id}`}
                          >
                            <Mail className="w-3 h-3 mr-1" />
                            {user.emailVerified ? "Verified" : "Resend Verify"}
                          </Button>
                          {isAdminOrSuper && !user.emailVerified && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => verifyUserEmail.mutate(user.id)}
                              disabled={verifyUserEmail.isPending}
                              data-testid={`button-verify-user-${user.id}`}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Auto Verify
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => sendSubscriptionLink.mutate(user.id)}
                            disabled={
                              sendSubscriptionLink.isPending ||
                              isStaff ||
                              !user.email ||
                              !["restaurant_owner", "food_truck"].includes(
                                user.userType,
                              )
                            }
                            data-testid={`button-send-subscription-${user.id}`}
                          >
                            <DollarSign className="w-3 h-3 mr-1" />
                            Send Monthly Link
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedUser(user);
                            setUserDetailsOpen(true);
                          }}
                          data-testid={`button-view-user-${user.id}`}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Details
                        </Button>
                        {!isStaff && (
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={!user.isDisabled}
                              onCheckedChange={(checked) =>
                                toggleUserStatus.mutate({
                                  userId: user.id,
                                  isActive: checked,
                                })
                              }
                              data-testid={`switch-user-${user.id}`}
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Are you sure you want to permanently delete ${user.firstName} ${user.lastName}? This cannot be undone.`,
                                  )
                                ) {
                                  deleteUser.mutate(user.id);
                                }
                              }}
                              disabled={deleteUser.isPending}
                            >
                              <UserMinus className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Staff Tab (Admin Only) */}
          <TabsContent value="staff" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Staff Management</CardTitle>
                <CardDescription>
                  Promote users to staff role or remove staff access
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StaffManagementTab />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Deals Tab */}
          <TabsContent value="deals" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Deal Management</CardTitle>
                <CardDescription>
                  View, edit, and manage all deals
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {deals.map((deal: any) => (
                    <div
                      key={deal.id}
                      className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="font-medium text-lg">
                            {deal.title}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {deal.restaurant?.name} - {deal.discountValue}% off
                            - Ends {new Date(deal.endDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={deal.isActive ? "default" : "secondary"}
                          >
                            {deal.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {deal.isFeatured && (
                            <Badge variant="outline">Featured</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Activity className="w-4 h-4" />
                            {deal.currentUses || 0} uses
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {deal.startTime} - {deal.endTime}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedDeal(deal);
                              setDealDetailsOpen(true);
                            }}
                            data-testid={`button-view-deal-${deal.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Details
                          </Button>

                          <Link href={`/deal-edit/${deal.id}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-edit-deal-${deal.id}`}
                            >
                              <Settings className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                          </Link>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cloneDeal.mutate(deal.id)}
                            disabled={cloneDeal.isPending}
                            data-testid={`button-clone-deal-${deal.id}`}
                          >
                            <Package className="w-4 h-4 mr-1" />
                            Clone
                          </Button>

                          <Switch
                            checked={deal.isActive}
                            onCheckedChange={(checked) =>
                              toggleDealStatus.mutate({
                                dealId: deal.id,
                                isActive: checked,
                              })
                            }
                            data-testid={`switch-deal-active-${deal.id}`}
                          />

                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Are you sure you want to delete this deal? This action cannot be undone.",
                                )
                              ) {
                                deleteDeal.mutate(deal.id);
                              }
                            }}
                            disabled={deleteDeal.isPending}
                            data-testid={`button-delete-deal-${deal.id}`}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Verifications Tab */}
          <TabsContent value="verifications" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Business Verification Requests</span>
                </CardTitle>
                <CardDescription>
                  Review and approve restaurant verification documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingVerifications ? (
                  <div className="flex items-center justify-center p-8">
                    <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : verificationRequests.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground">
                    <Shield className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No verification requests found</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {verificationRequests.map((request: any) => (
                      <div key={request.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-lg">
                              {request.restaurant?.name}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {request.restaurant?.address}
                            </p>
                          </div>
                          <Badge
                            variant={
                              request.status === "pending"
                                ? "secondary"
                                : request.status === "approved"
                                  ? "default"
                                  : "destructive"
                            }
                            className="flex items-center space-x-1"
                          >
                            {request.status === "pending" && (
                              <Clock className="w-3 h-3" />
                            )}
                            {request.status === "approved" && (
                              <CheckCircle className="w-3 h-3" />
                            )}
                            {request.status === "rejected" && (
                              <XCircle className="w-3 h-3" />
                            )}
                            <span className="capitalize">{request.status}</span>
                          </Badge>
                        </div>

                        <div className="mb-4">
                          <p className="text-sm text-muted-foreground mb-2">
                            Submitted:{" "}
                            {new Date(request.submittedAt).toLocaleDateString()}
                          </p>
                          {request.documents &&
                            request.documents.length > 0 && (
                              <div>
                                <p className="text-sm font-medium mb-2">
                                  Documents ({request.documents.length}):
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {request.documents.map(
                                    (doc: string, index: number) => (
                                      <div key={index} className="relative">
                                        {doc.startsWith("data:image") ? (
                                          <img
                                            src={doc}
                                            alt={`Document ${index + 1}`}
                                            className="w-20 h-20 object-cover rounded cursor-pointer border"
                                            onClick={() =>
                                              window.open(doc, "_blank")
                                            }
                                            data-testid={`img-document-${request.id}-${index}`}
                                          />
                                        ) : (
                                          <div
                                            className="w-20 h-20 bg-[var(--bg-surface-muted)] rounded flex items-center justify-center cursor-pointer border"
                                            onClick={() =>
                                              window.open(doc, "_blank")
                                            }
                                            data-testid={`doc-document-${request.id}-${index}`}
                                          >
                                            <i className="fas fa-file-pdf text-2xl text-[color:var(--status-error)]"></i>
                                          </div>
                                        )}
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>

                        {request.rejectionReason && (
                          <div className="mb-4 p-3 bg-destructive/10 rounded-md">
                            <p className="text-sm font-medium text-destructive mb-1">
                              Rejection Reason:
                            </p>
                            <p className="text-sm text-destructive">
                              {request.rejectionReason}
                            </p>
                          </div>
                        )}

                        {request.status === "pending" && (
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() =>
                                approveVerification.mutate(request.id)
                              }
                              disabled={approveVerification.isPending}
                              data-testid={`button-approve-verification-${request.id}`}
                              className="flex items-center space-x-1"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>Approve</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                const reason = window.prompt(
                                  "Please provide a reason for rejection:",
                                );
                                if (reason && reason.trim()) {
                                  rejectVerification.mutate({
                                    requestId: request.id,
                                    reason: reason.trim(),
                                  });
                                }
                              }}
                              disabled={rejectVerification.isPending}
                              data-testid={`button-reject-verification-${request.id}`}
                              className="flex items-center space-x-1"
                            >
                              <XCircle className="w-4 h-4" />
                              <span>Reject</span>
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manual Onboarding Tab */}
          <TabsContent value="onboarding" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* Create User Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Create Account
                  </CardTitle>
                  <CardDescription>
                    Manually onboard a new diner, truck, restaurant, supplier,
                    host, or event organizer account. We'll email a setup link
                    so they can finish their profile and set a password.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ManualUserCreation adminUser={adminUser} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    Post Event As Organizer
                  </CardTitle>
                  <CardDescription>
                    Use the same event organizer flow users get. This is the
                    shared posting path for phone support and manual posting.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Link href="/admin/events">
                    <Button className="w-full">Open Events Portal</Button>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Admin posting uses the same form, validations, and event
                    lifecycle as event organizers.
                  </p>
                </CardContent>
              </Card>

              <TruckImportPanel enabled={selectedTab === "onboarding"} />
            </div>
          </TabsContent>

          {/* Admin Uploads Tab */}
          <TabsContent value="imports" className="space-y-4">
            <UnclaimedImportedTrucksTab enabled={selectedTab === "imports"} />
          </TabsContent>

          {/* Host Locations Tab */}
          <TabsContent value="host-locations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Manage Host Locations
                </CardTitle>
                <CardDescription>
                  View and update geocoded locations for existing hosts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HostLocationManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="share-portal" className="space-y-4">
            <ShareHub
              mode="admin"
              title="Share Portal"
              description="One-click growth and onboarding links for owners, food trucks, and host-location partners."
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* User Details Dialog */}
      <Dialog open={userDetailsOpen} onOpenChange={setUserDetailsOpen}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Users className="w-5 h-5" />
              <span>User Details</span>
            </DialogTitle>
            <DialogDescription>
              Complete profile information and activity details
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6 mt-4">
              {/* Edit User */}
              {!isStaff && userEdits && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Settings className="w-4 h-4 mr-2" />
                    EDIT USER
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <input
                        type="email"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.email}
                        onChange={(e) =>
                          setUserEdits({ ...userEdits, email: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">User Type</p>
                      <select
                        className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                        value={userEdits.userType}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            userType: e.target.value,
                          })
                        }
                      >
                        <option value="customer">Customer</option>
                        <option value="food_truck">Food Truck</option>
                        <option value="restaurant_owner">
                          Restaurant Owner
                        </option>
                        <option value="host">Host</option>
                        <option value="event_coordinator">
                          Event Coordinator
                        </option>
                        <option value="staff">Staff</option>
                        {(adminUser?.userType === "admin" ||
                          adminUser?.userType === "super_admin") && (
                          <option value="admin">Admin</option>
                        )}
                        {adminUser?.userType === "super_admin" && (
                          <option value="super_admin">Super Admin</option>
                        )}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        First Name
                      </p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.firstName}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            firstName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Last Name</p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.lastName}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            lastName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.phone}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            phone: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Postal Code
                      </p>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.postalCode}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            postalCode: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Birth Year
                      </p>
                      <input
                        type="number"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={userEdits.birthYear}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            birthYear: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Gender</p>
                      <select
                        className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                        value={userEdits.gender}
                        onChange={(e) =>
                          setUserEdits({
                            ...userEdits,
                            gender: e.target.value,
                          })
                        }
                      >
                        <option value="">Unspecified</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="non_binary">Non-binary</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Active
                      </label>
                      <Switch
                        checked={!!userEdits.isActive}
                        onCheckedChange={(checked) =>
                          setUserEdits({ ...userEdits, isActive: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        Email Verified
                      </label>
                      <Switch
                        checked={!!userEdits.emailVerified}
                        onCheckedChange={(checked) =>
                          setUserEdits({
                            ...userEdits,
                            emailVerified: checked,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateUserInfo.mutate({
                          userId: selectedUser.id,
                          updates: userEdits,
                        })
                      }
                      disabled={updateUserInfo.isPending || isStaff}
                      data-testid="button-save-user"
                    >
                      Save User Changes
                    </Button>
                  </div>
                </div>
              )}
              {/* Basic Information */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Users className="w-4 h-4 mr-2" />
                  BASIC INFORMATION
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Full Name</p>
                    <p className="font-medium">
                      {selectedUser.firstName} {selectedUser.lastName}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">User Type</p>
                    <Badge
                      variant={
                        selectedUser.userType === "admin"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {selectedUser.userType}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {selectedUser.email}
                    </p>
                  </div>
                  {selectedUser.affiliateTag && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Affiliate Tag
                      </p>
                      <p className="text-sm font-mono text-xs">
                        {selectedUser.affiliateTag}
                      </p>
                    </div>
                  )}
                  {(selectedUser.affiliateCloserUserId ||
                    selectedUser.affiliateBookerUserId) && (
                    <div className="space-y-1 col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Referral Attribution
                      </p>
                      <div className="text-sm space-y-1">
                        {selectedUser.affiliateCloserUserId && (
                          <div>
                            <span className="text-xs text-muted-foreground">
                              Ref link (closer):{" "}
                            </span>
                            {(() => {
                              const ref = userById.get(
                                String(selectedUser.affiliateCloserUserId),
                              );
                              const label = ref
                                ? `${ref.firstName || ""} ${ref.lastName || ""}`.trim() ||
                                  ref.email ||
                                  ref.id
                                : String(selectedUser.affiliateCloserUserId);
                              const tag = ref?.affiliateTag
                                ? ` (ref=${ref.affiliateTag})`
                                : "";
                              return (
                                <span>
                                  {label}
                                  {tag}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                        {selectedUser.affiliateBookerUserId && (
                          <div>
                            <span className="text-xs text-muted-foreground">
                              Booker affiliate:{" "}
                            </span>
                            {(() => {
                              const ref = userById.get(
                                String(selectedUser.affiliateBookerUserId),
                              );
                              const label = ref
                                ? `${ref.firstName || ""} ${ref.lastName || ""}`.trim() ||
                                  ref.email ||
                                  ref.id
                                : String(selectedUser.affiliateBookerUserId);
                              const tag = ref?.affiliateTag
                                ? ` (ref=${ref.affiliateTag})`
                                : "";
                              return (
                                <span>
                                  {label}
                                  {tag}
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedUser.phone && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="text-sm flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {selectedUser.phone}
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Email Verified
                    </p>
                    <Badge
                      variant={
                        selectedUser.emailVerified ? "default" : "secondary"
                      }
                    >
                      {selectedUser.emailVerified ? "Verified" : "Not Verified"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Account Status
                    </p>
                    <Badge
                      variant={
                        !selectedUser.isDisabled ? "default" : "destructive"
                      }
                    >
                      {!selectedUser.isDisabled ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Location & Demographics */}
              {(selectedUser.postalCode ||
                selectedUser.birthYear ||
                selectedUser.gender) && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    LOCATION & DEMOGRAPHICS
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedUser.postalCode && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Postal Code
                        </p>
                        <p className="text-sm flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {selectedUser.postalCode}
                        </p>
                      </div>
                    )}
                    {selectedUser.birthYear && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Birth Year
                        </p>
                        <p className="text-sm">{selectedUser.birthYear}</p>
                      </div>
                    )}
                    {selectedUser.gender && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Gender</p>
                        <p className="text-sm capitalize">
                          {selectedUser.gender}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subscription Information */}
              {(selectedUser.stripeCustomerId ||
                selectedUser.stripeSubscriptionId) && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <CreditCard className="w-4 h-4 mr-2" />
                    SUBSCRIPTION
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedUser.stripeCustomerId && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Stripe Customer ID
                        </p>
                        <p className="text-sm font-mono text-xs">
                          {selectedUser.stripeCustomerId}
                        </p>
                      </div>
                    )}
                    {selectedUser.stripeSubscriptionId && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Subscription ID
                        </p>
                        <p className="text-sm font-mono text-xs">
                          {selectedUser.stripeSubscriptionId}
                        </p>
                      </div>
                    )}
                    {selectedUser.subscriptionBillingInterval && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Billing Interval
                        </p>
                        <Badge variant="outline">
                          {selectedUser.subscriptionBillingInterval}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Authentication Methods */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Shield className="w-4 h-4 mr-2" />
                  AUTHENTICATION METHODS
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedUser.googleId && (
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Google OAuth
                    </Badge>
                  )}
                  {selectedUser.facebookId && (
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Facebook OAuth
                    </Badge>
                  )}
                  {selectedUser.passwordHash && (
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" />
                      Email/Password
                    </Badge>
                  )}
                </div>
              </div>

              {/* Account Activity */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-2" />
                  ACCOUNT ACTIVITY
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Account Created
                    </p>
                    <p className="text-sm">
                      {new Date(selectedUser.createdAt).toLocaleDateString(
                        "en-US",
                        {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        },
                      )}
                    </p>
                  </div>
                  {selectedUser.updatedAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Last Updated
                      </p>
                      <p className="text-sm">
                        {new Date(selectedUser.updatedAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Saved Addresses */}
              {selectedUser?.userType !== "host" && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    SAVED ADDRESSES ({userAddresses.length})
                  </h3>
                  <div className="space-y-3">
                    {userAddresses.map((address: any) => {
                      const edits = addressEdits[address.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={address.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="capitalize">
                                {address.type}
                              </Badge>
                              {address.isDefault && (
                                <Badge variant="default" className="text-xs">
                                  Default
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setDefaultAddress.mutate({
                                    userId: selectedUser.id,
                                    addressId: address.id,
                                  })
                                }
                                disabled={isStaff}
                              >
                                Set Default
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  deleteAddress.mutate({
                                    userId: selectedUser.id,
                                    addressId: address.id,
                                  })
                                }
                                disabled={isStaff}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Label"
                              value={edits.label}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    label: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.type}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    type: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="home">Home</option>
                              <option value="work">Work</option>
                              <option value="other">Other</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Address"
                              value={edits.address}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    address: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="City"
                              value={edits.city}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    city: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="State"
                              value={edits.state}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    state: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Postal Code"
                              value={edits.postalCode}
                              onChange={(e) =>
                                setAddressEdits({
                                  ...addressEdits,
                                  [address.id]: {
                                    ...edits,
                                    postalCode: e.target.value,
                                  },
                                })
                              }
                            />
                          </div>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateAddress.mutate({
                                  userId: selectedUser.id,
                                  addressId: address.id,
                                  updates: edits,
                                })
                              }
                              disabled={isStaff}
                            >
                              Save Address
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="border rounded-lg p-3 space-y-3">
                      <div className="text-sm font-medium">Add New Address</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Label"
                          value={newAddress.label}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              label: e.target.value,
                            })
                          }
                        />
                        <select
                          className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                          value={newAddress.type}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              type: e.target.value,
                            })
                          }
                        >
                          <option value="home">Home</option>
                          <option value="work">Work</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Address"
                          value={newAddress.address}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              address: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="City"
                          value={newAddress.city}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              city: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="State"
                          value={newAddress.state}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              state: e.target.value,
                            })
                          }
                        />
                        <input
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          placeholder="Postal Code"
                          value={newAddress.postalCode}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              postalCode: e.target.value,
                            })
                          }
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={newAddress.isDefault}
                          onChange={(e) =>
                            setNewAddress({
                              ...newAddress,
                              isDefault: e.target.checked,
                            })
                          }
                        />
                        Set as default
                      </label>
                      <Button
                        size="sm"
                        onClick={() =>
                          createAddress.mutate({
                            userId: selectedUser.id,
                            data: newAddress,
                          })
                        }
                        disabled={createAddress.isPending || isStaff}
                      >
                        Add Address
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {(selectedUser?.userType === "host" || userHosts.length > 0) && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  Parking Pass + Host Location editing lives in the{" "}
                  <span className="font-semibold">Host Locations</span> tab.
                </div>
              )}

              {/* Restaurants */}
              {userRestaurants.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Store className="w-4 h-4 mr-2" />
                    RESTAURANTS ({userRestaurants.length})
                  </h3>
                  <div className="space-y-4">
                    {userRestaurants.map((restaurant: any) => {
                      const edits = restaurantEdits[restaurant.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={restaurant.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="text-sm font-medium">
                            {restaurant.name}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.name}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    name: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.address}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    address: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Phone"
                              value={edits.phone}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    phone: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Cuisine Type"
                              value={edits.cuisineType}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    cuisineType: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.businessType}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    businessType: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="restaurant">Restaurant</option>
                              <option value="bar">Bar</option>
                              <option value="food_truck">Food Truck</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Promo Code"
                              value={edits.promoCode}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    promoCode: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="City"
                              value={edits.city}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    city: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="State"
                              value={edits.state}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    state: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Description"
                              value={edits.description}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    description: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Website URL"
                              value={edits.websiteUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    websiteUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Instagram URL"
                              value={edits.instagramUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    instagramUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Facebook Page URL"
                              value={edits.facebookPageUrl}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    facebookPageUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Amenities JSON"
                              value={edits.amenitiesText}
                              onChange={(e) =>
                                setRestaurantEdits({
                                  ...restaurantEdits,
                                  [restaurant.id]: {
                                    ...edits,
                                    amenitiesText: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isActive}
                                onChange={(e) =>
                                  setRestaurantEdits({
                                    ...restaurantEdits,
                                    [restaurant.id]: {
                                      ...edits,
                                      isActive: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Active
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isVerified}
                                onChange={(e) =>
                                  setRestaurantEdits({
                                    ...restaurantEdits,
                                    [restaurant.id]: {
                                      ...edits,
                                      isVerified: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Verified
                            </label>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              let amenities: any = undefined;
                              if (edits.amenitiesText) {
                                try {
                                  amenities = JSON.parse(edits.amenitiesText);
                                } catch {
                                  toast({
                                    title: "Invalid JSON",
                                    description:
                                      "Amenities must be valid JSON.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                              }
                              updateRestaurant.mutate({
                                restaurantId: restaurant.id,
                                updates: {
                                  ...edits,
                                  amenities,
                                },
                              });
                            }}
                            disabled={isStaff}
                          >
                            Save Restaurant
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deals */}
              {userDeals.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <DollarSign className="w-4 h-4 mr-2" />
                    DEALS ({userDeals.length})
                  </h3>
                  <div className="space-y-4">
                    {userDeals.map((deal: any) => {
                      const edits = dealEdits[deal.id];
                      if (!edits) return null;
                      return (
                        <div
                          key={deal.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="text-sm font-medium">
                            {deal.title}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.title}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    title: e.target.value,
                                  },
                                })
                              }
                            />
                            <select
                              className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                              value={edits.dealType}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    dealType: e.target.value,
                                  },
                                })
                              }
                            >
                              <option value="percentage">Percentage</option>
                              <option value="fixed">Fixed</option>
                            </select>
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Discount Value"
                              value={edits.discountValue}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    discountValue: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Min Order Amount"
                              value={edits.minOrderAmount}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    minOrderAmount: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              placeholder="Image URL"
                              value={edits.imageUrl}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    imageUrl: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="date"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.startDate}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    startDate: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="date"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.endDate}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    endDate: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="time"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.startTime}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    startTime: e.target.value,
                                  },
                                })
                              }
                            />
                            <input
                              type="time"
                              className="w-full px-2 py-1 border rounded-md text-sm"
                              value={edits.endTime}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    endTime: e.target.value,
                                  },
                                })
                              }
                            />
                            <textarea
                              className="w-full px-2 py-1 border rounded-md text-sm sm:col-span-2"
                              placeholder="Description"
                              value={edits.description}
                              onChange={(e) =>
                                setDealEdits({
                                  ...dealEdits,
                                  [deal.id]: {
                                    ...edits,
                                    description: e.target.value,
                                  },
                                })
                              }
                            />
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.availableDuringBusinessHours}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      availableDuringBusinessHours:
                                        e.target.checked,
                                    },
                                  })
                                }
                              />
                              Business Hours Only
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isOngoing}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      isOngoing: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Ongoing
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={edits.isActive}
                                onChange={(e) =>
                                  setDealEdits({
                                    ...dealEdits,
                                    [deal.id]: {
                                      ...edits,
                                      isActive: e.target.checked,
                                    },
                                  })
                                }
                              />
                              Active
                            </label>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateDeal.mutate({
                                dealId: deal.id,
                                updates: edits,
                              })
                            }
                            disabled={isStaff}
                          >
                            Save Deal
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Profile Image */}
              {selectedUser.profileImageUrl && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <Users className="w-4 h-4 mr-2" />
                    PROFILE IMAGE
                  </h3>
                  <img
                    src={getOptimizedImageUrl(
                      selectedUser.profileImageUrl,
                      "large",
                    )}
                    alt="Profile"
                    className="w-24 h-24 rounded-full object-cover border-2"
                    data-testid="img-user-profile"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              {/* Parking Pass Listings */}
              {parkingPasses.length > 0 && userHosts.length === 0 && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 mr-2" />
                    PARKING PASS LISTINGS ({parkingPasses.length})
                  </h3>
                  <div className="space-y-4">
                    {parkingPasses.map((pass: any) => {
                      const edits = parkingPassEdits[pass.id];
                      if (!edits) return null;
                      const hostName =
                        pass.host?.businessName ?? pass.name ?? "Parking Pass";
                      const nextDate = pass.nextDate ?? pass.date;
                      return (
                        <div
                          key={pass.id}
                          className="border rounded-lg p-3 bg-muted/30 space-y-3"
                        >
                          <div className="text-sm font-medium">{hostName}</div>
                          <div className="text-xs text-muted-foreground">
                            Applies to all upcoming dates
                            {nextDate
                              ? ` Â· Next date ${new Date(
                                  nextDate,
                                ).toLocaleDateString()}`
                              : ""}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Start Time
                              </p>
                              <input
                                type="time"
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.startTime}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      startTime: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                End Time
                              </p>
                              <input
                                type="time"
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.endTime}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      endTime: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Max Trucks
                              </p>
                              <input
                                type="number"
                                min={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={edits.maxTrucks}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      maxTrucks: e.target.value,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Status
                              </p>
                              <select
                                className="w-full px-2 py-1 border rounded-md text-sm bg-background"
                                value={edits.status}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      status: e.target.value,
                                    },
                                  })
                                }
                              >
                                <option value="open">Open</option>
                                <option value="booked">Booked</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="completed">Completed</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Breakfast ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.breakfastPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    breakfastPriceCents: toCents(
                                      e.target.value,
                                    ),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Lunch ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.lunchPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    lunchPriceCents: toCents(e.target.value),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Dinner ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.dinnerPriceCents)}
                                onChange={(e) => {
                                  const next = applyListingDailyAutoIfAllowed({
                                    ...edits,
                                    dinnerPriceCents: toCents(e.target.value),
                                  });
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: next,
                                  });
                                }}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Daily ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.dailyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      dailyPriceCents: toCents(e.target.value),
                                      weeklyPriceCents:
                                        edits._weeklyManuallyEdited
                                          ? Number(edits.weeklyPriceCents || 0)
                                          : toCents(e.target.value) * 7,
                                      monthlyPriceCents:
                                        edits._monthlyManuallyEdited
                                          ? Number(edits.monthlyPriceCents || 0)
                                          : toCents(e.target.value) * 30,
                                      _dailyManuallyEdited: true,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Weekly ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.weeklyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      weeklyPriceCents: toCents(e.target.value),
                                      _weeklyManuallyEdited:
                                        toCents(e.target.value) > 0,
                                    },
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">
                                Monthly ($)
                              </p>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="w-full px-2 py-1 border rounded-md text-sm"
                                value={toDollars(edits.monthlyPriceCents)}
                                onChange={(e) =>
                                  setParkingPassEdits({
                                    ...parkingPassEdits,
                                    [pass.id]: {
                                      ...edits,
                                      monthlyPriceCents: toCents(
                                        e.target.value,
                                      ),
                                      _monthlyManuallyEdited:
                                        toCents(e.target.value) > 0,
                                    },
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateParkingPass.mutate({
                                  eventId: pass.id,
                                  updates: edits,
                                })
                              }
                              disabled={updateParkingPass.isPending}
                              data-testid={`button-save-parking-pass-${pass.id}`}
                            >
                              Save Parking Pass
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Danger Zone - Super Admin Only */}
              {adminUser?.userType === "super_admin" && (
                <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
                  <h3 className="font-semibold mb-2 text-destructive flex items-center">
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Danger Zone
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Permanently delete this user account. This action cannot be
                    undone and will remove all associated data.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Are you absolutely sure you want to delete ${selectedUser.email}? This will permanently delete the account and all associated data. This action cannot be undone.`,
                        )
                      ) {
                        deleteUser.mutate(selectedUser.id);
                      }
                    }}
                    disabled={deleteUser.isPending}
                  >
                    <UserMinus className="w-4 h-4 mr-1" />
                    Delete User Permanently
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deal Details Dialog */}
      <Dialog open={dealDetailsOpen} onOpenChange={setDealDetailsOpen}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Package className="w-5 h-5" />
              <span>Deal Details & Performance</span>
            </DialogTitle>
            <DialogDescription>
              Comprehensive information and analytics for this deal
            </DialogDescription>
          </DialogHeader>

          {selectedDeal && (
            <div className="space-y-6 mt-4">
              {/* Deal Information */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Package className="w-4 h-4 mr-2" />
                  DEAL INFORMATION
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Title</p>
                    <p className="font-medium text-lg">{selectedDeal.title}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="text-sm">{selectedDeal.description}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Restaurant</p>
                    <p className="font-medium">
                      {selectedDeal.restaurant?.name}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Discount</p>
                    <p className="font-medium">
                      {selectedDeal.discountValue}% off
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Validity Period
                    </p>
                    <p className="text-sm">
                      {new Date(selectedDeal.startDate).toLocaleDateString()} -{" "}
                      {new Date(selectedDeal.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Time Window</p>
                    <p className="text-sm">
                      {selectedDeal.startTime} - {selectedDeal.endTime}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge
                      variant={selectedDeal.isActive ? "default" : "secondary"}
                    >
                      {selectedDeal.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Featured</p>
                    <Badge
                      variant={selectedDeal.isFeatured ? "default" : "outline"}
                    >
                      {selectedDeal.isFeatured ? "Yes" : "No"}
                    </Badge>
                  </div>
                  {selectedDeal.totalUsesLimit && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Total Uses Limit
                      </p>
                      <p className="text-sm">
                        {selectedDeal.currentUses} /{" "}
                        {selectedDeal.totalUsesLimit}
                      </p>
                    </div>
                  )}
                  {selectedDeal.perCustomerLimit && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Per Customer Limit
                      </p>
                      <p className="text-sm">{selectedDeal.perCustomerLimit}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Performance Metrics */}
              {dealStats && (
                <div>
                  <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    PERFORMANCE METRICS
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.views || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total Views
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.claims || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total Claims
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="text-2xl font-bold">
                          {dealStats.views > 0
                            ? (
                                (dealStats.claims / dealStats.views) *
                                100
                              ).toFixed(1)
                            : 0}
                          %
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Conversion Rate
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {dealStats.averageRating > 0 && (
                    <div className="mt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm font-medium">Average Rating</p>
                        <Badge variant="outline">
                          {dealStats.averageRating.toFixed(1)} / 5.0
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Based on {dealStats.totalFeedback} reviews
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Quick Actions */}
              <div>
                <h3 className="font-semibold mb-3 flex items-center text-sm text-muted-foreground">
                  <Settings className="w-4 h-4 mr-2" />
                  QUICK ACTIONS
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Extend Deal Duration
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        value={extendDays}
                        onChange={(e) =>
                          setExtendDays(parseInt(e.target.value) || 1)
                        }
                        className="w-20 px-2 py-1 border rounded text-sm"
                        placeholder="Days"
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          extendDeal.mutate({
                            dealId: selectedDeal.id,
                            days: extendDays,
                          })
                        }
                        disabled={extendDeal.isPending}
                      >
                        Extend by {extendDays} days
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Deal Actions
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDealDetailsOpen(false);
                          window.location.href = `/deal-edit/${selectedDeal.id}`;
                        }}
                      >
                        <Settings className="w-4 h-4 mr-1" />
                        Edit Deal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          cloneDeal.mutate(selectedDeal.id);
                          setDealDetailsOpen(false);
                        }}
                        disabled={cloneDeal.isPending}
                      >
                        <Package className="w-4 h-4 mr-1" />
                        Clone
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
                <h3 className="font-semibold mb-2 text-destructive flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Danger Zone
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Permanently delete this deal. This action cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Are you absolutely sure? This will permanently delete the deal and all associated data.",
                      )
                    ) {
                      deleteDeal.mutate(selectedDeal.id);
                    }
                  }}
                  disabled={deleteDeal.isPending}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Delete Deal Permanently
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Navigation />
    </div>
  );
}
