import { useAuth } from "@/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { 
  MapPin, Calendar, Truck, Users, Star, TrendingUp, 
  Zap, ShoppingCart, Brain, BarChart3, Share2, Lock,
  Sparkles
} from "lucide-react";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
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
            <Link href="/discover">
              <a className="text-sm font-medium hover:text-primary transition-colors">
                Discover
              </a>
            </Link>
            <Link href="/events">
              <a className="text-sm font-medium hover:text-primary transition-colors">
                Events
              </a>
            </Link>
            <Link href="/locations">
              <a className="text-sm font-medium hover:text-primary transition-colors">
                Locations
              </a>
            </Link>
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
      <section className="py-20 md:py-32 bg-gradient-to-b from-primary/5 to-background">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Now with Community-Powered Market Intelligence</span>
            </div>
            
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
              Discover Amazing <span className="text-primary">Food Trucks</span> Near You
            </h1>
            
            <p className="text-lg text-muted-foreground">
              Discover local food trucks in your area. Support independent vendors, find hidden gems, and experience authentic street food
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link href="/discover">
                <Button size="lg" className="text-lg px-8">
                  <MapPin className="mr-2 h-5 w-5" />
                  Explore Food Trucks
                </Button>
              </Link>
              {!isAuthenticated && (
                <a href={getLoginUrl()}>
                  <Button size="lg" variant="outline" className="text-lg px-8">
                    Join Beta
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">For Local Food Lovers</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to discover, support, and connect with local food trucks in your community
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <MapPin className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Find Local Food Trucks</CardTitle>
                <CardDescription>
                  Discover food trucks near you on an interactive map with real-time locations, hours, and menus
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <ShoppingCart className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Order Directly</CardTitle>
                <CardDescription>
                  Order from your favorite food trucks with online ordering. Vendors get $25/month early adopter pricing
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Brain className="h-10 w-10 text-primary mb-2" />
                <CardTitle>LISA Intelligence</CardTitle>
                <CardDescription>
                  Community-powered market insights, daily operating briefs, supply prices, and food trends
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Calendar className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Food Truck Events</CardTitle>
                <CardDescription>
                  Find food truck gatherings, festivals, and pop-ups happening in your area
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Users className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Support Local Vendors</CardTitle>
                <CardDescription>
                  Follow your favorite food trucks, get notified when they are nearby, and support independent local businesses
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Share2 className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Affiliate System</CardTitle>
                <CardDescription>
                  Earn commissions by referring food trucks and restaurants. Share your unique link and get paid for every successful booking
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Star className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Reviews & Ratings</CardTitle>
                <CardDescription>
                  Build trust with authentic customer reviews and ratings for every vendor
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Lock className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Team Collaboration</CardTitle>
                <CardDescription>
                  Invite team members with granular permission controls and delegated access
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <BarChart3 className="h-10 w-10 text-primary mb-2" />
                <CardTitle>Analytics & Insights</CardTitle>
                <CardDescription>
                  Track bookings, revenue, customer engagement, and market trends with detailed dashboards
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Role-based CTA Section */}
      <section className="py-20 bg-muted/50">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Join MealScout</h2>
            <p className="text-lg text-muted-foreground">
              Choose your role and start connecting today
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <CardTitle>Food Truck Owner</CardTitle>
                <CardDescription className="text-left">
                  List your truck, get discovered by local customers, and manage bookings
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
                <CardTitle>Food Lover</CardTitle>
                <CardDescription className="text-left">
                  Discover local food trucks, order ahead, and support independent vendors
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
                <CardTitle>Event Organizer</CardTitle>
                <CardDescription className="text-left">
                  Bring food trucks to your events and create memorable food experiences
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
                <CardTitle>Venue Owner</CardTitle>
                <CardDescription className="text-left">
                  Host food trucks and offer your guests diverse local dining options
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href={getLoginUrl()}>
                  <Button className="w-full">Get Started</Button>
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 bg-muted/30">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Truck className="h-6 w-6 text-primary" />
                <span className="text-lg font-bold">MealScout</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Connecting mobile food vendors with customers and locations
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-3">Platform</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/discover"><a className="hover:text-foreground">Discover</a></Link></li>
                <li><Link href="/events"><a className="hover:text-foreground">Events</a></Link></li>
                <li><Link href="/locations"><a className="hover:text-foreground">Locations</a></Link></li>
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
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} MealScout. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
