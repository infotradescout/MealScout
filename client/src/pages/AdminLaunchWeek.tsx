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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  Store,
  Truck,
  Users as UsersIcon,
  CreditCard,
  Eye,
  FileWarning,
  Send,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  totalFailedImports: number;
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
    publicPreviewUrl: string;
    importAttempts: number;
    failedImports: number;
    lastImportFailure: {
      source: string;
      status: string;
      itemsImported: number;
      itemsSkipped: number;
      errorCount: number;
      /** First error reason, truncated server-side to ~240 chars. */
      reason: string | null;
      createdAt: string | null;
    } | null;
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
    failedImports: number;
    stuck: number;
    subscribed: number;
    byType: {
      restaurant_owner: number;
      caterer?: number;
      private_chef?: number;
      food_truck: number;
    };
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
    "all" | "stuck" | "noMenu" | "failedImport" | "subscribed" | "today"
  >("all");
  const [search, setSearch] = useState("");
  const digest = useDailyDigestAction();
  const discoverabilityAlert = useDiscoverabilityAlertAction();

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
    if (filter === "failedImport" && o.totalFailedImports <= 0) return false;
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => digest.mutate()}
            disabled={digest.isPending}
          >
            <Mail className="w-4 h-4 mr-1" />
            Send digest
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => discoverabilityAlert.mutate()}
            disabled={discoverabilityAlert.isPending}
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            Run 6h alerts
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
          icon={<FileWarning className="w-4 h-4 text-red-500" />}
          label="Import failed"
          value={data?.summary.failedImports ?? 0}
          sub="Needs manual help"
          tone={data?.summary.failedImports ? "warn" : "ok"}
          onClick={() => setFilter("failedImport")}
          active={filter === "failedImport"}
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

      {/* Toolbar
          ----
          Mobile-first stacked layout: search on its own row, then filter
          pill scroller on its own row, then "Auto-refreshes" hint on its
          own row. On md+ everything stays on one row. This eliminates
          the overlap between the pill row and the auto-refresh hint that
          was happening on narrow viewports. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap">
        <Input
          placeholder="Search by name, email, phone, restaurant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:max-w-sm"
        />
        {/* Horizontal-scroll pill row on mobile so labels never clip */}
        <div
          className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 md:flex-wrap md:overflow-visible md:mx-0 md:px-0 md:pb-0"
          aria-label="Filter signups"
        >
          {(
            [
              "all",
              "today",
              "stuck",
              "noMenu",
              "failedImport",
              "subscribed",
            ] as const
          ).map((k) => {
            const isActive = filter === k;
            const label =
              k === "all"
                ? "All"
                : k === "today"
                  ? "Today"
                  : k === "stuck"
                    ? "Stuck"
                    : k === "noMenu"
                      ? "No menu"
                      : k === "failedImport"
                        ? "Import failed"
                        : "Subscribed";
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={isActive}
                className={
                  "shrink-0 inline-flex items-center justify-center whitespace-nowrap " +
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                  (isActive
                    ? "bg-amber-500 text-black border-amber-500 shadow-sm"
                    : "bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground")
                }
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground md:ml-auto">
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

function useDailyDigestAction() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(apiUrl("/api/admin/launch-week/digest/send"), {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: () => {
      toast({
        title: "Daily digest sent",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Digest failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });
}

function useDiscoverabilityAlertAction() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(
        apiUrl("/api/admin/launch-week/alerts/discoverability/run"),
        {
          method: "POST",
          credentials: "include",
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: (result: any) => {
      const reason = String(result?.reason || "");
      if (result?.sent) {
        toast({
          title: "6h alerts sent",
          description: `${result.alerted ?? 0} owner(s) alerted`,
        });
      } else {
        toast({
          title: "6h alert scan complete",
          description: reason || "No new owners needed alerts",
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: "6h alert scan failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });
}

function useOwnerAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (vars: { userId: string; action: string }) => {
      const res = await fetch(
        apiUrl(`/api/admin/launch-week/owners/${vars.userId}/action`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: vars.action }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: (data, vars) => {
      const labels: Record<string, string> = {
        "resend-verification": "Verification email sent",
        "send-menu-nudge": "Menu nudge sent",
        "send-help-offer": "Help offer sent",
      };
      toast({
        title: labels[vars.action] || "Done",
        description: data?.skipped ? `Skipped: ${data.skipped}` : undefined,
      });
      qc.invalidateQueries({ queryKey: ["admin-launch-week"] });
    },
    onError: (err: any) => {
      toast({
        title: "Action failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });
}

type UserMessageVars = {
  userId: string;
  subject: string;
  message: string;
  context?: string;
};

function useUserMessageAction() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (vars: UserMessageVars) => {
      const res = await fetch(apiUrl("/api/admin/email/user-message"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || `Failed (${res.status})`);
      return body;
    },
    onSuccess: (_data, vars) => {
      toast({
        title: "Email sent",
        description: vars.subject,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Email failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });
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

function MessageUserDialog({
  userId,
  email,
  name,
  buttonLabel = "Message user",
  defaultSubject,
  defaultMessage,
  context,
  buttonVariant = "outline",
  buttonSize = "sm",
}: {
  userId: string;
  email: string | null;
  name: string;
  buttonLabel?: string;
  defaultSubject: string;
  defaultMessage: string;
  context?: string;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
  buttonSize?: React.ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const sendMessage = useUserMessageAction();
  const fieldId = `${userId}-${context || buttonLabel}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-",
  );
  const canSend =
    Boolean(email) &&
    subject.trim().length >= 3 &&
    message.trim().length > 0 &&
    !sendMessage.isPending;

  const handleSend = () => {
    if (!canSend) return;
    sendMessage.mutate(
      {
        userId,
        subject: subject.trim(),
        message: message.trim(),
        context,
      },
      {
        onSuccess: () => setOpen(false),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size={buttonSize}
          variant={buttonVariant}
          disabled={!email}
          title={email ? undefined : "User has no email on file"}
        >
          <Mail className="w-3 h-3 mr-1" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Message {name}</DialogTitle>
          <DialogDescription>
            This sends a real MealScout support email to {email}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`subject-${fieldId}`}>
              Subject
            </label>
            <Input
              id={`subject-${fieldId}`}
              value={subject}
              maxLength={160}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`message-${fieldId}`}>
              Message
            </label>
            <Textarea
              id={`message-${fieldId}`}
              rows={8}
              maxLength={5000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            They can reply directly to the email if they need help.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={sendMessage.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            <Send className="w-3 h-3 mr-1" />
            {sendMessage.isPending ? "Sending..." : "Send email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OwnerCard({ owner }: { owner: OwnerRow }) {
  const name =
    [owner.firstName, owner.lastName].filter(Boolean).join(" ") ||
    owner.email ||
    "(no name)";
  const firstName = /^(admin|administrator|staff|support)$/i.test(
    String(owner.firstName || "").trim(),
  )
    ? "there"
    : owner.firstName || "there";
  const isFoodTruck = owner.userType === "food_truck";
  const action = useOwnerAction();
  const run = (a: string) =>
    action.mutate({ userId: owner.id, action: a });
  const busy = action.isPending;

  return (
    <Card
      className={
        owner.stuck
          ? "border-amber-500/60 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-400/[0.06]"
          : ""
      }
    >
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
                    {r.failedImports > 0 && (
                      <Badge
                        variant="outline"
                        className="border-red-400/70 text-red-500 dark:border-red-400/60 dark:text-red-300"
                      >
                        <FileWarning className="w-3 h-3 mr-1" />
                        {r.failedImports} import failed
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" asChild>
                      <a href={r.publicPreviewUrl} target="_blank" rel="noreferrer">
                        <Eye className="w-3 h-3 mr-1" />
                        Preview
                      </a>
                    </Button>
                    {r.lastImportFailure && (
                      <span className="basis-full text-red-500 dark:text-red-300 leading-snug">
                        Last {r.lastImportFailure.source} import{" "}
                        {r.lastImportFailure.createdAt
                          ? fmtDate(r.lastImportFailure.createdAt)
                          : "recently"}
                        {r.lastImportFailure.errorCount > 0
                          ? `, ${r.lastImportFailure.errorCount} error${
                              r.lastImportFailure.errorCount === 1 ? "" : "s"
                            }`
                          : ""}
                        {r.lastImportFailure.reason && (
                          <span
                            className="block text-[11px] text-red-400 dark:text-red-300/90 mt-0.5 break-words"
                            title={r.lastImportFailure.reason}
                          >
                            → {r.lastImportFailure.reason}
                          </span>
                        )}
                      </span>
                    )}
                    {r.failedImports > 0 && (
                      <MessageUserDialog
                        userId={owner.id}
                        email={owner.email}
                        name={name}
                        buttonLabel="Tell them fixed"
                        buttonVariant="outline"
                        defaultSubject={`MealScout menu import update for ${r.name}`}
                        defaultMessage={`Hi ${firstName},\n\nGood news - I fixed the issue that was blocking the menu import for ${r.name}. Please try the import again from your MealScout dashboard.\n\nIf it still gives you trouble, reply to this email and I will help directly.\n\nThanks,\nThe MealScout team`}
                        context={`launch-week-menu-import:${r.id}`}
                      />
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
        {/* One-click triage actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!owner.checklist.emailVerified && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run("resend-verification")}
            >
              Resend verify email
            </Button>
          )}
          {owner.checklist.hasBusiness && !owner.checklist.hasMenu && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run("send-menu-nudge")}
            >
              Send menu nudge
            </Button>
          )}
          {owner.stuck && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run("send-help-offer")}
            >
              Offer to set it up
            </Button>
          )}
          {owner.restaurants.length > 0 &&
            owner.restaurants.some((r) => !r.isVerified || !r.isActive) && (
              <Badge
                variant="outline"
                className="border-amber-400/70 text-amber-600 dark:border-amber-300/60 dark:text-amber-300 px-2 py-1 text-[11px]"
                title="Business verification now requires uploaded commercial insurance or acceptable proof. Use ‘Message about proof’ to request the document."
              >
                <FileWarning className="w-3 h-3 mr-1" />
                Needs insurance proof
              </Badge>
            )}
          {owner.email && (
            <MessageUserDialog
              userId={owner.id}
              email={owner.email}
              name={name}
              buttonLabel="Message user"
              buttonVariant="outline"
              defaultSubject="Quick update from MealScout"
              defaultMessage={`Hi ${firstName},\n\nQuick update from MealScout:\n\n\nThanks,\nThe MealScout team`}
              context="launch-week-general"
            />
          )}
          {owner.email &&
            owner.restaurants.length > 0 &&
            owner.restaurants.some((r) => !r.isVerified || !r.isActive) && (
              <MessageUserDialog
                userId={owner.id}
                email={owner.email}
                name={name}
                buttonLabel="Message about proof"
                buttonVariant="outline"
                defaultSubject="Quick MealScout setup help"
                defaultMessage={`Hi ${firstName},\n\nThanks for setting up your MealScout listing. You're almost there.\n\nWhen you have a minute, please upload a photo or PDF of your insurance document so we can finish reviewing the listing. You can keep adding your menu, photos, and details now.\n\nYou can upload it from your dashboard, or reply here with the file and I will help get it added.\n\nThanks,\nThe MealScout team`}
                context="launch-week-insurance-proof"
              />
            )}
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
