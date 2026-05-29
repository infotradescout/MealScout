import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";

type AdminUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  userType?: string | null;
  businessName?: string | null;
  emailVerified?: boolean | null;
};

type VerificationRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  submittedAt?: string | null;
  restaurantName?: string | null;
  ownerEmail?: string | null;
  documents?: string[] | null;
  restaurantId?: string | null;
};

const normalize = (value: unknown) => String(value || "").toLowerCase().trim();

export default function AdminOpsTools() {
  const [userSearch, setUserSearch] = useState("");
  const [bizSearch, setBizSearch] = useState("");

  const { data: users = [], isLoading: loadingUsers } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users", "ops-tools"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: verifications = [], isLoading: loadingVerifications } = useQuery<VerificationRequest[]>({
    queryKey: ["/api/admin/verifications", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/verifications?status=pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load verification queue");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const filteredUsers = useMemo(() => {
    const q = normalize(userSearch);
    if (!q) return users;
    return users.filter((u) => {
      const hay = [u.firstName, u.lastName, u.email, u.phone, u.userType, u.businessName]
        .map(normalize)
        .join(" ");
      return hay.includes(q);
    });
  }, [users, userSearch]);

  const filteredBusinesses = useMemo(() => {
    const q = normalize(bizSearch);
    const rows = users.filter((u) => normalize(u.businessName).length > 0 || u.userType === "food_truck" || u.userType === "restaurant_owner");
    if (!q) return rows;
    return rows.filter((u) => {
      const hay = [u.businessName, u.email, u.phone, u.firstName, u.lastName, u.userType]
        .map(normalize)
        .join(" ");
      return hay.includes(q);
    });
  }, [users, bizSearch]);

  return (
    <div className="container mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Admin Ops Tools</CardTitle>
          <CardDescription>
            Verification queue plus direct search for users and businesses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary">Pending verifications: {verifications.length}</Badge>
            <Badge variant="secondary">Users: {users.length}</Badge>
            <Link href="/admin/dashboard">
              <Button size="sm" variant="outline">Back to Admin Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="verifications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="verifications">Verification Queue</TabsTrigger>
          <TabsTrigger value="users">Search Users</TabsTrigger>
          <TabsTrigger value="businesses">Search Businesses</TabsTrigger>
        </TabsList>

        <TabsContent value="verifications">
          <Card>
            <CardHeader>
              <CardTitle>Pending Verification Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingVerifications ? (
                <p>Loading verification queue...</p>
              ) : verifications.length === 0 ? (
                <p>No pending verification requests.</p>
              ) : (
                verifications.map((v) => (
                  <div key={v.id} className="border rounded p-3">
                    <div className="font-medium">{v.restaurantName || "Unknown business"}</div>
                    <div className="text-xs text-muted-foreground">Owner: {v.ownerEmail || "n/a"}</div>
                    <div className="text-xs text-muted-foreground">Submitted: {v.submittedAt ? new Date(v.submittedAt).toLocaleString() : "n/a"}</div>
                    <div className="text-xs text-muted-foreground">Docs: {Array.isArray(v.documents) ? v.documents.length : 0}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>User Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search name, email, phone, user type" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
              {loadingUsers ? (
                <p>Loading users...</p>
              ) : (
                <div className="space-y-2">
                  {filteredUsers.slice(0, 150).map((u) => (
                    <div key={u.id} className="border rounded p-3 text-sm">
                      <div className="font-medium">{`${u.firstName || ""} ${u.lastName || ""}`.trim() || "No name"}</div>
                      <div className="text-xs text-muted-foreground">{u.email || "No email"} {u.phone ? `• ${u.phone}` : ""}</div>
                      <div className="text-xs text-muted-foreground">{u.userType || "unknown"} • {u.emailVerified ? "email verified" : "email unverified"}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="businesses">
          <Card>
            <CardHeader>
              <CardTitle>Business Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search business name, owner email, phone" value={bizSearch} onChange={(e) => setBizSearch(e.target.value)} />
              {loadingUsers ? (
                <p>Loading businesses...</p>
              ) : (
                <div className="space-y-2">
                  {filteredBusinesses.slice(0, 150).map((u) => (
                    <div key={`biz-${u.id}`} className="border rounded p-3 text-sm">
                      <div className="font-medium">{u.businessName || "Business not set"}</div>
                      <div className="text-xs text-muted-foreground">Owner: {u.email || "No email"}</div>
                      <div className="text-xs text-muted-foreground">Type: {u.userType || "unknown"}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
