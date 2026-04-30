import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, ShoppingCart, TrendingUp, Users, Share2, Star, BarChart3, Sparkles, Truck, Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";

export default function TruckLanding() {
  const { isAuthenticated } = useAuth();
  const signupHref = "/customer-signup?role=business&businessType=food_truck";

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Food Truck Owner Tools for Spots, Orders, Schedules, and Social | MealScout"
        description="MealScout helps food truck owners find spots, publish schedules, take pickup orders, manage booking requests, and promote updates from one profile."
        canonicalUrl="https://www.mealscout.us/truck-landing"
      />

      {/* Navigation */}
      <nav className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/">
            <a className="flex items-center space-x-2">
              <Truck className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">MealScout</span>
            </a>
          </Link>
          <div className="flex items-center gap-4">
            <a href="/map" className="text-sm font-medium hover:text-primary transition-colors">Find Spots</a>
            <a href="/search" className="text-sm font-medium hover:text-primary transition-colors">Search</a>
            <a href="/deals" className="text-sm font-medium hover:text-primary transition-colors">Deals</a>
            {isAuthenticated ? (
              <Link href="/dashboard">
                <Button variant="default">Dashboard</Button>
              </Link>
            ) : (
              <a href={getLoginUrl()}>
                <Button variant="default">Sign In</Button>
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 to-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Now with Local Intelligence</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Never Stop <span className="text-primary">Moving</span>
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Find profitable parking spots, fill your schedule year-round, publish your menu, and accept pickup pre-orders from one place.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <a href="/map">
                <Button size="lg" className="text-lg px-8">
                  <MapPin className="mr-2 h-5 w-5" />
                  Find Parking Spots
                </Button>
              </a>
              {!isAuthenticated && (
                <a href={signupHref}>
                  <Button size="lg" variant="outline" className="text-lg px-8">
                    List My Truck
                  </Button>
                </a>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2 text-sm">
              <Link href="/doordash-alternative-for-food-trucks" className="text-primary underline-offset-4 hover:underline">
                DoorDash alternative
              </Link>
              <span className="text-muted-foreground">/</span>
              <Link href="/food-truck-social-media-management" className="text-primary underline-offset-4 hover:underline">
                Social tools
              </Link>
              <span className="text-muted-foreground">/</span>
              <Link href="/food-truck-opportunities/pensacola" className="text-primary underline-offset-4 hover:underline">
                Pensacola opportunities
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">For Food Truck Owners</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to find spots, manage your schedule, and grow pickup revenue
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {/* Free Features */}
            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-3">FREE</div>
              <Card>
                <CardHeader>
                  <MapPin className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Find Parking Spots</CardTitle>
                  <CardDescription>Browse available spots and book year-round</CardDescription>
                </CardHeader>
              </Card>
            </div>

            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-3">FREE</div>
              <Card>
                <CardHeader>
                  <Calendar className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Manage Schedule</CardTitle>
                  <CardDescription>Post your schedule and manage bookings</CardDescription>
                </CardHeader>
              </Card>
            </div>

            <div>
              <div className="text-sm font-semibold text-muted-foreground mb-3">FREE</div>
              <Card>
                <CardHeader>
                  <Share2 className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Affiliate System</CardTitle>
                  <CardDescription>Earn commissions by sharing links</CardDescription>
                </CardHeader>
              </Card>
            </div>

            {/* Premium Features */}
            <div>
              <div className="text-sm font-semibold text-primary mb-3">PREMIUM</div>
              <Card>
                <CardHeader>
                  <ShoppingCart className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Accept Pickup Orders</CardTitle>
                  <CardDescription>Let customers pre-order and pay before they reach the window</CardDescription>
                </CardHeader>
              </Card>
            </div>

            <div>
              <div className="text-sm font-semibold text-primary mb-3">PREMIUM</div>
              <Card>
                <CardHeader>
                  <TrendingUp className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Track Growth</CardTitle>
                  <CardDescription>Analytics, insights, and performance tracking</CardDescription>
                </CardHeader>
              </Card>
            </div>

            <div>
              <div className="text-sm font-semibold text-primary mb-3">PREMIUM</div>
              <Card>
                <CardHeader>
                  <Sparkles className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Local Intelligence</CardTitle>
                  <CardDescription>Market insights and trends</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-16 bg-muted/50">
        <div className="container">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Start Free with Premium Features</h2>
            <p className="text-lg text-muted-foreground">
              Get 30 days of premium access free. No credit card required.
            </p>
          </div>
          
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
            {/* Free Features */}
            <div>
              <h3 className="text-xl font-semibold mb-4">Free (After Trial)</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Search visibility</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Online menu</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Schedule posting</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Parking pass bookings</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Browse events</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Basic dashboard</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Recommendations</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Affiliate program</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Supplier directory</span>
                </li>
              </ul>
            </div>

            {/* Premium Features */}
            <div>
              <h3 className="text-xl font-semibold mb-4">Premium ($25/mo) - Early Adopter Lock-In</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Everything in Free, plus:</span>
                </li>
                <li className="flex items-start gap-2 mt-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Map visibility</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Home page featured</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Pickup pre-ordering</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Publish deals</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Schedule management</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Live location tracking</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Social auto-posting</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Premium analytics</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-bold">+</span>
                  <span>Local Intelligence</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16">
        <div className="container">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to Get Started?</h2>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="/map">
                <Button size="lg" className="text-lg px-8">
                  <MapPin className="mr-2 h-5 w-5" />
                  Find Spots Now
                </Button>
              </a>
              {!isAuthenticated && (
                <a href={signupHref}>
                  <Button size="lg" variant="outline" className="text-lg px-8">
                    List My Truck
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/50">
        <div className="container text-center text-sm text-muted-foreground">
          <p>&copy; 2026 MealScout. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
