import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, Truck } from "lucide-react";
import type { Restaurant } from "@shared/schema";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

export default function MerchantDeliveryPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { data: businesses = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
  });
  const requestedId = new URLSearchParams(search).get("restaurantId");
  const business = businesses.find((item) => item.id === requestedId) || businesses[0];

  if (!business) return null;
  const isTruck = business.isFoodTruck || business.businessType === "food_truck";
  const publicProfileHref = buildPublicProfilePath({
    entityType: isTruck ? "truck" : business.businessType === "bar" ? "bar" : "restaurant",
    id: business.id,
    name: business.name,
  });

  return (
    <BusinessWorkspaceShell
      activeModule="overview"
      business={business}
      businesses={businesses}
      onBusinessChange={(id) => setLocation(`/merchant-delivery?restaurantId=${encodeURIComponent(id)}`)}
      publicProfileHref={publicProfileHref}
      headerActions={<Button asChild variant="outline"><Link href={`/orders?restaurantId=${encodeURIComponent(business.id)}`}>Orders</Link></Button>}
    >
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5">
          <p className="text-xs font-black uppercase tracking-widest text-orange-700">{business.name}</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black"><Truck className="h-7 w-7" /> Merchant delivery</h1>
          <p className="mt-2 text-sm text-muted-foreground">MealScout's verified ordering pilot currently supports ASAP pickup paid by card.</p>
        </div>
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-950">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              Native delivery checkout is unavailable
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-amber-950">
            <p>
              There are no delivery settings to enable here. MealScout does not
              currently accept delivery orders or assign drivers, and saved legacy
              settings do not make delivery available to customers.
            </p>
            <p>
              Use Orders for the supported ASAP pickup workflow. Delivery controls
              will return only after the customer, driver, payment, and support
              lifecycle is implemented and verified end to end.
            </p>
            <Button asChild>
              <Link href={`/orders?restaurantId=${encodeURIComponent(business.id)}`}>
                Open pickup orders
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </BusinessWorkspaceShell>
  );
}
