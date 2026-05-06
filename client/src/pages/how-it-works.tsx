import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { 
  MapPin,
  CheckCircle,
  ArrowRight,
  User,
  Truck,
  Building2,
  Store,
  CalendarDays,
  ShieldCheck
} from "lucide-react";

export default function HowItWorks() {
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": "How to Use MealScout",
    "description": "Choose your role, build your local presence, and use the tools built for your community.",
    "step": [
      {
        "@type": "HowToStep",
        "name": "Choose Your Role",
        "text": "Pick the role that matches how you use MealScout."
      },
      {
        "@type": "HowToStep", 
        "name": "Complete Your Profile",
        "text": "Add accurate info so locals can find and trust you."
      },
      {
        "@type": "HowToStep",
        "name": "Use Your Tools",
        "text": "Search, book, publish, and manage everything from your dashboard."
      }
    ]
  };

  const steps = [
    {
      number: "01",
      title: "Choose Your Role",
      description: "Pick the role that fits how you show up locally. You can add more roles later if you wear multiple hats.",
      icon: User,
      details: [
        "Diner, food truck, host, restaurant/bar, event coordinator, or staff",
        "Role-based dashboards keep things focused",
        "Everything is built for local discovery",
        "You stay in control of what you publish"
      ]
    },
    {
      number: "02", 
      title: "Build a Local Profile",
      description: "Your profile is your local footprint. Keep it accurate so people can find and trust you fast.",
      icon: MapPin,
      details: [
        "Business profiles act like mini websites",
        "Add addresses, hours, and contact details",
        "Control visibility and updates any time",
        "Your info powers local search and maps"
      ]
    },
    {
      number: "03",
      title: "Use Your Tools",
      description: "Book, post, manage, and connect with locals using the tools built for your role.",
      icon: CheckCircle,
      details: [
        "Parking pass bookings are pay-to-confirm",
        "Events are managed only by coordinators",
        "Schedules and visibility update in real time",
        "Every share stays tied to you"
      ]
    }
  ];

  const guides = [
    {
      title: "Diners",
      description: "Discover local spots and specials without the noise.",
      icon: User,
      details: [
        "Browse deals, recommendations, and videos",
        "Save favorites and track activity",
        "Share links that credit you automatically",
        "Stay in control of notifications"
      ],
      cta: { label: "Explore local food", href: "/" }
    },
    {
      title: "Food Trucks",
      description: "Find places to park, manage your schedule, and get booked locally.",
      icon: Truck,
      details: [
        "Search and book parking pass locations",
        "Manage your schedule and live location",
        "Share your profile with one tap",
        "Optional premium tools when you want them"
      ],
      cta: { label: "Go to Parking Pass", href: "/parking-pass" }
    },
    {
      title: "Hosts",
      description: "List locations and control availability by address.",
      icon: Building2,
      details: [
        "One parking pass per address",
        "Set slot availability and blackout dates",
        "Track bookings per location",
        "Keep full host pricing minus processing"
      ],
      cta: { label: "Host dashboard", href: "/host/dashboard" }
    },
    {
      title: "Restaurants & Bars",
      description: "Build a mini website and promote locally.",
      icon: Store,
      details: [
        "Publish your profile, deals, and specials",
        "Track performance and engagement",
        "Keep your info accurate for locals",
        "Cancel or rejoin monthly any time"
      ],
      cta: { label: "Business dashboard", href: "/dashboard" }
    },
    {
      title: "Event Coordinators",
      description: "Own the event flow and manage bookings directly.",
      icon: CalendarDays,
      details: [
        "Create and manage events",
        "Coordinate with trucks for bookings",
        "Events stay separate from parking pass",
        "Give locals clear, trusted info"
      ],
      cta: { label: "Events", href: "/events" }
    },
    {
      title: "Staff & Admin",
      description: "Support the network and keep everything running clean.",
      icon: ShieldCheck,
      details: [
        "Manage users, affiliates, and content",
        "Resolve issues fast for local trust",
        "Keep the system accurate",
        "Protect the community first"
      ],
      cta: { label: "Admin tools", href: "/admin" }
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-indigo-50">
      <SEOHead
        title="How MealScout Works - Local Tools for Every Role"
        description="Choose your role, build a local presence, and use the tools built for diners, food trucks, hosts, restaurants, bars, and event coordinators."
        keywords="how MealScout works, food truck booking workflow, parking pass for hosts, local restaurant discovery tools, event coordinator dashboard, affiliate links for local food"
        canonicalUrl="https://www.mealscout.us/how-it-works"
        schemaData={schemaData}
      />
      
      <BackHeader
        title="How It Works"
        fallbackHref="/"
        icon={CheckCircle}
        className="bg-[var(--bg-surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]/50 shadow-clean"
      />

      <div className="px-4 py-8 max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="w-24 h-24 bg-gradient-to-br from-green-500 via-blue-500 to-indigo-500 rounded-3xl mb-8 flex items-center justify-center mx-auto shadow-clean-lg">
            <CheckCircle className="w-12 h-12 text-[color:var(--text-inverse)]" />
          </div>
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] mb-6">
            Built Local. Built By Locals.
          </h1>
          <p className="text-xl text-[color:var(--text-muted)] leading-relaxed max-w-3xl mx-auto">
            MealScout gives every role a clear, focused path—so you can move fast, stay in control, and grow locally.
          </p>
        </div>

        {/* Steps Section */}
        <div className="space-y-16 mb-20">
          {steps.map((step, index) => {
            const IconComponent = step.icon;
            const isEven = index % 2 === 1;
            
            return (
              <div key={index} className={`grid lg:grid-cols-2 gap-12 items-center ${isEven ? 'lg:grid-flow-col-dense' : ''}`}>
                <div className={isEven ? 'lg:order-2' : ''}>
                  <div className="flex items-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-500 rounded-2xl flex items-center justify-center mr-4">
                      <IconComponent className="w-8 h-8 text-[color:var(--text-inverse)]" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[color:var(--accent-text)] mb-1">STEP {step.number}</div>
                      <h2 className="text-3xl font-bold text-[color:var(--text-primary)]">{step.title}</h2>
                    </div>
                  </div>
                  
                  <p className="text-xl text-[color:var(--text-muted)] leading-relaxed mb-8">
                    {step.description}
                  </p>
                  
                  <div className="space-y-3">
                    {step.details.map((detail, detailIndex) => (
                      <div key={detailIndex} className="flex items-center space-x-3">
                        <CheckCircle className="w-5 h-5 text-[color:var(--status-success)] flex-shrink-0" />
                        <span className="text-[color:var(--text-secondary)]">{detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className={`relative ${isEven ? 'lg:order-1' : ''}`}>
                  <Card className="p-8 bg-[var(--bg-surface)]/90 backdrop-blur-sm shadow-clean-lg">
                    <CardContent className="p-0">
                      <div className="w-full h-64 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center">
                        <div className="text-center">
                          <IconComponent className="w-16 h-16 text-[color:var(--text-muted)] mx-auto mb-4" />
                          <p className="text-[color:var(--text-muted)] font-semibold">Step {step.number} Visual</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            );
          })}
        </div>

        {/* User Guides */}
        <div className="mb-16">
          <h2 className="text-3xl font-bold text-[color:var(--text-primary)] mb-12 text-center">
            Guides by User Type
          </h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {guides.map((guide, index) => {
              const IconComponent = guide.icon;
              return (
                <Card key={index} className="p-6 bg-[var(--bg-surface)]/80 backdrop-blur-sm shadow-clean-lg hover:shadow-clean-lg transition-shadow">
                  <CardContent className="p-0 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-[color:var(--accent-text)]/12 rounded-2xl flex items-center justify-center">
                        <IconComponent className="w-6 h-6 text-[color:var(--accent-text)]" />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-[color:var(--text-primary)]">{guide.title}</h3>
                        <p className="text-sm text-[color:var(--text-muted)]">{guide.description}</p>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm text-[color:var(--text-secondary)]">
                      {guide.details.map((detail, detailIndex) => (
                        <div key={detailIndex} className="flex items-center space-x-2">
                          <CheckCircle className="w-4 h-4 text-[color:var(--status-success)] flex-shrink-0" />
                          <span>{detail}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <Link href={guide.cta.href}>
                        <Button variant="outline" size="sm">
                          {guide.cta.label}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-green-500 to-blue-500 rounded-3xl p-8 lg:p-12 text-[color:var(--text-inverse)] text-center">
          <h2 className="text-3xl font-bold mb-6">Ready to Start Saving?</h2>
          <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
            Start local. Stay in control. Build real relationships through food.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" className="bg-[var(--bg-surface)] text-[color:var(--status-success)] hover:bg-[var(--bg-subtle)] font-semibold px-8 py-3">
                Get Started Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link href="/about">
              <Button size="lg" variant="outline" className="border-[var(--border-strong)] text-[color:var(--text-inverse)] hover:bg-[color:var(--bg-surface)]/10 font-semibold px-8 py-3">
                Learn More About Us
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}




