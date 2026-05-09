import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Smartphone,
} from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { useToast } from "@/hooks/use-toast";
import { locationNotificationService } from "@/services/location-notifications";

type NotificationPrefs = {
  channels: {
    push: boolean;
    email: boolean;
    sms: boolean;
  };
  topics: {
    dealAlerts: boolean;
    followedActivity: boolean;
    orderUpdates: boolean;
    newRestaurants: boolean;
    weeklyDigest: boolean;
    nearbyEvents: boolean;
    businessMessages: boolean;
    recommendations: boolean;
    account: boolean;
  };
  location: {
    enabled: boolean;
    radiusKm: number;
    maxPerDay: number;
    quietHours: {
      start: string;
      end: string;
    };
  };
};

type SettingsResponse = {
  accountSettings?: {
    notifications?: Partial<NotificationPrefs>;
  };
};

type InAppNotification = {
  id: string;
  title: string;
  body: string;
  topic: string;
  actionUrl?: string | null;
  priority: string;
  createdAt?: string;
  isRead: boolean;
};

type NotificationsResponse = {
  notifications: InAppNotification[];
};

const DEFAULT_PREFS: NotificationPrefs = {
  channels: {
    push: true,
    email: true,
    sms: false,
  },
  topics: {
    dealAlerts: true,
    followedActivity: true,
    orderUpdates: true,
    newRestaurants: false,
    weeklyDigest: true,
    nearbyEvents: true,
    businessMessages: true,
    recommendations: true,
    account: true,
  },
  location: {
    enabled: true,
    radiusKm: 3,
    maxPerDay: 5,
    quietHours: {
      start: "22:00",
      end: "08:00",
    },
  },
};

function sanitizeTime(value: string | undefined, fallback: string) {
  if (typeof value !== "string") return fallback;
  return /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function buildPrefs(
  raw: Partial<NotificationPrefs> | undefined,
): NotificationPrefs {
  const channels: Partial<NotificationPrefs["channels"]> = raw?.channels ?? {};
  const topics: Partial<NotificationPrefs["topics"]> = raw?.topics ?? {};
  const location: Partial<NotificationPrefs["location"]> = raw?.location ?? {};
  const quietHours: Partial<NotificationPrefs["location"]["quietHours"]> =
    location.quietHours ?? {};

  return {
    channels: {
      push: channels.push ?? DEFAULT_PREFS.channels.push,
      email: channels.email ?? DEFAULT_PREFS.channels.email,
      sms: channels.sms ?? DEFAULT_PREFS.channels.sms,
    },
    topics: {
      dealAlerts: topics.dealAlerts ?? DEFAULT_PREFS.topics.dealAlerts,
      followedActivity:
        topics.followedActivity ?? DEFAULT_PREFS.topics.followedActivity,
      orderUpdates: topics.orderUpdates ?? DEFAULT_PREFS.topics.orderUpdates,
      newRestaurants:
        topics.newRestaurants ?? DEFAULT_PREFS.topics.newRestaurants,
      weeklyDigest: topics.weeklyDigest ?? DEFAULT_PREFS.topics.weeklyDigest,
      nearbyEvents: topics.nearbyEvents ?? DEFAULT_PREFS.topics.nearbyEvents,
      businessMessages:
        topics.businessMessages ?? DEFAULT_PREFS.topics.businessMessages,
      recommendations:
        topics.recommendations ?? DEFAULT_PREFS.topics.recommendations,
      account: topics.account ?? DEFAULT_PREFS.topics.account,
    },
    location: {
      enabled: location.enabled ?? DEFAULT_PREFS.location.enabled,
      radiusKm:
        Number.isFinite(Number(location.radiusKm)) &&
        Number(location.radiusKm) > 0
          ? Number(location.radiusKm)
          : DEFAULT_PREFS.location.radiusKm,
      maxPerDay:
        Number.isFinite(Number(location.maxPerDay)) &&
        Number(location.maxPerDay) >= 1
          ? Number(location.maxPerDay)
          : DEFAULT_PREFS.location.maxPerDay,
      quietHours: {
        start: sanitizeTime(
          quietHours.start,
          DEFAULT_PREFS.location.quietHours.start,
        ),
        end: sanitizeTime(
          quietHours.end,
          DEFAULT_PREFS.location.quietHours.end,
        ),
      },
    },
  };
}

export default function NotificationsPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [connectionResponses, setConnectionResponses] = useState<
    Record<string, boolean>
  >({});

  const { data, isLoading, refetch } = useQuery<SettingsResponse>({
    queryKey: ["/api/settings/me", "notifications"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/settings/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load notification settings");
      return res.json();
    },
  });
  const {
    data: notificationsData,
    isLoading: notificationsLoading,
    refetch: refetchNotifications,
  } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications", "profile"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=25", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
  });

  useEffect(() => {
    const next = buildPrefs(data?.accountSettings?.notifications);
    setPrefs(next);
    setDirty(false);
  }, [data]);

  useEffect(() => {
    locationNotificationService.updateSettings({
      enabled: prefs.channels.push && prefs.location.enabled,
      radius: prefs.location.radiusKm,
      maxPerDay: prefs.location.maxPerDay,
      quietHours: {
        start: prefs.location.quietHours.start,
        end: prefs.location.quietHours.end,
      },
    });
  }, [prefs]);

  const pushStatus = useMemo(() => {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }, []);

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <Bell className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Sign in required</h2>
          <p className="text-muted-foreground">
            Log in to manage your notifications
          </p>
        </div>
        <Navigation />
      </div>
    );
  }

  const setChannels = (patch: Partial<NotificationPrefs["channels"]>) => {
    setPrefs((prev) => ({ ...prev, channels: { ...prev.channels, ...patch } }));
    setDirty(true);
  };

  const setTopics = (patch: Partial<NotificationPrefs["topics"]>) => {
    setPrefs((prev) => ({ ...prev, topics: { ...prev.topics, ...patch } }));
    setDirty(true);
  };

  const setLocation = (patch: Partial<NotificationPrefs["location"]>) => {
    setPrefs((prev) => ({ ...prev, location: { ...prev.location, ...patch } }));
    setDirty(true);
  };

  const savePrefs = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSettings: {
            notifications: prefs,
          },
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to save notification settings");
      }
      await refetch();
      toast({
        title: "Saved",
        description: "Notification preferences updated.",
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save notification settings.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const markRead = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to mark notification read");
      await refetchNotifications();
    } catch (error: any) {
      toast({
        title: "Could not update notification",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const respondToConnectionRequest = async (
    requestId: string,
    decision: "accepted" | "denied",
  ) => {
    setConnectionResponses((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await fetch(`/api/connections/${requestId}/respond`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message || "Failed to respond");
      }
      await refetchNotifications();
      toast({
        title: decision === "accepted" ? "Connection accepted" : "Request declined",
        description:
          decision === "accepted"
            ? "We let them know you accepted."
            : "We let them know this request was declined.",
      });
    } catch (error: any) {
      toast({
        title: "Could not update request",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setConnectionResponses((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const maybeEnablePush = async (enabled: boolean) => {
    setChannels({ push: enabled });
    if (!enabled) {
      locationNotificationService.stopMonitoring();
      return;
    }
    try {
      const granted = await locationNotificationService.requestPermission();
      if (!granted) {
        toast({
          title: "Permission required",
          description: "Push notifications are blocked in this browser.",
          variant: "destructive",
        });
      } else if (prefs.location.enabled) {
        await locationNotificationService.startMonitoring();
      }
    } catch {
      // Best effort only.
    }
  };

  const maybeEnableLocationAlerts = async (enabled: boolean) => {
    setLocation({ enabled });
    if (!enabled) {
      locationNotificationService.stopMonitoring();
      return;
    }
    if (prefs.channels.push) {
      try {
        await locationNotificationService.startMonitoring();
      } catch {
        // Best effort only.
      }
    }
  };

  const notifications = notificationsData?.notifications || [];
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <BackHeader
        title="Notifications"
        subtitle="Manage how you receive updates"
        fallbackHref="/profile"
        icon={Bell}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      {/* Content */}
      <div className="px-4 sm:px-6 py-6 space-y-6">
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span className="flex items-center">
                <Bell className="w-5 h-5 mr-2" />
                In-app inbox
              </span>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-[color:var(--action-primary)] px-2 py-0.5 text-xs font-black text-[color:var(--action-primary-text)]">
                  {unreadCount} new
                </span>
              ) : null}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A private record of MealScout actions and alerts. These signals
              help us learn what is useful without exposing private message
              content in public ranking.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {notificationsLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-4 text-sm text-muted-foreground">
                No in-app notifications yet. Follows, saved spots, business
                replies, recommendations, orders, and local alerts will collect
                here.
              </div>
            ) : (
              notifications.map((item) => {
                const connectionRequestId =
                  item.sourceType === "connection_request"
                    ? String(item.metadata?.requestId || item.sourceId || "")
                    : "";
                const isConnectionRequest = Boolean(connectionRequestId);
                const isSupportConnection =
                  item.sourceType === "platform_support_connection" ||
                  item.metadata?.supportAccount === true;
                const connectionBusy =
                  connectionRequestId &&
                  connectionResponses[connectionRequestId] === true;
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3 ${
                      item.isRead
                        ? "border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
                        : "border-[color:var(--action-primary)] bg-[var(--bg-surface-muted)]"
                    }`}
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-[color:var(--text-primary)]">
                        {item.title}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                        {item.body}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        <span>{item.topic}</span>
                        {isSupportConnection ? (
                          <span className="rounded-full border border-[color:var(--action-primary)] px-2 py-0.5 text-[color:var(--action-primary)]">
                            Real MealScout support
                          </span>
                        ) : null}
                        {item.createdAt ? (
                          <span>
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {!item.isRead ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => markRead(item.id)}
                      >
                        Read
                      </Button>
                    ) : null}
                  </div>
                  {isConnectionRequest && !item.isRead ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          respondToConnectionRequest(
                            connectionRequestId,
                            "accepted",
                          )
                        }
                        disabled={Boolean(connectionBusy)}
                      >
                        Accept connection
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          respondToConnectionRequest(
                            connectionRequestId,
                            "denied",
                          )
                        }
                        disabled={Boolean(connectionBusy)}
                      >
                        Deny
                      </Button>
                    </div>
                  ) : null}
                  {item.actionUrl ? (
                    <Button
                      type="button"
                      variant="link"
                      className="mt-2 h-auto p-0 text-[color:var(--action-primary)]"
                      onClick={() => {
                        window.location.href = item.actionUrl || "/scout";
                      }}
                    >
                      Open action
                    </Button>
                  ) : null}
                </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardContent className="pt-6 flex items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold">Push permission</p>
              <p className="text-muted-foreground">
                {pushStatus === "granted"
                  ? "Granted"
                  : pushStatus === "denied"
                    ? "Blocked in browser settings"
                    : pushStatus === "unsupported"
                      ? "Not supported on this browser"
                      : "Not granted yet"}
              </p>
            </div>
            {pushStatus === "granted" ? (
              <CheckCircle2 className="w-5 h-5 text-[color:var(--status-success)]" />
            ) : (
              <Bell className="w-5 h-5 text-[color:var(--status-warning)]" />
            )}
          </CardContent>
        </Card>

        {/* Delivery Methods */}
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Smartphone className="w-5 h-5 mr-2" />
              Delivery Methods
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Get notified on your device
                </p>
              </div>
              <Switch
                checked={prefs.channels.push}
                onCheckedChange={maybeEnablePush}
                data-testid="switch-push"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Receive updates via email
                </p>
              </div>
              <Switch
                checked={prefs.channels.email}
                onCheckedChange={(next) => setChannels({ email: next })}
                data-testid="switch-email"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">SMS Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Get text message alerts
                </p>
              </div>
              <Switch
                checked={prefs.channels.sms}
                onCheckedChange={(next) => setChannels({ sms: next })}
                data-testid="switch-sms"
              />
            </div>
          </CardContent>
        </Card>

        {/* Content Types */}
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Bell className="w-5 h-5 mr-2" />
              What to notify me about
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              We use your follows, saves, and broad notification preferences to
              decide what is worth sending. Emails never include your exact live
              location.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Deal Alerts</p>
                <p className="text-sm text-muted-foreground">
                  New deals near you
                </p>
              </div>
              <Switch
                checked={prefs.topics.dealAlerts}
                onCheckedChange={(next) => setTopics({ dealAlerts: next })}
                data-testid="switch-deals"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Places I follow</p>
                <p className="text-sm text-muted-foreground">
                  Deals, menus, and schedule updates from restaurants and trucks
                  you follow
                </p>
              </div>
              <Switch
                checked={prefs.topics.followedActivity}
                onCheckedChange={(next) =>
                  setTopics({ followedActivity: next })
                }
                data-testid="switch-followed-activity"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Order Updates</p>
                <p className="text-sm text-muted-foreground">
                  Status of your claimed deals
                </p>
              </div>
              <Switch
                checked={prefs.topics.orderUpdates}
                onCheckedChange={(next) => setTopics({ orderUpdates: next })}
                data-testid="switch-orders"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">New Restaurants</p>
                <p className="text-sm text-muted-foreground">
                  When new places join MealScout
                </p>
              </div>
              <Switch
                checked={prefs.topics.newRestaurants}
                onCheckedChange={(next) => setTopics({ newRestaurants: next })}
                data-testid="switch-restaurants"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Weekly Digest</p>
                <p className="text-sm text-muted-foreground">
                  Summary of your activity
                </p>
              </div>
              <Switch
                checked={prefs.topics.weeklyDigest}
                onCheckedChange={(next) => setTopics({ weeklyDigest: next })}
                data-testid="switch-digest"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Nearby Events</p>
                <p className="text-sm text-muted-foreground">
                  Event opportunities near your current area
                </p>
              </div>
              <Switch
                checked={prefs.topics.nearbyEvents}
                onCheckedChange={(next) => setTopics({ nearbyEvents: next })}
                data-testid="switch-nearby-events"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Business messages</p>
                <p className="text-sm text-muted-foreground">
                  Replies and follow-ups from restaurants, trucks, hosts, and
                  suppliers
                </p>
              </div>
              <Switch
                checked={prefs.topics.businessMessages}
                onCheckedChange={(next) =>
                  setTopics({ businessMessages: next })
                }
                data-testid="switch-business-messages"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Recommendations</p>
                <p className="text-sm text-muted-foreground">
                  Signals from favorites, follows, recommendations, and local
                  food activity
                </p>
              </div>
              <Switch
                checked={prefs.topics.recommendations}
                onCheckedChange={(next) => setTopics({ recommendations: next })}
                data-testid="switch-recommendations"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Account and security</p>
                <p className="text-sm text-muted-foreground">
                  Verification, password, payment, and safety updates
                </p>
              </div>
              <Switch
                checked={prefs.topics.account}
                onCheckedChange={(next) => setTopics({ account: next })}
                data-testid="switch-account-security"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <MapPin className="w-5 h-5 mr-2" />
              Location Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enable location-based alerts</p>
                <p className="text-sm text-muted-foreground">
                  Nearby deals and events based on your live location
                </p>
              </div>
              <Switch
                checked={prefs.location.enabled}
                onCheckedChange={maybeEnableLocationAlerts}
                data-testid="switch-location-enabled"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Radius</Label>
                <Select
                  value={String(prefs.location.radiusKm)}
                  onValueChange={(value) =>
                    setLocation({ radiusKm: Number(value) || 3 })
                  }
                >
                  <SelectTrigger data-testid="select-radius">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 km</SelectItem>
                    <SelectItem value="3">3 km</SelectItem>
                    <SelectItem value="5">5 km</SelectItem>
                    <SelectItem value="10">10 km</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max / day</Label>
                <Select
                  value={String(prefs.location.maxPerDay)}
                  onValueChange={(value) =>
                    setLocation({ maxPerDay: Number(value) || 5 })
                  }
                >
                  <SelectTrigger data-testid="select-max-per-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <Label>Quiet hours</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="time"
                  value={prefs.location.quietHours.start}
                  onChange={(e) =>
                    setLocation({
                      quietHours: {
                        ...prefs.location.quietHours,
                        start: e.target.value,
                      },
                    })
                  }
                  data-testid="input-quiet-start"
                />
                <Input
                  type="time"
                  value={prefs.location.quietHours.end}
                  onChange={(e) =>
                    setLocation({
                      quietHours: {
                        ...prefs.location.quietHours,
                        end: e.target.value,
                      },
                    })
                  }
                  data-testid="input-quiet-end"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end">
          <Button
            onClick={savePrefs}
            disabled={saving || !dirty || isLoading}
            data-testid="button-save-notification-prefs"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save preferences"
            )}
          </Button>
        </div>
      </div>

      <Navigation />
    </div>
  );
}
