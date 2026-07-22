import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Truck } from "lucide-react";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";

type ClaimRow = {
  id: string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  externalId?: string | null;
  confidenceScore?: number | null;
  invited?: boolean;
  hasEmail?: boolean;
  canClaim?: boolean;
  canRequest?: boolean;
  requestCooldownMinutes?: number;
};

type PlaceSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
  _sessionToken?: string;
};

type PlaceDetailsResult = {
  placeId: string;
  formattedAddress: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
};

export default function ClaimTruckPage() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [missingBusinessQuery, setMissingBusinessQuery] = useState("");
  const [missingBusinessLoading, setMissingBusinessLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [rows, setRows] = useState<ClaimRow[]>([]);

  const normalizedQuery = useMemo(() => query.trim(), [query]);

  const handleSearch = async () => {
    const q = normalizedQuery;
    if (!q) {
      setRows([]);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await apiRequest(
        "GET",
        `/api/truck-claims/public-search?q=${encodeURIComponent(q)}`,
      );
      const data = await res.json().catch(() => []);
      const next = Array.isArray(data) ? data : [];
      setRows(next);
      if (next.length === 0) {
        setError(
          "No matching trucks found. Try a shorter name or the license/external ID.",
        );
      }
    } catch (err: any) {
      setError(err?.message || "Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRequest = async (listingId: string) => {
    setRequestingId(listingId);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/truck-claims/request", {
        listingId,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = String(data?.message || "Request failed");
        if (res.status === 429 && typeof data?.cooldownMinutes === "number") {
          toast({
            title: "Already sent recently",
            description: `Try again in about ${data.cooldownMinutes} minutes.`,
            variant: "destructive",
          });
          return;
        }
        throw new Error(message);
      }

      if (data?.hadEmail === false) {
        toast({
          title: "No email on file",
          description: "Ask an admin to add an email, or claim it manually.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: data?.emailSent
          ? "Email sent to owner"
          : "Email could not be sent",
        description: data?.emailSent
          ? "We sent them a link to finish setting up their account."
          : "An admin should check Email Delivery in the dashboard.",
        variant: data?.emailSent ? "default" : "destructive",
      });

      // Refresh cooldown/status display.
      await handleSearch();
    } catch (err: any) {
      setError(err?.message || "Request failed.");
    } finally {
      setRequestingId(null);
    }
  };

  const goToClaimFlow = (row: ClaimRow) => {
    const q = String(row.externalId || row.name || "").trim();
    const next = `/restaurant-signup?businessType=food_truck&claim=1${q ? `&q=${encodeURIComponent(q)}` : ""}`;
    setLocation(next);
  };

  const goToMissingBusinessFlow = (
    suggestion: PlaceSuggestion,
    place: PlaceDetailsResult,
  ) => {
    const params = new URLSearchParams({
      businessType: "food_truck",
      claim: "1",
      claimMode: "missing",
      q: suggestion.mainText || suggestion.text,
      prefillName: suggestion.mainText || suggestion.text,
      prefillAddress: place.formattedAddress || suggestion.text,
      prefillCity: place.city || "",
      prefillState: place.state || "",
      prefillPlaceId: place.placeId || suggestion.placeId,
    });

    if (typeof place.latitude === "number") {
      params.set("prefillLat", String(place.latitude));
    }
    if (typeof place.longitude === "number") {
      params.set("prefillLng", String(place.longitude));
    }

    setLocation(`/restaurant-signup?${params.toString()}`);
  };

  const handleMissingBusinessSelect = async (suggestion: PlaceSuggestion) => {
    setMissingBusinessLoading(true);
    setError("");
    try {
      const detailUrl = new URL(
        `/api/map/place-details/${encodeURIComponent(suggestion.placeId)}`,
        window.location.origin,
      );
      if (suggestion._sessionToken) {
        detailUrl.searchParams.set("sessionToken", suggestion._sessionToken);
      }

      const res = await fetch(detailUrl.toString(), { credentials: "include" });
      if (!res.ok) {
        throw new Error("Could not load place details");
      }

      const data = await res.json().catch(() => ({}));
      const place = (data?.place || {}) as PlaceDetailsResult;
      goToMissingBusinessFlow(suggestion, {
        placeId: place.placeId || suggestion.placeId,
        formattedAddress: place.formattedAddress || suggestion.text,
        city: place.city || "",
        state: place.state || "",
        latitude: typeof place.latitude === "number" ? place.latitude : null,
        longitude: typeof place.longitude === "number" ? place.longitude : null,
      });
    } catch (err: any) {
      setError(err?.message || "Could not use selected business. Try again.");
    } finally {
      setMissingBusinessLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <BackHeader
        title="Claim a Business"
        fallbackHref="/"
        icon={Truck}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-6">
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardHeader>
            <CardTitle>Find your business</CardTitle>
            <CardDescription>
              Search by name, license/external ID, city, or state. If your
              profile is unclaimed, you can claim it or request a setup
              reminder.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Tacos, DBPR-12345, Austin"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
              />
              <Button
                variant="outline"
                onClick={handleSearch}
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </Button>
            </div>

            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : null}

            {rows.length > 0 ? (
              <div className="space-y-2">
                {rows.slice(0, 15).map((row) => {
                  const cooldown = Number(row.requestCooldownMinutes || 0);
                  const canRequest = Boolean(row.canRequest && cooldown === 0);
                  const canClaim = Boolean(row.canClaim);
                  return (
                    <div
                      key={row.id}
                      className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-semibold truncate">
                              {row.name || "Unnamed truck"}
                            </div>
                            {row.invited ? (
                              <Badge variant="secondary">Invited</Badge>
                            ) : null}
                            {row.hasEmail ? (
                              <Badge variant="outline">Email on file</Badge>
                            ) : (
                              <Badge variant="destructive">No email</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {row.address || ""}
                            {row.city ? `, ${row.city}` : ""}
                            {row.state ? `, ${row.state}` : ""}
                          </div>
                          {cooldown > 0 ? (
                            <div className="text-xs text-muted-foreground">
                              Reminder recently sent. Try again in about{" "}
                              {cooldown} minutes.
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => goToClaimFlow(row)}
                            disabled={!canClaim}
                          >
                            {isAuthenticated ? "Claim" : "Sign in to claim"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRequest(row.id)}
                            disabled={!canRequest || requestingId === row.id}
                          >
                            {requestingId === row.id
                              ? "Requesting..."
                              : "Request setup"}
                          </Button>
                        </div>
                      </div>
                      {!canClaim && row.invited ? (
                        <div className="text-xs text-muted-foreground">
                          This truck already has an invited owner. Use “Request
                          setup” to remind them.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2">
              <div className="text-sm font-semibold">Can&apos;t find it?</div>
              <p className="text-xs text-muted-foreground">
                Use Google autofill to claim a missing business profile.
              </p>
              <PlaceAutocompleteInput
                id="claim-missing-business"
                intent="food"
                value={missingBusinessQuery}
                onChange={setMissingBusinessQuery}
                onSelect={(suggestion) => {
                  void handleMissingBusinessSelect(
                    suggestion as PlaceSuggestion,
                  );
                }}
                placeholder="Search business name or address"
                disabled={missingBusinessLoading}
              />
              {missingBusinessLoading ? (
                <div className="text-xs text-muted-foreground">
                  Loading business details...
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
