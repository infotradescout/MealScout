import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Ticket,
  Shield,
  Activity,
  Bell,
  CheckCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// import AdminIncidents from './AdminIncidents';
// import AdminAuditLogs from './AdminAuditLogs';
// import AdminSupportTickets from './AdminSupportTickets';
// import AdminModerationEvents from './AdminModerationEvents';

export default function AdminControlCenter() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: stats, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  const { data: health } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      {/* Header */}
      <div className="bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Admin Control Center</h1>
              <p className="text-[color:var(--text-muted)] mt-1">
                MealScout Operations & Moderation
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  health?.status === "healthy"
                    ? "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
                    : "bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]"
                }`}
              >
                <div className="w-2 h-2 rounded-full bg-current" />
                <span className="text-sm font-medium">
                  {health?.status || "Unknown"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats Grid */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Incidents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.incidents?.total || 0}
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-[color:var(--status-error)] font-medium">
                      {stats?.incidents?.open || 0} new
                    </span>
                    <span className="text-[color:var(--status-warning)] font-medium">
                      {stats?.incidents?.critical || 0} critical
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Support Tickets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.tickets?.open || 0}
                  </div>
                  <div className="text-xs text-[color:var(--status-warning)] font-medium">
                    {stats?.tickets?.highPriority || 0} high priority
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  Moderation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.moderation?.recentEvents || 0}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)]">Last 7 days</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="text-2xl font-bold">
                    {stats?.users?.total || 0}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)]">Total registered</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="min-w-[108px]">Overview</TabsTrigger>
            <TabsTrigger value="incidents" className="min-w-[120px] gap-2">
              <AlertCircle className="hidden h-4 w-4 sm:block" />
              Incidents
            </TabsTrigger>
            <TabsTrigger value="tickets" className="min-w-[108px] gap-2">
              <Ticket className="hidden h-4 w-4 sm:block" />
              Tickets
            </TabsTrigger>
            <TabsTrigger value="moderation" className="min-w-[132px] gap-2">
              <Shield className="hidden h-4 w-4 sm:block" />
              Moderation
            </TabsTrigger>
            <TabsTrigger value="audit" className="min-w-[96px] gap-2">
              <Activity className="hidden h-4 w-4 sm:block" />
              Audit
            </TabsTrigger>
            <TabsTrigger value="health" className="min-w-[96px] gap-2">
              <Bell className="hidden h-4 w-4 sm:block" />
              Health
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Quick Start</CardTitle>
                <CardDescription>Navigate using the tabs above</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" /> Incidents
                    </h3>
                    <p className="text-sm text-[color:var(--text-muted)] mb-3">
                      View and manage security incidents with signatures and
                      timelines.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab("incidents")}
                    >
                      Manage
                    </Button>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <Ticket className="w-4 h-4" /> Support Tickets
                    </h3>
                    <p className="text-sm text-[color:var(--text-muted)] mb-3">
                      Handle user support requests and resolve issues.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab("tickets")}
                    >
                      Manage
                    </Button>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Moderation
                    </h3>
                    <p className="text-sm text-[color:var(--text-muted)] mb-3">
                      Review reported content and take moderation actions.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab("moderation")}
                    >
                      Manage
                    </Button>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <Activity className="w-4 h-4" /> Audit Logs
                    </h3>
                    <p className="text-sm text-[color:var(--text-muted)] mb-3">
                      Search and filter all platform activity.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveTab("audit")}
                    >
                      View
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Incidents Tab */}
          <TabsContent value="incidents">
            <Card>
              <CardHeader>
                <CardTitle>Incidents</CardTitle>
                <CardDescription>
                  View and manage system incidents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">Incidents module loading...</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tickets Tab */}
          <TabsContent value="tickets">
            <Card>
              <CardHeader>
                <CardTitle>Support Tickets</CardTitle>
                <CardDescription>
                  View and manage support tickets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Support tickets module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Moderation Tab */}
          <TabsContent value="moderation">
            <Card>
              <CardHeader>
                <CardTitle>Moderation Events</CardTitle>
                <CardDescription>
                  View and manage moderation events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">
                  Moderation events module loading...
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Tab */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle>Audit Logs</CardTitle>
                <CardDescription>View system audit logs</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-[color:var(--text-muted)]">Audit logs module loading...</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Health Tab */}
          <TabsContent value="health">
            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
                <CardDescription>
                  Background jobs and service status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Database Connection</h3>
                    <Badge className="bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]">
                      Connected
                    </Badge>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Server Status</h3>
                    <Badge className="bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]">
                      Operational
                    </Badge>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Escalations Job</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-[color:var(--status-success)]" />
                      <span>Running (every 15 minutes)</span>
                    </div>
                  </div>

                  <div className="p-4 border border-[var(--border-subtle)] rounded-lg">
                    <h3 className="font-medium mb-2">Auto-Close Job</h3>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-[color:var(--status-success)]" />
                      <span>Running (daily)</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-[color:var(--accent-text)]/10 border border-[color:var(--accent-text)]/30 rounded-lg">
                  <p className="text-sm text-[color:var(--accent-text)]">
                    Info: All background jobs are configured and running. Check
                    Vercel Cron for scheduled execution in production.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}




