import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus,
  Store,
  Copy,
  CheckCircle2,
  AlertCircle,
  MapPin,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HostLocationManager from "@/components/admin/host-location-manager";

interface CreatedAccount {
  userId: string;
  email: string;
  tempPassword: string;
  restaurantId?: string;
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Customer creation form
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Restaurant owner creation form
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantAddress, setRestaurantAddress] = useState("");
  const [restaurantPhone, setRestaurantPhone] = useState("");

  // Generic user creation form
  const [genericEmail, setGenericEmail] = useState("");
  const [genericFirstName, setGenericFirstName] = useState("");
  const [genericLastName, setGenericLastName] = useState("");
  const [genericPhone, setGenericPhone] = useState("");
  const [genericUserType, setGenericUserType] = useState<string>("customer");

  // Created account state
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(
    null,
  );
  const [selectedTab, setSelectedTab] = useState<"accounts" | "host-locations">(
    "accounts",
  );
  const canEditHostLocations =
    user?.userType === "admin" ||
    user?.userType === "staff" ||
    user?.userType === "super_admin";

  // Verify staff access
  const { data: staffCheck, isLoading: checkingAccess } = useQuery({
    queryKey: ["/api/auth/admin/verify"],
    retry: false,
  });

  const createCustomer = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/staff/users", data);
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedAccount({
        userId: data.userId,
        email: data.email,
        tempPassword: data.tempPassword,
      });
      toast({
        title: "Customer Created",
        description: `Account created for ${data.email}`,
      });
      // Reset form
      setCustomerEmail("");
      setCustomerFirstName("");
      setCustomerLastName("");
      setCustomerPhone("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer account",
        variant: "destructive",
      });
    },
  });

  const createRestaurantOwner = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest(
        "POST",
        "/api/staff/restaurant-owners",
        data,
      );
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedAccount({
        userId: data.userId,
        email: data.email,
        tempPassword: data.tempPassword,
        restaurantId: data.restaurantId,
      });
      toast({
        title: "Restaurant Owner Created",
        description: data.restaurantId
          ? `Account and restaurant created for ${data.email}`
          : `Account created for ${data.email}`,
      });
      // Reset form
      setOwnerEmail("");
      setOwnerFirstName("");
      setOwnerLastName("");
      setOwnerPhone("");
      setRestaurantName("");
      setRestaurantAddress("");
      setRestaurantPhone("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message || "Failed to create restaurant owner account",
        variant: "destructive",
      });
    },
  });

  const createGenericUser = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/staff/users", {
        ...data,
        userType: genericUserType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedAccount({
        userId: data.userId,
        email: data.email,
        tempPassword: data.tempPassword,
      });
      toast({
        title: "User Created",
        description: `${genericUserType} account created for ${data.email}`,
      });
      // Reset form
      setGenericEmail("");
      setGenericFirstName("");
      setGenericLastName("");
      setGenericPhone("");
      setGenericUserType("customer");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user account",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Password copied to clipboard",
    });
  };

  if (checkingAccess) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (
    !staffCheck ||
    (user?.userType !== "staff" && user?.userType !== "admin")
  ) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 text-center">
        <AlertCircle className="w-16 h-16 text-[color:var(--status-error)] mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-6">
          This dashboard is only accessible to staff members and administrators.
        </p>
        <Link href="/">
          <Button>Back to Home</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navigation />

      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-2">
            Staff Dashboard
          </h1>
          <p className="text-muted-foreground">
            Create customer and restaurant owner accounts on the spot
          </p>
        </div>

        {/* Created Account Display */}
        {createdAccount && (
          <Card className="mb-8 border-green-500 bg-[color:var(--status-success)]/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[color:var(--status-success)]">
                <CheckCircle2 className="w-5 h-5" />
                Account Created Successfully
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <span className="font-semibold">Email:</span>{" "}
                {createdAccount.email}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="font-semibold">Temp Password:</span>
                <code className="bg-[var(--bg-surface)] px-3 py-1 rounded border text-sm break-all">
                  {createdAccount.tempPassword}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(createdAccount.tempPassword)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              {createdAccount.restaurantId && (
                <div>
                  <span className="font-semibold">Restaurant ID:</span>{" "}
                  {createdAccount.restaurantId}
                </div>
              )}
              <p className="text-sm text-muted-foreground mt-2">
                ⚠️ User must reset password on first login. Copy this password
                and share it with the user.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreatedAccount(null)}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs
          value={selectedTab}
          onValueChange={(value) =>
            setSelectedTab(value as "accounts" | "host-locations")
          }
        >
          <TabsList className="w-full inline-flex h-auto flex-wrap gap-1 p-1 mb-4">
            <TabsTrigger value="accounts" className="flex-shrink-0">
              Account Creation
            </TabsTrigger>
            <TabsTrigger value="host-locations" className="flex-shrink-0">
              Host Locations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="accounts">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
              {/* Create Any User Type (Admin only) */}
              {user?.userType === "admin" && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserPlus className="w-5 h-5" />
                      Create User (Any Type)
                    </CardTitle>
                    <CardDescription>
                      Create any type of user account with temporary password
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        createGenericUser.mutate({
                          email: genericEmail,
                          firstName: genericFirstName || undefined,
                          lastName: genericLastName || undefined,
                          phone: genericPhone || undefined,
                        });
                      }}
                      className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    >
                      <div>
                        <Label htmlFor="generic-email">Email *</Label>
                        <Input
                          id="generic-email"
                          type="email"
                          value={genericEmail}
                          onChange={(e) => setGenericEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="generic-user-type">User Type *</Label>
                        <select
                          id="generic-user-type"
                          value={genericUserType}
                          onChange={(e) => setGenericUserType(e.target.value)}
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        >
                          <option value="customer">Customer</option>
                          <option value="restaurant_owner">
                            Restaurant Owner
                          </option>
                          <option value="event_coordinator">
                            Event Coordinator
                          </option>
                          <option value="staff">Staff</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor="generic-first-name">First Name</Label>
                        <Input
                          id="generic-first-name"
                          type="text"
                          value={genericFirstName}
                          onChange={(e) => setGenericFirstName(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="generic-last-name">Last Name</Label>
                        <Input
                          id="generic-last-name"
                          type="text"
                          value={genericLastName}
                          onChange={(e) => setGenericLastName(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor="generic-phone">Phone</Label>
                        <Input
                          id="generic-phone"
                          type="tel"
                          value={genericPhone}
                          onChange={(e) => setGenericPhone(e.target.value)}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={
                            createGenericUser.isPending || !genericEmail
                          }
                        >
                          {createGenericUser.isPending
                            ? "Creating..."
                            : `Create ${genericUserType.replace("_", " ")}`}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              )}

              {/* Create Customer */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="w-5 h-5" />
                    Create Customer Account
                  </CardTitle>
                  <CardDescription>
                    Create a diner/customer account with temporary password
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createCustomer.mutate({
                        email: customerEmail,
                        firstName: customerFirstName || undefined,
                        lastName: customerLastName || undefined,
                        phone: customerPhone || undefined,
                      });
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <Label htmlFor="customer-email">Email *</Label>
                      <Input
                        id="customer-email"
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="customer-first-name">First Name</Label>
                      <Input
                        id="customer-first-name"
                        type="text"
                        value={customerFirstName}
                        onChange={(e) => setCustomerFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="customer-last-name">Last Name</Label>
                      <Input
                        id="customer-last-name"
                        type="text"
                        value={customerLastName}
                        onChange={(e) => setCustomerLastName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="customer-phone">Phone</Label>
                      <Input
                        id="customer-phone"
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createCustomer.isPending || !customerEmail}
                    >
                      {createCustomer.isPending
                        ? "Creating..."
                        : "Create Customer"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Create Restaurant Owner */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Store className="w-5 h-5" />
                    Create Restaurant Owner
                  </CardTitle>
                  <CardDescription>
                    Create restaurant owner account with optional restaurant
                    shell
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createRestaurantOwner.mutate({
                        email: ownerEmail,
                        firstName: ownerFirstName || undefined,
                        lastName: ownerLastName || undefined,
                        phone: ownerPhone || undefined,
                        restaurantName: restaurantName || undefined,
                        restaurantAddress: restaurantAddress || undefined,
                        restaurantPhone: restaurantPhone || undefined,
                      });
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <Label htmlFor="owner-email">Email *</Label>
                      <Input
                        id="owner-email"
                        type="email"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="owner-first-name">First Name</Label>
                      <Input
                        id="owner-first-name"
                        type="text"
                        value={ownerFirstName}
                        onChange={(e) => setOwnerFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="owner-last-name">Last Name</Label>
                      <Input
                        id="owner-last-name"
                        type="text"
                        value={ownerLastName}
                        onChange={(e) => setOwnerLastName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="owner-phone">Phone</Label>
                      <Input
                        id="owner-phone"
                        type="tel"
                        value={ownerPhone}
                        onChange={(e) => setOwnerPhone(e.target.value)}
                      />
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <p className="text-sm font-semibold mb-3 text-muted-foreground">
                        Optional Restaurant Details
                      </p>
                      <div className="space-y-3">
                        <div>
                          <Label htmlFor="restaurant-name">
                            Restaurant Name
                          </Label>
                          <Input
                            id="restaurant-name"
                            type="text"
                            value={restaurantName}
                            onChange={(e) => setRestaurantName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="restaurant-address">Address</Label>
                          <Input
                            id="restaurant-address"
                            type="text"
                            value={restaurantAddress}
                            onChange={(e) =>
                              setRestaurantAddress(e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="restaurant-phone">Phone</Label>
                          <Input
                            id="restaurant-phone"
                            type="tel"
                            value={restaurantPhone}
                            onChange={(e) => setRestaurantPhone(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createRestaurantOwner.isPending || !ownerEmail}
                    >
                      {createRestaurantOwner.isPending
                        ? "Creating..."
                        : "Create Restaurant Owner"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="host-locations">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Manage Host Locations
                </CardTitle>
                <CardDescription>
                  View and update geocoded locations for existing hosts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HostLocationManager canEdit={canEditHostLocations} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Quick Links */}
        {user?.userType === "admin" && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Admin Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link href="/admin/dashboard">
                <Button variant="outline">Admin Dashboard</Button>
              </Link>
              <Link href="/admin/control-center">
                <Button variant="outline">LISA Livestream</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
