import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { 
  Shield, User, Store, Eye,
  Monitor, Settings, Users, Calendar, Truck, ParkingSquare, ChefHat, Package
} from "lucide-react";

// Import the dashboard components
import AdminDashboard from "@/pages/admin-dashboard";
import UserDashboard from "@/pages/user-dashboard";
import RestaurantOwnerDashboard from "@/pages/restaurant-owner-dashboard";

type DashboardType = 'admin' | 'user' | 'restaurant';

interface DashboardSwitcherProps {
  defaultView?: DashboardType;
}

export default function DashboardSwitcher({ defaultView = 'admin' }: DashboardSwitcherProps) {
  const [currentView, setCurrentView] = useState<DashboardType>(defaultView);
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  // Verify admin status with server
  const { data: adminUser, isLoading: isVerifyingAdmin, error: adminError } = useQuery({
    queryKey: ["/api/auth/admin/verify"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Loading state while verifying admin
  if (isVerifyingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If not admin, redirect to appropriate dashboard
  if (adminError || !adminUser) {
    if (
      user?.userType === 'restaurant_owner' ||
      user?.userType === 'caterer' ||
      user?.userType === 'private_chef' ||
      user?.userType === 'food_truck'
    ) {
      return <RestaurantOwnerDashboard />;
    } else if (user?.userType === 'supplier') {
      navigate("/supplier/dashboard");
      return null;
    } else {
      return <UserDashboard />;
    }
  }

  const dashboardTypes = [
    {
      type: 'admin' as DashboardType,
      label: 'Admin View',
      icon: Shield,
      description: 'Platform administration and management',
      color: 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]'
    },
    {
      type: 'user' as DashboardType,
      label: 'Customer View',
      icon: User,
      description: 'Experience what customers see',
      color: 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]'
    },
    {
      type: 'restaurant' as DashboardType,
      label: 'Restaurant View',
      icon: Store,
      description: 'Experience what restaurant owners see',
      color: 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]'
    }
  ];
  const featureShortcuts = [
    { label: "Host", href: "/host/dashboard", icon: Users },
    { label: "Events", href: "/admin/events", icon: Calendar },
    { label: "Supplier", href: "/supplier/dashboard", icon: Store },
    { label: "Open Calls", href: "/truck-discovery?city=Pensacola%2C%20FL", icon: Truck },
    { label: "Parking Truck", href: "/parking-pass?adminMode=truck", icon: ParkingSquare },
    { label: "Parking Host", href: "/parking-pass?adminMode=host", icon: ParkingSquare },
    { label: "Menu", href: "/menu-builder", icon: Store },
    { label: "Kitchen", href: "/kitchen", icon: ChefHat },
    { label: "Orders", href: "/orders", icon: User },
    { label: "Supply Orders", href: "/supply/orders", icon: Package },
  ];

  const renderDashboard = () => {
    switch (currentView) {
      case 'admin':
        return <AdminDashboard />;
      case 'user':
        return <UserDashboard />;
      case 'restaurant':
        return <RestaurantOwnerDashboard />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Switcher Header */}
      <div className="sticky top-0 z-50 bg-[var(--bg-surface)] border-b border-border shadow-clean">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Monitor className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">Dashboard Switcher</h1>
                <Badge variant="secondary" className="text-xs">
                  Admin Mode
                </Badge>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground">
                <Eye className="h-4 w-4" />
                <span>Viewing as: {dashboardTypes.find(d => d.type === currentView)?.label || 'Unknown'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">Switch View:</span>
              {dashboardTypes.map((dashboard) => (
                <Button
                  key={dashboard.type}
                  variant={currentView === dashboard.type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentView(dashboard.type)}
                  className="flex items-center gap-2"
                  data-testid={`button-switch-${dashboard.type}`}
                >
                  <dashboard.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{dashboard.label}</span>
                  <span className="sm:hidden">{dashboard.label.split(' ')[0]}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Quick Info Bar */}
          <div className="pb-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <Badge className={dashboardTypes.find(d => d.type === currentView)?.color}>
                  {(() => {
                    const currentDashboard = dashboardTypes.find(d => d.type === currentView);
                    const IconComponent = currentDashboard?.icon;
                    return IconComponent ? <IconComponent className="h-3 w-3 mr-1" /> : null;
                  })()}
                  {dashboardTypes.find(d => d.type === currentView)?.label}
                </Badge>
                <span className="text-muted-foreground">
                  {dashboardTypes.find(d => d.type === currentView)?.description}
                </span>
              </div>
              
              <div className="flex items-center gap-4 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Settings className="h-4 w-4" />
                  Admin: {user?.email}
                </span>
                <Button variant="ghost" size="sm" asChild data-testid="button-exit-switcher">
                  <Link href="/admin/dashboard">Exit Switcher</Link>
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {featureShortcuts.map((shortcut) => (
                <Button key={shortcut.href} variant="outline" size="sm" asChild>
                  <Link href={shortcut.href}>
                    <shortcut.icon className="h-4 w-4 mr-1" />
                    {shortcut.label}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="dashboard-content">
        {renderDashboard()}
      </div>

      {/* Floating Switch Button for Mobile */}
      <div className="fixed bottom-4 right-4 sm:hidden z-40">
        <div className="flex flex-col gap-2">
          {dashboardTypes.map((dashboard) => (
            <Button
              key={dashboard.type}
              variant={currentView === dashboard.type ? "default" : "secondary"}
              size="icon"
              onClick={() => setCurrentView(dashboard.type)}
              className="shadow-clean-lg"
              data-testid={`button-mobile-switch-${dashboard.type}`}
            >
              <dashboard.icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}


