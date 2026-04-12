import { useQuery } from "@tanstack/react-query";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Globe, Home, User, Building, Search, MapPin, Shield, ExternalLink } from "lucide-react";

type SitemapCity = {
  id: string;
  name: string;
  slug: string;
  state?: string | null;
  updatedAt: string;
  cuisines: Array<{ slug: string; count: number }>;
};

const titleCase = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function Sitemap() {
  const { data: cityData } = useQuery<SitemapCity[]>({
    queryKey: ["/api/cities", "sitemap"],
    queryFn: async () => {
      const res = await fetch("/api/cities");
      if (!res.ok) throw new Error("Failed to fetch cities");
      return res.json();
    },
    staleTime: 60_000,
  });

  const cities = Array.isArray(cityData) ? cityData.slice(0, 24) : [];
  const cityCuisinePages = cities.flatMap((city) =>
    (city.cuisines || []).slice(0, 4).map((cuisine) => ({
      href: `/food-trucks/${city.slug}/${cuisine.slug}`,
      title: `${titleCase(cuisine.slug)} in ${city.name}${city.state ? `, ${city.state}` : ""}`,
      description: `Local ${titleCase(cuisine.slug).toLowerCase()} truck and deal pages.`,
    })),
  );

  const schemaData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "MealScout Sitemap",
    description:
      "Complete site navigation for MealScout including dynamic city and cuisine landing pages.",
    url: "https://www.mealscout.us/sitemap",
  };

  const siteStructure = [
    {
      category: "Main Pages",
      icon: Home,
      color: "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]",
      pages: [
        { title: "Home", href: "/", description: "Discover local food deals near you" },
        { title: "Search Deals", href: "/search", description: "Search by city, cuisine, or restaurant" },
        { title: "Map View", href: "/map", description: "Interactive live food and deal map" },
        { title: "Featured Deals", href: "/deals/featured", description: "Active local and limited-time offers" },
      ],
    },
    {
      category: "Business & Event Pages",
      icon: Building,
      color: "bg-orange-100 text-orange-600",
      pages: [
        { title: "For Restaurants", href: "/for-restaurants", description: "Restaurant growth with MealScout" },
        { title: "For Food Trucks", href: "/truck-landing", description: "Food truck growth with MealScout" },
        { title: "For Hosts", href: "/for-hosts", description: "Host truck-friendly locations and events" },
        { title: "Host Partnership", href: "/host-location-partner", description: "Non-food businesses with parking can qualify as hosts" },
        { title: "Public Events", href: "/events/public", description: "Upcoming public food events and activity" },
      ],
    },
    {
      category: "Account & Help",
      icon: User,
      color: "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]",
      pages: [
        { title: "Login", href: "/login", description: "Access your MealScout account" },
        { title: "Sign Up", href: "/customer-signup", description: "Create your free MealScout account" },
        { title: "FAQ", href: "/faq", description: "Frequently asked questions and answers" },
        { title: "How It Works", href: "/how-it-works", description: "How MealScout discovery and claims work" },
      ],
    },
    {
      category: "Legal",
      icon: Shield,
      color: "bg-[var(--bg-subtle)] text-[color:var(--text-secondary)]",
      pages: [
        { title: "Privacy Policy", href: "/privacy-policy", description: "How we protect and use your data" },
        { title: "Terms of Service", href: "/terms-of-service", description: "Terms and conditions for using MealScout" },
        { title: "Data Deletion", href: "/data-deletion", description: "Request account data deletion" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Sitemap - Complete MealScout Navigation & Landing Pages"
        description="Browse all MealScout pages, including dynamic city and cuisine landing pages for local food truck and restaurant deals."
        canonicalUrl="https://www.mealscout.us/sitemap"
        schemaData={schemaData}
      />

      <BackHeader
        title="Site Map"
        fallbackHref="/"
        icon={Globe}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="px-4 py-8 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-indigo-500 to-cyan-500 rounded-3xl mb-8 flex items-center justify-center mx-auto shadow-clean-lg">
            <Globe className="w-10 h-10 text-[color:var(--text-inverse)]" />
          </div>
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] mb-6">MealScout Sitemap</h1>
          <p className="text-xl text-[color:var(--text-secondary)] leading-relaxed max-w-3xl mx-auto">
            Navigate every major MealScout page, plus dynamic local landing pages that update as supply grows.
          </p>
        </div>

        <div className="space-y-8 mb-16">
          {siteStructure.map((section, sectionIndex) => {
            const IconComponent = section.icon;
            return (
              <Card key={sectionIndex} className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg">
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
                    <div className={`w-8 h-8 ${section.color} rounded-xl flex items-center justify-center`}>
                      <IconComponent className="w-5 h-5" />
                    </div>
                    {section.category}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {section.pages.map((page, pageIndex) => (
                      <Link key={pageIndex} href={page.href}>
                        <div className="p-4 rounded-lg bg-[var(--bg-surface)] hover:bg-[color:var(--accent-text)]/10 transition-colors group cursor-pointer border border-transparent hover:border-[color:var(--accent-text)]/30">
                          <div className="flex items-center justify-between mb-2">
                            <h2 className="font-semibold text-[color:var(--text-primary)] group-hover:text-[color:var(--accent-text)]">
                              {page.title}
                            </h2>
                            <ExternalLink className="w-4 h-4 text-[color:var(--text-muted)] group-hover:text-[color:var(--accent-text)]" />
                          </div>
                          <p className="text-sm text-[color:var(--text-secondary)] leading-relaxed">{page.description}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg mb-8">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
              <div className="w-8 h-8 bg-[color:var(--status-error)]/12 text-[color:var(--status-error)] rounded-xl flex items-center justify-center">
                <MapPin className="w-5 h-5" />
              </div>
              Dynamic City Landing Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cities.length === 0 ? (
              <p className="text-sm text-[color:var(--text-secondary)]">
                Loading city pages...
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {cities.map((city) => (
                    <Link key={city.id} href={`/food-trucks/${city.slug}`}>
                      <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-transparent hover:border-[color:var(--accent-text)]/30 hover:bg-[color:var(--accent-text)]/10 transition-colors">
                        <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                          {city.name}{city.state ? `, ${city.state}` : ""}
                        </div>
                        <div className="text-xs text-[color:var(--text-secondary)] mt-1">
                          {city.cuisines.length} cuisine pages
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                {cityCuisinePages.length > 0 && (
                  <div className="mt-6">
                    <h2 className="text-lg font-semibold text-[color:var(--text-primary)] mb-3">
                      City + Cuisine Pages
                    </h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {cityCuisinePages.slice(0, 36).map((page) => (
                        <Link key={page.href} href={page.href}>
                          <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-transparent hover:border-[color:var(--accent-text)]/30 hover:bg-[color:var(--accent-text)]/10 transition-colors">
                            <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                              {page.title}
                            </div>
                            <div className="text-xs text-[color:var(--text-secondary)] mt-1">
                              {page.description}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
