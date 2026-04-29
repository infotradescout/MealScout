import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

type PermissionSet = {
  manageDeals: boolean;
  manageParkingPass: boolean;
  viewAnalytics: boolean;
  manageProfile: boolean;
};

const defaultPermissions: PermissionSet = {
  manageDeals: true,
  manageParkingPass: true,
  viewAnalytics: false,
  manageProfile: false,
};

const permissionPresets: Array<{
  label: string;
  description: string;
  permissions: PermissionSet;
}> = [
  {
    label: "Manager",
    description: "Deals, parking, analytics, profile, and menus.",
    permissions: {
      manageDeals: true,
      manageParkingPass: true,
      viewAnalytics: true,
      manageProfile: true,
    },
  },
  {
    label: "Shift Lead",
    description: "Daily deals and parking operations.",
    permissions: {
      manageDeals: true,
      manageParkingPass: true,
      viewAnalytics: false,
      manageProfile: false,
    },
  },
  {
    label: "Marketing",
    description: "Deals, analytics, profile, and menu updates.",
    permissions: {
      manageDeals: true,
      manageParkingPass: false,
      viewAnalytics: true,
      manageProfile: true,
    },
  },
];

export default function BusinessTeamPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [permissions, setPermissions] = useState<PermissionSet>(defaultPermissions);
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [memberPermissionDrafts, setMemberPermissionDrafts] = useState<
    Record<string, PermissionSet>
  >({});

  const { data: teamData } = useQuery<{
    restaurants: Array<{ id: string; name: string; isOwner?: boolean }>;
    members: Array<{
      id: string;
      restaurantId: string;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      permissions: PermissionSet;
      status: string;
    }>;
    invites: Array<{
      id: string;
      restaurantId: string;
      email?: string | null;
      status: string;
      expiresAt?: string | null;
      permissions: PermissionSet;
    }>;
  }>({
    queryKey: ["/api/business/team"],
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: funnel } = useQuery<{
    days: number;
    shareHubActions: {
      total: number;
      byAction: {
        open: number;
        copy_link: number;
        copy_outreach: number;
        share: number;
      };
      topItems: Array<{ itemKey: string; count: number }>;
    };
    referrals: {
      clicked: number;
      signedUp: number;
      activated: number;
      paid: number;
      signupRate: number;
      paidRate: number;
    };
  }>({
    queryKey: ["/api/business/team/funnel"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const restaurants = teamData?.restaurants || [];

  useEffect(() => {
    if (!selectedRestaurantId && restaurants.length > 0) {
      setSelectedRestaurantId(restaurants[0].id);
    }
  }, [restaurants, selectedRestaurantId]);

  const grouped = useMemo(() => {
    const members = teamData?.members || [];
    const invites = teamData?.invites || [];
    return restaurants.map((restaurant) => ({
      restaurant,
      members: members.filter((m) => m.restaurantId === restaurant.id),
      invites: invites.filter((i) => i.restaurantId === restaurant.id),
    }));
  }, [restaurants, teamData?.members, teamData?.invites]);

  const createInvite = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurantId) {
        throw new Error("Select a business first.");
      }
      const res = await apiRequest("POST", "/api/business/team/invites", {
        restaurantId: selectedRestaurantId,
        email: inviteEmail.trim() || null,
        permissions,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setLatestInviteLink(String(data?.inviteUrl || ""));
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
      toast({
        title: "Invite link created",
        description: "Share this link with your employee.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not create invite",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) =>
      await apiRequest("POST", `/api/business/team/invites/${inviteId}/revoke`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
    },
  });

  const refreshInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/business/team/invites/${inviteId}/refresh`,
      );
      return res.json();
    },
    onSuccess: (data: any) => {
      setLatestInviteLink(String(data?.inviteUrl || ""));
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
      toast({
        title: "Invite link refreshed",
        description: "Copy the new link below.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Could not refresh invite",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (membershipId: string) =>
      await apiRequest("DELETE", `/api/business/team/members/${membershipId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
    },
  });
  const updateMemberPermissions = useMutation({
    mutationFn: async (payload: { membershipId: string; permissions: PermissionSet }) =>
      await apiRequest("PATCH", `/api/business/team/members/${payload.membershipId}`, {
        permissions: payload.permissions,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
      toast({ title: "Permissions updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Could not update permissions.",
        variant: "destructive",
      });
    },
  });

  const copyInviteLink = async () => {
    if (!latestInviteLink) return;
    await navigator.clipboard.writeText(latestInviteLink);
    toast({ title: "Copied", description: "Invite link copied." });
  };

  return (
    <div className="max-w-3xl mx-auto min-h-screen bg-[var(--bg-layered)]">
      <BackHeader title="Team Access" fallbackHref="/restaurant-owner-dashboard" />
      <main className="p-4 space-y-4 pb-28">
        <Card className="shadow-clean border-[color:var(--border-subtle)]">
          <CardHeader>
            <CardTitle>Share to Conversion Snapshot (30d)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
              <div className="text-xs text-[color:var(--text-secondary)]">Share actions</div>
              <div className="text-lg font-semibold">{funnel?.shareHubActions.total ?? 0}</div>
            </div>
            <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
              <div className="text-xs text-[color:var(--text-secondary)]">Referral clicks</div>
              <div className="text-lg font-semibold">{funnel?.referrals.clicked ?? 0}</div>
            </div>
            <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
              <div className="text-xs text-[color:var(--text-secondary)]">Signed up</div>
              <div className="text-lg font-semibold">{funnel?.referrals.signedUp ?? 0}</div>
            </div>
            <div className="rounded-md border border-[color:var(--border-subtle)] p-3">
              <div className="text-xs text-[color:var(--text-secondary)]">Paid conversion</div>
              <div className="text-lg font-semibold">{funnel?.referrals.paidRate ?? 0}%</div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-clean border-[color:var(--border-subtle)]">
          <CardHeader>
            <CardTitle>Create Employee Access Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Business</Label>
              <select
                className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-sm"
                value={selectedRestaurantId}
                onChange={(e) => setSelectedRestaurantId(e.target.value)}
              >
                <option value="">Select a business</option>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedRestaurantId ? (
              <div className="flex flex-wrap gap-2">
                <Link href={`/menu-builder/${selectedRestaurantId}`}>
                  <Button type="button" size="sm" variant="outline">
                    Menu Builder
                  </Button>
                </Link>
                <Link href={`/edit-restaurant/${selectedRestaurantId}`}>
                  <Button type="button" size="sm" variant="outline">
                    Edit Profile
                  </Button>
                </Link>
                <Link href="/restaurant-owner-dashboard">
                  <Button type="button" size="sm" variant="outline">
                    Dashboard
                  </Button>
                </Link>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Employee email (optional)</Label>
              <Input
                placeholder="employee@yourbusiness.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Access preset</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {permissionPresets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="rounded-md border border-[color:var(--border-subtle)] p-3 text-left text-sm hover:bg-muted/50"
                      onClick={() => setPermissions(preset.permissions)}
                    >
                      <div className="font-medium">{preset.label}</div>
                      <div className="mt-1 text-xs text-[color:var(--text-secondary)]">
                        {preset.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={permissions.manageDeals}
                  onCheckedChange={(value) =>
                    setPermissions((prev) => ({ ...prev, manageDeals: value === true }))
                  }
                />
                Manage deals
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={permissions.manageParkingPass}
                  onCheckedChange={(value) =>
                    setPermissions((prev) => ({
                      ...prev,
                      manageParkingPass: value === true,
                    }))
                  }
                />
                Manage parking pass
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={permissions.viewAnalytics}
                  onCheckedChange={(value) =>
                    setPermissions((prev) => ({ ...prev, viewAnalytics: value === true }))
                  }
                />
                View analytics
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={permissions.manageProfile}
                  onCheckedChange={(value) =>
                    setPermissions((prev) => ({ ...prev, manageProfile: value === true }))
                  }
                />
                Edit profile and menus
              </Label>
            </div>

            <Button
              className="w-full"
              onClick={() => createInvite.mutate()}
              disabled={createInvite.isPending}
            >
              Generate Access Link
            </Button>

            {latestInviteLink ? (
              <div className="rounded-md border border-[color:var(--border-subtle)] p-3 space-y-2">
                <p className="text-sm font-medium">New invite link</p>
                <p className="text-xs text-[color:var(--text-secondary)] break-all">
                  {latestInviteLink}
                </p>
                <Button variant="outline" className="w-full" onClick={copyInviteLink}>
                  Copy Link
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {grouped.map((group) => (
          <Card
            key={group.restaurant.id}
            className="shadow-clean border-[color:var(--border-subtle)]"
          >
            <CardHeader>
              <CardTitle>{group.restaurant.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold mb-2">Active team members</h4>
                {group.members.length === 0 ? (
                  <p className="text-sm text-[color:var(--text-secondary)]">No team members yet.</p>
                ) : (
                  <div className="space-y-2">
                    {group.members.map((member) => (
                      <div
                        key={member.id}
                        className="rounded-md border border-[color:var(--border-subtle)] p-3"
                      >
                        <div className="text-sm font-medium">
                          {member.firstName || member.lastName
                            ? `${member.firstName || ""} ${member.lastName || ""}`.trim()
                            : member.email || "Team member"}
                        </div>
                        <div className="text-xs text-[color:var(--text-secondary)] mb-2">
                          {member.email}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mb-3">
                          {(
                            [
                              ["manageDeals", "Manage deals"],
                              ["manageParkingPass", "Manage parking pass"],
                              ["viewAnalytics", "View analytics"],
                              ["manageProfile", "Edit profile and menus"],
                            ] as Array<[keyof PermissionSet, string]>
                          ).map(([key, label]) => {
                            const current =
                              memberPermissionDrafts[member.id] || member.permissions;
                            return (
                              <Label
                                key={`${member.id}-${key}`}
                                className="flex items-center gap-2 font-normal"
                              >
                                <Checkbox
                                  checked={current[key]}
                                  onCheckedChange={(value) =>
                                    setMemberPermissionDrafts((prev) => ({
                                      ...prev,
                                      [member.id]: {
                                        ...current,
                                        [key]: value === true,
                                      },
                                    }))
                                  }
                                />
                                {label}
                              </Label>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              updateMemberPermissions.mutate({
                                membershipId: member.id,
                                permissions:
                                  memberPermissionDrafts[member.id] || member.permissions,
                              })
                            }
                          >
                            Save Permissions
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeMember.mutate(member.id)}
                          >
                            Remove Access
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Pending invites</h4>
                {group.invites.filter((invite) => invite.status === "pending").length === 0 ? (
                  <p className="text-sm text-[color:var(--text-secondary)]">No pending invites.</p>
                ) : (
                  <div className="space-y-2">
                    {group.invites
                      .filter((invite) => invite.status === "pending")
                      .map((invite) => (
                        <div
                          key={invite.id}
                          className="rounded-md border border-[color:var(--border-subtle)] p-3"
                        >
                          <div className="text-sm">{invite.email || "Invite link only"}</div>
                        <div className="text-xs text-[color:var(--text-secondary)] mb-2">
                          Expires{" "}
                            {invite.expiresAt
                              ? new Date(invite.expiresAt).toLocaleDateString()
                              : "soon"}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={refreshInvite.isPending}
                            onClick={() => refreshInvite.mutate(invite.id)}
                          >
                            Refresh Link
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => revokeInvite.mutate(invite.id)}
                          >
                            Revoke Invite
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
