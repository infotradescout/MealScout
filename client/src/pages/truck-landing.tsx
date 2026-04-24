import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Calendar, ShoppingCart, TrendingUp, Users, Share2, Star, BarChart3, Sparkles, Truck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function TruckLanding() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center space-x-2">
            <Truck className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">MealScout</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="/map" className="text-sm hover:text-primary">Find Spots</a>
            <a href="/search" className="text-sm hover:text-primary">Search</a>
            <a href="/deals" className="text-sm hover:text-primary">Deals</a>
            {isAuthenticated && (
              <a href="/dashboard" className="ml-4">
                <Button size="sm" className="bg-primary hover:bg-primary/90">
                  Dashboard
                </Button>
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-12 md:py-20 bg-gradient-to-b from-primary/5 to-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Now with Local Intelligence</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
              Never Stop <span className="text-primary">Moving</span>
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Find profitable parking spots, fill your schedule year-round, and manage orders all in one place. No off-season. No downtime.
            </p>
            
            <a href="/map">
              <Button size="lg" className="bg-primary hover:bg-primary/90 gap-2">
                <MapPin className="h-5 w-5" />
                Find Parking Spots
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12">
        <div className="container">
          <div className="text-center mb-8">
            <p className="text-lg font-semibold max-w-2xl mx-auto">
              The tools to find spots, fill your calendar, and run your business efficiently
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <MapPin className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Find Parking Spots</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Browse available parking passes and book spots year-round</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Calendar className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Manage Your Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Post your schedule and manage bookings all in one place</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <ShoppingCart className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Accept Orders Online</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Premium: Let customers pre-order and pay directly through MealScout</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <TrendingUp className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Post Deals & Specials</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Premium: Create unlimited deals and track their performance</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Share2 className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Share Your Location</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Premium: Broadcast your live location to customers in real-time</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BarChart3 className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Track Your Growth</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Premium: Get detailed analytics on bookings, customers, and deals</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Users className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Build Community</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Get recommendations, join events, and earn through our affiliate program</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Star className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Earn Commissions</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Share any link and earn when customers book through your referral</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Sparkles className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Local Intelligence</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>Premium: Get market insights and community-powered data to grow smarter</CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Why Section */}
      <section className="py-12 bg-muted/50">
        <div className="container">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Why Food Trucks Choose MealScout</h2>
            <p className="text-lg text-muted-foreground">
              Built for the realities of food truck operations
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <MapPin className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Year-Round Opportunities</h3>
              <p className="text-sm text-muted-foreground">
                No off-season. Find parking spots and bookings every day of the year
              </p>
            </div>

            <div className="text-center">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Truck className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Built for Trucks</h3>
              <p className="text-sm text-muted-foreground">
                Features designed specifically for food truck operations and workflows
              </p>
            </div>

            <div className="text-center">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Grow Your Revenue</h3>
              <p className="text-sm text-muted-foreground">
                Increase bookings, manage orders, and build your customer base
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-12 bg-muted/50">
        <div className="container">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Start Free with Premium Features</h2>
            <p className="text-lg text-muted-foreground">
              Get 30 days of premium access free. No credit card required. Then choose your plan.
            </p>
          </div>
          
          {/* Pricing Lists */}
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-2 gap-8">
              {/* Free Features */}
              <div>
                <h3 className="text-xl font-semibold mb-4 text-foreground">Free (After Trial)</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Search visibility</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Online menu</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Schedule posting</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Parking pass bookings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Browse events</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Basic dashboard</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Recommendations system</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Affiliate program</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Supplier directory</span>
                  </li>
                </ul>
              </div>
              {/* Premium Features */}
              <div>
                <h3 className="text-xl font-semibold mb-4 text-primary">Premium ($25/mo) - Early Adopter Lock-In</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Everything in Free, plus:</span>
                  </li>
                  <li className="flex items-start gap-2 mt-3">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Map visibility</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Home page featured</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Online ordering</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Off-platform scheduling</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Post deals & specials</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Unlimited active deals</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Live location tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Social auto-posting</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Performance analytics</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Customer tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Deal performance tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary font-bold mt-0.5">+</span>
                    <span>Local Intelligence</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground mb-4">Early adopters lock in $25/month forever. Price will increase for new users in the future.</p>
            <a href={getLoginUrl()}>
              <Button size="lg" className="bg-primary hover:bg-primary/90">Start Your Free Trial</Button>
            </a>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12">
        <div className="container">
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Start Free with Premium Features</h2>
            <p className="text-lg text-muted-foreground">
              Get 30 days of premium access free. No credit card required. Then choose your plan.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>I Own a Food Truck</CardTitle>
                <CardDescription className="text-left">
                  Find parking spots, manage bookings, and accept online orders
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href={getLoginUrl()}>
                  <Button className="w-full">Get Started</Button>
                </a>
              </CardContent>
            </Card>

            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>I Love Food Trucks</CardTitle>
                <CardDescription className="text-left">
                  Discover local trucks, order ahead, and support independent food truck owners
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href={getLoginUrl()}>
                  <Button className="w-full">Start Exploring</Button>
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 bg-muted/30">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Truck className="h-6 w-6 text-primary" />
                <span className="text-lg font-bold">MealScout</span>
              </div>
              <p className="text-sm text-muted-foreground">
                The platform built for food trucks to find spots, fill schedules, and thrive year-round
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-3">For Trucks</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="/map" className="hover:text-foreground">Find Spots</a></li>
                <li><a href="/search" className="hover:text-foreground">Search</a></li>
                <li><a href="/deals" className="hover:text-foreground">Deals</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Resources</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Help Center</a></li>
                <li><a href="#" className="hover:text-foreground">Contact Us</a></li>
                <li><a href="#" className="hover:text-foreground">Blog</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Legal</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-foreground">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} MealScout. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
