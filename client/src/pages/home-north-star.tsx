import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Store, MapPin, Calendar, Search } from "lucide-react";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { authDebugProbe } from "@/lib/authDebug";

const HOME_TITLE = "MealScout | Food Truck Finder & Parking Sourcing";
const HOME_DESCRIPTION =
  "MealScout helps food trucks find real places to park and serve - and helps customers find where food trucks are today. Discover food trucks near you or scout verified parking spots, host locations, and opportunities to operate.";

const canonicalUrl =
  typeof window !== "undefined"
    ? `${window.location.origin}/`
    : "https://www.mealscout.us/";

const schemaData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "MealScout",
      url: canonicalUrl,
      description: HOME_DESCRIPTION,
      sameAs: ["https://www.mealscout.us/"],
    },
    {
      "@type": "LocalBusiness",
      name: "MealScout",
      url: canonicalUrl,
      description: HOME_DESCRIPTION,
      areaServed: "Local",
      priceRange: "$",
    },
    {
      "@type": "Offer",
      name: "MealScout monthly subscription",
      description: "Paid local discovery for food businesses",
      price: "25.00",
      priceCurrency: "USD",
      availabilityStarts: "2026-04-01",
      eligibleCustomerType: "Business",
    },
    {
      "@type": "Service",
      name: "Local food discovery",
      provider: {
        "@type": "Organization",
        name: "MealScout",
      },
      serviceType: "Food truck discovery and parking sourcing",
      areaServed: "Local",
    },
  ],
};

export default function Home() {
  useEffect(() => {
    authDebugProbe();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-orange-50">
      <SEOHead
        title={HOME_TITLE}
        description={HOME_DESCRIPTION}
        canonicalUrl={canonicalUrl}
        schemaData={schemaData}
      />
      <Navigation />

      <main className="container max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-[color:var(--text-primary)] mb-4">
            Find food trucks. Scout places to park.
          </h1>
          <p className="text-xl text-[color:var(--text-muted)] max-w-2xl mx-auto">
            MealScout helps food trucks find real places to park and serve - and
            helps customers find where food trucks are today.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <Link href="/restaurant-signup">
            <Card className="hover:shadow-clean-lg transition-shadow cursor-pointer h-full border-2 hover:border-[color:var(--status-warning)]">
              <CardContent className="p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
                    <Store className="w-8 h-8 text-orange-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">
                    List my food truck or restaurant
                  </h3>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Join before April 1 and lock in{" "}
                    <span className="line-through text-[color:var(--text-muted)]">$50</span>{" "}
                    <span className="font-semibold text-[color:var(--text-primary)]">$25/month</span>{" "}
                    forever
                  </p>
                  <Button className="mt-4">Get Started</Button>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/host-signup">
            <Card className="hover:shadow-clean-lg transition-shadow cursor-pointer h-full border-2 hover:border-[color:var(--status-success)]">
              <CardContent className="p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                    <MapPin className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">
                    Host food at my location
                  </h3>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Free forever. Unlock local food truck supply.
                  </p>
                  <Button variant="outline" className="mt-4">
                    Sign Up Free
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/events">
            <Card className="hover:shadow-clean-lg transition-shadow cursor-pointer h-full border-2 hover:border-[color:var(--accent-text)]">
              <CardContent className="p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-[color:var(--accent-text)]/12 rounded-full flex items-center justify-center">
                    <Calendar className="w-8 h-8 text-[color:var(--accent-text)]" />
                  </div>
                  <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">
                    Need trucks for an event
                  </h3>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Free forever. No event organizer fees.
                  </p>
                  <Button variant="outline" className="mt-4">
                    Create Event
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/search">
            <Card className="hover:shadow-clean-lg transition-shadow cursor-pointer h-full border-2 hover:border-[color:var(--accent-text)]">
              <CardContent className="p-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                    <Search className="w-8 h-8 text-purple-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">
                    Find food near me
                  </h3>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Discover deals, trucks, and local restaurants.
                  </p>
                  <Button variant="outline" className="mt-4">
                    Start Exploring
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        <div className="text-center text-sm text-[color:var(--text-muted)] space-y-2">
          <p>
            One identity - many claims - verified - coordinated - monetized where
            fair
          </p>
          <p className="font-semibold text-orange-600">
            Locked promo pricing: <span className="line-through">$50</span> $25/month
            forever for restaurants joining before April 1, 2026
          </p>
          <p className="text-[color:var(--text-secondary)]">
            MealScout is a food truck finder, parking sourcing tool, and local
            food discovery layer.
          </p>
        </div>
      </main>
    </div>
  );
}




