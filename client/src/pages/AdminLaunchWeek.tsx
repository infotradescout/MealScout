/**
 * AdminLaunchWeek
 *
 * Operator-friendly launch-week dashboard for non-technical admins.
 * Shows new business owners, where they're stuck, and gives one-click triage.
 *
 * Route: /admin/launch-week
 * Backend: GET /api/admin/launch-week?days=N
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  Store,
  Truck,
  Users as UsersIcon,
  CreditCard,
  Utensils,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface OwnerRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  userType: string;
  emailVerified: boolean;
  createdAt: string;
  stripeSubscriptionId: string | null;
  trialEndsAt: string | null;
  totalMenus: number;
  totalItems: number;
  setupScore: number;
  stuck: boolean;
  checklist: {
    emailVerified: boolean;
    hasBusiness: boolean;
    hasMenu: boolean;
    hasItems: boolean;
    isVerified: boolean;
    hasSubscription: boolean;
  };
  restaurants: Array<{
    id: string;
    name: string;
    businessType: string;
    city: string | null;
    state: string | null;
    isVerified: boolean;
    isActive: boolean;
    menuCount: number;
    itemCount: number;
    createdAt: string;
  }>;
}

interface LaunchWeekResponse {
  summary: {
    windowDays: number;
    totalNewOwners: number;
    newToday: number;
    unverifiedEmails: number;
    noBusinessYet: number;
    noMenuYet: number;
    stuck: number;
    subscribed: number;
    byType: { restaurant_owner: number; food_truck: number };
  };
  owners: OwnerRow[];
}

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
};

export default function AdminLaunchWeek() {
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState<
    "all" | "stuck" | "noMenu" | "subscribed" | "today"
  >("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<LaunchWeekResponse>({
      queryKey: ["admin-launch-week", days],
      queryFn: async () => {
        const res = await fetch(apiUrl(`/api/admin/launch-week?days=${days}`), {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        return res.json();
      },
      refetchInterval: 60_000, // auto-refresh every minute during launch
    });

  const owners = (data?.owners || []).filter((o) => {
    if (filter === "stuck" && !o.stuck) return false;
    if (filter === "noMenu" && (!o.checklist.hasBusiness || o.checklist.hasMenu))
      return false;
    if (filter === "subscribed" && !o.checklist.hasSubscription) return false;
    if (filter === "today") {
      const today = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (new Date(o.createdAt) < today) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const blob = [
        o.email,
        o.firstName,
        o.lastName,
        o.phone,
        ...o.restaurants.map((r) => r.name),
        ...o.restaurants.map((r) => r.city),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6" />
            Launch Week
          </h1>
          <p className="text-sm text-muted-foreground">
            New business owners, where they're stuck, and what to do next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="3">Last 3 days</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<UsersIcon className="w-4 h-4" />}
          label="New owners"
          value={data?.summary.totalNewOwners ?? 0}
          sub={`${data?.summary.newToday ?? 0} today`}
        />
        <SummaryCard
          icon={<AlertTriangle className="w-4 h-4 text-orange-500" />}
          label="Stuck (need help)"
          value={data?.summary.stuck ?? 0}
          sub="No menu after 6h"
          tone={data?.summary.stuck ? "warn" : "ok"}
          onClick={() => setFilter("stuck")}
          active={filter === "stuck"}
        />
        <SummaryCard
          icon={<Utensils className="w-4 h-4" />}
          label="No menu yet"
          value={data?.summary.noMenuYet ?? 0}
          sub="Has business, no menu"
          onClick={() => setFilter("noMenu")}
          active={filter === "noMenu"}
        />
        <SummaryCard
          icon={<CreditCard className="w-4 h-4 text-emerald-500" />}
          label="Subscribed"
          value={data?.summary.subscribed ?? 0}
          sub={`of ${data?.summary.totalNewOwners ?? 0}`}
          onClick={() => setFilter("subscribed")}
          active={filter === "subscribed"}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search by name, email, phone, restaurant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1 flex-wrap">
          {(["all", "today", "stuck", "noMenu", "subscribed"] as const).map(
            (k) => (
              <Button
                key={k}
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => setFilter(k)}
              >
                {k === "all"
                  ? "All"
                  : k === "today"
                    ? "Today"
                    : k === "stuck"
                      ? "Stuck"
                      : k === "noMenu"
                        ? "No menu"
                        : "Subscribed"}
              </Button>
            ),
          )}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Auto-refreshes every minute
        </div>
      </div>

      {/* Owners list */}
      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="py-10 text-center text-destructive">
            Failed to load. Make sure you're signed in as admin.
          </CardContent>
        </Card>
      ) : owners.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No owners match your filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {owners.map((o) => (
            <OwnerCard key={o.id} owner={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  tone?: "ok" | "warn";
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Card
      className={`cursor-${onClick ? "pointer" : "default"} transition ${
        active ? "ring-2 ring-primary" : ""
      } ${tone === "warn" && value > 0 ? "border-orange-300" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="pb-1">
        <CardDescription className="flex items-center gap-1.5 text-xs">
          {icon}
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function OwnerCard({ owner }: { owner: OwnerRow }) {
  const name =
    [owner.firstName, owner.lastName].filter(Boolean).join(" ") ||
    owner.email ||
    "(no name)";
  const isFoodTruck = owner.userType === "food_truck";

  return (
    <Card className={owner.stuck ? "border-orange-300 bg-orange-50/30" : ""}>
      <CardContent className="py-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-shrink-0 mt-1">
            {isFoodTruck ? (
              <Truck className="w-5 h-5 text-muted-foreground" />
            ) : (
              <Store className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{name}</span>
              {owner.stuck && (
                <Badge variant="outline" className="border-orange-400 text-orange-700">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Stuck
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {isFoodTruck ? "Food truck" : "Restaurant/Bar"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                signed up {fmtDate(owner.createdAt)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap mt-0.5">
              {owner.email && (
                <a href={`mailto:${owner.email}`} className="hover:underline flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {owner.email}
                </a>
              )}
              {owner.phone && <span>{owner.phone}</span>}
            </div>
            {owner.restaurants.length > 0 && (
              <div className="mt-2 text-sm">
                {owner.restaurants.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 text-xs flex-wrap"
                  >
                    <span className="font-medium">{r.name}</span>
                    {r.city && (
                      <span className="text-muted-foreground">
                        {r.city}
                        {r.state ? `, ${r.state}` : ""}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      • {r.menuCount} menu{r.menuCount === 1 ? "" : "s"},{" "}
                      {r.itemCount} item{r.itemCount === 1 ? "" : "s"}
                    </span>
                    {r.isVerified && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <ChecklistDots checklist={owner.checklist} />
            <div className="text-[10px] text-muted-foreground">
              setup {owner.setupScore}/6
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChecklistDots({
  checklist,
}: {
  checklist: OwnerRow["checklist"];
}) {
  const items: Array<{ key: keyof OwnerRow["checklist"]; label: string }> = [
    { key: "emailVerified", label: "Email verified" },
    { key: "hasBusiness", label: "Created business" },
    { key: "hasMenu", label: "Created menu" },
    { key: "hasItems", label: "Added items" },
    { key: "isVerified", label: "Business verified by admin" },
    { key: "hasSubscription", label: "Subscribed" },
  ];
  return (
    <div className="flex gap-0.5">
      {items.map((it) => {
        const ok = checklist[it.key];
        return (
          <span
            key={it.key}
            title={`${it.label}: ${ok ? "yes" : "no"}`}
            className={`w-3 h-3 rounded-full ${
              ok ? "bg-emerald-500" : "bg-muted border border-muted-foreground/30"
            }`}
          />
        );
      })}
    </div>
  );
}
