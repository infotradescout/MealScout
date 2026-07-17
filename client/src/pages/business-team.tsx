import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import type { Restaurant } from "@shared/schema";
import { isBarBusinessType, isTruckBusinessType } from "@shared/businessTypes";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  Link2,
  Loader2,
  Mail,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import { apiRequest } from "@/lib/queryClient";

type PermissionSet = {
  manageDeals: boolean;
  manageParkingPass: boolean;
  viewAnalytics: boolean;
  manageProfile: boolean;
};

type TeamRestaurant = {
  id: string;
  name: string;
  businessType?: string | null;
  ownerId?: string | null;
  isOwner?: boolean;
  permissions?: PermissionSet;
};

type TeamMember = {
  id: string;
  restaurantId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  permissions: PermissionSet;
  status: string;
};

type TeamInvite = {
  id: string;
  restaurantId: string;
  email?: string | null;
  status: string;
  expiresAt?: string | null;
  permissions: PermissionSet;
};

type TeamData = {
  restaurants: TeamRestaurant[];
  members: TeamMember[];
  invites: TeamInvite[];
};

const emptyPermissions: PermissionSet = {
  manageDeals: false,
  manageParkingPass: false,
  viewAnalytics: false,
  manageProfile: false,
};

const permissionOptions: Array<{
  key: keyof PermissionSet;
  label: string;
  description: string;
}> = [
  {
    key: "manageProfile",
    label: "Profile and photos",
    description: "Edit public details, links, and images",
  },
  {
    key: "manageDeals",
    label: "Deals",
    description: "Create, edit, pause, and remove promotions",
  },
  {
    key: "manageParkingPass",
    label: "Bookings and locations",
    description: "Manage Parking Pass tools, schedules, and bookings",
  },
  {
    key: "viewAnalytics",
    label: "Audience",
    description: "View profile reach and customer activity",
  },
];

function normalizePermissions(value: unknown): PermissionSet {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    manageDeals: source.manageDeals === true,
    manageParkingPass: source.manageParkingPass === true,
    viewAnalytics: source.viewAnalytics === true,
    manageProfile: source.manageProfile === true,
  };
}

function memberName(member: TeamMember) {
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return name || member.email || "Team member";
}

function permissionCount(permissions: PermissionSet) {
  return Object.values(permissions).filter(Boolean).length;
}

function PermissionChoices({
  value,
  onChange,
  disabled = false,
}: {
  value: PermissionSet;
  onChange: (value: PermissionSet) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {permissionOptions.map((option) => (
        <Label
          key={option.key}
          className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 font-normal transition ${
            value[option.key]
              ? "border-orange-300 bg-orange-50"
              : "border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <Checkbox
            checked={value[option.key]}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ ...value, [option.key]: checked === true })
            }
          />
          <span>
            <span className="block text-sm font-black text-stone-950">
              {option.label}
            </span>
            <span className="mt-1 block text-xs leading-5 text-stone-600">
              {option.description}
            </span>
          </span>
        </Label>
      ))}
    </div>
  );
}

export default function BusinessTeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const requestedRestaurantId = new URLSearchParams(search).get("restaurantId") || "";
  const [selectedRestaurantId, setSelectedRestaurantId] = useState(
    requestedRestaurantId,
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [permissions, setPermissions] = useState<PermissionSet>({
    ...emptyPermissions,
  });
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [memberPermissionDrafts, setMemberPermissionDrafts] = useState<
    Record<string, PermissionSet>
  >({});

  const isElevated = ["admin", "duper_admin", "super_admin", "staff"].includes(
    String(user?.userType || ""),
  );

  const {
    data: businesses = [],
    isLoading: loadingBusinesses,
    isError: businessesError,
  } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: Boolean(user),
  });

  const scopedRestaurantId = selectedRestaurantId || requestedRestaurantId;
  const teamQueryKey = ["/api/business/team", scopedRestaurantId || "all"];
  const {
    data: teamData,
    isLoading: loadingTeam,
    isError: teamError,
    error: teamQueryError,
    refetch,
  } = useQuery<TeamData>({
    queryKey: teamQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (scopedRestaurantId) params.set("restaurantId", scopedRestaurantId);
      const response = await fetch(
        `/api/business/team${params.size ? `?${params.toString()}` : ""}`,
        { credentials: "include" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Team access could not be loaded.");
      }
      return payload as TeamData;
    },
    enabled: Boolean(user),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const workspaceBusinesses = useMemo(() => {
    if (businesses.length > 0) return businesses;
    return (teamData?.restaurants || []).map(
      (business) =>
        ({
          ...business,
          isFoodTruck: isTruckBusinessType(business.businessType),
        }) as Restaurant,
    );
  }, [businesses, teamData?.restaurants]);

  useEffect(() => {
    if (workspaceBusinesses.length === 0) return;
    const requestedIsAvailable = workspaceBusinesses.some(
      (business) => business.id === requestedRestaurantId,
    );
    const selectedIsAvailable = workspaceBusinesses.some(
      (business) => business.id === selectedRestaurantId,
    );
    if (requestedIsAvailable && requestedRestaurantId !== selectedRestaurantId) {
      setSelectedRestaurantId(requestedRestaurantId);
      return;
    }
    if (!selectedIsAvailable) {
      setSelectedRestaurantId(workspaceBusinesses[0].id);
    }
  }, [requestedRestaurantId, selectedRestaurantId, workspaceBusinesses]);

  useEffect(() => {
    setLatestInviteLink("");
    setMemberPermissionDrafts({});
  }, [selectedRestaurantId]);

  const currentBusiness = workspaceBusinesses.find(
    (business) => business.id === selectedRestaurantId,
  );
  const currentTeamRestaurant = teamData?.restaurants.find(
    (business) => business.id === selectedRestaurantId,
  );
  const canManageTeam = Boolean(isElevated || currentTeamRestaurant?.isOwner);
  const currentMembers = (teamData?.members || []).filter(
    (member) => member.restaurantId === selectedRestaurantId,
  );
  const currentInvites = (teamData?.invites || []).filter(
    (invite) => invite.restaurantId === selectedRestaurantId,
  );
  const pendingInvites = currentInvites.filter(
    (invite) => invite.status === "pending",
  );
  const hasSelectedPermissions = permissionCount(permissions) > 0;

  const publicProfileHref = currentBusiness
    ? buildPublicProfilePath({
        entityType: isTruckBusinessType(currentBusiness.businessType)
          ? "truck"
          : isBarBusinessType(currentBusiness.businessType)
            ? "bar"
            : "restaurant",
        id: currentBusiness.id,
        name: currentBusiness.name,
      })
    : null;

  const invalidateTeam = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/business/team"] });
  };

  const createInvite = useMutation({
    mutationFn: async () => {
      if (!selectedRestaurantId) throw new Error("Select a business first.");
      if (!hasSelectedPermissions) {
        throw new Error("Choose at least one area this person can access.");
      }
      const response = await apiRequest("POST", "/api/business/team/invites", {
        restaurantId: selectedRestaurantId,
        email: inviteEmail.trim() || null,
        permissions,
      });
      return response.json();
    },
    onSuccess: async (payload: any) => {
      setLatestInviteLink(String(payload?.inviteUrl || ""));
      setInviteEmail("");
      setPermissions({ ...emptyPermissions });
      await invalidateTeam();
      toast({
        title: "Access link ready",
        description: "Copy and send it to the person you want to invite.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create access link",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) =>
      apiRequest("POST", `/api/business/team/invites/${inviteId}/revoke`),
    onSuccess: async () => {
      await invalidateTeam();
      toast({ title: "Invite revoked" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not revoke invite",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeMember = useMutation({
    mutationFn: (membershipId: string) =>
      apiRequest("DELETE", `/api/business/team/members/${membershipId}`),
    onSuccess: async () => {
      await invalidateTeam();
      toast({ title: "Team access removed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not remove access",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMemberPermissions = useMutation({
    mutationFn: async (payload: {
      membershipId: string;
      permissions: PermissionSet;
    }) =>
      apiRequest(
        "PATCH",
        `/api/business/team/members/${payload.membershipId}`,
        { permissions: payload.permissions },
      ),
    onSuccess: async (_response, variables) => {
      setMemberPermissionDrafts((current) => {
        const next = { ...current };
        delete next[variables.membershipId];
        return next;
      });
      await invalidateTeam();
      toast({ title: "Permissions updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not update permissions",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyInviteLink = async () => {
    if (!latestInviteLink) return;
    try {
      await navigator.clipboard.writeText(latestInviteLink);
      toast({ title: "Access link copied" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the link and copy it manually.",
        variant: "destructive",
      });
    }
  };

  const handleBusinessChange = (businessId: string) => {
    setSelectedRestaurantId(businessId);
    setLocation(`/business-team?restaurantId=${encodeURIComponent(businessId)}`);
  };

  if (loadingBusinesses || (loadingTeam && !currentBusiness)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] text-stone-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Loading team access…
      </div>
    );
  }

  if (businessesError || workspaceBusinesses.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] p-4">
        <Card className="max-w-lg border-orange-200 bg-orange-50">
          <CardContent className="p-6 text-center">
            <Users className="mx-auto h-10 w-10 text-orange-700" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-black text-stone-950">
              Connect a business before adding a team
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              Team access belongs to a claimed business profile.
            </p>
            <Button asChild className="mt-5">
              <Link href="/claim-business">Claim a business</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentBusiness) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)]">
        <Loader2 className="h-6 w-6 animate-spin text-orange-700" aria-hidden="true" />
      </div>
    );
  }

  return (
    <BusinessWorkspaceShell
      activeModule="team"
      business={currentBusiness}
      businesses={workspaceBusinesses}
      onBusinessChange={handleBusinessChange}
      publicProfileHref={publicProfileHref}
      capabilities={{ team: true, payments: canManageTeam }}
    >
      <main
        className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-6 lg:py-8"
        data-testid="business-team-workspace"
      >
        <section className="overflow-hidden rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-cyan-50 to-orange-50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-sm font-black text-sky-800">
                <Users className="h-4 w-4" aria-hidden="true" />
                Team
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-stone-950 sm:text-3xl">
                Give the right people access to {currentBusiness.name}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-stone-700">
                Choose exactly what each person can manage. Account, plan, and payment access stay with the business owner.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:w-64">
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3 text-center shadow-sm">
                <p className="text-2xl font-black text-stone-950">
                  {currentMembers.length}
                </p>
                <p className="text-xs font-semibold text-stone-600">Team members</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/75 p-3 text-center shadow-sm">
                <p className="text-2xl font-black text-stone-950">
                  {pendingInvites.length}
                </p>
                <p className="text-xs font-semibold text-stone-600">Pending invites</p>
              </div>
            </div>
          </div>
        </section>

        {teamError ? (
          <Card className="border-red-200 bg-red-50" data-testid="business-team-error">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3 text-red-950">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-black">Team access is unavailable</p>
                  <p className="mt-1 text-sm text-red-900/80">
                    {teamQueryError instanceof Error
                      ? teamQueryError.message
                      : "Please try again."}
                  </p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !canManageTeam ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex gap-3 p-5 text-amber-950">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-black">Only the business owner can manage team access</p>
                <p className="mt-1 text-sm text-amber-900/80">
                  Your existing workspace permissions are unchanged.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-800">
                    <UserPlus className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-black text-stone-950">Invite someone</h3>
                    <p className="mt-1 text-sm text-stone-600">
                      The link expires in 14 days and can be limited to a specific email.
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-5">
                  <div className="max-w-xl space-y-2">
                    <Label htmlFor="team-invite-email">Email address (optional)</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" aria-hidden="true" />
                      <Input
                        id="team-invite-email"
                        type="email"
                        autoComplete="email"
                        className="pl-10"
                        placeholder="person@example.com"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                      />
                    </div>
                    <p className="text-xs text-stone-500">
                      Leave blank to create a link that can be accepted by any signed-in person you trust.
                    </p>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-stone-950">Choose access</p>
                        <p className="text-xs text-stone-500">Nothing is selected by default.</p>
                      </div>
                      <Badge variant={hasSelectedPermissions ? "secondary" : "outline"}>
                        {permissionCount(permissions)} selected
                      </Badge>
                    </div>
                    <PermissionChoices value={permissions} onChange={setPermissions} />
                  </div>

                  {!hasSelectedPermissions ? (
                    <p className="text-sm font-semibold text-amber-800">
                      Choose at least one area before creating the link.
                    </p>
                  ) : null}

                  <Button
                    type="button"
                    onClick={() => createInvite.mutate()}
                    disabled={!hasSelectedPermissions || createInvite.isPending}
                    data-testid="button-create-team-invite"
                  >
                    {createInvite.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Create access link
                  </Button>

                  {latestInviteLink ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="team-invite-link-ready">
                      <div className="flex items-center gap-2 font-black text-emerald-950">
                        <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                        Access link ready
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Input value={latestInviteLink} readOnly className="bg-white" />
                        <Button type="button" variant="outline" onClick={copyInviteLink}>
                          <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                          Copy link
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-stone-950">Active team</h3>
                      <p className="mt-1 text-sm text-stone-600">Change access at any time.</p>
                    </div>
                    <Badge variant="secondary">{currentMembers.length}</Badge>
                  </div>

                  {loadingTeam ? (
                    <div className="flex min-h-32 items-center justify-center text-sm text-stone-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading team…
                    </div>
                  ) : currentMembers.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-stone-300 p-5 text-center">
                      <Users className="mx-auto h-7 w-7 text-stone-400" aria-hidden="true" />
                      <p className="mt-3 font-black text-stone-900">No team members yet</p>
                      <p className="mt-1 text-sm text-stone-500">
                        Create an access link when someone needs to help manage this business.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      {currentMembers.map((member) => {
                        const savedPermissions = normalizePermissions(member.permissions);
                        const draft = memberPermissionDrafts[member.id] || savedPermissions;
                        return (
                          <div key={member.id} className="rounded-2xl border border-[color:var(--border-subtle)] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-black text-stone-950">{memberName(member)}</p>
                                {member.email ? (
                                  <p className="mt-0.5 truncate text-xs text-stone-500">{member.email}</p>
                                ) : null}
                              </div>
                              <Badge variant="outline">{permissionCount(draft)} areas</Badge>
                            </div>
                            <div className="mt-4">
                              <PermissionChoices
                                value={draft}
                                disabled={updateMemberPermissions.isPending}
                                onChange={(next) =>
                                  setMemberPermissionDrafts((current) => ({
                                    ...current,
                                    [member.id]: next,
                                  }))
                                }
                              />
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  updateMemberPermissions.mutate({
                                    membershipId: member.id,
                                    permissions: draft,
                                  })
                                }
                                disabled={updateMemberPermissions.isPending}
                              >
                                Save access
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button type="button" size="sm" variant="outline">
                                    Remove access
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove {memberName(member)}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      They will immediately lose access to {currentBusiness.name}. You can invite them again later.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Keep access</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => removeMember.mutate(member.id)}>
                                      Remove access
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean">
                <CardContent className="p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black text-stone-950">Pending invites</h3>
                      <p className="mt-1 text-sm text-stone-600">Links expire 14 days after creation.</p>
                    </div>
                    <Badge variant="secondary">{pendingInvites.length}</Badge>
                  </div>

                  {pendingInvites.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-stone-300 p-5 text-center">
                      <Clock3 className="mx-auto h-7 w-7 text-stone-400" aria-hidden="true" />
                      <p className="mt-3 font-black text-stone-900">No pending invites</p>
                      <p className="mt-1 text-sm text-stone-500">
                        New links will stay here until they are accepted, revoked, or expired.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {pendingInvites.map((invite) => {
                        const expiresAt = invite.expiresAt
                          ? new Date(invite.expiresAt)
                          : null;
                        const isExpired = Boolean(
                          expiresAt && expiresAt.getTime() < Date.now(),
                        );
                        return (
                          <div key={invite.id} className="rounded-2xl border border-[color:var(--border-subtle)] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-black text-stone-950">
                                  {invite.email || "Shareable access link"}
                                </p>
                                <p className="mt-1 text-xs text-stone-500">
                                  {isExpired
                                    ? "Expired"
                                    : expiresAt
                                      ? `Expires ${expiresAt.toLocaleDateString()}`
                                      : "Expiration unavailable"}
                                </p>
                              </div>
                              <Badge variant={isExpired ? "destructive" : "outline"}>
                                {permissionCount(normalizePermissions(invite.permissions))} areas
                              </Badge>
                            </div>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button type="button" size="sm" variant="outline" className="mt-3">
                                  Revoke invite
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Revoke this access link?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Anyone who has not accepted it will no longer be able to use it.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep invite</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => revokeInvite.mutate(invite.id)}>
                                    Revoke invite
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </BusinessWorkspaceShell>
  );
}
