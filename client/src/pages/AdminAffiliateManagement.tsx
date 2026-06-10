import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Link as LinkIcon, Search, Share2, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AffiliateUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  userType: string | null;
  affiliateTag: string | null;
  affiliatePercent: number | null;
  affiliateCloserUserId: string | null;
  affiliateBookerUserId: string | null;
  linksShared: number;
  peopleReferred: number;
  paidReferrals: number;
  affiliateEarningsCents: number;
  mealScoutRevenueCents: number;
  subscriptionRevenueCents: number;
  bookingRevenueCents: number;
};

const formatCurrency = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);

export default function AdminAffiliateManagement() {
  const [search, setSearch] = useState("");
  const [userType, setUserType] = useState("all");
  const [editing, setEditing] = useState<AffiliateUser | null>(null);
  const [percent, setPercent] = useState("");
  const [closerId, setCloserId] = useState("");
  const [bookerId, setBookerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: users = [], refetch } = useQuery<AffiliateUser[]>({
    queryKey: ["admin-affiliates"],
    queryFn: async () => {
      const res = await fetch("/api/admin/affiliates/users");
      if (!res.ok) throw new Error("Failed to fetch affiliate users");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesType =
        userType === "all" ? true : user.userType === userType;
      const label = `${user.firstName || ""} ${user.lastName || ""} ${
        user.email || ""
      } ${user.affiliateTag || ""}`.toLowerCase();
      const matchesSearch = term.length === 0 || label.includes(term);
      return matchesType && matchesSearch;
    });
  }, [users, search, userType]);

  const startEdit = (user: AffiliateUser) => {
    setEditing(user);
    setPercent(String(user.affiliatePercent ?? 5));
    setCloserId(user.affiliateCloserUserId || "");
    setBookerId(user.affiliateBookerUserId || "");
    setError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/affiliates/users/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliatePercent: Number(percent),
          affiliateCloserUserId: closerId || null,
          affiliateBookerUserId: bookerId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update affiliate settings");
      }
      await refetch();
      setEditing(null);
    } catch (err: any) {
      setError(err.message || "Failed to update affiliate settings");
    } finally {
      setSaving(false);
    }
  };

  const getAffiliateLink = (tag: string | null) => {
    if (!tag) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const encodedTag = encodeURIComponent(tag);
    if (!origin) return `/directory/${encodedTag}`;
    return `${origin}/directory/${encodedTag}`;
  };

  const handleCopyLink = async (tag: string | null, userId: string) => {
    const link = getAffiliateLink(tag);
    if (!link) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const el = document.createElement("textarea");
        el.value = link;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      toast({ title: "Affiliate link copied" });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Unable to copy the affiliate link.",
        variant: "destructive",
      });
    }
  };

  const handleShareLink = async (tag: string | null, userId: string) => {
    const link = getAffiliateLink(tag);
    if (!link) return;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Affiliate link",
          text: "Share this affiliate link",
          url: link,
        });
        return;
      }
      await handleCopyLink(tag, userId);
    } catch (err) {
      toast({
        title: "Share failed",
        description: "Unable to share the affiliate link.",
        variant: "destructive",
      });
    }
  };

  const handleCopyTag = async (tag: string | null) => {
    if (!tag) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tag);
      } else {
        const el = document.createElement("textarea");
        el.value = tag;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      toast({ title: "Affiliate tag copied" });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Unable to copy the affiliate tag.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Affiliate Management</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[color:var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, tag..."
              className="w-full rounded-md border border-[var(--border-subtle)] py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={userType}
            onChange={(e) => setUserType(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm sm:w-40"
          >
            <option value="all">All user types</option>
            <option value="customer">Customer</option>
            <option value="restaurant_owner">Restaurant</option>
            <option value="food_truck">Food Truck</option>
            <option value="host">Host</option>
            <option value="event_coordinator">Event Coordinator</option>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
            <option value="duper_admin">Duperrr Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Affiliate Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-semibold">User</TableHead>
                  <TableHead className="text-xs font-semibold">Type</TableHead>
                  <TableHead className="text-xs font-semibold">Tag</TableHead>
                  <TableHead className="text-xs font-semibold">%</TableHead>
                  <TableHead className="text-xs font-semibold">Links</TableHead>
                  <TableHead className="text-xs font-semibold">Ref</TableHead>
                  <TableHead className="text-xs font-semibold">Paid</TableHead>
                  <TableHead className="text-xs font-semibold">
                    Revenue
                  </TableHead>
                  <TableHead className="text-xs font-semibold">
                    Earnings
                  </TableHead>
                  <TableHead className="text-xs font-semibold">
                    Subs/Book
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="text-xs font-medium text-[color:var(--text-primary)]">
                        {user.firstName || "Unnamed"} {user.lastName || ""}
                      </div>
                      <div className="text-2xs text-[color:var(--text-muted)]">
                        {user.email || "No email"}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-2xs text-[color:var(--text-muted)]">
                        <span className="max-w-[100px] truncate">
                          {getAffiliateLink(user.affiliateTag) || "No affiliate link assigned"}
                        </span>
                        {user.affiliateTag && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5"
                                  aria-label="Copy affiliate link"
                                  onClick={() =>
                                    handleCopyLink(user.affiliateTag, user.id)
                                  }
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy link</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5"
                                  aria-label="Share affiliate link"
                                  onClick={() =>
                                    handleShareLink(user.affiliateTag, user.id)
                                  }
                                >
                                  <Share2 className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Share link</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5"
                                  aria-label="Copy affiliate tag"
                                  onClick={() =>
                                    handleCopyTag(user.affiliateTag)
                                  }
                                >
                                  <Tag className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy tag</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-5 w-5"
                                  aria-label="Open affiliate link"
                                  onClick={() => {
                                    const link = getAffiliateLink(
                                      user.affiliateTag,
                                    );
                                    if (link)
                                      window.open(
                                        link,
                                        "_blank",
                                        "noopener,noreferrer",
                                      );
                                  }}
                                >
                                  <LinkIcon className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open link</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-2xs uppercase text-[color:var(--text-muted)]">
                      {user.userType || "unknown"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {user.affiliateTag || "Unassigned"}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {user.affiliatePercent ?? 5}%
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {user.linksShared}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {user.peopleReferred}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {user.paidReferrals}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatCurrency(user.mealScoutRevenueCents)}
                    </TableCell>
                    <TableCell className="text-xs font-medium whitespace-nowrap">
                      {formatCurrency(user.affiliateEarningsCents)}
                    </TableCell>
                    <TableCell>
                      <div className="text-2xs text-[color:var(--text-muted)] space-y-0.5">
                        {formatCurrency(user.subscriptionRevenueCents)} /{" "}
                        {formatCurrency(user.bookingRevenueCents)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => startEdit(user)}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="text-center text-xs text-[color:var(--text-muted)]"
                    >
                      No matching users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={() => setEditing(null)}>
        <DialogContent className="admin-dialog max-w-sm sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Affiliate Settings</DialogTitle>
            <DialogDescription>
              Update commission percent and override booker/closer attribution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Commission Percent</label>
              <input
                type="number"
                min="0"
                max="100"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Closer User ID</label>
              <input
                type="text"
                value={closerId}
                onChange={(e) => setCloserId(e.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Booker User ID</label>
              <input
                type="text"
                value={bookerId}
                onChange={(e) => setBookerId(e.target.value)}
                className="mt-2 w-full rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm"
              />
            </div>
            {error && (
              <p className="text-sm text-[color:var(--status-error)]">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
