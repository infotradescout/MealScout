import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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

export default function BusinessTeamPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [permissions, setPermissions] = useState<PermissionSet>(defaultPermissions);
  const [latestInviteLink, setLatestInviteLink] = useState("");

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

  const restaurants = teamData?.restaurants || [];

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
      return await apiRequest("POST", "/api/business/team/invites", {
        restaurantId: selectedRestaurantId,
        email: inviteEmail.trim() || null,
        permissions,
      });
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

  const removeMember = useMutation({
    mutationFn: async (membershipId: string) =>
      await apiRequest("DELETE", `/api/business/team/members/${membershipId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
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

            <div className="space-y-2">
              <Label>Employee email (optional)</Label>
              <Input
                placeholder="employee@yourbusiness.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                Edit business profile
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => removeMember.mutate(member.id)}
                        >
                          Remove Access
                        </Button>
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
