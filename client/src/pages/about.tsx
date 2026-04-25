import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { 
  MapPin, 
  Heart, 
  Users, 
  Star, 
  ShoppingBag,
  TrendingUp,
  Award,
  Globe
} from "lucide-react";

export default function About() {
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "MealScout",
    "description": "MealScout helps locals find nearby food trucks, restaurants, and bars while giving operators practical tools for profiles, menus, specials, and bookings.",
    "url": "https://www.mealscout.us",
    "logo": "https://www.mealscout.us/logo.png",
    "foundingDate": "2024",
    "sameAs": [],
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "customer service",
      "email": "info.mealscout@gmail.com"
    }
  };

  const stats = [
    { number: "10,000+", label: "Active Diners", icon: Users },
    { number: "500+", label: "Local Businesses", icon: ShoppingBag },
    { number: "50,000+", label: "Parking Pass Visits", icon: Star },
    { number: "25+", label: "Cities Covered", icon: MapPin }
  ];

  const features = [
    {
      title: "Find Local Food",
      description: "Search nearby food trucks, restaurants, bars, menus, and specials.",
      icon: MapPin
    },
    {
      title: "Source Parking",
      description: "Discover verified host locations and reliable places for trucks to operate.",
      icon: TrendingUp
    },
    {
      title: "Built for Operators",
      description: "Profiles, menus, pickup ordering, deals, and scheduling shaped around different business models.",
      icon: Heart
    },
    {
      title: "Verified Locations",
      description: "Hosts and spots are screened so trucks can operate confidently.",
      icon: Award
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50">
      <SEOHead
        title="About MealScout - Local Food Discovery & Business Tools"
        description="MealScout helps locals find food trucks, restaurants, and bars while giving operators tools for profiles, menus, specials, pickup ordering, and bookings."
        keywords="about MealScout, local food discovery, food truck finder platform, restaurant specials, bar happy hour discovery, food truck parking pass, host locations for food trucks"
        canonicalUrl="https://www.mealscout.us/about"
        schemaData={schemaData}
      />
      
      <BackHeader
        title="About MealScout"
        fallbackHref="/"
        icon={Globe}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="px-4 py-8 max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="w-24 h-24 bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500 rounded-3xl mb-8 flex items-center justify-center mx-auto shadow-clean-lg">
            <Heart className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] mb-6">
            Connecting Locals with Food Trucks, Restaurants, and Bars
          </h1>
          <p className="text-xl text-[color:var(--text-secondary)] leading-relaxed max-w-3xl mx-auto">
            MealScout helps people find what is actually local: active food trucks, neighborhood restaurants,
            bar specials, menus, and nearby deals. For operators, it keeps profiles, ordering, schedules,
            bookings, and discovery in one practical place.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {stats.map((stat, index) => {
            const IconComponent = stat.icon;
            return (
              <Card key={index} className="text-center p-6 bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean">
                <CardContent className="p-0">
                  <div className="w-12 h-12 bg-[color:var(--accent-text)]/12 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <IconComponent className="w-6 h-6 text-[color:var(--accent-text)]" />
                  </div>
                  <div className="text-3xl font-bold text-[color:var(--text-primary)] mb-2">{stat.number}</div>
                  <div className="text-[color:var(--text-secondary)] font-medium">{stat.label}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Mission Section */}
        <div className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] rounded-3xl p-8 lg:p-12 shadow-clean-lg mb-16">
          <h2 className="text-3xl font-bold text-[color:var(--text-primary)] mb-6 text-center">Our Mission</h2>
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <p className="text-lg text-[color:var(--text-secondary)] leading-relaxed mb-6">
                We believe great food brings communities together. Our mission is to help local food businesses
                stay visible, keep their information current, and turn nearby interest into real visits.
              </p>
              <p className="text-lg text-[color:var(--text-secondary)] leading-relaxed mb-6">
                Food trucks need locations and bookings. Restaurants need menus, specials, and pickup flow.
                Bars need happy hours, event nights, and repeat visits. MealScout keeps those experiences distinct.
              </p>
              <Link href="/customer-signup?role=business">
                <Button className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold px-6 py-3">
                  List Your Business
                </Button>
              </Link>
            </div>
            <div className="relative">
              <div className="w-full h-64 bg-gradient-to-br from-red-200 to-orange-200 rounded-2xl flex items-center justify-center">
                <div className="text-center">
                  <MapPin className="w-16 h-16 text-[color:var(--accent-text)] mx-auto mb-4" />
                  <p className="text-[color:var(--accent-text)] font-semibold">Connecting Communities</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-[color:var(--text-primary)] mb-12 text-center">Why Choose MealScout?</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, index) => {
              const IconComponent = feature.icon;
              return (
                <Card key={index} className="p-6 bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean hover:shadow-clean-lg transition-shadow">
                  <CardContent className="p-0">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 bg-[color:var(--accent-text)]/12 rounded-2xl flex items-center justify-center flex-shrink-0">
                        <IconComponent className="w-6 h-6 text-[color:var(--accent-text)]" />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-[color:var(--text-primary)] mb-3">{feature.title}</h3>
                        <p className="text-[color:var(--text-secondary)] leading-relaxed">{feature.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Team Values */}
        <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-3xl p-8 lg:p-12 text-white text-center mb-16">
          <h2 className="text-3xl font-bold mb-6">Our Values</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-xl font-semibold mb-3">Community First</h3>
              <p className="opacity-90">Supporting local businesses and bringing neighbors together through food.</p>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-3">Transparency</h3>
              <p className="opacity-90">Clear pricing, honest reviews, and authentic local business partnerships.</p>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-3">Innovation</h3>
              <p className="opacity-90">Using technology to make food discovery more convenient and enjoyable.</p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center">
          <h2 className="text-3xl font-bold text-[color:var(--text-primary)] mb-6">Ready to Start Exploring?</h2>
          <p className="text-xl text-[color:var(--text-secondary)] mb-8 max-w-2xl mx-auto">
            Join locals discovering food trucks, restaurants, bars, menus, and deals in their neighborhood.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold px-8 py-3">
                Get Started Today
              </Button>
            </Link>
            <Link href="/how-it-works">
              <Button size="lg" variant="outline" className="border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface)] font-semibold px-8 py-3">
                Learn How It Works
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}




