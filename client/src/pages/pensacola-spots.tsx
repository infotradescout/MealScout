import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseISO } from "date-fns";

type LeadListing = {
  teaserId: string;
  locked: boolean;
  passId?: string | null;
  hostName?: string | null;
  address?: string | null;
  city: string;
  state: string | null;
  latitude?: number | null;
  longitude?: number | null;
  startingAtCents?: number | null;
  nextDate?: string | null;
};

type LeadResponse = {
  city: string;
  state: string;
  totalLocations: number;
  locked: boolean;
  listings: LeadListing[];
};

function formatMoney(cents?: number | null) {
  if (!Number.isFinite(cents) || !cents) return null;
  return `$${(Number(cents) / 100).toFixed(0)}`;
}

function blurClass(locked: boolean) {
  return locked ? "filter blur-sm select-none pointer-events-none" : "";
}

export default function PensacolaSpots() {
  const { isAuthenticated, user } = useAuth();
  const isTruckOperator =
    user?.userType === "food_truck" || user?.userType === "restaurant_owner";

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/public/pensacola/parking-pass-leads", isAuthenticated],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/public/pensacola/parking-pass-leads"), {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`Failed to load spots (status=${res.status})`);
      }
      return (await res.json()) as LeadResponse;
    },
    staleTime: 30_000,
  });
  const { data: subscription } = useQuery<{
    status: string;
    hasAccess: boolean;
  }>({
    queryKey: ["/api/subscription/status", "pensacola-spots"],
    enabled: Boolean(isAuthenticated && isTruckOperator),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const locked = Boolean(data?.locked);

  const primaryCta = useMemo(() => {
    if (isAuthenticated) {
      return (
        <Button asChild>
          <a href="/parking-pass">Browse & book</a>
        </Button>
      );
    }
    return (
      <Button asChild>
        <a
          href={`/customer-signup?role=business&businessType=food_truck&claim=1&redirect=${encodeURIComponent(
            "/truck-discovery?city=Pensacola%2C%20FL",
          )}`}
        >
          Claim or list your truck
        </a>
      </Button>
    );
  }, [isAuthenticated]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold">
            See available food truck spots in Pensacola
          </h1>
          <p className="text-muted-foreground">
            MealScout hosts list guaranteed parking pass slots. Create a free account to
            unlock exact addresses, availability, and the Book Now button.
          </p>
          <p className="text-sm text-muted-foreground">
            Pensacola is launch ground zero, then we expand market-by-market from here.
          </p>
          <div className="flex gap-3 flex-wrap items-center">
            {primaryCta}
            <Button variant="secondary" asChild>
              <a href="/truck-discovery?city=Pensacola%2C%20FL">
                See Pensacola open calls
              </a>
            </Button>
            {!isAuthenticated ? (
              <Button variant="outline" asChild>
                <a href={`/login?redirect=${encodeURIComponent("/pensacola/spots")}`}>
                  Log in
                </a>
              </Button>
            ) : null}
            {isAuthenticated && isTruckOperator && !subscription?.hasAccess ? (
              <Button variant="outline" asChild>
                <a href="/subscribe">Start premium ($25/mo)</a>
              </Button>
            ) : null}
          </div>
          {isAuthenticated && isTruckOperator && !subscription?.hasAccess ? (
            <p className="text-sm text-muted-foreground">
              Premium unlocks event interest actions and advanced booking tools for operators.
            </p>
          ) : null}
        </div>

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>
                {isLoading
                  ? "Loading spots..."
                  : data
                    ? `${data.totalLocations} locations in ${data.city}, ${data.state}`
                    : "Spots"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="text-sm text-destructive">
                  {(error as any)?.message || "Failed to load spots."}
                </div>
              ) : null}

              {!isLoading && data && data.listings.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No public-ready parking pass locations found yet.
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(data?.listings || []).map((item) => {
                  const price = formatMoney(item.startingAtCents);
                  const dateText = item.nextDate
                    ? (item.nextDate.includes("T")
                        ? new Date(item.nextDate)
                        : parseISO(item.nextDate)
                      ).toLocaleDateString()
                    : null;
                  const cardLocked = Boolean(item.locked);
                  return (
                    <Card key={item.teaserId} className="relative overflow-hidden">
                      <CardContent className="pt-6">
                        {cardLocked ? (
                          <div className="absolute inset-0 bg-background/40 backdrop-blur-[1px]" />
                        ) : null}

                        <div className="flex flex-col gap-2">
                          <div className={blurClass(cardLocked)}>
                            <div className="font-semibold">
                              {item.hostName || "Verified host"}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {item.address ? `${item.address}, ` : ""}
                              {item.city}
                              {item.state ? `, ${item.state}` : ""}
                            </div>
                          </div>

                          <div className="text-sm text-muted-foreground">
                            {price ? (
                              <span className={blurClass(cardLocked)}>
                                From {price}
                              </span>
                            ) : (
                              <span className={blurClass(cardLocked)}>Pricing varies</span>
                            )}
                            {dateText ? (
                              <span className={blurClass(cardLocked)}>
                                {" "}
                                · Next date: {dateText}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 flex gap-2 flex-wrap relative z-10">
                            {cardLocked ? (
                              <Button asChild>
                                <a
                                  href={`/customer-signup?role=business&businessType=food_truck&claim=1&redirect=${encodeURIComponent(
                                    "/truck-discovery?city=Pensacola%2C%20FL",
                                  )}`}
                                >
                                  Claim truck & unlock
                                </a>
                              </Button>
                            ) : (
                              <Button asChild>
                                <a href={`/parking-pass?pass=${encodeURIComponent(String(item.passId || ""))}`}>
                                  Book now
                                </a>
                              </Button>
                            )}
                            <Button variant="outline" asChild>
                              <a href="/how-it-works">How it works</a>
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
